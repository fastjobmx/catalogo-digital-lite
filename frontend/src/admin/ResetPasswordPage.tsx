import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Loader2, ShieldCheck } from 'lucide-react'
import PlatformAuthShell from './PlatformAuthShell'
import { getPasswordResetInfo, resetPassword } from '../services/api'
import { useAuth } from '../contexts/AuthContext'
import { TENANT_SLUG, tenantPath } from '../lib/tenant'

/** Single-use password reset link (sent to the linked Telegram account). */
export default function ResetPasswordPage() {
  const [params] = useSearchParams()
  const token = params.get('token') || ''
  const { adoptSession } = useAuth()
  const [info, setInfo] = useState<{ email: string | null; store: { slug: string; name: string } } | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!token) { setLoadError('El enlace no es válido.'); return }
    getPasswordResetInfo(token)
      .then(setInfo)
      .catch(() => setLoadError('Este enlace ya se usó o venció. Pide uno nuevo desde “¿Olvidaste tu contraseña?”.'))
  }, [token])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    if (password.length < 10 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      setError('Usa al menos 10 caracteres con letras y números.')
      return
    }
    if (password !== confirm) { setError('Las contraseñas no coinciden.'); return }
    setSubmitting(true)
    try {
      const session = await resetPassword(token, password)
      const slug = session.store?.slug ?? info?.store.slug ?? null
      const targetSlug = slug && slug !== TENANT_SLUG ? slug : TENANT_SLUG
      adoptSession({ token: session.token, email: session.email, role: 'user' }, targetSlug)
      window.location.assign(tenantPath(targetSlug, '/admin'))
    } catch (err) {
      setError(err instanceof Error && /invalid or expired/i.test(err.message)
        ? 'Este enlace ya se usó o venció. Pide uno nuevo.'
        : err instanceof Error ? err.message : 'No pudimos cambiar la contraseña. Intenta de nuevo.')
      setSubmitting(false)
    }
  }

  return (
    <PlatformAuthShell title="Crea una contraseña nueva" subtitle="Tienda IA Express · panel administrativo" storeName={info?.store.name ?? null}>
        <div className="card p-8">
          {loadError ? (
            <p role="alert" className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-btn px-4 py-3">{loadError}</p>
          ) : !info ? (
            <p className="text-sm text-muted flex items-center gap-2"><Loader2 size={16} className="animate-spin" /> Verificando enlace…</p>
          ) : (
            <form onSubmit={submit} className="space-y-5">
              <p className="text-sm text-muted">Nueva contraseña para <b className="text-ink">{info.email}</b>. Este enlace funciona una sola vez.</p>
              <div className="space-y-2">
                <label htmlFor="password" className="block text-xs font-bold uppercase tracking-widest text-muted">Contraseña</label>
                <input id="password" type="password" autoComplete="new-password" className="input-field" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <label htmlFor="confirm" className="block text-xs font-bold uppercase tracking-widest text-muted">Repite la contraseña</label>
                <input id="confirm" type="password" autoComplete="new-password" className="input-field" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
              </div>
              {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
              <button type="submit" className="btn-brand w-full" disabled={submitting}>
                {submitting ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />} Guardar y entrar al panel
              </button>
            </form>
          )}
        </div>
    </PlatformAuthShell>
  )
}
