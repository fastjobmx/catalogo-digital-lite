import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, BadgeCheck, CreditCard, Lock, MessageCircle, Minus, PackageCheck, Plus, ShieldCheck, ShoppingBag, Trash2, Truck, X, Zap } from 'lucide-react'
import { useCart, type CartItem } from '../contexts/CartContext'
import { useStore } from '../contexts/StoreContext'
import { useCatalog } from '../contexts/CatalogContext'
import { getProducts, type ProductApi } from '../services/api'
import { revalidateItems } from '../lib/cartRevalidate'
import { formatMoney } from '../lib/format'
import { IS_PUBLIC_DEMO } from '../lib/publicDemo'

const keyOf = (item: Pick<CartItem, 'productId' | 'variantId'>) => `${item.productId}-${item.variantId ?? ''}`

/** Variant label as the buyer reads it: "40", "M · Negro", "Única". */
const variantLabel = (variant: { size: string | null; color: string | null; name: string }) => [variant.size, variant.color].filter(Boolean).join(' · ') || variant.name || 'Única'

/** Carrito completo: revisar productos, cambiar talla, cantidades, quitar y elegir cómo finalizar la compra. */
export default function CartPage() {
  const { items, subtotal, totalItems, removeItem, updateQuantity, changeVariant, addItem, syncItems } = useCart()
  const { store, backendAvailable, isLoading } = useStore()
  const { products: catalogProducts } = useCatalog()
  const navigate = useNavigate()
  const bold = IS_PUBLIC_DEMO ? null : store.onlinePayment?.bold ?? null
  const [products, setProducts] = useState<ProductApi[]>(catalogProducts)
  const [notice, setNotice] = useState('')
  const [removed, setRemoved] = useState<CartItem | null>(null)
  const [choosing, setChoosing] = useState(false)
  const money = (value: number) => formatMoney(value, store.currency)

  // Fresh prices and stock when the page opens: the buyer sees the real cart before deciding to pay.
  useEffect(() => {
    if (!backendAvailable || !items.length) return
    let cancelled = false
    getProducts(undefined, { cache: 'no-store' }).then((fresh) => {
      if (cancelled) return
      setProducts(fresh)
      const checked = revalidateItems(items, fresh)
      syncItems(checked.items)
      if (checked.needsReview) setNotice('Actualizamos precios o disponibilidad de algunos productos. Revisa tu carrito antes de continuar.')
    }).catch(() => undefined)
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendAvailable])
  useEffect(() => { if (!products.length && catalogProducts.length) setProducts(catalogProducts) }, [catalogProducts, products.length])
  useEffect(() => { if (!removed) return; const timer = window.setTimeout(() => setRemoved(null), 6000); return () => window.clearTimeout(timer) }, [removed])

  const savings = items.reduce((sum, item) => sum + Math.max(0, (item.compareAtPrice ?? 0) - item.price) * item.quantity, 0)
  const unavailable = items.some((item) => item.availableStock === 0)
  const shipping = bold?.shippingFee ?? 0
  const onlineTotal = subtotal + shipping

  const remove = (item: CartItem) => { removeItem(item.productId, item.variantId); setRemoved(item) }
  const undo = () => {
    if (!removed) return
    const { quantity, ...rest } = removed
    addItem(rest, quantity)
    setRemoved(null)
  }
  const swapVariant = (item: CartItem, product: ProductApi, variantId: string) => {
    const variant = product.variants.find((candidate) => String(candidate.id) === variantId)
    if (!variant) return
    changeVariant(item.productId, item.variantId, {
      productId: String(product.id), productSku: product.sku, variantId: String(variant.id), sku: variant.sku, name: product.name,
      price: variant.priceOverride ?? product.price, compareAtPrice: product.compareAtPrice ?? undefined, image: item.image ?? product.imageUrls[0] ?? null,
      size: variant.size ?? undefined, color: variant.color ?? undefined, availableStock: variant.stock,
    })
  }

  const openWhatsAppOrder = () => { setChoosing(false); document.dispatchEvent(new CustomEvent('open-cart')) }
  const finish = () => {
    if (unavailable) { setNotice('Quita los productos sin stock para continuar.'); return }
    if (bold) setChoosing(true)
    else openWhatsAppOrder()
  }

  if (isLoading) return <div className="min-h-[60vh]" aria-busy="true" />
  if (!items.length) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4 text-center">
        <span className="mb-4 grid h-16 w-16 place-items-center rounded-full bg-canvas text-muted"><ShoppingBag size={28} /></span>
        <h1 className="text-xl font-bold text-ink">Tu carrito está vacío</h1>
        <p className="mb-6 mt-1 text-sm text-muted">Explora el catálogo y agrega lo que te guste.</p>
        {removed && <button type="button" onClick={undo} className="mb-4 text-sm font-semibold text-ink underline">Deshacer: volver a agregar {removed.name}</button>}
        <Link to="/category/all" className="btn-brand">Ver productos</Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl px-4 pb-32 pt-6 sm:px-6 lg:pb-16 lg:pt-10">
      <Link to="/category/all" className="mb-5 inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink"><ArrowLeft size={16} /> Seguir comprando</Link>
      <h1 className="text-2xl font-bold text-ink sm:text-3xl">Tu carrito <span className="text-lg font-semibold text-muted">({totalItems} {totalItems === 1 ? 'producto' : 'productos'})</span></h1>

      {bold && (
        <div className="mt-4 flex items-start gap-3 rounded-card border border-line bg-surface px-4 py-3">
          <Zap size={20} className="mt-0.5 shrink-0 text-ink" />
          <p className="text-sm text-ink"><strong>Paga en línea y tu pedido queda confirmado al instante.</strong> <span className="text-muted">Apartamos tus unidades en cuanto se aprueba el pago. Tarjeta, PSE o Nequi.</span></p>
        </div>
      )}
      {notice && <p className="mt-4 rounded-btn bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900" role="status">{notice}</p>}

      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section aria-label="Productos del carrito">
          <ul className="divide-y divide-line rounded-card border border-line bg-surface">
            {items.map((item) => {
              const product = products.find((candidate) => String(candidate.id) === item.productId || candidate.sku === item.productSku)
              const options = (product?.variants || []).filter((variant) => variant.isActive !== false)
              const slug = item.productSku || product?.sku || item.sku
              const maxed = item.availableStock !== undefined && item.quantity >= item.availableStock
              return (
                <li key={keyOf(item)} className="flex gap-4 p-4 sm:p-5">
                  <Link to={`/product/${encodeURIComponent(slug)}`} className="h-24 w-24 shrink-0 overflow-hidden rounded-btn bg-canvas sm:h-28 sm:w-28">
                    {item.image ? <img src={item.image} alt={item.name} className="h-full w-full object-cover" /> : <ShoppingBag size={24} className="m-auto mt-9 text-muted" />}
                  </Link>
                  <div className="min-w-0 flex-1 space-y-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link to={`/product/${encodeURIComponent(slug)}`} className="line-clamp-2 font-semibold leading-snug text-ink hover:underline">{item.name}</Link>
                        <p className="mt-0.5 text-sm text-muted">
                          {money(item.price)} c/u
                          {item.compareAtPrice && item.compareAtPrice > item.price && <span className="ml-1.5 line-through">{money(item.compareAtPrice)}</span>}
                        </p>
                      </div>
                      <button type="button" onClick={() => remove(item)} className="-mr-1 shrink-0 rounded-btn p-2 text-muted transition-colors hover:bg-canvas hover:text-red-600" aria-label={`Eliminar ${item.name}`}><Trash2 size={18} /></button>
                    </div>

                    <div className="flex flex-wrap items-end gap-3">
                      {options.length > 1 ? (
                        <label className="space-y-1">
                          <span className="block text-xs font-semibold text-muted">{options.some((variant) => variant.size) ? 'Talla' : 'Opción'}</span>
                          <select value={item.variantId ?? ''} onChange={(e) => product && swapVariant(item, product, e.target.value)}
                            className="input-field !w-auto min-h-[44px] !py-2 !pr-9 !text-base" aria-label={`Cambiar talla de ${item.name}`}>
                            {options.map((variant) => (
                              <option key={variant.id} value={String(variant.id)} disabled={variant.stock < 1 && String(variant.id) !== item.variantId}>
                                {variantLabel(variant)}{variant.stock < 1 ? ' (agotada)' : variant.stock <= 3 ? ` (${variant.stock === 1 ? "queda" : "quedan"} ${variant.stock})` : ''}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : (item.size || item.color) ? (
                        <p className="text-sm text-muted">{[item.size && `Talla ${item.size}`, item.color].filter(Boolean).join(' · ')}</p>
                      ) : null}

                      <div className="space-y-1">
                        <span className="block text-xs font-semibold text-muted">Cantidad</span>
                        <div className="flex h-11 items-center rounded-btn border border-line bg-surface">
                          <button type="button" onClick={() => (item.quantity > 1 ? updateQuantity(item.productId, item.variantId, item.quantity - 1) : remove(item))}
                            className="grid h-full w-11 place-items-center text-ink hover:bg-canvas" aria-label="Quitar una unidad"><Minus size={16} /></button>
                          <span className="w-10 text-center font-semibold tabular-nums text-ink" aria-live="polite">{item.quantity}</span>
                          <button type="button" onClick={() => updateQuantity(item.productId, item.variantId, item.quantity + 1)} disabled={maxed}
                            className="grid h-full w-11 place-items-center text-ink hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-30" aria-label="Agregar una unidad"><Plus size={16} /></button>
                        </div>
                      </div>

                      <p className="ml-auto text-lg font-bold tabular-nums text-ink">{money(item.price * item.quantity)}</p>
                    </div>
                    {item.availableStock === 0 && <p className="text-sm font-semibold text-red-600">Agotado: elige otra talla o quítalo del carrito.</p>}
                    {item.availableStock !== undefined && item.availableStock > 0 && item.availableStock <= 3 && <p className="text-xs font-semibold text-amber-700">¡Solo {item.availableStock === 1 ? 'queda' : 'quedan'} {item.availableStock}!</p>}
                  </div>
                </li>
              )
            })}
          </ul>
          {removed && (
            <div className="mt-3 flex items-center justify-between gap-3 rounded-btn bg-ink px-4 py-3 text-sm text-surface" role="status">
              <span className="truncate">Quitaste {removed.name}</span>
              <button type="button" onClick={undo} className="shrink-0 font-bold underline">Deshacer</button>
            </div>
          )}
        </section>

        <aside>
          <div className="space-y-4 rounded-card border border-line bg-surface p-5 sm:p-6 lg:sticky lg:top-24">
            <h2 className="text-lg font-bold text-ink">Resumen</h2>
            <dl className="space-y-2 text-sm">
              <Row label={`Productos (${totalItems})`} value={money(subtotal)} />
              {savings > 0 && <Row label="Estás ahorrando" value={`−${money(savings)}`} accent />}
              <Row label={<span className="inline-flex items-center gap-1.5"><Truck size={14} /> Envío</span>} value={bold ? (shipping > 0 ? money(shipping) : 'Gratis') : 'Se cotiza por WhatsApp'} />
              <div className="flex items-baseline justify-between border-t border-line pt-3">
                <dt className="text-base font-bold text-ink">Total</dt>
                <dd className="text-2xl font-bold tabular-nums text-ink">{money(bold ? onlineTotal : subtotal)}</dd>
              </div>
              {bold && <p className="text-xs text-muted">Incluye el envío para pago en línea. ¿Tienes cupón? Lo aplicas en el siguiente paso.</p>}
            </dl>
            <PrimaryButton onClick={finish} disabled={unavailable}>{bold ? <>Finalizar compra <ArrowRight size={20} /></> : <><MessageCircle size={20} /> Enviar pedido por WhatsApp</>}</PrimaryButton>
            <ul className="space-y-2 border-t border-line pt-4 text-xs text-muted">
              {bold && <Trust icon={<Lock size={15} />}>Pago seguro con Bold: tarjeta, PSE o Nequi</Trust>}
              <Trust icon={<ShieldCheck size={15} />}>Tus datos viajan cifrados</Trust>
              <Trust icon={<MessageCircle size={15} />}>¿Dudas? Te atendemos por WhatsApp</Trust>
            </ul>
          </div>
        </aside>
      </div>

      {/* Celular: total y botón siempre a la mano. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 lg:hidden">
        <div className="mb-2 flex items-baseline justify-between text-sm"><span className="text-muted">Total{bold && shipping > 0 ? ' con envío' : ''}</span><span className="text-xl font-bold tabular-nums text-ink">{money(bold ? onlineTotal : subtotal)}</span></div>
        <PrimaryButton onClick={finish} disabled={unavailable}>{bold ? <>Finalizar compra <ArrowRight size={20} /></> : <><MessageCircle size={20} /> Enviar pedido por WhatsApp</>}</PrimaryButton>
      </div>

      {choosing && bold && (
        <CheckoutChoice total={money(onlineTotal)} subtotal={money(subtotal)} shipping={shipping > 0 ? money(shipping) : 'gratis'} testMode={bold.mode === 'test'} storeName={store.name}
          onPay={() => { setChoosing(false); navigate('/checkout') }} onWhatsApp={openWhatsAppOrder} onClose={() => setChoosing(false)} />
      )}
    </div>
  )
}

/** ¿Cómo quieres finalizar? El pago en línea va primero y destacado; WhatsApp sigue disponible. */
function CheckoutChoice(props: { total: string; subtotal: string; shipping: string; testMode: boolean; storeName: string; onPay: () => void; onWhatsApp: () => void; onClose: () => void }) {
  const payButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    payButton.current?.focus()
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') props.onClose() }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={props.onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="checkout-choice-title" onClick={(event) => event.stopPropagation()}
        className="relative max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-2xl sm:max-w-lg sm:rounded-2xl sm:p-6">
        <button type="button" onClick={props.onClose} className="absolute right-3 top-3 rounded-btn p-2 text-muted hover:bg-canvas hover:text-ink" aria-label="Cerrar"><X size={20} /></button>
        <h2 id="checkout-choice-title" className="pr-10 text-xl font-bold text-ink">¿Cómo quieres finalizar tu compra?</h2>
        <p className="mt-1 text-sm text-muted">Elige la opción que prefieras.</p>

        <div className="relative mt-5 rounded-card border-2 border-ink p-4 sm:p-5">
          <span className="absolute -top-3 left-4 rounded-full px-3 py-0.5 text-[11px] font-bold uppercase tracking-wide" style={{ background: 'var(--color-button)', color: 'var(--color-button-text)' }}>Recomendado</span>
          <div className="flex items-start justify-between gap-3">
            <p className="flex items-center gap-2 font-bold text-ink"><CreditCard size={20} /> Pago seguro en línea</p>
            <p className="text-right text-lg font-bold tabular-nums text-ink">{props.total}</p>
          </div>
          <p className="mt-0.5 text-xs text-muted">Productos {props.subtotal} + envío {props.shipping}</p>
          <ul className="mt-3 space-y-1.5 text-sm text-ink">
            <Benefit icon={<Zap size={16} />}>Tu pedido queda confirmado al instante</Benefit>
            <Benefit icon={<PackageCheck size={16} />}>Apartamos tus unidades: nadie más se las lleva</Benefit>
            <Benefit icon={<BadgeCheck size={16} />}>Recibes el comprobante en tu correo</Benefit>
            <Benefit icon={<Lock size={16} />}>Tarjeta, PSE o Nequi, protegido por Bold</Benefit>
          </ul>
          <button ref={payButton} type="button" onClick={props.onPay}
            style={{ background: 'var(--color-button)', color: 'var(--color-button-text)' }}
            className="mt-4 flex min-h-[56px] w-full items-center justify-center gap-2 rounded-btn px-5 text-base font-bold shadow-lg transition-all hover:brightness-105 active:scale-[0.99]">
            <Lock size={18} /> Pagar ahora · {props.total}
          </button>
          {props.testMode && <p className="mt-2 text-center text-[11px] font-semibold text-amber-700">Modo de pruebas: no se cobra dinero real.</p>}
        </div>

        <div className="mt-4 rounded-card border border-line p-4 sm:p-5">
          <p className="flex items-center gap-2 font-bold text-ink"><MessageCircle size={20} /> Pedir por WhatsApp</p>
          <p className="mt-1 text-sm text-muted">Envías el pedido a {props.storeName} y acuerdan por chat el pago y el envío (se cotiza aparte). Tu pedido se confirma cuando la tienda responda.</p>
          <button type="button" onClick={props.onWhatsApp} className="mt-3 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-btn border border-line font-semibold text-ink transition-colors hover:bg-canvas">
            <MessageCircle size={18} /> Continuar por WhatsApp
          </button>
        </div>
      </div>
    </div>
  )
}

function PrimaryButton({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} style={{ background: 'var(--color-button)', color: 'var(--color-button-text)' }}
      className="flex min-h-[56px] w-full items-center justify-center gap-2 rounded-btn px-5 text-base font-bold shadow-lg transition-all hover:brightness-105 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50">
      {children}
    </button>
  )
}

function Row({ label, value, accent }: { label: ReactNode; value: string; accent?: boolean }) {
  return <div className="flex items-center justify-between gap-3"><dt className="text-muted">{label}</dt><dd className={`font-semibold tabular-nums ${accent ? 'text-emerald-700' : 'text-ink'}`}>{value}</dd></div>
}

function Trust({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return <li className="flex items-center gap-2"><span className="shrink-0 text-ink">{icon}</span>{children}</li>
}

function Benefit({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return <li className="flex items-center gap-2"><span className="shrink-0">{icon}</span>{children}</li>
}
