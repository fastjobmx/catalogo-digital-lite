import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { X, Plus, Minus, Trash2, MessageCircle, ShoppingBag, ArrowRight, CreditCard } from 'lucide-react'
import { useCart } from '../../contexts/CartContext'
import { useStore } from '../../contexts/StoreContext'
import { useCatalog } from '../../contexts/CatalogContext'
import { ApiRequestError, createBoldCheckout, createOrder, getProducts, validateCoupon, type BoldButtonData } from '../../services/api'
import { mountBoldButton, rememberBoldPayment } from '../../lib/bold'
import { formatMoney } from '../../lib/format'
import { buildWhatsAppOrderMessage, getCheckoutIdempotencyKey, goToWhatsApp, prepareWhatsAppTab, productPageUrl, shouldOpenWhatsAppInSameTab, whatsappLink } from '../../lib/whatsapp'
import { canSharePhotos, recordBuyerAction } from '../../lib/orderShare'
import { TENANT_SLUG } from '../../lib/tenant'
import { OrderSendPanel, type OrderSendState } from '../orders/OrderSendPanel'
import type { CartItem } from '../../contexts/CartContext'
import { IS_PUBLIC_DEMO } from '../../lib/publicDemo'

export default function CartDrawer() {
  const { items, removeItem, updateQuantity, subtotal, clearCart, syncItems } = useCart()
  const { store, backendAvailable } = useStore()
  const { products } = useCatalog()
  const [isOpen, setIsOpen] = useState(false)
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')
  const [customerCity, setCustomerCity] = useState('')
  const [deliveryInfo, setDeliveryInfo] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('')
  const [customerNotes, setCustomerNotes] = useState('')
  const [checkoutBusy, setCheckoutBusy] = useState(false)
  const [checkoutMessage, setCheckoutMessage] = useState('')
  // Manual fallback when the automatic jump to WhatsApp is blocked (popup blockers, in-app browsers).
  const [sendState, setSendState] = useState<OrderSendState | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [couponInput, setCouponInput] = useState('')
  const [coupon, setCoupon] = useState<{ code: string; discount: number } | null>(null)
  const [couponMessage, setCouponMessage] = useState('')
  // Promotions only with an explicit, unchecked-by-default opt-in.
  const [marketingConsent, setMarketingConsent] = useState(false)
  // Pago en línea (Bold): pedido registrado y botón firmado listo para pagar.
  const boldConfig = store.onlinePayment?.bold ?? null
  const [boldState, setBoldState] = useState<{ displayId: string; button: BoldButtonData; shippingCost: number } | null>(null)
  const boldContainer = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (boldState && boldContainer.current) mountBoldButton(boldContainer.current, boldState.button, { name: customerName, email: customerEmail, phone: customerPhone })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boldState])

  // Any cart change invalidates the previewed discount; the server validates it again.
  useEffect(() => { setCoupon(null); setSendState(null); setBoldState(null) }, [subtotal])

  const applyCoupon = async () => {
    const code = couponInput.trim().toUpperCase()
    if (!code) return
    setCouponMessage('')
    try {
      const preview = await validateCoupon(code, subtotal)
      if (preview.valid && preview.code) { setCoupon({ code: preview.code, discount: Number(preview.discount || 0) }); setCouponMessage('Cupón aplicado.') }
      else { setCoupon(null); setCouponMessage(preview.message || 'Ese cupón no es válido.') }
    } catch { setCoupon(null); setCouponMessage('No pudimos validar el cupón. Inténtalo de nuevo.') }
  }

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

  // Re-reads catalog prices and stock; returns the refreshed cart, or null when the buyer must review it.
  const revalidateCart = async (): Promise<CartItem[] | null> => {
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
      setCheckoutMessage('El precio o el stock cambió. Revisa el carrito actualizado y vuelve a preparar el pedido.')
      return null
    }
    return currentItems
  }

  const orderPayload = (currentItems: CartItem[], payOnline?: 'bold') => ({
    customerName: customerName || undefined,
    customerPhone: customerPhone || undefined,
    customerEmail: customerEmail || undefined,
    customerCity: customerCity || undefined,
    deliveryAddress: deliveryInfo || undefined,
    deliveryMethod: 'envío por confirmar',
    paymentMethod: paymentMethod || undefined,
    currency: store.currency,
    notes: customerNotes.trim(),
    couponCode: coupon?.code,
    marketingConsent: marketingConsent || undefined,
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
    ...(payOnline ? { payOnline } : {}),
  })

  const checkoutBlocked = (): boolean => {
    if (IS_PUBLIC_DEMO) { setCheckoutMessage('Esta demo no acepta pedidos ni pagos.'); return true }
    if (!backendAvailable) { setCheckoutMessage('No se pudo conectar al registro seguro de pedidos. Inténtalo de nuevo más tarde.'); return true }
    if (!customerName.trim() || customerPhone.replace(/\D/g, '').length < 7 || !customerCity.trim() || !deliveryInfo.trim()) {
      setCheckoutMessage('Completa nombre, teléfono, ciudad y dirección para registrar el pedido.')
      return true
    }
    return checkoutBusy || items.length === 0
  }

  // Pago en línea con Bold: el pedido se registra con el envío fijo y el servidor firma el botón de Bold.
  const handleBoldCheckout = async () => {
    if (checkoutBlocked() || !boldConfig) return
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(customerEmail.trim())) {
      setCheckoutMessage('Escribe tu correo: ahí te enviamos la confirmación del pago.')
      return
    }
    setSendState(null)
    setBoldState(null)
    setCheckoutBusy(true)
    setCheckoutMessage('Verificando precios y disponibilidad…')
    try {
      const currentItems = await revalidateCart()
      if (!currentItems) return
      const payload = orderPayload(currentItems, 'bold')
      const idempotencyKey = await getCheckoutIdempotencyKey(JSON.stringify(payload))
      const registered = await createOrder(payload, idempotencyKey)
      const returnUrl = `${window.location.origin}${window.location.pathname}${window.location.search}`
      const button = await createBoldCheckout({ displayId: registered.displayId, checkoutKey: idempotencyKey, returnUrl })
      rememberBoldPayment({ reference: button.reference, checkoutKey: idempotencyKey, displayId: registered.displayId })
      setCheckoutMessage('')
      setBoldState({ displayId: registered.displayId, button, shippingCost: registered.shippingCost ?? boldConfig.shippingFee })
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === 'COUPON_INVALID') { setCoupon(null); setCheckoutMessage(error.message); return }
      if (error instanceof ApiRequestError && error.status === 409) { setCheckoutMessage(error.message); return }
      setCheckoutMessage('No pudimos preparar el pago en línea. Inténtalo de nuevo o envía el pedido por WhatsApp.')
    } finally {
      setCheckoutBusy(false)
    }
  }

  const handleWhatsAppCheckout = async () => {
    if (checkoutBlocked()) return
    setBoldState(null)
    const phone = store.whatsappOrders || store.whatsappPhone
    if (!whatsappLink(phone)) {
      setCheckoutMessage('El comercio aún no configuró un número válido de WhatsApp.')
      return
    }

    // En computador abrimos la pestaña dentro del clic para que el navegador la permita; en
    // celulares y navegadores de apps se usa esta misma pestaña (ver goToWhatsApp).
    // Phones that can share photos stay on this page (the buyer chooses text and/or photo).
    const offerPhotoStep = shouldOpenWhatsAppInSameTab() && canSharePhotos()
    const whatsappWindow = offerPhotoStep ? null : prepareWhatsAppTab()
    setSendState(null)

    setCheckoutBusy(true)
    setCheckoutMessage('Verificando precios y disponibilidad…')
    try {
      const currentItems = await revalidateCart()
      if (!currentItems) { whatsappWindow?.close(); return }

      const payload = orderPayload(currentItems)
      const idempotencyKey = await getCheckoutIdempotencyKey(JSON.stringify(payload))
      const registered = await createOrder(payload, idempotencyKey)
      const productSkuOf = (productId?: string) => currentItems.find((entry) => String(entry.productId) === String(productId))?.productSku
      const message = buildWhatsAppOrderMessage({
        items: registered.items.map((item) => ({ productId: String(item.productId || ''), variantId: item.variantId, sku: item.sku, name: item.name, price: item.price, image: item.imageUrl || null, size: item.size, color: item.color, quantity: item.quantity, productUrl: productPageUrl(productSkuOf(item.productId), TENANT_SLUG) })),
        currency: registered.currency,
        storeName: store.name,
        orderDisplayId: registered.displayId,
        date: new Date().toLocaleString('es-CO'),
        customerName: customerName || undefined,
        customerPhone: customerPhone || undefined,
        customerEmail: customerEmail || undefined,
        customerCity: customerCity || undefined,
        deliveryAddress: deliveryInfo || undefined,
        paymentMethod: paymentMethod || undefined,
        customerNotes: [registered.discountTotal > 0 && coupon ? `Cupón ${coupon.code}: -${formatMoney(registered.discountTotal, registered.currency)}` : '', customerNotes].filter(Boolean).join('. ') || undefined,
      })
      const url = whatsappLink(phone, message)
      if (!url) throw new Error('No se pudo construir el enlace de WhatsApp.')
      const photos = registered.items.map((item) => ({ name: item.name, imageUrl: item.imageUrl }))
      setCheckoutMessage('')
      setSendState({ displayId: registered.displayId, checkoutKey: idempotencyKey, whatsappUrl: url, message, photos, autoOpened: !offerPhotoStep })
      if (!offerPhotoStep) {
        recordBuyerAction(registered.displayId, idempotencyKey, 'whatsapp_abierto')
        goToWhatsApp(url, whatsappWindow)
      }
    } catch (error) {
      whatsappWindow?.close()
      if (error instanceof ApiRequestError && error.code === 'COUPON_INVALID') { setCoupon(null); setCheckoutMessage(error.message); return }
      setCheckoutMessage('No pudimos verificar el inventario. Inténtalo de nuevo antes de enviar el pedido.')
    } finally {
      setCheckoutBusy(false)
    }
  }

  if (!isOpen) return null

  const totalItems = items.reduce((s, i) => s + i.quantity, 0)
  const containsUnavailableItem = items.some((item) => item.availableStock === 0)

  return (
    <div className="fixed inset-x-0 top-0 z-50 h-[100dvh]">
      <div
        className="absolute inset-0 bg-black/45 backdrop-blur-sm animate-fade-in"
        onClick={() => setIsOpen(false)}
      />

      <div className="absolute right-0 top-0 h-full w-full sm:max-w-md bg-surface shadow-2xl flex flex-col animate-slide-in-right">
        {/* Cabecera */}
        <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-line">
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

        {/* Artículos, datos de entrega y totales: una sola zona con scroll para que en
            pantallas bajas nada quede fuera de alcance. */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
          {/* Artículos */}
          <div className="px-5 py-4 space-y-3">
            {items.length === 0 ? (
              <div className="min-h-[60vh] flex flex-col items-center justify-center text-center py-12">
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

                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 mt-2.5">
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
                      <span className="text-sm font-bold text-ink tabular-nums whitespace-nowrap">
                        {formatMoney(item.price * item.quantity, store.currency)}
                      </span>
                    </div>
                  </div>
                </div>
                )
              })
            )}
          </div>

          {items.length > 0 && (
            <div className="border-t border-line p-5 space-y-4">
              {!IS_PUBLIC_DEMO && <div className="space-y-2">
                <input
                  type="text"
                  placeholder="Nombre completo"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  className="input-field text-sm"
                />
                <input type="tel" placeholder="Teléfono con indicativo (ej. +57…)" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} className="input-field text-sm" />
                <input type="email" placeholder={boldConfig ? 'Correo (obligatorio para pagar en línea)' : 'Correo (opcional)'}value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} className="input-field text-sm" />
                <input type="text" placeholder="Ciudad" value={customerCity} onChange={(e) => setCustomerCity(e.target.value)} className="input-field text-sm" />
                <input
                  type="text"
                  placeholder="Dirección de entrega"
                  value={deliveryInfo}
                  onChange={(e) => setDeliveryInfo(e.target.value)}
                  className="input-field text-sm"
                />
                <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className="input-field text-sm">
                  <option value="">Medio de pago preferido (opcional)</option>
                  {['Transferencia', 'Tarjeta', 'Efectivo contraentrega', 'Otro'].map((method) => <option key={method} value={method}>{method}</option>)}
                </select>
                <textarea maxLength={500} placeholder="Observaciones de entrega (opcional)" value={customerNotes} onChange={(e) => setCustomerNotes(e.target.value)} className="input-field text-sm" rows={2} />
                <div className="flex gap-2">
                  <input type="text" placeholder="Cupón de descuento (opcional)" value={couponInput} onChange={(e) => setCouponInput(e.target.value.toUpperCase())} maxLength={20} className="input-field text-sm" aria-label="Cupón de descuento" />
                  <button type="button" onClick={() => void applyCoupon()} className="shrink-0 rounded-btn border border-line px-3 text-sm font-semibold hover:bg-canvas">Aplicar</button>
                </div>
                {couponMessage && <p className="text-[11px] text-muted" role="status">{couponMessage}</p>}
                <label className="flex items-start gap-2 text-[12px] text-muted">
                  <input type="checkbox" checked={marketingConsent} onChange={(e) => setMarketingConsent(e.target.checked)} className="mt-0.5" />
                  <span>Quiero recibir promociones de {store.name} por WhatsApp. Puedo darme de baja cuando quiera.</span>
                </label>
              </div>}

              <div className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted">Subtotal de productos</span>
                  <span className="font-semibold text-ink tabular-nums">{formatMoney(subtotal, store.currency)}</span>
                </div>
                {coupon && coupon.discount > 0 && <div className="flex items-center justify-between text-sm">
                  <span className="text-muted">Cupón {coupon.code}</span>
                  <span className="font-semibold text-ink tabular-nums">-{formatMoney(coupon.discount, store.currency)}</span>
                </div>}
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-ink">Envío por cotizar</span>
                  <span className="text-xl font-bold text-ink tabular-nums">Por cotizar</span>
                </div>
                {!IS_PUBLIC_DEMO && <p className="text-[11px] text-muted">El valor del envío se confirma con el comercio por WhatsApp.</p>}
                {!IS_PUBLIC_DEMO && boldConfig && <div className="mt-2 rounded-btn border border-line bg-canvas px-3 py-2 space-y-0.5">
                  <div className="flex items-center justify-between text-xs"><span className="text-muted">Pago en línea: envío fijo</span><span className="font-semibold text-ink tabular-nums">{boldConfig.shippingFee > 0 ? formatMoney(boldConfig.shippingFee, store.currency) : 'Gratis'}</span></div>
                  <div className="flex items-center justify-between text-sm"><span className="font-semibold text-ink">Total a pagar en línea</span><span className="font-bold text-ink tabular-nums">{formatMoney(Math.max(0, subtotal - (coupon?.discount || 0)) + boldConfig.shippingFee, store.currency)}</span></div>
                </div>}
              </div>

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

        {/* Pie fijo: el botón de envío siempre visible, también en celulares. */}
        {items.length > 0 && (
          <div className="shrink-0 border-t border-line bg-surface px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] space-y-2">
            {!IS_PUBLIC_DEMO && boldConfig && !sendState && !boldState && <button
              onClick={handleBoldCheckout}
              disabled={checkoutBusy || containsUnavailableItem}
              className="w-full inline-flex items-center justify-center gap-2 bg-ink text-surface
                         min-h-[48px] rounded-btn font-semibold hover:opacity-90 active:scale-[0.99] transition-all
                         disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <CreditCard size={20} />
              {checkoutBusy ? 'Verificando…' : 'Pagar en línea (tarjeta, PSE, Nequi)'}
            </button>}
            {boldState && <div className="rounded-btn border border-line bg-canvas p-3 space-y-2 text-center" role="status">
              <p className="text-sm font-semibold text-ink">Pedido {boldState.displayId} registrado</p>
              <p className="text-xs text-muted">Total {formatMoney(boldState.button.amount, boldState.button.currency)}{boldState.shippingCost > 0 ? ` (incluye envío ${formatMoney(boldState.shippingCost, boldState.button.currency)})` : ''}. Toca el botón de Bold para pagar de forma segura.</p>
              <div ref={boldContainer} className="flex justify-center min-h-[48px]" />
              {boldState.button.mode === 'test' && <p className="text-[11px] font-semibold text-amber-700">Modo de pruebas: no se cobra dinero real.</p>}
              <button onClick={() => setBoldState(null)} className="text-[11px] text-muted underline hover:text-ink">Cambiar medio de pago</button>
            </div>}
            {/* Once registered, the send panel takes over (a cart change resets it). */}
            {!IS_PUBLIC_DEMO && !sendState && !boldState && <button
              onClick={handleWhatsAppCheckout}
              disabled={checkoutBusy || containsUnavailableItem}
              className="w-full inline-flex items-center justify-center gap-2 bg-[#25D366] text-white
                         min-h-[48px] rounded-btn font-semibold hover:brightness-95 active:scale-[0.99] transition-all
                         disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <MessageCircle size={20} fill="currentColor" />
              {checkoutBusy ? 'Verificando…' : 'Enviar pedido por WhatsApp'}
            </button>}
            {IS_PUBLIC_DEMO && <p className="rounded-btn bg-canvas px-4 py-3 text-center text-sm font-semibold text-muted" role="status">Demo de catálogo: no se aceptan pedidos ni pagos.</p>}
            {checkoutMessage && <p className="text-xs text-muted" role="status">{checkoutMessage}</p>}

            {sendState && <OrderSendPanel state={sendState} storeName={store.name} />}
          </div>
        )}
      </div>
    </div>
  )
}
