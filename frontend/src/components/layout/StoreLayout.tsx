import { Link, Outlet } from 'react-router-dom'
import Header from './Header'
import Footer from './Footer'
import CartDrawer from '../cart/CartDrawer'
import WhatsAppButton from '../WhatsAppButton'
import { useCatalog } from '../../contexts/CatalogContext'
import { useStore } from '../../contexts/StoreContext'
import { IS_PUBLIC_DEMO } from '../../lib/publicDemo'
import { TENANT_SLUG } from '../../lib/tenant'

export default function StoreLayout() {
  const { error } = useCatalog()
  const { storeLoadError, isDemoMode, isLoading } = useStore()
  // A platform store never falls back to the primary store's identity or demo catalog.
  if (TENANT_SLUG && isLoading) return <div className="min-h-screen bg-canvas" aria-busy="true" />
  if (TENANT_SLUG && (storeLoadError || isDemoMode)) return <StoreUnavailable />
  return (
    <div className="min-h-screen flex flex-col">
      {error && <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs text-amber-900" role="status">No se pudo consultar el catálogo del servidor. No se están mostrando productos de demostración como reemplazo.</div>}
      {storeLoadError && <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs text-amber-900" role="status">No se pudo cargar la configuración de la tienda: {storeLoadError}</div>}
      {(IS_PUBLIC_DEMO || isDemoMode) && <div className="border-b border-line bg-surface px-4 py-2.5 text-center text-[11px] font-semibold tracking-wide text-muted" role="status">{IS_PUBLIC_DEMO ? 'DEMO · Catálogo de muestra. No se aceptan pedidos ni pagos.' : 'Demostración · la apariencia se guarda en este navegador.'}</div>}
      <Header />
      <main className="flex-1">
        <Outlet />
      </main>
      <Footer />
      <CartDrawer />
      <WhatsAppButton />
    </div>
  )
}

function StoreUnavailable() {
  return (
    <main className="min-h-screen bg-canvas flex items-center justify-center px-4">
      <div className="card max-w-md w-full p-8 text-center space-y-3">
        <h1 className="text-xl font-black text-ink">Esta tienda no está disponible</h1>
        <p className="text-sm text-muted">Puede estar en preparación o en mantenimiento. Vuelve a intentarlo más tarde.</p>
        <Link to="/admin/login" className="inline-block text-xs font-bold uppercase tracking-widest text-muted hover:text-ink underline">Soy el propietario · entrar al panel</Link>
      </div>
    </main>
  )
}
