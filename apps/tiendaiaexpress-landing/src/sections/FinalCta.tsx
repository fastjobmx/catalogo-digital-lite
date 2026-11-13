// Closing call to action before the footer. Sits on night (continuous with Contacto and the footer),
// inside a card with a moving violet/cyan neon border; the assistant stands on the pedestal and
// steps out of the card. Trial conditions come from site.trial (same as /prueba in production).
import type { CSSProperties } from 'react'
import { site, whatsappLink } from '../config/site'
import { Button } from '../components/ui/primitives'
import { Icon } from '../components/ui/Icon'
import { Mascot, Sparks, Swoosh } from '../components/brand/Decor'

const i = (n: number) => ({ '--i': n }) as CSSProperties

export function FinalCta() {
  const facts = [`Prueba de ${site.trial.days} días`, 'Sin correo ni contraseña', `Hasta ${site.trial.products} productos con foto`]
  return (
    <section aria-labelledby="cierre-title" className="on-dark relative bg-night pb-20 pt-10 text-porcelain md:pb-28 md:pt-16">
      <div className="wrap">
        <div data-reveal data-tilt="0.25" className="neon-border relative rounded-[2.25rem] p-[2px] shadow-[0_60px_120px_-50px_rgba(197,42,241,.75)]">
          <div className="relative overflow-hidden rounded-[calc(2.25rem-2px)] bg-[radial-gradient(70rem_30rem_at_100%_100%,rgba(197,42,241,.42),transparent_60%),radial-gradient(40rem_24rem_at_0%_0%,rgba(18,220,231,.16),transparent_60%),linear-gradient(115deg,#0b0b13,#1d0a33_55%,#3a0c57)]">
            <div className="grid-fade pointer-events-none absolute inset-0 opacity-80" aria-hidden="true" />
            <div className="relative grid items-center gap-10 px-7 pb-0 pt-12 md:px-12 md:pt-14 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,0.65fr)] lg:gap-6 lg:py-16 lg:pl-16 lg:pr-6">
              <div className="min-w-0">
                <p className="eyebrow inline-flex items-center gap-2 text-cyan"><Sparks className="size-5" color="var(--color-cyan)" />Empieza hoy</p>
                <h2 id="cierre-title" className="display mt-4 text-[clamp(2rem,4.4vw,3.6rem)]">
                  Tu próxima venta comienza con{' '}
                  <span className="relative inline-block">
                    <span className="accent accent-gradient">una tienda que trabaja contigo.</span>
                    <Swoosh className="absolute -bottom-2.5 left-0 w-[70%]" />
                  </span>
                </h2>
                <p className="mt-6 max-w-xl text-lg leading-relaxed text-mist">
                  Tu tienda online, tu asistente con IA y tu publicidad para redes en un solo lugar. Pruébala con tus productos antes de decidir.
                </p>
                <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                  <Button href={site.trialUrl} variant="lime" size="lg" lead="store" icon="arrowRight" external>Crear mi tienda gratis</Button>
                  <Button href={whatsappLink('Hola, quiero hablar con un asesor de TiendIA Exprés.')} variant="outline-light" size="lg" lead="chat" external>Hablar con un asesor</Button>
                </div>
                <ul className="mt-7 flex flex-wrap gap-x-6 gap-y-2 text-[0.92rem] text-mist" aria-label="Condiciones de la prueba gratis">
                  {facts.map((item) => (
                    <li key={item} className="flex items-center gap-2"><span className="grid size-5 place-items-center rounded-full bg-lime/15 text-lime"><Icon name="check" size={13} /></span>{item}</li>
                  ))}
                </ul>
              </div>

              {/* The assistant on the neon pedestal, with an order arriving (illustrative). */}
              <div className="relative mx-auto h-[19rem] w-full max-w-[22rem] sm:h-[22rem] lg:h-[24rem]" aria-hidden="true">
                <div className="pedestal bottom-[4%] !w-[92%]" />
                <div className="absolute inset-x-0 bottom-[9%] flex justify-center">
                  <Mascot width="clamp(12rem, 22vw, 17rem)" className="float drop-shadow-[0_30px_40px_rgba(0,0,0,.55)]" style={i(0)} />
                </div>
                <div className="float glass absolute right-0 top-[8%] flex items-center gap-2.5 rounded-2xl py-2 pl-2 pr-3.5 text-night" style={i(2)}>
                  <span className="grid size-9 place-items-center rounded-full bg-[#25d366] text-white"><Icon name="whatsapp" size={19} /></span>
                  <span className="leading-tight">
                    <span className="block font-display text-[0.88rem] font-extrabold">¡Nuevo pedido!</span>
                    <span className="block text-[0.72rem] text-ink-soft">Llegó por WhatsApp</span>
                  </span>
                </div>
                <div className="float glass-dark absolute left-0 top-[34%] flex items-center gap-2 rounded-xl px-3 py-2 text-[0.8rem] font-semibold" style={i(4)}>
                  <span className="grid size-7 place-items-center rounded-lg bg-violet-deep font-display text-[0.7rem] font-extrabold text-white shadow-[0_0_18px_rgba(197,42,241,.8)]">IA</span>
                  Tienda lista
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
