import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { BadgeCheck, Loader2, MailWarning } from 'lucide-react'
import { confirmEmailVerification } from '../services/api'

/** Confirms an email address from a single-use link. It grants no access and changes no password. */
export default function VerifyEmailPage() {
  const [params] = useSearchParams()
  const token = params.get('token') || ''
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading')
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    if (!token) { setState('error'); return }
    confirmEmailVerification(token).then(() => setState('ok')).catch(() => setState('error'))
  }, [token])

  return (
    <main className="min-h-screen bg-canvas flex items-center justify-center px-4">
      <div className="card max-w-md w-full p-8 text-center space-y-4">
        {state === 'loading' && <><Loader2 className="mx-auto animate-spin text-brand" /><p className="text-sm text-muted">Confirmando tu correo…</p></>}
        {state === 'ok' && <>
          <BadgeCheck className="mx-auto text-emerald-600" size={36} />
          <h1 className="text-xl font-black text-ink">Correo confirmado</h1>
          <p className="text-sm text-muted">Desde ahora puedes recuperar tu acceso por correo si olvidas tu contraseña.</p>
          <Link to="/admin/login" className="btn-brand inline-flex">Ir al panel</Link>
        </>}
        {state === 'error' && <>
          <MailWarning className="mx-auto text-amber-600" size={36} />
          <h1 className="text-xl font-black text-ink">El enlace no es válido</h1>
          <p className="text-sm text-muted">Ya se usó o venció. Pide uno nuevo desde «Usuarios y accesos» en el panel de tu tienda.</p>
        </>}
      </div>
    </main>
  )
}
