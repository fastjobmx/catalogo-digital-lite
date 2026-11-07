import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle, ArrowLeft, ArrowRight, CheckCircle2, Eye, FileUp, Loader2, Save, Sparkles, Upload } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useCatalog } from '../../contexts/CatalogContext'
import { aiCatalogApi, creditsApi, importApi, type CatalogPageRow, type ImportItemResult, type ImportPreview, type ImportSummary, type StoreCredits, type TelegramImport, type TelegramImportItem, type TelegramImportReview } from '../../services/api'
import { aiRowsToTable, forEachPdfPageImage, readImportFile, ReadError } from '../../lib/import/readers'
import { buildProducts, detectMapping, FIELD_LABELS, IMPORT_FIELDS, type ColumnMapping, type ImportProduct, type RowIssue } from '../../lib/import/mapping'
import type { RawTable } from '../../lib/import/table'
import { formatMoney } from '../../lib/format'
import { useStore } from '../../contexts/StoreContext'

const STEPS = ['Archivo', 'Lectura', 'Columnas', 'Vista previa', 'Confirmar', 'Resultado'] as const
const BATCH = 50
const ACTION_LABEL: Record<ImportItemResult['action'], { label: string; tone: string }> = {
  create: { label: 'Nuevo', tone: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  update: { label: 'Se actualiza', tone: 'bg-sky-50 text-sky-800 border-sky-200' },
  skip: { label: 'Se omite', tone: 'bg-neutral-100 text-neutral-700 border-neutral-200' },
  invalid: { label: 'Con error', tone: 'bg-red-50 text-red-800 border-red-200' },
}
const chunks = <T,>(items: T[]) => Array.from({ length: Math.ceil(items.length / BATCH) }, (_, i) => items.slice(i * BATCH, (i + 1) * BATCH))
const addSummary = (a: ImportSummary, b: ImportSummary): ImportSummary => ({ create: a.create + b.create, update: a.update + b.update, skip: a.skip + b.skip, invalid: a.invalid + b.invalid })
const EMPTY: ImportSummary = { create: 0, update: 0, skip: 0, invalid: 0 }

/** Six-step bulk import: file → reading → columns → preview → confirm → result.
 * Files are read in this browser; the server validates every row again before saving. */
export default function ImportProducts() {
  const { token } = useAuth()
  const { refresh } = useCatalog()
  const [step, setStep] = useState(0)
  const [file, setFile] = useState<File | null>(null)
  const [table, setTable] = useState<RawTable | null>(null)
  const [headerRow, setHeaderRow] = useState(-1)
  const [mapping, setMapping] = useState<ColumnMapping>({})
  const [generateSku, setGenerateSku] = useState(false)
  const [defaultStock, setDefaultStock] = useState('')
  const [createCategories, setCreateCategories] = useState(true)
  const [updateExisting, setUpdateExisting] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [result, setResult] = useState<{ summary: ImportSummary; items: ImportItemResult[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [telegramImports, setTelegramImports] = useState<TelegramImport[]>([])
  const [telegramReview, setTelegramReview] = useState<TelegramImportReview | null>(null)
  const [telegramReviewDrafts, setTelegramReviewDrafts] = useState<Record<number, TelegramImportItem>>({})
  const [telegramReviewError, setTelegramReviewError] = useState<string | null>(null)
  const [telegramReviewBusy, setTelegramReviewBusy] = useState<number | null>(null)
  const [telegramPhotoUrls, setTelegramPhotoUrls] = useState<Record<number, string>>({})
  const [telegramPhotoBusy, setTelegramPhotoBusy] = useState<number | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const telegramPhotoUrlsRef = useRef<Record<number, string>>({})

  useEffect(() => {
    if (!token) return
    importApi.telegramList(token).then((result) => setTelegramImports(result.items)).catch(() => setTelegramImports([]))
  }, [token])

  useEffect(() => () => Object.values(telegramPhotoUrlsRef.current).forEach((url) => URL.revokeObjectURL(url)), [])

  const loadTelegramReview = async (id: string) => {
    if (!token) return
    setTelegramReviewError(null)
    try {
      const review = await importApi.telegramReview(id, token)
      setTelegramReview(review)
      setTelegramReviewDrafts(Object.fromEntries(review.items.map((item) => [item.id, item])))
    } catch (err) { setTelegramReviewError(err instanceof Error ? err.message : 'No se pudo abrir el lote.') }
  }

  const saveTelegramItem = async (itemId: number) => {
    if (!token || !telegramReview) return
    setTelegramReviewBusy(itemId); setTelegramReviewError(null)
    try {
      const item = telegramReviewDrafts[itemId]!
      const next = await importApi.telegramUpdateItem(telegramReview.batch.id, itemId, item, token)
      setTelegramReview(next)
      setTelegramReviewDrafts(Object.fromEntries(next.items.map((row) => [row.id, row])))
      const list = await importApi.telegramList(token)
      setTelegramImports(list.items)
    } catch (err) { setTelegramReviewError(err instanceof Error ? err.message : 'No se pudo guardar la corrección.') }
    finally { setTelegramReviewBusy(null) }
  }

  const loadTelegramPhoto = async (batchId: string, itemId: number) => {
    if (!token || telegramPhotoUrls[itemId]) return
    setTelegramPhotoBusy(itemId)
    try {
      const url = await importApi.telegramPhoto(batchId, itemId, token)
      telegramPhotoUrlsRef.current[itemId] = url
      setTelegramPhotoUrls((current) => ({ ...current, [itemId]: url }))
    } catch (err) { setTelegramReviewError(err instanceof Error ? err.message : 'No se pudo abrir la foto.') }
    finally { setTelegramPhotoBusy(null) }
  }

  const built = useMemo(() => {
    if (!table) return { products: [] as Array<{ product: ImportProduct; rows: number[]; generated: boolean }>, issues: [] as RowIssue[] }
    const stock = defaultStock.trim() === '' ? null : Number(defaultStock)
    return buildProducts(table.rows, headerRow, mapping, { generateSku, defaultStock: Number.isInteger(stock) && stock! >= 0 ? stock : null })
  }, [table, headerRow, mapping, generateSku, defaultStock])
  const products = built.products.map((item) => item.product)

  const pick = async (chosen: File | undefined, sheet?: string) => {
    if (!chosen) return
    setBusy(true); setError(null)
    try {
      const read = await readImportFile(chosen, sheet)
      if (!read.rows.length && !read.textless) throw new ReadError('No encontré filas con datos en el archivo.')
      const detected = detectMapping(read.rows)
      setFile(chosen); setTable(read); setHeaderRow(detected.headerRow); setMapping(detected.mapping)
      setJobId(null); setPreview(null); setResult(null); setConfirmed(false)
      setStep(1)
    } catch (err) {
      setError(err instanceof ReadError ? err.message : 'No se pudo leer el archivo.')
    } finally { setBusy(false) }
  }

  const runPreview = async () => {
    if (!token || !table) return
    if (mapping.name === undefined || mapping.price === undefined) { setError('Asigna al menos las columnas Nombre y Precio.'); return }
    if (!generateSku && mapping.sku === undefined) { setError('Asigna la columna Código o activa «Crear códigos internos».'); return }
    if (!products.length) { setError('No hay productos para importar con estas columnas.'); return }
    setBusy(true); setError(null)
    try {
      const job = await importApi.start(table.source, table.fileName, { updateExisting, createCategories }, token)
      let merged: ImportPreview | null = null
      for (const [index, part] of chunks(products).entries()) {
        const page = await importApi.preview(job.id, part, token)
        merged = merged
          ? { ...page, items: [...merged.items, ...page.items.map((item) => ({ ...item, index: item.index + index * BATCH }))], summary: addSummary(merged.summary, page.summary), newCategories: [...new Set([...merged.newCategories, ...page.newCategories])] }
          : page
      }
      setJobId(job.id); setPreview(merged); setConfirmed(false); setStep(3)
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo preparar la vista previa.') }
    finally { setBusy(false) }
  }

  const runImport = async () => {
    if (!token || !jobId) return
    const parts = chunks(products)
    setBusy(true); setError(null); setStep(5); setProgress({ done: 0, total: parts.length })
    let summary = EMPTY
    const items: ImportItemResult[] = []
    try {
      for (const [index, part] of parts.entries()) {
        const batch = await importApi.apply(jobId, index, part, token)
        summary = addSummary(summary, batch.summary)
        items.push(...batch.items.map((item) => ({ ...item, index: item.index + index * BATCH })))
        setProgress({ done: index + 1, total: parts.length })
      }
      await importApi.finish(jobId, token)
      await refresh()
    } catch (err) {
      setError(`${err instanceof Error ? err.message : 'La importación se interrumpió.'} Lo que ya se guardó se conserva; puedes volver a intentarlo sin duplicar.`)
    } finally {
      setResult({ summary, items }); setBusy(false)
    }
  }

  const resetToStart = () => { setStep(0); setFile(null); setTable(null); setPreview(null); setResult(null); setJobId(null); setError(null); setProgress(null) }
  const back = () => { setError(null); setStep((current) => Math.max(0, current - 1)) }
  const updates = preview?.items.filter((item) => item.action === 'update') ?? []

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <div className="flex items-center gap-2 mb-2">
          <FileUp size={15} className="text-brand" />
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand/70">Catálogo</span>
        </div>
        <h1 className="text-3xl font-black tracking-tight text-ink">Importar productos</h1>
        <p className="text-muted text-sm mt-1.5">Sube tu lista en CSV, Excel o PDF. Revisas todo antes de guardar y nada se publica sin tu confirmación.</p>
      </div>

      <ol className="flex flex-wrap gap-2 text-xs font-bold" aria-label="Pasos">
        {STEPS.map((label, index) => (
          <li key={label} aria-current={index === step ? 'step' : undefined}
            className={`rounded-full border px-3 py-1 ${index === step ? 'bg-brand text-white border-brand' : index < step ? 'border-brand/30 text-brand' : 'border-line text-muted'}`}>
            {index + 1}. {label}
          </li>
        ))}
      </ol>

      <section className="card p-5 space-y-3">
        <div>
          <h2 className="font-bold text-ink">Importaciones desde Telegram</h2>
          <p className="text-sm text-muted">Consulta los lotes recibidos por TiendIA y el resultado de cada publicación.</p>
        </div>
        {telegramImports.length ? <div className="divide-y divide-line">
          {telegramImports.map((batch) => (
            <div key={batch.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
              <div>
                <p className="font-semibold text-ink">{new Date(batch.createdAt).toLocaleString()} · {batch.photos} foto(s)</p>
                <p className="text-muted">Telegram {batch.telegramUserId} · {batch.published} publicados · {batch.pending} pendientes · {batch.failed} fallidos</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="rounded-full border border-line px-2.5 py-1 text-xs font-semibold">{batch.status}</span>
                {batch.published > 0 && <Link to="/admin/products" className="font-semibold text-brand">Ver productos creados</Link>}
                <button type="button" className="btn-ghost py-1.5" onClick={() => void loadTelegramReview(batch.id)}><Eye size={15} /> Revisar</button>
              </div>
            </div>
          ))}
        </div> : <p className="text-sm text-muted">Todavía no hay importaciones desde Telegram.</p>}
      </section>

      {telegramReview && (
        <section className="card p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-bold text-ink">Revisión del lote · {telegramReview.items.length} productos</h2>
              <p className="text-sm text-muted">Estado: {telegramReview.batch.status}. Las correcciones se guardan en este comercio. Confirma la publicación desde Telegram con /publicar.</p>
            </div>
            <button type="button" className="btn-ghost py-1.5" onClick={() => { setTelegramReview(null); setTelegramReviewDrafts({}) }}>Cerrar</button>
          </div>
          {telegramReviewError && <p className="rounded-btn bg-red-50 p-3 text-sm text-red-700" role="alert">{telegramReviewError}</p>}
          <div className="space-y-3">
            {telegramReview.items.map((item) => {
              const draft = telegramReviewDrafts[item.id] || item
              const editable = !['published', 'ignored', 'publishing', 'analyzing'].includes(item.status) && !['published', 'cancelled', 'publishing', 'analyzing'].includes(telegramReview.batch.status)
              const field = (key: keyof TelegramImportItem, value: string) => setTelegramReviewDrafts((current) => ({ ...current, [item.id]: { ...draft, [key]: value } }))
              return (
                <article key={item.id} className="rounded-card border border-line p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold text-ink">Foto {item.position} · {item.status}</p>
                    <button type="button" className="btn-ghost py-1.5" onClick={() => void loadTelegramPhoto(telegramReview.batch.id, item.id)} disabled={telegramPhotoBusy === item.id}>
                      {telegramPhotoBusy === item.id ? <Loader2 size={15} className="animate-spin" /> : <Eye size={15} />} Ver foto
                    </button>
                  </div>
                  {telegramPhotoUrls[item.id] && <img src={telegramPhotoUrls[item.id]} alt={`Foto del producto ${item.position}`} className="max-h-56 rounded-btn object-contain" />}
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <ReviewField label="Nombre" value={draft.name || ''} disabled={!editable} onChange={(value) => field('name', value)} />
                    <ReviewField label="Precio" value={draft.price === null ? '' : String(draft.price)} disabled={!editable} inputMode="numeric" onChange={(value) => setTelegramReviewDrafts((current) => ({ ...current, [item.id]: { ...draft, price: value === '' ? null : Number(value) } }))} />
                    <ReviewField label="Cantidad inicial" value={draft.stock === null ? '' : String(draft.stock)} disabled={!editable} inputMode="numeric" onChange={(value) => setTelegramReviewDrafts((current) => ({ ...current, [item.id]: { ...draft, stock: value === '' ? null : Number(value) } }))} />
                    <ReviewField label="SKU" value={draft.sku || ''} disabled={!editable} onChange={(value) => field('sku', value)} />
                    <ReviewField label="Categoría" value={draft.categoryName || ''} disabled={!editable} onChange={(value) => field('categoryName', value)} />
                    <ReviewField label="Talla" value={draft.size || ''} disabled={!editable} onChange={(value) => field('size', value)} />
                    <ReviewField label="Color" value={draft.color || ''} disabled={!editable} onChange={(value) => field('color', value)} />
                    <p className="self-end text-xs text-muted">Si el SKU queda vacío, se asigna un código interno al publicar.</p>
                  </div>
                  <label className="block space-y-1 text-sm">
                    <span className="font-semibold text-ink">Descripción</span>
                    <textarea className="input-field min-h-20 w-full" value={draft.description || ''} disabled={!editable} onChange={(event) => field('description', event.target.value)} />
                  </label>
                  {(item.validationErrors.length > 0 || item.warnings.length > 0) && <p className="text-sm text-amber-800">{[...item.validationErrors, ...item.warnings].join(' · ')}</p>}
                  {editable && <button type="button" className="btn-brand py-1.5" disabled={telegramReviewBusy === item.id} onClick={() => void saveTelegramItem(item.id)}>
                    {telegramReviewBusy === item.id ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Guardar corrección
                  </button>}
                </article>
              )
            })}
          </div>
        </section>
      )}

      {error && <p className="card flex items-start gap-2 p-4 text-sm text-red-700" role="alert"><AlertCircle size={17} className="mt-0.5 shrink-0" />{error}</p>}

      {step === 0 && (
        <section className="card p-6">
          <button type="button" onClick={() => input.current?.click()} disabled={busy}
            onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void pick(e.dataTransfer.files[0]) }}
            className="w-full rounded-card border-2 border-dashed border-line hover:border-brand/50 p-10 text-center transition-colors">
            {busy ? <Loader2 className="mx-auto animate-spin text-brand" /> : <Upload className="mx-auto text-brand" />}
            <p className="mt-3 font-bold text-ink">Elige o arrastra tu archivo</p>
            <p className="mt-1 text-sm text-muted">CSV o Excel (.xlsx) hasta 15 MB · PDF hasta 60 MB</p>
          </button>
          <input ref={input} type="file" className="sr-only" accept=".csv,.txt,.xlsx,.pdf,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => void pick(e.target.files?.[0])} />
          <ul className="mt-5 grid gap-2 text-sm text-muted sm:grid-cols-3">
            <li><b className="text-ink">Columnas útiles:</b> código, nombre, precio, existencias, categoría, color, talla.</li>
            <li><b className="text-ink">Fórmulas:</b> se lee el valor guardado; nunca se ejecutan.</li>
            <li><b className="text-ink">Productos existentes:</b> no se tocan, salvo que tú lo autorices.</li>
          </ul>
        </section>
      )}

      {step === 1 && table && (
        <section className="card p-6 space-y-4">
          <p className="text-sm text-ink"><b>{table.fileName}</b> · {table.rows.length} filas{table.pages ? ` · ${table.pages} páginas` : ''}</p>
          {table.sheets && table.sheets.length > 1 && file && (
            <label className="block text-sm">Hoja: <select className="input-field ml-2 inline-block w-auto py-1" onChange={(e) => void pick(file, e.target.value)} defaultValue="">
              <option value="" disabled>Cambiar de hoja…</option>{table.sheets.map((sheet) => <option key={sheet} value={sheet}>{sheet}</option>)}
            </select></label>
          )}
          {table.aiRead && (
            <p className="rounded-btn border border-brand/30 bg-brand/5 p-3 text-sm text-ink">
              <b>Leído con IA.</b> La IA copió lo que vio en las páginas; lo que no estaba escrito quedó vacío. Compara nombres y precios con tu PDF en la vista previa antes de importar.
            </p>
          )}
          {table.textless && !table.aiRead && (
            <p className="rounded-btn border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              Este PDF casi no tiene texto seleccionable: parece hecho con imágenes o escaneado, así que no se puede leer como tabla. Puedes leerlo con IA o exportar tu lista a Excel o CSV.
            </p>
          )}
          {table.source === 'pdf' && !table.textless && !table.aiRead && <p className="text-sm text-muted">En los PDF las columnas se reconocen por la posición del texto. Revisa bien la vista previa: si se ve desordenada, es mejor usar Excel o CSV o leerlo con IA.</p>}
          {table.source === 'pdf' && !table.aiRead && file && token && <PdfAiReader file={file} pages={table.pages || 1} token={token} onRead={(next) => { const detected = detectMapping(next.rows); setTable(next); setHeaderRow(detected.headerRow); setMapping(detected.mapping) }} />}
          <label className="block text-sm text-ink">Fila de títulos:
            <select className="input-field ml-2 inline-block w-auto py-1" value={headerRow} onChange={(e) => { const row = Number(e.target.value); setHeaderRow(row); setMapping(row >= 0 ? detectMapping([table.rows[row]!]).mapping : {}) }}>
              <option value={-1}>El archivo no tiene títulos</option>
              {table.rows.slice(0, 15).map((row, index) => <option key={index} value={index}>Fila {index + 1}: {row.slice(0, 4).join(' · ').slice(0, 60)}</option>)}
            </select>
          </label>
          <RowsTable rows={table.rows.slice(0, 12)} headerRow={headerRow} />
          <Nav onBack={back} onNext={() => { setError(null); setStep(2) }} nextDisabled={!table.rows.length} />
        </section>
      )}

      {step === 2 && table && (
        <section className="card p-6 space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {IMPORT_FIELDS.map((field) => (
              <label key={field} className="block space-y-1.5">
                <span className="block text-xs font-bold uppercase tracking-widest text-muted">{FIELD_LABELS[field]}{field === 'name' || field === 'price' ? ' *' : ''}</span>
                <select className="input-field w-full" value={mapping[field] ?? ''} onChange={(e) => setMapping({ ...mapping, [field]: e.target.value === '' ? undefined : Number(e.target.value) })}>
                  <option value="">— No usar —</option>
                  {columnNames(table.rows, headerRow).map((name, index) => <option key={index} value={index}>{name}</option>)}
                </select>
              </label>
            ))}
          </div>
          <div className="space-y-3 text-sm">
            <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={generateSku} onChange={(e) => setGenerateSku(e.target.checked)} />
              <span><b className="text-ink">Crear códigos internos</b> para las filas sin código (por ejemplo IMP-TOCADOR-IMPERIA). Si no lo activas, esas filas no se importan.</span></label>
            <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={createCategories} onChange={(e) => setCreateCategories(e.target.checked)} />
              <span><b className="text-ink">Crear las categorías</b> que aún no existen en tu tienda.</span></label>
            <label className="flex flex-wrap items-center gap-2"><span>Existencias cuando una fila no las tenga:</span>
              <input className="input-field w-28 py-1" inputMode="numeric" placeholder="vacío" value={defaultStock} onChange={(e) => setDefaultStock(e.target.value.replace(/\D/g, ''))} />
              <span className="text-muted">Vacío = 0, y el producto se muestra como Agotado.</span></label>
            <label className="flex items-start gap-2 rounded-btn border border-amber-200 bg-amber-50 p-3"><input type="checkbox" className="mt-1" checked={updateExisting} onChange={(e) => setUpdateExisting(e.target.checked)} />
              <span className="text-amber-900"><b>Actualizar productos que ya existen</b> (mismo código): solo el precio y las existencias. Si no lo activas, los productos que ya tienes no cambian.</span></label>
          </div>
          <p className="text-sm text-muted">{products.length} productos detectados{built.issues.length ? ` · ${built.issues.length} avisos en filas` : ''}.</p>
          <Nav onBack={back} onNext={() => void runPreview()} nextLabel="Ver vista previa" busy={busy} />
        </section>
      )}

      {step === 3 && preview && (
        <section className="card p-6 space-y-4">
          <SummaryBar summary={preview.summary} />
          {preview.newCategories.length > 0 && <p className="text-sm text-ink">Categorías nuevas: <b>{preview.newCategories.join(', ')}</b></p>}
          {preview.limit.max !== null && <p className="text-xs text-muted">Tu plan permite {preview.limit.max} productos; hoy tienes {preview.limit.count}.</p>}
          {built.issues.length > 0 && (
            <details className="text-sm"><summary className="cursor-pointer font-bold text-ink">{built.issues.length} {built.issues.length === 1 ? 'aviso' : 'avisos'} al leer el archivo</summary>
              <ul className="mt-2 max-h-48 overflow-y-auto space-y-1 text-muted">{built.issues.map((issue, i) => <li key={i}>Fila {issue.row}: {issue.message}</li>)}</ul>
            </details>
          )}
          <PreviewTable items={preview.items} products={products} />
          <Nav onBack={back} onNext={() => setStep(4)} nextLabel="Continuar" nextDisabled={!preview.summary.create && !preview.summary.update} />
        </section>
      )}

      {step === 4 && preview && (
        <section className="card p-6 space-y-4">
          <h2 className="text-lg font-black text-ink">Confirma la importación</h2>
          <ul className="text-sm text-ink space-y-1">
            <li>Se crearán <b>{preview.summary.create}</b> productos nuevos{preview.newCategories.length ? ` y ${preview.newCategories.length} categorías` : ''}.</li>
            {updates.length > 0 && <li>Se actualizarán precio o existencias de <b>{updates.length}</b> productos que ya existen.</li>}
            <li>Se omiten <b>{preview.summary.skip + preview.summary.invalid}</b> filas (ya existen o tienen errores).</li>
          </ul>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            <span>Revisé la vista previa{updates.length ? ' y autorizo cambiar el precio y las existencias de los productos marcados «Se actualiza»' : ''}.</span></label>
          <Nav onBack={back} onNext={() => void runImport()} nextLabel="Importar ahora" nextDisabled={!confirmed} busy={busy} />
        </section>
      )}

      {step === 5 && (
        <section className="card p-6 space-y-4" aria-live="polite">
          {progress && busy && (
            <div>
              <p className="text-sm text-ink flex items-center gap-2"><Loader2 size={16} className="animate-spin" /> Guardando lote {progress.done + 1} de {progress.total}…</p>
              <div className="mt-2 h-2 rounded-full bg-line overflow-hidden"><div className="h-full bg-brand transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} /></div>
            </div>
          )}
          {result && !busy && (
            <>
              <p className="flex items-center gap-2 font-bold text-ink"><CheckCircle2 size={18} className="text-emerald-600" /> Importación {error ? 'interrumpida' : 'terminada'}</p>
              <SummaryBar summary={result.summary} done />
              {result.items.some((item) => item.action === 'invalid') && <PreviewTable items={result.items.filter((item) => item.action === 'invalid')} products={products} />}
              <div className="flex flex-wrap gap-2">
                <Link to="/admin/products" className="btn-brand">Ver productos</Link>
                {error && <button type="button" className="btn-ghost" onClick={() => void runImport()}>Reintentar</button>}
                <button type="button" className="btn-ghost" onClick={resetToStart}>Importar otro archivo</button>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  )
}

function columnNames(rows: string[][], headerRow: number): string[] {
  const width = Math.max(0, ...rows.slice(0, 50).map((row) => row.length))
  return Array.from({ length: width }, (_, i) => {
    const title = headerRow >= 0 ? rows[headerRow]?.[i] : ''
    const sample = rows[headerRow + 1]?.[i]
    return `${title || `Columna ${i + 1}`}${sample ? ` (ej. ${sample.slice(0, 24)})` : ''}`
  })
}

function RowsTable({ rows, headerRow }: { rows: string[][]; headerRow: number }) {
  const width = Math.max(0, ...rows.map((row) => row.length))
  return (
    <div className="overflow-x-auto rounded-btn border border-line">
      <table className="w-full text-xs">
        <tbody>{rows.map((row, r) => (
          <tr key={r} className={r === headerRow ? 'bg-brand/10 font-bold' : 'border-t border-line'}>
            <td className="px-2 py-1.5 text-muted">{r + 1}</td>
            {Array.from({ length: width }, (_, c) => <td key={c} className="px-2 py-1.5 max-w-[14rem] truncate text-ink">{row[c] ?? ''}</td>)}
          </tr>))}</tbody>
      </table>
    </div>
  )
}

function SummaryBar({ summary, done }: { summary: ImportSummary; done?: boolean }) {
  const cards: Array<[string, number]> = [[done ? 'Creados' : 'Nuevos', summary.create], [done ? 'Actualizados' : 'Se actualizan', summary.update], ['Omitidos', summary.skip], ['Con error', summary.invalid]]
  return <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">{cards.map(([label, value]) => (
    <div key={label} className="rounded-btn border border-line p-3"><p className="text-xs font-bold uppercase tracking-widest text-muted">{label}</p><p className="text-2xl font-black text-ink">{value}</p></div>
  ))}</div>
}

function PreviewTable({ items, products }: { items: ImportItemResult[]; products: ImportProduct[] }) {
  const { store } = useStore()
  const formatPrice = (value: number) => formatMoney(value, store.currency)
  const [filter, setFilter] = useState<'all' | ImportItemResult['action']>('all')
  const visible = items.filter((item) => filter === 'all' || item.action === filter).slice(0, 300)
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2 text-xs">
        {(['all', 'create', 'update', 'skip', 'invalid'] as const).map((key) => (
          <button key={key} type="button" onClick={() => setFilter(key)} className={`rounded-full border px-3 py-1 font-bold ${filter === key ? 'bg-ink text-white border-ink' : 'border-line text-muted'}`}>
            {key === 'all' ? 'Todos' : ACTION_LABEL[key].label}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto rounded-btn border border-line">
        <table className="w-full text-sm min-w-[640px]">
          <thead className="text-left text-xs uppercase tracking-widest text-muted border-b border-line"><tr><th className="p-2">Código</th><th className="p-2">Producto</th><th className="p-2">Precio</th><th className="p-2">Variantes</th><th className="p-2">Estado</th></tr></thead>
          <tbody>{visible.map((item) => {
            const product = products[item.index]
            return (
              <tr key={`${item.index}-${item.sku}`} className="border-t border-line align-top">
                <td className="p-2 font-mono text-xs">{item.sku}</td>
                <td className="p-2"><p className="text-ink">{item.name}</p>{item.category && <p className="text-xs text-muted">{item.category}</p>}</td>
                <td className="p-2 whitespace-nowrap">{item.changes?.price ? <>{formatPrice(item.changes.price.from)} → <b>{formatPrice(item.changes.price.to)}</b></> : product?.price ? formatPrice(product.price) : '—'}</td>
                <td className="p-2 text-xs text-muted">{item.changes?.stock
                  ? item.changes.stock.map((change) => `${change.variant}: ${change.from} → ${change.to}`).join(' · ')
                  : product?.variants.map((variant) => [variant.color, variant.size].filter(Boolean).join(' / ') || 'Única').join(', ')}</td>
                <td className="p-2">
                  <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-bold ${ACTION_LABEL[item.action].tone}`}>{ACTION_LABEL[item.action].label}</span>
                  {[...item.errors, ...item.warnings].map((message) => <p key={message} className={`mt-1 text-xs ${item.errors.includes(message) ? 'text-red-700' : 'text-muted'}`}>{message}</p>)}
                </td>
              </tr>
            )
          })}</tbody>
        </table>
      </div>
      {items.length > 300 && <p className="text-xs text-muted">Se muestran 300 de {items.length} filas.</p>}
    </div>
  )
}

function Nav({ onBack, onNext, nextLabel = 'Siguiente', nextDisabled, busy }: { onBack: () => void; onNext: () => void; nextLabel?: string; nextDisabled?: boolean; busy?: boolean }) {
  return (
    <div className="flex justify-between gap-2 pt-2">
      <button type="button" className="btn-ghost" onClick={onBack} disabled={busy}><ArrowLeft size={16} /> Atrás</button>
      <button type="button" className="btn-brand" onClick={onNext} disabled={nextDisabled || busy}>{busy ? <Loader2 size={16} className="animate-spin" /> : null}{nextLabel} <ArrowRight size={16} /></button>
    </div>
  )
}

function ReviewField({ label, value, disabled, inputMode, onChange }: { label: string; value: string; disabled: boolean; inputMode?: 'numeric' | 'decimal'; onChange: (value: string) => void }) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="font-semibold text-ink">{label}</span>
      <input className="input-field w-full" value={value} disabled={disabled} inputMode={inputMode} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}

const MAX_AI_PAGES = 20

/** Reads scanned PDF pages with AI, one page at a time (credits per page when the platform sets a cost). */
function PdfAiReader({ file, pages, token, onRead }: { file: File; pages: number; token: string; onRead: (table: RawTable) => void }) {
  const [credits, setCredits] = useState<StoreCredits | null>(null)
  const [from, setFrom] = useState('1')
  const [to, setTo] = useState(String(Math.min(pages, MAX_AI_PAGES)))
  const [state, setState] = useState<{ busy: boolean; done: number; total: number; error: string | null }>({ busy: false, done: 0, total: 0, error: null })
  useEffect(() => { creditsApi.get(token).then(setCredits).catch(() => setCredits(null)) }, [token])

  const cost = credits?.costs.find((item) => item.feature === 'importar_pdf_pagina')
  const available = Boolean(credits?.aiEnabled) && cost?.enabled !== false
  const start = Math.max(1, Number(from) || 1)
  const end = Math.min(pages, Number(to) || start)
  const count = Math.max(0, end - start + 1)

  const run = async () => {
    if (count < 1 || count > MAX_AI_PAGES) { setState((s) => ({ ...s, error: `Elige entre 1 y ${MAX_AI_PAGES} páginas por vez.` })); return }
    const list = Array.from({ length: count }, (_, i) => start + i)
    setState({ busy: true, done: 0, total: list.length, error: null })
    const rows: CatalogPageRow[] = []
    const unreadable: number[] = []
    try {
      let done = 0
      await forEachPdfPageImage(file, list, async (image) => {
        const result = await aiCatalogApi.readCatalogPage(image.data, image.mimeType, crypto.randomUUID(), token)
        rows.push(...result.rows)
        if (!result.rows.length) unreadable.push(image.page)
        done++
        setState((s) => ({ ...s, done }))
      })
      if (!rows.length) { setState({ busy: false, done: 0, total: 0, error: 'La IA no encontró productos en esas páginas.' }); return }
      onRead(aiRowsToTable(file.name, pages, rows))
      setState({ busy: false, done: 0, total: 0, error: unreadable.length ? `Sin productos legibles en las páginas ${unreadable.join(', ')}.` : null })
    } catch (err) {
      setState({ busy: false, done: 0, total: 0, error: `${err instanceof Error ? err.message : 'La IA no pudo leer el PDF.'}${rows.length ? ' Las páginas leídas antes del error no se usaron; vuelve a intentarlo.' : ''}` })
    }
  }

  if (!credits) return null
  return (
    <div className="rounded-btn border border-line p-4 space-y-3 text-sm">
      <p className="font-bold text-ink flex items-center gap-2"><Sparkles size={15} /> Leer con IA</p>
      {!available
        ? <p className="text-muted">{!credits.aiEnabled ? 'La IA está desactivada para tu tienda.' : 'Esta función de IA está pausada por la plataforma.'}</p>
        : (
          <>
            <p className="text-muted">La IA transcribe los productos de cada página tal como están escritos; no inventa precios ni códigos. {cost?.configured ? `${cost.credits} créditos por página · tienes ${credits.balance}.` : 'Usa el límite mensual de IA de tu plan.'} Si falla una página, no se descuenta.</p>
            <div className="flex flex-wrap items-center gap-2">
              <span>Páginas</span>
              <input className="input-field w-20 py-1" inputMode="numeric" value={from} onChange={(e) => setFrom(e.target.value.replace(/\D/g, ''))} aria-label="Desde la página" />
              <span>a</span>
              <input className="input-field w-20 py-1" inputMode="numeric" value={to} onChange={(e) => setTo(e.target.value.replace(/\D/g, ''))} aria-label="Hasta la página" />
              <span className="text-muted">de {pages} (máximo {MAX_AI_PAGES} por vez)</span>
              <button type="button" className="btn-brand py-1.5" disabled={state.busy || count < 1} onClick={() => void run()}>
                {state.busy ? <><Loader2 size={14} className="animate-spin" /> Página {state.done + 1} de {state.total}</> : `Leer ${count} ${count === 1 ? 'página' : 'páginas'}`}
              </button>
            </div>
          </>
        )}
      {state.error && <p className="text-red-700" role="alert">{state.error}</p>}
    </div>
  )
}
