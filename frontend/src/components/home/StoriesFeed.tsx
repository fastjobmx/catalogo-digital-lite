import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, Eye, ShoppingBag } from 'lucide-react'
import { useStore } from '../../contexts/StoreContext'
import { useCatalog } from '../../contexts/CatalogContext'
import { useCart } from '../../contexts/CartContext'
import { resolveImageUrl } from '../../lib/imageSources'
import { formatMoney, discountPercent } from '../../lib/format'
import type { ProductApi } from '../../services/api'

/** "Stories" storefront: one product per screen, swiped vertically; tapping the sides of a photo
 * moves between that product's photos. Orders use the same cart and WhatsApp checkout as every template. */
export default function StoriesFeed() {
  const { store } = useStore()
  const { products, categories, loading } = useCatalog()
  const [category, setCategory] = useState<string>('all')
  const feed = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number | null>(null)

  // The feed fills the screen below the header. The header can grow after load (web fonts, banner
  // text), so it is measured again whenever anything above the feed changes size.
  useEffect(() => {
    const measure = () => { if (feed.current) setHeight(Math.max(420, Math.round(window.innerHeight - Math.max(0, feed.current.getBoundingClientRect().top + window.scrollY)))) }
    measure()
    window.addEventListener('resize', measure)
    void document.fonts?.ready.then(measure)
    const header = document.querySelector('header')
    const observer = header && 'ResizeObserver' in window ? new ResizeObserver(measure) : null
    if (header) observer?.observe(header)
    return () => { window.removeEventListener('resize', measure); observer?.disconnect() }
  }, [])

  const ordered = useMemo(() => {
    const list = category === 'all' ? products : products.filter((product) => product.categorySlug === category)
    return [...list].sort((a, b) => Number(b.isFeatured) - Number(a.isFeatured))
  }, [products, category])
  const usedCategories = categories.filter((item) => products.some((product) => product.categorySlug === item.slug))

  const step = (direction: 1 | -1) => feed.current?.scrollBy({ top: direction * feed.current.clientHeight, behavior: 'smooth' })

  return (
    <div className="stories-shell bg-[#0c0c0e]">
      <div
        ref={feed}
        style={{ height: height ?? '85vh' }}
        className="stories-feed mx-auto w-full max-w-[30rem] overflow-y-auto snap-y snap-mandatory overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden focus:outline-none"
        tabIndex={0}
        aria-label="Productos de la tienda, uno por pantalla"
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'PageDown') { event.preventDefault(); step(1) }
          if (event.key === 'ArrowUp' || event.key === 'PageUp') { event.preventDefault(); step(-1) }
        }}
      >
        <section className="relative flex h-full snap-start snap-always flex-col items-center justify-center gap-5 px-6 text-center text-white">
          {store.theme.hero.imageUrl && <img src={resolveImageUrl(store.theme.hero.imageUrlMobile || store.theme.hero.imageUrl) || ''} alt="" className="absolute inset-0 h-full w-full object-cover opacity-45" />}
          <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/40 to-black/80" />
          <div className="relative space-y-4">
            {store.logo && <img src={resolveImageUrl(store.logo) || ''} alt="" className="mx-auto h-20 w-20 rounded-full object-cover ring-2 ring-white/80" />}
            <h1 className="text-3xl font-black leading-tight text-balance">{store.theme.hero.title || store.name}</h1>
            {store.theme.hero.subtitle && <p className="text-sm text-white/80 text-balance">{store.theme.hero.subtitle}</p>}
          </div>
          {usedCategories.length > 1 && (
            <div className="relative flex max-w-full flex-wrap justify-center gap-2" role="group" aria-label="Filtrar por categoría">
              {[{ slug: 'all', name: 'Todo' }, ...usedCategories].map((item) => (
                <button key={item.slug} type="button" onClick={() => { setCategory(item.slug); feed.current?.scrollTo({ top: feed.current.clientHeight, behavior: 'smooth' }) }}
                  className={`rounded-full border px-3.5 py-1.5 text-xs font-bold transition ${category === item.slug ? 'border-white bg-white text-black' : 'border-white/50 text-white hover:bg-white/10'}`}>
                  {item.name}
                </button>
              ))}
            </div>
          )}
          <button type="button" onClick={() => step(1)} className="relative mt-2 flex flex-col items-center gap-1 text-xs font-bold uppercase tracking-widest text-white/85" aria-label="Ver el primer producto">
            {loading ? 'Cargando productos…' : ordered.length ? `${ordered.length} productos · desliza` : 'Pronto habrá productos aquí'}
            {ordered.length > 0 && <ChevronDown className="animate-bounce" size={22} aria-hidden="true" />}
          </button>
        </section>

        {ordered.map((product, index) => <StorySlide key={product.id} product={product} position={index + 1} total={ordered.length} eager={index < 2} currency={store.currency} />)}
      </div>
    </div>
  )
}

function StorySlide({ product, position, total, eager, currency }: { product: ProductApi; position: number; total: number; eager: boolean; currency: string }) {
  const { addItem } = useCart()
  const images = (product.imageUrls || []).map(resolveImageUrl).filter((url): url is string => Boolean(url))
  const [index, setIndex] = useState(0)
  const [added, setAdded] = useState(false)
  const variants = product.variants.filter((variant) => variant.isActive !== false)
  const available = variants.filter((variant) => variant.stock > 0)
  const single = variants.length === 1 ? variants[0] : undefined
  const soldOut = available.length === 0
  const off = discountPercent(product.price, product.compareAtPrice)
  const productPath = `/product/${encodeURIComponent(product.sku)}`

  const add = () => {
    if (!single || single.stock < 1) return
    addItem({
      productId: String(product.id), productSku: product.sku, variantId: String(single.id), sku: single.sku, name: product.name,
      price: single.priceOverride ?? product.price, compareAtPrice: product.compareAtPrice ?? undefined, image: images[0] ?? null,
      size: single.size ?? undefined, color: single.color ?? undefined, availableStock: single.stock,
    }, 1)
    setAdded(true)
    document.dispatchEvent(new CustomEvent('open-cart'))
    setTimeout(() => setAdded(false), 1800)
  }

  return (
    <article className="relative h-full snap-start snap-always overflow-hidden bg-black text-white" aria-label={`${product.name}, producto ${position} de ${total}`}>
      {images.length > 0
        ? <img src={images[index]} alt={product.name} loading={eager ? 'eager' : 'lazy'} decoding="async" className="absolute inset-0 h-full w-full object-cover" />
        : <div className="absolute inset-0 grid place-items-center text-sm text-white/60">Sin foto</div>}
      {images.length > 1 && (
        <>
          <button type="button" className="absolute inset-y-0 left-0 w-1/3" aria-label="Foto anterior" onClick={() => setIndex((current) => (current - 1 + images.length) % images.length)} />
          <button type="button" className="absolute inset-y-0 right-0 w-1/3" aria-label="Foto siguiente" onClick={() => setIndex((current) => (current + 1) % images.length)} />
          <div className="pointer-events-none absolute right-3 top-1/2 flex -translate-y-1/2 flex-col gap-1.5" aria-hidden="true">
            {images.map((_, dot) => <span key={dot} className={`w-1.5 rounded-full transition-all ${dot === index ? 'h-5 bg-white' : 'h-1.5 bg-white/50'}`} />)}
          </div>
        </>
      )}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-black/90 via-black/45 to-transparent" />
      <span className="absolute left-4 top-4 rounded-full bg-black/45 px-2.5 py-1 text-[11px] font-bold tabular-nums backdrop-blur">{position}/{total}</span>
      <div className="absolute inset-x-0 bottom-0 space-y-3 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pr-20">
        {product.categoryName && <p className="text-[11px] font-bold uppercase tracking-widest text-white/70">{product.categoryName}</p>}
        <h2 className="text-2xl font-black leading-tight text-balance">{product.name}</h2>
        <p className="flex flex-wrap items-baseline gap-2">
          <span className="text-xl font-bold tabular-nums">{formatMoney(single?.priceOverride ?? product.price, currency)}</span>
          {off && product.compareAtPrice && <span className="text-sm text-white/60 line-through tabular-nums">{formatMoney(product.compareAtPrice, currency)}</span>}
          {off && <span className="rounded-full bg-[var(--color-accent,#FFC24B)] px-2 py-0.5 text-[11px] font-black text-black">-{off}%</span>}
          {soldOut && <span className="rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-bold">Agotado</span>}
        </p>
        <div className="flex flex-wrap gap-2">
          {single && !soldOut
            ? <button type="button" onClick={add} className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-black text-black active:scale-[0.98]"><ShoppingBag size={16} aria-hidden="true" /> {added ? 'Añadido' : 'Añadir al pedido'}</button>
            : !soldOut && <Link to={productPath} className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-black text-black"><ShoppingBag size={16} aria-hidden="true" /> Elegir opción</Link>}
          <Link to={productPath} className="inline-flex items-center gap-2 rounded-full border border-white/60 px-4 py-2.5 text-sm font-bold text-white hover:bg-white/10"><Eye size={16} aria-hidden="true" /> Ver detalles</Link>
        </div>
      </div>
    </article>
  )
}
