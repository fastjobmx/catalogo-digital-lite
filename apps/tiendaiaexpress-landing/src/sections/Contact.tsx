// Store request form. Version 1 has no backend: it prepares a WhatsApp message that the person
// still has to send. Nothing is stored or sent by this site.
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { site, whatsappLink } from '../config/site'
import { plans } from '../content/plans'
import { PLAN_EVENT, type PlanChoice } from './Commerce'
import { Button, Eyebrow } from '../components/ui/primitives'
import { Icon } from '../components/ui/Icon'

type Fields = { nombre: string; negocio: string; ciudad: string; vende: string; plan: string; modalidad: string }
type Errors = Partial<Record<keyof Fields, string>>
const EMPTY: Fields = { nombre: '', negocio: '', ciudad: '', vende: '', plan: 'Todavía no sé', modalidad: 'Todavía no sé' }
const MODALIDADES = ['Todavía no sé', 'Pago mensual', 'Pago anual']
const MIN_FILL_MS = 2500

export function buildMessage(f: Fields) {
  return [
    'Hola, quiero mi tienda con TiendIA Exprés',
    `Nombre: ${f.nombre.trim()}`,
    `Negocio: ${f.negocio.trim()}`,
    `Ciudad: ${f.ciudad.trim()}`,
    `Vendo: ${f.vende.trim()}`,
    `Plan de interés: ${f.plan}`,
    `Modalidad de pago: ${f.modalidad}`,
  ].join('\n')
}

export function validate(f: Fields): Errors {
  const e: Errors = {}
  if (f.nombre.trim().length < 2) e.nombre = 'Escribe tu nombre.'
  if (f.negocio.trim().length < 2) e.negocio = 'Escribe el nombre de tu negocio.'
  if (f.ciudad.trim().length < 2) e.ciudad = 'Escribe tu ciudad.'
  if (f.vende.trim().length < 3) e.vende = 'Cuéntanos qué vendes.'
  for (const key of Object.keys(f) as (keyof Fields)[]) if (f[key].length > 300) e[key] = 'Es demasiado largo (máximo 300 caracteres).'
  return e
}

export function Contact() {
  const [fields, setFields] = useState<Fields>(EMPTY)
  const [errors, setErrors] = useState<Errors>({})
  const [status, setStatus] = useState<'idle' | 'opening' | 'opened' | 'blocked'>('idle')
  const [link, setLink] = useState('')
  const startedAt = useRef(Date.now())
  const honeypot = useRef<HTMLInputElement>(null)
  const form = useRef<HTMLFormElement>(null)

  useEffect(() => {
    const onPlan = (e: Event) => {
      const { plan, billing } = (e as CustomEvent<PlanChoice>).detail
      setFields((f) => ({ ...f, plan, modalidad: billing === 'anual' ? 'Pago anual' : 'Pago mensual' }))
    }
    window.addEventListener(PLAN_EVENT, onPlan)
    return () => window.removeEventListener(PLAN_EVENT, onPlan)
  }, [])

  const set = (key: keyof Fields) => (e: { target: { value: string } }) => {
    setFields((f) => ({ ...f, [key]: e.target.value }))
    if (errors[key]) setErrors((x) => ({ ...x, [key]: undefined }))
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    // Spam guard: hidden field filled, or the form completed faster than a person can.
    if (honeypot.current?.value || Date.now() - startedAt.current < MIN_FILL_MS) {
      setErrors({ nombre: 'Revisa los datos e inténtalo de nuevo.' })
      return
    }
    const found = validate(fields)
    setErrors(found)
    const first = Object.keys(found)[0]
    if (first) { form.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus(); return }
    const url = whatsappLink(buildMessage(fields))
    setLink(url)
    setStatus('opening')
    const win = window.open(url, '_blank')
    if (win) win.opener = null
    // A blocked popup returns null; the "Abrir WhatsApp" button below works in both cases.
    window.setTimeout(() => setStatus(win ? 'opened' : 'blocked'), 500)
  }

  const field = 'mt-2 block w-full rounded-2xl border-0 bg-forest-deep px-4 py-3.5 text-[1rem] text-ivory ring-1 ring-ivory/15 placeholder:text-mist/60 focus:outline-none focus:ring-2 focus:ring-lime'

  return (
    <section id="contacto" aria-labelledby="contacto-title" className="on-dark relative overflow-hidden bg-forest py-24 text-ivory md:py-32">
      <div className="wrap relative z-10 grid grid-cols-1 gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,34rem)] lg:gap-20">
        <div>
          <Eyebrow onDark className="mb-5">Empieza hoy</Eyebrow>
          <h2 id="contacto-title" className="display text-[clamp(2.4rem,5.4vw,4.4rem)]">Tu tienda puede estar lista <span className="accent accent-gradient">esta semana.</span></h2>
          <p className="mt-6 max-w-lg text-lg leading-relaxed text-mist md:text-[1.2rem]">Pruébala gratis con tus productos o cuéntanos de tu negocio y la armamos contigo. Te respondemos por WhatsApp.</p>
          <div className="mt-8 rounded-2xl bg-white/5 p-5 ring-1 ring-inset ring-white/10 md:p-6">
            <p className="font-display text-[1.1rem] font-bold">¿Primero quieres ver cómo queda?</p>
            <p className="mt-1.5 text-[0.96rem] text-mist">Crea una mini tienda de prueba sin correo ni contraseña: hasta {site.trial.products} productos con foto, durante {site.trial.days} días. Para quedarte con tu tienda eliges un plan y la activamos contigo.</p>
            <div className="mt-5"><Button href={site.trialUrl} variant="lime" icon="arrowUpRight" external>Probar gratis</Button></div>
          </div>
          <div className="mt-8 space-y-4">
            <a href={whatsappLink()} target="_blank" rel="noopener noreferrer" className="group flex w-fit items-center gap-4 rounded-full py-1 pr-2 text-lg font-semibold hover:text-lime">
              <span className="grid size-12 place-items-center rounded-full bg-lime text-forest"><Icon name="whatsapp" size={22} /></span>
              {site.whatsapp.display}<span className="sr-only"> (WhatsApp, se abre en una pestaña nueva)</span>
            </a>
            <ul className="flex gap-2" aria-label="Redes sociales">
              {site.social.map((s) => (
                <li key={s.key}>
                  <a href={s.url} target="_blank" rel="noopener noreferrer" className="grid size-12 place-items-center rounded-full bg-ivory/8 text-ivory ring-1 ring-ivory/10 transition-colors hover:bg-lime hover:text-forest">
                    <Icon name={s.key} size={20} /><span className="sr-only">{s.label} (se abre en una pestaña nueva)</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <form ref={form} onSubmit={submit} noValidate className="rounded-[2rem] bg-forest-raised p-6 ring-1 ring-ivory/10 md:p-9" aria-describedby="form-privacidad">
          <h3 className="font-display text-[1.5rem] font-extrabold tracking-tight">Solicita tu tienda</h3>
          <p className="mb-6 mt-1 text-[0.95rem] text-mist">Completa estos datos y continúa por WhatsApp.</p>
          <div className="grid gap-5 sm:grid-cols-2">
            {([
              ['nombre', 'Tu nombre', 'text', 'name'],
              ['negocio', 'Nombre del negocio', 'text', 'organization'],
              ['ciudad', 'Ciudad', 'text', 'address-level2'],
            ] as const).map(([key, label, type, auto]) => (
              <div key={key} className={key === 'ciudad' ? 'sm:col-span-2' : ''}>
                <label htmlFor={`f-${key}`} className="text-sm font-semibold">{label}</label>
                <input id={`f-${key}`} name={key} type={type} autoComplete={auto} required maxLength={300} value={fields[key]} onChange={set(key)} aria-invalid={Boolean(errors[key])} aria-describedby={errors[key] ? `e-${key}` : undefined} className={field} />
                {errors[key] ? <p id={`e-${key}`} className="mt-1.5 text-sm font-semibold text-[#d6b4ff]">{errors[key]}</p> : null}
              </div>
            ))}
            <div className="sm:col-span-2">
              <label htmlFor="f-vende" className="text-sm font-semibold">¿Qué vendes?</label>
              <textarea id="f-vende" name="vende" rows={3} required maxLength={300} value={fields.vende} onChange={set('vende')} aria-invalid={Boolean(errors.vende)} aria-describedby={errors.vende ? 'e-vende' : 'h-vende'} className={`${field} resize-none`} />
              {errors.vende ? <p id="e-vende" className="mt-1.5 text-sm font-semibold text-[#d6b4ff]">{errors.vende}</p> : <p id="h-vende" className="mt-1.5 text-sm text-mist">Por ejemplo: ropa deportiva, accesorios, comida casera.</p>}
            </div>
            {([
              ['plan', 'Plan de interés', ['Todavía no sé', ...plans.map((p) => p.name)]],
              ['modalidad', 'Modalidad de pago', MODALIDADES],
            ] as const).map(([key, label, options]) => (
              <div key={key}>
                <label htmlFor={`f-${key}`} className="text-sm font-semibold">{label}</label>
                <select id={`f-${key}`} name={key} value={fields[key]} onChange={set(key)} className={`${field} appearance-none bg-[url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' fill='none' stroke='%23c6f25b' stroke-width='2'%3E%3Cpath d='M5 8l5 5 5-5'/%3E%3C/svg%3E")] bg-[length:20px] bg-[right_1rem_center] bg-no-repeat pr-12`}>
                  {options.map((o) => <option key={o}>{o}</option>)}
                </select>
              </div>
            ))}
            <div className="hidden" aria-hidden="true">
              <label htmlFor="f-web">No completar</label>
              <input id="f-web" ref={honeypot} name="sitio_web" type="text" tabIndex={-1} autoComplete="off" />
            </div>
          </div>

          <p id="form-privacidad" className="mt-6 flex gap-2.5 text-sm leading-relaxed text-mist">
            <Icon name="shield" size={18} className="mt-0.5 shrink-0 text-lime" />
            Al continuar se abre WhatsApp con este mensaje. Todavía tienes que enviarlo: tus datos solo se comparten por WhatsApp cuando decidas enviarlo. Este sitio no guarda lo que escribes.
          </p>
          <button type="submit" disabled={status === 'opening'} className="mt-6 inline-flex min-h-14 w-full items-center justify-center gap-2.5 rounded-full bg-lime px-7 font-display font-bold text-forest transition-transform active:scale-[0.98] disabled:opacity-70">
            <Icon name="whatsapp" size={20} />
            {status === 'opening' ? 'Abriendo WhatsApp…' : 'Preparar en WhatsApp'}
          </button>

          <div aria-live="polite" className="mt-4">
            {status === 'opened' || status === 'blocked' ? (
              <div className="rounded-2xl bg-forest-deep p-4 text-sm ring-1 ring-lime/30">
                <p className="font-semibold text-ivory">{status === 'opened' ? 'Abrimos WhatsApp con tu mensaje.' : 'Tu mensaje está listo.'} Recuerda tocar «Enviar» en WhatsApp para que nos llegue.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button href={link} variant="ivory" external icon="arrowUpRight">Abrir WhatsApp</Button>
                </div>
              </div>
            ) : null}
          </div>
        </form>
      </div>
    </section>
  )
}
