import { Link } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import { Package, Tag, ShoppingCart, Palette, Zap, Shield, Activity, ArrowRight, Plus, ExternalLink, AlertTriangle } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useStore } from '../../contexts/StoreContext'
import { useCatalog } from '../../contexts/CatalogContext'
import { getOrders, type OrderApi } from '../../services/api'
import { formatMoney } from '../../lib/format'
import { resolveImageUrl } from '../../lib/imageSources'

export default function Dashboard() {
  const { stats, token, isDemoSession } = useAuth()
  const { isDemoMode, backendAvailable, store } = useStore()
  const { products, error: catalogError } = useCatalog()
  const [orders, setOrders] = useState<OrderApi[]>([])
  const [ordersLoading, setOrdersLoading] = useState(false)
  const [ordersError, setOrdersError] = useState('')

  useEffect(() => {
    if (!backendAvailable || !token || isDemoSession) { setOrders([]); return }
    let active = true
    setOrdersLoading(true)
    setOrdersError('')
    getOrders(token, { pageSize: 5 }).then((result) => { if (active) setOrders(result.items) })
      .catch((err: unknown) => { if (active) setOrdersError(err instanceof Error ? err.message : 'No se pudieron cargar pedidos') })
      .finally(() => { if (active) setOrdersLoading(false) })
    return () => { active = false }
  }, [backendAvailable, token, isDemoSession])

  const lowStock = useMemo(() => products.map((product) => ({ product, stock: product.variants.reduce((sum, variant) => sum + variant.stock, 0) })).filter(({ stock }) => stock > 0 && stock <= 5).sort((a, b) => a.stock - b.stock).slice(0, 5), [products])

  const kpis = [
    { icon: Package, label: 'Productos', value: stats ? stats.products : '—', tone: 'text-brand' },
    { icon: Tag, label: 'Categorías', value: stats ? stats.categories : '—', tone: 'text-brand-secondary' },
    { icon: ShoppingCart, label: 'Unidades en stock', value: stats ? stats.totalStock : '—', tone: 'text-brand-accent' },
    { icon: Activity, label: 'Pedidos de hoy', value: stats ? stats.ordersToday : '—', tone: 'text-brand' },
  ]

  const modules = [
    { to: '/admin/products', icon: Package, title: 'Productos', text: 'Gestiona el catálogo, fotos, precios y variantes.' },
    { to: '/admin/categories', icon: Tag, title: 'Categorías', text: 'Organiza las secciones de tu tienda.' },
    { to: '/admin/appearance', icon: Palette, title: 'Apariencia', text: 'Personaliza el diseño y la identidad visual.' },
    { to: '/admin/settings', icon: Shield, title: 'Configuración', text: 'Datos de la tienda, contacto y WhatsApp.' },
  ]

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Encabezado */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Zap size={15} className="text-brand" />
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand/70">Panel de control</span>
          </div>
          <h1 className="text-3xl font-black tracking-tight text-ink">Resumen de tu tienda</h1>
          <p className="text-muted text-sm mt-1.5">Hola, {store.name}. Aquí tienes el estado de tu catálogo.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/admin/products?new=1" className="btn-brand"><Plus size={16}/> Agregar producto</Link>
          <Link to="/" target="_blank" className="btn-ghost"><ExternalLink size={16}/> Ver tienda</Link>
        </div>
      </div>

      {/* Aviso modo demostración */}
      {isDemoMode && (
        <div className="flex items-start gap-4 p-5 rounded-card bg-amber-50 border border-amber-200">
          <div className="grid place-items-center w-10 h-10 rounded-btn bg-amber-100 shrink-0">
            <Shield size={20} className="text-amber-600" />
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-amber-700">Modo demostración</p>
            <p className="text-sm text-amber-800/90 mt-0.5">
              El backend no está disponible. Las cifras de esta vista no están sincronizadas con el servidor.
            </p>
          </div>
        </div>
      )}
      {catalogError && <p role="alert" className="card border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">No se pudo cargar el catálogo desde el servidor: {catalogError}</p>}

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {kpis.map(({ icon: Icon, label, value, tone }) => (
          <div key={label} className="card p-6 group hover:shadow-card-hover transition-shadow">
            <div className="grid place-items-center w-12 h-12 rounded-btn bg-canvas border border-line mb-5">
              <Icon size={22} className={tone} />
            </div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-muted mb-1">{label}</p>
            <p className="text-4xl font-black text-ink tracking-tight tabular-nums">{value}</p>
          </div>
        ))}
      </div>

      <section className="grid grid-cols-1 xl:grid-cols-2 gap-5" aria-label="Estado y configuración">
        <div className="card p-6">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div><h2 className="text-lg font-bold text-ink">Estado del servicio</h2><p className="text-sm text-muted">Conexión administrativa</p></div>
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${backendAvailable ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{backendAvailable ? 'Conectado' : 'Sin conexión'}</span>
          </div>
          <p className="text-sm text-muted">{backendAvailable ? 'Las consultas se realizan contra el servicio configurado.' : 'Los cambios se mantienen en modo local mientras el servicio no esté disponible.'}</p>
        </div>
        <div className="card p-6">
          <h2 className="text-lg font-bold text-ink mb-4">Completa tu tienda</h2>
          <div className="space-y-3 text-sm">
            {!store.logo && <Link to="/admin/appearance#marca" className="flex items-center justify-between text-ink hover:text-brand">Añade el logotipo <ArrowRight size={15}/></Link>}
            {!store.theme.hero.imageUrl && <Link to="/admin/appearance#portada" className="flex items-center justify-between text-ink hover:text-brand">Añade una imagen de portada <ArrowRight size={15}/></Link>}
            {(store.logo && store.theme.hero.imageUrl) && <Link to="/admin/settings" className="flex items-center justify-between text-ink hover:text-brand">Revisar datos comerciales y WhatsApp <ArrowRight size={15}/></Link>}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-2 gap-5" aria-label="Actividad e inventario">
        <div className="card p-6">
          <div className="mb-4 flex items-center justify-between"><div><h2 className="text-lg font-bold text-ink">Pedidos recientes</h2><p className="text-sm text-muted">Registros consultados al servidor</p></div><Link to="/admin/orders" className="text-sm font-semibold text-brand">Ver pedidos</Link></div>
          {isDemoSession || !backendAvailable ? <p className="text-sm text-muted">Conecta el servidor y una sesión administrativa para consultar pedidos reales.</p> : ordersLoading ? <p className="text-sm text-muted">Cargando pedidos…</p> : ordersError ? <p role="alert" className="text-sm text-red-700">{ordersError}</p> : orders.length === 0 ? <p className="text-sm text-muted">Todavía no hay pedidos registrados.</p> : <ul className="divide-y divide-line">{orders.slice(0, 5).map((order) => <li key={order.id} className="flex items-center justify-between gap-3 py-3"><div className="min-w-0"><p className="truncate text-sm font-semibold text-ink">{order.displayId} · {order.customerName || 'Cliente'}</p><p className="text-xs text-muted">{new Date(order.createdAt).toLocaleDateString('es-CO')} · {order.status}</p></div><span className="shrink-0 text-sm font-semibold tabular-nums">{order.total == null ? 'Por cotizar' : formatMoney(order.total, order.currency)}</span></li>)}</ul>}
        </div>
        <div className="card p-6">
          <div className="mb-4 flex items-center justify-between"><div><h2 className="text-lg font-bold text-ink">Stock bajo</h2><p className="text-sm text-muted">Productos con 1 a 5 unidades disponibles</p></div><Link to="/admin/products" className="text-sm font-semibold text-brand">Administrar inventario</Link></div>
          {lowStock.length === 0 ? <p className="text-sm text-muted">No hay productos con stock bajo en el catálogo cargado.</p> : <ul className="divide-y divide-line">{lowStock.map(({ product, stock }) => <li key={product.id} className="flex items-center justify-between gap-3 py-3"><div className="flex min-w-0 items-center gap-3">{product.imageUrls[0] ? <img src={resolveImageUrl(product.imageUrls[0]) || undefined} alt="" className="h-10 w-10 rounded-btn object-cover"/> : <AlertTriangle size={18} className="text-amber-600"/>}<div className="min-w-0"><p className="truncate text-sm font-semibold text-ink">{product.name}</p><p className="text-xs text-muted">{product.sku}</p></div></div><span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-800">{stock} uds.</span></li>)}</ul>}
        </div>
      </section>

      {/* Módulos y accesos */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 card p-7">
          <h2 className="text-lg font-bold text-ink tracking-tight mb-5 flex items-center gap-2.5">
            <Zap size={18} className="text-brand" />
            Accesos rápidos
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {modules.map(({ to, icon: Icon, title, text }) => (
              <Link
                key={to}
                to={to}
                className="flex items-center gap-4 p-4 rounded-btn bg-canvas border border-line hover:border-brand/40 hover:bg-brand/5 transition-colors group"
              >
                <div className="grid place-items-center w-10 h-10 rounded-btn bg-surface border border-line shrink-0 group-hover:border-brand/30 transition-colors">
                  <Icon size={18} className="text-muted group-hover:text-brand transition-colors" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-ink">{title}</p>
                  <p className="text-[12px] text-muted truncate">{text}</p>
                </div>
                <ArrowRight size={16} className="ml-auto text-muted opacity-0 group-hover:opacity-100 -translate-x-2 group-hover:translate-x-0 transition-all shrink-0" />
              </Link>
            ))}
          </div>
        </div>

        <div className="card p-7 bg-brand/5 border-brand/20 flex flex-col justify-center">
          <h3 className="text-lg font-bold text-ink tracking-tight mb-2">Personaliza tu tienda</h3>
          <p className="text-sm text-muted mb-6 leading-relaxed">
            Cambia colores, tipografía, secciones y el orden de la portada en minutos, sin escribir código.
          </p>
          <Link to="/admin/appearance" className="btn-brand w-full">
            <Palette size={16} />
            Abrir apariencia
          </Link>
          <Link to="/" target="_blank" className="mt-3 text-center text-xs font-bold uppercase tracking-widest text-brand hover:underline">
            Ver tienda
          </Link>
        </div>
      </div>
    </div>
  )
}

