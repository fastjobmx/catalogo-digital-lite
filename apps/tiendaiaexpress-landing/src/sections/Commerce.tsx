// Compare (create vs manage), plans with the monthly/annual comparator, add-ons, what the setup
// includes, commercial conditions and FAQ. Prices and plan data: src/content/plans.ts.
import { useState } from 'react'
import { compare, faq } from '../content/copy'
import { addOns, annualSaving, cop, firstYearMonthly, planMessage, plans, type Billing, type Plan } from '../content/plans'
import { whatsappLink } from '../config/site'
import { Badge, Button, SectionHeading } from '../components/ui/primitives'
import { Icon } from '../components/ui/Icon'

export const PLAN_EVENT = 'mp:plan'
export type PlanChoice = { plan: string; billing: Billing }

export function Compare() {
  return (
    <section aria-labelledby="diferencia-title" className="bg-ivory py-24 md:py-36">
      <div className="wrap">
        <SectionHeading id="diferencia-title" title="Tu tienda, y quien te ayuda a manejarla." intro="Son dos partes del mismo servicio: la tienda que ven tus clientes y el asistente con el que la administrás." />
        <div className="relative mt-14 grid gap-4 lg:grid-cols-2">
          <article className="rounded-[2rem] bg-paper p-7 ring-1 ring-forest/8 md:p-10">
            <Icon name="store" size={30} className="text-forest" />
            <h3 className="mt-6 font-display text-3xl font-bold md:text-4xl">{compare.create.title}</h3>
            <p className="mt-2 text-lg text-ink-soft">{compare.create.lead}</p>
            <ul className="mt-8 space-y-3">
              {compare.create.points.map((p) => <li key={p} className="flex gap-3 text-[1.02rem]"><Icon name="check" size={20} className="mt-0.5 shrink-0 text-forest" />{p}</li>)}
            </ul>
          </article>
          <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 hidden size-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-lime text-forest shadow-xl lg:grid" aria-hidden="true"><Icon name="plus" size={28} /></div>
          <article className="on-dark rounded-[2rem] bg-forest p-7 text-ivory md:p-10">
            <Icon name="telegram" size={30} className="text-lime" />
            <h3 className="mt-6 font-display text-3xl font-bold md:text-4xl">{compare.manage.title}</h3>
            <p className="mt-2 text-lg text-mist">{compare.manage.lead}</p>
            <ul className="mt-8 space-y-3">
              {compare.manage.points.map((p) => <li key={p} className="flex gap-3 text-[1.02rem]"><Icon name="check" size={20} className="mt-0.5 shrink-0 text-lime" />{p}</li>)}
            </ul>
          </article>
        </div>
      </div>
    </section>
  )
}

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
          <label key={o.key} className={`relative cursor-pointer rounded-full px-5 py-3 font-display text-sm font-bold uppercase tracking-wide transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-violet md:px-7 ${value === o.key ? 'bg-forest text-ivory' : 'text-forest hover:bg-forest/6'}`}>
            <input type="radio" name="modalidad" value={o.key} checked={value === o.key} onChange={() => onChange(o.key)} className="sr-only" />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

function PlanPrice({ plan, billing }: { plan: Plan; billing: Billing }) {
  const dark = plan.highlight
  const sub = dark ? 'text-mist' : 'text-ink-soft'
  if (billing === 'anual') {
    return (
      <div className="mt-8">
        <p className="flex flex-wrap items-baseline gap-x-2"><span className="font-display text-[clamp(2.1rem,3.4vw,2.8rem)] font-bold leading-none">{cop(plan.annual).replace(' COP', '')}</span><span className={sub}>COP al año</span></p>
        <ul className={`mt-4 space-y-1.5 text-[0.95rem] ${sub}`}>
          <li>12 meses de servicio, sin pago inicial adicional.</li>
          <li className={`font-semibold ${dark ? 'text-lime' : 'text-forest'}`}>Ahorrás {cop(annualSaving(plan))} frente al primer año con pago mensual ({cop(firstYearMonthly(plan))}).</li>
          <li>O con pago mensual: {cop(plan.monthly)} al mes + pago inicial.</li>
        </ul>
      </div>
    )
  }
  return (
    <div className="mt-8">
      <p className="flex flex-wrap items-baseline gap-x-2"><span className="font-display text-[clamp(2.1rem,3.4vw,2.8rem)] font-bold leading-none">{cop(plan.monthly).replace(' COP', '')}</span><span className={sub}>COP al mes</span></p>
      <ul className={`mt-4 space-y-1.5 text-[0.95rem] ${sub}`}>
        <li><span className={`font-semibold ${dark ? 'text-ivory' : 'text-forest'}`}>Pago inicial: {cop(plan.setup)}</span>, una sola vez, con la primera mensualidad.</li>
        <li>Total del primer año: {cop(firstYearMonthly(plan))}.</li>
        <li>O con pago anual: {cop(plan.annual)}, sin pago inicial.</li>
      </ul>
    </div>
  )
}

export function Plans() {
  const [billing, setBilling] = useState<Billing>('mensual')
  const choose = (detail: PlanChoice) => window.dispatchEvent(new CustomEvent(PLAN_EVENT, { detail }))
  return (
    <section id="planes" aria-labelledby="planes-title" className="bg-paper py-24 md:py-36">
      <div className="wrap">
        <SectionHeading id="planes-title" title="Planes y precios." intro="Tres planes para que tu tienda crezca con tu negocio. Sin comisión por tus ventas." />
        <BillingSwitch value={billing} onChange={setBilling} />
        <p className="sr-only" aria-live="polite">{billing === 'anual' ? 'Mostrando precios con pago anual.' : 'Mostrando precios con pago mensual.'}</p>
        <ul className="mt-8 grid gap-4 lg:grid-cols-3 lg:items-stretch">
          {plans.map((plan) => {
            const dark = plan.highlight
            const check = dark ? 'text-lime' : 'text-forest'
            return (
              <li key={plan.key} className="flex">
                <article aria-labelledby={`plan-${plan.key}`} className={`flex w-full flex-col rounded-[2rem] p-7 md:p-9 ${dark ? 'on-dark bg-forest text-ivory shadow-[0_40px_80px_-40px_rgba(3,48,31,.8)] lg:-my-3 lg:py-12' : 'bg-ivory text-forest ring-1 ring-forest/8'}`}>
                  <h3 id={`plan-${plan.key}`} className="display text-[clamp(2rem,3.2vw,2.7rem)]">{plan.name}</h3>
                  <p className={`mt-3 text-lg ${dark ? 'text-lime' : 'text-ink-soft'}`}>{plan.audience}</p>
                  <PlanPrice plan={plan} billing={billing} />
                  <p className={`mt-7 flex items-center gap-2.5 rounded-2xl px-4 py-3 font-display font-bold ${dark ? 'bg-forest-raised' : 'bg-paper ring-1 ring-forest/8'}`}><Icon name="box" size={20} className={check} />{plan.products}</p>
                  <h4 className="mt-7 font-display text-sm font-bold uppercase tracking-wide">Incluye</h4>
                  <ul className="mt-3 space-y-2.5">
                    {plan.features.map((item) => <li key={item} className="flex gap-3"><Icon name="check" size={20} className={`mt-0.5 shrink-0 ${check}`} />{item}</li>)}
                  </ul>
                  <h4 className="mt-7 font-display text-sm font-bold uppercase tracking-wide">Inteligencia artificial</h4>
                  <ul className="mt-3 space-y-2.5">
                    {plan.ai.map((item) => <li key={item} className="flex gap-3"><Icon name="sparkle" size={20} className={`mt-0.5 shrink-0 ${check}`} />{item}</li>)}
                  </ul>
                  {plan.soon.length ? (
                    <div className="mt-7">
                      <div className="flex flex-wrap items-center gap-2"><h4 className="font-display text-sm font-bold uppercase tracking-wide">En camino</h4><Badge kind="soon" onDark={dark} /></div>
                      <ul className={`mt-3 space-y-1.5 text-[0.95rem] ${dark ? 'text-mist' : 'text-ink-soft'}`}>
                        {plan.soon.map((item) => <li key={item} className="flex gap-3"><Icon name="clock" size={18} className="mt-0.5 shrink-0 opacity-70" />{item}</li>)}
                      </ul>
                    </div>
                  ) : null}
                  <div className="mt-auto grid gap-2.5 pt-10">
                    <Button href={whatsappLink(planMessage(plan, billing))} variant={dark ? 'lime' : 'forest'} icon="whatsapp" external aria-label={`Quiero el plan ${plan.name} con ${billing === 'anual' ? 'pago anual' : 'pago mensual'}, por WhatsApp (se abre en una pestaña nueva)`}>Quiero este plan</Button>
                    <Button href="#contacto" variant={dark ? 'outline-light' : 'outline-dark'} onClick={() => choose({ plan: plan.name, billing })}>Solicitar con el formulario</Button>
                  </div>
                </article>
              </li>
            )
          })}
        </ul>
        <div className="mt-10 grid gap-3 text-sm text-ink-soft md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
          <p className="max-w-3xl">Precios en pesos colombianos (COP). Con pago mensual, el pago inicial se cobra una sola vez junto con la primera mensualidad; el pago anual incluye 12 meses de servicio y no cobra pago inicial adicional. Antes de cualquier pago te confirmamos por escrito el valor final, incluidos los impuestos que apliquen. No procesamos pagos en esta página.</p>
          <a href="#condiciones" className="inline-flex items-center gap-1.5 font-bold text-forest underline decoration-lime decoration-[3px] underline-offset-4 hover:decoration-forest">Ver condiciones comerciales <Icon name="arrowDown" size={16} /></a>
        </div>
      </div>
    </section>
  )
}

const SETUP = [
  { title: 'Configuración visual', body: 'Plantilla, colores y portada de tu tienda.' },
  { title: 'Identidad de marca', body: 'Tu logo y tu paleta aplicados en toda la tienda.' },
  { title: 'Carga inicial de productos', body: 'Subimos tus primeros productos con vos; la cantidad incluida se acuerda al contratar, según tu plan.' },
  { title: 'Categorías organizadas', body: 'Ordenamos tu catálogo para que tus clientes encuentren todo.' },
  { title: 'Pedidos por WhatsApp', body: 'Los pedidos llegan a tu número con productos, tallas y datos de entrega.' },
  { title: 'Asistente de Telegram', body: 'Vinculamos tu cuenta para administrar la tienda escribiendo.' },
  { title: 'Capacitación inicial', body: 'Te mostramos cómo manejar el panel y el asistente.' },
]

/** Optional add-ons and the assisted setup included in the initial payment. */
export function Setup() {
  return (
    <section aria-labelledby="configuracion-title" className="bg-ivory py-24 md:py-32">
      <div className="wrap grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-20">
        <div>
          <SectionHeading id="configuracion-title" size="md" title="Qué incluye la configuración inicial." intro="Con el pago inicial armamos tu tienda con vos, lista para vender." />
          <p className="mt-6 max-w-xl text-[0.95rem] text-ink-soft">La configuración inicial es un servicio de puesta en marcha: no incluye la carga ilimitada de inventario ni el procesamiento manual permanente de productos. Después, vos cargás y editás desde el panel o desde Telegram.</p>
        </div>
        <ol className="grid gap-3 sm:grid-cols-2">
          {SETUP.map((s, i) => (
            <li key={s.title} className="flex gap-4 rounded-[1.5rem] bg-paper p-5 ring-1 ring-forest/8">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-lime font-display text-sm font-bold text-forest" aria-hidden="true">{i + 1}</span>
              <div><h3 className="font-display text-lg font-bold">{s.title}</h3><p className="mt-1 text-[0.95rem] text-ink-soft">{s.body}</p></div>
            </li>
          ))}
        </ol>
      </div>
      <div className="wrap mt-20">
        <h2 id="complementos-title" className="font-display text-2xl font-bold md:text-3xl">Complementos opcionales</h2>
        <ul aria-labelledby="complementos-title" className="mt-6 grid gap-3 md:grid-cols-3">
          {addOns.map((a) => (
            <li key={a.title} className="flex flex-col rounded-[1.5rem] bg-paper p-6 ring-1 ring-forest/8">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-display text-lg font-bold">{a.title}</h3>
                {a.status === 'pronto' ? <Badge kind="soon" /> : a.status === 'disponible' ? <Badge kind="live" /> : <Badge kind="live" label="Bajo consulta" />}
              </div>
              <p className="mt-2 flex-1 text-[0.95rem] text-ink-soft">{a.body}</p>
              {a.price ? <p className="mt-4 text-sm font-semibold text-forest">{a.price}</p> : null}
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
  { title: 'Modalidad anual', body: 'Pagás 12 meses de servicio por adelantado y no se cobra pago inicial adicional.' },
  { title: 'Renovaciones', body: 'Te avisamos antes de cada renovación. No hacemos cobros automáticos: cada pago lo hacés vos.' },
  { title: 'Cancelaciones', body: 'Podés cancelar avisándonos por WhatsApp. Tu tienda sigue activa hasta el final del periodo pagado.' },
  { title: 'Falta de pago', body: 'Si un pago se atrasa, te avisamos antes de pausar la tienda. Al ponerte al día, vuelve a publicarse.' },
  { title: 'Tus datos', body: 'Tus productos, fotos y pedidos se conservan mientras la tienda está pausada. El plazo de conservación después de cancelar se informa en los términos al contratar.' },
  { title: 'Créditos IA', body: 'Las cuotas IA de tu plan son mensuales. Si se agotan, tu tienda sigue funcionando y podés pedir créditos adicionales.' },
  { title: 'Dominio propio', body: 'Tipo de dominio, titularidad, renovación, transferencia y cancelación se acuerdan por escrito antes de configurarlo.' },
  { title: 'Fotos y productos', body: 'Tus fotos, productos y marca son tuyos, también las imágenes que mejores con IA a partir de ellas.' },
  { title: 'Sin comisión por venta', body: 'No cobramos comisión por tus ventas: el pedido te llega por WhatsApp y el pago lo acordás directamente con tu cliente.' },
  { title: 'Cambios de plan', body: 'Podés cambiar de plan cuando lo necesites; antes del cambio te confirmamos el valor.' },
  { title: 'Cambios de precio', body: 'Si los precios cambian, te avisamos con anticipación. El periodo que ya pagaste no cambia de precio.' },
]

export function Conditions() {
  return (
    <section id="condiciones" aria-labelledby="condiciones-title" className="bg-paper py-24 md:py-32">
      <div className="wrap">
        <SectionHeading id="condiciones-title" size="md" title="Condiciones comerciales." intro="Lo esencial, en claro. Los términos completos te los entregamos por escrito al contratar." />
        <dl className="mt-12 grid gap-x-10 gap-y-6 md:grid-cols-2 xl:grid-cols-3">
          {CONDITIONS.map((c) => (
            <div key={c.title} className="border-t border-forest/12 pt-4">
              <dt className="font-display font-bold">{c.title}</dt>
              <dd className="mt-1.5 text-[0.95rem] leading-relaxed text-ink-soft">{c.body}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  )
}

export function Faq() {
  return (
    <section id="preguntas" aria-labelledby="preguntas-title" className="bg-ivory py-24 md:py-36">
      <div className="wrap grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-20">
        <SectionHeading id="preguntas-title" size="md" title="Preguntas frecuentes." intro="Respuestas claras sobre lo que la plataforma hace hoy." />
        <div className="divide-y divide-forest/12 border-y border-forest/12">
          {faq.map((item) => (
            <details key={item.q} className="group py-1 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-6 py-4 font-display text-lg font-bold md:text-xl">
                {item.q}
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-forest/6 transition-transform duration-300 group-open:rotate-45" aria-hidden="true"><Icon name="plus" size={18} /></span>
              </summary>
              <p className="max-w-2xl pb-6 pr-12 text-[1.02rem] leading-relaxed text-ink-soft">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}
