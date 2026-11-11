import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AlertCircle, ArrowLeft, Camera, CheckCircle2, Coins, Loader2, RefreshCw, ScanSearch, Upload, X } from 'lucide-react'
import { useAuth } from '../../../contexts/AuthContext'
import { ApiRequestError, creativePhotoApi, getProducts, importApi, type CreativeAssetApi, type PhotoBatchApi, type PhotoCatalogApi, type PhotoQuoteApi, type ProductApi } from '../../../services/api'
import { analyzePhoto, applyBrowserOperation, isBrowserOperation, suggestOperation, type PhotoQuality } from '../../../lib/photoEdit'
import { AssetImage, assetBlob } from './AssetImage'
import { LEVEL_LABEL, ResultReview } from './ResultReview'

const JOB_ERRORS: Record<string, string> = {
  NO_CREDITS: 'No alcanzaron los créditos para esta foto. No se cobró.',
  AI_DISABLED: 'La IA está desactivada para tu tienda.',
  AI_UNAVAILABLE: 'La IA de imágenes no está activada en la plataforma.',
  BUDGET_EXHAUSTED: 'Tu tienda alcanzó el límite mensual de IA.',
  PLATFORM_CAP: 'La IA de la plataforma alcanzó su límite por ahora.',
  FEATURE_PAUSED: 'Esta función está pausada por la plataforma.',
  GEMINI_QUOTA: 'El servicio de IA está saturado. Reinténtalo en unos minutos. No se cobró.',
  GEMINI_SERVICE: 'El servicio de IA falló. Reinténtalo. No se cobró.',
  GEMINI_STRUCTURED_SCHEMA: 'La IA no devolvió una imagen para esta foto. No se cobró.',
  ORIGINAL_NOT_FOUND: 'No se encontró la foto original.',
  TIMEOUT: 'El trabajo tardó demasiado y se detuvo. No se cobró.',
}
const jobError = (code: string | null) => JOB_ERRORS[code || ''] || 'No se pudo mejorar esta foto. No se cobró.'
const MAX_PARALLEL = 2

type Source = 'productos' | 'biblioteca' | 'subir'

/** Estudio fotográfico: elegir fotos → analizar → elegir mejora → confirmar costo → revisar y aprobar. */
export default function PhotoStudio() {
  const { token, isDemoSession } = useAuth()
  const [params] = useSearchParams()
  const telegramBatch = params.get('telegram')
  const [catalog, setCatalog] = useState<PhotoCatalogApi | null>(null)
  const [products, setProducts] = useState<ProductApi[]>([])
  const [originals, setOriginals] = useState<CreativeAssetApi[]>([])
  const [selected, setSelected] = useState<CreativeAssetApi[]>([])
  const [source, setSource] = useState<Source>('productos')
  const [loadingId, setLoadingId] = useState<number | null>(null)
  const [uploading, setUploading] = useState(false)
  const [quality, setQuality] = useState<Record<string, PhotoQuality>>({})
  const [analyzing, setAnalyzing] = useState(false)
  const [operation, setOperation] = useState('')
  const [quote, setQuote] = useState<PhotoQuoteApi | null>(null)
  const [working, setWorking] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [batch, setBatch] = useState<PhotoBatchApi | null>(null)
  const [results, setResults] = useState<CreativeAssetApi[]>([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const batchKey = useRef<string>('')
  const stop = useRef(false)

  const fail = (err: unknown, fallback: string) => setError(err instanceof Error && err.message ? err.message : fallback)

  const loadCatalog = useCallback(async () => {
    if (!token) return
    try { setCatalog(await creativePhotoApi.catalog(token)) }
    catch (err) { setError(err instanceof ApiRequestError && err.status === 403 ? 'Solo el propietario o un administrador de la tienda pueden usar el estudio fotográfico.' : 'No se pudo cargar el estudio fotográfico.') }
  }, [token])

  useEffect(() => {
    if (!token || isDemoSession) return
    void loadCatalog()
    getProducts().then(setProducts).catch(() => setProducts([]))
    creativePhotoApi.assets(token, { role: 'original' }).then((list) => setOriginals(list.items)).catch(() => setOriginals([]))
  }, [token, isDemoSession, loadCatalog])

  // Borradores de la importación masiva de Telegram: se toman sus fotos, sin crear otro importador.
  useEffect(() => {
    if (!token || isDemoSession || !telegramBatch) return
    let cancelled = false
    ;(async () => {
      try {
        const review = await importApi.telegramReview(telegramBatch, token)
        const imported: CreativeAssetApi[] = []
        for (const item of review.items.filter((entry) => entry.status !== 'ignored')) {
          try { imported.push((await creativePhotoApi.importTelegram(telegramBatch, item.id, token)).asset) } catch { /* una foto que falta no detiene las demás */ }
        }
        if (cancelled) return
        setSelected((current) => [...current, ...imported.filter((asset) => !current.some((item) => item.id === asset.id))])
        setNotice(`Se tomaron ${imported.length} fotos de tu importación de Telegram. Al aprobar cada resultado, el borrador usará la foto mejorada.`)
      } catch (err) { if (!cancelled) fail(err, 'No se pudo abrir el lote de Telegram.') }
    })()
    return () => { cancelled = true }
  }, [token, isDemoSession, telegramBatch])

  const operations = catalog?.operations ?? []
  const labels = useMemo(() => Object.fromEntries(operations.map((item) => [item.key, item.label])), [operations])
  const chosen = operations.find((item) => item.key === operation) || null
  const level = (key: string) => catalog?.levels.find((item) => item.level === key)
  const isSelected = (id: string) => selected.some((asset) => asset.id === id)
  const toggle = (asset: CreativeAssetApi) => setSelected((current) => current.some((item) => item.id === asset.id) ? current.filter((item) => item.id !== asset.id) : [...current, asset])
  const resetPlan = () => { setQuote(null); setBatch(null); setProgress(null); batchKey.current = '' }

  const pickProduct = async (product: ProductApi) => {
    if (!token) return
    const already = selected.find((asset) => asset.productId === product.id && asset.origin !== 'panel')
    if (already) { toggle(already); return }
    setLoadingId(product.id); setError('')
    try {
      const { asset } = await creativePhotoApi.importProduct(product.id, token)
      setSelected((current) => current.some((item) => item.id === asset.id) ? current : [...current, asset])
      setOriginals((current) => current.some((item) => item.id === asset.id) ? current : [asset, ...current])
    } catch (err) { fail(err, 'No se pudo tomar la foto del producto.') }
    finally { setLoadingId(null) }
  }

  const uploadFiles = async (files: FileList | null) => {
    if (!files?.length || !token) return
    setUploading(true); setError('')
    const repeated: string[] = []
    for (const file of [...files].slice(0, 20)) {
      try {
        const { asset, duplicate } = await creativePhotoApi.upload(file, token)
        if (duplicate) repeated.push(file.name)
        setSelected((current) => current.some((item) => item.id === asset.id) ? current : [...current, asset])
        setOriginals((current) => current.some((item) => item.id === asset.id) ? current : [asset, ...current])
      } catch (err) { fail(err, `No se pudo subir ${file.name}.`) }
    }
    if (repeated.length) setNotice(`${repeated.length === 1 ? 'Esta foto ya estaba' : 'Estas fotos ya estaban'} en tu biblioteca y no se duplicaron: ${repeated.join(', ')}.`)
    setUploading(false)
  }

  const analyze = async () => {
    if (!token) return
    setAnalyzing(true); setError('')
    for (const asset of selected) {
      if (quality[asset.id]) continue
      try { const result = await analyzePhoto(await assetBlob(asset.id, token)); setQuality((current) => ({ ...current, [asset.id]: result })) } catch { /* se omite esa foto */ }
    }
    setAnalyzing(false)
  }

  const chooseOperation = async (key: string) => {
    setOperation(key); resetPlan(); setError('')
    const item = operations.find((entry) => entry.key === key)
    if (!token || !item || item.runsIn !== 'ia' || !selected.length) return
    try { setQuote(await creativePhotoApi.quote(key, selected.length, token)) } catch (err) { fail(err, 'No se pudo calcular el costo.') }
  }
  // El costo depende de cuántas fotos hay: si cambia la selección, se vuelve a cotizar.
  useEffect(() => {
    if (operation && !working && !batch) void chooseOperation(operation)
  }, [selected.length]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Nivel A: en el navegador, sin IA ni créditos. */
  const runBrowser = async () => {
    if (!token || !isBrowserOperation(operation)) return
    setWorking(true); setError(''); stop.current = false
    setProgress({ done: 0, total: selected.length })
    let failed = 0
    for (const [index, asset] of selected.entries()) {
      if (stop.current) break
      try {
        const file = await applyBrowserOperation(await assetBlob(asset.id, token), operation)
        const result = await creativePhotoApi.saveEdit(asset.id, file, operation, token)
        setResults((current) => [result, ...current])
      } catch { failed++ }
      setProgress({ done: index + 1, total: selected.length })
    }
    if (failed) setError(`${failed} ${failed === 1 ? 'foto no se pudo editar' : 'fotos no se pudieron editar'}. Las demás quedaron listas para revisar.`)
    setWorking(false)
  }

  /** Avanza el lote: hasta dos fotos a la vez. Si se cierra la página, el servidor sigue en segundo plano. */
  const drive = useCallback(async (batchId: string) => {
    if (!token) return
    setWorking(true); stop.current = false
    const known = new Set<string>()
    for (let guard = 0; guard < 400 && !stop.current; guard++) {
      const status = await creativePhotoApi.batch(batchId, token)
      setBatch(status)
      for (const job of status.jobs) {
        if (job.resultAssetId && !known.has(job.resultAssetId)) {
          known.add(job.resultAssetId)
          creativePhotoApi.asset(job.resultAssetId, token).then((asset) => setResults((current) => current.some((item) => item.id === asset.id) ? current : [asset, ...current])).catch(() => {})
        }
      }
      if (status.done) break
      const pending = status.jobs.filter((job) => job.status === 'pendiente').slice(0, Math.max(1, MAX_PARALLEL - status.counts.en_proceso))
      if (!pending.length) { await new Promise((resolve) => setTimeout(resolve, 2500)); continue }
      await Promise.all(pending.map((job) => creativePhotoApi.runJob(job.id, token).catch(() => new Promise((resolve) => setTimeout(resolve, 1500)))))
    }
    setWorking(false)
    void loadCatalog()
  }, [token, loadCatalog])

  const confirmBatch = async () => {
    if (!token || !quote || !chosen) return
    setError('')
    if (!batchKey.current) batchKey.current = `foto-${crypto.randomUUID()}`
    try {
      const created = await creativePhotoApi.createBatch(chosen.key, selected.map((asset) => ({ assetId: asset.id })), quote.totalCredits, batchKey.current, token)
      setBatch(created)
      if (created.skipped?.length) setNotice(`${created.skipped.length} ${created.skipped.length === 1 ? 'foto se omitió' : 'fotos se omitieron'}: ${created.skipped[0]!.message}`)
      await drive(created.batchId)
    } catch (err) {
      fail(err, 'No se pudo crear el lote.')
      if (err instanceof ApiRequestError && (err.code === 'CONFIRMATION_REQUIRED' || err.code === 'NO_CREDITS')) void chooseOperation(chosen.key)
    }
  }

  const cancel = async () => {
    stop.current = true
    if (!token || !batch) return
    try { setBatch(await creativePhotoApi.cancelBatch(batch.batchId, token)) } catch (err) { fail(err, 'No se pudo cancelar.') }
  }

  const retry = async (jobId: string) => {
    if (!token || !batch) return
    try { await creativePhotoApi.retryJob(jobId, token); await drive(batch.batchId) } catch (err) { fail(err, 'No se pudo reintentar.') }
  }

  const productOptions = useMemo(() => products.map((product) => ({ id: product.id, name: product.name })), [products])
  const failedJobs = batch?.jobs.filter((job) => job.status === 'fallido') ?? []
  const batchDone = batch ? batch.counts.completado + batch.counts.fallido + batch.counts.cancelado : 0

  return (
    <div className="space-y-8 animate-fade-in">
      <div>
        <Link to="/admin/estudio-creativo" className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink mb-3"><ArrowLeft size={15} /> Estudio Creativo IA</Link>
        <div className="flex items-center gap-2 mb-2">
          <Camera size={15} className="text-brand" />
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand/70">Estudio Creativo IA</span>
        </div>
        <h1 className="text-3xl font-black tracking-tight text-ink">Estudio fotográfico</h1>
        <p className="text-muted text-sm mt-1.5">Convierte fotos comunes en imágenes comerciales. Tu foto original nunca se reemplaza: revisas cada resultado y decides si lo usas.</p>
      </div>

      {isDemoSession && <p className="card p-4 text-sm text-muted">El estudio fotográfico se usa con la cuenta real de tu tienda.</p>}
      {error && <p className="card flex items-start gap-2 p-4 text-sm text-red-700" role="alert"><AlertCircle size={17} className="shrink-0 mt-0.5" />{error}</p>}
      {notice && <p className="card flex items-start justify-between gap-3 p-4 text-sm text-ink" role="status">{notice}<button type="button" aria-label="Cerrar aviso" onClick={() => setNotice('')}><X size={15} /></button></p>}
      {!catalog && !error && !isDemoSession && <p className="flex items-center gap-2 text-sm text-muted"><Loader2 size={16} className="animate-spin" /> Cargando…</p>}

      {catalog && (
        <>
          {/* 1 · Fotos */}
          <section className="card p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-black text-ink">1. Elige las fotos</h2>
              <span className="text-sm font-semibold text-ink">{selected.length} de {catalog.maxBatchItems} seleccionadas</span>
            </div>
            <div className="flex flex-wrap gap-2" role="tablist" aria-label="Origen de las fotos">
              {([['productos', 'Productos del catálogo'], ['biblioteca', 'Mi biblioteca'], ['subir', 'Subir fotos nuevas']] as Array<[Source, string]>).map(([key, label]) => (
                <button key={key} type="button" role="tab" aria-selected={source === key} onClick={() => setSource(key)}
                  className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${source === key ? 'border-brand bg-brand/10 text-ink' : 'border-line text-muted hover:text-ink'}`}>{label}</button>
              ))}
            </div>

            {source === 'productos' && (products.length ? (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                {products.map((product) => {
                  const active = selected.some((asset) => asset.productId === product.id)
                  return (
                    <li key={product.id}>
                      <button type="button" aria-pressed={active} disabled={loadingId === product.id || !product.imageUrls[0] || (!active && selected.length >= catalog.maxBatchItems)} onClick={() => void pickProduct(product)}
                        className={`relative block w-full overflow-hidden rounded-btn border-2 text-left disabled:opacity-50 ${active ? 'border-brand' : 'border-line hover:border-brand/40'}`}>
                        {product.imageUrls[0] ? <img src={product.imageUrls[0]} alt="" loading="lazy" className="aspect-square w-full bg-white object-cover" /> : <div className="aspect-square w-full grid place-items-center bg-white text-xs text-muted">Sin foto</div>}
                        {loadingId === product.id && <span className="absolute inset-0 grid place-items-center bg-white/70"><Loader2 size={18} className="animate-spin" /></span>}
                        {active && <CheckCircle2 size={20} className="absolute right-1.5 top-1.5 rounded-full bg-white text-brand" aria-hidden="true" />}
                        <span className="block truncate px-2 py-1.5 text-xs font-semibold text-ink">{product.name}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            ) : <p className="text-sm text-muted">Todavía no tienes productos. Sube fotos nuevas y, cuando las apruebes, podrás crear productos con ellas.</p>)}

            {source === 'biblioteca' && (originals.length ? (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                {originals.map((asset) => (
                  <li key={asset.id}>
                    <button type="button" aria-pressed={isSelected(asset.id)} disabled={!isSelected(asset.id) && selected.length >= catalog.maxBatchItems} onClick={() => toggle(asset)}
                      className={`relative block w-full overflow-hidden rounded-btn border-2 text-left disabled:opacity-50 ${isSelected(asset.id) ? 'border-brand' : 'border-line hover:border-brand/40'}`}>
                      <AssetImage id={asset.id} alt="" className="aspect-square w-full object-cover" />
                      {isSelected(asset.id) && <CheckCircle2 size={20} className="absolute right-1.5 top-1.5 rounded-full bg-white text-brand" aria-hidden="true" />}
                      <span className="block truncate px-2 py-1.5 text-xs font-semibold text-ink">{asset.productName || 'Sin producto'}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted">Tu biblioteca está vacía. Las fotos que elijas o subas quedan guardadas aquí para no volver a cargarlas.</p>)}

            {source === 'subir' && (
              <div className="space-y-2">
                <label className="btn-ghost cursor-pointer inline-flex">
                  {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />} Elegir fotos
                  <input type="file" multiple accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={uploading} onChange={(event) => { void uploadFiles(event.target.files); event.target.value = '' }} />
                </label>
                <p className="text-xs text-muted">JPG, PNG o WebP de hasta 5 MB. Se guardan como originales privados en tu biblioteca.</p>
              </div>
            )}

            {selected.length > 0 && (
              <ul className="flex flex-wrap gap-2 border-t border-line pt-4">
                {selected.map((asset) => (
                  <li key={asset.id} className="relative">
                    <AssetImage id={asset.id} alt={asset.productName || 'Foto seleccionada'} className="h-16 w-16 rounded-btn border border-line object-cover" />
                    <button type="button" aria-label="Quitar de la selección" disabled={working} onClick={() => toggle(asset)} className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-ink text-white"><X size={12} /></button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* 2 · Análisis */}
          {selected.length > 0 && (
            <section className="card p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-black text-ink">2. Analiza la calidad <span className="text-sm font-semibold text-muted">(opcional, sin costo)</span></h2>
                  <p className="text-sm text-muted mt-1">Se mide en tu navegador: resolución, luz, contraste y nitidez. Es una estimación para ayudarte a elegir.</p>
                </div>
                <button type="button" className="btn-ghost" disabled={analyzing} onClick={() => void analyze()}>{analyzing ? <Loader2 size={16} className="animate-spin" /> : <ScanSearch size={16} />} Analizar</button>
              </div>
              {Object.keys(quality).length > 0 && (
                <ul className="divide-y divide-line text-sm">
                  {selected.filter((asset) => quality[asset.id]).map((asset) => {
                    const info = quality[asset.id]!
                    const hint = suggestOperation(info)
                    return (
                      <li key={asset.id} className="flex gap-3 py-3">
                        <AssetImage id={asset.id} alt="" className="h-14 w-14 shrink-0 rounded-btn border border-line object-cover" />
                        <div className="min-w-0">
                          <p className="font-semibold text-ink">{asset.productName || 'Foto sin producto'} · {info.width}×{info.height}</p>
                          {info.issues.length ? <p className="text-muted">{info.issues.map((issue) => issue.message).join(' ')}</p> : <p className="text-emerald-700">Sin problemas evidentes.</p>}
                          {hint && <button type="button" className="font-semibold text-brand" onClick={() => void chooseOperation(hint.operation)}>{hint.reason}</button>}
                          {info.issues.some((issue) => issue.code === 'borrosa' || issue.code === 'baja_resolucion') && <p className="text-muted">Ninguna mejora recupera detalle que la foto no tiene: si puedes, toma otra foto.</p>}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          )}

          {/* 3 · Tipo de mejora */}
          {selected.length > 0 && (
            <section className="card p-6 space-y-5">
              <h2 className="text-lg font-black text-ink">3. Elige el tipo de mejora</h2>
              {(['A', 'B', 'C'] as const).map((key) => {
                const info = level(key)!
                return (
                  <div key={key} className="space-y-2">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="font-bold text-ink">{info.label} <span className="text-sm font-normal text-muted">· {info.description}</span></p>
                      <span className="text-sm font-semibold text-ink whitespace-nowrap">
                        {key === 'A' ? 'Gratis' : !info.available ? 'No disponible' : info.creditsPerPhoto === null ? 'Incluido en tu límite mensual de IA' : `${info.creditsPerPhoto} créditos por foto`}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {operations.filter((item) => item.level === key).map((item) => {
                        const enabled = item.available && info.available
                        return (
                          <button key={item.key} type="button" disabled={!enabled || working} aria-pressed={operation === item.key} title={item.note || item.description} onClick={() => void chooseOperation(item.key)}
                            className={`rounded-btn border px-3 py-2 text-left text-sm disabled:opacity-50 ${operation === item.key ? 'border-brand bg-brand/10' : 'border-line hover:border-brand/40'}`}>
                            <span className="block font-semibold text-ink">{item.label}{!item.available && ' · próximamente'}</span>
                            <span className="block text-xs text-muted max-w-[16rem]">{item.note || item.description}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
              <p className="text-xs text-muted">La IA procura conservar forma, colores, etiquetas y logotipos del producto, pero puede equivocarse. Compara siempre el antes y el después antes de aprobar.</p>
            </section>
          )}

          {/* 4 · Confirmación y progreso */}
          {chosen && selected.length > 0 && (
            <section className="card p-6 space-y-4">
              <h2 className="text-lg font-black text-ink">4. Confirma y procesa</h2>
              {chosen.runsIn === 'navegador' ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-ink">«{chosen.label}» en {selected.length} {selected.length === 1 ? 'foto' : 'fotos'}. Se hace en tu navegador: no usa IA ni créditos.</p>
                  <button type="button" className="btn-brand" disabled={working} onClick={() => void runBrowser()}>{working ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />} Aplicar</button>
                </div>
              ) : !batch && quote ? (
                <div className="space-y-3">
                  <dl className="grid gap-3 sm:grid-cols-3 text-sm">
                    <div><dt className="text-muted">Operación</dt><dd className="font-bold text-ink">{chosen.label} · {LEVEL_LABEL[quote.level]}</dd></div>
                    <div><dt className="text-muted">Costo</dt><dd className="font-bold text-ink">{quote.priceConfigured ? `${quote.count} × ${quote.creditsPerPhoto} = ${quote.totalCredits} créditos` : 'Sin créditos: usa tu límite mensual de IA'}</dd></div>
                    <div><dt className="text-muted">Tu saldo</dt><dd className="font-bold text-ink">{quote.balance} créditos</dd></div>
                  </dl>
                  {quote.paused && <p className="text-sm text-red-700">Esta función está pausada por la plataforma.</p>}
                  {!quote.enough && <p className="text-sm text-red-700">No te alcanzan los créditos para este lote. Elige menos fotos o <Link to="/admin/creditos" className="font-semibold underline">pide una recarga</Link>.</p>}
                  <p className="text-xs text-muted">Solo se cobra cada foto que salga bien. Si una falla, no cuesta y puedes reintentarla.</p>
                  <button type="button" className="btn-brand" disabled={!quote.enough || quote.paused || working} onClick={() => void confirmBatch()}><Coins size={16} /> Confirmar y mejorar {quote.count} {quote.count === 1 ? 'foto' : 'fotos'}</button>
                </div>
              ) : null}

              {progress && chosen.runsIn === 'navegador' && <Progress done={progress.done} total={progress.total} label="fotos editadas" />}
              {batch && (
                <div className="space-y-3">
                  <Progress done={batchDone} total={batch.total} label="fotos procesadas" />
                  <p className="text-sm text-muted">
                    {batch.counts.completado} listas · {batch.counts.fallido} con error · {batch.counts.cancelado} canceladas · {batch.creditsCharged} créditos cobrados.
                    {!batch.done && ' Puedes cerrar esta página: el lote sigue en segundo plano y los resultados quedan en tu biblioteca.'}
                  </p>
                  {!batch.done && <button type="button" className="btn-ghost" onClick={() => void cancel()}><X size={15} /> Cancelar lo que falta</button>}
                  {batch.done && !working && batch.counts.pendiente === 0 && <button type="button" className="btn-ghost" onClick={() => { setSelected([]); setOperation(''); resetPlan() }}>Empezar otro lote</button>}
                  {failedJobs.length > 0 && (
                    <ul className="divide-y divide-line text-sm">
                      {failedJobs.map((job) => (
                        <li key={job.id} className="flex items-center gap-3 py-2.5">
                          <AssetImage id={job.sourceAssetId} alt="" className="h-12 w-12 shrink-0 rounded-btn border border-line object-cover" />
                          <span className="flex-1 text-ink">{jobError(job.errorCode)}</span>
                          {job.attempts < 3 && !['NO_CREDITS', 'AI_DISABLED', 'AI_UNAVAILABLE', 'BUDGET_EXHAUSTED'].includes(job.errorCode || '') && <button type="button" className="btn-ghost" disabled={working} onClick={() => void retry(job.id)}><RefreshCw size={14} /> Reintentar</button>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </section>
          )}

          {/* 5 · Revisión */}
          {results.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-lg font-black text-ink">5. Revisa y aprueba</h2>
              <p className="text-sm text-muted">Arrastra el divisor para comparar. Nada cambia en tu catálogo hasta que apruebes cada foto; lo que no te guste, descártalo.</p>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {results.map((asset) => <ResultReview key={asset.id} asset={asset} operationLabels={labels} products={productOptions} onChange={(next) => setResults((current) => current.map((item) => item.id === next.id ? next : item))} />)}
              </div>
              <Link to="/admin/estudio-creativo/biblioteca" className="text-sm font-semibold text-brand inline-block">Ver todo en mi biblioteca</Link>
            </section>
          )}
        </>
      )}
    </div>
  )
}

function Progress({ done, total, label }: { done: number; total: number; label: string }) {
  const percent = total ? Math.round((done / total) * 100) : 0
  return (
    <div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label={label}>
        <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${percent}%` }} />
      </div>
      <p className="mt-1.5 text-sm font-semibold text-ink">{done} de {total} {label}</p>
    </div>
  )
}
