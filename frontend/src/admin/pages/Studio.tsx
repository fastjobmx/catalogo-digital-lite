import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, Loader2, Search, Wand2 } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useCatalog } from '../../contexts/CatalogContext'
import { aiCatalogApi, creditsApi, updateProduct, uploadImage, type StoreCredits, type StudioPreset } from '../../services/api'
import { prepareProductPhoto } from '../../lib/imageResize'
import { resolveImageUrl } from '../../lib/imageSources'

const PRESETS: Array<{ key: StudioPreset; label: string; detail: string }> = [
  { key: 'fondo_blanco', label: 'Fondo blanco', detail: 'Producto sobre blanco puro, con sombra suave.' },
  { key: 'fondo_estudio', label: 'Fondo de estudio', detail: 'Gris claro con degradado, como en un estudio.' },
  { key: 'mejorar_luz', label: 'Mejorar luz', detail: 'Más luz y nitidez, mismo fondo.' },
]
/** Only the store's own uploaded product photos can be edited. */
const ownPhoto = (url: string) => /^\/api\/assets\/stores\/\d+\/products\/[\w.-]+$/.test(url)

/** AI Studio: improves the background or lighting of a product photo. The result is a new, additional
 * photo that the store adds only if it looks right; the original photo is never replaced. */
export default function Studio() {
  const { token, isDemoSession } = useAuth()
  const { products, refresh } = useCatalog()
  const [credits, setCredits] = useState<StoreCredits | null>(null)
  const [query, setQuery] = useState('')
  const [productId, setProductId] = useState<number | null>(null)
  const [photo, setPhoto] = useState<string | null>(null)
  const [preset, setPreset] = useState<StudioPreset>('fondo_blanco')
  const [result, setResult] = useState<{ src: string; mimeType: string; data: string; charged: number } | null>(null)
  const [busy, setBusy] = useState<'edit' | 'save' | null>(null)
  const [message, setMessage] = useState<{ tone: 'error' | 'ok'; text: string } | null>(null)

  useEffect(() => { if (token && !isDemoSession) creditsApi.get(token).then(setCredits).catch(() => setCredits(null)) }, [token, isDemoSession])
  const cost = credits?.costs.find((item) => item.feature === 'estudio_imagen')
  const available = Boolean(credits?.studioAvailable) && cost?.enabled !== false
  const candidates = useMemo(() => products.filter((product) => product.imageUrls.some(ownPhoto) && (!query || `${product.name} ${product.sku}`.toLowerCase().includes(query.toLowerCase()))).slice(0, 40), [products, query])
  const product = products.find((item) => item.id === productId) || null

  const choose = (id: number) => {
    const next = products.find((item) => item.id === id)
    setProductId(id); setPhoto(next?.imageUrls.find(ownPhoto) || null); setResult(null); setMessage(null)
  }

  const edit = async () => {
    if (!token || !photo) return
    setBusy('edit'); setMessage(null); setResult(null)
    try {
      const response = await aiCatalogApi.studio(photo, preset, crypto.randomUUID(), token)
      setResult({ src: `data:${response.image.mimeType};base64,${response.image.data}`, ...response.image, charged: response.charged })
      creditsApi.get(token).then(setCredits).catch(() => {})
    } catch (err) { setMessage({ tone: 'error', text: err instanceof Error ? err.message : 'La IA no pudo editar la foto. No se descontaron créditos.' }) }
    finally { setBusy(null) }
  }

  const keep = async (asMain: boolean) => {
    if (!token || !product || !result) return
    setBusy('save'); setMessage(null)
    try {
      const bytes = Uint8Array.from(atob(result.data), (char) => char.charCodeAt(0))
      const file = await prepareProductPhoto(new File([bytes], `estudio-${product.sku}.${result.mimeType.split('/')[1]}`, { type: result.mimeType }))
      const uploaded = await uploadImage(file, 'products', token)
      const imageUrls = asMain ? [uploaded.url, ...product.imageUrls] : [...product.imageUrls, uploaded.url]
      await updateProduct(product.id, { imageUrls: imageUrls.slice(0, 10) }, token)
      await refresh()
      setResult(null)
      setMessage({ tone: 'ok', text: asMain ? 'Foto agregada como principal. La original sigue en el producto.' : 'Foto agregada al producto. La original no cambió.' })
    } catch (err) { setMessage({ tone: 'error', text: err instanceof Error ? err.message : 'No se pudo guardar la foto.' }) }
    finally { setBusy(null) }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Wand2 size={15} className="text-brand" />
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand/70">Herramientas</span>
        </div>
        <h1 className="text-3xl font-black tracking-tight text-ink">Estudio IA</h1>
        <p className="text-muted text-sm mt-1.5">Mejora el fondo o la luz de las fotos de tus productos. El resultado se agrega como una foto más: la original nunca se borra.</p>
      </div>

      {isDemoSession && <p className="card p-4 text-sm text-muted">El Estudio IA requiere entrar con la cuenta real de tu tienda.</p>}
      {credits && !available && (
        <p className="card p-4 text-sm text-muted">
          {!credits.aiEnabled ? 'La IA está desactivada para tu tienda.' : cost?.enabled === false ? 'El Estudio IA está pausado por la plataforma.' : 'El Estudio IA no está disponible en esta plataforma.'}
        </p>
      )}

      {available && (
        <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
          <section className="card p-4 space-y-3">
            <label className="flex items-center gap-2 input-field py-1.5"><Search size={15} className="text-muted" /><span className="sr-only">Buscar producto</span>
              <input className="w-full bg-transparent outline-none text-sm" placeholder="Buscar producto" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
            <ul className="max-h-[28rem] overflow-y-auto divide-y divide-line">
              {candidates.map((item) => (
                <li key={item.id}>
                  <button type="button" onClick={() => choose(item.id)} className={`flex w-full items-center gap-3 p-2 text-left text-sm rounded-btn ${item.id === productId ? 'bg-brand/10' : 'hover:bg-canvas'}`}>
                    <img src={resolveImageUrl(item.imageUrls.find(ownPhoto)) || ''} alt="" className="h-10 w-10 rounded object-cover bg-canvas" />
                    <span className="min-w-0"><span className="block truncate text-ink">{item.name}</span><span className="block text-xs text-muted">{item.sku}</span></span>
                  </button>
                </li>
              ))}
              {!candidates.length && <li className="p-2 text-sm text-muted">No hay productos con fotos subidas a la tienda.</li>}
            </ul>
          </section>

          <section className="card p-6 space-y-5">
            {!product ? <p className="text-sm text-muted">Elige un producto para empezar.</p> : (
              <>
                <div>
                  <p className="font-bold text-ink">{product.name}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {product.imageUrls.filter(ownPhoto).map((url) => (
                      <button key={url} type="button" onClick={() => { setPhoto(url); setResult(null) }} className={`rounded-btn border-2 ${url === photo ? 'border-brand' : 'border-transparent'}`} aria-label="Usar esta foto">
                        <img src={resolveImageUrl(url) || ''} alt="" className="h-16 w-16 rounded object-cover" />
                      </button>
                    ))}
                  </div>
                </div>
                <fieldset className="grid gap-2 sm:grid-cols-3">
                  <legend className="sr-only">Estilo</legend>
                  {PRESETS.map((item) => (
                    <label key={item.key} className={`cursor-pointer rounded-btn border p-3 text-sm ${preset === item.key ? 'border-brand bg-brand/5' : 'border-line'}`}>
                      <input type="radio" name="preset" className="sr-only" checked={preset === item.key} onChange={() => setPreset(item.key)} />
                      <b className="block text-ink">{item.label}</b><span className="text-muted">{item.detail}</span>
                    </label>
                  ))}
                </fieldset>
                <div className="flex flex-wrap items-center gap-3">
                  <button type="button" className="btn-brand" disabled={!photo || busy !== null} onClick={() => void edit()}>
                    {busy === 'edit' ? <><Loader2 size={16} className="animate-spin" /> Editando… (unos 10 s)</> : <><Wand2 size={16} /> Mejorar foto</>}
                  </button>
                  <span className="text-xs text-muted">{cost?.configured ? `${cost.credits} créditos por foto · tienes ${credits?.balance ?? 0}.` : 'Usa el límite mensual de IA de tu plan.'} Si la IA falla, no se descuenta.</span>
                </div>
                {message && <p role={message.tone === 'error' ? 'alert' : 'status'} className={`flex items-center gap-2 text-sm ${message.tone === 'error' ? 'text-red-700' : 'text-emerald-700'}`}>{message.tone === 'error' ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}{message.text}</p>}
                {(photo || result) && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <figure><img src={resolveImageUrl(photo) || ''} alt="Foto original" className="w-full max-h-96 rounded-btn object-contain bg-canvas" /><figcaption className="mt-1 text-xs text-muted text-center">Original</figcaption></figure>
                    {result && <figure><img src={result.src} alt="Foto mejorada con IA" className="w-full max-h-96 rounded-btn object-contain bg-canvas" /><figcaption className="mt-1 text-xs text-muted text-center">Con IA{result.charged ? ` · ${result.charged} créditos` : ''}</figcaption></figure>}
                  </div>
                )}
                {result && (
                  <div className="space-y-3 rounded-btn border border-amber-200 bg-amber-50 p-4 text-sm">
                    <p className="text-amber-900">Compara con la original: el producto debe verse exactamente igual (forma, colores y detalles). Si algo cambió, descártala para no confundir a tus clientes.</p>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className="btn-brand" disabled={busy !== null} onClick={() => void keep(false)}>{busy === 'save' && <Loader2 size={16} className="animate-spin" />} Agregar al producto</button>
                      <button type="button" className="btn-ghost" disabled={busy !== null} onClick={() => void keep(true)}>Agregar como principal</button>
                      <button type="button" className="btn-ghost" disabled={busy !== null} onClick={() => setResult(null)}>Descartar</button>
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
