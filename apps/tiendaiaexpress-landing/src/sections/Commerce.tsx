// Plans with the monthly/annual switch, the feature comparator, what the initial payment
// includes, add-ons, commercial conditions and FAQ. Prices and plan data: src/content/plans.ts
// (single source; this file never states a price of its own).
import { useState, type CSSProperties, type JSX } from 'react'
import { faq } from '../content/copy'
import { addOns, annualSaving, cop, firstYearMonthly, planMessage, plans, type Billing, type Plan } from '../content/plans'
import { whatsappLink } from '../config/site'
import { Badge, Button, SectionHeading } from '../components/ui/primitives'
import { Icon } from '../components/ui/Icon'
import { Mascot, Sparks } from '../components/brand/Decor'

export const PLAN_EVENT = 'mp:plan'
export type PlanChoice = { plan: string; billing: Billing }
const i = (n: number) => ({ '--i': n }) as CSSProperties

function BillingSwitch({ value, onChange }: { value: Billing; onChange: (b: Billing) => void }) {
  const options: { key: Billing; label: string }[] = [
    { key: 'mensual', label: 'Pago mensual' },
    { key: 'anual', label: 'Pago anual' },
  ]
  return (
    <fieldset className="mt-10">
      <legend className="sr-only">Modalidad de pago</legend>
      <div className="relative inline-grid grid-cols-2 rounded-full bg-white/6 p-1.5 ring-1 ring-inset ring-white/12">
        <span className={`absolute inset-y-1.5 left-1.5 w-[calc(50%-0.375rem)] rounded-full bg-lime shadow-[0_0_30px_-4px_rgba(217,255,20,.6)] transition-transform duration-500 ease-[var(--ease-out-expo)] ${value === 'anual' ? 'translate-x-full' : ''}`} aria-hidden="true" />
        {options.map((o) => (
          <label key={o.key} className={`relative z-10 cursor-pointer rounded-full px-5 py-3 text-center font-display text-[0.95rem] font-bold tracking-tight transition-colors duration-300 has-[:focus-visible]:outline has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-lime md:px-8 ${value === o.key ? 'text-night' : 'text-porcelain hover:text-lime'}`}>
            <input type="radio" name="modalidad" value={o.key} checked={value === o.key} onChange={() => onChange(o.key)} className="sr-only" />
            {o.label}
          </label>
        ))}
        <span className="absolute -right-3 -top-3 rotate-6 rounded-full bg-violet-deep px-2.5 py-1 font-display text-[0.7rem] font-extrabold text-white shadow-[0_8px_20px_-6px_rgba(197,42,241,.9)]" aria-hidden="true">Sin pago inicial</span>
      </div>
      <p className="mt-3 text-[0.9rem] text-mist">Con pago anual no hay pago inicial.</p>
    </fieldset>
  )
}

function PlanPrice({ plan, billing }: { plan: Plan; billing: Billing }) {
  const annual = billing === 'anual'
  return (
    <div className="mt-6">
      <p key={billing} className="price-swap flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className={`display whitespace-nowrap text-[clamp(2.3rem,3.1vw,2.95rem)] italic leading-none ${plan.highlight ? 'text-lime' : 'text-porcelain'}`}>{cop(annual ? plan.annual : plan.monthly).replace(' COP', '')}</span>
        <span className="font-display text-[1rem] font-bold text-mist">COP/{annual ? 'año' : 'mes'}</span>
      </p>
      {annual ? (
        <ul className="mt-4 space-y-1.5 text-[0.93rem] text-mist">
          <li>12 meses de servicio, sin pago inicial adicional.</li>
          <li><span className="inline-flex rounded-lg bg-lime/12 px-2 py-0.5 font-semibold text-lime">Ahorras {cop(annualSaving(plan))}</span> frente al primer año con pago mensual ({cop(firstYearMonthly(plan))}).</li>
          <li>O con pago mensual: {cop(plan.monthly)} al mes + pago inicial.</li>
        </ul>
      ) : (
        <ul className="mt-4 space-y-1.5 text-[0.93rem] text-mist">
          <li><span className="font-semibold text-porcelain">Pago inicial: {cop(plan.setup)}</span>, una sola vez, con la primera mensualidad.</li>
          <li>Total del primer año: {cop(firstYearMonthly(plan))}.</li>
          <li>O con pago anual: {cop(plan.annual)}, sin pago inicial.</li>
        </ul>
      )}
    </div>
  )
}

type Cell = string | boolean
const [emprendedor, negocio, mayorista] = plans
/** Feature comparator. Every row mirrors src/content/plans.ts; "soon" rows are not available yet. */
const COMPARE: { group: string; rows: { label: string; cells: [Cell, Cell, Cell]; soon?: boolean }[] }[] = [
  {
    group: 'Precio',
    rows: [
      { label: 'Mensualidad', cells: [cop(emprendedor.monthly), cop(negocio.monthly), cop(mayorista.monthly)] },
      { label: 'Pago inicial (una vez, con pago mensual)', cells: [cop(emprendedor.setup), cop(negocio.setup), cop(mayorista.setup)] },
      { label: 'Anualidad (sin pago inicial)', cells: [cop(emprendedor.annual), cop(negocio.annual), cop(mayorista.annual)] },
      { label: 'Comisión por venta', cells: ['No', 'No', 'No'] },
    ],
  },
  {
    group: 'Tu tienda',
    rows: [
      { label: 'Productos', cells: [emprendedor.products, negocio.products, mayorista.products] },
      { label: 'Tienda con plantilla y dirección propia', cells: [true, true, true] },
      { label: 'Carrito y pedidos por WhatsApp', cells: [true, true, true] },
      { label: 'Tallas, variantes y categorías', cells: [true, true, true] },
      { label: 'Panel web de administración', cells: [true, true, true] },
      { label: 'Pedidos con estados, transportadora y guía', cells: [false, true, true] },
      { label: 'Varios administradores con roles', cells: [false, false, true] },
      { label: 'Soporte prioritario', cells: [false, false, true] },
    ],
  },
  {
    group: 'Asistente e inteligencia artificial',
    rows: [
      { label: 'Asistente en Telegram', cells: ['Hasta 500 mensajes IA al mes', 'Uso ampliado', 'Uso ampliado'] },
      { label: 'Guías de envío desde Telegram', cells: [false, true, true] },
      { label: 'Mejoras de fotografía con IA al mes', cells: ['50', '150', '400'] },
      { label: 'Descripciones con IA', cells: ['200 al mes', 'Uso razonable', 'Uso razonable'] },
      { label: 'Estudio Creativo (imágenes, carruseles y videos cortos)', cells: [true, true, true] },
    ],
  },
  {
    group: 'En camino',
    rows: [
      { label: 'Reportes comerciales', cells: [false, true, true], soon: true },
      { label: 'Precios al por mayor', cells: [false, false, true], soon: true },
    ],
  },
]

function CompareCell({ value, soon, plan }: { value: Cell; soon?: boolean; plan: string }) {
  if (value === true) return soon ? <span className="text-[0.82rem] font-semibold text-mist">Próximamente</span> : <><span className="mx-auto grid size-6 place-items-center rounded-full bg-lime text-night"><Icon name="check" size={13} /></span><span className="sr-only">Incluido en {plan}</span></>
  if (value === false) return <><span aria-hidden="true" className="text-white/25">—</span><span className="sr-only">No incluido en {plan}</span></>
  return <span className="font-semibold">{value}</span>
}

/** Small illustration per plan. Decorative. */
const PLAN_ART: Record<Plan['key'], JSX.Element> = {
  emprendedor: <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-white/8 text-cyan ring-1 ring-inset ring-cyan/30" aria-hidden="true"><Icon name="store" size={24} /></span>,
  negocio: <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-violet-deep text-white shadow-[0_0_24px_rgba(197,42,241,.7)]" aria-hidden="true"><Icon name="sparkle" size={24} /></span>,
  mayorista: <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-lime text-night shadow-[0_0_24px_-4px_rgba(217,255,20,.6)]" aria-hidden="true"><Icon name="chart" size={24} /></span>,
}

export function Plans() {
  const [billing, setBilling] = useState<Billing>('mensual')
  const choose = (detail: PlanChoice) => window.dispatchEvent(new CustomEvent(PLAN_EVENT, { detail }))
  return (
    <section id="planes" aria-labelledby="planes-title" className="on-dark relative overflow-hidden bg-night py-24 text-porcelain md:py-32">
      <div className="grid-fade pointer-events-none absolute inset-0" aria-hidden="true" />
      <div className="pointer-events-none absolute left-1/2 top-[22rem] h-[40rem] w-[70rem] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(197,42,241,.3),transparent)]" aria-hidden="true" />
      <div className="pointer-events-none absolute -left-40 top-0 size-[34rem] rounded-full bg-[radial-gradient(closest-side,rgba(18,220,231,.14),transparent)]" aria-hidden="true" />
      <div className="wrap relative">
        <div data-reveal>
          <SectionHeading id="planes-title" onDark align="center" eyebrow="Planes" title={<>Un plan para cada <span className="accent accent-gradient">etapa de tu negocio.</span><Sparks className="ml-1 hidden align-top md:inline-block" color="var(--color-cyan)" /></>} intro="Comienza con lo esencial y crece con herramientas para administrar y promocionar tu tienda. Sin comisión por tus ventas." />
        </div>
        <div className="flex justify-center text-center"><BillingSwitch value={billing} onChange={setBilling} /></div>
        <p className="sr-only" aria-live="polite">{billing === 'anual' ? 'Mostrando precios con pago anual.' : 'Mostrando precios con pago mensual.'}</p>

        <ul className="mt-16 grid gap-8 lg:grid-cols-3 lg:items-stretch lg:gap-5">
          {plans.map((plan, n) => {
            const featured = plan.highlight
            const label = 'font-display text-[0.76rem] font-bold uppercase tracking-[0.14em] text-cyan'
            const body = (
              <article data-tilt="0.5" aria-labelledby={`plan-${plan.key}`} className={`relative flex h-full w-full flex-col rounded-[1.75rem] p-7 md:p-8 ${featured ? 'bg-[linear-gradient(170deg,#2b0b45,#120e22_45%,#0b0b13)]' : 'glass-dark'}`}>
                {featured ? (
                  <>
                    <span className="absolute -top-4 left-7 inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-lime px-4 py-1.5 font-display text-[0.82rem] font-extrabold text-night shadow-[0_10px_24px_-8px_rgba(217,255,20,.8)]"><Icon name="sparkle" size={15} />Más recomendado</span>
                    <Mascot width={96} className="float pointer-events-none absolute -right-1 -top-14 lg:-right-3 drop-shadow-[0_18px_24px_rgba(0,0,0,.6)]" />
                  </>
                ) : null}
                <div className="flex items-center gap-3.5">
                  {PLAN_ART[plan.key]}
                  <h3 id={`plan-${plan.key}`} className="display text-[1.7rem] italic">{plan.name}</h3>
                </div>
                <p className="mt-3 min-h-[3.2rem] text-[1rem] leading-snug text-mist">{plan.audience}</p>
                <PlanPrice plan={plan} billing={billing} />
                <div className="mt-7 grid gap-2.5">
                  <Button href={whatsappLink(planMessage(plan, billing))} variant={featured ? 'lime' : 'porcelain'} icon="whatsapp" external aria-label={`Quiero el plan ${plan.name} con ${billing === 'anual' ? 'pago anual' : 'pago mensual'}, por WhatsApp (se abre en una pestaña nueva)`}>Quiero este plan</Button>
                  <Button href="#contacto" variant="outline-light" onClick={() => choose({ plan: plan.name, billing })}>Solicitar con el formulario</Button>
                </div>
                <p className={`mt-7 flex items-center gap-2.5 rounded-xl px-4 py-3 font-display font-bold ring-1 ring-inset ${featured ? 'bg-violet/15 ring-violet/40' : 'bg-white/5 ring-white/10'}`}><Icon name="box" size={20} className={featured ? 'text-violet-soft' : 'text-cyan'} />{plan.products}</p>
                <h4 className={`mt-7 ${label}`}>Incluye</h4>
                <ul className="mt-3 space-y-2.5 text-[0.97rem]">
                  {plan.features.map((item) => <li key={item} className="flex gap-3"><span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-lime text-night"><Icon name="check" size={12} /></span>{item}</li>)}
                </ul>
                <h4 className={`mt-7 ${label}`}>Inteligencia artificial</h4>
                <ul className="mt-3 space-y-2.5 text-[0.97rem]">
                  {plan.ai.map((item) => <li key={item} className="flex gap-3"><Icon name="sparkle" size={19} className="mt-0.5 shrink-0 text-violet-soft" />{item}</li>)}
                </ul>
                {plan.soon.length ? (
                  <div className="mt-7">
                    <div className="flex flex-wrap items-center gap-2"><h4 className={label}>En camino</h4><Badge kind="soon" onDark /></div>
                    <ul className="mt-3 space-y-1.5 text-[0.93rem] text-mist">
                      {plan.soon.map((item) => <li key={item} className="flex gap-3"><Icon name="clock" size={18} className="mt-0.5 shrink-0 opacity-70" />{item}</li>)}
                    </ul>
                  </div>
                ) : null}
              </article>
            )
            return (
              <li key={plan.key} className={`flex ${featured ? 'lg:-my-5' : ''}`} data-reveal style={i(n)}>
                {featured ? <div className="neon-border flex w-full rounded-[1.85rem] p-[2px] shadow-[0_60px_120px_-50px_rgba(197,42,241,.9)]">{body}</div> : body}
              </li>
            )
          })}
        </ul>

        <div className="mt-14 grid gap-3 text-[0.9rem] text-mist md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
          <p className="max-w-3xl">Precios en pesos colombianos (COP). Con pago mensual, el pago inicial se cobra una sola vez junto con la primera mensualidad; el pago anual incluye 12 meses de servicio y no cobra pago inicial adicional. Antes de cualquier pago te confirmamos por escrito el valor final, incluidos los impuestos que apliquen. No procesamos pagos en esta página.</p>
          <a href="#condiciones" className="inline-flex items-center gap-1.5 font-bold text-porcelain underline decoration-lime decoration-[3px] underline-offset-4 hover:text-lime">Ver condiciones comerciales <Icon name="arrowDown" size={16} /></a>
        </div>

        <div className="mt-20" data-reveal>
          <h3 id="comparador-title" className="display text-[clamp(1.6rem,2.6vw,2.1rem)]">Compara los planes</h3>
          <div className="relative mt-6 overflow-x-auto rounded-2xl bg-night-raised/60 ring-1 ring-inset ring-white/10" tabIndex={0} role="region" aria-labelledby="comparador-title">
            <table className="w-full min-w-[44rem] border-collapse text-left text-[0.93rem]">
              <thead>
                <tr className="border-b border-white/10">
                  <th scope="col" className="w-[34%] px-5 py-4 font-display font-bold text-mist">Función</th>
                  {plans.map((plan) => <th key={plan.key} scope="col" className={`px-4 py-4 text-center font-display text-[1.05rem] font-extrabold ${plan.highlight ? 'bg-violet/20 text-lime shadow-[inset_0_3px_0_#c52af1]' : ''}`}>{plan.name}</th>)}
                </tr>
              </thead>
              {COMPARE.map((group) => (
                <tbody key={group.group}>
                  <tr><th scope="colgroup" colSpan={4} className="bg-white/4 px-5 py-2.5 font-display text-[0.74rem] font-bold uppercase tracking-[0.14em] text-cyan">{group.group}</th></tr>
                  {group.rows.map((row) => (
                    <tr key={row.label} className="border-t border-white/8 transition-colors hover:bg-white/4">
                      <th scope="row" className="px-5 py-3.5 font-medium">{row.label}</th>
                      {row.cells.map((cell, n) => <td key={n} className={`px-4 py-3.5 text-center ${plans[n].highlight ? 'bg-violet/12' : ''}`}><CompareCell value={cell} soon={row.soon} plan={plans[n].name} /></td>)}
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
          <p className="mt-3 text-[0.82rem] text-mist">Las cuotas de IA son mensuales. Si se agotan, tu tienda sigue funcionando y puedes pedir créditos adicionales.</p>
        </div>
      </div>
    </section>
  )
}

const SETUP = [
  { title: 'Configuración visual', body: 'Plantilla, colores y portada de tu tienda.' },
  { title: 'Identidad de marca', body: 'Tu logo y tu paleta aplicados en toda la tienda.' },
  { title: 'Carga inicial de productos', body: 'Subimos tus primeros productos contigo; la cantidad incluida se acuerda al contratar, según tu plan.' },
  { title: 'Categorías organizadas', body: 'Ordenamos tus productos para que tus clientes encuentren todo.' },
  { title: 'Pedidos por WhatsApp', body: 'Los pedidos llegan a tu número con productos, tallas y datos de entrega.' },
  { title: 'Asistente de Telegram', body: 'Vinculamos tu cuenta para administrar la tienda escribiendo.' },
  { title: 'Capacitación inicial', body: 'Te mostramos cómo manejar el panel y el asistente.' },
]

/** The assisted setup included in the initial payment, and the optional add-ons. */
export function Setup() {
  return (
    <section aria-labelledby="configuracion-title" className="bg-porcelain py-24 md:py-28">
      <div className="wrap grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-20">
        <div data-reveal>
          <SectionHeading id="configuracion-title" size="md" eyebrow="Puesta en marcha" title="Qué incluye el pago inicial." intro="Con el pago inicial armamos tu tienda contigo y te la entregamos lista para vender." />
          <p className="mt-6 max-w-xl text-[0.93rem] text-ink-soft">Es un servicio de puesta en marcha: no incluye la carga ilimitada de inventario ni el procesamiento manual permanente de productos. Después, tú cargas y editas desde el panel o desde Telegram.</p>
        </div>
        <ol className="grid gap-x-8 sm:grid-cols-2">
          {SETUP.map((s, n) => (
            <li key={s.title} className="flex gap-4 border-t border-night/12 py-5" data-reveal style={i(n % 2)}>
              <span className="font-display text-[0.9rem] font-extrabold text-violet-ink" aria-hidden="true">0{n + 1}</span>
              <div><h3 className="font-display text-[1.05rem] font-bold leading-snug">{s.title}</h3><p className="mt-1 text-[0.93rem] leading-snug text-ink-soft">{s.body}</p></div>
            </li>
          ))}
        </ol>
      </div>
      <div className="wrap mt-16">
        <h2 id="complementos-title" className="display text-[clamp(1.5rem,2.4vw,1.9rem)]">Complementos opcionales</h2>
        <ul aria-labelledby="complementos-title" className="mt-6 grid gap-4 md:grid-cols-3">
          {addOns.map((a) => (
            <li key={a.title} className="flex flex-col rounded-2xl bg-paper p-6 ring-1 ring-night/8">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-display text-[1.1rem] font-bold">{a.title}</h3>
                {a.status === 'pronto' ? <Badge kind="soon" /> : a.status === 'disponible' ? <Badge kind="live" /> : <Badge kind="live" label="Bajo consulta" />}
              </div>
              <p className="mt-2 flex-1 text-[0.95rem] text-ink-soft">{a.body}</p>
              {a.price ? <p className="mt-4 text-[0.9rem] font-semibold text-night">{a.price}</p> : null}
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

const CONDITIONS = [
  { title: 'Pagos mensuales', body: 'La mensualidad se paga por adelantado, al comenzar cada mes de servicio.' },
  { title: 'Pago inicial', body: 'Se paga una sola vez, junto con la primera mensualidad, y cubre la configuración inicial descrita en esta página.' },
  { title: 'Modalidad anual', body: 'Pagas 12 meses de servicio por adelantado y no se cobra pago inicial adicional.' },
  { title: 'Renovaciones', body: 'Te avisamos antes de cada renovación. No hacemos cobros automáticos: cada pago lo haces tú.' },
  { title: 'Cancelaciones', body: 'Puedes cancelar avisándonos por WhatsApp. Tu tienda sigue activa hasta el final del periodo pagado.' },
  { title: 'Falta de pago', body: 'Si un pago se atrasa, te avisamos antes de pausar la tienda. Al ponerte al día, vuelve a publicarse.' },
  { title: 'Tus datos', body: 'Tus productos, fotos y pedidos se conservan mientras la tienda está pausada. El plazo de conservación después de cancelar se informa en los términos al contratar.' },
  { title: 'Créditos de IA', body: 'Las cuotas de IA de tu plan son mensuales. Si se agotan, tu tienda sigue funcionando y puedes pedir créditos adicionales.' },
  { title: 'Dominio propio', body: 'Tipo de dominio, titularidad, renovación, transferencia y cancelación se acuerdan por escrito antes de configurarlo.' },
  { title: 'Fotos y productos', body: 'Tus fotos, productos y marca son tuyos, también las imágenes que mejores con IA a partir de ellas.' },
  { title: 'Sin comisión por venta', body: 'No cobramos comisión por tus ventas: el pedido te llega por WhatsApp y el pago lo acuerdas directamente con tu cliente.' },
  { title: 'Cambios de plan', body: 'Puedes cambiar de plan cuando lo necesites; antes del cambio te confirmamos el valor.' },
  { title: 'Cambios de precio', body: 'Si los precios cambian, te avisamos con anticipación. El periodo que ya pagaste no cambia de precio.' },
]

export function Conditions() {
  return (
    <section id="condiciones" aria-labelledby="condiciones-title" className="bg-paper py-24 md:py-28">
      <div className="wrap">
        <SectionHeading id="condiciones-title" size="md" eyebrow="Condiciones" title="Condiciones comerciales." intro="Lo esencial, en claro. Los términos completos te los entregamos por escrito al contratar." />
        <dl className="mt-12 grid gap-x-10 gap-y-6 md:grid-cols-2 xl:grid-cols-3">
          {CONDITIONS.map((c) => (
            <div key={c.title} className="border-t border-night/12 pt-4">
              <dt className="font-display font-bold">{c.title}</dt>
              <dd className="mt-1.5 text-[0.93rem] leading-relaxed text-ink-soft">{c.body}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  )
}

export function Faq() {
  return (
    <section id="preguntas" aria-labelledby="preguntas-title" className="wash py-24 md:py-32">
      <div className="wrap grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-20">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <SectionHeading id="preguntas-title" size="md" eyebrow="Preguntas frecuentes" title={<>¿Tienes preguntas? <span className="accent hl">Te ayudamos a comenzar.</span></>} intro="Lo que la plataforma hace hoy, explicado sin tecnicismos." />
          <div className="relative mt-10 hidden w-fit lg:block" aria-hidden="true">
            <div className="absolute inset-x-[-10%] bottom-0 h-16 rounded-[50%] bg-[radial-gradient(closest-side,rgba(197,42,241,.35),transparent)]" />
            <Mascot width={250} className="float relative" />
            <span className="float absolute -left-6 top-6 grid size-14 place-items-center rounded-2xl bg-violet-deep text-white shadow-[0_14px_30px_-10px_rgba(197,42,241,.9)]" style={{ '--i': 1 } as CSSProperties}><Icon name="chat" size={26} /></span>
            <span className="float absolute -right-4 top-20 grid size-12 place-items-center rounded-2xl bg-cyan text-night shadow-[0_14px_30px_-12px_rgba(18,220,231,.9)]" style={{ '--i': 2 } as CSSProperties}><Icon name="check" size={22} /></span>
          </div>
          <p className="mt-6 text-[0.98rem] text-ink-soft">¿No encuentras tu pregunta? <a href={whatsappLink('Hola, tengo una pregunta sobre TiendIA Exprés.')} target="_blank" rel="noopener noreferrer" className="font-bold text-night underline decoration-lime decoration-[3px] underline-offset-4">Escríbenos por WhatsApp<span className="sr-only"> (se abre en una pestaña nueva)</span></a>.</p>
        </div>
        <div className="grid gap-3">
          {faq.map((item) => (
            <details key={item.q} className="group rounded-2xl bg-paper px-5 ring-1 ring-night/10 transition-shadow open:shadow-[0_0_0_2px_#c52af1,0_20px_40px_-26px_rgba(11,11,19,.45)] [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-5 py-3.5 font-display text-[1.04rem] font-bold leading-snug transition-colors hover:text-violet-ink md:text-[1.1rem]">
                <span className="flex items-center gap-3.5"><span className="grid size-9 shrink-0 place-items-center rounded-xl bg-violet/12 text-violet-ink" aria-hidden="true"><Icon name="chat" size={17} /></span>{item.q}</span>
                <span className="grid size-8 shrink-0 place-items-center rounded-full text-violet-ink transition-transform duration-300 group-open:rotate-180" aria-hidden="true"><Icon name="chevronDown" size={20} /></span>
              </summary>
              <p className="mb-5 ml-[3.1rem] max-w-2xl rounded-xl bg-violet/6 px-4 py-3 text-[0.98rem] leading-relaxed text-ink-soft">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}
