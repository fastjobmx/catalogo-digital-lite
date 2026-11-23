import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowRight, BadgeCheck, CheckCircle2, Clock, CreditCard, Link2, Loader2, Lock, Mail, MailCheck, Phone, ShieldCheck, Store, User, XCircle } from 'lucide-react'
import PlatformAuthShell from '../admin/PlatformAuthShell'
import { signupApi, type UpgradePlan } from '../services/api'
import { openBoldCheckout } from '../lib/bold'
import { formatMoney } from '../lib/format'
import { inboxFor, normalizeWhatsApp, slugPreview } from './SignupPage'

const TERMS_URL = 'https://tiendiaexpres.com/terminos-y-condiciones'
const PAGE_TITLE = 'Contrata tu plan | TiendIA Exprés'
const STORE_HOST = 'app.tiendiaexpres.com/t/'
const PENDING_KEY = 'tiendia-compra-pendiente'
const WHATSAPP_HELP = 'https://wa.me/573506912734?text=Hola%2C%20quiero%20contratar%20un%20plan%20de%20TiendIA%20Expr%C3%A9s.'
const FEATURE_LABELS: Record<string, string> = {
  catalogo: 'Catálogo online', pedidos_whatsapp: 'Pedidos por WhatsApp', panel: 'Panel administrativo', telegram: 'Asistente por chat',
  asistente_ia: 'Asistente con IA', fotos_ia: 'Fotos con IA', voz: 'Notas de voz', documentos: 'Documentos y guías', dominio_propio: 'Dominio propio',
}

type Cycle = 'mensual' | 'anual'
type Form = { businessName: string; ownerName: string; email: string; whatsapp: string; acceptTerms: boolean; website: string }
type Field = 'businessName' | 'email' | 'whatsapp' | 'acceptTerms'
type Result = { kind: 'checking' | 'paid' | 'failed' | 'processing'; email: string; planName?: string | null }

/** Contratar sin prueba gratis: datos del negocio, plan y pago con Bold en un solo paso. El acceso llega por correo. */
export default function PurchasePage() {
  const [params] = useSearchParams()
  const [plans, setPlans] = useState<UpgradePlan[] | null>(null)
  const [online, setOnline] = useState<{ mode: 'test' | 'live' } | null>(null)
  const [planCode, setPlanCode] = useState(params.get('plan') || 'negocio')
  const [cycle, setCycle] = useState<Cycle>(params.get('ciclo') === 'anual' ? 'anual' : 'mensual')
  const [form, setForm] = useState<Form>({ businessName: '', ownerName: '', email: '', whatsapp: '', acceptTerms: false, website: '' })
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [opened, setOpened] = useState(false)
  const fields = useRef<Partial<Record<Field, HTMLInputElement | null>>>({})
  // Back from Bold (?bold-order-id=ACT-…): read once; the result is confirmed by the server with Bold.
  const [returned] = useState(() => {
    const reference = new URLSearchParams(window.location.search).get('bold-order-id')
    if (!reference || !/^ACT-[A-Z0-9]{6}-[A-Z0-9]{4,20}$/.test(reference)) return null
    try { const saved = JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null') as { reference: string; email: string } | null; return saved?.reference === reference ? saved : { reference, email: '' } } catch { return { reference, email: '' } }
  })
  const [result, setResult] = useState<Result | null>(returned ? { kind: 'checking', email: returned.email } : null)

  useEffect(() => {
    signupApi.plans().then((data) => { setPlans(data.plans); setOnline(data.onlinePayment) }).catch(() => { setPlans([]); setOnline(null) })
  }, [])

  useEffect(() => {
    if (!returned) return
    const url = new URL(window.location.href)
    for (const key of [...url.searchParams.keys()]) if (key.startsWith('bold-')) url.searchParams.delete(key)
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash)
    if (!returned.email) { setResult({ kind: 'processing', email: '' }); return }
    let cancelled = false
    const check = async (tries: number) => {
      try {
        const status = await signupApi.purchaseStatus(returned.reference, returned.email)
        if (cancelled) return
        if (status.planActive) { setResult({ kind: 'paid', email: returned.email, planName: status.planName }); sessionStorage.removeItem(PENDING_KEY); return }
        if (['rechazado', 'fallido', 'anulado'].includes(status.attemptStatus)) { setResult({ kind: 'failed', email: returned.email }); return }
        if (tries > 0) { window.setTimeout(() => void check(tries - 1), 4000); return }
        setResult({ kind: 'processing', email: returned.email, planName: status.planName })
      } catch { if (!cancelled) setResult({ kind: 'processing', email: returned.email }) }
    }
    void check(6)
    return () => { cancelled = true }
  }, [returned])

  const plan = useMemo(() => plans?.find((item) => item.code === planCode) ?? plans?.[0] ?? null, [plans, planCode])
  const amount = plan ? plan.amounts[cycle] : 0
  const money = (value: number) => formatMoney(value, plan?.currency || 'COP')
  const slug = slugPreview(form.businessName)
  const set = (key: keyof Form) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value })
    if (key in errors) setErrors({ ...errors, [key]: undefined })
  }

  const pay = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!plan || busy) return
    setError(null)
    const found: Partial<Record<Field, string>> = {}
    if (form.businessName.trim().length < 2) found.businessName = 'Escribe el nombre de tu negocio.'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email.trim())) found.email = 'Escribe un correo válido: ahí te llega tu acceso y el comprobante.'
    if (normalizeWhatsApp(form.whatsapp) === null) found.whatsapp = 'Escribe un celular de 10 dígitos (300 123 4567) o con el código del país (+57…).'
    if (!form.acceptTerms) found.acceptTerms = 'Acepta los términos y condiciones para continuar.'
    setErrors(found)
    const first = (['businessName', 'email', 'whatsapp', 'acceptTerms'] as Field[]).find((key) => found[key])
    if (first) { fields.current[first]?.focus(); return }
    setBusy(true)
    try {
      const button = await signupApi.purchase({
        businessName: form.businessName.trim(), ownerName: form.ownerName.trim() || undefined, email: form.email.trim(), whatsapp: normalizeWhatsApp(form.whatsapp) || undefined,
        acceptTerms: true, website: form.website, planCode: plan.code, cycle, returnUrl: `${window.location.origin}${window.location.pathname}`,
      })
      sessionStorage.setItem(PENDING_KEY, JSON.stringify({ reference: button.reference, email: button.email }))
      await openBoldCheckout(button, { name: form.ownerName.trim() || undefined, email: button.email, phone: normalizeWhatsApp(form.whatsapp) || undefined })
      setOpened(true)
    } catch (err) {
      setError(err instanceof Error && !err.message.startsWith('BOLD_LIBRARY') ? err.message : 'No pudimos abrir la pasarela de Bold. Revisa tu conexión e inténtalo de nuevo.')
    } finally { setBusy(false) }
  }

  if (result) return <ResultScreen result={result} />

  if (plans && (!online || !plans.length)) {
    return (
      <PlatformAuthShell title="Contratación en línea no disponible" subtitle="Te ayudamos por otro camino" pageTitle={PAGE_TITLE}>
        <div className="card space-y-4 p-7 text-sm text-ink">
          <p>En este momento no podemos recibir pagos en línea. Escríbenos y te ayudamos a contratar, o empieza con la prueba gratis: si luego contratas, conservas todo.</p>
          <a className="btn-brand w-full justify-center" href={WHATSAPP_HELP} target="_blank" rel="noopener noreferrer">Escribir por WhatsApp</a>
          <Link className="btn-ghost w-full justify-center" to="/registro">Probar gratis 14 días</Link>
        </div>
      </PlatformAuthShell>
    )
  }

  const aside = (
    <div className="space-y-5">
      <div className="inline-flex rounded-full bg-white/10 p-1 text-sm ring-1 ring-white/15" role="radiogroup" aria-label="Forma de pago">
        {(['mensual', 'anual'] as const).map((option) => (
          <button key={option} type="button" role="radio" aria-checked={cycle === option} onClick={() => setCycle(option)}
            className={`rounded-full px-5 py-2 font-bold transition-colors ${cycle === option ? 'bg-[#cdf53f] text-[#03301f]' : 'text-white/80 hover:text-white'}`}>
            {option === 'mensual' ? 'Pago mensual' : 'Pago anual'}
          </button>
        ))}
      </div>
      <div className="grid gap-3" role="radiogroup" aria-label="Plan">
        {!plans && <p className="flex items-center gap-2 text-white/80"><Loader2 size={16} className="animate-spin" /> Cargando planes…</p>}
        {(plans || []).map((item) => {
          const active = item.code === plan?.code
          return (
            <button key={item.code} type="button" role="radio" aria-checked={active} onClick={() => setPlanCode(item.code)}
              className={`flex items-center justify-between gap-4 rounded-2xl px-5 py-4 text-left transition-all ${active ? 'bg-white text-[#03301f] shadow-xl ring-2 ring-[#cdf53f]' : 'bg-white/5 text-white ring-1 ring-white/15 hover:bg-white/10'}`}>
              <span className="flex items-center gap-3">
                <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 ${active ? 'border-[#03301f]' : 'border-white/50'}`}>{active && <span className="h-2.5 w-2.5 rounded-full bg-[#03301f]" />}</span>
                <span><span className="block text-base font-black">{item.name}</span><span className={`block text-xs ${active ? 'text-[#4a5f55]' : 'text-white/70'}`}>{item.maxProducts ? `Hasta ${item.maxProducts} productos` : 'Productos ilimitados'}</span></span>
              </span>
              <span className="text-right">
                <span className="block text-lg font-black">{cycle === 'mensual' ? formatMoney(item.monthlyPrice, item.currency) : formatMoney(item.annualPrice, item.currency)}</span>
                <span className={`block text-xs ${active ? 'text-[#4a5f55]' : 'text-white/70'}`}>{cycle === 'mensual' ? 'al mes' : 'al año'}</span>
              </span>
            </button>
          )
        })}
      </div>
      {plan && (
        <ul className="hidden gap-2 text-sm text-white/90 lg:grid">
          {plan.features.filter((feature) => FEATURE_LABELS[feature]).slice(0, 6).map((feature) => <li key={feature} className="flex items-center gap-2"><CheckCircle2 size={15} className="shrink-0 text-[#cdf53f]" /> {FEATURE_LABELS[feature]}</li>)}
        </ul>
      )}
      <p className="text-sm text-[#cfe3d6]">¿Prefieres probar primero? <Link to="/registro" className="font-bold text-white underline underline-offset-4">Prueba gratis 14 días</Link></p>
    </div>
  )

  return (
    <PlatformAuthShell title="Contrata tu plan" titleAccent="y vende hoy mismo" subtitle="Paga en línea y tu tienda queda activa al instante, con todas las funciones de tu plan." pageTitle={PAGE_TITLE} aside={aside}
      below={<p>¿Ya tienes cuenta? <Link className="font-bold text-white underline underline-offset-4" to="/admin/login">Inicia sesión</Link></p>}>
      <form onSubmit={pay} className="space-y-4 rounded-3xl bg-white p-6 text-ink shadow-2xl ring-1 ring-black/5 sm:p-8" noValidate aria-label="Contratar y pagar">
        <div className="rounded-2xl bg-[#f3f7ee] p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-[#4a5f55]">Tu plan</p>
          <div className="mt-1 flex items-baseline justify-between gap-3">
            <p className="text-lg font-black text-[#03301f]">{plan ? `${plan.name} · ${cycle === 'mensual' ? 'mensual' : 'anual'}` : '…'}</p>
            <p className="text-2xl font-black tabular-nums text-[#03301f]">{plan ? money(amount) : ''}</p>
          </div>
          {plan && <p className="text-xs text-[#4a5f55]">{cycle === 'mensual' ? `Primer pago: ${money(plan.monthlyPrice)} del primer mes + ${money(plan.setupPrice)} de pago inicial (una sola vez).` : '12 meses de servicio, sin pago inicial.'}</p>}
        </div>
        <FieldBox label="Nombre de tu negocio" error={errors.businessName} id="buy-business">
          <IconInput icon={<Store size={18} />}><input id="buy-business" ref={(el) => { fields.current.businessName = el }} className={inputClass(errors.businessName)} autoComplete="organization" maxLength={80} value={form.businessName} onChange={set('businessName')} placeholder="Ej.: Flores de Ana" aria-invalid={Boolean(errors.businessName)} /></IconInput>
          {!errors.businessName && <span className="flex items-center gap-1.5 text-xs text-muted"><Link2 size={13} className="shrink-0" aria-hidden="true" />{slug.length >= 2 ? <span>Tu tienda: <b className="break-all text-[#03301f]">{STORE_HOST}{slug}</b></span> : 'Así se llamará tu tienda y su enlace.'}</span>}
        </FieldBox>
        <FieldBox label="Correo" error={errors.email} id="buy-email" hint="Ahí te llegan tu acceso y el comprobante de pago.">
          <IconInput icon={<Mail size={18} />}><input id="buy-email" ref={(el) => { fields.current.email = el }} type="email" inputMode="email" className={inputClass(errors.email)} autoComplete="email" value={form.email} onChange={set('email')} placeholder="tu@correo.com" aria-invalid={Boolean(errors.email)} /></IconInput>
        </FieldBox>
        <FieldBox label="WhatsApp para pedidos" optional error={errors.whatsapp} id="buy-whatsapp">
          <IconInput icon={<Phone size={18} />}><input id="buy-whatsapp" ref={(el) => { fields.current.whatsapp = el }} type="tel" inputMode="tel" className={inputClass(errors.whatsapp)} autoComplete="tel" value={form.whatsapp} onChange={set('whatsapp')} placeholder="300 123 4567" aria-invalid={Boolean(errors.whatsapp)} /></IconInput>
        </FieldBox>
        <FieldBox label="Tu nombre" optional id="buy-owner">
          <IconInput icon={<User size={18} />}><input id="buy-owner" className={inputClass()} autoComplete="name" maxLength={120} value={form.ownerName} onChange={set('ownerName')} placeholder="Como aparecerás en tu cuenta" /></IconInput>
        </FieldBox>
        <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden"><label>Sitio web<input tabIndex={-1} autoComplete="off" value={form.website} onChange={set('website')} /></label></div>
        <div>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl p-1 text-sm text-ink">
            <input ref={(el) => { fields.current.acceptTerms = el }} type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[#03301f]" checked={form.acceptTerms} onChange={set('acceptTerms')} aria-invalid={Boolean(errors.acceptTerms)} />
            <span>Acepto los <a href={TERMS_URL} target="_blank" rel="noopener noreferrer" className="font-bold underline">términos y condiciones</a> y el tratamiento de mis datos para crear y administrar mi tienda.</span>
          </label>
          {errors.acceptTerms && <p role="alert" className="mt-1 text-xs font-semibold text-red-700">{errors.acceptTerms}</p>}
        </div>
        {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">{error}{/cuenta/.test(error) && <> <Link to="/admin/login" className="font-bold underline">Iniciar sesión</Link></>}</p>}
        {opened && !error && <p role="status" className="rounded-xl bg-[#f3f7ee] px-3 py-2 text-sm text-[#03301f]">Completa el pago en la ventana de Bold. ¿La cerraste? Toca el botón otra vez.</p>}
        <button type="submit" disabled={busy || !plan}
          className="group flex min-h-[58px] w-full items-center justify-center gap-2 rounded-xl bg-[#cdf53f] px-5 text-base font-black text-[#03301f] shadow-[0_12px_30px_-10px_rgba(205,245,63,0.9)] transition-all hover:-translate-y-0.5 hover:brightness-105 active:translate-y-0 active:scale-[0.99] disabled:cursor-wait disabled:opacity-70">
          {busy ? <><Loader2 size={20} className="animate-spin" /> Preparando tu pago…</> : <><Lock size={18} /> Pagar {plan ? money(amount) : ''} y activar <ArrowRight size={20} className="transition-transform group-hover:translate-x-0.5" /></>}
        </button>
        <div className="flex flex-wrap items-center justify-center gap-1.5" aria-label="Medios de pago">
          {['Tarjeta crédito', 'Débito', 'PSE', 'Nequi'].map((method) => <span key={method} className="rounded-full bg-[#f3f7ee] px-2.5 py-1 text-[11px] font-semibold text-[#03301f]">{method}</span>)}
        </div>
        <p className="flex items-start justify-center gap-1.5 text-center text-xs text-muted"><ShieldCheck size={14} className="mt-px shrink-0 text-emerald-600" /> Pago seguro con Bold. TiendIA Exprés no ve ni guarda los datos de tu tarjeta.</p>
        {online?.mode === 'test' && <p className="text-center text-xs font-semibold text-amber-700">Modo de pruebas de Bold: no se cobra dinero real.</p>}
      </form>
    </PlatformAuthShell>
  )
}

function ResultScreen({ result }: { result: Result }) {
  const inbox = result.email ? inboxFor(result.email) : null
  const view = {
    checking: { icon: <Loader2 size={30} className="animate-spin text-[#03301f]" />, title: 'Confirmando tu pago…', text: 'Estamos consultando el resultado con Bold. Tarda unos segundos.' },
    paid: { icon: <BadgeCheck size={34} className="text-emerald-600" />, title: '¡Pago aprobado! Tu tienda está activa', text: `Tu plan ${result.planName || ''} quedó activo. Te enviamos${result.email ? ` a ${result.email}` : ''} el correo «Pago confirmado: crea tu contraseña y entra…» con el botón para entrar a tu panel.` },
    processing: { icon: <Clock size={32} className="text-amber-600" />, title: 'Tu pago está en proceso', text: 'Si Bold lo aprueba, tu plan se activa solo y te llega el correo con tu acceso. No vuelvas a pagar.' },
    failed: { icon: <XCircle size={32} className="text-red-600" />, title: 'El pago no fue aprobado', text: 'No se cobró nada. Puedes intentarlo de nuevo con otro medio de pago.' },
  }[result.kind]
  return (
    <PlatformAuthShell title={view.title} pageTitle={PAGE_TITLE}>
      <div className="card space-y-5 p-7 text-sm text-ink sm:p-8" role="status">
        <div className="flex justify-center">{view.icon}</div>
        <p className="text-center">{view.text}</p>
        {result.kind === 'paid' && (
          <>
            {inbox && <a href={inbox.url} target="_blank" rel="noopener noreferrer" className="btn-brand w-full justify-center !text-sm"><MailCheck size={16} /> {inbox.label}</a>}
            <ul className="space-y-1.5 rounded-btn bg-brand/5 p-3 text-[13px] text-muted">
              <li>· Llega desde <b>notificaciones@tiendiaexpres.com</b>. Si no lo ves, revisa Promociones o Spam.</li>
              <li>· El enlace sirve una sola vez y vence en 72 horas. Guarda el correo: es tu comprobante.</li>
            </ul>
          </>
        )}
        {result.kind === 'failed' && <a href="/contratar" className="btn-brand w-full justify-center"><CreditCard size={16} /> Intentar de nuevo</a>}
        <p className="text-center text-xs text-muted">¿Necesitas ayuda? <a className="font-bold underline" href={WHATSAPP_HELP} target="_blank" rel="noopener noreferrer">Escríbenos por WhatsApp</a></p>
      </div>
    </PlatformAuthShell>
  )
}

const inputClass = (error?: string) => `w-full min-h-[52px] rounded-xl border bg-[#f7f8f3] pl-11 pr-4 text-base text-ink placeholder:text-[#8a978f] transition focus:bg-white focus:outline-none focus:ring-4 ${error ? 'border-red-500 focus:ring-red-100' : 'border-[#dbe5de] focus:border-[#03301f] focus:ring-[#cdf53f]/40'}`

function IconInput({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return <div className="relative"><span aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#6b7d72]">{icon}</span>{children}</div>
}

function FieldBox({ label, optional, error, hint, id, children }: { label: string; optional?: boolean; error?: string; hint?: string; id: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-[13px] font-bold text-[#03301f]">{label}{optional && <span className="font-normal text-muted"> (opcional)</span>}</label>
      {children}
      {error ? <p role="alert" className="text-xs font-semibold text-red-700">{error}</p> : hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  )
}
