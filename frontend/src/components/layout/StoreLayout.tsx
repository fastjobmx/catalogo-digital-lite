import { Outlet } from 'react-router-dom'
import Header from './Header'
import Footer from './Footer'
import CartDrawer from '../cart/CartDrawer'
import WhatsAppButton from '../WhatsAppButton'
import { useCatalog } from '../../contexts/CatalogContext'
import { useStore } from '../../contexts/StoreContext'

export default function StoreLayout() {
  const { error } = useCatalog()
  const { storeLoadError } = useStore()
  return (
    <div className="min-h-screen flex flex-col">
      {error && <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs text-amber-900" role="status">No se pudo consultar el catálogo del servidor. No se están mostrando productos de demostración como reemplazo.</div>}
      {storeLoadError && <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs text-amber-900" role="status">No se pudo cargar la configuración de la tienda: {storeLoadError}</div>}
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
