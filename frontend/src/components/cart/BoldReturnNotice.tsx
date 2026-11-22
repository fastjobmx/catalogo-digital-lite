import { useEffect, useState } from 'react'
import { CheckCircle2, Clock, XCircle, X } from 'lucide-react'
import { useCart } from '../../contexts/CartContext'
import { getBoldPaymentStatus, type BoldPaymentStatus } from '../../services/api'
import { findBoldPayment, forgetBoldPayment } from '../../lib/bold'
import { formatMoney } from '../../lib/format'

type View = { kind: 'checking' } | { kind: 'paid' | 'processing' | 'failed' | 'unknown'; status?: BoldPaymentStatus }

const FINAL_FAILED = ['rechazado', 'fallido', 'anulado', 'monto_distinto']

/** The buyer came back from Bold (?bold-order-id=…). The redirect status is only a hint: the server asks Bold. */
export default function BoldReturnNotice() {
  const { clearCart } = useCart()
  const [view, setView] = useState<View | null>(null)
  // Read once: the effect may run twice (React development mode) after the address bar was cleaned.
  const [reference] = useState(() => new URLSearchParams(window.location.search).get('bold-order-id'))

  useEffect(() => {
    if (!reference) return
    // Clean the address bar so a reload does not repeat the notice.
    const url = new URL(window.location.href)
    for (const key of [...url.searchParams.keys()]) if (key.startsWith('bold-')) url.searchParams.delete(key)
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash)

    const pending = findBoldPayment(reference)
    if (!pending) { setView({ kind: 'unknown' }); return }
    let cancelled = false
    setView({ kind: 'checking' })
    const check = async (tries: number) => {
      try {
        const status = await getBoldPaymentStatus({ reference, checkoutKey: pending.checkoutKey })
        if (cancelled) return
        if (status.paymentStatus === 'verificado') { setView({ kind: 'paid', status }); clearCart(); forgetBoldPayment(reference); return }
        if (FINAL_FAILED.includes(status.attemptStatus)) { setView({ kind: 'failed', status }); return }
        if (tries > 0) { window.setTimeout(() => void check(tries - 1), 4000); return }
        setView({ kind: 'processing', status })
      } catch {
        if (!cancelled) setView({ kind: 'processing' })
      }
    }
    void check(5)
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reference])

  if (!view) return null
  const status = view.kind === 'checking' ? undefined : view.status
  const amount = status ? formatMoney(status.amount, status.currency) : ''
  const content = {
    checking: { icon: <Clock className="text-muted" size={36} />, title: 'Confirmando tu pago…', text: 'Estamos consultando el resultado con Bold. Tarda unos segundos.' },
    paid: { icon: <CheckCircle2 className="text-emerald-600" size={36} />, title: '¡Pago aprobado!', text: `Recibimos ${amount} para el pedido ${status?.displayId}. El comercio ya puede prepararlo.` },
    processing: { icon: <Clock className="text-amber-600" size={36} />, title: 'Tu pago está en proceso', text: `Bold aún no confirma el pago${status ? ` del pedido ${status.displayId}` : ''}. Si se aprueba, el comercio lo verá automáticamente; no vuelvas a pagar.` },
    failed: { icon: <XCircle className="text-red-600" size={36} />, title: 'El pago no fue aprobado', text: `No se cobró el pedido ${status?.displayId}. Puedes intentarlo de nuevo desde el carrito o pagar por otro medio por WhatsApp.` },
    unknown: { icon: <Clock className="text-muted" size={36} />, title: 'Volviste de Bold', text: 'Si completaste el pago, el comercio lo verá en su panel. Ante cualquier duda escríbele por WhatsApp con tu número de pedido.' },
  }[view.kind]

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 px-4" role="dialog" aria-modal="true" aria-labelledby="bold-return-title">
      <div className="card relative w-full max-w-sm p-7 text-center space-y-3">
        {view.kind !== 'checking' && <button onClick={() => setView(null)} className="absolute right-3 top-3 p-1 text-muted hover:text-ink" aria-label="Cerrar"><X size={18} /></button>}
        <div className="flex justify-center">{content.icon}</div>
        <h2 id="bold-return-title" className="text-lg font-bold text-ink">{content.title}</h2>
        <p className="text-sm text-muted">{content.text}</p>
        {status?.mode === 'test' && <p className="text-[11px] font-semibold text-amber-700">Modo de pruebas de Bold: no se cobró dinero real.</p>}
        {view.kind !== 'checking' && <button onClick={() => setView(null)} className="btn-brand w-full justify-center">Entendido</button>}
      </div>
    </div>
  )
}
