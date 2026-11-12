/** Generación por lotes en la Fábrica de creativos: varios productos × formatos × tipos, con progreso,
 * cancelación, reintentos, control de calidad por pieza y descarga en ZIP organizado por producto. */
import { useMemo, useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, Download, Loader2, PackageOpen, Square } from 'lucide-react'
import { creativePiecesApi, type CreativeCatalogApi, type ProductApi } from '../../../services/api'
import { resolveImageUrl } from '../../../lib/imageSources'
import { runBatch, type BatchJob, type BatchState } from '../../../lib/creative/batch'
import type { OutputType } from '../../../lib/creative/render'
import type { PlanSpec } from '../../../lib/creative/scene'
import { DESIGN_STYLES, OBJECTIVES, OBJECTIVE_KEYS, STYLE_KEYS, detectSector, stylesOf, type SectorKey } from '../../../lib/creative/design/styles'
import { SECTOR_VIDEO } from '../../../lib/creative/design/video'
import { assetBlob } from './AssetImage'
import { formatBytes } from './ResultReview'

const MAX_BATCH_PRODUCTS = 100
const HISTORY_KEY = 'creative-batch-history'
interface HistoryEntry { at: string; products: number; pieces: number; ok: number; failed: number; skipped: number; seconds: number; mb: number }
const readHistory = (): HistoryEntry[] => { try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]') as HistoryEntry[] } catch { return [] } }
const saveHistory = (entry: HistoryEntry) => { try { localStorage.setItem(HISTORY_KEY, JSON.stringify([entry, ...readHistory()].slice(0, 10))) } catch { /* sin almacenamiento */ } }
const STATUS_LABEL: Record<string, string> = { pendiente: 'En espera', generando: 'Generando', listo: 'Lista', omitido: 'Omitida', error: 'Error', cancelado: 'Cancelada' }

export function BatchPanel({ products, catalog, token }: { products: ProductApi[]; catalog: CreativeCatalogApi; token: string }) {
  const [selected, setSelected] = useState<number[]>([])
  const [search, setSearch] = useState('')
  const [formats, setFormats] = useState<string[]>(['vertical', 'historia'])
  const [kinds, setKinds] = useState<{ imagen: boolean; video: boolean }>({ imagen: true, video: false })
  const [styleMode, setStyleMode] = useState<string>('sector')
  const [objective, setObjective] = useState('venta')
  const [seconds, setSeconds] = useState(10)
  const [music, setMusic] = useState(true)
  const [output, setOutput] = useState<OutputType>('jpeg')
  const [state, setState] = useState<BatchState | null>(null)
  const [zips, setZips] = useState<Array<{ url: string; name: string; bytes: number }>>([])
  const [running, setRunning] = useState(false)
  const [history, setHistory] = useState<HistoryEntry[]>(readHistory)
  const abort = useRef<AbortController | null>(null)

  const withPhoto = useMemo(() => products.filter((product) => product.imageUrls.length), [products])
  const shown = useMemo(() => { const q = search.trim().toLowerCase(); return withPhoto.filter((product) => !q || product.name.toLowerCase().includes(q) || (product.categoryName ?? '').toLowerCase().includes(q)) }, [withPhoto, search])
  const storeSector = useMemo<SectorKey>(() => detectSector(withPhoto.flatMap((product) => [product.categoryName ?? '', product.name])) ?? 'calzado', [withPhoto])
  const sectorOf = (product: ProductApi): SectorKey => detectSector([product.categoryName ?? '', product.name]) ?? storeSector
  const videoFormats = new Set(catalog.formats.filter((format) => format.video).map((format) => format.key))
  const jobs = useMemo<BatchJob[]>(() => {
    const list: BatchJob[] = []
    for (const id of selected) {
      const product = withPhoto.find((item) => item.id === id)
      if (!product) continue
      const style = styleMode === 'sector' ? stylesOf(sectorOf(product))[0]! : styleMode
      for (const format of formats) {
        if (kinds.imagen) list.push({ productId: id, productName: product.name, reference: product.sku, format, kind: 'imagen', style })
        if (kinds.video && videoFormats.has(format)) list.push({ productId: id, productName: product.name, reference: product.sku, format, kind: 'video', style })
      }
    }
    return list
  }, [selected, formats, kinds, styleMode, withPhoto]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id: number) => setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : current.length >= MAX_BATCH_PRODUCTS ? current : [...current, id]))
  const selectShown = () => setSelected((current) => [...new Set([...current, ...shown.map((product) => product.id)])].slice(0, MAX_BATCH_PRODUCTS))

  /** Plan verificado por el servidor. Con descuento real se usa «Oferta aprobada»; si no aplica, «Producto destacado». */
  const plan = async (job: BatchJob): Promise<PlanSpec> => {
    const product = withPhoto.find((item) => item.id === job.productId)
    const sector = DESIGN_STYLES[job.style as keyof typeof DESIGN_STYLES]?.sector ?? storeSector
    const design = { sector, objective, style: job.style, layout: DESIGN_STYLES[job.style as keyof typeof DESIGN_STYLES].layouts[0], seed: job.productId % 997, colors: null, showPrice: true, removeBg: true, showReference: objective === 'catalogo', ...(job.kind === 'video' ? { video: SECTOR_VIDEO[sector] } : {}) }
    const base = { kind: job.kind, format: job.format, productIds: [job.productId], quality: 'estandar', seconds: job.kind === 'video' ? seconds : null, design }
    const offer = Boolean(product?.compareAtPrice && product.compareAtPrice > product.price)
    try { return (await creativePiecesApi.plan<PlanSpec>({ ...base, template: offer ? 'oferta_aprobada' : 'producto_destacado' }, token)).spec }
    catch (error) { if (offer) return (await creativePiecesApi.plan<PlanSpec>({ ...base, template: 'producto_destacado' }, token)).spec; throw error }
  }

  const start = async () => {
    if (!jobs.length || running) return
    for (const zip of zips) URL.revokeObjectURL(zip.url)
    setZips([]); setRunning(true)
    const controller = new AbortController()
    abort.current = controller
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
    const result = await runBatch({
      jobs, plan, loadAsset: (id) => assetBlob(id, token), output, music, signal: controller.signal, onProgress: setState,
      onZip: (blob, index) => setZips((current) => [...current, { url: URL.createObjectURL(blob), name: `piezas-${stamp}${index > 1 || current.length ? `-parte-${index}` : ''}.zip`, bytes: blob.size }]),
    })
    const entry: HistoryEntry = { at: new Date().toLocaleString('es-CO'), products: selected.length, pieces: result.state.total, ok: result.state.ok, failed: result.state.failed, skipped: result.state.skipped, seconds: Math.round(result.state.elapsedMs / 1000), mb: Math.round((result.zip?.size ?? 0) / 1048576) }
    saveHistory(entry); setHistory(readHistory())
    setRunning(false); abort.current = null
  }

  const progress = state ? state.done / Math.max(1, state.total) : 0
  const remaining = state && state.done ? Math.round((state.elapsedMs / state.done) * (state.total - state.done) / 1000) : null
  const problems = state?.items.filter((item) => item.status === 'error' || item.status === 'omitido') ?? []

  return (
    <section className="card space-y-4 p-5">
      <div>
        <h2 className="flex items-center gap-2 text-base font-black text-ink"><PackageOpen size={18} className="text-brand" /> Generación por lotes</h2>
        <p className="mt-1 text-sm text-muted">Elige varios productos (hasta {MAX_BATCH_PRODUCTS}) y los formatos: el sistema crea cada pieza con su estilo, pasa el control de calidad y te entrega un ZIP ordenado por producto. Se hace en tu equipo, una pieza a la vez, sin costo.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <div className="flex gap-2">
            <input className="input-field flex-1" placeholder="Buscar por nombre o categoría" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Buscar productos del lote" />
            <button type="button" className="btn-ghost py-1.5 text-xs" onClick={selectShown} disabled={running}>Elegir {shown.length > MAX_BATCH_PRODUCTS ? `los primeros ${MAX_BATCH_PRODUCTS}` : 'todos'}</button>
            <button type="button" className="btn-ghost py-1.5 text-xs" onClick={() => setSelected([])} disabled={running || !selected.length}>Quitar</button>
          </div>
          <ul className="max-h-64 space-y-1 overflow-y-auto rounded-xl border border-line p-1.5">
            {shown.map((product) => {
              const image = resolveImageUrl(product.imageUrls[0])
              return (
                <li key={product.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 hover:bg-line/30">
                    <input type="checkbox" checked={selected.includes(product.id)} onChange={() => toggle(product.id)} disabled={running} />
                    {image && <img src={image} alt="" className="h-8 w-8 rounded object-cover" loading="lazy" />}
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{product.name}</span>
                    <span className="text-[11px] text-muted">{product.categoryName}</span>
                  </label>
                </li>
              )
            })}
          </ul>
          <p className="text-xs text-muted">{selected.length} productos elegidos · {jobs.length} piezas. Los productos sin foto no aparecen.</p>
        </div>

        <div className="space-y-3 text-xs text-ink">
          <fieldset><legend className="mb-1 font-bold">Formatos</legend>
            <div className="flex flex-wrap gap-1.5">{catalog.formats.map((format) => <label key={format.key} className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${formats.includes(format.key) ? 'border-brand bg-brand/5' : 'border-line'}`}><input type="checkbox" checked={formats.includes(format.key)} disabled={running} onChange={() => setFormats((current) => current.includes(format.key) ? current.filter((item) => item !== format.key) : [...current, format.key])} />{format.label} · {format.ratio}</label>)}</div>
          </fieldset>
          <fieldset className="flex flex-wrap items-center gap-3"><legend className="mb-1 font-bold">Tipo</legend>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={kinds.imagen} disabled={running} onChange={(event) => setKinds({ ...kinds, imagen: event.target.checked })} /> Imagen</label>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={kinds.video} disabled={running} onChange={(event) => setKinds({ ...kinds, video: event.target.checked })} /> Video</label>
            {kinds.video && <label className="flex items-center gap-1">Duración <select className="input-field py-1" value={seconds} disabled={running} onChange={(event) => setSeconds(Number(event.target.value))}>{[8, 10, 12, 15].map((value) => <option key={value} value={value}>{value} s</option>)}</select></label>}
            {kinds.video && <label className="flex items-center gap-1.5"><input type="checkbox" checked={music} disabled={running} onChange={(event) => setMusic(event.target.checked)} /> Música generada</label>}
          </fieldset>
          <label className="block font-bold">Estilo
            <select className="input-field mt-1 block w-full" value={styleMode} disabled={running} onChange={(event) => setStyleMode(event.target.value)}>
              <option value="sector">Automático: el estilo del sector de cada producto</option>
              {STYLE_KEYS.map((key) => <option key={key} value={key}>{DESIGN_STYLES[key].label}</option>)}
            </select>
          </label>
          <div className="flex flex-wrap gap-3">
            <label className="font-bold">Objetivo <select className="input-field mt-1 block" value={objective} disabled={running} onChange={(event) => setObjective(event.target.value)}>{OBJECTIVE_KEYS.map((key) => <option key={key} value={key}>{OBJECTIVES[key].label}</option>)}</select></label>
            <label className="font-bold">Imágenes en <select className="input-field mt-1 block" value={output} disabled={running} onChange={(event) => setOutput(event.target.value as OutputType)}><option value="jpeg">JPG</option><option value="png">PNG</option><option value="webp">WebP</option></select></label>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-brand" disabled={!jobs.length || running} onClick={() => void start()}>{running ? <Loader2 size={16} className="animate-spin" /> : <PackageOpen size={16} />} {running ? 'Generando…' : `Generar ${jobs.length} piezas`}</button>
        {running && <button type="button" className="btn-ghost" onClick={() => abort.current?.abort()}><Square size={14} /> Cancelar</button>}
        {zips.map((zip) => <a key={zip.url} href={zip.url} download={zip.name} className="btn-ghost"><Download size={14} /> {zip.name} ({formatBytes(zip.bytes)})</a>)}
      </div>

      {state && (
        <div className="space-y-2">
          <div className="h-2 overflow-hidden rounded-full bg-line/60"><div className="h-full bg-brand transition-all" style={{ width: `${Math.round(progress * 100)}%` }} /></div>
          <p className="text-xs text-muted">
            {state.done}/{state.total} · {state.ok} listas · {state.failed} con error · {state.skipped} omitidas{state.current ? ` · ahora: ${state.current}` : ''}
            {remaining !== null && running ? ` · faltan ≈ ${Math.max(1, Math.round(remaining / 60))} min` : ''}{state.heapMB ? ` · memoria ${state.heapMB} MB` : ''}
          </p>
          {problems.length > 0 && (
            <ul className="max-h-40 space-y-1 overflow-y-auto rounded-xl border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
              {problems.map((item, index) => <li key={index} className="flex gap-1.5"><AlertCircle size={13} className="mt-0.5 shrink-0" />{item.job.productName} · {item.job.format} · {STATUS_LABEL[item.status]}: {item.message}</li>)}
            </ul>
          )}
          {!running && state.ok > 0 && <p className="flex items-center gap-1.5 text-xs text-emerald-700"><CheckCircle2 size={14} /> Listo. El ZIP trae una carpeta por producto y un resumen (resumen.csv). Las piezas del lote no se guardan en «Tus piezas».</p>}
        </div>
      )}

      {history.length > 0 && (
        <details className="text-xs text-muted">
          <summary className="cursor-pointer font-bold text-ink">Lotes anteriores en este equipo</summary>
          <ul className="mt-1 space-y-0.5">{history.map((entry, index) => <li key={index}>{entry.at}: {entry.products} productos, {entry.pieces} piezas ({entry.ok} listas, {entry.failed} con error, {entry.skipped} omitidas) en {entry.seconds} s · {entry.mb} MB</li>)}</ul>
        </details>
      )}
    </section>
  )
}
