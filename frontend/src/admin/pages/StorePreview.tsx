import { useEffect, useMemo, useRef } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Eye, LayoutDashboard, Palette } from 'lucide-react'
import { useCatalog } from '../../contexts/CatalogContext'
import { useStore } from '../../contexts/StoreContext'
import Header from '../../components/layout/Header'
import Footer from '../../components/layout/Footer'
import CartDrawer from '../../components/cart/CartDrawer'
import WhatsAppButton from '../../components/WhatsAppButton'
import HomePage from '../../pages/HomePage'
import { applyPreviewOverride, parsePreviewOverride } from '../../lib/previewOverride'
import { THEME_PRESETS } from '../../types/theme'

/** The draft storefront, rendered only inside the authenticated admin route.
 * `?palette=` and `?template=` show an unsaved option sent by the assistant. */
export default function AdminStorePreview() {
  const { error } = useCatalog()
  const { store, setStore, isLoading, storeLoadError } = useStore()
  const location = useLocation()
  const override = useMemo(() => parsePreviewOverride(location.search), [location.search])
  const applied = useRef<string | null>(null)

  useEffect(() => {
    if (isLoading || !override || applied.current === location.search) return
    applied.current = location.search
    setStore({ theme: applyPreviewOverride(store.theme, override) })
  }, [isLoading, override, location.search, setStore, store.theme])

  const templateName = override?.template ? THEME_PRESETS.find((preset) => preset.template === override.template)?.name : null

  return (
    <div className="min-h-screen flex flex-col bg-canvas">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface px-4 py-2 text-xs text-ink sm:px-6">
        <span className="inline-flex items-center gap-2 font-semibold"><Eye size={15} /> Vista previa privada · solo visible para usuarios con acceso</span>
        <Link to="/admin" className="inline-flex items-center gap-1.5 font-semibold underline underline-offset-4"><LayoutDashboard size={14} /> Volver al panel</Link>
      </div>
      {override && (
        <div className="flex flex-wrap items-center justify-center gap-2 border-b border-line bg-secondary px-4 py-2 text-center text-xs font-semibold text-ink" role="status">
          <Palette size={14} aria-hidden="true" />
          Estás viendo una opción sin guardar{templateName ? ` · plantilla ${templateName}` : ''}{override.palette ? ' · colores propuestos' : ''}. Elígela en Telegram o en Apariencia para aplicarla.
        </div>
      )}
      {(error || storeLoadError) && <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs text-amber-900" role="status">La vista previa puede estar incompleta porque no se pudo cargar toda la información de la tienda.</div>}
      <Header />
      <main className="flex-1"><HomePage /></main>
      <Footer />
      <CartDrawer />
      <WhatsAppButton />
    </div>
  )
}
