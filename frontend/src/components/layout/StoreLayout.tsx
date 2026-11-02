import { Outlet } from 'react-router-dom'
import Header from './Header'
import Footer from './Footer'
import CartDrawer from '../cart/CartDrawer'
import WhatsAppButton from '../WhatsAppButton'
import { useCatalog } from '../../contexts/CatalogContext'
import { useStore } from '../../contexts/StoreContext'
import { IS_PUBLIC_DEMO } from '../../lib/publicDemo'

export default function StoreLayout() {
  const { error } = useCatalog()
  const { storeLoadError, isDemoMode } = useStore()
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
