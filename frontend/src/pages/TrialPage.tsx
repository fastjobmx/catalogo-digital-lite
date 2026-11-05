import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AlertCircle, Clock, Copy, ImagePlus, Loader2, MessageCircle, Plus, Trash2 } from 'lucide-react'
import { trialApi, type TrialProduct, type TrialView } from '../services/api'
import { THEME_PRESETS } from '../types/theme'
import { formatMoney } from '../lib/format'
import { prepareProductPhoto } from '../lib/imageResize'
import { parseMoney } from '../lib/import/mapping'
import { PLATFORM_BRAND } from '../lib/platformBrand'

/** Platform sales contact (Tienda IA Express WhatsApp) used only for the "create my real store" button. */
const SALES_WHATSAPP = '573506912734'
const MAX_PRODUCTS = 12
const MAX_PHOTOS = 6
const tokenKey = (id: string) => `catalogo-lite:trial:${id}`
const readToken = (id: string) => { try { return localStorage.getItem(tokenKey(id)) } catch { return null } }
const writeToken = (id: string, token: string | null) => { try { if (token) localStorage.setItem(tokenKey(id), token); else localStorage.removeItem(tokenKey(id)) } catch { /* private mode */ } }
const expiresLabel = (iso: string) => new Date(iso).toLocaleString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' })

function useNoIndex() {
  useEffect(() => {
    const meta = document.createElement('meta')
    meta.name = 'robots'; meta.content = 'noindex, nofollow'
    document.head.appendChild(meta)
    return () => { meta.remove() }
  }, [])
}

/** Catalogue trial without an account: a temporary, unpublished preview that is deleted after 48 hours. */
export default function TrialPage() {
  useNoIndex()
  const { id } = useParams()
  return id ? <TrialEditor id={id} /> : <TrialStart />
}

function TrialStart() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [template, setTemplate] = useState('stories')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
    <main className="min-h-screen bg-[#f6f5f1] px-4 py-10 text-[#16181d]">
      <div className="mx-auto max-w-3xl space-y-8">
        <header className="space-y-3">
          <a href={PLATFORM_BRAND.siteUrl} className="inline-block"><img src={PLATFORM_BRAND.logo} width={PLATFORM_BRAND.logoSize.width} height={PLATFORM_BRAND.logoSize.height} alt={PLATFORM_BRAND.name} className="h-auto w-[200px] rounded-xl" /></a>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#5b6170]">Prueba gratis · sin registro</p>
          <h1 className="text-3xl font-black leading-tight sm:text-4xl">Mira cómo se vería tu catálogo</h1>
          <p className="text-[#4a4f5c]">Sube hasta {MAX_PHOTOS} fotos de tus productos y verás una vista previa con el estilo que elijas. Es temporal: <b>no se publica</b> y se borra sola en 48 horas. No te pedimos correo ni contraseña.</p>
        </header>
        <form onSubmit={start} className="space-y-6 rounded-2xl bg-white p-6 shadow-sm">
          <label className="block space-y-2"><span className="text-sm font-bold">Nombre de tu negocio</span>
            <input className="w-full rounded-xl border border-[#d9dbe0] px-4 py-3" required minLength={2} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej.: Dulce Hogar Deco" />
          </label>
          <fieldset className="space-y-2"><legend className="text-sm font-bold">Estilo</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {THEME_PRESETS.filter((preset) => preset.template !== 'personalizado').map((preset) => (
                <label key={preset.id} className={`cursor-pointer rounded-xl border-2 p-2 text-xs font-bold ${template === preset.template ? 'border-[#16181d]' : 'border-transparent bg-[#f6f5f1]'}`}>
                  <input type="radio" name="template" className="sr-only" checked={template === preset.template} onChange={() => setTemplate(preset.template)} />
                  <span className="mb-2 flex h-8 overflow-hidden rounded-lg">
                    {[preset.palette.background, preset.palette.primary, preset.palette.accent].map((color) => <span key={color} className="flex-1" style={{ background: color }} />)}
                  </span>
                  {preset.name}
                </label>
              ))}
            </div>
          </fieldset>
          {error && <p role="alert" className="flex items-center gap-2 text-sm text-red-700"><AlertCircle size={16} />{error}</p>}
          <button type="submit" disabled={busy} className="inline-flex items-center gap-2 rounded-full bg-[#16181d] px-6 py-3 font-bold text-white disabled:opacity-60">{busy && <Loader2 size={16} className="animate-spin" />} Empezar la prueba</button>
        </form>
      </div>
    </main>
  )
}

type Draft = TrialProduct & { key: string; uploading?: boolean; priceText: string }

function TrialEditor({ id }: { id: string }) {
  const navigate = useNavigate()
  const [trial, setTrial] = useState<TrialView | null>(null)
  const [token] = useState(() => readToken(id))
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [name, setName] = useState('')
  const [template, setTemplate] = useState('stories')
  const [status, setStatus] = useState<{ tone: 'error' | 'ok'; text: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [missing, setMissing] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const editing = Boolean(token)

  // A late response (for example the second effect run in development) must never overwrite rows
  // the visitor already added: only the latest request may load the trial.
  useEffect(() => {
    let active = true
    trialApi.get(id).then((view) => {
      if (!active) return
      setTrial(view); setName(view.businessName); setTemplate(view.template)
      setDrafts(view.products.map((product) => ({ ...product, key: crypto.randomUUID(), priceText: product.price === null ? '' : String(product.price) })))
    }).catch((err) => { if (active) setMissing(err instanceof Error && /venció/.test(err.message) ? 'Esta prueba ya venció y se borró.' : 'Esta prueba no existe o ya se borró.') })
    return () => { active = false }
  }, [id])

  const photos = drafts.filter((draft) => draft.imageUrl).length
  const patch = (key: string, values: Partial<Draft>) => setDrafts((current) => current.map((draft) => draft.key === key ? { ...draft, ...values } : draft))

  const addPhotos = async (files: FileList | null) => {
    if (!files || !token) return
    setStatus(null)
    const room = Math.min(MAX_PHOTOS - photos, MAX_PRODUCTS - drafts.length)
    for (const file of [...files].slice(0, Math.max(0, room))) {
      const key = crypto.randomUUID()
      setDrafts((current) => [...current, { key, name: '', price: null, priceText: '', description: '', imageUrl: null, uploading: true }])
      try {
        const { url } = await trialApi.photo(id, token, await prepareProductPhoto(file))
        patch(key, { imageUrl: url, uploading: false })
      } catch (err) {
        setDrafts((current) => current.filter((draft) => draft.key !== key))
        setStatus({ tone: 'error', text: err instanceof Error ? err.message : 'No se pudo subir la foto.' })
      }
    }
    if (files.length > room) setStatus({ tone: 'error', text: `La prueba admite hasta ${MAX_PHOTOS} fotos.` })
  }

  const save = async () => {
    if (!token) return
    const products = drafts.filter((draft) => draft.name.trim()).map(({ name: productName, description, imageUrl, priceText }) => ({ name: productName.trim(), description, imageUrl, price: priceText.trim() ? parseMoney(priceText) : null }))
    setSaving(true); setStatus(null)
    try {
      const view = await trialApi.save(id, token, { businessName: name, template, products })
      setTrial(view)
      setStatus({ tone: 'ok', text: 'Vista previa actualizada.' })
    } catch (err) { setStatus({ tone: 'error', text: err instanceof Error ? err.message : 'No se pudo guardar.' }) }
    finally { setSaving(false) }
  }

  const remove = async () => {
    if (!token || !window.confirm('¿Borrar esta prueba y sus fotos ahora?')) return
    await trialApi.remove(id, token).catch(() => {})
    writeToken(id, null)
    navigate('/prueba')
  }

  const shareUrl = typeof window !== 'undefined' ? (window.location.href.split('?')[0] ?? '') : ''
  const salesLink = `https://wa.me/${SALES_WHATSAPP}?text=${encodeURIComponent(`Hola, quiero crear mi tienda. Esta es mi vista previa de prueba: ${shareUrl}`)}`

  if (missing) return (
    <main className="grid min-h-screen place-items-center bg-[#f6f5f1] px-4 text-center">
      <div className="space-y-4"><p className="text-lg font-bold">{missing}</p><button type="button" className="rounded-full bg-[#16181d] px-6 py-3 font-bold text-white" onClick={() => navigate('/prueba')}>Hacer una prueba nueva</button></div>
    </main>
  )
  if (!trial) return <main className="grid min-h-screen place-items-center bg-[#f6f5f1]"><Loader2 className="animate-spin" /></main>

  return (
    <main className="min-h-screen bg-[#f6f5f1] text-[#16181d]">
      <div className="sticky top-0 z-30 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-[#16181d] px-4 py-2 text-center text-xs font-bold text-white" role="status">
        <span className="rounded-full bg-amber-300 px-2 py-0.5 text-[#16181d]">VISTA PREVIA TEMPORAL</span>
        <span>No está publicada y no recibe pedidos.</span>
        <span className="inline-flex items-center gap-1 font-normal text-white/80"><Clock size={12} /> Se borra el {expiresLabel(trial.expiresAt)}</span>
      </div>
      <div className={`mx-auto grid max-w-6xl gap-6 px-4 py-6 ${editing ? 'lg:grid-cols-[22rem_1fr]' : ''}`}>
        {editing && (
          <aside className="space-y-4 lg:sticky lg:top-12 lg:self-start">
            <section className="space-y-3 rounded-2xl bg-white p-5 shadow-sm">
              <label className="block space-y-1"><span className="text-xs font-bold uppercase tracking-widest text-[#5b6170]">Negocio</span>
                <input className="w-full rounded-xl border border-[#d9dbe0] px-3 py-2" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} /></label>
              <label className="block space-y-1"><span className="text-xs font-bold uppercase tracking-widest text-[#5b6170]">Estilo</span>
                <select className="w-full rounded-xl border border-[#d9dbe0] px-3 py-2" value={template} onChange={(e) => setTemplate(e.target.value)}>
                  {THEME_PRESETS.filter((preset) => preset.template !== 'personalizado').map((preset) => <option key={preset.id} value={preset.template}>{preset.name}</option>)}
                </select></label>
            </section>
            <section className="space-y-3 rounded-2xl bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between"><b>Productos</b><span className="text-xs text-[#5b6170]">{photos}/{MAX_PHOTOS} fotos</span></div>
              {drafts.map((draft) => (
                <div key={draft.key} className="grid grid-cols-[4rem_1fr_auto] gap-2 border-t border-[#eceef1] pt-3">
                  <div className="h-16 w-16 overflow-hidden rounded-lg bg-[#f1f2f4]">{draft.uploading ? <Loader2 className="m-5 animate-spin" size={20} /> : draft.imageUrl && <img src={draft.imageUrl} alt="" className="h-full w-full object-cover" />}</div>
                  <div className="space-y-1.5">
                    <input aria-label="Nombre del producto" className="w-full rounded-lg border border-[#d9dbe0] px-2 py-1 text-sm" placeholder="Nombre" maxLength={120} value={draft.name} onChange={(e) => patch(draft.key, { name: e.target.value })} />
                    <input aria-label="Precio" className="w-full rounded-lg border border-[#d9dbe0] px-2 py-1 text-sm" placeholder="Precio (opcional)" inputMode="numeric" value={draft.priceText} onChange={(e) => patch(draft.key, { priceText: e.target.value })} />
                  </div>
                  <button type="button" aria-label="Quitar producto" className="self-start p-1 text-[#5b6170]" onClick={() => setDrafts((current) => current.filter((item) => item.key !== draft.key))}><Trash2 size={16} /></button>
                </div>
              ))}
              <div className="flex flex-wrap gap-2 pt-1">
                <button type="button" disabled={photos >= MAX_PHOTOS || drafts.length >= MAX_PRODUCTS} onClick={() => input.current?.click()} className="inline-flex items-center gap-1.5 rounded-full border border-[#16181d] px-4 py-2 text-sm font-bold disabled:opacity-40"><ImagePlus size={15} /> Agregar fotos</button>
                <button type="button" disabled={drafts.length >= MAX_PRODUCTS} onClick={() => setDrafts((current) => [...current, { key: crypto.randomUUID(), name: '', price: null, priceText: '', description: '', imageUrl: null }])} className="inline-flex items-center gap-1.5 rounded-full border border-[#d9dbe0] px-4 py-2 text-sm font-bold disabled:opacity-40"><Plus size={15} /> Sin foto</button>
              </div>
              <input ref={input} type="file" multiple accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => { void addPhotos(e.target.files); e.target.value = '' }} />
              <button type="button" disabled={saving || drafts.some((draft) => draft.uploading)} onClick={() => void save()} className="w-full rounded-full bg-[#16181d] py-3 font-bold text-white disabled:opacity-60">{saving ? 'Guardando…' : 'Actualizar vista previa'}</button>
              {status && <p role={status.tone === 'error' ? 'alert' : 'status'} className={`text-sm ${status.tone === 'error' ? 'text-red-700' : 'text-emerald-700'}`}>{status.text}</p>}
            </section>
            <section className="space-y-2 rounded-2xl bg-white p-5 text-sm shadow-sm">
              <button type="button" className="inline-flex items-center gap-1.5 font-bold underline" onClick={() => { void navigator.clipboard?.writeText(shareUrl); setStatus({ tone: 'ok', text: 'Enlace copiado. Quien lo abra solo podrá verla, no editarla.' }) }}><Copy size={14} /> Copiar enlace para compartir</button>
              <a href={salesLink} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 rounded-full bg-[#147B55] py-3 font-bold text-white"><MessageCircle size={16} /> Quiero crear mi tienda de verdad</a>
              <p className="text-xs text-[#5b6170]">Te contactamos por WhatsApp para crear tu tienda real. La prueba no se convierte en tienda automáticamente.</p>
              <button type="button" className="text-xs text-red-700 underline" onClick={() => void remove()}>Borrar esta prueba ahora</button>
            </section>
          </aside>
        )}
        <TrialPreview view={trial} />
      </div>
    </main>
  )
}

function TrialPreview({ view }: { view: TrialView }) {
  const preset = useMemo(() => THEME_PRESETS.find((item) => item.template === view.template) || THEME_PRESETS[0]!, [view.template])
  const palette = preset.palette
  const stories = view.template === 'stories'
  const style = { background: palette.background, color: palette.text, fontFamily: `'${preset.typography.fontPrimary}', system-ui, sans-serif` }
  const price = (value: number | null) => value === null ? 'Precio a consultar' : formatMoney(value, 'COP')

  return (
    <section aria-label="Vista previa del catálogo" className="overflow-hidden rounded-2xl shadow-sm" style={style}>
      <header className="flex items-center justify-between px-5 py-4" style={{ borderBottom: `1px solid ${palette.border}` }}>
        <b className="text-lg" style={{ fontFamily: `'${preset.typography.fontDisplay}', serif` }}>{view.businessName}</b>
        <span className="rounded-full px-3 py-1 text-[11px] font-bold" style={{ background: palette.secondary, color: palette.text }}>Vista previa</span>
      </header>
      {!view.products.length && <p className="px-5 py-16 text-center text-sm" style={{ color: palette.textMuted }}>Agrega fotos y nombres a la izquierda y pulsa «Actualizar vista previa».</p>}
      {stories ? (
        <div className="mx-auto h-[70vh] max-w-sm snap-y snap-mandatory overflow-y-auto">
          {view.products.map((product, index) => (
            <article key={index} className="relative h-full snap-start overflow-hidden bg-black text-white">
              {product.imageUrl && <img src={product.imageUrl} alt={product.name} className="absolute inset-0 h-full w-full object-cover" />}
              <div className="absolute inset-x-0 bottom-0 space-y-2 bg-gradient-to-t from-black/90 to-transparent p-5 pt-20">
                <span className="text-[11px] font-bold">{index + 1}/{view.products.length}</span>
                <h2 className="text-2xl font-black">{product.name}</h2>
                <p className="text-lg font-bold">{price(product.price)}</p>
                <p className="inline-block rounded-full bg-white/20 px-3 py-1.5 text-xs font-bold">Vista previa: aún no recibe pedidos</p>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 p-5 md:grid-cols-3">
          {view.products.map((product, index) => (
            <article key={index} className="overflow-hidden" style={{ background: palette.surface, border: `1px solid ${palette.border}`, borderRadius: preset.radius === 'square' ? 0 : preset.radius === 'pill' ? 24 : 14 }}>
              <div className="aspect-[4/5]" style={{ background: palette.secondary }}>{product.imageUrl && <img src={product.imageUrl} alt={product.name} className="h-full w-full object-cover" />}</div>
              <div className="space-y-1 p-3">
                <h2 className="text-sm font-bold leading-snug">{product.name}</h2>
                <p className="text-sm" style={{ color: palette.textMuted }}>{price(product.price)}</p>
              </div>
            </article>
          ))}
        </div>
      )}
      {view.products.length > 0 && <p className="px-5 py-4 text-center text-xs" style={{ color: palette.textMuted, borderTop: `1px solid ${palette.border}` }}>Así se vería tu catálogo. Los botones de compra se activan cuando se crea la tienda real.</p>}
    </section>
  )
}
