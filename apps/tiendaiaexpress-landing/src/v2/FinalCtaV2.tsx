// Closing scene (Fase H · 3D): a dark, cinematic finale. A product of the pilot store floats on a reflective
// stage; with motion on, the scroll turns it (a short clip scrubbed by the scroll position: it never plays by
// itself) while the camera pulls back and the closing call to action rises: the hero's own line and one
// button (the advisor is a text link). Without JS or with reduced motion:
// the still image and the text, in normal flow. The art is AI-generated (Google Flow) from the pilot store's
// product photo and is labelled as such. Trial conditions as enforced by the backend (site.trial).
import { useRef } from 'react'
import { site, whatsappLink } from '../config/site'
import { Cta } from './ui'
import { stickyProgress, useScrubVideo } from './depth'
import { useScene3D } from './three/useScene3D'
import { screens } from '../content/media'
import stage from '../assets/v2/finale-stage.webp'
import shoe from '../assets/v2/finale-shoe.webp'
import turn from '../assets/v2/finale-turn.mp4'

/** The turn completes at 80 % of the scene; the rest holds on the final pose under the call to action. */
const toClip = (p: number) => p / 0.8

export function FinalCtaV2() {
  const section = useRef<HTMLElement>(null)
  const video = useRef<HTMLVideoElement>(null)

  useScrubVideo(section, video, turn, stickyProgress, toClip)
  // Real 3D (WebGL, from 768 px): the pilot store's phone comes forward next to the product.
  const stage3D = useRef<HTMLDivElement>(null)
  const ready3D = useScene3D(stage3D, (el) => window.innerWidth < 768
    ? Promise.reject(new Error('wide screens only'))
    : import('./three/FinalePhone').then((m) => m.default(el, screens.home, () => (section.current ? stickyProgress(section.current) : 0))))

  return (
    <section ref={section} aria-labelledby="cierre-title" className="v2-finale">
      <div className="v2-finale-sticky">
        <div className="v2-finale-art" aria-hidden="true">
          <img className="v2-finale-stage" src={stage} alt="" width={1920} height={1072} loading="lazy" decoding="async" />
          <div className="v2-finale-product">
            <img src={shoe} alt="" width={1600} height={900} loading="lazy" decoding="async" />
            <video ref={video} muted playsInline preload="none" tabIndex={-1} disablePictureInPicture />
          </div>
          <div ref={stage3D} className="v2-finale-3d" data-ready={ready3D ? 'true' : undefined} />
        </div>
        <div className="v2-finale-copy">
          <h2 id="cierre-title" className="v2-display">Tu tienda.<br />Bajo tu control.</h2>
          <p className="v2-finale-lead">Prueba gratis {site.trial.days} días, sin tarjeta de crédito y con hasta {site.trial.products} productos. Si contratas un plan, conservas todo.</p>
          <div className="v2-finale-ctas">
            <Cta href={site.trialUrl} size="lg" external>Crear mi tienda gratis</Cta>
          </div>
          <p className="mt-4"><a href={whatsappLink('Hola, quiero hablar con un asesor de TiendIA Exprés.')} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-[1rem] text-(--v2-text) underline-offset-4 after:ml-1 after:content-['›'] hover:underline">O habla con un asesor por WhatsApp<span className="sr-only"> (se abre en una pestaña nueva)</span></a></p>
          <p className="v2-finale-note">Imagen generada con IA a partir de un producto de la tienda piloto.</p>
        </div>
      </div>
    </section>
  )
}
