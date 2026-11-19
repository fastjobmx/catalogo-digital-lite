// «Tu tienda en 3 pasos» (dark): the bridge to the plans. Only verifiable facts: the free trial (site.trial)
// or the store set up with you (official FAQ «¿Necesito saber de tecnología?»), the store's own address
// (plans.ts: app.tiendiaexpres.com/t/tu-negocio) and linking WhatsApp or Telegram with a one-time code.
// 3D: each step has a sculpted object made with Google Flow (a shop, a paper plane, a chat bubble with a
// check mark) on the same reflective stage as the finale; with motion on, a short Flow clip turns it with
// the scroll (scrubbed, never played) and the card tilts toward a fine pointer. On desktop a lime line runs
// from step to step as the section is read. Decorative art (aria-hidden); the text carries the meaning.
import { useRef } from 'react'
import { site } from '../config/site'
import { Cta, Heading, Section, vars, wrap } from './ui'
import { useScrubVideo, viewProgress } from './depth'
import still1 from '../assets/v2/paso-1.webp'
import still2 from '../assets/v2/paso-2.webp'
import still3 from '../assets/v2/paso-3.webp'
import clip1 from '../assets/v2/paso-1.mp4'
import clip2 from '../assets/v2/paso-2.mp4'
import clip3 from '../assets/v2/paso-3.mp4'

const STEPS = [
  { still: still1, clip: clip1, title: 'Crea tu tienda.', body: `Pruébala gratis ${site.trial.days} días, sin tarjeta de crédito, o cuéntanos de tu negocio y la armamos contigo.` },
  { still: still2, clip: clip2, title: 'Compártela.', body: 'Tu tienda tiene su propia dirección, app.tiendiaexpres.com/t/tu-negocio: compártela en tus redes y por WhatsApp.' },
  { still: still3, clip: clip3, title: 'Contrólala por chat.', body: 'Vinculas tu WhatsApp o Telegram con un código de un solo uso y administras escribiendo.' },
]

/** The clip turns the object while the card crosses the screen (from entering to the middle). */
const toClip = (p: number) => (p - 0.15) / 0.45

function Step({ step, n }: { step: (typeof STEPS)[number]; n: number }) {
  const card = useRef<HTMLDivElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  useScrubVideo(card, video, step.clip, viewProgress, toClip)
  return (
    <li style={vars({ i: n })} className="v2-step flex">
      <div ref={card} data-v2-tilt="" className="v2-tile v2-step-card flex w-full flex-col overflow-hidden rounded-[2rem] bg-black ring-1 ring-inset ring-white/10">
        <div className="v2-step-art" aria-hidden="true">
          <img src={step.still} alt="" width={900} height={900} loading="lazy" decoding="async" />
          <video ref={video} muted playsInline preload="none" tabIndex={-1} disablePictureInPicture />
        </div>
        <div className="relative -mt-10 px-7 pb-8 md:px-8 md:pb-9">
          <p className="text-[0.875rem] font-semibold text-(--v2-lime)">Paso {n + 1}</p>
          <h3 className="mt-1.5 text-[1.625rem] font-semibold tracking-[-0.03em]">{step.title}</h3>
          <p className="mt-2 text-[1rem] leading-relaxed text-(--v2-muted) [overflow-wrap:anywhere]">{step.body}</p>
        </div>
      </div>
    </li>
  )
}

export function StepsV2() {
  return (
    <Section id="empieza" labelledBy="empieza-title" className="v2-steps-scene">
      <div className={wrap}>
        <Heading id="empieza-title" center kicker="Empieza" title="Tu tienda en 3 pasos." intro="Sin instalar nada y sin saber de tecnología." />
        <div className="relative mx-auto mt-14 max-w-6xl md:mt-20">
          <span className="v2-steps-line" aria-hidden="true"><span /></span>
          <ol className="v2-steps grid gap-5 md:grid-cols-3">
            {STEPS.map((step, n) => <Step key={step.title} step={step} n={n} />)}
          </ol>
        </div>
        <div className="mt-12 flex flex-col items-center gap-3">
          <Cta href={site.trialUrl} size="lg" external>Crear mi tienda gratis</Cta>
          <p className="text-[0.875rem] text-(--v2-subtle)">{site.trial.days} días gratis · Sin tarjeta de crédito · Hasta {site.trial.products} productos</p>
        </div>
      </div>
    </Section>
  )
}
