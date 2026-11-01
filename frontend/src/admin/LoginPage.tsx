import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useStore } from '../contexts/StoreContext'
import { Store, ShieldCheck, Loader2, ArrowLeft } from 'lucide-react'

export default function LoginPage() {
  const { login, isAuthenticated } = useAuth()
  const { store } = useStore()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  if (isAuthenticated) {
    navigate('/admin', { replace: true })
    return null
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsSubmitting(true)
    const result = await login(email, password)
    if (result.error) {
      setError(result.error)
      setIsSubmitting(false)
    } else {
      navigate('/admin', { replace: true })
    }
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
              <div className="bg-red-50 border border-red-200 text-red-600 text-sm font-medium px-4 py-3 rounded-btn">
                {error}
              </div>
            )}

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
          </form>

          <div className="mt-6 pt-5 border-t border-line text-center">
            <p className="text-[11px] text-muted leading-relaxed">
              Si el servidor no está disponible, el panel funciona en modo demostración y acepta cualquier credencial.
            </p>
          </div>
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
