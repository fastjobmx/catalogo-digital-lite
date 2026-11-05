import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AlertCircle, Check, Clock, Eye, ImagePlus, Loader2, Pencil, Plus, Rocket, Share2, Trash2, X } from 'lucide-react'
import { trialApi, type TrialColors, type TrialConfig, type TrialOrder, type TrialProduct, type TrialTemplate, type TrialView } from '../services/api'
import { formatMoney } from '../lib/format'
import { prepareProductPhoto } from '../lib/imageResize'
import { parseMoney } from '../lib/import/mapping'
import { PLATFORM_BRAND } from '../lib/platformBrand'
import TrialPreview, { type PreviewData } from './trial/TrialPreview'
import ActivationDialog, { salesLink } from './trial/ActivationDialog'

const tokenKey = (id: string) => `catalogo-lite:trial:${id}`
const readToken = (id: string) => { try { return localStorage.getItem(tokenKey(id)) } catch { return null } }
const writeToken = (id: string, token: string | null) => { try { if (token) localStorage.setItem(tokenKey(id), token); else localStorage.removeItem(tokenKey(id)) } catch { /* private mode */ } }
const dateLabel = (iso: string) => new Date(iso).toLocaleString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' })
const newId = () => `p-${crypto.randomUUID().slice(0, 12)}`

export const TEMPLATES: Array<{ key: TrialTemplate; name: string; hint: string }> = [
  { key: 'clasica', name: 'Clásica', hint: 'Cuadrícula de productos' },
  { key: 'boutique', name: 'Boutique', hint: 'Elegante y aireada' },
  { key: 'stories', name: 'Stories', hint: 'Vertical, como historias' },
]
const SWATCHES: TrialColors[] = [
  { primary: '#03301f', accent: '#cdf53f' }, { primary: '#16181d', accent: '#f5a524' }, { primary: '#763b4c', accent: '#e8b4b8' },
  { primary: '#1d4ed8', accent: '#38bdf8' }, { primary: '#365c42', accent: '#d9a441' }, { primary: '#8a2ff5', accent: '#ffd23f' },
]

function useNoIndex() {
  useEffect(() => {
    const meta = document.createElement('meta')
    meta.name = 'robots'; meta.content = 'noindex, nofollow'
    document.head.appendChild(meta)
    return () => { meta.remove() }
  }, [])
}

/** Remaining time, refreshed every 30 seconds. */
function useRemaining(iso: string | undefined) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(timer) }, [])
  if (!iso) return { ms: 0, label: '' }
  const ms = Math.max(0, Date.parse(iso) - now)
  const minutes = Math.floor(ms / 60_000)
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const label = ms <= 0 ? 'Vencida' : days ? `${days} d ${hours} h` : hours ? `${hours} h ${minutes % 60} min` : `${Math.max(1, minutes)} min`
  return { ms, label }
}

/** Mini-store trial without an account: temporary, unpublished and without orders. */
export default function TrialPage() {
  useNoIndex()
  const { id } = useParams()
  return id ? <TrialStore key={id} id={id} /> : <TrialStart />
}

function BrandHeader() {
  return (
    <a href={PLATFORM_BRAND.siteUrl} className="inline-flex items-center" aria-label={`${PLATFORM_BRAND.name}: ir al sitio`}>
      <img src={PLATFORM_BRAND.logo} width={PLATFORM_BRAND.logoSize.width} height={PLATFORM_BRAND.logoSize.height} alt={PLATFORM_BRAND.name} className="h-auto w-[150px] rounded-lg" />
    </a>
  )
}

function TrialStart() {
  const navigate = useNavigate()
  const [config, setConfig] = useState<TrialConfig | null>(null)
  const [name, setName] = useState('')
  const [template, setTemplate] = useState<TrialTemplate>('clasica')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { trialApi.config().then(setConfig).catch(() => setConfig(null)) }, [])
  const templates = TEMPLATES.filter((item) => !config || config.templates.includes(item.key))

  const start = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true); setError(null)
    try {
      const trial = await trialApi.create(name.trim(), template)
      writeToken(trial.id, trial.editToken)
      navigate(`/prueba/${trial.id}`)
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo crear la prueba.') }
    finally { setBusy(false) }
  }

  return (
    <main className="min-h-screen bg-[#f7f8f3] px-4 py-8 text-[#03301f] sm:py-12">
      <div className="mx-auto max-w-2xl space-y-8">
        <BrandHeader />
        <header className="space-y-3">
          <p className="inline-block rounded-full bg-[#cdf53f] px-3 py-1 text-xs font-black uppercase tracking-[0.18em]">Gratis · sin registro</p>
          <h1 className="text-3xl font-black leading-[1.1] sm:text-[2.6rem]">Arma tu mini tienda de prueba en minutos</h1>
          <p className="text-[17px] leading-relaxed text-[#03301f]/80">
            Ponle tu nombre, tu logo y tus colores, sube hasta {config?.maxProducts ?? 7} productos con foto y compártela con tus clientes.
            {config?.ordersEnabled !== false && <> Agrega tu WhatsApp y recibe pedidos reales.</>} No te pedimos correo ni contraseña.
            La prueba dura {Math.round((config?.durationHours ?? 168) / 24)} días.
          </p>
        </header>
        {config && !config.enabled ? (
          <p role="alert" className="rounded-2xl bg-white p-5 font-semibold">Las tiendas de prueba no están disponibles en este momento. Vuelve a intentarlo más tarde.</p>
        ) : (
          <form onSubmit={start} className="space-y-6 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5 sm:p-7">
            <label className="block space-y-2"><span className="text-sm font-bold">Nombre de tu negocio</span>
              <input className="w-full rounded-xl border border-[#cfd5cf] px-4 py-3 text-[16px] outline-none focus:border-[#03301f] focus:ring-2 focus:ring-[#cdf53f]" required minLength={2} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej.: Dulce Hogar Deco" />
            </label>
            <fieldset className="space-y-2"><legend className="text-sm font-bold">Plantilla <span className="font-normal text-[#03301f]/60">(la puedes cambiar después)</span></legend>
              <div className="grid grid-cols-3 gap-2">
                {templates.map((item) => (
                  <label key={item.key} className={`cursor-pointer rounded-2xl border-2 p-3 text-center transition-colors ${template === item.key ? 'border-[#03301f] bg-[#cdf53f]/30' : 'border-[#e3e7e1] hover:border-[#03301f]/40'}`}>
                    <input type="radio" name="template" className="sr-only" checked={template === item.key} onChange={() => setTemplate(item.key)} />
                    <b className="block text-sm">{item.name}</b><span className="block text-[11px] text-[#03301f]/60">{item.hint}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            {error && <p role="alert" className="flex items-center gap-2 text-sm font-semibold text-red-700"><AlertCircle size={16} />{error}</p>}
            <button type="submit" disabled={busy} className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#03301f] px-6 py-3.5 text-[16px] font-black text-[#cdf53f] disabled:opacity-60 sm:w-auto">{busy && <Loader2 size={16} className="animate-spin" />} Crear mi tienda de prueba</button>
          </form>
        )}
      </div>
    </main>
  )
}

type Draft = TrialProduct & { priceText: string; uploading?: boolean }
const toDraft = (product: TrialProduct): Draft => ({ ...product, priceText: product.price === null ? '' : String(product.price) })
const toProduct = (draft: Draft): TrialProduct => ({ id: draft.id, name: draft.name.trim(), description: draft.description.trim(), imageUrl: draft.imageUrl, price: draft.priceText.trim() ? Math.round(parseMoney(draft.priceText) ?? NaN) : null })
const priceInvalid = (draft: Draft) => Boolean(draft.priceText.trim()) && !Number.isFinite(toProduct(draft).price as number)

function TrialStore({ id }: { id: string }) {
  const navigate = useNavigate()
  const [token] = useState(() => readToken(id))
  const [trial, setTrial] = useState<TrialView | null>(null)
  const [missing, setMissing] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [template, setTemplate] = useState<TrialTemplate>('clasica')
  const [colors, setColors] = useState<TrialColors>(SWATCHES[0]!)
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [whatsapp, setWhatsapp] = useState('')
  const [orders, setOrders] = useState<TrialOrder[]>([])
  const [logoBusy, setLogoBusy] = useState(false)
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [revision, setRevision] = useState(0)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [message, setMessage] = useState<{ tone: 'error' | 'ok'; text: string } | null>(null)
  const [tab, setTab] = useState<'editar' | 'vista'>('editar')
  const [activating, setActivating] = useState(false)
  const [finished, setFinished] = useState(false)
  const photoInput = useRef<HTMLInputElement>(null)
  const photoTarget = useRef<string | null>(null)
  const queue = useRef(Promise.resolve())

  const load = useCallback(() => {
    let active = true
    trialApi.get(id, token).then((view) => {
      if (!active) return
      setTrial(view); setName(view.businessName); setTemplate(view.template); setColors(view.colors); setLogoUrl(view.logoUrl); setWhatsapp(view.whatsapp || '')
      setDrafts(view.products.map(toDraft))
    }).catch((err) => {
      if (active) setMissing(err instanceof Error && /venció|borró/.test(err.message) ? 'Esta tienda de prueba venció y sus datos ya se borraron.' : 'Esta tienda de prueba no existe o ya se borró.')
    })
    return () => { active = false }
  }, [id, token])
  // A late response must never overwrite rows the visitor already added: only the latest request loads.
  useEffect(() => load(), [load])

  const editable = Boolean(token && trial?.owner && trial.state === 'activa')
  const maxProducts = trial?.limits.maxProducts ?? 7
  const whatsappDigits = whatsapp.replace(/[\s().-]/g, '')
  const whatsappInvalid = Boolean(whatsappDigits) && !/^\+[1-9]\d{7,14}$/.test(whatsappDigits)
  const loadOrders = useCallback(() => { if (token && trial?.owner) trialApi.orders(id, token).then((list) => setOrders(list.items)).catch(() => {}) }, [id, token, trial?.owner])
  useEffect(() => { loadOrders() }, [loadOrders])
  const remaining = useRemaining(trial?.expiresAt)
  const touch = () => setRevision((value) => value + 1)
  const patch = (key: string, values: Partial<Draft>) => { setDrafts((current) => current.map((draft) => (draft.id === key ? { ...draft, ...values } : draft))); touch() }

  // Autosave: shortly after the last change, when nothing is uploading. Saves run one after another.
  const uploading = logoBusy || drafts.some((draft) => draft.uploading)
  useEffect(() => {
    if (!revision || !editable || !token || uploading) return
    const payload = {
      businessName: name.trim() || trial!.businessName, template, logoUrl, colors, whatsapp: whatsappInvalid ? (trial!.whatsapp || '') : whatsappDigits,
      products: drafts.filter((draft) => draft.name.trim() && !priceInvalid(draft)).map(toProduct),
      // Photos of products not saved yet (no name or a price being typed) must not be deleted.
      keep: drafts.filter((draft) => draft.imageUrl && (!draft.name.trim() || priceInvalid(draft))).map((draft) => draft.imageUrl!),
    }
    const timer = window.setTimeout(() => {
      setSaveState('saving')
      queue.current = queue.current.then(async () => {
        try {
          const view = await trialApi.save(id, token, payload)
          setTrial((current) => (current ? { ...current, state: view.state, expiresAt: view.expiresAt, deleteAfter: view.deleteAfter, businessName: view.businessName, whatsapp: view.whatsapp, ordersOpen: view.ordersOpen } : view))
          setSaveState('saved')
        } catch (err) {
          setSaveState('error')
          setMessage({ tone: 'error', text: err instanceof Error ? err.message : 'No se pudo guardar.' })
          if (err instanceof Error && /venció|convirtió/.test(err.message)) load()
        }
      })
    }, 900)
    return () => window.clearTimeout(timer)
  }, [revision, uploading]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (saveState === 'saving' || uploading) event.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [saveState, uploading])

  const upload = async (file: File) => {
    if (!token || !trial) return null
    const prepared = await prepareProductPhoto(file)
    if (prepared.size > trial.limits.maxPhotoMb * 1024 * 1024) throw new Error(`La foto pesa más de ${trial.limits.maxPhotoMb} MB. Prueba con otra.`)
    return (await trialApi.photo(id, token, prepared)).url
  }

  const onPhoto = async (files: FileList | null) => {
    const file = files?.[0]
    const target = photoTarget.current
    if (!file || !target) return
    setMessage(null)
    if (target === 'logo') {
      setLogoBusy(true)
      try { const url = await upload(file); if (url) { setLogoUrl(url); touch() } }
      catch (err) { setMessage({ tone: 'error', text: err instanceof Error ? err.message : 'No se pudo subir el logo.' }) }
      finally { setLogoBusy(false) }
      return
    }
    patch(target, { uploading: true })
    try { const url = await upload(file); patch(target, { imageUrl: url, uploading: false }) }
    catch (err) { patch(target, { uploading: false }); setMessage({ tone: 'error', text: err instanceof Error ? err.message : 'No se pudo subir la foto.' }) }
  }
  const pick = (target: string) => { photoTarget.current = target; photoInput.current?.click() }

  const addProduct = () => {
    if (drafts.length >= maxProducts) { setMessage({ tone: 'error', text: `La tienda de prueba admite hasta ${maxProducts} productos.` }); return }
    const draft: Draft = { id: newId(), name: '', price: null, priceText: '', description: '', imageUrl: null }
    setDrafts((current) => [...current, draft])
    setMessage(null)
    window.setTimeout(() => document.getElementById(`name-${draft.id}`)?.focus(), 30)
  }

  const removeTrial = async () => {
    if (!token || !window.confirm('¿Borrar esta tienda de prueba y sus fotos ahora? No se puede deshacer.')) return
    await trialApi.remove(id, token).catch(() => {})
    writeToken(id, null)
    navigate('/prueba')
  }

  const shareUrl = typeof window !== 'undefined' ? `${window.location.origin}/prueba/${id}` : ''
  const share = async () => {
    const text = `Mira la tienda de prueba de ${name || trial?.businessName}`
    try {
      if (navigator.share) { await navigator.share({ title: name, text, url: shareUrl }); return }
      await navigator.clipboard.writeText(shareUrl)
      setMessage({ tone: 'ok', text: 'Enlace copiado. Quien lo abra solo podrá verla, no editarla.' })
    } catch { /* cancelled */ }
  }

  const preview: PreviewData = useMemo(() => ({
    businessName: name || trial?.businessName || '', template, logoUrl, colors,
    products: drafts.filter((draft) => draft.name.trim() || draft.imageUrl).map((draft) => ({ ...toProduct(draft), name: draft.name.trim() || 'Producto sin nombre', price: priceInvalid(draft) ? null : toProduct(draft).price })),
  }), [name, trial?.businessName, template, logoUrl, colors, drafts])

  if (missing) return (
    <main className="grid min-h-screen place-items-center bg-[#f7f8f3] px-4 text-center text-[#03301f]">
      <div className="max-w-md space-y-5"><BrandHeader /><p className="text-xl font-black">{missing}</p>
        <p className="text-[15px] text-[#03301f]/70">Puedes crear una tienda de prueba nueva en minutos, o escribirnos para crear tu tienda real.</p>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
          <button type="button" className="rounded-full bg-[#03301f] px-6 py-3 font-bold text-[#cdf53f]" onClick={() => navigate('/prueba')}>Crear una tienda de prueba</button>
          <a href={salesLink('Hola, quiero crear mi tienda con Tienda IA Express.')} target="_blank" rel="noopener noreferrer" className="rounded-full border-2 border-[#03301f] px-6 py-3 font-bold">Hablar con nosotros</a>
        </div>
      </div>
    </main>
  )
  if (!trial) return <main className="grid min-h-screen place-items-center bg-[#f7f8f3]"><Loader2 className="animate-spin text-[#03301f]" aria-label="Cargando" /></main>

  if (trial.state === 'convertida') return (
    <main className="grid min-h-screen place-items-center bg-[#f7f8f3] px-4 text-center text-[#03301f]">
      <div className="max-w-md space-y-4"><BrandHeader /><p className="text-2xl font-black">«{trial.businessName}» ya es una tienda real</p>
        <p className="text-[15px] text-[#03301f]/75">Esta prueba se convirtió en tienda. Para entrar a tu panel usa el enlace que te enviamos al correo o por WhatsApp. Esta página de prueba ya no se usa.</p>
      </div>
    </main>
  )

  const expired = trial.state === 'vencida'
  const activateButton = (wide?: boolean) => (
    <button type="button" onClick={() => setActivating(true)} className={`inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full bg-[#cdf53f] px-4 py-2.5 text-xs font-black uppercase tracking-wide text-[#03301f] shadow-sm hover:brightness-95 sm:px-5 sm:text-sm ${wide ? 'w-full py-3.5 text-[15px]' : 'h-10 flex-1 sm:flex-none'}`}>
      <Rocket size={16} aria-hidden="true" /> Quiero activar mi tienda
    </button>
  )

  const previewFrame = (
    <div className="mx-auto w-full max-w-[420px]">
      <div className="overflow-hidden rounded-[2rem] border-[6px] border-[#03301f] bg-white shadow-xl">
        <TrialPreview data={preview} shop={{ trialId: id, open: trial.ordersOpen && !expired }} />
      </div>
      <p className="mt-3 text-center text-xs text-[#03301f]/60">{editable ? 'Así la ven tus clientes en el celular.' : `Tienda temporal creada con ${PLATFORM_BRAND.name}.`}</p>
    </div>
  )

  return (
    <main className="min-h-screen bg-[#eef1ea] text-[#03301f]">
      {/* Temporary-store bar: always visible. */}
      <div className="sticky top-0 z-30 bg-[#03301f] text-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-4 py-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="rounded-full bg-[#cdf53f] px-2.5 py-1 font-black uppercase tracking-wider text-[#03301f]">Tienda temporal</span>
            <span className="font-semibold">{trial.ordersOpen ? 'Recibe pedidos por WhatsApp' : <><span className="hidden sm:inline">Aún </span>sin pedidos</>}</span>
            <span className="inline-flex items-center gap-1 text-white/80" title={expired ? `Venció el ${dateLabel(trial.expiresAt)}` : `Vence el ${dateLabel(trial.expiresAt)}`}>
              <Clock size={13} aria-hidden="true" /> {expired ? `Venció · se borra el ${dateLabel(trial.deleteAfter)}` : <>Quedan <b className="text-white">{remaining.label}</b></>}
            </span>
          </div>
          <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
            {!expired && <button type="button" onClick={() => void share()} aria-label="Compartir" className="inline-flex h-10 w-10 items-center justify-center gap-1.5 rounded-full border border-white/30 text-sm font-bold hover:bg-white/10 sm:w-auto sm:px-4"><Share2 size={15} aria-hidden="true" /> <span className="hidden sm:inline">Compartir</span></button>}
            {activateButton()}
          </div>
        </div>
        {editable && !finished && (
          <div className="border-t border-white/10 bg-[#02200f] px-4 py-1.5 lg:hidden">
            <div className="mx-auto grid max-w-md grid-cols-2 rounded-full bg-white/10 p-1" role="tablist" aria-label="Editor y vista previa">
              {([['editar', 'Editar', Pencil], ['vista', 'Vista previa', Eye]] as const).map(([key, label, Icon]) => (
                <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => { setTab(key); window.scrollTo({ top: 0 }) }}
                  className={`inline-flex h-10 items-center justify-center gap-1.5 rounded-full text-sm font-bold ${tab === key ? 'bg-[#cdf53f] text-[#03301f]' : 'text-white'}`}><Icon size={15} aria-hidden="true" /> {label}</button>
              ))}
            </div>
          </div>
        )}
      </div>

      {expired && (
        <div className="mx-auto max-w-3xl px-4 pt-6">
          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5">
            <p className="text-lg font-black">{trial.owner ? 'Tu tienda de prueba venció' : 'Esta tienda de prueba venció'}</p>
            <p className="mt-1 text-[15px] text-[#03301f]/75">
              {trial.owner
                ? <>Ya no se puede editar. Si quieres conservarla, pide su activación antes del <b>{dateLabel(trial.deleteAfter)}</b>; después se borran sus fotos y datos.</>
                : <>Sus datos se borrarán el <b>{dateLabel(trial.deleteAfter)}</b> ¿Quieres una tienda así? Crea la tuya gratis.</>}
            </p>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              {activateButton()}
              {!trial.owner && <a href="/prueba" className="inline-flex items-center justify-center rounded-full border-2 border-[#03301f] px-5 py-2.5 text-sm font-bold">Crear mi tienda de prueba</a>}
            </div>
          </div>
        </div>
      )}

      {finished && editable ? (
        <section className="mx-auto max-w-3xl space-y-6 px-4 py-8 text-center">
          <div className="space-y-2"><p className="text-sm font-bold uppercase tracking-[0.18em] text-[#8a2ff5]">¡Lista!</p>
            <h1 className="text-3xl font-black">Así se ve «{preview.businessName}»</h1>
            <p className="text-[15px] text-[#03301f]/75">{trial.ordersOpen ? 'Compártela: ya recibe pedidos por WhatsApp.' : 'Compártela, o agrega tu WhatsApp para recibir pedidos.'} Actívala para quedarte con ella. Quedan {remaining.label}.</p></div>
          {previewFrame}
          <div className="mx-auto flex max-w-md flex-col gap-2">
            {activateButton(true)}
            <button type="button" onClick={() => void share()} className="inline-flex items-center justify-center gap-2 rounded-full border-2 border-[#03301f] py-3 font-bold"><Share2 size={16} /> Compartir enlace</button>
            <button type="button" onClick={() => setFinished(false)} className="py-2 text-sm font-bold underline">Seguir editando</button>
          </div>
        </section>
      ) : (
        <div className={`mx-auto max-w-7xl gap-8 px-4 py-6 ${editable ? 'lg:grid lg:grid-cols-[minmax(22rem,26rem)_1fr]' : ''}`}>
          {editable && (
            <aside className={`space-y-4 ${tab === 'editar' ? '' : 'hidden'} lg:block`} aria-label="Editor de la tienda">
              <section className="space-y-4 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5">
                <h2 className="text-xs font-black uppercase tracking-[0.18em] text-[#03301f]/60">Tu negocio</h2>
                <label className="block space-y-1.5"><span className="text-sm font-bold">Nombre</span>
                  <input className="w-full rounded-xl border border-[#cfd5cf] px-3.5 py-2.5 text-[15px] outline-none focus:border-[#03301f] focus:ring-2 focus:ring-[#cdf53f]" maxLength={80} value={name} onChange={(e) => { setName(e.target.value); touch() }} /></label>
                {trial.ordersEnabled && (
                  <label className="block space-y-1.5"><span className="text-sm font-bold">WhatsApp para recibir pedidos</span>
                    <input type="tel" autoComplete="tel" className={`w-full rounded-xl border px-3.5 py-2.5 text-[15px] outline-none focus:border-[#03301f] focus:ring-2 focus:ring-[#cdf53f] ${whatsappInvalid ? 'border-red-600' : 'border-[#cfd5cf]'}`} placeholder="+57 300 000 0000" maxLength={30} value={whatsapp} onChange={(e) => { setWhatsapp(e.target.value); touch() }} />
                    <span className={`block text-xs ${whatsappInvalid ? 'font-semibold text-red-700' : 'text-[#03301f]/60'}`}>{whatsappInvalid ? 'Escríbelo con el código del país, por ejemplo +57 300 000 0000.' : trial.ordersOpen ? 'Tu tienda ya recibe pedidos: llegan a este WhatsApp.' : 'Con tu WhatsApp, tu tienda recibe pedidos reales de los productos con precio.'}</span></label>
                )}
                <div className="flex items-center gap-3">
                  <button type="button" onClick={() => pick('logo')} className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-full border-2 border-dashed border-[#cfd5cf] bg-[#f7f8f3]" aria-label={logoUrl ? 'Cambiar el logo' : 'Subir el logo'}>
                    {logoBusy ? <Loader2 className="animate-spin" size={20} /> : logoUrl ? <img src={logoUrl} alt="" className="h-full w-full object-cover" /> : <ImagePlus size={20} aria-hidden="true" />}
                  </button>
                  <div className="text-sm"><b>Logo</b> <span className="text-[#03301f]/60">(opcional)</span>
                    <div className="flex gap-3"><button type="button" className="font-bold underline" onClick={() => pick('logo')}>{logoUrl ? 'Cambiar' : 'Subir'}</button>{logoUrl && <button type="button" className="font-bold text-red-700 underline" onClick={() => { setLogoUrl(null); touch() }}>Quitar</button>}</div></div>
                </div>
                <div className="space-y-2"><span className="text-sm font-bold">Colores</span>
                  <div className="flex flex-wrap gap-2">
                    {SWATCHES.map((swatch) => (
                      <button key={swatch.primary} type="button" aria-label={`Colores ${swatch.primary} y ${swatch.accent}`} aria-pressed={colors.primary === swatch.primary && colors.accent === swatch.accent} onClick={() => { setColors(swatch); touch() }}
                        className={`flex h-10 w-10 overflow-hidden rounded-full ring-2 ring-offset-2 ${colors.primary === swatch.primary && colors.accent === swatch.accent ? 'ring-[#03301f]' : 'ring-transparent'}`}>
                        <span className="flex-1" style={{ background: swatch.primary }} /><span className="flex-1" style={{ background: swatch.accent }} /></button>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    {(['primary', 'accent'] as const).map((key) => (
                      <label key={key} className="flex items-center gap-2 rounded-xl border border-[#cfd5cf] px-2.5 py-1.5">
                        <input type="color" value={colors[key]} onChange={(e) => { setColors({ ...colors, [key]: e.target.value }); touch() }} className="h-8 w-8 cursor-pointer rounded border-0 bg-transparent p-0" />
                        <span>{key === 'primary' ? 'Principal' : 'Acento'}</span></label>
                    ))}
                  </div>
                </div>
              </section>

              <section className="space-y-3 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5">
                <h2 className="text-xs font-black uppercase tracking-[0.18em] text-[#03301f]/60">Plantilla</h2>
                <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Plantilla">
                  {TEMPLATES.filter((item) => trial.limits.templates.includes(item.key) || item.key === template).map((item) => (
                    <button key={item.key} type="button" role="radio" aria-checked={template === item.key} onClick={() => { setTemplate(item.key); touch() }}
                      className={`rounded-2xl border-2 px-2 py-3 text-center ${template === item.key ? 'border-[#03301f] bg-[#cdf53f]/30' : 'border-[#e3e7e1] hover:border-[#03301f]/40'}`}>
                      <b className="block text-sm">{item.name}</b><span className="block text-[11px] leading-tight text-[#03301f]/60">{item.hint}</span></button>
                  ))}
                </div>
              </section>

              <section className="space-y-3 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5">
                <div className="flex items-center justify-between"><h2 className="text-xs font-black uppercase tracking-[0.18em] text-[#03301f]/60">Productos</h2><span className="text-sm font-bold">{drafts.length}/{maxProducts}</span></div>
                {drafts.map((draft, index) => (
                  <div key={draft.id} className="space-y-2 rounded-2xl bg-[#f7f8f3] p-3">
                    <div className="flex gap-3">
                      <button type="button" onClick={() => pick(draft.id)} aria-label={draft.imageUrl ? `Cambiar la foto del producto ${index + 1}` : `Subir la foto del producto ${index + 1}`} className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-xl border-2 border-dashed border-[#cfd5cf] bg-white">
                        {draft.uploading ? <Loader2 className="animate-spin" size={20} /> : draft.imageUrl ? <img src={draft.imageUrl} alt="" className="h-full w-full object-cover" /> : <span className="flex flex-col items-center text-[11px] font-bold"><ImagePlus size={20} aria-hidden="true" />Foto</span>}
                      </button>
                      <div className="min-w-0 flex-1 space-y-2">
                        <input id={`name-${draft.id}`} aria-label={`Nombre del producto ${index + 1}`} className="w-full rounded-lg border border-[#cfd5cf] bg-white px-2.5 py-2 text-[15px]" placeholder="Nombre del producto" maxLength={120} value={draft.name} onChange={(e) => patch(draft.id, { name: e.target.value })} />
                        <input aria-label={`Precio del producto ${index + 1}`} className={`w-full rounded-lg border bg-white px-2.5 py-2 text-[15px] ${priceInvalid(draft) ? 'border-red-600' : 'border-[#cfd5cf]'}`} placeholder="Precio, ej.: 85.000" inputMode="numeric" value={draft.priceText} onChange={(e) => patch(draft.id, { priceText: e.target.value })} />
                      </div>
                      <button type="button" aria-label={`Quitar el producto ${index + 1}`} className="grid h-10 w-10 shrink-0 place-items-center self-start rounded-full text-[#03301f]/60 hover:bg-white hover:text-red-700" onClick={() => { setDrafts((current) => current.filter((item) => item.id !== draft.id)); touch() }}><Trash2 size={17} /></button>
                    </div>
                    <textarea aria-label={`Descripción del producto ${index + 1}`} rows={2} maxLength={600} className="w-full resize-none rounded-lg border border-[#cfd5cf] bg-white px-2.5 py-2 text-sm" placeholder="Descripción (opcional)" value={draft.description} onChange={(e) => patch(draft.id, { description: e.target.value })} />
                    {!draft.name.trim() && <p className="text-xs text-[#03301f]/60">Escribe el nombre para guardarlo.</p>}
                    {priceInvalid(draft) && <p className="text-xs font-semibold text-red-700">Escribe el precio solo con números, por ejemplo 85000.</p>}
                    {draft.name.trim() && !draft.priceText.trim() && <p className="text-xs text-[#03301f]/60">Sin precio no se puede pedir ni se pasa a tu tienda al activarla.</p>}
                  </div>
                ))}
                {drafts.length >= maxProducts
                  ? <p className="rounded-xl bg-[#f7f8f3] px-3 py-2.5 text-sm">Llegaste al máximo de {maxProducts} productos de la prueba. Al activar tu tienda podrás agregar más.</p>
                  : <button type="button" onClick={addProduct} className="inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-full border-2 border-[#03301f] text-sm font-bold"><Plus size={16} /> Agregar producto</button>}
                <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => { void onPhoto(e.target.files); e.target.value = '' }} />
              </section>

              {trial.ordersEnabled && (
                <section className="space-y-3 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5">
                  <div className="flex items-center justify-between"><h2 className="text-xs font-black uppercase tracking-[0.18em] text-[#03301f]/60">Pedidos recibidos</h2>
                    <button type="button" className="text-xs font-bold underline" onClick={loadOrders}>Actualizar</button></div>
                  {!orders.length ? <p className="text-sm text-[#03301f]/60">{trial.ordersOpen ? 'Todavía no hay pedidos. Comparte tu enlace para recibir los primeros.' : 'Agrega tu WhatsApp para empezar a recibir pedidos.'}</p> : (
                    <ul className="space-y-2">
                      {orders.map((order) => (
                        <li key={order.code} className="rounded-2xl bg-[#f7f8f3] p-3 text-sm">
                          <p className="flex justify-between font-bold"><span className="font-mono">{order.code}</span><span>{formatMoney(order.total, 'COP')}</span></p>
                          <p className="text-xs text-[#03301f]/60">{new Date(order.createdAt).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })}{order.customerName ? ` · ${order.customerName}` : ''}</p>
                          <p className="mt-1">{order.items.map((line) => `${line.quantity} × ${line.name}`).join(', ')}</p>
                          {order.note && <p className="mt-1 text-xs text-[#03301f]/70">Nota: {order.note}</p>}
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="text-xs text-[#03301f]/60">Los pedidos llegan a tu WhatsApp; el pago y la entrega los acuerdas tú con cada cliente.</p>
                </section>
              )}
              <div className="flex items-center justify-between px-1 text-sm" aria-live="polite">
                <span className="inline-flex items-center gap-1.5 text-[#03301f]/70">
                  {saveState === 'saving' ? <><Loader2 size={14} className="animate-spin" /> Guardando…</> : saveState === 'saved' ? <><Check size={14} /> Cambios guardados</> : saveState === 'error' ? <><X size={14} /> Sin guardar</> : 'Los cambios se guardan solos'}
                </span>
                <button type="button" className="text-xs font-bold text-red-700 underline" onClick={() => void removeTrial()}>Borrar prueba</button>
              </div>
              {message && <p role={message.tone === 'error' ? 'alert' : 'status'} className={`rounded-xl px-3 py-2.5 text-sm font-semibold ${message.tone === 'error' ? 'bg-red-50 text-red-800' : 'bg-[#cdf53f]/40'}`}>{message.text}</p>}
              <button type="button" onClick={() => { setFinished(true); window.scrollTo({ top: 0 }) }} className="w-full rounded-full bg-[#03301f] py-3.5 text-[15px] font-black text-[#cdf53f]">Terminé, ver mi tienda</button>
            </aside>
          )}
          <section className={`${editable && tab !== 'vista' ? 'hidden' : ''} lg:block`} aria-label="Vista previa">
            {(!expired || trial.owner) && previewFrame}
            {!editable && !expired && (
              <div className="mx-auto mt-6 max-w-[420px] space-y-3 text-center">
                <p className="text-sm text-[#03301f]/70">{trial.ordersOpen ? 'Tienda temporal: el pago y la entrega se acuerdan con el vendedor por WhatsApp.' : 'Tienda temporal: todavía no recibe pedidos.'}</p>
                {!token && <a href="/prueba" className="inline-flex items-center justify-center rounded-full border-2 border-[#03301f] px-5 py-2.5 text-sm font-bold">Crear mi propia tienda de prueba</a>}
              </div>
            )}
          </section>
        </div>
      )}

      {activating && <ActivationDialog trialId={id} businessName={preview.businessName} token={trial.owner ? token : null} shareUrl={shareUrl} onClose={() => setActivating(false)} />}
    </main>
  )
}
