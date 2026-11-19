// "Tiendas reales" (light): the variety of designs, made tangible. An editorial row of the real phone
// captures of the authorized stores (src/content/stores.ts) at alternating heights; each links to its
// public store. Public catalogue figures only (no testimonials, ratings or sales).
import { realCapturedAt, showcaseStores } from '../content/stores'
import { PhoneFrame } from '../components/ui/PhoneFrame'
import { Icon } from '../components/ui/Icon'
import { useRef } from 'react'
import { Heading, Section, vars, wrap } from './ui'
import { useScrubVideo, viewProgress } from './depth'
import { useScene3D } from './three/useScene3D'
import still from '../assets/v2/stores-still.webp'
import drift from '../assets/v2/stores-drift.mp4'

const date = new Date(realCapturedAt).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Bogota' })

export function StoresV2() {
  const head = useRef<HTMLDivElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  useScrubVideo(head, video, drift, viewProgress)
  // Real 3D (WebGL): the six stores on a turning ring. When it is ready, the phones below give way to a
  // tidy list of the same stores with their links (the ring itself is decorative).
  const ring = useRef<HTMLDivElement>(null)
  const ringReady = useScene3D(ring, (el) => import('./three/StoresRing').then((m) => m.default(el, showcaseStores.map((st) => st.phone.src), () => viewProgress(el))))
  return (
    <Section id="tiendas" labelledBy="tiendas-title" light className={ringReady ? 'has-ring' : ''}>
      <div className={wrap}>
        <div ref={head} className="v2-stores-head mx-auto max-w-6xl">
          {/* 3D (Fase H): everyday products of different kinds of shops float around the title and drift in
              depth with the scroll (a clip made with Google Flow; scrubbed, never played). An illustration: the
              real stores are the captures below. Desktop only (1024 px and up). */}
          <div className="v2-stores-scene" aria-hidden="true">
            <img src={still} alt="" width={1920} height={1072} loading="lazy" decoding="async" />
            <video ref={video} muted playsInline preload="none" tabIndex={-1} disablePictureInPicture />
            <p>Ilustración generada con IA</p>
          </div>
          <Heading id="tiendas-title" center kicker="Tiendas reales" title="Cada tienda, con su propio estilo." intro={`Negocios que ya venden con TiendIA Exprés. Cifras de sus catálogos públicos al ${date}.`} />
        </div>
      </div>
      <div ref={ring} className="v2-ring" aria-hidden="true" />
      <ul data-v2-reveal="" tabIndex={0} aria-label="Tiendas reales" className="v2-collage mx-auto mt-14 max-w-[90rem] px-5 sm:px-8 md:mt-20">
        {showcaseStores.map((store, n) => (
          <li key={store.slug} data-v2-item="" style={vars({ i: n })} className="v2-collage-item">
            <a href={store.url} target="_blank" rel="noopener noreferrer" className="v2-collage-link group block rounded-[2rem]">
              <PhoneFrame src={store.phone.src} alt={`Captura real de la tienda ${store.name} en el celular`} width="100%" className="transition-transform duration-300 ease-out group-hover:-translate-y-1" />
              <span className="mt-4 block text-center">
                <span className="block text-[1.0625rem] font-semibold tracking-[-0.02em]">{store.name}</span>
                <span className="mt-0.5 block text-[0.8125rem] text-(--v2-subtle)">{store.category} · {store.productCount} productos</span>
                <span className="mt-1.5 inline-flex items-center gap-1 text-[0.875rem] font-semibold underline decoration-(--v2-line) underline-offset-4 group-hover:decoration-(--v2-text)">Ver tienda<Icon name="arrowUpRight" size={14} /></span>
              </span>
              <span className="sr-only"> (se abre en una pestaña nueva)</span>
            </a>
          </li>
        ))}
      </ul>
    </Section>
  )
}
