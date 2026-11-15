import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CheckCircle2, Loader2, MailCheck, RefreshCw, Sparkles } from 'lucide-react'
import PlatformAuthShell from '../admin/PlatformAuthShell'
import { signupApi, type SignupConfig } from '../services/api'

const TERMS_URL = 'https://tiendiaexpres.com/terminos-y-condiciones'
const RESEND_WAIT_SECONDS = 120

/** Real free trial: a few fields, a store of the platform and a one-time link by email to enter its panel. */
export default function SignupPage() {
  const [params] = useSearchParams()
  const [config, setConfig] = useState<SignupConfig | null>(null)
  const [form, setForm] = useState({ businessName: '', ownerName: '', email: params.get('correo') || '', whatsapp: '', acceptTerms: false, website: '' })
  const [step, setStep] = useState<'form' | 'sent' | 'resend'>(params.get('reenviar') ? 'resend' : 'form')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [wait, setWait] = useState(0)
  const [resent, setResent] = useState(false)

  useEffect(() => { signupApi.config().then(setConfig).catch(() => setConfig(null)) }, [])
  useEffect(() => {
    if (wait <= 0) return
    const timer = window.setTimeout(() => setWait((value) => value - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [wait])

  const days = config?.days ?? 7
  const products = config?.products ?? 7
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value })

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    if (form.businessName.trim().length < 2) { setError('Escribe el nombre de tu negocio.'); return }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email.trim())) { setError('Escribe un correo válido.'); return }
    if (!form.acceptTerms) { setError('Acepta los términos y condiciones para continuar.'); return }
    setBusy(true)
    try {
      await signupApi.create({ businessName: form.businessName.trim(), ownerName: form.ownerName.trim() || undefined, email: form.email.trim(), whatsapp: form.whatsapp.trim() || undefined, acceptTerms: true, website: form.website })
      setStep('sent')
      setWait(RESEND_WAIT_SECONDS)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No pudimos crear tu tienda. Intenta de nuevo.')
    } finally { setBusy(false) }
  }

  const resend = async (event?: React.FormEvent) => {
    event?.preventDefault()
    setError(null)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email.trim())) { setError('Escribe el correo con el que creaste tu tienda.'); return }
    setBusy(true)
    try {
      await signupApi.resend(form.email.trim())
      setResent(true)
      setStep('sent')
      setWait(RESEND_WAIT_SECONDS)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No pudimos enviar el enlace. Intenta de nuevo.')
    } finally { setBusy(false) }
  }

  if (config && !config.enabled) {
    return (
      <PlatformAuthShell title="Registro en pausa" subtitle="Volvemos pronto">
        <div className="card p-8 text-sm text-ink">El registro de pruebas está pausado por unas horas. Escríbenos por WhatsApp al <a className="font-bold underline" href="https://wa.me/573506912734">+57 350 691 2734</a> y te ayudamos a crear tu tienda.</div>
      </PlatformAuthShell>
    )
  }

  if (step === 'sent') {
    return (
      <PlatformAuthShell title="Revisa tu correo" subtitle={`Te enviamos el enlace para entrar a tu tienda`}>
        <div className="card space-y-5 p-8 text-sm text-ink" role="status">
          <p className="flex items-start gap-3"><MailCheck size={22} className="mt-0.5 shrink-0 text-brand" aria-hidden="true" /><span>Si <b>{form.email.trim()}</b> puede recibir una tienda de prueba, en unos minutos llegará un correo de <b>TiendIA Exprés</b> con el botón <b>«Confirmar y entrar a mi tienda»</b>.</span></p>
          <ul className="space-y-1.5 text-muted">
            <li>· El enlace sirve una sola vez y vence en 72 horas.</li>
            <li>· Allí creas tu contraseña y entras a tu panel.</li>
            <li>· Llega desde <b>notificaciones@tiendiaexpres.com</b> con el asunto «Confirma tu correo y entra a…». Búscalo así en tu correo.</li>
            <li>· Si no lo ves en la bandeja principal, revisa <b>Promociones</b>, <b>Spam</b> o <b>Correo no deseado</b> y márcalo como «No es spam».</li>
          </ul>
          {resent && <p className="rounded-btn border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-900">Listo: si tu registro está pendiente, enviamos un enlace nuevo. El anterior deja de funcionar.</p>}
          {error && <p role="alert" className="text-red-700">{error}</p>}
          <button type="button" className="btn-ghost w-full" disabled={busy || wait > 0} onClick={() => void resend()}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />} {wait > 0 ? `Reenviar enlace en ${wait} s` : 'Reenviar el enlace'}
          </button>
          <p className="text-xs text-muted">¿Escribiste mal el correo? <button type="button" className="font-bold underline" onClick={() => { setStep('form'); setResent(false) }}>Corrígelo aquí</button>.</p>
        </div>
      </PlatformAuthShell>
    )
  }

  if (step === 'resend') {
    return (
      <PlatformAuthShell title="Pide un enlace nuevo" subtitle="Para entrar a tu tienda de prueba">
        <form onSubmit={resend} className="card space-y-5 p-8">
          <p className="text-sm text-muted">Escribe el correo con el que creaste tu tienda. Si el registro está pendiente de confirmar, te enviamos un enlace nuevo.</p>
          <label className="block space-y-2"><span className="block text-xs font-bold uppercase tracking-widest text-muted">Correo</span>
            <input type="email" autoComplete="email" className="input-field w-full" value={form.email} onChange={set('email')} required /></label>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <button type="submit" className="btn-brand w-full" disabled={busy}>{busy ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />} Enviar enlace</button>
          <p className="text-center text-xs text-muted">¿Ya confirmaste tu correo? <Link className="font-bold underline" to="/admin/login">Inicia sesión</Link></p>
        </form>
      </PlatformAuthShell>
    )
  }

  return (
    <PlatformAuthShell title={`Prueba gratis durante ${days} días`} subtitle="Crea tu tienda online en minutos · Sin tarjeta de crédito"
      below={<p className="text-xs">¿Ya tienes cuenta? <Link className="font-bold underline" to="/admin/login">Inicia sesión</Link> · <Link className="font-bold underline" to="/registro?reenviar=1">Reenviar enlace</Link></p>}>
      <form onSubmit={submit} className="card space-y-4 p-7" noValidate>
        <ul className="grid gap-1.5 rounded-btn bg-brand/5 p-3 text-[13px] text-ink">
          {[`Crea hasta ${products} productos con fotos, precios y variantes`, 'Administra tu tienda desde el primer día', 'Recibe pedidos por WhatsApp', 'Si contratas un plan, conservas tus productos y configuración'].map((item) => (
            <li key={item} className="flex items-start gap-2"><CheckCircle2 size={15} className="mt-0.5 shrink-0 text-brand" aria-hidden="true" />{item}</li>
          ))}
        </ul>
        <label className="block space-y-1.5"><span className="block text-xs font-bold uppercase tracking-widest text-muted">Nombre de tu negocio</span>
          <input className="input-field w-full" autoComplete="organization" maxLength={80} value={form.businessName} onChange={set('businessName')} placeholder="Ej.: Flores de Ana" required /></label>
        <label className="block space-y-1.5"><span className="block text-xs font-bold uppercase tracking-widest text-muted">Tu nombre <span className="font-normal normal-case tracking-normal">(opcional)</span></span>
          <input className="input-field w-full" autoComplete="name" maxLength={120} value={form.ownerName} onChange={set('ownerName')} /></label>
        <label className="block space-y-1.5"><span className="block text-xs font-bold uppercase tracking-widest text-muted">Correo</span>
          <input type="email" className="input-field w-full" autoComplete="email" value={form.email} onChange={set('email')} placeholder="tu@correo.com" required />
          <span className="block text-xs text-muted">Allí recibirás el enlace para entrar y los avisos de tu tienda.</span></label>
        <label className="block space-y-1.5"><span className="block text-xs font-bold uppercase tracking-widest text-muted">WhatsApp para pedidos <span className="font-normal normal-case tracking-normal">(opcional)</span></span>
          <input type="tel" className="input-field w-full" autoComplete="tel" value={form.whatsapp} onChange={set('whatsapp')} placeholder="+57 300 000 0000" /></label>
        {/* Invisible to people; bots fill it. */}
        <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden"><label>Sitio web<input tabIndex={-1} autoComplete="off" value={form.website} onChange={set('website')} /></label></div>
        <label className="flex items-start gap-2 text-sm text-ink"><input type="checkbox" className="mt-1" checked={form.acceptTerms} onChange={set('acceptTerms')} />
          <span>Acepto los <a href={TERMS_URL} target="_blank" rel="noopener noreferrer" className="font-bold underline">términos y condiciones</a> y el tratamiento de mis datos para crear y administrar mi tienda.</span></label>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <button type="submit" className="btn-brand w-full" disabled={busy}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />} Crear mi tienda gratis</button>
        <p className="text-center text-xs text-muted">{days} días gratis · hasta {products} productos · sin tarjeta de crédito</p>
      </form>
    </PlatformAuthShell>
  )
}
