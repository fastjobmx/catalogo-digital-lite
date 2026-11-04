// Compare (create vs manage), plans (no prices) and FAQ.
import { compare, faq, plans } from '../content/copy'
import { whatsappLink } from '../config/site'
import { Button, SectionHeading } from '../components/ui/primitives'
import { Icon } from '../components/ui/Icon'

export const PLAN_EVENT = 'mp:plan'

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

export function Plans() {
  const choose = (name: string) => window.dispatchEvent(new CustomEvent(PLAN_EVENT, { detail: name }))
  return (
    <section id="planes" aria-labelledby="planes-title" className="bg-paper py-24 md:py-36">
      <div className="wrap">
        <SectionHeading id="planes-title" title="Consultá nuestros planes." intro="Tres formas de empezar. Te contamos precios y condiciones por WhatsApp, según tu negocio." />
        <div className="mt-14 grid gap-4 lg:grid-cols-3">
          {plans.map((plan) => (
            <article key={plan.key} className={`flex flex-col rounded-[2rem] p-7 md:p-9 ${plan.featured ? 'on-dark bg-forest text-ivory lg:-my-4 lg:py-12' : 'bg-ivory text-forest ring-1 ring-forest/8'}`}>
              <h3 className="display text-[clamp(2rem,3.4vw,2.9rem)]">{plan.name}</h3>
              <p className={`mt-3 text-lg ${plan.featured ? 'text-lime' : 'text-ink-soft'}`}>{plan.for}</p>
              <ul className="mt-8 flex-1 space-y-3">
                {plan.includes.map((item) => (
                  <li key={item} className="flex gap-3"><Icon name="check" size={20} className={`mt-0.5 shrink-0 ${plan.featured ? 'text-lime' : 'text-forest'}`} />{item}</li>
                ))}
              </ul>
              <div className="mt-10 grid gap-2.5">
                <Button href={whatsappLink(`Hola, quiero conocer el plan ${plan.name} de MOSTRALO PUES!`)} variant={plan.featured ? 'lime' : 'forest'} icon="whatsapp" external>Consultá este plan</Button>
                <Button href="#contacto" variant={plan.featured ? 'outline-light' : 'outline-dark'} onClick={() => choose(plan.name)}>Solicitá tu tienda</Button>
              </div>
            </article>
          ))}
        </div>
        <p className="mt-10 max-w-3xl text-sm text-ink-soft">Categorías de servicio propuestas. Los planes definitivos, sus precios y condiciones se confirman directamente con nuestro equipo; no se publican precios ni promociones en esta página.</p>
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
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-forest/6 transition-transform duration-300 group-open:rotate-45"><Icon name="plus" size={18} /></span>
              </summary>
              <p className="max-w-2xl pb-6 pr-12 text-[1.02rem] leading-relaxed text-ink-soft">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}
