import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, ExternalLink, Inbox, Printer, RefreshCw, Search, X } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { getOrder, getOrders, updateOrder, type OrderApi, type OrderDetailApi } from '../../services/api'
import { formatMoney } from '../../lib/format'
import { resolveImageUrl } from '../../lib/imageSources'

const STATUSES = ['pendiente', 'confirmado', 'preparando', 'enviado', 'entregado', 'cancelado']
const NEXT_STATUSES: Record<string, string[]> = {
  pendiente: ['pendiente', 'confirmado', 'cancelado'], confirmado: ['confirmado', 'preparando', 'cancelado'],
  preparando: ['preparando', 'enviado', 'cancelado'], enviado: ['enviado', 'entregado'], entregado: ['entregado'], cancelado: ['cancelado'],
}
const PAYMENT_STATUSES = ['pendiente', 'comprobante_recibido', 'verificado', 'reembolsado']

function csvCell(value: unknown) { return `"${String(value ?? '').replaceAll('"', '""')}"` }
function exportOrders(orders: OrderApi[]) {
  const columns = ['Pedido', 'Fecha', 'Comprador', 'Teléfono', 'Ciudad', 'Productos', 'Subtotal', 'Envío', 'Total', 'Moneda', 'Pago', 'Estado']
  const rows = orders.map((order) => [order.displayId, order.createdAt, order.customerName, order.customerPhone, order.customerCity,
    order.items.map((item) => `${item.quantity}x ${item.name} ${item.size || ''} ${item.color || ''}`).join(' | '), order.subtotal,
    order.shippingCost ?? 'Por cotizar', order.total ?? 'Por cotizar', order.currency, order.paymentStatus, order.status])
  const content = '\ufeff' + [columns, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a'); link.href = url; link.download = 'pedidos.csv'; link.click(); URL.revokeObjectURL(url)
}

function DetailModal({ order, onClose, onSaved }: { order: OrderDetailApi; onClose: () => void; onSaved: (updated: OrderDetailApi) => void }) {
  const { token } = useAuth()
  const [status, setStatus] = useState(order.status)
  const [paymentStatus, setPaymentStatus] = useState(order.paymentStatus)
  const [shipping, setShipping] = useState(order.shippingCost == null ? '' : String(order.shippingCost))
  const [notes, setNotes] = useState(order.internalNotes || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [zoomUrl, setZoomUrl] = useState<string | null>(null)

  const save = async () => {
    if (!token) return
    setSaving(true); setError('')
    try {
      await updateOrder(order.id, { status, paymentStatus, internalNotes: notes, shippingCost: shipping === '' ? null : Number(shipping), expectedRevision: order.revision }, token)
      onSaved(await getOrder(order.id, token))
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar el pedido') } finally { setSaving(false) }
  }

  return <div className="fixed inset-0 z-[70] overflow-y-auto bg-black/50 p-3 sm:p-8" role="dialog" aria-modal="true" aria-label={`Pedido ${order.displayId}`}>
    <style>{`@media print { body * { visibility: hidden !important; } .print-order, .print-order * { visibility: visible !important; } .print-order { position: absolute; inset: 0; width: 100%; padding: 24px; } .no-print { display:none !important; } }`}</style>
    <div className="print-order mx-auto w-full max-w-4xl rounded-card bg-surface p-5 shadow-2xl sm:p-8">
      <header className="mb-6 flex items-start justify-between gap-3 border-b border-line pb-5">
        <div><p className="text-xs font-bold uppercase tracking-widest text-muted">Comprobante de pedido</p><h2 className="mt-1 text-2xl font-bold">{order.displayId}</h2><p className="mt-1 text-sm text-muted">{new Date(order.createdAt).toLocaleString('es-CO')}</p></div>
        <div className="no-print flex gap-2"><button className="inline-flex items-center gap-2 rounded-btn border border-line px-3 py-2 text-sm font-semibold hover:bg-canvas" onClick={() => window.print()}><Printer size={16}/> Imprimir</button><button className="rounded-btn p-2 hover:bg-canvas" onClick={onClose} aria-label="Cerrar"><X/></button></div>
      </header>
      <div className="grid gap-6 md:grid-cols-[1.4fr_1fr]">
        <section>
          <h3 className="mb-3 text-sm font-bold uppercase tracking-wide">Artículos</h3>
          <div className="space-y-3">{order.items.map((item, i) => {
            const image = resolveImageUrl(item.imageUrl)
            return <article key={`${item.variantId}-${i}`} className="flex gap-3 rounded-card border border-line p-3">
              <button type="button" className="h-20 w-20 shrink-0 overflow-hidden rounded-btn bg-canvas text-xs text-muted" onClick={() => image && setZoomUrl(image)} disabled={!image} aria-label={image ? `Ampliar foto de ${item.name}` : `Foto no disponible: ${item.name}`}>
                {image ? <img src={image} alt={item.name} className="h-full w-full object-cover"/> : <span className="grid h-full place-items-center">Sin foto</span>}
              </button>
              <div className="min-w-0 flex-1"><h4 className="font-semibold">{item.name}</h4><p className="text-xs text-muted">SKU {item.sku} · {[item.color, item.size].filter(Boolean).join(' / ') || 'Variante sin detalle'}</p>
                <div className="mt-2 flex justify-between gap-2 text-sm"><span>{item.quantity} × {formatMoney(item.price, order.currency)}</span><b>{formatMoney(item.lineSubtotal ?? item.price * item.quantity, order.currency)}</b></div>
              </div>
            </article>
          })}</div>
        </section>
        <section className="space-y-5">
          <div><h3 className="mb-2 text-sm font-bold uppercase tracking-wide">Comprador</h3><dl className="space-y-1 text-sm">
            <div><dt className="inline text-muted">Nombre: </dt><dd className="inline">{order.customerName || '—'}</dd></div>
            <div><dt className="inline text-muted">Teléfono: </dt><dd className="inline">{order.customerPhone || '—'}</dd></div>
            <div><dt className="inline text-muted">Correo: </dt><dd className="inline">{order.customerEmail || '—'}</dd></div>
            <div><dt className="inline text-muted">Ciudad: </dt><dd className="inline">{order.customerCity || '—'}</dd></div>
            <div><dt className="inline text-muted">Dirección: </dt><dd className="inline">{order.deliveryAddress || '—'}</dd></div>
            <div><dt className="inline text-muted">Entrega: </dt><dd className="inline">{order.deliveryMethod || '—'}</dd></div>
            <div><dt className="inline text-muted">Pago preferido: </dt><dd className="inline">{order.paymentMethod || '—'}</dd></div>
            {order.customerNotes && <div className="pt-2"><dt className="text-muted">Observaciones del comprador</dt><dd>{order.customerNotes}</dd></div>}
          </dl></div>
          <div className="rounded-card bg-canvas p-4 text-sm"><div className="flex justify-between"><span>Subtotal</span><b>{formatMoney(order.subtotal, order.currency)}</b></div><div className="mt-1 flex justify-between"><span>Descuento</span><b>{formatMoney(order.discountTotal, order.currency)}</b></div><div className="mt-1 flex justify-between"><span>Envío</span><b>{order.shippingCost == null ? 'Por cotizar' : formatMoney(order.shippingCost, order.currency)}</b></div><div className="mt-3 flex justify-between border-t border-line pt-3 text-base"><span>Total</span><b>{order.total == null ? 'Por cotizar' : formatMoney(order.total, order.currency)}</b></div></div>
          <div className="no-print space-y-3"><label className="block text-xs font-semibold">Estado<select className="input-field mt-1" value={status} onChange={(e) => setStatus(e.target.value)}>{(NEXT_STATUSES[order.status] || [order.status]).map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
            <label className="block text-xs font-semibold">Estado de pago<select className="input-field mt-1" value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value)}>{PAYMENT_STATUSES.map((s) => <option key={s} value={s}>{s.replaceAll('_', ' ')}</option>)}</select></label>
            <label className="block text-xs font-semibold">Envío (dejar vacío para “Por cotizar”)<input type="number" min="0" step="1" className="input-field mt-1" value={shipping} onChange={(e) => setShipping(e.target.value)}/></label>
            <label className="block text-xs font-semibold">Notas internas<textarea maxLength={4000} rows={3} className="input-field mt-1" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Solo visible para el equipo administrador"/></label>
            {error && <p role="alert" className="text-sm text-red-700">{error}</p>}<button className="btn-brand w-full" onClick={() => void save()} disabled={saving}>{saving ? 'Guardando…' : 'Guardar cambios'}</button>
          </div>
        </section>
      </div>
      <section className="mt-6 border-t border-line pt-4"><h3 className="mb-2 text-sm font-bold uppercase tracking-wide">Historial</h3><ol className="space-y-2 text-xs text-muted">{order.events.map((event, index) => <li key={`${event.createdAt}-${index}`}>{new Date(event.createdAt).toLocaleString('es-CO')} · {event.eventType.replaceAll('_', ' ')}{event.fromValue ? `: ${event.fromValue} → ${event.toValue}` : event.toValue ? `: ${event.toValue}` : ''} · {event.performedBy}</li>)}</ol></section>
    </div>
    {zoomUrl && <button className="no-print fixed inset-0 z-[80] grid place-items-center bg-black/90 p-5" onClick={() => setZoomUrl(null)} aria-label="Cerrar imagen ampliada"><img src={zoomUrl} alt="Fotografía ampliada del artículo" className="max-h-full max-w-full object-contain"/><X className="absolute right-5 top-5 text-white"/></button>}
  </div>
}

export default function AdminOrders() {
  const { token, isDemoSession } = useAuth()
  const [orders, setOrders] = useState<OrderApi[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<OrderDetailApi | null>(null)
  const [status, setStatus] = useState('todos')
  const [q, setQ] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize] = useState(20)
  const [csvLoading, setCsvLoading] = useState(false)
  const [total, setTotal] = useState(0)
  const query = useMemo(() => ({ page, pageSize, status, from, to, q }), [page, pageSize, status, from, to, q])

  const load = useCallback(async () => {
    if (!token || isDemoSession) { setOrders([]); setTotal(0); setLoading(false); return }
    setLoading(true); setError(null)
    try { const result = await getOrders(token, query); setOrders(result.items); setTotal(result.total) }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudieron cargar los pedidos') }
    finally { setLoading(false) }
  }, [token, isDemoSession, query])
  useEffect(() => { void load() }, [load])

  const openOrder = async (id: number) => {
    if (!token) return
    try { setSelected(await getOrder(id, token)) } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo abrir el pedido') }
  }
  const saved = async (updated: OrderDetailApi) => { setSelected(updated); await load() }

  const exportCsv = async () => {
    if (!token) return
    setCsvLoading(true)
    try {
      const first = await getOrders(token, { ...query, page: 1, pageSize: 100 })
      const all = [...first.items]
      for (let nextPage = 2; all.length < first.total; nextPage++) {
        const next = await getOrders(token, { ...query, page: nextPage, pageSize: 100 })
        if (!next.items.length) break
        all.push(...next.items)
      }
      exportOrders(all)
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo exportar el CSV') }
    finally { setCsvLoading(false) }
  }
  const pending = orders.filter((order) => order.status === 'pendiente').length

  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-widest text-muted">Operaciones</p><h1 className="mt-1 text-3xl font-bold">Pedidos</h1><p className="mt-1 text-sm text-muted">Solicitudes registradas, seguimiento y comprobantes.</p></div>
      <div className="flex gap-2"><button className="inline-flex items-center gap-2 rounded-btn border border-line px-3 py-2 text-sm font-semibold hover:bg-canvas disabled:opacity-50" onClick={() => void exportCsv()} disabled={!orders.length || csvLoading}><Download size={16}/> {csvLoading ? 'Preparando…' : 'CSV'}</button><button className="btn-brand inline-flex items-center gap-2" onClick={() => void load()} disabled={loading}><RefreshCw size={16} className={loading ? 'animate-spin' : ''}/> Actualizar</button></div>
    </div>
    {error && <p role="alert" className="card p-4 text-sm text-red-700">{error}</p>}
    {isDemoSession ? <p className="card bg-amber-50 p-4 text-sm">El panel de pedidos está deshabilitado durante la sesión demo. No se consultan datos de compradores.</p> : <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3"><div className="card p-4"><p className="text-xs uppercase tracking-wider text-muted">Resultados</p><p className="mt-1 text-2xl font-bold">{total}</p></div><div className="card p-4"><p className="text-xs uppercase tracking-wider text-muted">Pendientes en página</p><p className="mt-1 text-2xl font-bold">{pending}</p></div><div className="card col-span-2 p-4 sm:col-span-1"><p className="text-xs uppercase tracking-wider text-muted">Página</p><p className="mt-1 text-2xl font-bold">{page} <span className="text-base font-normal text-muted">/ {Math.max(1, Math.ceil(total / pageSize))}</span></p></div></div>
      <div className="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[minmax(220px,1fr)_180px_160px_160px]"><label className="relative"><Search size={17} className="absolute left-3 top-3 text-muted"/><input className="input-field pl-9" placeholder="ID, cliente, teléfono o producto" value={q} onChange={(e) => { setPage(1); setQ(e.target.value) }}/></label>
        <select className="input-field" value={status} onChange={(e) => { setPage(1); setStatus(e.target.value) }}><option value="todos">Todos los estados</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
        <label className="text-xs text-muted">Desde<input type="date" className="input-field mt-1" value={from} onChange={(e) => { setPage(1); setFrom(e.target.value) }}/></label><label className="text-xs text-muted">Hasta<input type="date" className="input-field mt-1" value={to} onChange={(e) => { setPage(1); setTo(e.target.value) }}/></label>
      </div>
      {loading ? <p className="text-sm text-muted">Cargando pedidos…</p> : orders.length === 0 ? <div className="card p-12 text-center"><Inbox className="mx-auto mb-3 text-muted"/><p className="text-muted">No hay pedidos para estos filtros.</p></div> : <>
        <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-canvas text-xs uppercase tracking-wide text-muted"><tr>{['Pedido / fecha', 'Comprador', 'Artículos', 'Subtotal', 'Pago', 'Estado', ''].map((h) => <th key={h} className="px-4 py-3">{h}</th>)}</tr></thead><tbody className="divide-y divide-line">{orders.map((order) => <tr key={order.id} className="hover:bg-canvas/60"><td className="px-4 py-3"><b>{order.displayId}</b><p className="text-xs text-muted">{new Date(order.createdAt).toLocaleString('es-CO')}</p></td><td className="px-4 py-3">{order.customerName || 'Sin nombre'}<p className="text-xs text-muted">{order.customerPhone || 'Sin teléfono'}</p></td><td className="px-4 py-3"><div className="flex items-center gap-1">{order.items.slice(0, 3).map((item, i) => { const src = resolveImageUrl(item.imageUrl); return src ? <img key={`${item.variantId}-${i}`} src={src} alt="" className="h-9 w-9 rounded object-cover"/> : <span key={`${item.variantId}-${i}`} className="grid h-9 w-9 place-items-center rounded bg-canvas text-[9px] text-muted">—</span> })}<span className="ml-1 text-xs text-muted">{order.items.length} líneas</span></div></td><td className="px-4 py-3 font-semibold">{formatMoney(order.subtotal, order.currency)}<p className="text-[11px] font-normal text-muted">Envío: {order.shippingCost == null ? 'Por cotizar' : formatMoney(order.shippingCost, order.currency)}</p></td><td className="px-4 py-3">{order.paymentStatus.replaceAll('_', ' ')}</td><td className="px-4 py-3"><span className="rounded-full bg-canvas px-2.5 py-1 text-xs font-semibold">{order.status}</span></td><td className="px-4 py-3"><button className="inline-flex items-center gap-1 font-semibold text-brand" onClick={() => void openOrder(order.id)}>Detalle <ExternalLink size={14}/></button></td></tr>)}</tbody></table></div></div>
        <div className="flex items-center justify-between"><p className="text-xs text-muted">Mostrando {orders.length} de {total} pedidos</p><div className="flex gap-2"><button className="rounded-btn border border-line px-4 py-2 text-sm font-semibold hover:bg-canvas disabled:opacity-50" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Anterior</button><button className="rounded-btn border border-line px-4 py-2 text-sm font-semibold hover:bg-canvas disabled:opacity-50" disabled={page * pageSize >= total} onClick={() => setPage((p) => p + 1)}>Siguiente</button></div></div>
      </>}
    </>}
    {selected && <DetailModal order={selected} onClose={() => setSelected(null)} onSaved={(updated) => void saved(updated)}/>}
  </div>
}
