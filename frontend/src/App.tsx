import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { StoreProvider } from './contexts/StoreContext'
import { CartProvider } from './contexts/CartContext'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { CatalogProvider } from './contexts/CatalogContext'
import StoreLayout from './components/layout/StoreLayout'
import HomePage from './pages/HomePage'
import ProductPage from './pages/ProductPage'
import CategoryPage from './pages/CategoryPage'
import SearchPage from './pages/SearchPage'
import NotFoundPage from './pages/NotFoundPage'
import RouteScrollManager from './components/RouteScrollManager'
import { IS_PUBLIC_DEMO } from './lib/publicDemo'
import { ROUTER_BASENAME } from './lib/tenant'
import { lazy, Suspense } from 'react'

// Platform-only screens load on demand so the storefront bundle stays small.
const ActivationPage = lazy(() => import('./admin/ActivationPage'))
const AdminImport = lazy(() => import('./admin/pages/Import'))
const AdminPhotoProducts = lazy(() => import('./admin/pages/PhotoProducts'))
const AdminStudio = lazy(() => import('./admin/pages/Studio'))
const TrialPage = lazy(() => import('./pages/TrialPage'))
const AdminUsers = lazy(() => import('./admin/pages/Users'))
const VerifyEmailPage = lazy(() => import('./admin/VerifyEmailPage'))
const PlatformEmailPage = lazy(() => import('./admin/PlatformEmailPage'))
const PlatformTrialsPage = lazy(() => import('./admin/PlatformTrialsPage'))
const ResetPasswordPage = lazy(() => import('./admin/ResetPasswordPage'))
const PlatformPage = lazy(() => import('./admin/PlatformPage'))
// The store owners' panel is not needed by shoppers: it loads only when someone opens /admin.
const AdminOnboarding = lazy(() => import('./admin/pages/Onboarding'))
const AdminSimulator = lazy(() => import('./admin/pages/Simulator'))
const AdminCredits = lazy(() => import('./admin/pages/Credits'))
const AdminStorePreview = lazy(() => import('./admin/pages/StorePreview'))
const AdminOrders = lazy(() => import('./admin/pages/Orders'))
const LoginPage = lazy(() => import('./admin/LoginPage'))
const AdminLayout = lazy(() => import('./admin/AdminLayout'))
const AdminDashboard = lazy(() => import('./admin/pages/Dashboard'))
const AdminProducts = lazy(() => import('./admin/pages/Products'))
const AdminSettings = lazy(() => import('./admin/pages/Settings'))
const AdminCategories = lazy(() => import('./admin/pages/Categories'))
const AdminAppearance = lazy(() => import('./admin/pages/Appearance'))
const page = (element: React.ReactNode) => <Suspense fallback={null}>{element}</Suspense>

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
              {/* Catalogue trial without an account (temporary, unpublished, noindex) */}
              <Route path="/prueba" element={<Suspense fallback={null}><TrialPage /></Suspense>} />
              <Route path="/prueba/:id" element={<Suspense fallback={null}><TrialPage /></Suspense>} />
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
                  <Route path="/admin/login" element={page(<LoginPage />)} />
                  <Route path="/admin/activar" element={<Suspense fallback={null}><ActivationPage /></Suspense>} />
                  <Route path="/admin/restablecer" element={<Suspense fallback={null}><ResetPasswordPage /></Suspense>} />
                  <Route path="/admin/verificar-correo" element={<Suspense fallback={null}><VerifyEmailPage /></Suspense>} />
                  <Route path="/admin/store-preview" element={<ProtectedAdminRoute>{page(<AdminStorePreview />)}</ProtectedAdminRoute>} />
                  {/* Platform panel (superadmin; the API enforces the role) */}
                  <Route path="/plataforma" element={<Suspense fallback={null}><PlatformPage /></Suspense>} />
                  <Route path="/plataforma/correos" element={<Suspense fallback={null}><PlatformEmailPage /></Suspense>} />
                  <Route path="/plataforma/pruebas" element={<Suspense fallback={null}><PlatformTrialsPage /></Suspense>} />

                  {/* Admin routes (protected) */}
                  <Route
                    path="/admin"
                    element={
                      <ProtectedAdminRoute>
                        {page(<AdminLayout />)}
                      </ProtectedAdminRoute>
                    }
                  >
                    <Route index element={page(<AdminDashboard />)} />
                    <Route path="products" element={page(<AdminProducts />)} />
                    <Route path="importar" element={<Suspense fallback={null}><AdminImport /></Suspense>} />
                    <Route path="fotos" element={<Suspense fallback={null}><AdminPhotoProducts /></Suspense>} />
                    <Route path="categories" element={page(<AdminCategories />)} />
                    <Route path="appearance" element={page(<AdminAppearance />)} />
                    <Route path="apariencia" element={<Navigate to="/admin/appearance" replace />} />
                    <Route path="settings" element={page(<AdminSettings />)} />
                    <Route path="onboarding" element={page(<AdminOnboarding />)} />
                    <Route path="simulator" element={page(<AdminSimulator />)} />
                    <Route path="creditos" element={page(<AdminCredits />)} />
                    <Route path="usuarios" element={<Suspense fallback={null}><AdminUsers /></Suspense>} />
                    <Route path="estudio" element={<Suspense fallback={null}><AdminStudio /></Suspense>} />
                    <Route path="orders" element={page(<AdminOrders />)} />
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
