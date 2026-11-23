// «Una foto. Una ficha lista.» (dark): the AI, right under the hero, made tangible with a real product photo of
// an authorized store (MUY PARCERO). Only verified features: the photo → product suggestion proposes name,
// description and category (worker services/aiCatalog.ts: price and stock stay with the store); the assistant
// takes product photos on WhatsApp or Telegram; the photo studio and the PDF import (official FAQ).
// The suggested text is an illustration (labelled). AI features come with a plan and use AI credits.
import { Icon, type IconName } from '../components/ui/Icon'
import { site } from '../config/site'
import { Cta, Heading, Section, vars, wrap } from './ui'
import photo from '../assets/real/muy-parcero--zap-neg-3012.webp'

const SUGGESTED = [
  { label: 'Nombre', value: 'Tenis urbanos negros en gamuza' },
  { label: 'Descripción', value: 'Tenis bajos en gamuza negra con franja lateral blanca y suela color miel. Cómodos para el día a día.' },
  { label: 'Categoría', value: 'Calzado' },
]

const MORE: { icon: IconName; title: string; body: string }[] = [
  { icon: 'whatsapp', title: 'También por chat', body: 'Envía la foto a tu asistente en WhatsApp o Telegram y te muestra la ficha para confirmar.' },
  { icon: 'sparkle', title: 'Fotos de estudio', body: 'Fondo limpio o escenarios para tus productos, con el estudio fotográfico con IA.' },
  { icon: 'tag', title: 'Tu catálogo en PDF', body: 'La IA lee tu lista en PDF y te muestra una vista previa antes de guardar.' },
]

export function AiV2() {
  return (
    <Section id="ia" labelledBy="ia-title" className="v2-ai-scene">
      <div className={wrap}>
        <Heading id="ia-title" center kicker="Inteligencia artificial" title={<>Una foto.<br className="sm:hidden" /> Una ficha lista.</>}
          intro="Sube la foto de tu producto y la IA propone el nombre, la descripción y la categoría. Tú pones el precio y las tallas, revisas y publicas." />

        <div data-v2-reveal="" className="v2-ai-demo mx-auto mt-14 grid max-w-5xl items-center gap-6 md:mt-20 md:grid-cols-[minmax(0,0.85fr)_auto_minmax(0,1.15fr)] md:gap-8">
          <figure data-v2-item="" style={vars({ i: 0 })} className="relative overflow-hidden rounded-[2rem] ring-1 ring-inset ring-white/10">
            <img src={photo} alt="Foto real de unos tenis negros de MUY PARCERO" width={640} height={640} loading="lazy" decoding="async" className="aspect-square w-full object-cover" />
            <span className="v2-ai-scan" aria-hidden="true" />
            <figcaption className="absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-full bg-black/70 px-3 py-1.5 text-[0.8125rem] font-semibold text-white backdrop-blur">
              <Icon name="sparkle" size={14} className="text-(--v2-lime)" /> Leyendo la foto…
            </figcaption>
          </figure>

          <span data-v2-item="" style={vars({ i: 1 })} className="mx-auto grid size-12 place-items-center rounded-full bg-(--v2-lime) text-[#0c0e14] max-md:rotate-90" aria-hidden="true">
            <Icon name="arrowRight" size={22} />
          </span>

          <div data-v2-item="" style={vars({ i: 2 })} className="rounded-[2rem] bg-(--v2-surface) p-6 ring-1 ring-inset ring-(--v2-line) md:p-8">
            <p className="flex items-center gap-2 text-[0.875rem] font-semibold text-(--v2-lime)"><Icon name="sparkle" size={15} /> Ficha propuesta por la IA</p>
            <dl className="mt-5 space-y-4">
              {SUGGESTED.map((field) => (
                <div key={field.label}>
                  <dt className="text-[0.8125rem] font-semibold text-(--v2-subtle)">{field.label}</dt>
                  <dd className="mt-1 rounded-xl bg-black/30 px-4 py-3 text-[1rem] leading-snug text-(--v2-text) ring-1 ring-inset ring-white/5">{field.value}</dd>
                </div>
              ))}
              <div className="grid grid-cols-2 gap-3">
                {['Precio', 'Tallas y stock'].map((label) => (
                  <div key={label}>
                    <dt className="text-[0.8125rem] font-semibold text-(--v2-subtle)">{label}</dt>
                    <dd className="mt-1 rounded-xl border border-dashed border-(--v2-line) px-4 py-3 text-[0.9375rem] text-(--v2-muted)">Lo pones tú</dd>
                  </div>
                ))}
              </div>
            </dl>
            <p className="mt-5 flex items-center gap-2 text-[0.875rem] text-(--v2-muted)"><Icon name="check" size={16} className="text-(--v2-lime)" /> Nada se publica hasta que lo revisas y confirmas.</p>
          </div>
        </div>
        <p className="mx-auto mt-4 max-w-5xl text-center text-[0.8125rem] text-(--v2-subtle)">Ejemplo ilustrativo con una foto real de MUY PARCERO.</p>

        <ul className="mx-auto mt-14 grid max-w-5xl gap-4 md:grid-cols-3 md:gap-5" aria-label="Más con IA">
          {MORE.map((item) => (
            <li key={item.title} className="flex gap-3.5 rounded-[1.5rem] bg-(--v2-surface) p-5 ring-1 ring-inset ring-(--v2-line)">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-black/30 text-(--v2-lime)"><Icon name={item.icon} size={18} /></span>
              <span><span className="block text-[1rem] font-semibold">{item.title}</span><span className="mt-0.5 block text-[0.9rem] leading-snug text-(--v2-muted)">{item.body}</span></span>
            </li>
          ))}
        </ul>

        <div className="mt-12 flex flex-col items-center gap-3 text-center">
          <Cta href={site.trialUrl} size="lg" external>Crear mi tienda gratis</Cta>
          <p className="max-w-xl text-[0.875rem] text-(--v2-subtle)">Las funciones de IA se activan con tu plan y usan créditos de IA. Si una acción con IA falla, no se descuenta.</p>
        </div>
      </div>
    </Section>
  )
}
