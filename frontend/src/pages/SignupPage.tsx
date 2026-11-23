import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowRight, BadgeCheck, CheckCircle2, CreditCard, Link2, Loader2, Mail, MailCheck, MessageCircle, Package, Palette, Phone, RefreshCw, Search, ShieldCheck, ShoppingBag, Store, User } from 'lucide-react'
import PlatformAuthShell from '../admin/PlatformAuthShell'
import { signupApi, type SignupConfig } from '../services/api'

const TERMS_URL = 'https://tiendiaexpres.com/terminos-y-condiciones'
const RESEND_WAIT_SECONDS = 120
const PAGE_TITLE = 'Prueba gratis 14 días | TiendIA Exprés'
const STORE_HOST = 'app.tiendiaexpres.com/t/'

type Form = { businessName: string; ownerName: string; email: string; whatsapp: string; acceptTerms: boolean; website: string }
type Field = 'businessName' | 'email' | 'whatsapp' | 'acceptTerms'

/** Same rule the server uses for the store address (it may add a suffix if the name is taken). */
export function slugPreview(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' y ')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-').slice(0, 40).replace(/-+$/g, '')
}

/** 300 123 4567 → +573001234567; numbers already with + stay as typed. Empty stays empty (the field is optional). */
export function normalizeWhatsApp(value: string): string | null {
  const raw = value.trim()
  if (!raw) return ''
  const digits = raw.replace(/\D/g, '')
  if (raw.startsWith('+')) return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null
  if (digits.length === 10 && digits.startsWith('3')) return `+57${digits}`
  if (digits.length === 12 && digits.startsWith('57')) return `+${digits}`
  return null
}

/** Web mail of the address, so the person opens the inbox in one tap after signing up. */
export function inboxFor(email: string): { label: string; url: string } | null {
  const domain = email.trim().toLowerCase().split('@')[1] || ''
  if (/^(gmail|googlemail)\.com$/.test(domain)) return { label: 'Abrir Gmail', url: 'https://mail.google.com/mail/u/0/#search/from%3Anotificaciones%40tiendiaexpres.com' }
  if (/^(hotmail|outlook|live|msn)\.(com|es|co)$/.test(domain)) return { label: 'Abrir Outlook', url: 'https://outlook.live.com/mail/0/' }
  if (/^yahoo\.(com|es|com\.co)$/.test(domain)) return { label: 'Abrir Yahoo Mail', url: 'https://mail.yahoo.com/' }
  if (/^(icloud|me)\.com$/.test(domain)) return { label: 'Abrir iCloud Mail', url: 'https://www.icloud.com/mail/' }
  return null
}

/** Real free trial: a few fields, a store of the platform and a one-time link by email to enter its panel. */
export default function SignupPage() {
  const [params] = useSearchParams()
  const [config, setConfig] = useState<SignupConfig | null>(null)
  const [form, setForm] = useState<Form>({ businessName: '', ownerName: '', email: params.get('correo') || '', whatsapp: '', acceptTerms: false, website: '' })
  const [step, setStep] = useState<'form' | 'sent' | 'resend'>(params.get('reenviar') ? 'resend' : 'form')
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [wait, setWait] = useState(0)
  const [resent, setResent] = useState(false)
  const fields = useRef<Partial<Record<Field, HTMLInputElement | null>>>({})

  useEffect(() => { signupApi.config().then(setConfig).catch(() => setConfig(null)) }, [])
  useEffect(() => {
    if (wait <= 0) return
    const timer = window.setTimeout(() => setWait((value) => value - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [wait])

  const days = config?.days ?? 14
  const products = config?.products ?? 20
  const set = (key: keyof Form) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value })
    if (key in errors) setErrors({ ...errors, [key]: undefined })
  }
  const slug = slugPreview(form.businessName)

  const validate = (): Partial<Record<Field, string>> => {
    const found: Partial<Record<Field, string>> = {}
    if (form.businessName.trim().length < 2) found.businessName = 'Escribe el nombre de tu negocio.'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email.trim())) found.email = 'Escribe un correo válido: ahí te llega el enlace para entrar.'
    if (normalizeWhatsApp(form.whatsapp) === null) found.whatsapp = 'Escribe un celular de 10 dígitos (300 123 4567) o con el código del país (+57…).'
    if (!form.acceptTerms) found.acceptTerms = 'Acepta los términos y condiciones para continuar.'
    return found
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    const found = validate()
    setErrors(found)
    const first = (['businessName', 'email', 'whatsapp', 'acceptTerms'] as Field[]).find((key) => found[key])
    if (first) { fields.current[first]?.focus(); return }
    setBusy(true)
    try {
      await signupApi.create({ businessName: form.businessName.trim(), ownerName: form.ownerName.trim() || undefined, email: form.email.trim(), whatsapp: normalizeWhatsApp(form.whatsapp) || undefined, acceptTerms: true, website: form.website })
      setStep('sent')
      setWait(RESEND_WAIT_SECONDS)
      window.scrollTo({ top: 0 })
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
      <PlatformAuthShell title="Registro en pausa" subtitle="Volvemos pronto" pageTitle={PAGE_TITLE}>
        <div className="card p-8 text-sm text-ink">El registro de pruebas está pausado por unas horas. Escríbenos por WhatsApp al <a className="font-bold underline" href="https://wa.me/573506912734">+57 350 691 2734</a> y te ayudamos a crear tu tienda.</div>
      </PlatformAuthShell>
    )
  }

  if (step === 'sent') {
    const inbox = inboxFor(form.email)
    return (
      <PlatformAuthShell title="Revisa tu correo para entrar a tu tienda" subtitle="Te enviamos el enlace para confirmar tu correo y entrar a tu panel" pageTitle={PAGE_TITLE}>
        <div className="card space-y-5 p-7 text-sm text-ink sm:p-8" role="status">
          <p className="flex items-start gap-3"><MailCheck size={22} className="mt-0.5 shrink-0 text-brand" aria-hidden="true" /><span>Si <b>{form.email.trim()}</b> puede recibir una tienda de prueba, en unos minutos llega un correo de <b>TiendIA Exprés</b> con el botón <b>«Confirmar y entrar a mi tienda»</b>.</span></p>
          {inbox && (
            <a href={inbox.url} target="_blank" rel="noopener noreferrer" className="btn-brand w-full justify-center !text-sm">
              <Mail size={16} /> {inbox.label}<span className="sr-only"> (se abre en una pestaña nueva)</span>
            </a>
          )}
          <ol className="space-y-2">
            {['Abre el correo y toca «Confirmar y entrar a mi tienda».', 'Crea tu contraseña: entras directo a tu panel.', `Sube tus productos (hasta ${products}) y comparte el enlace de tu tienda.`].map((text, index) => (
              <li key={text} className="flex gap-3"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand text-[12px] font-bold text-brand-foreground">{index + 1}</span><span className="pt-0.5">{text}</span></li>
            ))}
          </ol>
          <ul className="space-y-1.5 rounded-btn bg-brand/5 p-3 text-[13px] text-muted">
            <li>· Llega desde <b>notificaciones@tiendiaexpres.com</b> con el asunto «Confirma tu correo y entra a…».</li>
            <li>· Si no lo ves, revisa <b>Promociones</b>, <b>Spam</b> o <b>Correo no deseado</b> y márcalo como «No es spam».</li>
            <li>· El enlace sirve una sola vez y vence en 72 horas.</li>
          </ul>
          {resent && <p className="rounded-btn border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-900">Listo: si tu registro está pendiente, enviamos un enlace nuevo. El anterior deja de funcionar.</p>}
          {error && <p role="alert" className="text-red-700">{error}</p>}
          <button type="button" className="btn-ghost w-full" disabled={busy || wait > 0} onClick={() => void resend()}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />} {wait > 0 ? `Reenviar enlace en ${wait} s` : 'Reenviar el enlace'}
          </button>
          <p className="text-xs text-muted">¿Escribiste mal el correo? <button type="button" className="font-bold underline" onClick={() => { setStep('form'); setResent(false) }}>Corrígelo aquí</button>. ¿Necesitas ayuda? <a className="font-bold underline" href="https://wa.me/573506912734" target="_blank" rel="noopener noreferrer">Escríbenos por WhatsApp</a>.</p>
        </div>
      </PlatformAuthShell>
    )
  }

  if (step === 'resend') {
    return (
      <PlatformAuthShell title="Pide un enlace nuevo" subtitle="Para entrar a tu tienda de prueba" pageTitle={PAGE_TITLE}>
        <form onSubmit={resend} className="card space-y-5 p-8">
          <p className="text-sm text-muted">Escribe el correo con el que creaste tu tienda. Si el registro está pendiente de confirmar, te enviamos un enlace nuevo.</p>
          <label className="block space-y-2"><span className="block text-xs font-bold uppercase tracking-widest text-muted">Correo</span>
            <input type="email" autoComplete="email" className="input-field w-full !text-base" value={form.email} onChange={set('email')} required /></label>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <button type="submit" className="btn-brand w-full" disabled={busy}>{busy ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />} Enviar enlace</button>
          <p className="text-center text-xs text-muted">¿Ya confirmaste tu correo? <Link className="font-bold underline" to="/admin/login">Inicia sesión</Link></p>
        </form>
      </PlatformAuthShell>
    )
  }

  const aside = (
    <div className="flex items-center gap-8">
      <PhonePreview name={form.businessName.trim()} />
      <ul className="grid flex-1 gap-3 text-[14px] text-white/95 sm:grid-cols-2 sm:text-[15px] lg:grid-cols-1">
        <Benefit icon={<Package size={17} />}>Hasta {products} productos con fotos, precios, tallas y colores</Benefit>
        <Benefit icon={<MessageCircle size={17} />}>Tus clientes te envían el pedido completo por WhatsApp</Benefit>
        <Benefit icon={<CreditCard size={17} />}>Si quieres, cobra en línea con tarjeta, PSE o Nequi (Bold)</Benefit>
        <Benefit icon={<Palette size={17} />}>Tu logo, tus colores y plantillas listas para vender</Benefit>
        <li className="hidden items-center gap-2 pt-1 text-sm text-[#cfe3d6] lg:flex"><ShieldCheck size={16} className="shrink-0" /> Si contratas un plan, conservas todo lo que creaste.</li>
      </ul>
    </div>
  )

  return (
    <PlatformAuthShell title="Crea tu tienda online" titleAccent={`gratis por ${days} días`} subtitle="Lista en minutos, sin tarjeta de crédito y sin saber de tecnología." pageTitle={PAGE_TITLE} aside={aside}
      below={<p>¿Ya tienes cuenta? <Link className="font-bold text-white underline underline-offset-4" to="/admin/login">Inicia sesión</Link> · <Link className="font-bold text-white underline underline-offset-4" to="/registro?reenviar=1">Reenviar enlace</Link></p>}>
      <form onSubmit={submit} className="space-y-4 rounded-3xl bg-white p-6 text-ink shadow-2xl ring-1 ring-black/5 sm:p-8" noValidate aria-label="Crear mi tienda gratis">
        <div className="mb-1">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#cdf53f] px-3 py-1 text-[11px] font-black uppercase tracking-wider text-[#03301f]"><BadgeCheck size={13} /> {days} días gratis</span>
          <h2 className="mt-3 text-2xl font-black tracking-tight text-[#03301f]">Crea tu cuenta</h2>
          <p className="text-sm text-muted">Toma menos de un minuto.</p>
        </div>
        <Field label="Nombre de tu negocio" error={errors.businessName} id="signup-business">
          <IconInput icon={<Store size={18} />}>
            <input id="signup-business" ref={(el) => { fields.current.businessName = el }} className={inputClass(errors.businessName)} autoComplete="organization" maxLength={80}
              value={form.businessName} onChange={set('businessName')} placeholder="Ej.: Flores de Ana" aria-invalid={Boolean(errors.businessName)} aria-describedby="signup-business-help" />
          </IconInput>
          {!errors.businessName && (
            <span id="signup-business-help" className="flex items-center gap-1.5 text-xs text-muted"><Link2 size={13} aria-hidden="true" className="shrink-0" />
              {slug.length >= 2 ? <span>Tu tienda: <b className="break-all text-[#03301f]">{STORE_HOST}{slug}</b></span> : 'Así se llamará tu tienda y su enlace.'}
            </span>
          )}
        </Field>
        <Field label="Correo" error={errors.email} id="signup-email" hint="Ahí te llega el enlace para entrar y los avisos de tu tienda.">
          <IconInput icon={<Mail size={18} />}>
            <input id="signup-email" ref={(el) => { fields.current.email = el }} type="email" inputMode="email" className={inputClass(errors.email)} autoComplete="email"
              value={form.email} onChange={set('email')} placeholder="tu@correo.com" aria-invalid={Boolean(errors.email)} aria-describedby="signup-email-help" />
          </IconInput>
        </Field>
        <Field label="WhatsApp para pedidos" optional error={errors.whatsapp} id="signup-whatsapp" hint="Ahí te llegan los pedidos de tus clientes. Puedes agregarlo después.">
          <IconInput icon={<Phone size={18} />}>
            <input id="signup-whatsapp" ref={(el) => { fields.current.whatsapp = el }} type="tel" inputMode="tel" className={inputClass(errors.whatsapp)} autoComplete="tel"
              value={form.whatsapp} onChange={set('whatsapp')} placeholder="300 123 4567" aria-invalid={Boolean(errors.whatsapp)} aria-describedby="signup-whatsapp-help" />
          </IconInput>
        </Field>
        <Field label="Tu nombre" optional id="signup-owner">
          <IconInput icon={<User size={18} />}>
            <input id="signup-owner" className={inputClass()} autoComplete="name" maxLength={120} value={form.ownerName} onChange={set('ownerName')} placeholder="Para saludarte en los correos" />
          </IconInput>
        </Field>
        {/* Invisible to people; bots fill it. */}
        <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden"><label>Sitio web<input tabIndex={-1} autoComplete="off" value={form.website} onChange={set('website')} /></label></div>
        <div>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl p-1 text-sm text-ink">
            <input ref={(el) => { fields.current.acceptTerms = el }} type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[#03301f]" checked={form.acceptTerms} onChange={set('acceptTerms')} aria-invalid={Boolean(errors.acceptTerms)} />
            <span>Acepto los <a href={TERMS_URL} target="_blank" rel="noopener noreferrer" className="font-bold underline">términos y condiciones</a> y el tratamiento de mis datos para crear y administrar mi tienda.</span>
          </label>
          {errors.acceptTerms && <p role="alert" className="mt-1 text-xs font-semibold text-red-700">{errors.acceptTerms}</p>}
        </div>
        {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
        <button type="submit" disabled={busy}
          className="group flex min-h-[56px] w-full items-center justify-center gap-2 rounded-xl bg-[#cdf53f] px-5 text-base font-black text-[#03301f] shadow-[0_12px_30px_-10px_rgba(205,245,63,0.9)] transition-all hover:-translate-y-0.5 hover:brightness-105 active:translate-y-0 active:scale-[0.99] disabled:cursor-wait disabled:opacity-70">
          {busy ? <><Loader2 size={20} className="animate-spin" /> Creando tu tienda…</> : <>Crear mi tienda gratis <ArrowRight size={20} className="transition-transform group-hover:translate-x-0.5" /></>}
        </button>
        <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted">
          {[`${days} días gratis`, `Hasta ${products} productos`, 'Sin tarjeta de crédito'].map((item) => <li key={item} className="flex items-center gap-1"><CheckCircle2 size={13} className="text-emerald-600" aria-hidden="true" />{item}</li>)}
        </ul>
      </form>
    </PlatformAuthShell>
  )
}

const inputClass = (error?: string) => `w-full min-h-[52px] rounded-xl border bg-[#f7f8f3] pl-11 pr-4 text-base text-ink placeholder:text-[#8a978f] transition focus:bg-white focus:outline-none focus:ring-4 ${error ? 'border-red-500 focus:ring-red-100' : 'border-[#dbe5de] focus:border-[#03301f] focus:ring-[#cdf53f]/40'}`

function IconInput({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return <div className="relative"><span aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#6b7d72]">{icon}</span>{children}</div>
}

function Field({ label, optional, error, hint, id, children }: { label: string; optional?: boolean; error?: string; hint?: string; id: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-[13px] font-bold text-[#03301f]">{label}{optional && <span className="font-normal text-muted"> (opcional)</span>}</label>
      {children}
      {error ? <p id={`${id}-help`} role="alert" className="text-xs font-semibold text-red-700">{error}</p> : hint ? <p id={`${id}-help`} className="text-xs text-muted">{hint}</p> : null}
    </div>
  )
}

function Benefit({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return <li className="flex items-start gap-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-[#cdf53f] text-[#03301f] shadow-[0_6px_16px_-6px_rgba(205,245,63,0.8)]">{icon}</span><span className="pt-1">{children}</span></li>
}

const SAMPLE = [
  { src: '/seed-images/sneakerhub/ASTRAL-03.webp', name: 'Tenis Astral', price: '$289.900' },
  { src: '/seed-images/sneakerhub/NORD-02.webp', name: 'Nord Drift', price: '$219.900' },
  { src: '/seed-images/sneakerhub/KINETIK-05.webp', name: 'Kinetik', price: '$389.900' },
  { src: '/seed-images/sneakerhub/TERA-08.webp', name: 'Tera Low', price: '$189.900' },
]

/** A phone with a sample store that takes the name being typed: the person sees their store before creating it. */
function PhonePreview({ name }: { name: string }) {
  const title = name.length >= 2 ? name : 'Tu negocio'
  return (
    <div aria-hidden="true" className="relative hidden shrink-0 lg:block">
      <div className="w-[232px] -rotate-2 rounded-[2.4rem] border-[7px] border-[#0b0f0d] bg-[#0b0f0d] shadow-[0_30px_60px_-20px_rgba(0,0,0,0.7)]">
        <div className="overflow-hidden rounded-[1.9rem] bg-[#f7f8f3]">
          <div className="flex items-center justify-between bg-white px-3.5 pb-2 pt-3">
            <span className="flex min-w-0 items-center gap-2">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#03301f] text-[12px] font-black text-[#cdf53f]">{title.charAt(0).toUpperCase()}</span>
              <span className="truncate text-[13px] font-black text-[#03301f]">{title}</span>
            </span>
            <ShoppingBag size={15} className="shrink-0 text-[#03301f]" />
          </div>
          <div className="mx-3 mt-2 flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-[10px] text-[#8a978f] ring-1 ring-black/5"><Search size={11} /> Buscar productos</div>
          <div className="grid grid-cols-2 gap-2 p-3">
            {SAMPLE.map((item) => (
              <div key={item.src} className="overflow-hidden rounded-xl bg-white ring-1 ring-black/5">
                <img src={item.src} alt="" width={120} height={120} loading="lazy" className="aspect-square w-full object-cover" />
                <div className="px-2 py-1.5"><p className="truncate text-[10px] font-semibold text-ink">{item.name}</p><p className="text-[10px] font-black text-[#03301f]">{item.price}</p></div>
              </div>
            ))}
          </div>
          <div className="mx-3 mb-3 flex items-center justify-center gap-1.5 rounded-xl bg-[#25D366] py-2 text-[11px] font-bold text-white"><MessageCircle size={13} /> Pedir por WhatsApp</div>
        </div>
      </div>
      <div className="absolute -right-6 -top-5 rotate-3 rounded-2xl bg-white px-3 py-2 text-[11px] shadow-xl ring-1 ring-black/5">
        <p className="font-black text-[#03301f]">🛒 Nuevo pedido</p><p className="text-muted">2 productos · $509.800</p>
      </div>
      <div className="absolute -left-8 bottom-24 -rotate-3 rounded-2xl bg-[#03301f] px-3 py-2 text-[11px] text-white shadow-xl ring-1 ring-white/10">
        <p className="font-black text-[#cdf53f]">✓ Pago aprobado</p><p className="text-white/70">Tarjeta · Bold</p>
      </div>
    </div>
  )
}
