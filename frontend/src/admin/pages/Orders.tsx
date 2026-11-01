import { useEffect, useState } from 'react'
import { RefreshCw, Inbox, ClipboardList } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { getOrders, updateOrderStatus, type OrderApi } from '../../services/api'
import { formatMoney } from '../../lib/format'

const STATUSES = ['pendiente', 'confirmado', 'enviado', 'entregado', 'cancelado']

export default function AdminOrders() {
  const { token, isDemoSession } = useAuth()
  const [orders, setOrders] = useState<OrderApi[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState('todos')

  const load = async () => {
    if (!token || isDemoSession) {
      setOrders([])
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      setOrders(await getOrders(token))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar los pedidos')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [token, isDemoSession])

  const changeStatus = async (id: number, status: string) => {
    if (!token) return
    const previous = orders
    setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, status } : o)))
    try {
      await updateOrderStatus(id, status, token)
    } catch (err) {
      setOrders(previous)
      setError(err instanceof Error ? err.message : 'No se pudo actualizar el estado')
    }
  }

  const filteredOrders = statusFilter === 'todos' ? orders : orders.filter((order) => order.status === statusFilter)
  const pendingCount = orders.filter((order) => ['pendiente', 'confirmado'].includes(order.status)).length

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Pedidos</h1>
          <p className="text-muted">Solicitudes registradas para revisar y gestionar.</p>
        </div>
        <button className="btn-brand flex items-center gap-2" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={18} className={loading ? 'animate-spin' : ''} /> Actualizar
        </button>
      </div>

      {error && <p className="card p-4 text-sm text-red-600">{error}</p>}

      {!isDemoSession && !loading && orders.length > 0 && <div className="grid grid-cols-2 gap-4"><div className="card p-5"><p className="text-xs uppercase tracking-wider text-muted">Pedidos registrados</p><p className="mt-2 text-3xl font-bold text-ink">{orders.length}</p></div><div className="card p-5"><p className="text-xs uppercase tracking-wider text-muted">Pendientes de revisar</p><p className="mt-2 text-3xl font-bold text-ink">{pendingCount}</p></div></div>}

      {isDemoSession ? (
        <p className="card p-4 text-sm bg-amber-50">
          El registro de pedidos requiere el Worker conectado. En modo demo los pedidos solo se envían por WhatsApp.
        </p>
      ) : loading ? (
        <p className="text-muted">Cargando pedidos...</p>
      ) : orders.length === 0 ? (
        <div className="card p-12 text-center">
          <Inbox className="mx-auto mb-3 text-muted" />
          <p className="text-muted">Todavía no hay pedidos registrados.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-3"><ClipboardList size={18} className="text-muted"/><label htmlFor="order-status" className="text-sm font-semibold text-ink">Filtrar pedidos</label><select id="order-status" className="input-field max-w-56" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option value="todos">Todos</option>{STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}</select></div>
          {filteredOrders.length === 0 ? <p className="card p-8 text-center text-sm text-muted">No hay pedidos con este estado.</p> : filteredOrders.map((order) => (
            <article key={order.id} className="card p-4 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h3 className="font-bold">{order.displayId}</h3>
                  <p className="text-xs text-muted">
                    {order.customerName || 'Cliente sin nombre'} · {order.createdAt}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-bold tabular-nums">{formatMoney(order.total, order.currency)}</span>
                  <select
                    className="input-field w-36 py-1"
                    value={order.status}
                    onChange={(e) => void changeStatus(order.id, e.target.value)}
                  >
                    {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <ul className="text-sm divide-y divide-line">
                {order.items.map((item, i) => (
                  <li key={i} className="flex justify-between py-1.5">
                    <span>
                      {item.quantity} × {item.name}
                      {(item.size || item.color) && (
                        <span className="text-muted"> ({[item.size, item.color].filter(Boolean).join(' / ')})</span>
                      )}
                    </span>
                    <span className="tabular-nums text-muted">{item.sku}</span>
                  </li>
                ))}
              </ul>
              {order.deliveryAddress && <p className="text-sm text-muted">Entrega: {order.deliveryAddress}</p>}
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
