import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, ShoppingBag, X } from 'lucide-react'
import { useCart } from '../../contexts/CartContext'

const EVENT = 'cart-item-added'
type Added = { name: string; image: string | null; detail?: string; quantity: number }

/** Announces an item added to the cart without covering the page: the buyer keeps shopping. */
export function notifyAddedToCart(item: Added) {
  document.dispatchEvent(new CustomEvent<Added>(EVENT, { detail: item }))
}

export default function AddedToCartToast() {
  const { totalItems } = useCart()
  const navigate = useNavigate()
  const [item, setItem] = useState<(Added & { key: number }) | null>(null)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => {
    const onAdded = (event: Event) => {
      const detail = (event as CustomEvent<Added>).detail
      if (!detail) return
      setItem({ ...detail, key: Date.now() })
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setItem(null), 4500)
    }
    document.addEventListener(EVENT, onAdded)
    return () => { document.removeEventListener(EVENT, onAdded); window.clearTimeout(timer.current) }
  }, [])

  if (!item) return null
  const close = () => { window.clearTimeout(timer.current); setItem(null) }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:bottom-auto sm:top-20 sm:justify-end sm:px-6">
      <div key={item.key} role="status" aria-live="polite"
        className="pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-card border border-line bg-surface p-3 shadow-2xl animate-fade-in">
        <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-btn bg-canvas">
          {item.image ? <img src={item.image} alt="" className="h-full w-full object-cover" /> : <ShoppingBag size={20} className="m-auto mt-4 text-muted" />}
          <span className="absolute bottom-0.5 right-0.5 grid h-5 w-5 place-items-center rounded-full bg-emerald-600 text-white"><Check size={13} strokeWidth={3} /></span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-emerald-700">Agregado al carrito{item.quantity > 1 ? ` (${item.quantity})` : ''}</p>
          <p className="truncate text-sm font-semibold text-ink">{item.name}</p>
          {item.detail && <p className="truncate text-xs text-muted">{item.detail}</p>}
        </div>
        <button type="button" onClick={() => { close(); navigate('/carrito') }}
          style={{ background: 'var(--color-button)', color: 'var(--color-button-text)' }}
          className="shrink-0 rounded-btn px-3 py-2.5 text-xs font-bold">
          Ver carrito ({totalItems})
        </button>
        <button type="button" onClick={close} className="-ml-1 shrink-0 rounded-btn p-1.5 text-muted hover:text-ink" aria-label="Cerrar aviso"><X size={16} /></button>
      </div>
    </div>
  )
}
