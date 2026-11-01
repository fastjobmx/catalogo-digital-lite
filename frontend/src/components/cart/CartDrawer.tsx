import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { X, Plus, Minus, Trash2, MessageCircle, ShoppingBag, ArrowRight } from 'lucide-react'
import { useCart } from '../../contexts/CartContext'
import { useStore } from '../../contexts/StoreContext'
import { useCatalog } from '../../contexts/CatalogContext'
import { createOrder, getProducts } from '../../services/api'
import { formatMoney } from '../../lib/format'
import { buildWhatsAppOrderMessage, whatsappLink } from '../../lib/whatsapp'
import type { CartItem } from '../../contexts/CartContext'

export default function CartDrawer() {
  const { items, removeItem, updateQuantity, subtotal, clearCart, syncItems } = useCart()
  const { store, backendAvailable } = useStore()
  const { products } = useCatalog()
  const [isOpen, setIsOpen] = useState(false)
  const [customerName, setCustomerName] = useState('')
  const [deliveryInfo, setDeliveryInfo] = useState('')
  const [checkoutBusy, setCheckoutBusy] = useState(false)
  const [checkoutMessage, setCheckoutMessage] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)

  useEffect(() => {
    const handleOpen = () => setIsOpen(true)
    document.addEventListener('open-cart', handleOpen)
    return () => document.removeEventListener('open-cart', handleOpen)
  }, [])

  useEffect(() => {
    document.body.style.overflow = isOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [isOpen])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const handleWhatsAppCheckout = async () => {
    if (checkoutBusy || items.length === 0) return
    const phone = store.whatsappOrders || store.whatsappPhone
    if (!whatsappLink(phone)) {
      setCheckoutMessage('El comercio aún no configuró un número válido de WhatsApp.')
      return
    }

    // Abrimos la pestaña en el gesto del usuario y la redirigimos al terminar
    // la validación para evitar que el navegador bloquee el enlace.
    const whatsappWindow = window.open('about:blank', '_blank')
    if (!whatsappWindow) {
      setCheckoutMessage('Permite las ventanas emergentes para abrir WhatsApp.')
      return
    }

    setCheckoutBusy(true)
    setCheckoutMessage('Verificando precios y disponibilidad…')
    try {
      const currentProducts = backendAvailable ? await getProducts(undefined, { cache: 'no-store' }) : products
      let needsReview = false
      const currentItems: CartItem[] = items.map((item) => {
        const product = currentProducts.find((candidate) =>
          String(candidate.id) === item.productId
          || candidate.sku === item.productSku
          || item.sku === candidate.sku
          || item.sku.startsWith(`${candidate.sku}-`),
        )
        const variant = product?.variants.find((candidate) =>
          candidate.isActive !== false
          && (String(candidate.id) === item.variantId || candidate.sku === item.sku),
        )
        if (!product || !variant) {
          needsReview = true
          return { ...item, availableStock: 0 }
        }

        const availableStock = Math.max(0, variant.stock)
        const quantity = availableStock > 0 ? Math.min(item.quantity, availableStock) : item.quantity
        const price = variant.priceOverride ?? product.price
        if (quantity !== item.quantity || availableStock === 0 || price !== item.price || product.name !== item.name) needsReview = true
        return {
          ...item,
          productId: String(product.id),
          productSku: product.sku,
          variantId: String(variant.id),
          sku: variant.sku,
          name: product.name,
          price,
          compareAtPrice: product.compareAtPrice ?? undefined,
          image: product.imageUrls[0] ?? item.image,
          size: variant.size ?? undefined,
          color: variant.color ?? undefined,
          availableStock,
          quantity,
        }
      })

      syncItems(currentItems)
      if (needsReview) {
        whatsappWindow.close()
        setCheckoutMessage('El precio o el stock cambió. Revisa el carrito actualizado y vuelve a preparar el pedido.')
        return
      }

      const message = buildWhatsAppOrderMessage({
        items: currentItems,
        currency: store.currency,
        customerName: customerName || undefined,
        deliveryInfo: deliveryInfo || undefined,
      })
      const url = whatsappLink(phone, message)
      if (!url) throw new Error('No se pudo construir el enlace de WhatsApp.')
      whatsappWindow.opener = null
      whatsappWindow.location.href = url

      // Se registra como solicitud pendiente; abrir WhatsApp no confirma compra.
      if (backendAvailable) {
        void createOrder({
          customerName: customerName || undefined,
          deliveryAddress: deliveryInfo || undefined,
          currency: store.currency,
          notes: 'Solicitud preparada para WhatsApp; pendiente de confirmación.',
          items: currentItems.map((item) => ({
            productId: String(item.productId),
            variantId: item.variantId ? String(item.variantId) : undefined,
            sku: item.sku,
            name: item.name,
            price: item.price,
            size: item.size,
            color: item.color,
            quantity: item.quantity,
          })),
        }).catch(() => { /* la preparación por WhatsApp sigue disponible */ })
      }
      setCheckoutMessage('WhatsApp está listo. El comercio confirma el pedido en esa conversación.')
    } catch {
      whatsappWindow.close()
      setCheckoutMessage('No pudimos verificar el inventario. Inténtalo de nuevo antes de enviar el pedido.')
    } finally {
      setCheckoutBusy(false)
    }
  }

  if (!isOpen) return null

  const totalItems = items.reduce((s, i) => s + i.quantity, 0)
  const containsUnavailableItem = items.some((item) => item.availableStock === 0)

  return (
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-black/45 backdrop-blur-sm animate-fade-in"
        onClick={() => setIsOpen(false)}
      />

      <div className="absolute right-0 top-0 bottom-0 w-full sm:max-w-md bg-surface shadow-2xl flex flex-col animate-slide-in-right">
        {/* Cabecera */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <h2 className="flex items-center gap-2 text-lg font-bold text-ink">
            <ShoppingBag size={20} className="text-brand" />
            Tu carrito
            {totalItems > 0 && <span className="text-sm font-medium text-muted">({totalItems})</span>}
          </h2>
          <button
            onClick={() => setIsOpen(false)}
            className="p-2 rounded-btn hover:bg-canvas transition-colors text-ink"
            aria-label="Cerrar carrito"
          >
            <X size={20} />
          </button>
        </div>

        {/* Artículos */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {items.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center py-12">
              <span className="grid place-items-center w-16 h-16 rounded-full bg-canvas text-muted mb-4">
                <ShoppingBag size={28} />
              </span>
              <p className="text-ink font-semibold">Tu carrito está vacío</p>
              <p className="text-sm text-muted mt-1 mb-6">Agrega productos para comenzar tu pedido.</p>
              <button onClick={() => setIsOpen(false)} className="btn-brand">
                Ver productos
              </button>
            </div>
          ) : (
            items.map((item) => {
              const productSlug = item.productSku || products.find((product) =>
                product.variants.some((variant) => variant.sku === item.sku),
              )?.sku || item.sku
              return (
              <div
                key={`${item.productId}-${item.variantId}`}
                className="flex gap-3 p-3 rounded-card border border-line bg-canvas/60"
              >
                <div className="w-20 h-20 rounded-btn overflow-hidden bg-canvas shrink-0">
                  {item.image ? (
                    <img src={item.image} alt={item.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full grid place-items-center text-muted text-xs">Sin foto</div>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      to={`/product/${encodeURIComponent(productSlug)}`}
                      onClick={() => setIsOpen(false)}
                      className="font-semibold text-ink text-sm leading-snug line-clamp-2 hover:text-brand transition-colors"
                    >
                      {item.name}
                    </Link>
                    <button
                      onClick={() => removeItem(item.productId, item.variantId)}
                      className="p-1 text-muted hover:text-red-500 transition-colors shrink-0"
                      aria-label="Eliminar"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>

                  {(item.size || item.color) && (
                    <p className="text-xs text-muted mt-0.5">
                      {[item.size, item.color].filter(Boolean).join(' · ')}
                    </p>
                  )}
                  {item.availableStock === 0 && (
                    <p className="text-xs text-red-600 mt-1" role="status">Sin stock. Elimina este artículo para continuar.</p>
                  )}

                  <div className="flex items-center justify-between mt-2.5">
                    <div className="flex items-center rounded-btn border border-line bg-surface h-9">
                      <button
                        onClick={() => updateQuantity(item.productId, item.variantId, item.quantity - 1)}
                        className="grid place-items-center w-8 h-full text-ink hover:bg-canvas rounded-l-btn transition-colors"
                        aria-label="Restar"
                      >
                        <Minus size={14} />
                      </button>
                      <span className="w-8 text-center text-sm font-semibold tabular-nums text-ink">{item.quantity}</span>
                      <button
                        onClick={() => updateQuantity(item.productId, item.variantId, item.quantity + 1)}
                        disabled={item.availableStock !== undefined && item.quantity >= item.availableStock}
                        className="grid place-items-center w-8 h-full text-ink hover:bg-canvas rounded-r-btn transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        aria-label="Sumar"
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                    <span className="text-sm font-bold text-ink tabular-nums">
                      {formatMoney(item.price * item.quantity, store.currency)}
                    </span>
                  </div>
                </div>
              </div>
              )
            })
          )}
        </div>

        {/* Pie */}
        {items.length > 0 && (
          <div className="border-t border-line p-5 space-y-4 bg-surface">
            <div className="space-y-2">
              <input
                type="text"
                placeholder="Tu nombre (opcional)"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="input-field text-sm"
              />
              <input
                type="text"
                placeholder="Dirección o ciudad de entrega (opcional)"
                value={deliveryInfo}
                onChange={(e) => setDeliveryInfo(e.target.value)}
                className="input-field text-sm"
              />
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted">Subtotal de productos</span>
                <span className="font-semibold text-ink tabular-nums">{formatMoney(subtotal, store.currency)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-ink">Total estimado</span>
                <span className="text-xl font-bold text-ink tabular-nums">{formatMoney(subtotal, store.currency)}</span>
              </div>
              <p className="text-[11px] text-muted">El valor del envío se confirma con el comercio por WhatsApp.</p>
            </div>

            <button
              onClick={handleWhatsAppCheckout}
              disabled={checkoutBusy || containsUnavailableItem}
              className="w-full inline-flex items-center justify-center gap-2 bg-[#25D366] text-white
                         min-h-[48px] rounded-btn font-semibold hover:brightness-95 active:scale-[0.99] transition-all
                         disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <MessageCircle size={20} fill="currentColor" />
              {checkoutBusy ? 'Verificando…' : 'Enviar pedido por WhatsApp'}
            </button>
            {checkoutMessage && <p className="text-xs text-muted" role="status">{checkoutMessage}</p>}

            <div className="flex items-center justify-between text-xs">
              {confirmClear ? (
                <span className="inline-flex items-center gap-2">
                  <span className="text-ink">¿Vaciar el carrito?</span>
                  <button onClick={() => setConfirmClear(false)} className="text-muted hover:text-ink">Cancelar</button>
                  <button onClick={() => { clearCart(); setConfirmClear(false) }} className="font-semibold text-red-600">Vaciar</button>
                </span>
              ) : (
                <button
                  onClick={() => setConfirmClear(true)}
                  className="text-muted hover:text-red-500 transition-colors"
                >
                  Vaciar carrito
                </button>
              )}
              <Link
                to="/category/all"
                onClick={() => setIsOpen(false)}
                className="inline-flex items-center gap-1 font-semibold text-ink hover:text-brand transition-colors"
              >
                Seguir comprando <ArrowRight size={13} />
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
