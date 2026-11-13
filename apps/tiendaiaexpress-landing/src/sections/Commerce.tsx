// Plans with the monthly/annual switch, the feature comparator, what the initial payment
// includes, add-ons, commercial conditions and FAQ. Prices and plan data: src/content/plans.ts
// (single source; this file never states a price of its own).
import { useState, type CSSProperties } from 'react'
import { faq } from '../content/copy'
import { addOns, annualSaving, cop, firstYearMonthly, planMessage, plans, type Billing, type Plan } from '../content/plans'
import { whatsappLink } from '../config/site'
import { Badge, Button, SectionHeading } from '../components/ui/primitives'
import { Icon } from '../components/ui/Icon'

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
      <div className="inline-flex rounded-full bg-ivory p-1.5 ring-1 ring-forest/10">
        {options.map((o) => (
          <label key={o.key} className={`relative cursor-pointer rounded-full px-5 py-3 font-display text-[0.95rem] font-bold tracking-tight transition-colors duration-300 has-[:focus-visible]:outline has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-violet md:px-7 ${value === o.key ? 'bg-forest text-ivory' : 'text-forest hover:bg-forest/6'}`}>
            <input type="radio" name="modalidad" value={o.key} checked={value === o.key} onChange={() => onChange(o.key)} className="sr-only" />
            {o.label}
          </label>
        ))}
      </div>
      <p className="mt-3 text-[0.9rem] text-ink-soft">Con pago anual no hay pago inicial.</p>
    </fieldset>
  )
}

function PlanPrice({ plan, billing }: { plan: Plan; billing: Billing }) {
  const dark = plan.highlight
  const sub = dark ? 'text-mist' : 'text-ink-soft'
  const strong = dark ? 'text-ivory' : 'text-forest'
  const annual = billing === 'anual'
  return (
    <div className="mt-7">
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="display text-[clamp(2.4rem,3.6vw,3rem)]">{cop(annual ? plan.annual : plan.monthly).replace(' COP', '')}</span>
        <span className={`text-[0.95rem] ${sub}`}>COP {annual ? 'al año' : 'al mes'}</span>
      </p>
      {annual ? (
        <ul className={`mt-4 space-y-1.5 text-[0.93rem] ${sub}`}>
          <li>12 meses de servicio, sin pago inicial adicional.</li>
          <li className={`font-semibold ${dark ? 'text-lime' : 'text-forest'}`}>Ahorras {cop(annualSaving(plan))} frente al primer año con pago mensual ({cop(firstYearMonthly(plan))}).</li>
          <li>O con pago mensual: {cop(plan.monthly)} al mes + pago inicial.</li>
        </ul>
      ) : (
        <ul className={`mt-4 space-y-1.5 text-[0.93rem] ${sub}`}>
          <li><span className={`font-semibold ${strong}`}>Pago inicial: {cop(plan.setup)}</span>, una sola vez, con la primera mensualidad.</li>
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
      { label: 'Catálogo con plantilla y dirección propia', cells: [true, true, true] },
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
  if (value === true) return soon ? <span className="text-[0.82rem] font-semibold text-ink-soft">Próximamente</span> : <><Icon name="check" size={20} className="mx-auto text-forest" /><span className="sr-only">Incluido en {plan}</span></>
  if (value === false) return <><span aria-hidden="true" className="text-forest/30">—</span><span className="sr-only">No incluido en {plan}</span></>
  return <span className="font-semibold">{value}</span>
}

export function Plans() {
  const [billing, setBilling] = useState<Billing>('mensual')
  const choose = (detail: PlanChoice) => window.dispatchEvent(new CustomEvent(PLAN_EVENT, { detail }))
  return (
    <section id="planes" aria-labelledby="planes-title" className="bg-paper py-24 md:py-32">
      <div className="wrap">
        <div data-reveal>
          <SectionHeading id="planes-title" eyebrow="Planes" title={<>Un plan para cada <span className="accent text-violet-ink">etapa de tu negocio.</span></>} intro="Tres planes para que tu tienda crezca contigo. Precios claros y sin comisión por tus ventas." />
        </div>
        <BillingSwitch value={billing} onChange={setBilling} />
        <p className="sr-only" aria-live="polite">{billing === 'anual' ? 'Mostrando precios con pago anual.' : 'Mostrando precios con pago mensual.'}</p>

        <ul className="mt-9 grid gap-5 lg:grid-cols-3 lg:items-stretch">
          {plans.map((plan, n) => {
            const dark = plan.highlight
            const check = dark ? 'text-lime' : 'text-forest'
            const label = `font-display text-[0.78rem] font-bold uppercase tracking-[0.12em] ${dark ? 'text-mist' : 'text-ink-soft'}`
            return (
              <li key={plan.key} className="flex" data-reveal style={i(n)}>
                <article aria-labelledby={`plan-${plan.key}`} className={`relative flex w-full flex-col rounded-[1.75rem] p-7 md:p-8 ${dark ? 'on-dark bg-forest text-ivory shadow-[0_50px_90px_-45px_rgba(6,43,37,.85)] ring-1 ring-lime/40 lg:-my-3 lg:py-11' : 'bg-ivory text-forest ring-1 ring-forest/10'}`}>
                  <div className="flex min-h-7 flex-wrap items-center justify-between gap-2">
                    <h3 id={`plan-${plan.key}`} className="display text-[1.75rem]">{plan.name}</h3>
                    {dark ? <span className="rounded-full bg-lime px-3 py-1 font-display text-[0.75rem] font-extrabold text-forest">Recomendado</span> : null}
                  </div>
                  <p className={`mt-2 min-h-[3.2rem] text-[1rem] leading-snug ${dark ? 'text-mist' : 'text-ink-soft'}`}>{plan.audience}</p>
                  <PlanPrice plan={plan} billing={billing} />
                  <div className="mt-7 grid gap-2.5">
                    <Button href={whatsappLink(planMessage(plan, billing))} variant={dark ? 'lime' : 'forest'} icon="whatsapp" external aria-label={`Quiero el plan ${plan.name} con ${billing === 'anual' ? 'pago anual' : 'pago mensual'}, por WhatsApp (se abre en una pestaña nueva)`}>Quiero este plan</Button>
                    <Button href="#contacto" variant={dark ? 'outline-light' : 'outline-dark'} onClick={() => choose({ plan: plan.name, billing })}>Solicitar con el formulario</Button>
                  </div>
                  <p className={`mt-7 flex items-center gap-2.5 rounded-xl px-4 py-3 font-display font-bold ${dark ? 'bg-forest-raised' : 'bg-paper ring-1 ring-forest/8'}`}><Icon name="box" size={20} className={check} />{plan.products}</p>
                  <h4 className={`mt-7 ${label}`}>Incluye</h4>
                  <ul className="mt-3 space-y-2.5 text-[0.97rem]">
                    {plan.features.map((item) => <li key={item} className="flex gap-3"><Icon name="check" size={19} className={`mt-0.5 shrink-0 ${check}`} />{item}</li>)}
                  </ul>
                  <h4 className={`mt-7 ${label}`}>Inteligencia artificial</h4>
                  <ul className="mt-3 space-y-2.5 text-[0.97rem]">
                    {plan.ai.map((item) => <li key={item} className="flex gap-3"><Icon name="sparkle" size={19} className={`mt-0.5 shrink-0 ${dark ? 'text-violet-soft' : 'text-violet-ink'}`} />{item}</li>)}
                  </ul>
                  {plan.soon.length ? (
                    <div className="mt-7">
                      <div className="flex flex-wrap items-center gap-2"><h4 className={label}>En camino</h4><Badge kind="soon" onDark={dark} /></div>
                      <ul className={`mt-3 space-y-1.5 text-[0.93rem] ${dark ? 'text-mist' : 'text-ink-soft'}`}>
                        {plan.soon.map((item) => <li key={item} className="flex gap-3"><Icon name="clock" size={18} className="mt-0.5 shrink-0 opacity-70" />{item}</li>)}
                      </ul>
                    </div>
                  ) : null}
                </article>
              </li>
            )
          })}
        </ul>

        <div className="mt-12 grid gap-3 text-[0.9rem] text-ink-soft md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
          <p className="max-w-3xl">Precios en pesos colombianos (COP). Con pago mensual, el pago inicial se cobra una sola vez junto con la primera mensualidad; el pago anual incluye 12 meses de servicio y no cobra pago inicial adicional. Antes de cualquier pago te confirmamos por escrito el valor final, incluidos los impuestos que apliquen. No procesamos pagos en esta página.</p>
          <a href="#condiciones" className="inline-flex items-center gap-1.5 font-bold text-forest underline decoration-lime decoration-[3px] underline-offset-4 hover:decoration-forest">Ver condiciones comerciales <Icon name="arrowDown" size={16} /></a>
        </div>

        <div className="mt-20" data-reveal>
          <h3 id="comparador-title" className="display text-[clamp(1.6rem,2.6vw,2.1rem)]">Compara los planes</h3>
          <div className="relative mt-6 overflow-x-auto rounded-2xl ring-1 ring-forest/10" tabIndex={0} role="region" aria-labelledby="comparador-title">
            <table className="w-full min-w-[44rem] border-collapse text-left text-[0.93rem]">
              <thead>
                <tr className="bg-forest text-ivory">
                  <th scope="col" className="w-[34%] px-5 py-4 font-display font-bold">Función</th>
                  {plans.map((plan) => <th key={plan.key} scope="col" className={`px-4 py-4 text-center font-display text-[1.02rem] font-extrabold ${plan.highlight ? 'text-lime' : ''}`}>{plan.name}</th>)}
                </tr>
              </thead>
              {COMPARE.map((group) => (
                <tbody key={group.group}>
                  <tr><th scope="colgroup" colSpan={4} className="bg-ivory px-5 py-2.5 font-display text-[0.76rem] font-bold uppercase tracking-[0.12em] text-ink-soft">{group.group}</th></tr>
                  {group.rows.map((row) => (
                    <tr key={row.label} className="border-t border-forest/8">
                      <th scope="row" className="px-5 py-3.5 font-medium">{row.label}</th>
                      {row.cells.map((cell, n) => <td key={n} className={`px-4 py-3.5 text-center ${plans[n].highlight ? 'bg-lime/12' : ''}`}><CompareCell value={cell} soon={row.soon} plan={plans[n].name} /></td>)}
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
          <p className="mt-3 text-[0.82rem] text-ink-soft">Las cuotas de IA son mensuales. Si se agotan, tu tienda sigue funcionando y puedes pedir créditos adicionales.</p>
        </div>
      </div>
    </section>
  )
}

const SETUP = [
  { title: 'Configuración visual', body: 'Plantilla, colores y portada de tu tienda.' },
  { title: 'Identidad de marca', body: 'Tu logo y tu paleta aplicados en toda la tienda.' },
  { title: 'Carga inicial de productos', body: 'Subimos tus primeros productos contigo; la cantidad incluida se acuerda al contratar, según tu plan.' },
  { title: 'Categorías organizadas', body: 'Ordenamos tu catálogo para que tus clientes encuentren todo.' },
  { title: 'Pedidos por WhatsApp', body: 'Los pedidos llegan a tu número con productos, tallas y datos de entrega.' },
  { title: 'Asistente de Telegram', body: 'Vinculamos tu cuenta para administrar la tienda escribiendo.' },
  { title: 'Capacitación inicial', body: 'Te mostramos cómo manejar el panel y el asistente.' },
]

/** The assisted setup included in the initial payment, and the optional add-ons. */
export function Setup() {
  return (
    <section aria-labelledby="configuracion-title" className="bg-ivory py-24 md:py-28">
      <div className="wrap grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-20">
        <div data-reveal>
          <SectionHeading id="configuracion-title" size="md" eyebrow="Puesta en marcha" title="Qué incluye el pago inicial." intro="Con el pago inicial armamos tu tienda contigo y te la entregamos lista para vender." />
          <p className="mt-6 max-w-xl text-[0.93rem] text-ink-soft">Es un servicio de puesta en marcha: no incluye la carga ilimitada de inventario ni el procesamiento manual permanente de productos. Después, tú cargas y editas desde el panel o desde Telegram.</p>
        </div>
        <ol className="grid gap-x-8 sm:grid-cols-2">
          {SETUP.map((s, n) => (
            <li key={s.title} className="flex gap-4 border-t border-forest/12 py-5" data-reveal style={i(n % 2)}>
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
            <li key={a.title} className="flex flex-col rounded-2xl bg-paper p-6 ring-1 ring-forest/8">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-display text-[1.1rem] font-bold">{a.title}</h3>
                {a.status === 'pronto' ? <Badge kind="soon" /> : a.status === 'disponible' ? <Badge kind="live" /> : <Badge kind="live" label="Bajo consulta" />}
              </div>
              <p className="mt-2 flex-1 text-[0.95rem] text-ink-soft">{a.body}</p>
              {a.price ? <p className="mt-4 text-[0.9rem] font-semibold text-forest">{a.price}</p> : null}
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
            <div key={c.title} className="border-t border-forest/12 pt-4">
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
    <section id="preguntas" aria-labelledby="preguntas-title" className="bg-ivory py-24 md:py-32">
      <div className="wrap grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-20">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <SectionHeading id="preguntas-title" size="md" eyebrow="Preguntas frecuentes" title="Respuestas claras, sin letra pequeña." intro="Lo que la plataforma hace hoy, explicado sin tecnicismos." />
          <p className="mt-6 text-[0.98rem] text-ink-soft">¿No encuentras tu pregunta? <a href={whatsappLink('Hola, tengo una pregunta sobre TiendIA Exprés.')} target="_blank" rel="noopener noreferrer" className="font-bold text-forest underline decoration-lime decoration-[3px] underline-offset-4">Escríbenos por WhatsApp<span className="sr-only"> (se abre en una pestaña nueva)</span></a>.</p>
        </div>
        <div className="divide-y divide-forest/12 border-y border-forest/12">
          {faq.map((item) => (
            <details key={item.q} className="group [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-6 py-4 font-display text-[1.08rem] font-bold leading-snug transition-colors hover:text-violet-ink md:text-[1.15rem]">
                {item.q}
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-forest/6 text-forest transition-transform duration-300 group-open:rotate-45" aria-hidden="true"><Icon name="plus" size={17} /></span>
              </summary>
              <p className="max-w-2xl pb-6 pr-12 text-[1rem] leading-relaxed text-ink-soft">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}
