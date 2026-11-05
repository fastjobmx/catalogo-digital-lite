import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle, Camera, CheckCircle2, ImagePlus, Loader2, Sparkles, Trash2 } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useCatalog } from '../../contexts/CatalogContext'
import { aiCatalogApi, createCategory, createProduct, creditsApi, uploadImage, type StoreCredits } from '../../services/api'
import { prepareProductPhoto } from '../../lib/imageResize'
import { slugify } from '../../lib/format'
import { parseMoney, parseQuantity } from '../../lib/import/mapping'

type Status = 'uploading' | 'analyzing' | 'ready' | 'saving' | 'saved' | 'error'
type Card = {
  id: string; preview: string; imageUrl: string | null; status: Status; error: string | null
  sku: string; name: string; description: string; category: string; price: string; stock: string
  aiNote: string | null
}
const MAX_PHOTOS = 12
const today = () => new Date().toISOString().slice(2, 10).replace(/-/g, '')

/** Creates products from photos: upload, optional AI suggestion (name, description, category), human review.
 * Price, stock and code always come from the store; the AI never proposes them. */
export default function PhotoProducts() {
  const { token, isDemoSession } = useAuth()
  const { categories, refresh } = useCatalog()
  const [cards, setCards] = useState<Card[]>([])
  const [credits, setCredits] = useState<StoreCredits | null>(null)
  const [useAi, setUseAi] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const counter = useRef(1)
  const createdCategories = useRef(new Map<string, number>())

  useEffect(() => {
    if (!token || isDemoSession) return
    creditsApi.get(token).then(setCredits).catch(() => setCredits(null))
  }, [token, isDemoSession])

  const cost = credits?.costs.find((item) => item.feature === 'foto_a_producto')
  const aiAvailable = Boolean(credits?.aiEnabled) && cost?.enabled !== false
  const patch = (id: string, values: Partial<Card>) => setCards((current) => current.map((card) => card.id === id ? { ...card, ...values } : card))

  const addFiles = async (files: FileList | null) => {
    if (!files?.length || !token) return
    setError(null)
    const chosen = [...files].slice(0, Math.max(0, MAX_PHOTOS - cards.length))
    if (files.length > chosen.length) setError(`Puedes trabajar hasta ${MAX_PHOTOS} fotos a la vez.`)
    const fresh: Card[] = chosen.map((file) => ({ id: crypto.randomUUID(), preview: URL.createObjectURL(file), imageUrl: null, status: 'uploading', error: null, sku: '', name: '', description: '', category: '', price: '', stock: '', aiNote: null }))
    setCards((current) => [...current, ...fresh])
    for (const [index, file] of chosen.entries()) {
      const card = fresh[index]!
      try {
        const uploaded = await uploadImage(await prepareProductPhoto(file), 'products', token)
        patch(card.id, { imageUrl: uploaded.url, status: useAi && aiAvailable ? 'analyzing' : 'ready' })
        if (useAi && aiAvailable) await suggest(card.id, uploaded.url)
      } catch (err) {
        patch(card.id, { status: 'error', error: err instanceof Error ? err.message : 'No se pudo subir la foto.' })
      }
    }
    if (useAi && aiAvailable) creditsApi.get(token).then(setCredits).catch(() => {})
  }

  const suggest = async (id: string, imageUrl: string) => {
    if (!token) return
    patch(id, { status: 'analyzing', error: null })
    try {
      const { suggestion, charged } = await aiCatalogApi.photoToProduct(imageUrl, crypto.randomUUID(), token)
      const match = categories.find((category) => category.name.toLowerCase() === suggestion.category.toLowerCase())
      patch(id, {
        status: 'ready', name: suggestion.name, description: suggestion.description,
        category: match ? String(match.id) : suggestion.category ? `new:${suggestion.category}` : '',
        aiNote: !suggestion.isProductPhoto
          ? 'La IA no reconoció un producto en esta foto. Revisa los datos.'
          : `Sugerido por IA (confianza ${suggestion.confidence})${charged ? ` · ${charged} créditos` : ''}${suggestion.visibleBrand ? ` · marca visible: ${suggestion.visibleBrand}, confírmala antes de usarla` : ''}`,
      })
    } catch (err) {
      patch(id, { status: 'ready', aiNote: null, error: err instanceof Error ? err.message : 'La IA no pudo analizar la foto; completa los datos a mano.' })
    }
  }

  const save = async (card: Card) => {
    if (!token || !card.imageUrl) return
    const price = parseMoney(card.price)
    const stock = card.stock.trim() === '' ? 0 : parseQuantity(card.stock)
    if (!card.sku.trim()) return patch(card.id, { error: 'Escribe el código del producto.' })
    if (!card.name.trim()) return patch(card.id, { error: 'Escribe el nombre.' })
    if (!price) return patch(card.id, { error: 'Escribe el precio.' })
    if (stock === null) return patch(card.id, { error: 'Las existencias deben ser un número entero.' })
    patch(card.id, { status: 'saving', error: null })
    try {
      let categoryId: number | null = card.category && !card.category.startsWith('new:') ? Number(card.category) : null
      if (card.category.startsWith('new:')) {
        const name = card.category.slice(4).trim()
        const slug = slugify(name)
        const existing = categories.find((category) => category.slug === slug)?.id ?? createdCategories.current.get(slug)
        categoryId = existing ?? (await createCategory({ name, slug }, token)).id
        createdCategories.current.set(slug, categoryId)
      }
      await createProduct({ sku: card.sku.trim(), name: card.name.trim(), description: card.description.trim(), categoryId, price, imageUrls: [card.imageUrl], variants: [{ stock }] }, token)
      patch(card.id, { status: 'saved' })
    } catch (err) {
      const message = err instanceof Error ? err.message : ''
      patch(card.id, { status: 'ready', error: /SKU already exists/i.test(message) ? 'Ese código ya existe en tu tienda.' : /plan/i.test(message) ? 'Llegaste al límite de productos de tu plan.' : message || 'No se pudo crear el producto.' })
    }
  }

  const saveAll = async () => {
    for (const card of cards.filter((item) => item.status === 'ready')) await save(card)
    await refresh()
  }

  const pending = cards.filter((card) => card.status === 'ready').length
  const saved = cards.filter((card) => card.status === 'saved').length

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Camera size={15} className="text-brand" />
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand/70">Catálogo</span>
        </div>
        <h1 className="text-3xl font-black tracking-tight text-ink">Productos desde fotos</h1>
        <p className="text-muted text-sm mt-1.5">Sube fotos y crea un producto por cada una. La IA puede sugerir nombre, descripción y categoría; el código, el precio y las existencias los pones tú.</p>
      </div>

      {isDemoSession && <p className="card p-4 text-sm text-muted">Esta función requiere entrar con la cuenta real de tu tienda.</p>}
      {error && <p className="card flex items-center gap-2 p-4 text-sm text-red-700" role="alert"><AlertCircle size={17} />{error}</p>}

      <section className="card p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <label className={`flex items-start gap-2 text-sm ${aiAvailable ? '' : 'opacity-60'}`}>
            <input type="checkbox" className="mt-1" checked={useAi && aiAvailable} disabled={!aiAvailable} onChange={(e) => setUseAi(e.target.checked)} />
            <span>
              <b className="text-ink flex items-center gap-1"><Sparkles size={14} /> Sugerir datos con IA</b>
              <span className="block text-muted">
                {!credits ? 'Comprobando disponibilidad…'
                  : !credits.aiEnabled ? 'La IA está desactivada para tu tienda. Puedes crear los productos a mano.'
                  : cost?.enabled === false ? 'Esta función de IA está pausada por la plataforma.'
                  : cost?.configured ? `${cost.credits} créditos por foto · tienes ${credits.balance}. Si la IA falla, no se descuentan.`
                  : 'Usa el límite mensual de IA de tu plan.'}
              </span>
            </span>
          </label>
          <button type="button" className="btn-brand" disabled={!token || isDemoSession || cards.length >= MAX_PHOTOS} onClick={() => input.current?.click()}><ImagePlus size={18} /> Agregar fotos</button>
          <input ref={input} type="file" multiple accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => { void addFiles(e.target.files); e.target.value = '' }} />
        </div>
        {cards.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4 text-sm">
            <span className="text-muted">{saved} creados · {pending} listos para revisar</span>
            <div className="flex gap-2">
              {saved > 0 && <Link to="/admin/products" className="btn-ghost">Ver productos</Link>}
              <button type="button" className="btn-brand" disabled={!pending} onClick={() => void saveAll()}>Crear los {pending} listos</button>
            </div>
          </div>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {cards.map((card) => (
          <article key={card.id} className={`card p-4 grid gap-4 sm:grid-cols-[9rem_1fr] ${card.status === 'saved' ? 'opacity-70' : ''}`}>
            <div className="relative">
              <img src={card.preview} alt="" className="aspect-square w-full rounded-btn object-cover bg-canvas" />
              {(card.status === 'uploading' || card.status === 'analyzing') && (
                <div className="absolute inset-0 grid place-items-center rounded-btn bg-white/75 text-xs font-bold text-ink">
                  <span className="flex flex-col items-center gap-1"><Loader2 size={18} className="animate-spin" />{card.status === 'uploading' ? 'Subiendo…' : 'La IA está mirando…'}</span>
                </div>
              )}
            </div>
            <div className="space-y-2 min-w-0">
              {card.status === 'saved'
                ? <p className="flex items-center gap-2 font-bold text-emerald-700"><CheckCircle2 size={18} /> {card.name} creado</p>
                : card.status === 'error'
                  ? <p className="text-sm text-red-700">{card.error}</p>
                  : (
                    <>
                      {card.aiNote && <p className="text-xs text-brand">{card.aiNote}</p>}
                      <div className="grid grid-cols-2 gap-2">
                        <label className="block"><span className="text-xs font-bold text-muted">Código *</span>
                          <span className="flex gap-1"><input className="input-field w-full py-1.5" value={card.sku} onChange={(e) => patch(card.id, { sku: e.target.value })} />
                            {!card.sku && <button type="button" title="Crear un código interno" className="text-[11px] underline text-muted whitespace-nowrap" onClick={() => patch(card.id, { sku: `FOTO-${today()}-${counter.current++}` })}>Automático</button>}</span>
                        </label>
                        <label className="block"><span className="text-xs font-bold text-muted">Precio *</span><input className="input-field w-full py-1.5" inputMode="numeric" value={card.price} onChange={(e) => patch(card.id, { price: e.target.value })} /></label>
                      </div>
                      <label className="block"><span className="text-xs font-bold text-muted">Nombre *</span><input className="input-field w-full py-1.5" maxLength={160} value={card.name} onChange={(e) => patch(card.id, { name: e.target.value })} /></label>
                      <label className="block"><span className="text-xs font-bold text-muted">Descripción</span><textarea className="input-field w-full py-1.5" rows={3} maxLength={2000} value={card.description} onChange={(e) => patch(card.id, { description: e.target.value })} /></label>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="block"><span className="text-xs font-bold text-muted">Categoría</span>
                          <select className="input-field w-full py-1.5" value={card.category} onChange={(e) => patch(card.id, { category: e.target.value })}>
                            <option value="">Sin categoría</option>
                            {card.category.startsWith('new:') && <option value={card.category}>Nueva: {card.category.slice(4)}</option>}
                            {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                          </select>
                        </label>
                        <label className="block"><span className="text-xs font-bold text-muted">Existencias</span><input className="input-field w-full py-1.5" inputMode="numeric" placeholder="0" value={card.stock} onChange={(e) => patch(card.id, { stock: e.target.value })} /></label>
                      </div>
                      {card.error && <p className="text-xs text-red-700" role="alert">{card.error}</p>}
                      <div className="flex flex-wrap gap-2 pt-1">
                        <button type="button" className="btn-brand py-1.5" disabled={card.status !== 'ready'} onClick={() => void save(card).then(refresh)}>{card.status === 'saving' && <Loader2 size={14} className="animate-spin" />} Crear producto</button>
                        {aiAvailable && card.imageUrl && card.status === 'ready' && !card.aiNote && <button type="button" className="btn-ghost py-1.5" onClick={() => void suggest(card.id, card.imageUrl!)}><Sparkles size={14} /> Sugerir con IA</button>}
                        <button type="button" className="btn-ghost py-1.5" aria-label="Quitar foto" onClick={() => setCards((current) => current.filter((item) => item.id !== card.id))}><Trash2 size={14} /></button>
                      </div>
                    </>
                  )}
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}
