import { useState } from 'react'
import { AlertCircle, ImageIcon, Loader2, Minus, Plus, ShoppingBag, X } from 'lucide-react'
import { trialApi, type TrialColors, type TrialProduct, type TrialTemplate } from '../../services/api'
import { formatMoney } from '../../lib/format'
import { goToWhatsApp, prepareWhatsAppTab } from '../../lib/whatsapp'
import { attributionUrl, PLATFORM_BRAND } from '../../lib/platformBrand'

export type PreviewData = { businessName: string; template: TrialTemplate; logoUrl: string | null; colors: TrialColors; products: TrialProduct[] }
/** When set and open, the temporary store takes real orders by WhatsApp. */
export type ShopOptions = { trialId: string; open: boolean }

/** Readable text colour (black or white) on top of a background colour. */
export function onColor(hex: string): string {
  const value = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((index) => parseInt(value.slice(index, index + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! > 0.4 ? '#111111' : '#ffffff'
}

const price = (value: number | null) => (value === null ? 'Precio por definir' : formatMoney(value, 'COP'))
const GHOSTS: TrialProduct[] = [
  { id: 'ghost-1', name: 'Tu primer producto', price: null, description: '', imageUrl: null },
  { id: 'ghost-2', name: 'Otro producto', price: null, description: '', imageUrl: null },
]

function Logo({ data, size = 40, ring }: { data: PreviewData; size?: number; ring?: string }) {
  const initials = data.businessName.trim().split(/\s+/).slice(0, 2).map((word) => word[0]?.toUpperCase() || '').join('') || 'T'
  return data.logoUrl
    ? <img src={data.logoUrl} alt={`Logo de ${data.businessName}`} width={size} height={size} className="shrink-0 rounded-full bg-white object-cover" style={{ width: size, height: size, boxShadow: ring ? `0 0 0 2px ${ring}` : undefined }} />
    : <span aria-hidden="true" className="grid shrink-0 place-items-center rounded-full text-sm font-black" style={{ width: size, height: size, background: data.colors.accent, color: onColor(data.colors.accent) }}>{initials}</span>
}

function Photo({ product, className }: { product: TrialProduct; className: string }) {
  return product.imageUrl
    ? <img src={product.imageUrl} alt={product.name} loading="lazy" className={`${className} object-cover`} />
    : <div className={`${className} grid place-items-center bg-black/5 text-black/30`}><ImageIcon size={28} aria-hidden="true" /></div>
}

function Ribbon({ dark, open }: { dark?: boolean; open: boolean }) {
  return (
    <p className={`px-3 py-1.5 text-center text-[10px] font-bold uppercase tracking-[0.18em] ${dark ? 'bg-white/10 text-white' : 'bg-black/[0.06] text-black/70'}`}>
      {open ? 'Tienda temporal · pedidos por WhatsApp' : 'Tienda temporal · aún no recibe pedidos'}
    </p>
  )
}

function Attribution({ dark }: { dark?: boolean }) {
  return (
    <a href={attributionUrl('prueba')} target="_blank" rel="noopener" className={`block py-3 text-center text-[11px] ${dark ? 'text-white/60 hover:text-white' : 'text-black/50 hover:text-black'}`}>
      Creado con <b>{PLATFORM_BRAND.name}</b>
    </a>
  )
}

/** The temporary store in one of three templates. With orders open it has a real cart that sends the
 * order to the merchant's WhatsApp (totals are computed by the server; no payment, no inventory). */
export default function TrialPreview({ data, shop }: { data: PreviewData; shop?: ShopOptions }) {
  const [cart, setCart] = useState<Record<string, number>>({})
  const [cartOpen, setCartOpen] = useState(false)
  const products = data.products.length ? data.products : GHOSTS
  const ghost = !data.products.length
  const open = Boolean(shop?.open) && !ghost
  const { primary, accent } = data.colors
  const name = data.businessName || 'Tu negocio'
  const orderable = (product: TrialProduct) => open && product.price !== null
  const lines = data.products.filter((product) => cart[product.id] && product.price !== null).map((product) => ({ product, quantity: cart[product.id]! }))
  const count = lines.reduce((sum, line) => sum + line.quantity, 0)
  const total = lines.reduce((sum, line) => sum + line.quantity * (line.product.price || 0), 0)
  const add = (product: TrialProduct) => setCart((current) => ({ ...current, [product.id]: Math.min(99, (current[product.id] || 0) + 1) }))

  const buy = (product: TrialProduct, className: string, label: string, dark?: boolean) => (
    orderable(product)
      ? <button type="button" onClick={() => add(product)} className={`${className} transition-transform active:scale-95`} style={{ background: accent, color: onColor(accent) }}>{cart[product.id] ? `${label} · ${cart[product.id]}` : label}</button>
      : <span className={`${className} opacity-70`} style={{ background: dark ? 'rgba(255,255,255,.15)' : accent, color: dark ? '#fff' : onColor(accent) }}>{open ? 'Precio por definir' : `${label} (pronto)`}</span>
  )

  const cartBar = count > 0 && (
    <button type="button" onClick={() => setCartOpen(true)} className="flex w-full items-center justify-between gap-2 px-4 py-3 text-sm font-black" style={{ background: primary, color: onColor(primary) }}>
      <span className="inline-flex items-center gap-2"><ShoppingBag size={17} aria-hidden="true" /> Ver pedido ({count})</span><span>{formatMoney(total, 'COP')}</span>
    </button>
  )

  let body
  if (data.template === 'stories') {
    body = (
      <div className="relative h-[min(680px,calc(100dvh-9rem))] overflow-hidden bg-[#0c0c0e] text-white" style={{ fontFamily: "'Manrope', system-ui, sans-serif" }}>
        <div className="absolute inset-x-0 top-0 z-10 space-y-2 bg-gradient-to-b from-black/70 to-transparent p-3 pb-8">
          <div className="flex gap-1" aria-hidden="true">{products.map((product) => <span key={product.id} className="h-0.5 flex-1 rounded bg-white/50" />)}</div>
          <div className="flex items-center gap-2"><Logo data={data} size={32} ring={accent} /><b className="truncate text-sm">{name}</b></div>
        </div>
        <div className="no-scrollbar h-full snap-y snap-mandatory overflow-y-auto overscroll-contain">
          {products.map((product, index) => (
            <article key={product.id} className="relative h-full snap-start">
              <Photo product={product} className={`absolute inset-0 h-full w-full ${ghost ? 'bg-white/5 text-white/30' : ''}`} />
              <div className="absolute inset-x-0 bottom-0 space-y-2 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-5 pb-16 pt-24">
                <span className="text-[11px] font-bold text-white/70">{index + 1}/{products.length}</span>
                <h3 className="text-2xl font-extrabold leading-tight" style={{ fontFamily: "'Sora', system-ui, sans-serif" }}>{product.name}</h3>
                <p className="text-lg font-bold">{price(product.price)}</p>
                {product.description && <p className="line-clamp-2 text-sm text-white/80">{product.description}</p>}
                {buy(product, 'inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold', 'Pedir', true)}
              </div>
            </article>
          ))}
        </div>
        <div className="absolute inset-x-0 bottom-0 z-10">{cartBar || <Ribbon dark open={open} />}</div>
      </div>
    )
  } else if (data.template === 'boutique') {
    body = (
      <div className="bg-[#faf7f4] text-[#2b2220]" style={{ fontFamily: "'DM Sans', system-ui, sans-serif" }}>
        <Ribbon open={open} />
        <header className="flex flex-col items-center gap-3 px-6 pb-6 pt-8 text-center">
          <Logo data={data} size={64} />
          <h3 className="text-[1.7rem] font-semibold leading-tight" style={{ fontFamily: "'Playfair Display', Georgia, serif", color: primary }}>{name}</h3>
          <span className="h-px w-16" style={{ background: accent }} aria-hidden="true" />
          <p className="text-xs uppercase tracking-[0.25em] text-[#2b2220]/60">Colección</p>
        </header>
        <div className="grid grid-cols-2 gap-x-4 gap-y-6 px-5 pb-6">
          {products.map((product, index) => {
            const wide = index === 0 && products.length % 2 === 1
            return (
              <article key={product.id} className={`space-y-2 text-center ${wide ? 'col-span-2' : ''}`}>
                <Photo product={product} className={`w-full rounded-2xl ${wide ? 'aspect-[4/3]' : 'aspect-[4/5]'}`} />
                <h4 className="text-[15px] leading-snug" style={{ fontFamily: "'Playfair Display', Georgia, serif" }}>{product.name}</h4>
                <p className="text-sm font-semibold" style={{ color: primary }}>{price(product.price)}</p>
                {buy(product, 'inline-block rounded-full px-4 py-1.5 text-xs font-bold', 'Agregar')}
              </article>
            )
          })}
        </div>
        <Attribution />
        {cartBar && <div className="sticky bottom-0">{cartBar}</div>}
      </div>
    )
  } else {
    body = (
      <div className="bg-[#f5f6f8] text-[#16181d]" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
        <header className="flex items-center gap-3 px-4 py-4" style={{ background: primary, color: onColor(primary) }}>
          <Logo data={data} size={42} />
          <div className="min-w-0"><h3 className="truncate text-lg font-extrabold leading-tight">{name}</h3><p className="text-xs opacity-80">Catálogo en línea</p></div>
        </header>
        <Ribbon open={open} />
        <div className="grid grid-cols-2 gap-3 p-3">
          {products.map((product) => (
            <article key={product.id} className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-black/5">
              <Photo product={product} className="aspect-square w-full" />
              <div className="space-y-1.5 p-2.5">
                <h4 className="line-clamp-2 text-[13px] font-semibold leading-snug">{product.name}</h4>
                <p className="text-sm font-extrabold" style={{ color: primary }}>{price(product.price)}</p>
                {buy(product, 'block w-full rounded-lg py-1.5 text-center text-xs font-bold', 'Agregar')}
              </div>
            </article>
          ))}
        </div>
        <Attribution />
        {cartBar && <div className="sticky bottom-0">{cartBar}</div>}
      </div>
    )
  }

  return (
    <>
      {body}
      {cartOpen && shop && <CartDialog trialId={shop.trialId} storeName={name} lines={lines} total={total}
        onChange={(id, quantity) => setCart((current) => { const next = { ...current }; if (quantity <= 0) delete next[id]; else next[id] = Math.min(99, quantity); return next })}
        onClose={() => setCartOpen(false)} onSent={() => { setCart({}); setCartOpen(false) }} />}
    </>
  )
}

function CartDialog({ trialId, storeName, lines, total, onChange, onClose, onSent }: {
  trialId: string; storeName: string; lines: Array<{ product: TrialProduct; quantity: number }>; total: number
  onChange: (id: string, quantity: number) => void; onClose: () => void; onSent: () => void
}) {
  const [customerName, setCustomerName] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const send = async () => {
    const tab = prepareWhatsAppTab()
    setBusy(true); setError(null)
    try {
      const order = await trialApi.order(trialId, { items: lines.map((line) => ({ productId: line.product.id, quantity: line.quantity })), customerName, note })
      goToWhatsApp(order.whatsappUrl, tab)
      onSent()
    } catch (err) {
      tab?.close()
      setError(err instanceof Error ? err.message : 'No se pudo enviar el pedido.')
    } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div role="dialog" aria-modal="true" aria-labelledby="cart-title" className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 text-[#16181d] shadow-2xl sm:rounded-3xl">
        <div className="flex items-center justify-between"><h2 id="cart-title" className="text-lg font-black">Tu pedido en {storeName}</h2>
          <button type="button" aria-label="Cerrar" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-full hover:bg-black/5"><X size={18} /></button></div>
        {!lines.length ? <p className="py-6 text-sm text-black/60">Tu pedido está vacío.</p> : (
          <ul className="mt-3 divide-y divide-black/5">
            {lines.map(({ product, quantity }) => (
              <li key={product.id} className="flex items-center gap-3 py-3">
                {product.imageUrl ? <img src={product.imageUrl} alt="" className="h-12 w-12 rounded-lg object-cover" /> : <span className="h-12 w-12 rounded-lg bg-black/5" />}
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{product.name}</p><p className="text-xs text-black/60">{formatMoney(product.price || 0, 'COP')}</p></div>
                <div className="flex items-center gap-1">
                  <button type="button" aria-label={`Quitar uno de ${product.name}`} onClick={() => onChange(product.id, quantity - 1)} className="grid h-9 w-9 place-items-center rounded-full border border-black/10"><Minus size={14} /></button>
                  <span className="w-6 text-center text-sm font-bold" aria-live="polite">{quantity}</span>
                  <button type="button" aria-label={`Agregar uno de ${product.name}`} onClick={() => onChange(product.id, quantity + 1)} className="grid h-9 w-9 place-items-center rounded-full border border-black/10"><Plus size={14} /></button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 flex justify-between border-t border-black/10 pt-3 text-base font-black"><span>Total</span><span>{formatMoney(total, 'COP')}</span></p>
        <div className="mt-4 space-y-3">
          <label className="block space-y-1"><span className="text-sm font-bold">Tu nombre <span className="font-normal text-black/50">(opcional)</span></span>
            <input className="w-full rounded-xl border border-black/15 px-3 py-2.5 text-[15px]" maxLength={80} autoComplete="name" value={customerName} onChange={(e) => setCustomerName(e.target.value)} /></label>
          <label className="block space-y-1"><span className="text-sm font-bold">Nota para el vendedor <span className="font-normal text-black/50">(opcional)</span></span>
            <textarea className="w-full resize-none rounded-xl border border-black/15 px-3 py-2.5 text-[15px]" rows={2} maxLength={300} placeholder="Ej.: dirección o color" value={note} onChange={(e) => setNote(e.target.value)} /></label>
        </div>
        {error && <p role="alert" className="mt-3 flex items-center gap-2 text-sm font-semibold text-red-700"><AlertCircle size={16} />{error}</p>}
        <button type="button" disabled={busy || !lines.length} onClick={() => void send()} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full py-3.5 text-[15px] font-black disabled:opacity-50" style={{ background: '#147B55', color: '#fff' }}>
          {busy && <Loader2 size={16} className="animate-spin" />} Enviar pedido por WhatsApp
        </button>
        <p className="mt-3 text-center text-xs text-black/55">Es una tienda temporal creada con {PLATFORM_BRAND.name}. El pago y la entrega se acuerdan directamente con el vendedor por WhatsApp.</p>
      </div>
    </div>
  )
}
