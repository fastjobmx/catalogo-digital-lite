// Scene 3 · «Vende sin complicarte.» The buyer's real journey as ONE composition of real screens:
// the product page and the cart of the pilot store (real captures, src/content/media.ts) and the order
// message as the merchant receives it on WhatsApp (src/content/orderMessage.ts mirrors the platform's
// exact format; the customer is an example). No online payment exists: the line under it says so.
// The scene opens with a gradient from the dark story into the light background (no hard cut).
import { screens, store as pilot } from '../content/media'
import { OrderMessagePhone } from '../components/ui/OrderMessage'
import { PhoneFrame } from '../components/ui/PhoneFrame'
import { Icon } from '../components/ui/Icon'
import { useRef } from 'react'
import { vars, wrap } from './ui'
import { viewProgress } from './depth'
import { useScene3D } from './three/useScene3D'
import orderScreen from '../assets/v2/order-screen.webp'

const STEPS = [
  { title: 'Elige en tu tienda', alt: `Captura real de una ficha de producto de ${pilot.name}`, src: screens.product },
  { title: 'Arma el carrito', alt: `Captura real del carrito de ${pilot.name}, con el botón para enviar el pedido por WhatsApp`, src: screens.cart },
  { title: 'Te llega el pedido por WhatsApp', alt: '', src: undefined },
]

export function CustomerV2() {
  // Real 3D on desktop (WebGL): three modelled phones land on the three steps. The CSS phones stay in the
  // page (layout, alt texts) but are made transparent once the 3D ones are drawn.
  const journey = useRef<HTMLOListElement>(null)
  const host = useRef<HTMLDivElement>(null)
  const ready3D = useScene3D(host, (el) => window.innerWidth < 1024
    ? Promise.reject(new Error('desktop only'))
    : import('./three/JourneyPhones').then((m) => m.default(el, [screens.product, screens.cart, orderScreen],
      () => [...(journey.current?.querySelectorAll<HTMLElement>('.v2-journey-phone') ?? [])], () => (journey.current ? viewProgress(journey.current) : 0))))
  return (
    <section id="comprar" aria-labelledby="comprar-title" className={`v2-light relative pb-24 md:pb-36 ${ready3D ? 'has-3d' : ''}`}>
      <div className="v2-fade-band h-20 bg-[linear-gradient(180deg,#000,#fff)] md:h-28" aria-hidden="true" />
      <div className={wrap}>
        <header className="mx-auto max-w-3xl text-center">
          <p className="text-[0.9375rem] font-semibold text-(--v2-subtle)">Para tus clientes</p>
          <h2 id="comprar-title" className="v2-display mt-3">Vende sin complicarte.</h2>
          <p className="v2-lead mx-auto mt-5 max-w-xl text-(--v2-muted)">Tu cliente compra en tu tienda y el pedido te llega completo a tu WhatsApp.</p>
        </header>

        <div className="relative">
        <div ref={host} className="v2-journey-3d" aria-hidden="true" />
        <ol ref={journey} className="v2-journey mt-14 md:mt-20" data-v2-reveal="" tabIndex={0} aria-label="El recorrido de tu cliente">
          {STEPS.map((s, n) => (
            <li key={s.title} data-v2-item="" style={vars({ i: n })} className={`v2-journey-step ${n === 1 ? 'is-center' : ''}`}>
              <PhoneFrame src={s.src} alt={s.alt} width="100%" className="v2-journey-phone">
                {s.src ? null : <OrderMessagePhone />}
              </PhoneFrame>
              <p className="mt-5 flex items-center justify-center gap-2 text-center text-[1.0625rem] font-semibold tracking-[-0.02em]">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-(--v2-text) text-[0.75rem] font-bold text-(--v2-bg)" aria-hidden="true">{n + 1}</span>
                {s.title}
              </p>
              {n < 2 ? <Icon name="arrowRight" size={22} className="v2-journey-arrow text-(--v2-subtle)" /> : null}
            </li>
          ))}
        </ol>
        </div>
        <p className="mx-auto mt-10 max-w-2xl text-center text-[0.9375rem] leading-relaxed text-(--v2-muted)">
          Con productos, tallas y datos de entrega. Tu cliente paga en línea con Bold (tarjeta, PSE o Nequi) o te envía el pedido por WhatsApp para acordar el pago: no cobramos comisión. <span className="text-(--v2-subtle)">Capturas reales de una tienda piloto; cliente de ejemplo.</span>
        </p>
      </div>
    </section>
  )
}
