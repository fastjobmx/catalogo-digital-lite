// /servicios-adicionales: catálogo comercial de servicios (datos en src/content/addons.ts).
// Búsqueda y filtros funcionan en el navegador; el HTML prerenderizado ya trae los 54 servicios.
import { useMemo, useState, type ReactNode } from 'react'
import { site, whatsappLink } from '../config/site'
import { cop } from '../content/plans'
import { categories, packages, periodLabel, services, type AddOnService, type CategoryKey, type PriceStatus } from '../content/addons'
import { Icon, type IconName } from '../components/ui/Icon'
import { Button } from '../components/ui/primitives'
import { LegalLayout } from './LegalLayout'
import mascota640 from '../assets/brand/mascota-640.webp'
import mascota320 from '../assets/brand/mascota-320.webp'
import piezaVertical from '../assets/studio/oferta-vertical.webp'
import piezaCarrusel from '../assets/studio/carrusel-1.webp'

const quote = (subject: string) => `mailto:${site.email.sales}?subject=${encodeURIComponent(`Cotización: ${subject}`)}`
const catOf = (key: CategoryKey) => categories.find((c) => c.key === key)!
const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export function Status({ status, onDark, onLime }: { status: PriceStatus | 'pronto'; onDark?: boolean; onLime?: boolean }) {
  const label = status === 'confirmado' ? 'Precio confirmado' : status === 'pronto' ? 'Próximamente' : 'Precio propuesto'
  const style = status === 'confirmado'
    ? onLime ? 'bg-night text-lime ring-night' : 'bg-lime text-night ring-night/10'
    : status === 'pronto'
      ? onDark ? 'bg-white/8 text-mist ring-white/15' : 'bg-night/6 text-ink-soft ring-night/15'
      : onDark ? 'bg-violet/20 text-violet-soft ring-violet/40' : 'bg-violet/10 text-violet-ink ring-violet/25'
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[0.72rem] font-semibold leading-none ring-1 ring-inset ${style}`}>
      <span className="size-1.5 rounded-full bg-current opacity-70" aria-hidden="true" />
      {label}
    </span>
  )
}

function Price({ s, big }: { s: AddOnService; big?: boolean }) {
  return (
    <p className="leading-none">
      {s.from ? <span className="mr-1 text-[0.8rem] font-semibold text-ink-soft">desde</span> : null}
      <span className={`font-display font-extrabold tracking-tight text-night ${big ? 'text-[1.9rem]' : 'text-[1.45rem]'}`}>{cop(s.price).replace(' COP', '')}</span>
      <span className="ml-1 text-[0.8rem] font-semibold text-ink-soft">COP · {periodLabel[s.period]}</span>
    </p>
  )
}

function Eyebrow({ children, onDark }: { children: ReactNode; onDark?: boolean }) {
  return (
    <p className={`eyebrow flex items-center gap-2.5 ${onDark ? 'text-cyan' : 'text-violet-ink'}`}>
      <span className={`h-px w-6 ${onDark ? 'bg-cyan/70' : 'bg-violet-ink/60'}`} aria-hidden="true" />
      {children}
    </p>
  )
}

function Hero() {
  const tiles: { icon: IconName; title: string; body: string }[] = [
    { icon: 'devices', title: 'Web', body: 'Tu negocio, bien presentado' },
    { icon: 'chart', title: 'SEO', body: 'Que te encuentren' },
    { icon: 'megaphone', title: 'Marketing', body: 'Comunicación con estrategia' },
    { icon: 'bot', title: 'IA', body: 'Procesos más ágiles' },
  ]
  return (
    <div className="on-dark relative overflow-hidden bg-night text-porcelain">
      <div className="pointer-events-none absolute -left-40 -top-40 size-[38rem] rounded-full bg-[radial-gradient(closest-side,rgba(197,42,241,.28),transparent)]" aria-hidden="true" />
      <div className="pointer-events-none absolute -bottom-56 right-[-8rem] size-[42rem] rounded-full bg-[radial-gradient(closest-side,rgba(18,220,231,.16),transparent)]" aria-hidden="true" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.04)_1px,transparent_1px)] bg-[size:56px_56px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" aria-hidden="true" />

      <div className="wrap relative grid items-center gap-12 py-14 md:py-20 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:py-24">
        <div>
          <Eyebrow onDark>Servicios adicionales · Precios de lanzamiento</Eyebrow>
          <h1 className="display mt-6 text-[clamp(2.5rem,6vw,4.75rem)]">
            Tu negocio merece <span className="accent-gradient">ir más allá.</span>
          </h1>
          <p className="mt-6 max-w-xl text-[1.08rem] leading-relaxed text-mist md:text-[1.18rem]">
            Páginas web, dominio propio, SEO, marketing, automatizaciones y diseño, con el mismo equipo que hace tu tienda. Precios pensados para negocios que están empezando.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button href="#catalogo" variant="lime" size="lg" icon="arrowDown">Explorar servicios</Button>
            <Button href={quote('servicios adicionales')} variant="outline-light" size="lg" icon="arrowUpRight">Hablar con ventas</Button>
          </div>
          <ul className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-[0.92rem] text-mist">
            {['Cotización antes de pagar', 'Sin cobros automáticos', 'Precios en COP'].map((t) => (
              <li key={t} className="flex items-center gap-2"><Icon name="check" size={16} className="text-lime" />{t}</li>
            ))}
          </ul>
        </div>

        <div className="relative mx-auto mt-10 w-full max-w-[34rem] sm:mb-10 lg:mt-0">
          <div className="relative rounded-[2rem] bg-gradient-to-br from-violet-deep/50 via-night-raised to-night p-6 ring-1 ring-white/12 shadow-[0_40px_80px_-40px_rgba(197,42,241,.6)] md:p-8">
            <p className="eyebrow text-lime">Más que una tienda online</p>
            <p className="display mt-3 max-w-[16ch] text-[clamp(1.6rem,3vw,2.2rem)]">Una presencia digital que <span className="text-lime">trabaja contigo.</span></p>
            <ul className="mt-6 grid grid-cols-2 gap-3">
              {tiles.map((t) => (
                <li key={t.title} className="rounded-2xl bg-porcelain p-4 text-night">
                  <span className="grid size-9 place-items-center rounded-xl bg-night text-lime"><Icon name={t.icon} size={18} /></span>
                  <p className="mt-3 font-display text-[1.05rem] font-bold">{t.title}</p>
                  <p className="text-[0.82rem] leading-snug text-ink-soft">{t.body}</p>
                </li>
              ))}
            </ul>
          </div>
          <img src={piezaVertical} alt="Pieza vertical creada con el Estudio Creativo" width={150} height={267} loading="eager" decoding="async" className="absolute -right-4 -top-24 hidden w-[6.5rem] rotate-6 rounded-2xl shadow-[0_24px_50px_-20px_rgba(0,0,0,.8)] ring-1 ring-white/20 sm:block xl:-right-12 xl:w-[7.5rem]" />
          <img src={piezaCarrusel} alt="" width={140} height={140} loading="eager" decoding="async" className="absolute -bottom-16 -left-6 hidden w-[6.5rem] -rotate-6 rounded-2xl shadow-[0_24px_50px_-20px_rgba(0,0,0,.8)] ring-1 ring-white/20 sm:block xl:-left-16 xl:w-[7.5rem]" />
          <img src={mascota320} srcSet={`${mascota320} 320w, ${mascota640} 640w`} sizes="160px" alt="" width={160} height={160} loading="eager" decoding="async" className="absolute -bottom-12 -right-2 w-[7rem] drop-shadow-[0_20px_40px_rgba(217,255,20,.25)] md:-right-10 md:w-[10rem]" />
        </div>
      </div>
    </div>
  )
}

function Areas({ onPick }: { onPick: (key: CategoryKey) => void }) {
  return (
    <section aria-labelledby="areas-titulo" className="py-20 md:py-24">
      <div className="wrap">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)] lg:items-end">
          <div>
            <Eyebrow>Áreas de trabajo</Eyebrow>
            <h2 id="areas-titulo" className="display mt-4 text-[clamp(2rem,4vw,3.25rem)] text-night">Todo lo que necesitas. <span className="text-violet-ink">Sin complicaciones.</span></h2>
          </div>
          <p className="text-[1.06rem] leading-relaxed text-ink-soft">Desde tu primer dominio hasta procesos automatizados: eliges solo el servicio que tu negocio necesita, cuando lo necesita.</p>
        </div>
        <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((c) => {
            const count = services.filter((s) => s.category === c.key && s.available !== false).length
            const min = Math.min(...services.filter((s) => s.category === c.key && s.available !== false).map((s) => s.price))
            return (
              <li key={c.key}>
                <a href="#catalogo" onClick={() => onPick(c.key)} className="group relative flex h-full flex-col overflow-hidden rounded-3xl bg-paper p-6 ring-1 ring-night/10 transition-[transform,box-shadow] duration-300 hover:-translate-y-1 hover:shadow-[0_30px_60px_-34px_rgba(11,11,19,.45)]">
                  <span className="pointer-events-none absolute -right-10 -top-10 size-32 rounded-full bg-lime/25 transition-transform duration-500 group-hover:scale-125" aria-hidden="true" />
                  <span className="relative grid size-12 place-items-center rounded-2xl bg-night text-lime"><Icon name={c.icon} size={22} /></span>
                  <h3 className="relative mt-5 font-display text-[1.25rem] font-bold text-night">{c.title}</h3>
                  <p className="relative mt-2 flex-1 text-[0.98rem] leading-relaxed text-ink-soft">{c.body}</p>
                  <p className="relative mt-5 flex items-center justify-between text-[0.9rem] font-semibold text-night">
                    <span>{count} servicios · desde {cop(min)}</span>
                    <Icon name="arrowRight" size={18} className="text-violet-ink transition-transform duration-300 group-hover:translate-x-1" />
                  </p>
                </a>
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}

function Packages() {
  return (
    <section id="paquetes" aria-labelledby="paquetes-titulo" className="on-dark relative overflow-hidden bg-night py-20 text-porcelain md:py-24">
      <div className="pointer-events-none absolute -top-48 left-1/2 h-96 w-[60rem] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(217,255,20,.12),transparent)]" aria-hidden="true" />
      <div className="wrap relative">
        <Eyebrow onDark>Propuestas para empezar</Eyebrow>
        <h2 id="paquetes-titulo" className="display mt-4 max-w-3xl text-[clamp(2rem,4vw,3.25rem)]">Soluciones completas. <span className="text-lime">Precios de lanzamiento.</span></h2>
        <p className="mt-4 max-w-2xl text-[1.06rem] leading-relaxed text-mist">Paquetes que combinan servicios del catálogo y cuestan menos que por separado. Antes de pagar recibes la cotización con el total y los impuestos.</p>
        <div className="mt-12 grid gap-5 lg:grid-cols-3">
          {packages.map((p) => (
            <article key={p.key} className={`relative flex flex-col rounded-3xl p-7 ${p.highlight ? 'bg-lime text-night shadow-[0_40px_80px_-40px_rgba(217,255,20,.7)] lg:-translate-y-3' : 'bg-white/[0.06] ring-1 ring-inset ring-white/12'}`}>
              {p.highlight ? <span className="absolute -top-3 right-6 rounded-full bg-night px-3 py-1 text-[0.72rem] font-bold uppercase tracking-[0.1em] text-lime">El más elegido</span> : null}
              <p className={`eyebrow ${p.highlight ? 'text-night/70' : 'text-cyan'}`}>{p.eyebrow}</p>
              <h3 className="mt-2 font-display text-[1.6rem] font-extrabold tracking-tight">{p.name}</h3>
              <p className={`mt-2 text-[0.98rem] leading-relaxed ${p.highlight ? 'text-night/75' : 'text-mist'}`}>{p.summary}</p>
              <p className="mt-6 font-display text-[2.5rem] font-extrabold leading-none tracking-tight">{cop(p.price).replace(' COP', '')}<span className={`ml-1.5 text-[0.9rem] font-semibold ${p.highlight ? 'text-night/70' : 'text-mist'}`}>COP · pago único</span></p>
              <p className={`mt-2 text-[0.88rem] ${p.highlight ? 'text-night/75' : 'text-mist'}`}>Por separado: <s>{cop(p.separate)}</s> · ahorras {cop(p.separate - p.price)}</p>
              <p className="mt-3"><Status status="confirmado" onDark={!p.highlight} onLime={p.highlight} /></p>
              <ul className="mt-6 flex-1 space-y-2.5 text-[0.96rem]">
                {p.items.map((i) => <li key={i} className="flex gap-2.5"><Icon name="check" size={18} className={`mt-0.5 shrink-0 ${p.highlight ? 'text-violet-ink' : 'text-lime'}`} />{i}</li>)}
              </ul>
              <Button href={quote(`paquete ${p.name}`)} variant={p.highlight ? 'night' : 'lime'} size="md" icon="arrowUpRight" className="mt-7 w-full">Cotizar este paquete</Button>
            </article>
          ))}
        </div>
        <p className="mt-8 max-w-4xl text-[0.86rem] leading-relaxed text-mist">Los paquetes no incluyen pauta publicitaria, licencias, APIs ni cargos de proveedores externos. El total con impuestos se informa en la cotización. No garantizamos resultados comerciales ni posiciones en buscadores.</p>
      </div>
    </section>
  )
}

function ServiceCard({ s }: { s: AddOnService }) {
  const cat = catOf(s.category)
  return (
    <li className="flex">
      <article className="flex w-full flex-col rounded-3xl bg-paper p-6 ring-1 ring-night/10 transition-shadow duration-300 hover:shadow-[0_24px_48px_-30px_rgba(11,11,19,.45)]">
        <div className="flex items-start justify-between gap-3">
          <p className="flex items-center gap-2 text-[0.74rem] font-bold uppercase tracking-[0.12em] text-ink-soft"><Icon name={cat.icon} size={15} className="text-violet-ink" />{cat.label}</p>
          <Status status={s.status} />
        </div>
        <h3 className="mt-4 font-display text-[1.15rem] font-bold leading-snug text-night">{s.name}</h3>
        <p className="mt-2 text-[0.95rem] leading-relaxed text-ink-soft">{s.description}</p>
        <p className="mt-2 text-[0.84rem] leading-relaxed text-ink-soft/90">{s.scope}</p>
        {s.planNote ? (
          <p className="mt-3 flex gap-2 rounded-xl bg-[#e3f8f9] p-3 text-[0.84rem] leading-snug text-[#0a4f53]">
            <Icon name="shield" size={16} className="mt-0.5 shrink-0" /><span>{s.planNote}</span>
          </p>
        ) : null}
        <div className="mt-auto flex items-end justify-between gap-3 border-t border-night/8 pt-5">
          <Price s={s} />
          <Button href={quote(s.name)} variant="night" size="sm" icon="arrowUpRight" aria-label={`Cotizar ${s.name}`}>Cotizar</Button>
        </div>
      </article>
    </li>
  )
}

function Catalog({ active, setActive }: { active: CategoryKey | 'todos'; setActive: (k: CategoryKey | 'todos') => void }) {
  const [query, setQuery] = useState('')
  const available = services.filter((s) => s.available !== false)
  const upcoming = services.filter((s) => s.available === false)
  const shown = useMemo(() => {
    const q = normalize(query.trim())
    return available.filter((s) => (active === 'todos' || s.category === active) && (!q || normalize(`${s.name} ${s.description} ${s.scope} ${catOf(s.category).label}`).includes(q)))
  }, [query, active, available])

  return (
    <section id="catalogo" aria-labelledby="catalogo-titulo" className="bg-paper py-20 md:py-24">
      <div className="wrap">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)] lg:items-end">
          <div>
            <Eyebrow>Catálogo completo</Eyebrow>
            <h2 id="catalogo-titulo" className="display mt-4 text-[clamp(2rem,4vw,3.25rem)] text-night">Elige lo que tu negocio necesita.</h2>
          </div>
          <p className="text-[1.02rem] leading-relaxed text-ink-soft">Precios de lanzamiento confirmados, en pesos colombianos y sin impuestos. El total con impuestos y el alcance exacto te llegan en la cotización, antes de pagar.</p>
        </div>

        <div className="mt-10 rounded-3xl bg-porcelain p-4 ring-1 ring-night/10 md:p-5">
          <label htmlFor="buscar-servicio" className="eyebrow text-ink-soft">Buscar por nombre o necesidad</label>
          <div className="relative mt-2">
            <Icon name="sparkle" size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-violet-ink" />
            <input
              id="buscar-servicio"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ej.: página web, redes sociales, logo, SEO…"
              autoComplete="off"
              className="h-13 w-full rounded-2xl bg-paper py-3.5 pl-11 pr-4 text-[1rem] text-night ring-1 ring-night/15 placeholder:text-ink-soft/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet"
            />
          </div>
          <div role="group" aria-label="Filtrar por categoría" className="mt-4 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
            {[{ key: 'todos' as const, label: 'Todos' }, ...categories].map((c) => (
              <button
                key={c.key}
                type="button"
                aria-pressed={active === c.key}
                onClick={() => setActive(c.key)}
                className={`min-h-11 shrink-0 whitespace-nowrap rounded-full px-4 text-[0.9rem] font-semibold transition-colors ${active === c.key ? 'bg-night text-lime' : 'bg-paper text-night ring-1 ring-inset ring-night/15 hover:bg-night/5'}`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        <p className="mt-6 text-[0.9rem] font-semibold text-ink-soft" aria-live="polite">{shown.length} de {available.length} servicios</p>

        {shown.length ? (
          <ul className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {shown.map((s) => <ServiceCard key={s.id} s={s} />)}
          </ul>
        ) : (
          <div className="mt-4 rounded-3xl bg-porcelain p-10 text-center ring-1 ring-night/10">
            <p className="font-display text-[1.2rem] font-bold text-night">No encontramos ese servicio.</p>
            <p className="mt-2 text-ink-soft">Cuéntanos qué necesitas y te preparamos una propuesta a la medida.</p>
            <Button href={quote(query || 'servicio a la medida')} variant="night" size="md" icon="arrowUpRight" className="mt-5">Escribir a ventas</Button>
          </div>
        )}

        {upcoming.length ? (
          <div className="mt-14">
            <h3 className="font-display text-[1.25rem] font-bold text-night">Próximamente</h3>
            <p className="mt-1 max-w-3xl text-[0.95rem] text-ink-soft">Aún no se pueden contratar. Los publicamos cuando estén habilitados, con sus condiciones.</p>
            <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {upcoming.map((s) => (
                <li key={s.id} className="rounded-2xl bg-porcelain p-5 border border-dashed border-night/20">
                  <Status status="pronto" />
                  <p className="mt-3 font-display font-bold text-night">{s.name}</p>
                  <p className="mt-1 text-[0.86rem] leading-snug text-ink-soft">{s.scope}</p>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  )
}

function Domains() {
  const renewal = services.find((s) => s.id === 10)!
  const facts: { icon: IconName; title: string; body: string }[] = [
    { icon: 'shield', title: 'Queda a tu nombre', body: 'El dominio se registra a nombre tuyo o de tu empresa. Hacemos la gestión técnica sin quedarnos con la titularidad.' },
    { icon: 'link', title: 'DNS y HTTPS', body: 'Conectamos tu dominio a tu tienda y habilitamos el HTTPS estándar cuando la infraestructura lo permite.' },
    { icon: 'clock', title: 'Te avisamos', body: 'Procuramos avisarte por correo 30, 15 y 7 días antes del vencimiento, además de los avisos del registrador.' },
    { icon: 'send', title: 'Es portable', body: 'Puedes llevarlo a otro proveedor sin penalización nuestra. Cancelar tu plan no nos transfiere tu dominio.' },
  ]
  return (
    <section id="dominios" aria-labelledby="dominios-titulo" className="py-20 md:py-24">
      <div className="wrap grid gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-center">
        <div>
          <Eyebrow>Dominio propio</Eyebrow>
          <h2 id="dominios-titulo" className="display mt-4 text-[clamp(2rem,4vw,3rem)] text-night">Tu marca, en tu propia dirección.</h2>
          <p className="mt-4 text-[1.04rem] leading-relaxed text-ink-soft">Hoy ningún plan incluye dominio propio: todos traen tu tienda en app.tiendiaexpres.com sin costo. Si quieres tunegocio.com, lo registramos o conectamos el que ya tienes.</p>
          <div className="mt-7 rounded-3xl bg-night p-7 text-porcelain on-dark">
            <p className="eyebrow text-cyan">Renovación anual de dominio estándar</p>
            <p className="mt-3 font-display text-[2.6rem] font-extrabold leading-none tracking-tight">{cop(renewal.price).replace(' COP', '')}<span className="ml-1.5 text-[0.95rem] font-semibold text-mist">COP al año</span></p>
            <p className="mt-3"><Status status="confirmado" /></p>
            <p className="mt-4 text-[0.92rem] leading-relaxed text-mist">No incluye recuperación tras el vencimiento, redención, dominios premium ni cargos extraordinarios del registrador: esos se informan y aceptan antes de pagar. Si no se renueva a tiempo, el registrador puede suspenderlo y no podemos garantizar recuperarlo.</p>
          </div>
        </div>
        <ul className="grid gap-4 sm:grid-cols-2">
          {facts.map((f) => (
            <li key={f.title} className="rounded-3xl bg-paper p-6 ring-1 ring-night/10">
              <span className="grid size-11 place-items-center rounded-2xl bg-violet/10 text-violet-ink"><Icon name={f.icon} size={20} /></span>
              <h3 className="mt-4 font-display text-[1.08rem] font-bold text-night">{f.title}</h3>
              <p className="mt-1.5 text-[0.95rem] leading-relaxed text-ink-soft">{f.body}</p>
            </li>
          ))}
          <li className="rounded-3xl bg-lime/40 p-6 ring-1 ring-night/10 sm:col-span-2">
            <p className="font-display text-[1.05rem] font-bold text-night">El dominio no incluye SEO, publicidad, correo corporativo ni desarrollo a medida.</p>
            <p className="mt-1 text-[0.95rem] text-night/80">Cada uno se cotiza aparte en este catálogo. Condiciones completas en los <a href="/terminos-y-condiciones#adquisicion-de-un-dominio-propio" className="font-semibold underline underline-offset-4">Términos y condiciones</a>.</p>
          </li>
        </ul>
      </div>
    </section>
  )
}

function Process() {
  const steps = [
    { title: 'Cuéntanos tu proyecto', body: 'Qué vendes, qué te gustaría mejorar y en qué plazo.' },
    { title: 'Recibe una cotización por escrito', body: 'Servicio, alcance, precio total con impuestos, periodicidad, plazos y política de cancelación o devolución.' },
    { title: 'Apruebas y empezamos', body: 'Nada se cobra sin tu aceptación. Los pagos únicos no se vuelven suscripciones y no hay cobros automáticos.' },
  ]
  return (
    <section id="proceso" aria-labelledby="proceso-titulo" className="relative overflow-hidden bg-[linear-gradient(135deg,#f3ffd1,#fafafd_45%,#f4e6fb)] py-20 md:py-24">
      <div className="wrap grid gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-center">
        <div>
          <Eyebrow>Un proceso claro</Eyebrow>
          <h2 id="proceso-titulo" className="display mt-4 text-[clamp(2rem,4vw,3.25rem)] text-night">De una idea a una <span className="text-violet-ink">propuesta concreta.</span></h2>
          <p className="mt-4 max-w-lg text-[1.04rem] leading-relaxed text-ink-soft">No vendemos servicios a ciegas: primero entendemos lo que necesitas, definimos entregables y acordamos el valor final.</p>
          <Button href={quote('servicios adicionales')} variant="night" size="md" icon="arrowUpRight" className="mt-7">Escribir a ventas</Button>
        </div>
        <ol className="space-y-3">
          {steps.map((s, i) => (
            <li key={s.title} className="flex gap-4 rounded-3xl bg-paper/90 p-5 ring-1 ring-night/10 backdrop-blur md:p-6">
              <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-night font-display font-extrabold text-lime">{String(i + 1).padStart(2, '0')}</span>
              <div>
                <h3 className="font-display text-[1.1rem] font-bold text-night">{s.title}</h3>
                <p className="mt-1 text-[0.96rem] leading-relaxed text-ink-soft">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

const faqs = [
  { q: '¿Estos precios son definitivos?', a: 'Sí: son nuestros precios de lanzamiento vigentes, en pesos colombianos y sin impuestos. Antes de cualquier pago recibes una cotización con el alcance exacto y el total con impuestos. Los servicios marcados como «Próximamente» todavía no se pueden contratar.' },
  { q: '¿Por qué son tan económicos?', a: 'Estamos empezando y queremos acompañar a los negocios desde el principio. Los valores se confirman en cada cotización y respetamos el precio que aceptaste durante el servicio contratado.' },
  { q: '¿Mi plan ya incluye alguno de estos servicios?', a: 'Tu plan incluye tu tienda online, plantillas y apariencia, importación de productos, mejoras de foto con IA, el Estudio Creativo y el asistente de Telegram. Cuando un servicio se parece a algo incluido, la tarjeta lo explica para que no pagues dos veces.' },
  { q: '¿Los servicios de SEO garantizan aparecer de primero?', a: 'No. Trabajamos la parte técnica y el contenido, pero los buscadores deciden sus resultados. No se garantizan posiciones, visitas ni ventas.' },
  { q: '¿La inversión en anuncios está incluida?', a: 'No. La configuración y gestión de campañas se cotiza como servicio; el presupuesto publicitario lo pagas directamente a la plataforma de anuncios.' },
  { q: '¿El desarrollo de una web incluye hosting y dominio?', a: 'Solo si la cotización lo dice expresamente. Diseño, alojamiento, dominio, mantenimiento, licencias y renovaciones se detallan por separado cuando corresponde.' },
  { q: '¿Las automatizaciones incluyen WhatsApp o IA ilimitada?', a: 'No. Dependen de los canales autorizados y de cada proveedor; sus tarifas (APIs, mensajes, herramientas) se informan aparte. La integración oficial de WhatsApp Business aún no está disponible.' },
  { q: '¿Puedo contratar un servicio sin tener un plan TiendIA?', a: 'Podemos evaluar servicios a medida de forma independiente. Las herramientas propias de la plataforma requieren una suscripción.' },
  { q: '¿Cómo pago un servicio?', a: `Escríbenos a ${site.email.sales}. Te enviamos la cotización y, cuando la aceptas, te indicamos cómo pagar. Esta página no recibe pagos.` },
  { q: '¿En qué horario me responden?', a: `En horario de oficina, hora de Colombia. Ventas: ${site.email.sales}. Soporte técnico: ${site.email.support}.` },
]

function Faq() {
  return (
    <section id="preguntas-servicios" aria-labelledby="faq-titulo" className="py-20 md:py-24">
      <div className="wrap grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <div>
          <Eyebrow>Preguntas frecuentes</Eyebrow>
          <h2 id="faq-titulo" className="display mt-4 text-[clamp(2rem,4vw,3.25rem)] text-night">Todo claro desde el principio.</h2>
          <p className="mt-4 text-[1.04rem] leading-relaxed text-ink-soft">Información para comparar, decidir y contratar con tranquilidad.</p>
        </div>
        <div className="space-y-3">
          {faqs.map((f) => (
            <details key={f.q} className="legal-faq group rounded-2xl bg-paper px-5 py-4 ring-1 ring-night/10 open:ring-violet/30 md:px-6">
              <summary className="flex cursor-pointer list-none items-start justify-between gap-4 font-display text-[1.04rem] font-bold text-night">
                {f.q}<span className="grid size-7 shrink-0 place-items-center rounded-full bg-violet/10 text-violet-ink transition-transform duration-300 group-open:rotate-45"><Icon name="plus" size={16} /></span>
              </summary>
              <p className="mt-3 leading-relaxed text-ink-soft">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}

function FinalBand() {
  return (
    <section aria-labelledby="final-titulo" className="on-dark relative overflow-hidden bg-night py-16 text-porcelain md:py-20">
      <div className="pointer-events-none absolute -right-32 -top-32 size-[30rem] rounded-full bg-[radial-gradient(closest-side,rgba(197,42,241,.3),transparent)]" aria-hidden="true" />
      <div className="wrap relative flex flex-col items-start justify-between gap-8 md:flex-row md:items-center">
        <div>
          <h2 id="final-titulo" className="display text-[clamp(1.9rem,3.6vw,2.9rem)]">Tu siguiente etapa digital <span className="text-lime">empieza aquí.</span></h2>
          <p className="mt-3 text-mist">Ventas: <a href={`mailto:${site.email.sales}`} className="underline decoration-lime/60 underline-offset-4 hover:text-lime">{site.email.sales}</a> · Soporte técnico: <a href={`mailto:${site.email.support}`} className="underline decoration-lime/60 underline-offset-4 hover:text-lime">{site.email.support}</a></p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button href={quote('servicios adicionales')} variant="lime" size="lg" icon="arrowUpRight">Solicitar cotización</Button>
          <Button href={whatsappLink('Hola, quiero cotizar un servicio adicional de TiendIA Exprés.')} variant="outline-light" size="lg" lead="whatsapp" external>WhatsApp</Button>
        </div>
      </div>
    </section>
  )
}

export function ServicesPage() {
  const [active, setActive] = useState<CategoryKey | 'todos'>('todos')
  return (
    <LegalLayout page="servicios">
      <Hero />
      <nav aria-label="Secciones de la página" className="legal-subnav z-40 lg:sticky border-b border-night/10 bg-paper/90 backdrop-blur lg:top-[4.5rem]">
        <ul className="wrap flex gap-1 overflow-x-auto py-2.5 text-[0.9rem] font-semibold">
          {[['paquetes', 'Paquetes'], ['catalogo', 'Todos los servicios'], ['dominios', 'Dominios'], ['proceso', 'Cómo contratar'], ['preguntas-servicios', 'Preguntas']].map(([id, label]) => (
            <li key={id}><a href={`#${id}`} className="block whitespace-nowrap rounded-full px-3.5 py-2 text-ink-soft transition-colors hover:bg-night/6 hover:text-night">{label}</a></li>
          ))}
        </ul>
      </nav>
      <Areas onPick={setActive} />
      <Packages />
      <Catalog active={active} setActive={setActive} />
      <Domains />
      <Process />
      <Faq />
      <FinalBand />
    </LegalLayout>
  )
}
