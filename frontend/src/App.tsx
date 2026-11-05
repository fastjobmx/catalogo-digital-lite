import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { StoreProvider } from './contexts/StoreContext'
import { CartProvider } from './contexts/CartContext'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { CatalogProvider } from './contexts/CatalogContext'
import AdminOnboarding from './admin/pages/Onboarding'
import AdminSimulator from './admin/pages/Simulator'
import AdminCredits from './admin/pages/Credits'
import AdminStorePreview from './admin/pages/StorePreview'
import AdminOrders from './admin/pages/Orders'
import StoreLayout from './components/layout/StoreLayout'
import HomePage from './pages/HomePage'
import ProductPage from './pages/ProductPage'
import CategoryPage from './pages/CategoryPage'
import SearchPage from './pages/SearchPage'
import LoginPage from './admin/LoginPage'
import AdminLayout from './admin/AdminLayout'
import AdminDashboard from './admin/pages/Dashboard'
import AdminProducts from './admin/pages/Products'
import AdminSettings from './admin/pages/Settings'
import AdminCategories from './admin/pages/Categories'
import AdminAppearance from './admin/pages/Appearance'
import NotFoundPage from './pages/NotFoundPage'
import RouteScrollManager from './components/RouteScrollManager'
import { IS_PUBLIC_DEMO } from './lib/publicDemo'
import { ROUTER_BASENAME } from './lib/tenant'
import { lazy, Suspense } from 'react'

// Platform-only screens load on demand so the storefront bundle stays small.
const ActivationPage = lazy(() => import('./admin/ActivationPage'))
const AdminImport = lazy(() => import('./admin/pages/Import'))
const AdminPhotoProducts = lazy(() => import('./admin/pages/PhotoProducts'))
const ResetPasswordPage = lazy(() => import('./admin/ResetPasswordPage'))
const PlatformPage = lazy(() => import('./admin/PlatformPage'))

function ProtectedAdminRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth()
  const location = useLocation()

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-canvas">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-4 border-brand border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-muted">Verificando sesión...</p>
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/admin/login" replace state={{ from: `${location.pathname}${location.search}` }} />
  }

  return <>{children}</>
}

export default function App() {
  return (
    <BrowserRouter basename={ROUTER_BASENAME}>
      <RouteScrollManager />
      <StoreProvider>
        <AuthProvider>
          <CatalogProvider>
          <CartProvider>
            <Routes>
              {/* Public store routes */}
              <Route element={<StoreLayout />}>
                <Route path="/" element={<HomePage />} />
                <Route path="/category/:slug" element={<CategoryPage />} />
                <Route path="/product/:slug" element={<ProductPage />} />
                <Route path="/producto/:slug" element={<ProductPage />} />
                <Route path="/search" element={<SearchPage />} />
                <Route path="*" element={<NotFoundPage />} />
              </Route>

              {IS_PUBLIC_DEMO ? (
                <Route path="/admin/*" element={<Navigate to="/" replace />} />
              ) : (
                <>
                  {/* Admin login and one-time account activation (public) */}
                  <Route path="/admin/login" element={<LoginPage />} />
                  <Route path="/admin/activar" element={<Suspense fallback={null}><ActivationPage /></Suspense>} />
                  <Route path="/admin/restablecer" element={<Suspense fallback={null}><ResetPasswordPage /></Suspense>} />
                  <Route path="/admin/store-preview" element={<ProtectedAdminRoute><AdminStorePreview /></ProtectedAdminRoute>} />
                  {/* Platform panel (superadmin; the API enforces the role) */}
                  <Route path="/plataforma" element={<Suspense fallback={null}><PlatformPage /></Suspense>} />

                  {/* Admin routes (protected) */}
                  <Route
                    path="/admin"
                    element={
                      <ProtectedAdminRoute>
                        <AdminLayout />
                      </ProtectedAdminRoute>
                    }
                  >
                    <Route index element={<AdminDashboard />} />
                    <Route path="products" element={<AdminProducts />} />
                    <Route path="importar" element={<Suspense fallback={null}><AdminImport /></Suspense>} />
                    <Route path="fotos" element={<Suspense fallback={null}><AdminPhotoProducts /></Suspense>} />
                    <Route path="categories" element={<AdminCategories />} />
                    <Route path="appearance" element={<AdminAppearance />} />
                    <Route path="apariencia" element={<Navigate to="/admin/appearance" replace />} />
                    <Route path="settings" element={<AdminSettings />} />
                    <Route path="onboarding" element={<AdminOnboarding />} />
                    <Route path="simulator" element={<AdminSimulator />} />
                    <Route path="creditos" element={<AdminCredits />} />
                    <Route path="orders" element={<AdminOrders />} />
                  </Route>
                </>
              )}
            </Routes>
          </CartProvider>
          </CatalogProvider>
        </AuthProvider>
      </StoreProvider>
    </BrowserRouter>
  )
}
