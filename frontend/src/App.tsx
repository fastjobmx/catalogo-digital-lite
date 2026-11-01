import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { StoreProvider } from './contexts/StoreContext'
import { CartProvider } from './contexts/CartContext'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { CatalogProvider } from './contexts/CatalogContext'
import AdminOnboarding from './admin/pages/Onboarding'
import AdminSimulator from './admin/pages/Simulator'
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
import NotFoundPage from './pages/NotFoundPage'
import RouteScrollManager from './components/RouteScrollManager'

const AdminAppearance = lazy(() => import('./admin/pages/Appearance'))

function AdminSectionFallback() {
  return <div className="min-h-40 flex items-center justify-center text-sm text-muted" role="status">Cargando sección…</div>
}

function ProtectedAdminRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth()

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
    return <Navigate to="/admin/login" replace />
  }

  return <>{children}</>
}

export default function App() {
  return (
    <BrowserRouter>
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

              {/* Admin login (public) */}
              <Route path="/admin/login" element={<LoginPage />} />

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
                <Route path="categories" element={<AdminCategories />} />
                <Route path="appearance" element={<Suspense fallback={<AdminSectionFallback />}><AdminAppearance /></Suspense>} />
                <Route path="apariencia" element={<Navigate to="/admin/appearance" replace />} />
                <Route path="settings" element={<AdminSettings />} />
                <Route path="onboarding" element={<AdminOnboarding />} />
                <Route path="simulator" element={<AdminSimulator />} />
                <Route path="orders" element={<AdminOrders />} />
              </Route>
            </Routes>
          </CartProvider>
          </CatalogProvider>
        </AuthProvider>
      </StoreProvider>
    </BrowserRouter>
  )
}
