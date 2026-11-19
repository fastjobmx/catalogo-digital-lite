// FAQ of the V2 prototype. Prices, quotas and commercial answers are the official ones (src/content/
// copy.ts, reused verbatim through `faq`); only the answers about the assistant change, because the
// official text says it exists only on Telegram. Owner decisions of 2026-11-19: one monthly AI quota
// shared by WhatsApp and Telegram (plans.ts), WhatsApp in office hours with Telegram as the round-the-clock
// backup, several users from the Negocio plan up.
import { useState } from 'react'
import { faq } from '../content/copy'
import { site, whatsappLink } from '../config/site'
import { Heading, Section, type, wrap } from './ui'
import { Icon } from '../components/ui/Icon'

const official = (q: string) => {
  const item = faq.find((f) => f.q === q)
  if (!item) throw new Error(`FAQ not found in copy.ts: ${q}`)
  return item
}

export const faqV2: { q: string; a: string }[] = [
  official('¿Cómo funciona la prueba gratis?'),
  official('¿Cuánto cuesta tener mi tienda?'),
  {
    q: '¿Mis clientes hablan con el asistente?',
    a: 'No. Tus clientes ven tu catálogo, arman el carrito y te envían el pedido al WhatsApp de tu negocio. El asistente es privado: solo lo usan las cuentas vinculadas para administrar la tienda.',
  },
  {
    q: '¿En qué canales funciona el asistente?',
    a: `En WhatsApp y en Telegram. En WhatsApp te atiende en horario de oficina (hora de Colombia) y en Telegram, las 24 horas: úsalo de respaldo cuando WhatsApp no esté disponible. Los mensajes IA del mes son un solo cupo para los dos canales. Vinculas tu número o tu cuenta con un código de un solo uso que generas desde tu cuenta de TiendIA Exprés. Un número que no está vinculado no puede administrar ninguna tienda.`,
  },
  {
    q: '¿Cómo le escribo al asistente?',
    a: 'Como a una persona: «cambia el precio», «carga 10 en talla 42», «¿qué pedidos tengo?». Entiende el mensaje y te pide confirmación antes de guardar cualquier cambio.',
  },
  {
    q: '¿Los pedidos me llegan por WhatsApp?',
    a: 'Sí. Tu cliente arma el carrito y te envía el pedido por WhatsApp, con los productos, las tallas y los datos de entrega. Después puedes cambiar el estado del pedido desde el panel o escribiéndole a tu asistente.',
  },
  official('¿Qué incluye el pago inicial?'),
  official('¿Cuál es la diferencia entre el pago mensual y el anual?'),
  official('¿Cuántos productos puedo publicar?'),
  official('¿Qué pasa cuando se agotan los créditos de IA?'),
  official('¿Puedo importar mis productos desde Excel o PDF?'),
  official('¿Cobran comisión por venta?'),
  official('¿Puedo cobrar en línea?'),
  official('¿Puedo tener dominio propio?'),
  official('¿Cómo cambio de plan?'),
  {
    q: '¿Necesito saber de tecnología?',
    a: 'No. Creamos la tienda contigo y después la administras desde un panel web o escribiéndole a tu asistente en WhatsApp o Telegram.',
  },
]

/** The real objections first (the rest is one tap away; all of it is in the page without JS). */
const FIRST = ['¿Necesito saber de tecnología?', '¿Puedo cobrar en línea?', '¿Cobran comisión por venta?', '¿Cómo cambio de plan?', '¿Cómo funciona la prueba gratis?', '¿Mis clientes hablan con el asistente?']
const ordered = [...FIRST.map((q) => faqV2.find((f) => f.q === q)!), ...faqV2.filter((f) => !FIRST.includes(f.q))]

export function FaqV2() {
  const [all, setAll] = useState(false)
  return (
    <Section id="preguntas" labelledBy="preguntas-title" light>
      <div className={`${wrap} grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)] lg:gap-20`}>
        <div className="lg:sticky lg:top-28 lg:self-start">
          <Heading id="preguntas-title" kicker="Preguntas frecuentes" title="Lo que la plataforma hace hoy." />
          <p className={`mt-5 ${type.body} text-[0.95rem]`}>¿No encuentras tu pregunta? <a href={whatsappLink('Hola, tengo una pregunta sobre TiendIA Exprés.')} target="_blank" rel="noopener noreferrer" className="font-semibold text-(--v2-text) underline decoration-(--v2-line) underline-offset-4 hover:decoration-(--v2-text)">Escríbenos por WhatsApp al {site.whatsapp.display}<span className="sr-only"> (se abre en una pestaña nueva)</span></a>.</p>
        </div>
        <div className="border-t border-(--v2-line)" data-all={all ? 'true' : undefined}>
          {/* Numbered and one answer open at a time (native <details name>), after 21st.dev «Ghost Accordion». */}
          {ordered.map((item, n) => (
            <details key={item.q} name="preguntas-v2" className={`group ${n >= FIRST.length ? 'v2-faq-more' : ''} border-b border-(--v2-line) [&_summary::-webkit-details-marker]:hidden`}>
              <summary className="flex min-h-16 cursor-pointer list-none items-center gap-4 py-4 text-[1rem] font-semibold leading-snug transition-colors hover:text-(--v2-muted) md:gap-6 md:text-[1.0625rem]">
                <span aria-hidden="true" className="w-7 shrink-0 text-[0.8125rem] font-medium tabular-nums text-(--v2-subtle) transition-colors group-open:text-(--v2-text)">{String(n + 1).padStart(2, '0')}</span>
                <span className="flex-1">{item.q}</span>
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-(--v2-surface) transition-[transform,background-color] duration-200 group-open:rotate-45 group-open:bg-(--v2-text) group-open:text-(--v2-bg)"><Icon name="plus" size={16} /></span>
              </summary>
              <p className={`v2-disclose max-w-2xl pb-6 pl-11 md:pl-[3.25rem] ${type.body} text-[0.95rem]`}>{item.a}</p>
            </details>
          ))}
          {all ? null : (
            <div className="v2-faq-toggle pt-6">
              <button type="button" onClick={() => setAll(true)} aria-expanded="false" className="inline-flex min-h-12 items-center gap-2 rounded-full bg-(--v2-surface) px-6 text-[0.9375rem] font-semibold">
                Ver más preguntas ({ordered.length - FIRST.length})<Icon name="chevronDown" size={16} />
              </button>
            </div>
          )}
        </div>
      </div>
    </Section>
  )
}
