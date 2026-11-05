import { useState } from 'react'
import { useNavigate, Link, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useStore } from '../contexts/StoreContext'
import { isBackendAvailable, requestPasswordReset } from '../services/api'
import { isOfflineDemoAuthEnabled } from '../lib/authMode'
import { Store, ShieldCheck, Loader2, ArrowLeft } from 'lucide-react'

export default function LoginPage() {
  const { login, isAuthenticated } = useAuth()
  const { store } = useStore()
  const navigate = useNavigate()
  const location = useLocation()
  // Return only to an admin route of this app (never to an external URL).
  const requested = (location.state as { from?: unknown } | null)?.from
  const returnTo = typeof requested === 'string' && /^\/admin(?:[/?]|$)/.test(requested) && !requested.startsWith('/admin/login') ? requested : '/admin'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [connectionMessage, setConnectionMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isCheckingConnection, setIsCheckingConnection] = useState(false)
  const [resetMessage, setResetMessage] = useState('')
  const forgotPassword = async () => {
    if (!email.trim()) { setResetMessage('Escribe primero tu correo registrado.'); return }
    try { await requestPasswordReset(email.trim()) } catch { /* same answer either way */ }
    setResetMessage('Si el correo está registrado, te enviamos un enlace para crear una contraseña nueva: llega a tu correo verificado o al Telegram vinculado a tu cuenta. Vence en 60 minutos. Si no te llega, pide ayuda al administrador de tu tienda.')
  }
  const offlineDemoAuth = isOfflineDemoAuthEnabled(import.meta.env.DEV, import.meta.env.VITE_ALLOW_DEMO_AUTH)

  if (isAuthenticated) return <Navigate to={returnTo} replace />

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setConnectionMessage('')
    setIsSubmitting(true)
    const result = await login(email, password)
    if (result.error) {
      setError(result.error)
      setIsSubmitting(false)
    } else {
      navigate(returnTo, { replace: true })
    }
  }

  const retryConnection = async () => {
    setIsCheckingConnection(true)
    setConnectionMessage('')
    const available = await isBackendAvailable()
    setConnectionMessage(available
      ? 'El servidor responde. Vuelve a intentar iniciar sesión.'
      : 'El servidor sigue sin responder. Revisa el Worker e inténtalo de nuevo.')
    setIsCheckingConnection(false)
  }

  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        {/* Encabezado de marca */}
        <div className="text-center mb-8">
          {store.logo ? (
            <img src={store.logo} alt={store.name} className="h-14 mx-auto mb-4 object-contain" />
          ) : (
            <span className="grid place-items-center w-16 h-16 mx-auto mb-4 rounded-card bg-brand text-brand-foreground font-black text-2xl">
              {store.name.trim().charAt(0).toUpperCase()}
            </span>
          )}
          <h1 className="text-2xl font-black tracking-tight text-ink">{store.name}</h1>
          <p className="text-muted text-sm mt-1.5">Acceso al panel administrativo</p>
        </div>

        {/* Tarjeta de inicio de sesión */}
        <div className="card p-8">
          {offlineDemoAuth && (
            <p className="mb-5 rounded-btn border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="status">
              Modo demo local activo: los cambios se guardan en este navegador y no llegan al Worker.
            </p>
          )}
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <label htmlFor="email" className="block text-xs font-bold uppercase tracking-widest text-muted">
                Correo electrónico
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@tienda.com"
                required
                className="input-field"
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="password" className="block text-xs font-bold uppercase tracking-widest text-muted">
                Contraseña
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="input-field"
              />
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-600 text-sm font-medium px-4 py-3 rounded-btn" role="alert">
                {error}
              </div>
            )}
            {connectionMessage && <p className="text-sm text-muted" role="status">{connectionMessage}</p>}

            <button type="submit" disabled={isSubmitting} className="btn-brand w-full">
              {isSubmitting ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <>
                  <ShieldCheck size={18} />
                  Iniciar sesión
                </>
              )}
            </button>
            <button type="button" onClick={retryConnection} disabled={isCheckingConnection} className="w-full text-sm font-semibold text-muted underline underline-offset-4 disabled:opacity-60">
              {isCheckingConnection ? 'Comprobando servidor…' : 'Reintentar conexión'}
            </button>
            {!offlineDemoAuth && <button type="button" onClick={() => void forgotPassword()} className="w-full text-sm font-semibold text-brand underline underline-offset-4">¿Olvidaste tu contraseña?</button>}
            {resetMessage && <p className="text-sm text-muted" role="status">{resetMessage}</p>}
          </form>

          {!offlineDemoAuth && <p className="mt-6 border-t border-line pt-5 text-center text-[11px] leading-relaxed text-muted">Se requiere una sesión válida del servidor para acceder al panel.</p>}
        </div>

        <div className="text-center mt-6">
          <Link to="/" className="inline-flex items-center gap-2 text-sm font-semibold text-muted hover:text-brand transition-colors">
            <ArrowLeft size={16} />
            Volver a la tienda
          </Link>
        </div>

        <p className="text-center text-[11px] text-muted/70 mt-6 flex items-center justify-center gap-1.5">
          <Store size={12} />
          Panel de administración
        </p>
      </div>
    </div>
  )
}
