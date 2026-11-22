import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, BadgeCheck, ChevronDown, CreditCard, Loader2, Lock, MessageCircle, ShieldCheck, ShoppingBag, Truck } from 'lucide-react'
import { useCart } from '../contexts/CartContext'
import { useStore } from '../contexts/StoreContext'
import { useCatalog } from '../contexts/CatalogContext'
import { ApiRequestError, createBoldCheckout, createOrder, getProducts, validateCoupon } from '../services/api'
import { openBoldCheckout, rememberBoldPayment } from '../lib/bold'
import { CART_CHANGED_MESSAGE, revalidateItems } from '../lib/cartRevalidate'
import { readCheckoutDraft, saveCheckoutDraft, validateCheckout, type CheckoutDraft } from '../lib/checkoutDraft'
import { getCheckoutIdempotencyKey } from '../lib/whatsapp'
import { formatMoney } from '../lib/format'
import { IS_PUBLIC_DEMO } from '../lib/publicDemo'

type Field = keyof CheckoutDraft
const FIELD_ORDER: Field[] = ['name', 'phone', 'email', 'address', 'city']

/** 3001234567 / 573001234567 → +57 300 123 4567; other numbers keep what the buyer typed. */
function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, '')
  const local = digits.length === 12 && digits.startsWith('57') ? digits.slice(2) : digits
  if (local.length === 10 && local.startsWith('3')) return `+57 ${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}`
  return value.trim()
}

/** Pago en línea en una sola vista: datos de entrega, resumen fijo y la pasarela de Bold en un modal sobre la tienda. */
export default function CheckoutPage() {
  const { items, subtotal, syncItems } = useCart()
  const { store, backendAvailable, isLoading } = useStore()
  const { products } = useCatalog()
  const bold = store.onlinePayment?.bold ?? null
  const [draft, setDraft] = useState<CheckoutDraft>(() => readCheckoutDraft())
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({})
  const [showAllErrors, setShowAllErrors] = useState(false)
  const [coupon, setCoupon] = useState<{ code: string; discount: number } | null>(null)
  const [couponMessage, setCouponMessage] = useState('')
  const [marketingConsent, setMarketingConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'info' | 'error'; text: string } | null>(null)
  const [opened, setOpened] = useState<{ displayId: string } | null>(null)
  const [summaryOpen, setSummaryOpen] = useState(false)
  const inputs = useRef<Partial<Record<Field, HTMLInputElement | null>>>({})

  const errors = useMemo(() => validateCheckout(draft), [draft])
  const shipping = bold?.shippingFee ?? 0
  const discount = Math.min(coupon?.discount || 0, subtotal)
  const total = Math.max(0, subtotal - discount) + shipping
  const units = items.reduce((sum, item) => sum + item.quantity, 0)
  const unavailable = items.some((item) => item.availableStock === 0)
  const money = (value: number) => formatMoney(value, store.currency)

  // The previewed discount depends on the cart: any change asks for it again (the server always re-validates it).
  useEffect(() => { setCoupon(null); setOpened(null) }, [subtotal])
  useEffect(() => { saveCheckoutDraft(draft) }, [draft])
  // A coupon typed in the cart is applied here once.
  useEffect(() => {
    if (draft.coupon && subtotal > 0) void applyCoupon(draft.coupon)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const update = (field: Field, value: string) => setDraft((current) => ({ ...current, [field]: value }))
  const errorOf = (field: Field) => ((touched[field] || showAllErrors) ? errors[field] : undefined)

  async function applyCoupon(input = draft.coupon) {
    const code = input.trim().toUpperCase()
    if (!code) return
    setCouponMessage('')
    try {
      const preview = await validateCoupon(code, subtotal)
      if (preview.valid && preview.code) { setCoupon({ code: preview.code, discount: Number(preview.discount || 0) }); setCouponMessage('Cupón aplicado.') }
      else { setCoupon(null); setCouponMessage(preview.message || 'Ese cupón no es válido.') }
    } catch { setCoupon(null); setCouponMessage('No pudimos validar el cupón. Inténtalo de nuevo.') }
  }

  const pay = async () => {
    if (busy) return
    // Until the store's settings arrive it is unknown whether online payment is active.
  if (isLoading) return <div className="min-h-[60vh]" aria-busy="true" />
  if (IS_PUBLIC_DEMO || !bold) { setMessage({ tone: 'error', text: 'Esta tienda no tiene activo el pago en línea.' }); return }
    if (!backendAvailable) { setMessage({ tone: 'error', text: 'No pudimos conectar con la tienda. Revisa tu conexión e inténtalo de nuevo.' }); return }
    const firstInvalid = FIELD_ORDER.find((field) => errors[field])
    if (firstInvalid) {
      setShowAllErrors(true)
      setMessage({ tone: 'error', text: 'Revisa los datos marcados en rojo.' })
      inputs.current[firstInvalid]?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      inputs.current[firstInvalid]?.focus({ preventScroll: true })
      return
    }
    setBusy(true)
    setOpened(null)
    setMessage({ tone: 'info', text: 'Verificando precios y disponibilidad…' })
    try {
      const catalog = backendAvailable ? await getProducts(undefined, { cache: 'no-store' }) : products
      const checked = revalidateItems(items, catalog)
      syncItems(checked.items)
      if (checked.needsReview) { setMessage({ tone: 'error', text: CART_CHANGED_MESSAGE }); setSummaryOpen(true); return }
      const payload = {
        customerName: draft.name.trim(),
        customerPhone: normalizePhone(draft.phone),
        customerEmail: draft.email.trim(),
        customerCity: draft.city.trim(),
        deliveryAddress: draft.address.trim(),
        deliveryMethod: 'envío fijo',
        currency: store.currency,
        notes: draft.notes.trim(),
        couponCode: coupon?.code,
        marketingConsent: marketingConsent || undefined,
        items: checked.items.map((item) => ({
          productId: String(item.productId), variantId: item.variantId ? String(item.variantId) : undefined, sku: item.sku,
          name: item.name, price: item.price, size: item.size, color: item.color, quantity: item.quantity,
        })),
        payOnline: 'bold' as const,
      }
      const checkoutKey = await getCheckoutIdempotencyKey(JSON.stringify(payload))
      setMessage({ tone: 'info', text: 'Registrando tu pedido…' })
      const order = await createOrder(payload, checkoutKey)
      // Back from Bold: the store's home, where the result is confirmed with Bold (never trusted from the address).
      const home = window.location.pathname.replace(/\/checkout\/?$/, '') || '/'
      const button = await createBoldCheckout({ displayId: order.displayId, checkoutKey, returnUrl: `${window.location.origin}${home.endsWith('/') ? home : `${home}/`}` })
      rememberBoldPayment({ reference: button.reference, checkoutKey, displayId: order.displayId })
      setMessage({ tone: 'info', text: 'Abriendo la pasarela segura de Bold…' })
      await openBoldCheckout(button, { name: payload.customerName, email: payload.customerEmail, phone: payload.customerPhone, address: payload.deliveryAddress, city: payload.customerCity })
      setOpened({ displayId: order.displayId })
      setMessage(null)
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === 'COUPON_INVALID') { setCoupon(null); setMessage({ tone: 'error', text: error.message }); return }
      if (error instanceof ApiRequestError && (error.status === 409 || error.status === 400)) { setMessage({ tone: 'error', text: error.message }); return }
      if (error instanceof Error && error.message.startsWith('BOLD_LIBRARY')) { setMessage({ tone: 'error', text: 'No pudimos abrir la pasarela de Bold. Revisa tu conexión e inténtalo de nuevo.' }); return }
      setMessage({ tone: 'error', text: 'No pudimos preparar el pago. Inténtalo de nuevo en unos segundos.' })
    } finally {
      setBusy(false)
    }
  }

  if (IS_PUBLIC_DEMO || !bold) {
    return <Notice icon={<CreditCard size={28} />} title="Pago en línea no disponible" text={`${store.name} recibe los pedidos por WhatsApp. Abre el carrito y envía tu pedido desde allí.`} />
  }
  if (!items.length) {
    return <Notice icon={<ShoppingBag size={28} />} title="Tu carrito está vacío" text="Agrega productos para continuar con el pago." />
  }

  const summary = (
    <div className="space-y-4">
      <ul className="space-y-3" aria-label="Productos">
        {items.map((item) => (
          <li key={`${item.productId}-${item.variantId}`} className="flex gap-3">
            <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-btn border border-line bg-canvas">
              {item.image ? <img src={item.image} alt="" className="h-full w-full object-cover" /> : <ShoppingBag size={20} className="m-auto mt-5 text-muted" />}
              <span className="absolute -right-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-ink px-1 text-[11px] font-bold text-surface">{item.quantity}</span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-sm font-semibold leading-snug text-ink">{item.name}</p>
              {(item.size || item.color) && <p className="text-xs text-muted">{[item.size && `Talla ${item.size}`, item.color].filter(Boolean).join(' · ')}</p>}
              <p className="text-xs text-muted">Cantidad: {item.quantity}</p>
              {item.availableStock === 0 && <p className="text-xs font-semibold text-red-600">Sin stock: quítalo del carrito.</p>}
            </div>
            <p className="shrink-0 text-sm font-semibold tabular-nums text-ink">{money(item.price * item.quantity)}</p>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <input value={draft.coupon} onChange={(e) => update('coupon', e.target.value.toUpperCase())} maxLength={20} placeholder="Cupón de descuento" aria-label="Cupón de descuento" className="input-field !text-base min-h-[48px]" />
        <button type="button" onClick={() => void applyCoupon()} className="shrink-0 rounded-btn border border-line px-4 text-sm font-semibold text-ink hover:bg-canvas">Aplicar</button>
      </div>
      {couponMessage && <p className="text-xs text-muted" role="status">{couponMessage}</p>}
      <dl className="space-y-2 border-t border-line pt-4 text-sm">
        <Row label={`Subtotal (${units} ${units === 1 ? 'producto' : 'productos'})`} value={money(subtotal)} />
        {discount > 0 && <Row label={`Cupón ${coupon!.code}`} value={`−${money(discount)}`} />}
        <Row label={<span className="inline-flex items-center gap-1.5"><Truck size={14} /> Envío</span>} value={shipping > 0 ? money(shipping) : 'Gratis'} />
        <div className="flex items-baseline justify-between border-t border-line pt-3">
          <dt className="text-base font-bold text-ink">Total a pagar</dt>
          <dd className="text-2xl font-bold tabular-nums text-ink">{money(total)}</dd>
        </div>
      </dl>
    </div>
  )

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 pt-6 sm:px-6 lg:pt-10">
      <Link to="/" className="mb-5 inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink"><ArrowLeft size={16} /> Seguir comprando</Link>
      <h1 className="mb-1 text-2xl font-bold text-ink sm:text-3xl">Finalizar compra</h1>
      <p className="mb-6 flex items-center gap-1.5 text-sm text-muted"><Lock size={14} /> Pago seguro sin salir de {store.name}</p>

      {/* Móvil: resumen plegable arriba, con el total siempre a la vista. */}
      <section className="mb-6 rounded-card border border-line bg-surface lg:hidden">
        <button type="button" onClick={() => setSummaryOpen((value) => !value)} aria-expanded={summaryOpen} className="flex w-full items-center justify-between gap-3 px-4 py-4">
          <span className="inline-flex items-center gap-2 text-sm font-semibold text-ink"><ShoppingBag size={18} /> {summaryOpen ? 'Ocultar resumen' : 'Ver resumen'} <ChevronDown size={16} className={`transition-transform ${summaryOpen ? 'rotate-180' : ''}`} /></span>
          <span className="text-lg font-bold tabular-nums text-ink">{money(total)}</span>
        </button>
        {summaryOpen && <div className="border-t border-line px-4 py-4">{summary}</div>}
      </section>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_400px]">
        <form noValidate onSubmit={(event) => { event.preventDefault(); void pay() }} className="space-y-6">
          <section className="space-y-4 rounded-card border border-line bg-surface p-5 sm:p-6">
            <h2 className="text-lg font-bold text-ink">1. ¿A quién y a dónde enviamos?</h2>
            <TextField label="Nombre completo" autoComplete="name" value={draft.name} error={errorOf('name')} inputRef={(el) => { inputs.current.name = el }}
              onChange={(v) => update('name', v)} onBlur={() => setTouched((t) => ({ ...t, name: true }))} />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="WhatsApp" type="tel" inputMode="tel" autoComplete="tel" placeholder="300 123 4567" value={draft.phone} error={errorOf('phone')} inputRef={(el) => { inputs.current.phone = el }}
                onChange={(v) => update('phone', v)} onBlur={() => setTouched((t) => ({ ...t, phone: true }))} hint="Te escribimos por aquí para coordinar la entrega." />
              <TextField label="Correo electrónico" type="email" inputMode="email" autoComplete="email" placeholder="tu@correo.com" value={draft.email} error={errorOf('email')} inputRef={(el) => { inputs.current.email = el }}
                onChange={(v) => update('email', v)} onBlur={() => setTouched((t) => ({ ...t, email: true }))} hint="Aquí recibes el comprobante de pago." />
            </div>
            <TextField label="Dirección exacta de entrega" autoComplete="street-address" placeholder="Calle 10 # 20-30, barrio, apto o casa" value={draft.address} error={errorOf('address')} inputRef={(el) => { inputs.current.address = el }}
              onChange={(v) => update('address', v)} onBlur={() => setTouched((t) => ({ ...t, address: true }))} />
            <TextField label="Ciudad o municipio" autoComplete="address-level2" value={draft.city} error={errorOf('city')} inputRef={(el) => { inputs.current.city = el }}
              onChange={(v) => update('city', v)} onBlur={() => setTouched((t) => ({ ...t, city: true }))} />
            <label className="block space-y-1.5">
              <span className="text-sm font-semibold text-ink">Indicaciones para la entrega <span className="font-normal text-muted">(opcional)</span></span>
              <textarea value={draft.notes} onChange={(e) => update('notes', e.target.value)} maxLength={500} rows={2} placeholder="Punto de referencia, horario, portería…" className="input-field !text-base" />
            </label>
            <label className="flex items-start gap-2.5 text-sm text-muted">
              <input type="checkbox" checked={marketingConsent} onChange={(e) => setMarketingConsent(e.target.checked)} className="mt-1 h-4 w-4" />
              <span>Quiero recibir promociones de {store.name} por WhatsApp. Puedo darme de baja cuando quiera.</span>
            </label>
          </section>

          <section className="space-y-4 rounded-card border border-line bg-surface p-5 sm:p-6">
            <h2 className="text-lg font-bold text-ink">2. Pago</h2>
            <div className="rounded-btn border-2 border-ink/80 p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-2 font-semibold text-ink"><CreditCard size={20} /> Tarjeta, PSE y más</span>
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-muted"><Lock size={12} /> Procesado por Bold</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Medios de pago">
                {['Crédito', 'Débito', 'PSE', 'Nequi', 'Bancolombia'].map((method) => (
                  <span key={method} className="rounded-full border border-line bg-canvas px-2.5 py-1 text-xs font-semibold text-ink">{method}</span>
                ))}
              </div>
              <p className="mt-3 text-sm text-muted">Al tocar <strong className="text-ink">Pagar ahora</strong> se abre la ventana segura de Bold aquí mismo, sin salir de la tienda. Tus datos de tarjeta nunca pasan por {store.name}.</p>
              {bold.mode === 'test' && <p className="mt-2 text-xs font-semibold text-amber-700">Modo de pruebas: no se cobra dinero real.</p>}
            </div>

            <button type="submit" disabled={busy || unavailable}
              style={{ background: 'var(--color-button)', color: 'var(--color-button-text)' }}
              className="flex min-h-[60px] w-full items-center justify-center gap-2.5 rounded-btn px-6 text-lg font-bold shadow-lg transition-all hover:brightness-105 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60">
              {busy ? <><Loader2 size={22} className="animate-spin" /> Procesando…</> : <><Lock size={20} /> Pagar ahora · {money(total)}</>}
            </button>
            {message && <p className={`text-sm ${message.tone === 'error' ? 'font-semibold text-red-600' : 'text-muted'}`} role={message.tone === 'error' ? 'alert' : 'status'}>{message.text}</p>}
            {opened && <div className="rounded-btn bg-canvas p-3 text-sm text-muted" role="status">
              Pedido <strong className="text-ink">{opened.displayId}</strong> registrado. Completa el pago en la ventana de Bold. ¿La cerraste? Toca <strong className="text-ink">Pagar ahora</strong> otra vez.
            </div>}

            <ul className="grid gap-3 border-t border-line pt-4 text-xs text-muted sm:grid-cols-3">
              <Trust icon={<Lock size={18} />} title="Conexión cifrada SSL" text="Tus datos viajan encriptados." />
              <Trust icon={<ShieldCheck size={18} />} title="Pago protegido por Bold" text="Bold procesa el pago: la tienda nunca ve tu tarjeta." />
              <Trust icon={<BadgeCheck size={18} />} title="Compra confirmada" text="Tu pedido solo se confirma si Bold aprueba el pago, y recibes el comprobante por correo." />
            </ul>
          </section>
        </form>

        <aside className="hidden lg:block">
          <div className="sticky top-24 rounded-card border border-line bg-surface p-6">
            <h2 className="mb-4 text-lg font-bold text-ink">Resumen de tu compra</h2>
            {summary}
          </div>
        </aside>
      </div>

      <p className="mt-8 text-center text-sm text-muted">
        ¿Prefieres pagar de otra forma? <button type="button" onClick={() => document.dispatchEvent(new Event('open-cart'))} className="inline-flex items-center gap-1 font-semibold text-ink underline"><MessageCircle size={14} /> Envía tu pedido por WhatsApp</button>
      </p>
    </div>
  )
}

function TextField(props: {
  label: string; value: string; onChange: (value: string) => void; onBlur: () => void; error?: string; hint?: string
  type?: string; inputMode?: 'tel' | 'email' | 'text'; autoComplete?: string; placeholder?: string; inputRef: (el: HTMLInputElement | null) => void
}) {
  const id = `checkout-${props.label.toLowerCase().replace(/[^a-z]+/g, '-')}`
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-semibold text-ink">{props.label}</label>
      <input id={id} ref={props.inputRef} type={props.type || 'text'} inputMode={props.inputMode} autoComplete={props.autoComplete} placeholder={props.placeholder}
        value={props.value} onChange={(e) => props.onChange(e.target.value)} onBlur={props.onBlur}
        aria-invalid={Boolean(props.error)} aria-describedby={props.error || props.hint ? `${id}-help` : undefined}
        className={`input-field !text-base min-h-[52px] ${props.error ? '!border-red-500' : ''}`} />
      {(props.error || props.hint) && <p id={`${id}-help`} className={`text-xs ${props.error ? 'font-semibold text-red-600' : 'text-muted'}`}>{props.error || props.hint}</p>}
    </div>
  )
}

function Row({ label, value }: { label: ReactNode; value: string }) {
  return <div className="flex items-center justify-between gap-3"><dt className="text-muted">{label}</dt><dd className="font-semibold tabular-nums text-ink">{value}</dd></div>
}

function Trust({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return <li className="flex gap-2"><span className="mt-0.5 shrink-0 text-ink">{icon}</span><span><strong className="block text-ink">{title}</strong>{text}</span></li>
}

function Notice({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4 text-center">
      <span className="mb-4 grid h-16 w-16 place-items-center rounded-full bg-canvas text-muted">{icon}</span>
      <h1 className="text-xl font-bold text-ink">{title}</h1>
      <p className="mb-6 mt-1 text-sm text-muted">{text}</p>
      <Link to="/" className="btn-brand">Ver productos</Link>
    </div>
  )
}
