import { site, whatsappLink } from '../config/site'
import { cop } from '../content/plans'
import { Icon, type IconName } from '../components/ui/Icon'
import { Button } from '../components/ui/primitives'
import { LegalHero, LegalLayout, MetaChip } from './LegalLayout'
import { beforeBuying, faqs, groups, seoPlans, statusLabel, type PriceStatus, type Service } from './services'

const quote = (subject: string) => `mailto:${site.email.sales}?subject=${encodeURIComponent(`Cotización: ${subject}`)}`

const STATUS_STYLE: Record<PriceStatus, string> = {
  confirmado: 'bg-lime/50 text-night ring-night/15',
  propuesto: 'bg-[#fff4d6] text-[#6b4a00] ring-[#c99a1a]/40',
  incluido: 'bg-[#e3f8f9] text-[#0a5a5f] ring-[#0a7a80]/30',
  cotizacion: 'bg-night/6 text-ink-soft ring-night/15',
  tercero: 'bg-night/6 text-ink-soft ring-night/15',
  'no-disponible': 'bg-night/6 text-ink-soft ring-night/20',
}

export function Status({ status }: { status: PriceStatus }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[0.72rem] font-semibold leading-none ring-1 ring-inset ${STATUS_STYLE[status]}`}>
      <span className="size-1.5 rounded-full bg-current opacity-70" aria-hidden="true" />
      {statusLabel[status]}
    </span>
  )
}

const priceOf = (s: Service) => (s.price !== undefined ? cop(s.price) : s.priceText ?? '')

function Section({ id, eyebrow, title, intro, children, tone = 'light' }: { id: string; eyebrow: string; title: string; intro?: string; children: React.ReactNode; tone?: 'light' | 'white' }) {
  return (
    <section id={id} aria-labelledby={`${id}-titulo`} className={`legal-section py-16 md:py-20 ${tone === 'white' ? 'bg-paper' : ''}`}>
      <div className="wrap">
        <header className="max-w-3xl">
          <p className="eyebrow flex items-center gap-2.5 text-violet-ink"><span className="h-px w-6 bg-violet-ink/60" aria-hidden="true" />{eyebrow}</p>
          <h2 id={`${id}-titulo`} className="display mt-4 text-[clamp(1.75rem,3.2vw,2.6rem)] text-night">{title}</h2>
          {intro ? <p className="mt-4 text-[1.06rem] leading-relaxed text-ink-soft md:text-[1.12rem]">{intro}</p> : null}
        </header>
        <div className="mt-10">{children}</div>
      </div>
    </section>
  )
}

const domainFacts: { icon: IconName; title: string; body: string }[] = [
  { icon: 'globe', title: 'Registro inicial', body: 'Verificamos que el nombre esté libre y lo registramos por el periodo contratado. Pedir o pagar una cotización no reserva el nombre: la disponibilidad se confirma al registrarlo.' },
  { icon: 'tag', title: 'Estándar o premium', body: 'Un dominio estándar elegible es un nombre libre en una extensión común. Los dominios premium, revendidos o con extensiones especiales tienen precio propio del registrador y se cotizan aparte.' },
  { icon: 'shield', title: 'Queda a tu nombre', body: 'El dominio se registra a nombre tuyo o de tu empresa, con tus datos. Hacemos la gestión técnica sin quedarnos con la titularidad y te entregamos constancia del registro y del vencimiento.' },
  { icon: 'link', title: 'Configuración DNS', body: 'Hacemos la conexión DNS necesaria para que tu dominio abra tu tienda y habilitamos el HTTPS estándar cuando la infraestructura lo permite.' },
  { icon: 'clock', title: 'Avisos antes del vencimiento', body: 'Procuramos avisarte por correo 30, 15 y 7 días antes de que venza. Estos avisos se suman a los que envía el registrador; mantén tus datos al día.' },
  { icon: 'ticket', title: 'Si no se renueva', body: 'El registrador puede suspender el dominio y tu tienda dejaría de abrir con esa dirección. Recuperarlo después puede tener costos extra, y si otra persona lo registra no podemos garantizar recuperarlo.' },
  { icon: 'send', title: 'Transferencia', body: 'Puedes llevar tu dominio a otro proveedor cuando quieras: no cobramos penalización. El registrador de destino puede cobrar su propia tarifa. Cancelar tu plan no nos transfiere tu dominio.' },
  { icon: 'box', title: 'Lo que no incluye', body: 'El dominio no incluye SEO profesional, publicidad pagada, correo corporativo ni desarrollo web a medida. Cada uno se contrata aparte, con cotización.' },
]

export function ServicesPage() {
  const renewal = groups[0].items[1]
  return (
    <LegalLayout page="servicios">
      <LegalHero
        eyebrow="Complementos opcionales"
        title="Servicios adicionales"
        intro={<p>Dominio propio, SEO, carga asistida de productos, diseño y más. Son opcionales: tu plan funciona sin ellos y ninguno se cobra sin una cotización escrita que aceptes.</p>}
        meta={
          <>
            <MetaChip>Precios en pesos colombianos (COP)</MetaChip>
            <MetaChip>Según los Términos v{site.terms.version}</MetaChip>
            <MetaChip>Sin cobros automáticos</MetaChip>
          </>
        }
        actions={
          <>
            <Button href={quote('servicios adicionales')} variant="lime" size="sm" icon="arrowRight">Pedir una cotización</Button>
            <Button href="/terminos-y-condiciones" variant="outline-light" size="sm">Leer los términos</Button>
          </>
        }
      />

      <nav aria-label="Secciones de la página" className="legal-subnav border-b border-night/10 bg-paper">
        <ul className="wrap flex gap-1 overflow-x-auto py-3 text-[0.9rem] font-semibold">
          {[['dominios', 'Dominios'], ['seo', 'SEO'], ['tarifario', 'Tarifario'], ['antes-de-contratar', 'Antes de contratar'], ['preguntas-servicios', 'Preguntas']].map(([id, label]) => (
            <li key={id}><a href={`#${id}`} className="block whitespace-nowrap rounded-full px-3.5 py-2 text-ink-soft transition-colors hover:bg-night/6 hover:text-night">{label}</a></li>
          ))}
        </ul>
      </nav>

      <div className="wrap pt-10">
        <div className="legal-notice flex gap-3 rounded-2xl bg-[#fff8e6] p-5 text-[0.98rem] leading-relaxed text-[#4d3600] ring-1 ring-inset ring-[#c99a1a]/35">
          <Icon name="clock" size={20} className="mt-0.5 shrink-0" />
          <p>
            <strong className="font-semibold">Sobre los precios.</strong> Solo la renovación anual del dominio estándar ({cop(renewal.price!)}) es un precio confirmado. Los demás valores marcados como <em>Propuesto · sujeto a aprobación</em> son una propuesta comercial: el precio definitivo, con impuestos, te llega en la cotización antes de pagar.
          </p>
        </div>
      </div>

      <Section id="dominios" eyebrow="Dominio propio" title="Tu tienda con tu propia dirección" intro="Puedes seguir con la dirección incluida en tu plan, registrar un dominio nuevo con nosotros o conectar uno que ya tengas.">
        <div className="grid gap-4 md:grid-cols-3">
          {[
            { k: 'A', t: 'Dirección incluida', b: `Tu tienda en ${site.appUrl.replace(/^https?:\/\//, '')}/t/tu-negocio. Viene con todos los planes, sin cobro adicional.`, s: 'incluido' as const },
            { k: 'B', t: 'Dominio nuevo con nosotros', b: 'Gestionamos el registro de tunegocio.com (u otra extensión elegible) ante un registrador y lo conectamos a tu tienda.', s: 'propuesto' as const, p: `${cop(120_000)} el primer año` },
            { k: 'C', t: 'Un dominio que ya tienes', b: 'Si ya compraste tu dominio en otro lado, hacemos la vinculación técnica con tu tienda.', s: 'propuesto' as const, p: `${cop(49_000)} pago único` },
          ].map((o) => (
            <article key={o.k} className="legal-card flex flex-col rounded-3xl bg-paper p-6 ring-1 ring-night/10">
              <span className="grid size-10 place-items-center rounded-xl bg-night font-display text-[1.05rem] font-extrabold text-lime">{o.k}</span>
              <h3 className="mt-4 font-display text-[1.2rem] font-bold text-night">{o.t}</h3>
              <p className="mt-2 flex-1 text-[0.98rem] leading-relaxed text-ink-soft">{o.b}</p>
              <div className="mt-5 flex flex-wrap items-center gap-2">{o.p ? <span className="font-display font-bold text-night">{o.p}</span> : null}<Status status={o.s} /></div>
            </article>
          ))}
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="rounded-3xl bg-night p-7 text-porcelain on-dark md:p-8">
            <p className="eyebrow text-cyan">Renovación anual</p>
            <p className="mt-3 font-display text-[clamp(2rem,5vw,2.75rem)] font-extrabold tracking-tight">{cop(120_000)} <span className="text-[1rem] font-semibold text-mist">por año</span></p>
            <p className="mt-2"><Status status="confirmado" /></p>
            <p className="mt-4 max-w-xl leading-relaxed text-mist">Precio de renovación de un dominio estándar elegible gestionado por TiendIA Exprés. Es independiente de la mensualidad de tu plan. No incluye recuperación después del vencimiento, redención, restauración, dominios premium ni cargos extraordinarios del registrador: esos se informan y aceptan antes de pagar.</p>
          </div>
          <div className="rounded-3xl bg-paper p-7 ring-1 ring-night/10">
            <p className="eyebrow text-violet-ink">¿Qué plan incluye dominio?</p>
            <p className="mt-3 font-display text-[1.15rem] font-bold text-night">Hoy, ninguno.</p>
            <p className="mt-2 text-[0.98rem] leading-relaxed text-ink-soft">Emprendedor, Negocio y Mayorista incluyen la dirección en app.tiendiaexpres.com sin costo. Si algún plan llega a incluir dominio, su ficha dirá si cubre solo el registro inicial o también las renovaciones.</p>
          </div>
        </div>

        <ul className="mt-10 grid gap-x-8 gap-y-7 sm:grid-cols-2 lg:grid-cols-4">
          {domainFacts.map((f) => (
            <li key={f.title}>
              <span className="grid size-10 place-items-center rounded-xl bg-violet/10 text-violet-ink"><Icon name={f.icon} size={20} /></span>
              <h3 className="mt-3 font-display text-[1.04rem] font-bold text-night">{f.title}</h3>
              <p className="mt-1.5 text-[0.95rem] leading-relaxed text-ink-soft">{f.body}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="seo" tone="white" eyebrow="Posicionamiento en buscadores" title="SEO para que Google entienda tu tienda" intro="Servicios opcionales que no vienen incluidos en los planes. Tu tienda ya tiene una base técnica de indexación; estos servicios suman trabajo individual sobre tu catálogo.">
        <div className="grid gap-5 lg:grid-cols-3">
          {seoPlans.map((p, i) => (
            <article key={p.key} className={`legal-card relative flex flex-col rounded-3xl p-6 md:p-7 ${i === 1 ? 'bg-night text-porcelain on-dark shadow-[0_30px_60px_-30px_rgba(11,11,19,.6)]' : 'bg-porcelain ring-1 ring-night/10'}`}>
              <h3 className={`font-display text-[1.25rem] font-bold leading-tight ${i === 1 ? 'text-porcelain' : 'text-night'}`}>{p.name}</h3>
              <p className={`mt-2 text-[0.96rem] ${i === 1 ? 'text-mist' : 'text-ink-soft'}`}>{p.summary}</p>
              <p className="mt-5 font-display text-[2rem] font-extrabold tracking-tight">{cop(p.price)}</p>
              <p className={`text-[0.9rem] font-semibold ${i === 1 ? 'text-mist' : 'text-ink-soft'}`}>{p.period === 'Mensual' ? 'Al mes, aparte de tu plan' : 'Pago único por tienda'}</p>
              <p className="mt-3"><Status status={p.status} /></p>
              <ul className="mt-6 flex-1 space-y-2.5 text-[0.95rem]">
                {p.deliverables.map((d) => (
                  <li key={d} className="flex gap-2.5"><Icon name="check" size={18} className={`mt-0.5 shrink-0 ${i === 1 ? 'text-lime' : 'text-violet-ink'}`} /><span>{d}</span></li>
                ))}
              </ul>
              <p className={`mt-6 border-t pt-4 text-[0.88rem] leading-relaxed ${i === 1 ? 'border-white/10 text-mist' : 'border-night/10 text-ink-soft'}`}><strong className="font-semibold">Ideal para:</strong> {p.best}</p>
              <p className={`mt-2 text-[0.88rem] leading-relaxed ${i === 1 ? 'text-mist' : 'text-ink-soft'}`}><strong className="font-semibold">Límites:</strong> {p.excludes}</p>
              <Button href={quote(p.name)} variant={i === 1 ? 'lime' : 'night'} size="md" className="mt-6 w-full">Pedir cotización</Button>
            </article>
          ))}
        </div>
        <div className="mt-6 flex gap-3 rounded-2xl bg-porcelain p-5 text-[0.98rem] leading-relaxed text-night ring-1 ring-night/10">
          <Icon name="shield" size={20} className="mt-0.5 shrink-0 text-violet-ink" />
          <p><strong className="font-semibold">Sin promesas imposibles.</strong> Ningún servicio SEO garantiza aparecer en Google, alcanzar una posición, recibir cierta cantidad de visitas ni aumentar las ventas: eso depende de los buscadores, la competencia y el contenido. Lo que entregamos es el trabajo descrito, con un informe.</p>
        </div>
      </Section>

      <Section id="tarifario" eyebrow="Tarifario complementario" title="Todos los servicios adicionales" intro="Precio, periodicidad y estado de cada servicio. Los impuestos aplicables y el total a pagar se informan en la cotización, antes del pago.">
        <div className="space-y-12">
          {groups.map((g) => (
            <div key={g.id} id={g.id}>
              <h3 className="font-display text-[1.3rem] font-bold text-night">{g.title}</h3>
              {g.intro ? <p className="mt-2 max-w-3xl text-[0.98rem] leading-relaxed text-ink-soft">{g.intro}</p> : null}
              <div className="price-table mt-5 overflow-hidden rounded-2xl bg-paper ring-1 ring-night/10">
                <table className="w-full text-left text-[0.96rem]">
                  <caption className="sr-only">{g.title}: servicio, precio, periodicidad y estado</caption>
                  <thead className="bg-night/[0.03] text-[0.78rem] uppercase tracking-[0.1em] text-ink-soft">
                    <tr><th scope="col" className="px-5 py-3 font-semibold">Servicio</th><th scope="col" className="px-5 py-3 font-semibold">Precio</th><th scope="col" className="px-5 py-3 font-semibold">Periodicidad</th><th scope="col" className="px-5 py-3 font-semibold">Estado</th></tr>
                  </thead>
                  <tbody className="divide-y divide-night/8">
                    {g.items.map((s) => (
                      <tr key={s.name}>
                        <th scope="row" data-label="Servicio" className="px-5 py-4 font-semibold text-night">{s.name}{s.note ? <span className="mt-1 block text-[0.85rem] font-normal text-ink-soft">{s.note}</span> : null}</th>
                        <td data-label="Precio" className="px-5 py-4 font-display font-bold text-night">{priceOf(s)}</td>
                        <td data-label="Periodicidad" className="px-5 py-4 text-ink-soft">{s.period}</td>
                        <td data-label="Estado" className="px-5 py-4"><Status status={s.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {g.footnote ? <p className="mt-3 max-w-3xl text-[0.9rem] leading-relaxed text-ink-soft">{g.footnote}</p> : null}
            </div>
          ))}
        </div>
      </Section>

      <Section id="antes-de-contratar" tone="white" eyebrow="Controles comerciales" title="Antes de pagar cualquier servicio, recibes esto por escrito" intro="Ningún trabajo opcional con cobro se hace sin cotización y aceptación previa. Los servicios de pago único no se convierten en suscripciones y no hay cobros automáticos.">
        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {beforeBuying.map((b, i) => (
            <li key={b.title} className="rounded-2xl bg-porcelain p-5 ring-1 ring-night/10">
              <span className="font-display text-[0.85rem] font-extrabold text-violet-ink">{String(i + 1).padStart(2, '0')}</span>
              <h3 className="mt-2 font-display text-[1.05rem] font-bold text-night">{b.title}</h3>
              <p className="mt-1 text-[0.94rem] leading-relaxed text-ink-soft">{b.body}</p>
            </li>
          ))}
          <li className="flex flex-col justify-between rounded-2xl bg-night p-5 text-porcelain on-dark">
            <p className="font-display text-[1.05rem] font-bold">¿Listo para cotizar?</p>
            <p className="mt-1 text-[0.94rem] text-mist">Te respondemos desde {site.email.sales}.</p>
            <Button href={quote('servicios adicionales')} variant="lime" size="sm" icon="arrowRight" className="mt-4 self-start">Escribir a ventas</Button>
          </li>
        </ol>
      </Section>

      <Section id="preguntas-servicios" eyebrow="Preguntas frecuentes" title="Lo que más nos preguntan">
        <div className="max-w-3xl divide-y divide-night/10 rounded-3xl bg-paper px-6 ring-1 ring-night/10 md:px-8">
          {faqs.map((f) => (
            <details key={f.q} className="legal-faq group py-5">
              <summary className="flex cursor-pointer list-none items-start justify-between gap-4 font-display text-[1.06rem] font-bold text-night">
                {f.q}<Icon name="plus" size={20} className="mt-0.5 shrink-0 text-violet-ink transition-transform duration-300 group-open:rotate-45" />
              </summary>
              <p className="mt-3 leading-relaxed text-ink-soft">{f.a}</p>
            </details>
          ))}
        </div>

        <div className="mt-12 flex flex-col items-start justify-between gap-6 rounded-3xl bg-night p-7 text-porcelain on-dark md:flex-row md:items-center md:p-9">
          <div>
            <p className="display text-[1.6rem]">¿Necesitas ayuda para elegir?</p>
            <p className="mt-2 text-mist">Ventas: <a href={`mailto:${site.email.sales}`} className="underline decoration-lime/60 underline-offset-4 hover:text-lime">{site.email.sales}</a> · Soporte: <a href={`mailto:${site.email.support}`} className="underline decoration-lime/60 underline-offset-4 hover:text-lime">{site.email.support}</a></p>
          </div>
          <Button href={whatsappLink('Hola, quiero cotizar un servicio adicional de TiendIA Exprés.')} variant="lime" size="md" lead="whatsapp" external>Escribir por WhatsApp</Button>
        </div>
      </Section>
    </LegalLayout>
  )
}
