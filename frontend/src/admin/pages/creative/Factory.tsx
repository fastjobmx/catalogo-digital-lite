import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle, ArrowLeft, Check, Clapperboard, Copy, Download, Film, Image as ImageIcon, Images, Loader2, Palette, Pencil, Sparkles, Trash2, Wand2 } from 'lucide-react'
import { useAuth } from '../../../contexts/AuthContext'
import {
  ApiRequestError, creativePhotoApi, creativePiecesApi, getProducts,
  type CreativeCatalogApi, type CreativeCopyApi, type CreativePieceApi, type CreativePlanApi, type PieceKind, type ProductApi, type VideoAiQuoteApi,
} from '../../../services/api'
import { resolveImageUrl } from '../../../lib/imageSources'
import { drawPreview, ensureFont, exportImages, exportVideo, loadImages, prepareDesign, sceneFor, usesDesign, type ImageMap, type OutputType } from '../../../lib/creative/render'
import type { DesignOptions, PlanSpec } from '../../../lib/creative/scene'
import type { DesignContext } from '../../../lib/creative/design/compose'
import { ensureFonts } from '../../../lib/creative/design/fonts'
import { checkScene } from '../../../lib/creative/design/qa'
import { DESIGN_STYLES, STYLE_KEYS, detectSector, stylesOf, styleFonts } from '../../../lib/creative/design/styles'
import { DEFAULT_DESIGN, DesignPanel, QaPanel } from './DesignPanel'
import { assetBlob } from './AssetImage'
import { formatBytes } from './ResultReview'

type Mode = PieceKind | 'video_ia'
const MODES: Array<{ key: Mode; label: string; hint: string; icon: typeof ImageIcon }> = [
  { key: 'imagen', label: 'Imagen', hint: 'Una pieza lista para publicar. Sin costo.', icon: ImageIcon },
  { key: 'carrusel', label: 'Carrusel', hint: 'Una imagen por producto. Sin costo.', icon: Images },
  { key: 'video', label: 'Video automático', hint: 'Tus fotos con movimiento, nombre, precio y logo exactos. Sin costo.', icon: Film },
  { key: 'video_ia', label: 'Video con IA', hint: 'Una IA anima tu foto. Usa créditos.', icon: Sparkles },
]
const MAX_PRODUCTS = 6
const STATUS: Record<CreativePieceApi['status'], string> = { pendiente: 'Por revisar', aprobado: 'Aprobada', rechazado: 'Rechazada' }
const lines = (value: string) => value.split('\n').map((item) => item.trim()).filter(Boolean)
const message = (err: unknown, fallback: string) => (err instanceof ApiRequestError || err instanceof Error ? err.message || fallback : fallback)
const credits = (n: number) => (n === 0 ? 'Sin costo' : `${n} ${n === 1 ? 'crédito' : 'créditos'}`)

function Step({ n, title, children, hint }: { n: number; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="card p-5 space-y-3">
      <h2 className="flex items-center gap-2.5 text-base font-black text-ink"><span className="grid h-6 w-6 place-items-center rounded-full bg-brand text-xs font-black text-white">{n}</span>{title}</h2>
      {hint && <p className="text-sm text-muted">{hint}</p>}
      {children}
    </section>
  )
}
const choice = (active: boolean, disabled = false) => `rounded-xl border p-3 text-left transition ${active ? 'border-brand bg-brand/5 ring-1 ring-brand' : 'border-line bg-white hover:border-brand/40'} ${disabled ? 'opacity-55 cursor-not-allowed' : ''}`

/** Vista previa o archivo final de una pieza guardada (privado: se pide con la sesión). */
function PieceMedia({ piece, index = 0 }: { piece: CreativePieceApi; index?: number }) {
  const { token } = useAuth()
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!token || !piece.files[index]) return
    let objectUrl: string | null = null
    let cancelled = false
    creativePiecesApi.file(piece.id, index, token).then((blob) => { if (!cancelled) { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl) } }).catch(() => setUrl(null))
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [piece.id, index, token, piece.files])
  const file = piece.files[index]
  if (!file) return <div className="grid aspect-square place-items-center rounded-lg bg-line/40 text-xs text-muted">Sin archivo</div>
  if (!url) return <div className="grid aspect-square place-items-center rounded-lg bg-line/40"><Loader2 size={18} className="animate-spin text-muted" /></div>
  return file.contentType.startsWith('video/')
    ? <video src={url} controls playsInline muted loop className="max-h-80 w-full rounded-lg bg-black object-contain" />
    : <img src={url} alt="Pieza comercial" className="max-h-80 w-full rounded-lg border border-line object-contain" />
}

/** Fábrica de creativos: imágenes, carruseles y videos con productos y fotos reales de la tienda. */
export default function Factory() {
  const { token, isDemoSession } = useAuth()
  const [catalog, setCatalog] = useState<CreativeCatalogApi | null>(null)
  const [products, setProducts] = useState<ProductApi[]>([])
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<number[]>([])
  const [mode, setMode] = useState<Mode>('imagen')
  const [eligible, setEligible] = useState<Record<string, { ok: boolean; reason: string | null }>>({})
  const [template, setTemplate] = useState('')
  const [format, setFormat] = useState('cuadrado')
  const [quality, setQuality] = useState<'estandar' | 'alta'>('estandar')
  const [seconds, setSeconds] = useState(6)
  const [draft, setDraft] = useState<{ headline: string; description: string; benefits: string; cta: string; hashtags: string } | null>(null)
  const [plan, setPlan] = useState<CreativePlanApi<PlanSpec> | null>(null)
  const [media, setMedia] = useState<{ images: ImageMap; font: string; design: DesignContext | null; notes: string[] } | null>(null)
  // Motor de diseño publicitario: estilo, composición y personalización. Sin él, la composición clásica.
  const [useDesign, setUseDesign] = useState(true)
  const [designOpts, setDesignOpts] = useState<DesignOptions>(DEFAULT_DESIGN)
  const [output, setOutput] = useState<OutputType | 'auto'>('auto')
  const [slide, setSlide] = useState(0)
  const [replaces, setReplaces] = useState<string | null>(null)
  const [ai, setAi] = useState({ resolution: '720p', motion: 'acercamiento', seconds: 6 })
  const [quote, setQuote] = useState<VideoAiQuoteApi | null>(null)
  const [busy, setBusy] = useState('')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [pieces, setPieces] = useState<CreativePieceApi[] | null>(null)
  const [filter, setFilter] = useState<'pendiente' | 'aprobado'>('pendiente')
  const canvas = useRef<HTMLCanvasElement>(null)
  const saveKey = useRef('')

  const loadPieces = useCallback(async () => {
    if (!token) return
    try { setPieces((await creativePiecesApi.list(token, filter)).items) } catch { setPieces([]) }
  }, [token, filter])
  useEffect(() => { if (!isDemoSession) void loadPieces() }, [loadPieces, isDemoSession])
  useEffect(() => {
    if (!token || isDemoSession) return
    creativePiecesApi.catalog(token).then(setCatalog).catch((err) => setError(err instanceof ApiRequestError && err.status === 403 ? 'Solo el propietario o un administrador de la tienda pueden crear piezas.' : 'No se pudo cargar la fábrica de creativos.'))
    getProducts().then(setProducts).catch(() => setProducts([]))
  }, [token, isDemoSession])

  // Qué plantillas aplican de verdad a la selección.
  useEffect(() => {
    if (!token || isDemoSession) return
    let cancelled = false
    creativePiecesApi.eligibility(picked, token).then((result) => { if (!cancelled) setEligible(Object.fromEntries(result.templates.map((item) => [item.key, item]))) }).catch(() => { if (!cancelled) setEligible({}) })
    return () => { cancelled = true }
  }, [picked, token, isDemoSession])

  const reset = () => { setPlan(null); setMedia(null); setQuote(null); setNotice(''); setError(''); saveKey.current = '' }
  const kind: PieceKind = mode === 'video_ia' ? 'video' : mode
  const templates = useMemo(() => (catalog?.templates ?? []).filter((item) => item.kinds.includes(kind)), [catalog, kind])
  const chosenTemplate = templates.find((item) => item.key === template) ?? null
  const formats = useMemo(() => (catalog?.formats ?? []).filter((item) => (mode === 'video_ia' ? catalog!.videoAi.formats.includes(item.key) : kind !== 'video' || item.video)), [catalog, mode, kind])
  useEffect(() => { if (formats.length && !formats.some((item) => item.key === format)) setFormat(formats[0]!.key) }, [formats, format])
  useEffect(() => { if (chosenTemplate && !chosenTemplate.seconds.includes(seconds)) setSeconds(chosenTemplate.seconds[0]!) }, [chosenTemplate, seconds])
  useEffect(() => { if (template && (!chosenTemplate || eligible[template]?.ok === false)) setTemplate('') }, [template, chosenTemplate, eligible])

  const toggle = (id: number) => { reset(); setDraft(null); setPicked((current) => current.includes(id) ? current.filter((item) => item !== id) : current.length >= MAX_PRODUCTS ? current : [...current, id]) }
  const shown = useMemo(() => { const q = search.trim().toLowerCase(); return products.filter((product) => !q || product.name.toLowerCase().includes(q)).slice(0, 60) }, [products, search])
  const copyInput = (): Partial<CreativeCopyApi> | null => draft ? { headline: draft.headline, description: draft.description, benefits: lines(draft.benefits), cta: draft.cta, hashtags: draft.hashtags.split(/\s+/).filter(Boolean) } : null
  const fillDraft = (copy: CreativeCopyApi) => setDraft({ headline: copy.headline, description: copy.description, benefits: copy.benefits.join('\n'), cta: copy.cta, hashtags: copy.hashtags.join(' ') })
  const designed = useDesign && mode !== 'video_ia'
  const planInput = () => ({ kind, template, format, productIds: picked, quality, seconds: kind === 'video' ? seconds : null, copy: copyInput(), ...(designed ? { design: designOpts } : {}) })
  const priceLocked = template === 'oferta_aprobada'
  // Sector sugerido por las categorías y nombres reales de los productos elegidos; se aplica al cambiar la selección.
  const detected = useMemo(() => detectSector(products.filter((product) => picked.includes(product.id)).flatMap((product) => [product.categoryName ?? '', product.name])), [products, picked])
  useEffect(() => {
    if (!detected) return
    setDesignOpts((current) => (current.sector === detected ? current : { ...current, sector: detected, style: stylesOf(detected)[0]!, layout: DESIGN_STYLES[stylesOf(detected)[0]!].layouts[0] }))
  }, [detected])
  useEffect(() => { if (priceLocked && !designOpts.showPrice) setDesignOpts((current) => ({ ...current, showPrice: true })) }, [priceLocked, designOpts.showPrice])
  // La vista previa usa las opciones de diseño actuales sin volver a pedir el plan: el servidor las valida al guardar.
  const live = useMemo(() => (plan ? (plan.spec.design ? { ...plan.spec, design: designOpts } : plan.spec) : null), [plan, designOpts])
  const qa = useMemo(() => {
    if (!live || !media?.design || !usesDesign(live)) return []
    return Array.from({ length: live.slides }, (_, index) => checkScene(sceneFor(live, index, media.design), live, index, media.design!))
  }, [live, media])
  const qaBlocked = qa.some((report) => !report.ok)

  /** Pide el plan al servidor (datos verificados) y dibuja la vista previa. */
  const prepare = async () => {
    if (!token || !template) return
    setBusy('preview'); setError(''); setNotice('')
    try {
      const planned = await creativePiecesApi.plan<PlanSpec>(planInput(), token)
      const loaded = await loadImages(planned.spec, (id) => assetBlob(id, token))
      const font = await ensureFont(planned.spec.brand.font || 'Inter')
      // Análisis de la foto (fondo, encuadre, colores) y recorte local; tipografías de todos los estilos para las miniaturas.
      const prepared = planned.spec.design ? await prepareDesign(planned.spec, loaded.images) : null
      if (prepared) await ensureFonts(STYLE_KEYS.flatMap(styleFonts))
      setPlan(planned); setMedia({ images: loaded.images, font, design: prepared?.design ?? null, notes: prepared?.notes ?? [] }); setSlide(0)
      if (!draft) fillDraft(planned.copy)
      if (loaded.missingLogo) setNotice('No se pudo leer el logo del Brand Kit: la pieza saldrá sin logo. Súbelo de nuevo en el Brand Kit si quieres incluirlo.')
      if (planned.reusable && !replaces) setNotice('Ya tienes una pieza con esta misma configuración. Puedes usarla en «Tus piezas» en lugar de crear otra.')
    } catch (err) { setPlan(null); setError(message(err, 'No se pudo preparar la vista previa.')) }
    finally { setBusy('') }
  }

  // Vista previa: imagen fija o animación en bucle del video.
  useEffect(() => {
    const target = canvas.current
    if (!target || !live || !media) return
    const spec = live
    const width = Math.min(480, spec.width)
    // Lienzo al doble de resolución para que la vista previa se vea nítida en pantallas densas.
    target.width = width * 2
    target.height = Math.round(width * 2 * spec.height / spec.width)
    target.style.width = `${width}px`
    if (spec.kind !== 'video') { drawPreview(target, spec, media.images, media.font, slide, null, media.design); return }
    let frame = 0
    const started = performance.now()
    const tick = () => { drawPreview(target, spec, media.images, media.font, 0, ((performance.now() - started) / 1000) % ((spec.seconds || 6) + 1), media.design); frame = requestAnimationFrame(tick) }
    tick()
    return () => cancelAnimationFrame(frame)
  }, [live, media, slide])

  const create = async () => {
    if (!token || !plan || !media || !live) return
    if (qaBlocked) { setError('El control de calidad encontró problemas: cambia de composición o de estilo antes de crear la pieza.'); return }
    setBusy('save'); setError(''); setProgress(0)
    if (!saveKey.current) saveKey.current = `pieza-${crypto.randomUUID()}`
    try {
      const spec = live
      let files: Blob[]
      let durationMs: number | undefined
      if (spec.kind === 'video') { const video = await exportVideo(spec, media.images, media.font, setProgress, media.design); files = [video.blob]; durationMs = video.durationMs } else files = await exportImages(spec, media.images, media.font, media.design, output === 'auto' ? null : output)
      const saved = await creativePiecesApi.save({ ...planInput(), ...(replaces ? { replaces } : {}), ...(durationMs ? { durationMs } : {}) }, files, saveKey.current, token)
      setNotice(saved.reused ? 'Ya existía una pieza idéntica: no se creó otra.' : 'Pieza creada. Revísala abajo y apruébala cuando esté lista.')
      setReplaces(null); setPlan(null); setMedia(null); saveKey.current = ''
      setFilter('pendiente'); void loadPieces()
    } catch (err) { setError(message(err, 'No se pudo crear la pieza.')) }
    finally { setBusy('') }
  }

  const suggest = async () => {
    if (!token || !template) return
    setBusy('copy'); setError('')
    try {
      const result = await creativePiecesApi.suggestCopy({ template, productIds: picked, kind, format }, `texto-${crypto.randomUUID()}`, token)
      fillDraft(result.copy); setPlan(null)
      setNotice(result.rejected.length ? 'La IA propuso datos que tu catálogo no respalda (cifras o promesas): esos campos quedaron con el texto base.' : `Textos sugeridos con IA (${credits(result.credits).toLowerCase()}). Revísalos antes de usarlos.`)
    } catch (err) { setError(message(err, 'La IA no pudo sugerir textos. No se descontaron créditos.')) }
    finally { setBusy('') }
  }

  // ---- Video con IA ----
  const aiInput = () => ({ productId: picked[0]!, format, seconds: ai.seconds, resolution: ai.resolution, motion: ai.motion })
  const quoteAi = async () => {
    if (!token || picked.length !== 1) return
    setBusy('quote'); setError('')
    try { setQuote(await creativePiecesApi.quoteVideoAi(aiInput(), token)) } catch (err) { setError(message(err, 'No se pudo calcular el costo.')) } finally { setBusy('') }
  }
  const generateAi = async () => {
    if (!token || !quote) return
    setBusy('ai'); setError('')
    if (!saveKey.current) saveKey.current = `video-${crypto.randomUUID()}`
    try {
      const created = await creativePiecesApi.createVideoAi({ ...aiInput(), confirmCredits: quote.totalCredits }, saveKey.current, token)
      if (created.reused) setNotice('Ya tenías un video con esta misma configuración: no se generó otro ni se cobraron créditos.')
      else if (created.job) {
        const job = await creativePhotoApi.runJob(created.job.id, token)
        if (job.status === 'fallido') throw new Error('La IA no pudo generar el video. No se descontaron créditos.')
        setNotice('Video generado. Revísalo abajo antes de aprobarlo.')
      }
      setQuote(null); saveKey.current = ''; setFilter('pendiente'); void loadPieces()
    } catch (err) { setError(message(err, 'No se pudo generar el video.')); if (err instanceof ApiRequestError) setQuote(null) }
    finally { setBusy('') }
  }

  // ---- Revisión ----
  const act = async (piece: CreativePieceApi, action: 'approve' | 'reject') => {
    if (!token) return
    try { await creativePiecesApi[action](piece.id, token); void loadPieces() } catch (err) { setError(message(err, 'No se pudo completar la acción.')) }
  }
  const download = async (piece: CreativePieceApi) => {
    if (!token) return
    for (const file of piece.files) {
      const url = URL.createObjectURL(await creativePiecesApi.file(piece.id, file.index, token))
      const link = document.createElement('a')
      link.href = url
      link.download = `${piece.template}-${piece.format}${piece.files.length > 1 ? `-${file.index + 1}` : ''}.${file.contentType.split('/')[1]!.replace('jpeg', 'jpg')}`
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 2000)
    }
  }
  const edit = (piece: CreativePieceApi) => {
    setMode(piece.kind); setPicked(piece.productIds); setTemplate(piece.template); setFormat(piece.format)
    const spec = piece.spec as Partial<PlanSpec>
    if (spec.quality) setQuality(spec.quality)
    if (spec.seconds) setSeconds(spec.seconds)
    if (piece.copy.headline !== undefined) fillDraft(piece.copy as CreativeCopyApi)
    if (spec.design) { setUseDesign(true); setDesignOpts({ ...DEFAULT_DESIGN, ...spec.design }) } else setUseDesign(false)
    setReplaces(piece.id); reset(); window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const attach = async (piece: CreativePieceApi, value: string) => {
    if (!token) return
    try { await creativePiecesApi.attachCampaign(piece.id, value ? Number(value) : null, token); void loadPieces() } catch (err) { setError(message(err, 'No se pudo asociar la campaña.')) }
  }

  const label = (key: string) => catalog?.templates.find((item) => item.key === key)?.label ?? (key === 'video_ia' ? 'Video con IA' : key)
  const formatLabel = (key: string) => catalog?.formats.find((item) => item.key === key)?.label ?? key
  const ready = mode === 'video_ia' ? picked.length === 1 : Boolean(template)

  if (isDemoSession) return <p className="card p-6 text-sm text-muted">La fábrica de creativos no está disponible en la demostración.</p>
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <Link to="/admin/estudio-creativo" className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink mb-3"><ArrowLeft size={15} /> Estudio Creativo IA</Link>
        <div className="flex items-center gap-2 mb-2"><Clapperboard size={15} className="text-brand" /><span className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand/70">Estudio Creativo IA</span></div>
        <h1 className="text-2xl font-black text-ink">Fábrica de creativos</h1>
        <p className="text-sm text-muted mt-1">Imágenes, carruseles y videos con tus productos reales. El nombre, el precio y tu logo se dibujan tal cual están en tu catálogo.</p>
      </div>
      {error && <p role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"><AlertCircle size={16} className="mt-0.5 shrink-0" />{error}</p>}
      {notice && <p role="status" className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"><Check size={16} className="mt-0.5 shrink-0" />{notice}</p>}
      {replaces && <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Estás editando una pieza pendiente: al crear la nueva versión, la anterior se retira. <button className="font-bold underline" onClick={() => setReplaces(null)}>Cancelar edición</button></p>}

      <Step n={1} title="Producto" hint={`Elige hasta ${MAX_PRODUCTS}. Para piezas de marca o invitación al catálogo puedes no elegir ninguno.`}>
        <input className="input-field w-full" placeholder="Buscar producto" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Buscar producto" />
        <ul className="grid max-h-72 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((product) => {
            const active = picked.includes(product.id)
            const image = resolveImageUrl(product.imageUrls[0])
            return (
              <li key={product.id}>
                <button type="button" aria-pressed={active} onClick={() => toggle(product.id)} className={`${choice(active)} flex w-full items-center gap-3`}>
                  {image ? <img src={image} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" loading="lazy" /> : <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-line/50 text-[10px] text-muted">Sin foto</span>}
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{product.name}</span>
                  {active && <Check size={16} className="shrink-0 text-brand" />}
                </button>
              </li>
            )
          })}
        </ul>
        {!products.length && <p className="text-sm text-muted">Aún no tienes productos activos en el catálogo.</p>}
      </Step>

      <Step n={2} title="Tipo de contenido">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {MODES.map((item) => {
            const off = item.key === 'video_ia' && !catalog?.videoAi.available
            return (
              <button key={item.key} type="button" disabled={off} aria-pressed={mode === item.key} onClick={() => { setMode(item.key); reset() }} className={choice(mode === item.key, off)}>
                <span className="flex items-center gap-2 text-sm font-bold text-ink"><item.icon size={16} className="text-brand" />{item.label}</span>
                <span className="mt-1 block text-xs text-muted">{off ? catalog?.videoAi.reason ?? 'No disponible.' : item.hint}</span>
              </button>
            )
          })}
        </div>
      </Step>

      {mode === 'video_ia' ? (
        <Step n={3} title="Movimiento" hint={catalog?.videoAi.disclaimer}>
          {picked.length !== 1 && <p className="text-sm text-amber-700">Elige exactamente un producto con foto.</p>}
          <div className="grid gap-2 sm:grid-cols-3">
            {catalog?.videoAi.motions.map((item) => (
              <button key={item.key} type="button" aria-pressed={ai.motion === item.key} onClick={() => { setAi({ ...ai, motion: item.key }); setQuote(null) }} className={choice(ai.motion === item.key)}>
                <span className="text-sm font-bold text-ink">{item.label}</span><span className="mt-1 block text-xs text-muted">{item.description}</span>
              </button>
            ))}
          </div>
          <p className="text-xs text-muted">No se ofrecen giros ni cambios de ángulo: la IA tendría que inventar partes del producto que tu foto no muestra.</p>
        </Step>
      ) : (
        <Step n={3} title="Plantilla" hint="Solo se pueden usar las plantillas cuyo dato es cierto en tu catálogo.">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {templates.map((item) => {
              const state = eligible[item.key]
              const off = state ? !state.ok : true
              return (
                <button key={item.key} type="button" disabled={off} aria-pressed={template === item.key} onClick={() => { setTemplate(item.key); setDraft(null); reset() }} className={choice(template === item.key, off)}>
                  <span className="text-sm font-bold text-ink">{item.label}</span>
                  <span className="mt-1 block text-xs text-muted">{item.description}</span>
                  {off && state?.reason && <span className="mt-1.5 block text-xs font-semibold text-amber-700">Requiere: {state.reason}</span>}
                </button>
              )
            })}
          </div>
        </Step>
      )}

      <Step n={4} title="Formato">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {formats.map((item) => (
            <button key={item.key} type="button" aria-pressed={format === item.key} onClick={() => { setFormat(item.key); reset() }} className={choice(format === item.key)}>
              <span className="text-sm font-bold text-ink">{item.label} <span className="font-semibold text-muted">· {item.ratio}</span></span>
              <span className="mt-1 block text-xs text-muted">{item.width} × {item.height} px · {item.use}</span>
            </button>
          ))}
        </div>
      </Step>

      {mode !== 'video_ia' && (
        <Step n={5} title="Diseño" hint="Estilo, composición y colores. Las miniaturas usan tu foto y tus datos reales.">
          <div className="flex flex-wrap gap-2">
            {([[true, 'Diseño publicitario', 'Estilos profesionales con variantes. Sin costo.'], [false, 'Clásico', 'La composición sencilla de siempre.']] as const).map(([value, title, hint]) => (
              <button key={title} type="button" aria-pressed={useDesign === value} onClick={() => { setUseDesign(value); reset() }} className={`${choice(useDesign === value)} max-w-xs`}>
                <span className="flex items-center gap-2 text-sm font-bold text-ink">{value && <Palette size={15} className="text-brand" />}{title}</span><span className="mt-1 block text-xs text-muted">{hint}</span>
              </button>
            ))}
          </div>
          {useDesign && (template === 'antes_despues' || !picked.length)
            ? <p className="text-xs text-muted">Esta plantilla usa la composición clásica.</p>
            : useDesign && <DesignPanel spec={live} images={media?.images ?? null} design={media?.design ?? null} notes={media?.notes ?? []} options={designOpts} onChange={setDesignOpts} output={output} onOutput={setOutput} kind={kind} priceLocked={priceLocked} brandColors={plan?.spec.brand.colors ?? []} detected={detected} hasOffer={Boolean(plan?.spec.products.some((product) => product.compareAtText))} />}
          {useDesign && !media?.design && picked.length > 0 && template !== 'antes_despues' && <p className="text-xs text-muted">Pulsa «Ver vista previa» para ver las miniaturas con tu producto.</p>}
        </Step>
      )}

      {mode !== 'video_ia' && (
        <Step n={6} title="Texto" hint="El precio no se escribe aquí: se toma de tu catálogo y se dibuja exacto.">
          {draft ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-bold text-ink">Titular<input className="input-field mt-1 w-full" maxLength={60} value={draft.headline} onChange={(e) => { setDraft({ ...draft, headline: e.target.value }); setPlan(null) }} /></label>
              <label className="text-xs font-bold text-ink">Llamada a la acción<input className="input-field mt-1 w-full" maxLength={40} value={draft.cta} onChange={(e) => { setDraft({ ...draft, cta: e.target.value }); setPlan(null) }} /></label>
              <label className="text-xs font-bold text-ink sm:col-span-2">Descripción<textarea className="input-field mt-1 w-full" rows={2} maxLength={220} value={draft.description} onChange={(e) => { setDraft({ ...draft, description: e.target.value }); setPlan(null) }} /></label>
              <label className="text-xs font-bold text-ink">Beneficios (uno por línea, máx. 4)<textarea className="input-field mt-1 w-full" rows={3} value={draft.benefits} onChange={(e) => { setDraft({ ...draft, benefits: e.target.value }); setPlan(null) }} /></label>
              <label className="text-xs font-bold text-ink">Hashtags<textarea className="input-field mt-1 w-full" rows={3} value={draft.hashtags} onChange={(e) => { setDraft({ ...draft, hashtags: e.target.value }); setPlan(null) }} /></label>
            </div>
          ) : <p className="text-sm text-muted">Al preparar la vista previa se proponen textos con los datos de tu catálogo. Después puedes editarlos.</p>}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn-ghost py-1.5 text-xs" disabled={!template || busy !== ''} onClick={suggest}>{busy === 'copy' ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />} Sugerir textos con IA</button>
            <span className="text-xs text-muted">Opcional. La IA solo redacta con la ficha del producto; no recibe ni escribe precios.</span>
          </div>
          {plan && (
            <div className="grid gap-3 sm:grid-cols-3">
              {([['Versión corta', plan.copy.short], ['WhatsApp', plan.copy.whatsapp], ['Instagram y Facebook', plan.copy.social]] as const).map(([name, value]) => (
                <div key={name} className="rounded-xl border border-line bg-white p-3">
                  <div className="mb-1 flex items-center justify-between gap-2"><span className="text-xs font-bold text-ink">{name}</span>
                    <button type="button" className="text-xs font-semibold text-brand inline-flex items-center gap-1" onClick={() => void navigator.clipboard?.writeText(value)}><Copy size={12} /> Copiar</button></div>
                  <p className="whitespace-pre-wrap break-words text-xs text-muted">{value}</p>
                </div>
              ))}
            </div>
          )}
        </Step>
      )}

      <Step n={mode === 'video_ia' ? 5 : 7} title="Calidad">
        {mode === 'video_ia' ? (
          <div className="flex flex-wrap gap-3">
            <label className="text-xs font-bold text-ink">Duración<select className="input-field mt-1 block" value={ai.seconds} onChange={(e) => { setAi({ ...ai, seconds: Number(e.target.value) }); setQuote(null) }}>{catalog?.videoAi.seconds.map((value) => <option key={value} value={value}>{value} segundos</option>)}</select></label>
            <label className="text-xs font-bold text-ink">Resolución<select className="input-field mt-1 block" value={ai.resolution} onChange={(e) => { setAi({ ...ai, resolution: e.target.value }); setQuote(null) }}>{catalog?.videoAi.resolutions.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
          </div>
        ) : (
          <div className="flex flex-wrap gap-3">
            {catalog?.qualities.map((item) => (
              <button key={item.key} type="button" aria-pressed={quality === item.key} onClick={() => { setQuality(item.key); reset() }} className={`${choice(quality === item.key)} max-w-xs`}>
                <span className="text-sm font-bold text-ink">{item.label}</span><span className="mt-1 block text-xs text-muted">{item.description}</span>
              </button>
            ))}
            {kind === 'video' && chosenTemplate && (
              <label className="text-xs font-bold text-ink">Duración<select className="input-field mt-1 block" value={seconds} onChange={(e) => { setSeconds(Number(e.target.value)); reset() }}>{chosenTemplate.seconds.map((value) => <option key={value} value={value}>{value} segundos</option>)}</select></label>
            )}
          </div>
        )}
      </Step>

      <Step n={mode === 'video_ia' ? 6 : 8} title="Costo">
        {(() => {
          const cost = mode === 'video_ia' ? quote?.cost : plan?.cost ?? { composicionConvencional: 0, imagenGenerativa: 0, videoGenerativo: 0, total: 0 }
          if (!cost) return <button type="button" className="btn-ghost" disabled={picked.length !== 1 || busy !== ''} onClick={quoteAi}>{busy === 'quote' && <Loader2 size={15} className="animate-spin" />} Calcular costo</button>
          return (
            <dl className="max-w-md divide-y divide-line text-sm">
              <div className="flex justify-between py-1.5"><dt className="text-muted">Composición convencional</dt><dd className="font-semibold text-ink">{credits(cost.composicionConvencional)}</dd></div>
              <div className="flex justify-between py-1.5"><dt className="text-muted">Imagen generativa</dt><dd className="font-semibold text-ink">{credits(cost.imagenGenerativa)}</dd></div>
              <div className="flex justify-between py-1.5"><dt className="text-muted">Video generativo{mode === 'video_ia' && quote ? ` (${quote.creditsPerSecond} por segundo × ${quote.seconds} s)` : ''}</dt><dd className="font-semibold text-ink">{credits(cost.videoGenerativo)}</dd></div>
              <div className="flex justify-between py-2"><dt className="font-bold text-ink">Total</dt><dd className="font-black text-ink">{credits(cost.total)}</dd></div>
              {mode === 'video_ia' && quote && <p className={`pt-2 text-xs ${quote.enough ? 'text-muted' : 'font-semibold text-red-700'}`}>Tu saldo: {quote.balance} créditos.{quote.enough ? '' : ' No alcanza: pide una recarga en «Créditos IA».'}</p>}
            </dl>
          )
        })()}
      </Step>

      <Step n={mode === 'video_ia' ? 7 : 9} title="Confirmación">
        {mode === 'video_ia' ? (
          <button type="button" className="btn-brand" disabled={!quote || !quote.available || !quote.enough || busy !== ''} onClick={generateAi}>
            {busy === 'ai' ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />} {busy === 'ai' ? 'Generando (puede tardar un par de minutos)…' : quote ? `Generar video (${credits(quote.totalCredits).toLowerCase()})` : 'Calcula el costo primero'}
          </button>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-ghost" disabled={!ready || busy !== ''} onClick={prepare}>{busy === 'preview' && <Loader2 size={15} className="animate-spin" />} {plan ? 'Actualizar vista previa' : 'Ver vista previa'}</button>
              <button type="button" className="btn-brand" disabled={!plan || !media || busy !== '' || qaBlocked} onClick={create}>{busy === 'save' ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} {busy === 'save' ? (kind === 'video' ? `Exportando video ${Math.round(progress * 100)}%` : 'Creando…') : 'Crear pieza (sin costo)'}</button>
            </div>
            {plan && media && (
              <div className="space-y-2">
                <canvas ref={canvas} className="max-w-full rounded-xl border border-line shadow-sm" aria-label="Vista previa de la pieza" />
                <QaPanel reports={qa} />
                {plan.spec.kind === 'carrusel' && plan.spec.slides > 1 && (
                  <div className="flex gap-1.5">{Array.from({ length: plan.spec.slides }, (_, index) => <button key={index} type="button" aria-pressed={slide === index} onClick={() => setSlide(index)} className={`h-8 w-8 rounded-lg text-xs font-bold ${slide === index ? 'bg-brand text-white' : 'bg-line/60 text-ink'}`}>{index + 1}</button>)}</div>
                )}
                <p className="text-xs text-muted">Tamaño final: {plan.spec.width} × {plan.spec.height} px{plan.spec.kind === 'video' ? ` · ${plan.spec.seconds} s · MP4` : ` · ${(output === 'auto' ? (plan.spec.quality === 'alta' ? 'png' : 'jpeg') : output).replace('jpeg', 'jpg').toUpperCase()}`}. Se compone en tu equipo, sin IA.</p>
              </div>
            )}
          </div>
        )}
      </Step>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-black text-ink">Tus piezas</h2>
          <div className="flex gap-1.5">{(['pendiente', 'aprobado'] as const).map((key) => <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)} className={`rounded-full px-3 py-1 text-xs font-bold ${filter === key ? 'bg-ink text-white' : 'bg-line/60 text-ink'}`}>{key === 'pendiente' ? 'Por revisar' : 'Aprobadas'}</button>)}</div>
        </div>
        {pieces === null ? <Loader2 className="animate-spin text-muted" size={20} /> : !pieces.length ? <p className="card p-5 text-sm text-muted">{filter === 'pendiente' ? 'No hay piezas por revisar.' : 'Aún no has aprobado piezas.'}</p> : (
          <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {pieces.map((piece) => (
              <li key={piece.id} className="card space-y-3 p-4">
                <PieceMedia piece={piece} />
                {piece.files.length > 1 && <p className="text-xs text-muted">Carrusel de {piece.files.length} imágenes (se muestra la primera).</p>}
                <div>
                  <p className="text-sm font-bold text-ink">{label(piece.template)} · {formatLabel(piece.format)}</p>
                  <p className="text-xs text-muted">{STATUS[piece.status]} · {piece.files[0] ? `${piece.files[0].width} × ${piece.files[0].height} px · ${formatBytes(piece.files.reduce((sum, file) => sum + file.bytes, 0))}` : ''} · {credits(piece.credits)}</p>
                  {piece.mode === 'video_ia' && <p className="mt-1 text-xs font-semibold text-amber-700">Generado con IA{piece.model ? ` (${piece.model})` : ''}: es una interpretación de tu foto, no una vista real del producto.</p>}
                  {piece.campaignName && <p className="mt-1 text-xs text-muted">Campaña: {piece.campaignName}</p>}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {piece.status === 'pendiente' && <button type="button" className="btn-brand py-1.5 text-xs" onClick={() => void act(piece, 'approve')}><Check size={14} /> Aceptar</button>}
                  {piece.status === 'pendiente' && piece.mode === 'convencional' && <button type="button" className="btn-ghost py-1.5 text-xs" onClick={() => edit(piece)}><Pencil size={14} /> Editar texto</button>}
                  <button type="button" className="btn-ghost py-1.5 text-xs" onClick={() => void download(piece)}><Download size={14} /> Descargar</button>
                  <button type="button" className="btn-ghost py-1.5 text-xs" onClick={() => { if (window.confirm('¿Rechazar esta pieza? Su archivo se borra. Tus fotos y productos no cambian.')) void act(piece, 'reject') }}><Trash2 size={14} /> Rechazar</button>
                </div>
                {piece.status === 'aprobado' && (
                  catalog?.campaigns.length
                    ? <label className="block text-xs font-bold text-ink">Asociar a campaña<select className="input-field mt-1 w-full" value={piece.campaignId ?? ''} onChange={(e) => void attach(piece, e.target.value)}><option value="">Sin campaña</option>{catalog.campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select></label>
                    : <p className="text-xs text-muted">Aún no tienes campañas para asociar esta pieza.</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
