import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Minus, Plus, Truck, ShieldCheck, RefreshCw, MessageCircle, ChevronRight, Check, X, ZoomIn } from 'lucide-react'
import { useCatalog } from '../contexts/CatalogContext'
import { useCart } from '../contexts/CartContext'
import { useStore } from '../contexts/StoreContext'
import ProductImage from '../components/ProductImage'
import PriceTag from '../components/PriceTag'
import ProductCard from '../components/ProductCard'
import { buildWhatsAppOrderMessage, whatsappLink } from '../lib/whatsapp'
import { createOrder, getProduct, type ProductApi } from '../services/api'
import { resolveImageUrl } from '../lib/imageSources'
import { IS_PUBLIC_DEMO } from '../lib/publicDemo'

type ProductLookup =
  | { sku: string; status: 'loading' }
  | { sku: string; status: 'ready'; product: ProductApi }
  | { sku: string; status: 'error' }

export default function ProductPage() {
  const { slug } = useParams()
  const { getBySku, products, loading, refresh } = useCatalog()
  const { addItem } = useCart()
  const { store, backendAvailable } = useStore()
  let requestedSku = slug || ''
  try { requestedSku = decodeURIComponent(requestedSku) } catch { /* use the route value as provided */ }
  const listedProduct = getBySku(requestedSku)
  const [productLookup, setProductLookup] = useState<ProductLookup | null>(null)
  const lookupForRoute = productLookup?.sku.toLocaleLowerCase('en-US') === requestedSku.toLocaleLowerCase('en-US')
    ? productLookup
    : null
  const product = listedProduct ?? (lookupForRoute?.status === 'ready' ? lookupForRoute.product : undefined)
  const productLoading = loading || (!listedProduct && backendAvailable && (!lookupForRoute || lookupForRoute.status === 'loading'))
  const galleryImages = product
    ? (product.imageUrls || []).map(resolveImageUrl).filter((url): url is string => Boolean(url))
    : []
  const [imageIndex, setImageIndex] = useState(0)
  const [variantId, setVariantId] = useState<number | undefined>()
  const [qty, setQty] = useState(1)
  const [added, setAdded] = useState(false)
  const [zoomOn, setZoomOn] = useState(false)
  const [origin, setOrigin] = useState({ x: 50, y: 50 })
  const [lightbox, setLightbox] = useState(false)
  const [whatsappBusy, setWhatsappBusy] = useState(false)
  const [whatsappNotice, setWhatsappNotice] = useState('')

  useEffect(() => {
    if (!requestedSku || listedProduct || loading || !backendAvailable) return
    let current = true
    setProductLookup({ sku: requestedSku, status: 'loading' })
    getProduct(requestedSku)
      .then((result) => {
        if (current) setProductLookup({ sku: requestedSku, status: 'ready', product: result })
      })
      .catch(() => {
        if (current) setProductLookup({ sku: requestedSku, status: 'error' })
      })
    return () => { current = false }
  }, [backendAvailable, listedProduct, loading, requestedSku])

  useEffect(() => {
    setImageIndex(0)
    setVariantId(undefined)
    setQty(1)
    setAdded(false)
    setLightbox(false)
    setZoomOn(false)
  }, [product?.sku])

  useEffect(() => {
    if (!lightbox) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setLightbox(false) }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [lightbox])

  const handleZoomMove = (e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    setOrigin({
      x: ((e.clientX - rect.left) / rect.width) * 100,
      y: ((e.clientY - rect.top) / rect.height) * 100,
    })
  }

  const variant = useMemo(() => {
    if (!product) return undefined
    const activeVariants = product.variants.filter((v) => v.isActive !== false)
    return activeVariants.find((v) => v.id === variantId) ?? activeVariants.find((v) => v.stock > 0) ?? activeVariants[0]
  }, [product, variantId])

  const price = variant?.priceOverride ?? product?.price ?? 0
  const stock = variant?.stock ?? 0

  const related = useMemo(
    () => (product ? products.filter((p) => p.id !== product.id && p.categoryId === product.categoryId).slice(0, 4) : []),
    [products, product],
  )

  if (productLoading && !product) {
    return (
      <div className="shell section">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
          <div className="skeleton aspect-square" />
          <div className="space-y-4">
            <div className="skeleton h-8 w-3/4 rounded-md" />
            <div className="skeleton h-6 w-1/3 rounded-md" />
            <div className="skeleton h-24 w-full rounded-card" />
          </div>
        </div>
      </div>
    )
  }

  if (!product) {
    return (
      <div className="shell section max-w-xl text-center">
        <h1 className="text-2xl font-extrabold mb-2 text-ink">Producto no encontrado</h1>
        <p className="text-muted mb-6">
          {lookupForRoute?.status === 'error'
            ? `No pudimos cargar la ficha de ${requestedSku}. Vuelve al catálogo e inténtalo de nuevo.`
            : `La referencia ${requestedSku} no existe o está archivada.`}
        </p>
        <Link to="/" className="btn-brand inline-flex">Volver al inicio</Link>
      </div>
    )
  }

  const soldOut = !variant || stock < 1

  const handleAdd = () => {
    if (!variant || soldOut) return
    addItem({
      productId: String(product.id),
      productSku: product.sku,
      variantId: String(variant.id),
      sku: variant.sku,
      name: product.name,
      price,
      compareAtPrice: product.compareAtPrice ?? undefined,
      image: galleryImages[0] ?? null,
      size: variant.size ?? undefined,
      color: variant.color ?? undefined,
      availableStock: variant.stock,
    }, qty)
    setAdded(true)
    document.dispatchEvent(new CustomEvent('open-cart'))
    setTimeout(() => setAdded(false), 2000)
  }

  const activeVariants = product.variants.filter((v) => v.isActive !== false)
  const variantSize = (v: typeof product.variants[number]) => v.size || v.name
  const sizes = [...new Set(activeVariants.map(variantSize).filter(Boolean))]
  const colors = [...new Set(activeVariants.map((v) => v.color).filter((color): color is string => Boolean(color)))]
  const selectSize = (size: string) => {
    const candidates = activeVariants.filter((v) => variantSize(v) === size)
    const next = candidates.find((v) => v.color === variant?.color && v.stock > 0)
      ?? candidates.find((v) => v.stock > 0)
      ?? candidates[0]
    setVariantId(next?.id)
    setQty(1)
  }
  const selectColor = (color: string) => {
    const selectedSize = variant ? variantSize(variant) : undefined
    const candidates = activeVariants.filter((v) => v.color === color)
    const next = candidates.find((v) => variantSize(v) === selectedSize && v.stock > 0)
      ?? candidates.find((v) => v.stock > 0)
      ?? candidates[0]
    setVariantId(next?.id)
    setQty(1)
  }

  const handleProductWhatsApp = async () => {
    if (IS_PUBLIC_DEMO) {
      setWhatsappNotice('Esta demo no acepta pedidos ni pagos.')
      return
    }
    if (!variant || soldOut || whatsappBusy) return
    const phone = store.whatsappOrders || store.whatsappPhone
    if (!whatsappLink(phone)) {
      setWhatsappNotice('El comercio aún no configuró un número válido de WhatsApp.')
      return
    }
    const popup = window.open('about:blank', '_blank')
    if (!popup) {
      setWhatsappNotice('Permite las ventanas emergentes para abrir WhatsApp.')
      return
    }
    setWhatsappBusy(true)
    setWhatsappNotice('Verificando precio y disponibilidad…')
    try {
      const currentProduct = backendAvailable
        ? await getProduct(product.sku, { cache: 'no-store' })
        : product
      const currentVariant = currentProduct.variants.find((candidate) =>
        candidate.sku === variant.sku || String(candidate.id) === String(variant.id),
      )
      if (!currentVariant || currentVariant.isActive === false || currentVariant.stock < 1) {
        popup.close()
        setWhatsappNotice('Esta variante ya no tiene stock. Actualizamos la ficha para que revises las opciones disponibles.')
        if (backendAvailable) await refresh()
        return
      }
      const currentPrice = currentVariant.priceOverride ?? currentProduct.price
      if (currentVariant.stock < qty || currentPrice !== price) {
        popup.close()
        setVariantId(currentVariant.id)
        setQty(Math.max(1, Math.min(qty, currentVariant.stock)))
        setWhatsappNotice('El precio o el stock cambió. Revisa los datos actualizados y vuelve a preparar el pedido.')
        if (backendAvailable) await refresh()
        return
      }

      const item = {
        productId: String(currentProduct.id),
        productSku: currentProduct.sku,
        variantId: String(currentVariant.id),
        sku: currentVariant.sku,
        name: currentProduct.name,
        price: currentPrice,
        image: resolveImageUrl(currentProduct.imageUrls?.[0]) ?? null,
        size: currentVariant.size ?? undefined,
        color: currentVariant.color ?? undefined,
        availableStock: currentVariant.stock,
        quantity: qty,
      }
      const message = buildWhatsAppOrderMessage({ items: [item], currency: store.currency })
      const url = whatsappLink(phone, message)
      if (!url) throw new Error('WhatsApp no está configurado para este comercio.')
      popup.opener = null
      popup.location.href = url
      if (backendAvailable) {
        void createOrder({
          currency: store.currency,
          notes: 'Solicitud preparada para WhatsApp; pendiente de confirmación.',
          items: [{
            productId: item.productId,
            variantId: item.variantId,
            sku: item.sku,
            name: item.name,
            price: item.price,
            size: item.size,
            color: item.color,
            quantity: item.quantity,
          }],
        }).catch(() => { /* el enlace de WhatsApp queda disponible */ })
      }
      setWhatsappNotice('WhatsApp está listo. El comercio confirma el pedido en esa conversación.')
    } catch {
      popup.close()
      setWhatsappNotice('No pudimos verificar el inventario. Inténtalo de nuevo antes de enviar el pedido.')
    } finally {
      setWhatsappBusy(false)
    }
  }

  return (
    <div className="shell py-8 lg:py-12">
      {/* Migas de pan */}
      <nav className="flex items-center gap-1.5 text-sm text-muted mb-8 flex-wrap" aria-label="Ruta">
        <Link to="/" className="hover:text-brand transition-colors">Inicio</Link>
        {product.categorySlug && (
          <>
            <ChevronRight size={14} className="text-line" />
            <Link to={`/category/${product.categorySlug}`} className="hover:text-brand transition-colors">
              {product.categoryName}
            </Link>
          </>
        )}
        <ChevronRight size={14} className="text-line" />
        <span className="text-ink font-medium truncate max-w-[12rem]">{product.name}</span>
      </nav>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16">
        {/* Galería */}
        <div className="space-y-3 lg:sticky lg:top-32 lg:self-start">
          <button
            type="button"
            onClick={() => setLightbox(true)}
            onMouseEnter={() => setZoomOn(true)}
            onMouseLeave={() => setZoomOn(false)}
            onMouseMove={handleZoomMove}
            aria-label="Ampliar imagen"
            className="relative block w-full overflow-hidden rounded-card cursor-zoom-in group"
          >
            <div
              className="transition-transform duration-200 ease-out"
              style={zoomOn ? { transform: 'scale(1.9)', transformOrigin: `${origin.x}% ${origin.y}%` } : undefined}
            >
              <ProductImage src={galleryImages[imageIndex] ?? galleryImages[0] ?? null} alt={product.name} ratio="1:1" priority />
            </div>
            <span className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-full bg-ink/70 text-canvas text-[11px] font-semibold px-3 py-1.5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
              <ZoomIn size={13} /> Ampliar
            </span>
          </button>
          {galleryImages.length > 1 && (
            <div className="grid grid-cols-5 gap-2.5">
              {galleryImages.map((url, i) => (
                <button
                  key={url}
                  type="button"
                  onClick={() => setImageIndex(i)}
                  aria-label={`Imagen ${i + 1}`}
                  className={`rounded-btn overflow-hidden border-2 transition-all ${
                    i === imageIndex ? 'border-brand' : 'border-transparent opacity-70 hover:opacity-100'
                  }`}
                >
                  <ProductImage src={url} alt="" ratio="1:1" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Información */}
        <div className="space-y-6">
          <div className="space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              {product.brand && (
                <span className="text-xs font-bold uppercase tracking-[0.14em] text-brand">{product.brand}</span>
              )}
              {product.isFeatured && <span className="badge badge-featured">Destacado</span>}
            </div>
            <h1 className="text-3xl sm:text-4xl font-extrabold text-ink leading-tight">{product.name}</h1>
            <p className="text-xs text-muted">SKU: {product.sku}{variant ? ` · ${variant.sku}` : ''}</p>
          </div>

          <PriceTag price={price} compareAt={product.compareAtPrice} currency={store.currency} large />

          {product.description && (
            <p className="text-muted leading-relaxed">{product.description}</p>
          )}

          {/* Tallas */}
          {sizes.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2.5">
                <label className="text-sm font-semibold text-ink">Talla</label>
                <span className="text-xs text-muted">Guía de tallas disponible por WhatsApp</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {sizes.map((size) => {
                  const candidates = activeVariants.filter((v) => variantSize(v) === size)
                  const availableWithColor = candidates.filter((v) => v.color === (variant?.color ?? null))
                  const disabled = !(availableWithColor.some((v) => v.stock > 0) || candidates.some((v) => v.stock > 0))
                  const active = Boolean(variant && variantSize(variant) === size)
                  return (
                    <button
                      key={size}
                      type="button"
                      disabled={disabled}
                      onClick={() => selectSize(size)}
                      aria-pressed={active}
                      className={`min-w-[3.25rem] min-h-[44px] px-4 rounded-btn text-sm font-semibold border transition-all ${
                        active
                          ? 'border-brand bg-brand text-brand-foreground'
                          : disabled
                            ? 'border-line text-muted line-through opacity-50 cursor-not-allowed'
                            : 'border-line text-ink hover:border-brand hover:text-brand'
                      }`}
                    >
                      {size}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {colors.length > 0 && (
            <div>
              <p className="text-sm font-semibold text-ink mb-2">Color</p>
              <div className="flex flex-wrap gap-2">
                {colors.map((color) => {
                  const candidates = activeVariants.filter((v) => v.color === color)
                  const matchingSize = candidates.find((v) => variant && variantSize(v) === variantSize(variant) && v.stock > 0)
                  const available = Boolean(matchingSize || candidates.some((v) => v.stock > 0))
                  const active = variant?.color === color
                  return (
                    <button
                      key={color}
                      type="button"
                      disabled={!available}
                      onClick={() => selectColor(color)}
                      aria-pressed={active}
                      className={`min-h-[44px] px-4 rounded-btn text-sm border transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                        active ? 'border-brand bg-brand text-brand-foreground' : 'border-line text-ink hover:border-brand'
                      }`}
                    >
                      {color}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Disponibilidad */}
          <div className="flex items-center gap-2 text-sm">
            <span className={`w-2 h-2 rounded-full ${soldOut ? 'bg-red-500' : stock <= 5 ? 'bg-amber-500' : 'bg-emerald-500'}`} />
            <span className={soldOut ? 'text-red-600 font-medium' : 'text-muted'}>
              {soldOut ? 'Sin stock en esta variante' : stock <= 5 ? `¡Solo quedan ${stock} unidades!` : `${stock} unidades disponibles`}
            </span>
          </div>

          {/* Cantidad + acciones */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="inline-flex items-center rounded-btn border border-line bg-surface h-[44px]">
              <button
                type="button"
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                disabled={qty <= 1}
                className="grid place-items-center w-11 h-full text-ink disabled:opacity-30 hover:bg-canvas rounded-l-btn transition-colors"
                aria-label="Restar"
              >
                <Minus size={16} />
              </button>
              <span className="w-10 text-center text-sm font-semibold tabular-nums text-ink">{qty}</span>
              <button
                type="button"
                onClick={() => setQty((q) => Math.min(stock, q + 1))}
                disabled={qty >= stock}
                className="grid place-items-center w-11 h-full text-ink disabled:opacity-30 hover:bg-canvas rounded-r-btn transition-colors"
                aria-label="Sumar"
              >
                <Plus size={16} />
              </button>
            </div>

            <button
              type="button"
              disabled={soldOut}
              onClick={handleAdd}
              className="btn-brand flex-1 min-h-[44px] disabled:opacity-50"
            >
              {added ? (<><Check size={18} /> Añadido al carrito</>) : soldOut ? 'Agotado' : 'Añadir al carrito'}
            </button>

            {!IS_PUBLIC_DEMO && <button
              type="button"
              onClick={() => void handleProductWhatsApp()}
              disabled={soldOut || whatsappBusy}
              className="inline-flex items-center justify-center gap-2 min-h-[44px] px-5 rounded-btn
                         bg-[#25D366] text-white font-semibold hover:brightness-95 transition-all
                         disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <MessageCircle size={18} fill="currentColor" />
              <span>{whatsappBusy ? 'Verificando…' : 'Pedir por WhatsApp'}</span>
            </button>}
          </div>

          {IS_PUBLIC_DEMO
            ? <p className="text-xs font-semibold text-muted" role="status">Producto de demostración. No se aceptan pedidos ni pagos.</p>
            : <p className="text-xs text-muted">
            El pedido se abre en WhatsApp y no se envía hasta que tú lo confirmes en la conversación.
            </p>}
          {whatsappNotice && <p className="text-xs text-muted" role="status">{whatsappNotice}</p>}

          {/* Garantías */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
            {[
              { Icon: Truck, title: 'Entrega', text: store.deliveryMethods.length ? 'Confirma cobertura y tiempos por WhatsApp' : 'Consulta disponibilidad por WhatsApp' },
              { Icon: ShieldCheck, title: 'Formas de pago', text: store.paymentInfo || 'Confirma las opciones por WhatsApp' },
              { Icon: RefreshCw, title: store.pickupAvailable ? 'Retiro disponible' : 'Entrega coordinada', text: store.pickupAvailable ? 'Confirma el punto de retiro' : 'Coordina por WhatsApp' },
            ].map(({ Icon, title, text }) => (
              <div key={title} className="flex items-center gap-3 rounded-card border border-line p-3.5">
                <Icon size={20} className="text-brand shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-ink truncate">{title}</p>
                  <p className="text-[11px] text-muted truncate">{text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Relacionados */}
      {related.length > 0 && (
        <section className="section">
          <div className="flex items-end justify-between gap-4 mb-8">
            <h2 className="text-2xl font-extrabold text-ink">También te puede interesar</h2>
            {product.categorySlug && (
              <Link to={`/category/${product.categorySlug}`} className="text-sm font-semibold text-ink hover:text-brand transition-colors">
                Ver categoría
              </Link>
            )}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-grid">
            {related.map((p) => <ProductCard key={p.id} product={p} />)}
          </div>
        </section>
      )}

      {/* Visor a pantalla completa */}
      {lightbox && galleryImages[imageIndex] && (
        <div
          className="fixed inset-0 z-[60] bg-ink/95 flex items-center justify-center p-4 animate-fade-in"
          onClick={() => setLightbox(false)}
          role="dialog"
          aria-modal="true"
          aria-label={`Imagen ampliada de ${product.name}`}
        >
          <button
            type="button"
            onClick={() => setLightbox(false)}
            aria-label="Cerrar"
            className="absolute top-4 right-4 grid place-items-center w-11 h-11 rounded-full bg-canvas/10 text-canvas hover:bg-canvas/20 transition-colors"
          >
            <X size={22} />
          </button>
          <img
            src={galleryImages[imageIndex]}
            alt={product.name}
            className="max-h-full max-w-full object-contain rounded-card"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  )
}
