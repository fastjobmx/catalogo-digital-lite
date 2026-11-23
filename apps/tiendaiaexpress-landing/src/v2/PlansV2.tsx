// Plans, V2 presentation (second design, Fase H). Every figure and feature comes from
// src/content/plans.ts (single source, not modified): prices, setup, annual saving, first-year total,
// products, features, AI allowances and upcoming items; «included in every plan» comes from addOns and
// the trial from site.ts. The official Plans component (src/sections/Commerce.tsx) is not touched.
// Layout: a centred header with the billing switch; three cards (the recommended one in dark, as a
// highlight); on phones the cards become a swipeable row with a plan selector, so the three can be
// compared side by side without a very long page. Below: what every plan includes, the fine print and
// the full comparator (derived from plans.ts), with a sticky first column on small screens.
// «Varios administradores con roles» from Negocio up and the shared assistant quota: owner decisions of
// 2026-11-19, written in plans.ts.
import { useEffect, useRef, useState, type RefObject } from 'react'
import { addOns, annualSaving, cop, firstYearMonthly, planMessage, plans, type Billing, type Plan } from '../content/plans'
import { site, whatsappLink } from '../config/site'
import { PLAN_EVENT, type PlanChoice } from '../sections/Commerce'
import { Icon, type IconName } from '../components/ui/Icon'
import { Cta, Heading, Section, type, wrap } from './ui'
import { useScrubVideo, viewProgress } from './depth'
import artEmprendedor from '../assets/v2/plan-emprendedor.webp'
import artNegocio from '../assets/v2/plan-negocio.webp'
import artMayorista from '../assets/v2/plan-mayorista.webp'
import clipEmprendedor from '../assets/v2/plan-emprendedor.mp4'
import clipNegocio from '../assets/v2/plan-negocio.mp4'
import clipMayorista from '../assets/v2/plan-mayorista.mp4'

/** 3D (Google Flow): one sculpted object per plan, a growing business: a bag, a cart, a pallet of boxes.
 * Decorative; with motion on, a short clip turns it as the card crosses the screen (scrubbed, never played). */
const ART: Record<Plan['key'], { still: string; clip: string }> = {
  emprendedor: { still: artEmprendedor, clip: clipEmprendedor },
  negocio: { still: artNegocio, clip: clipNegocio },
  mayorista: { still: artMayorista, clip: clipMayorista },
}
const toClip = (p: number) => (p - 0.1) / 0.5

function PlanArt({ plan }: { plan: Plan }) {
  const box = useRef<HTMLDivElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  useScrubVideo(box, video, ART[plan.key].clip, viewProgress, toClip)
  return (
    <div ref={box} data-plan={plan.key} className="v2-plan-art -mx-7 -mt-7 mb-1 md:-mx-8 md:-mt-8" aria-hidden="true">
      <img src={ART[plan.key].still} alt="" width={720} height={720} loading="lazy" decoding="async" />
      <video ref={video} muted playsInline preload="none" tabIndex={-1} disablePictureInPicture />
    </div>
  )
}

const INHERITS = /^Todo lo del plan /

/** Features available in each plan, including those inherited from the plans below it. */
const cumulative: string[][] = plans.reduce<string[][]>((acc, plan) => {
  const own = plan.features.filter((f) => !INHERITS.test(f))
  acc.push([...(acc[acc.length - 1] ?? []), ...own])
  return acc
}, [])
const allFeatures = cumulative[cumulative.length - 1]
const allSoon = [...new Set(plans.flatMap((p) => p.soon))]
/** Add-ons that plans.ts says are included in every plan (today: Estudio Creativo). */
const includedAddOns = addOns.filter((a) => /incluido en todos los planes/i.test(a.price))
const amount = (value: number) => cop(value).replace(' COP', '')

/** The price counts to its new value when the billing changes (pattern adapted from 21st.dev, «Pricing
 * Section with Monthly/Yearly Toggle»): 520 ms, ease-out, motion mode only. The prerendered HTML and
 * screen readers always get the final figure (the count is aria-hidden; the live region says the mode). */
function Ticker({ value, className }: { value: number; className: string }) {
  const [shown, setShown] = useState(value)
  const from = useRef(value)
  useEffect(() => {
    if (!document.documentElement.classList.contains('motion') || from.current === value) { from.current = value; setShown(value); return }
    const start = from.current
    const t0 = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / 520)
      const v = start + (value - start) * (1 - Math.pow(1 - k, 3))
      setShown(v)
      from.current = v
      if (k < 1) raf = requestAnimationFrame(tick)
      else from.current = value
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value])
  return (
    <span className={className}>
      <span aria-hidden="true">{amount(Math.round(shown / 100) * 100)}</span>
      <span className="sr-only">{amount(value)}</span>
    </span>
  )
}

function Price({ plan, billing }: { plan: Plan; billing: Billing }) {
  const annual = billing === 'anual'
  return (
    <div className="mt-8">
      <p className="flex flex-wrap items-baseline gap-x-2">
        <Ticker value={annual ? plan.annual : plan.monthly} className="text-[2.75rem] font-semibold leading-none tracking-[-0.045em] tabular-nums md:text-[3.25rem]" />
        <span className="text-[1rem] font-medium text-(--v2-muted)">COP/{annual ? 'año' : 'mes'}</span>
      </p>
      {annual ? (
        <>
          <p className="mt-3 text-[0.95rem] text-(--v2-text)">Sin pago inicial · 12 meses de servicio</p>
          <p className="mt-3"><span className="inline-flex rounded-full bg-(--v2-lime) px-3 py-1 text-[0.8125rem] font-semibold text-[#0b0c10]">Ahorras {cop(annualSaving(plan))}</span></p>
          <p className="mt-2 text-[0.8125rem] leading-snug text-(--v2-subtle)">Frente al primer año con pago mensual ({cop(firstYearMonthly(plan))}).</p>
        </>
      ) : (
        <>
          <p className="mt-3 text-[0.95rem] text-(--v2-text)">+ {cop(plan.setup)} de pago inicial, una sola vez</p>
          <p className="mt-2 text-[0.8125rem] leading-snug text-(--v2-subtle)">Se cobra con la primera mensualidad. Primer año: {cop(firstYearMonthly(plan))} en total.</p>
        </>
      )}
    </div>
  )
}

function Features({ plan }: { plan: Plan }) {
  const inherits = plan.features.find((f) => INHERITS.test(f))
  const own = plan.features.filter((f) => !INHERITS.test(f))
  return (
    <div className="mt-7">
      <h4 className="text-[0.8125rem] font-semibold text-(--v2-subtle)">{inherits ? `${inherits}, y además:` : 'Incluye'}</h4>
      {inherits ? <span className="sr-only">Incluye:</span> : null}
      <ul className="mt-3 space-y-2.5 text-[0.95rem] leading-snug text-(--v2-muted)">
        {own.map((item) => <li key={item} className="flex gap-2.5"><Icon name="check" size={17} className="mt-0.5 shrink-0 text-(--v2-text)" />{item}</li>)}
      </ul>
    </div>
  )
}

function Card({ plan, billing }: { plan: Plan; billing: Billing }) {
  const featured = Boolean(plan.highlight)
  const label = billing === 'anual' ? 'pago anual' : 'pago mensual'
  const choose = (detail: PlanChoice) => window.dispatchEvent(new CustomEvent(PLAN_EVENT, { detail }))
  return (
    <article id={`plan-card-${plan.key}`} aria-labelledby={`plan-v2-${plan.key}`}
      className={`v2-plan-card flex w-full flex-col overflow-hidden rounded-[1.75rem] p-7 md:p-8 ${featured ? 'v2-plan-dark bg-(--v2-bg) text-(--v2-text) shadow-[0_40px_80px_-40px_rgba(0,0,0,.55)]' : 'bg-(--v2-surface)'}`}>
      <PlanArt plan={plan} />
      <div className="flex min-h-8 items-center justify-between gap-3">
        <h3 id={`plan-v2-${plan.key}`} className="text-[1.625rem] font-semibold tracking-[-0.03em]">{plan.name}</h3>
        {featured ? <span className="rounded-full bg-(--v2-lime) px-2.5 py-1 text-[0.75rem] font-semibold text-[#0b0c10]">Recomendado</span> : null}
      </div>
      <p className="mt-2 min-h-[2.9rem] text-[0.95rem] leading-snug text-(--v2-muted)">{plan.audience}</p>
      <Price plan={plan} billing={billing} />
      <div className="mt-7 grid gap-1">
        <Cta href={whatsappLink(planMessage(plan, billing))} variant={featured ? 'primary' : 'secondary'} size="lg" external aria-label={`Quiero el plan ${plan.name} con ${label}, por WhatsApp (se abre en una pestaña nueva)`}>Quiero este plan</Cta>
        <a href="#contacto" onClick={() => choose({ plan: plan.name, billing })} className="inline-flex min-h-11 items-center justify-center text-[0.875rem] font-medium text-(--v2-muted) underline decoration-(--v2-line) underline-offset-4 hover:text-(--v2-text) hover:decoration-(--v2-text)">Solicitar con el formulario</a>
      </div>
      <div className="mt-6 border-t border-(--v2-line) pt-6">
        <p className="flex items-center gap-2.5 text-[1.125rem] font-semibold tracking-[-0.01em]"><Icon name="box" size={19} className="text-(--v2-subtle)" />{plan.products}</p>
      </div>
      <Features plan={plan} />
      <div className="mt-7">
        <h4 className="text-[0.8125rem] font-semibold text-(--v2-subtle)">Inteligencia artificial</h4>
        <ul className="mt-3 space-y-2.5 text-[0.95rem] leading-snug text-(--v2-muted)">
          {plan.ai.map((item) => <li key={item} className="flex gap-2.5"><Icon name="sparkle" size={17} className="mt-0.5 shrink-0 text-(--v2-text)" />{item}</li>)}
        </ul>
      </div>
      {plan.soon.length ? (
        <div className="mt-7">
          <h4 className="text-[0.8125rem] font-semibold text-(--v2-subtle)">En camino · Próximamente</h4>
          <ul className="mt-3 flex flex-wrap gap-2">
            {plan.soon.map((item) => <li key={item} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[0.8125rem] text-(--v2-muted) ring-1 ring-inset ring-(--v2-line)"><Icon name="clock" size={14} className="shrink-0" />{item}</li>)}
          </ul>
        </div>
      ) : null}
    </article>
  )
}

function Cell({ value, plan }: { value: string | boolean; plan: string }) {
  if (value === true) return <><Icon name="check" size={16} className="mx-auto" /><span className="sr-only">Incluido en {plan}</span></>
  if (value === false) return <><span aria-hidden="true" className="text-(--v2-subtle)">—</span><span className="sr-only">No incluido en {plan}</span></>
  return <span>{value}</span>
}

function Comparator() {
  const groups: { group: string; rows: { label: string; cells: (string | boolean)[] }[] }[] = [
    { group: 'Precio', rows: [
      { label: 'Mensualidad', cells: plans.map((p) => cop(p.monthly)) },
      { label: 'Pago inicial (una vez, con pago mensual)', cells: plans.map((p) => cop(p.setup)) },
      { label: 'Anualidad (sin pago inicial)', cells: plans.map((p) => cop(p.annual)) },
      { label: 'Comisión por venta', cells: plans.map(() => 'No') },
    ] },
    { group: 'Tu tienda', rows: [
      { label: 'Productos', cells: plans.map((p) => p.products) },
      ...allFeatures.map((f) => ({ label: f, cells: cumulative.map((set) => set.includes(f)) })),
    ] },
    { group: 'Inteligencia artificial (al mes)', rows: [{ label: 'Cuotas de IA', cells: plans.map((p) => p.ai.join(' · ')) }] },
    ...(includedAddOns.length ? [{ group: 'Incluido en todos los planes', rows: includedAddOns.map((a) => ({ label: `${a.title}: ${a.price}`, cells: plans.map(() => true) })) }] : []),
    ...(allSoon.length ? [{ group: 'En camino', rows: allSoon.map((s) => ({ label: s, cells: plans.map((p) => (p.soon.includes(s) ? 'Próximamente' : false)) })) }] : []),
  ]
  return (
    <details className="group mt-14 rounded-[1.5rem] bg-(--v2-surface) [&_summary::-webkit-details-marker]:hidden">
      <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-4 rounded-[1.5rem] px-6 text-[1.0625rem] font-semibold">
        <span id="comparador-title">Comparar todos los detalles</span>
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-(--v2-bg) transition-transform duration-200 group-open:rotate-180"><Icon name="chevronDown" size={18} /></span>
      </summary>
      <div className="v2-disclose v2-compare overflow-x-auto px-2 pb-3" tabIndex={0} role="region" aria-labelledby="comparador-title">
        <table className="w-full min-w-[46rem] border-collapse text-left text-[0.9rem]">
          <thead>
            <tr>
              <th scope="col" className="w-[34%] px-4 py-4 font-medium text-(--v2-subtle)">Función</th>
              {plans.map((p) => <th key={p.key} scope="col" className="px-4 py-4 text-center text-[1rem] font-semibold">{p.name}{p.highlight ? <span className="ml-1.5 inline-block size-2 rounded-full bg-(--v2-lime) align-middle" aria-hidden="true" /> : null}</th>)}
            </tr>
          </thead>
          {groups.map((g) => (
            <tbody key={g.group}>
              <tr><th scope="colgroup" colSpan={4} className="px-4 pb-2 pt-6 text-[0.75rem] font-semibold uppercase tracking-[0.08em] text-(--v2-subtle)">{g.group}</th></tr>
              {g.rows.map((row) => (
                <tr key={row.label} className="border-t border-(--v2-line)">
                  <th scope="row" className="px-4 py-3 font-normal text-(--v2-muted)">{row.label}</th>
                  {row.cells.map((cell, n) => <td key={n} className="px-4 py-3 text-center">{<Cell value={cell} plan={plans[n].name} />}</td>)}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </details>
  )
}

/** On phones the cards are a horizontal row: this selector shows which plan is in view and jumps to it. */
function usePlanInView(row: RefObject<HTMLUListElement | null>) {
  const [inView, setInView] = useState(plans[0].key)
  useEffect(() => {
    const el = row.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((entries) => {
      const best = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
      const key = best?.target.getAttribute('data-plan')
      if (key) setInView(key as Plan['key'])
    }, { root: el, threshold: [0.55, 0.8] })
    el.querySelectorAll('[data-plan]').forEach((li) => io.observe(li))
    return () => io.disconnect()
  }, [row])
  return inView
}

const EVERY_PLAN: { icon: IconName; title: string; body: string }[] = [
  { icon: 'tag', title: 'Sin comisión por venta', body: 'Cobra en línea con tu cuenta Bold o acuerda el pago por WhatsApp.' },
  ...includedAddOns.map((a) => ({ icon: 'sparkle' as IconName, title: `${a.title} incluido`, body: 'Sin consumir créditos IA.' })),
  { icon: 'clock', title: `Prueba gratis de ${site.trial.days} días`, body: `Sin tarjeta de crédito, con hasta ${site.trial.products} productos.` },
]

export function PlansV2() {
  const [billing, setBilling] = useState<Billing>('mensual')
  const row = useRef<HTMLUListElement>(null)
  const inView = usePlanInView(row)
  const goTo = (key: Plan['key']) => {
    const card = row.current?.querySelector<HTMLElement>(`[data-plan="${key}"]`)
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (card && row.current) row.current.scrollTo({ left: card.offsetLeft - (row.current.clientWidth - card.offsetWidth) / 2, behavior: reduce ? 'auto' : 'smooth' })
  }

  return (
    <Section id="planes" labelledBy="planes-title" light className="!pb-12 md:!pb-16">
      <div className={wrap}>
        <Heading id="planes-title" center kicker="Planes" title="Un plan para cada etapa." intro="Precios en pesos colombianos. Sin comisión por tus ventas." />

        <fieldset className="mt-10 flex flex-col items-center">
          <legend className="sr-only">Modalidad de pago</legend>
          <div className="relative inline-grid grid-cols-2 rounded-full bg-(--v2-surface) p-1">
            <span className="v2-indicator absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-full bg-(--v2-text) shadow-sm" style={{ transform: `translateX(${billing === 'anual' ? '100%' : '0'})` }} aria-hidden="true" />
            {(['mensual', 'anual'] as const).map((b) => (
              <label key={b} className={`relative flex min-h-11 min-w-[9.5rem] cursor-pointer items-center justify-center rounded-full px-5 text-[0.9375rem] font-semibold transition-colors duration-200 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-(--v2-text) ${billing === b ? 'text-(--v2-bg)' : 'text-(--v2-muted) hover:text-(--v2-text)'}`}>
                <input type="radio" name="modalidad-v2" value={b} checked={billing === b} onChange={() => setBilling(b)} className="sr-only" />
                {b === 'mensual' ? 'Pago mensual' : 'Pago anual'}
              </label>
            ))}
          </div>
          <p className={`mt-3 text-center ${type.small}`}>Con pago anual no hay pago inicial.</p>
        </fieldset>
        <p className="sr-only" aria-live="polite">{billing === 'anual' ? 'Mostrando precios con pago anual.' : 'Mostrando precios con pago mensual.'}</p>

        {/* Phones: which plan is in view; a tap brings it to the centre. */}
        <div className="mt-10 flex justify-center gap-1.5 lg:hidden" aria-label="Ir a un plan" role="group">
          {plans.map((p) => (
            <button key={p.key} type="button" onClick={() => goTo(p.key)} aria-controls={`plan-card-${p.key}`} aria-current={inView === p.key ? 'true' : undefined}
              className={`min-h-11 rounded-full px-4 text-[0.875rem] font-semibold transition-colors duration-200 ${inView === p.key ? 'bg-(--v2-text) text-(--v2-bg)' : 'bg-(--v2-surface) text-(--v2-muted)'}`}>{p.name}</button>
          ))}
        </div>

        <div className="v2-plans-bleed mt-6 lg:mt-14">
        <ul ref={row} tabIndex={0} aria-label="Planes" className="v2-plans v2-plans-row">
          {plans.map((plan) => (
            <li key={plan.key} data-plan={plan.key} className={`flex ${plan.highlight ? 'is-featured' : ''}`}>
              <Card plan={plan} billing={billing} />
            </li>
          ))}
        </ul>
        </div>

        <ul className="mx-auto mt-12 grid max-w-5xl gap-6 border-t border-(--v2-line) pt-10 md:grid-cols-3" aria-label="En todos los planes">
          {EVERY_PLAN.map((item) => (
            <li key={item.title} className="flex gap-3.5">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-(--v2-surface)"><Icon name={item.icon} size={18} /></span>
              <span><span className="block text-[1rem] font-semibold">{item.title}</span><span className="mt-0.5 block text-[0.9rem] leading-snug text-(--v2-muted)">{item.body}</span></span>
            </li>
          ))}
        </ul>

        <Comparator />

        <div className="mx-auto mt-8 max-w-4xl text-center text-[0.8125rem] leading-relaxed text-(--v2-subtle)">
          <p>Precios en pesos colombianos (COP). Con pago mensual, el pago inicial se cobra una sola vez junto con la primera mensualidad; el pago anual incluye 12 meses de servicio y no cobra pago inicial adicional. Antes de cualquier pago te confirmamos el valor final, incluidos los impuestos que apliquen. Tu plan se paga en línea con Bold (tarjeta de crédito o débito, PSE o Nequi) desde tu panel, al activar tu tienda; en esta página no se procesan pagos.</p>
          <p className="mt-2">Las cuotas de IA son mensuales. Si se agotan, tu tienda sigue funcionando y puedes pedir créditos adicionales.</p>
          <a href="#condiciones" className="mt-3 inline-flex min-h-11 items-center gap-1.5 font-semibold text-(--v2-text) underline decoration-(--v2-line) underline-offset-4 hover:decoration-(--v2-text)">Condiciones comerciales<Icon name="arrowDown" size={15} /></a>
        </div>
      </div>
    </Section>
  )
}
