// "Estudio Creativo y publicidad". The pieces shown were rendered with the platform's own design
// engine (frontend/src/lib/creative, conventional mode, "Sneaker Impact" style) using real products,
// photos, prices and previous prices of the SneakerHub Premium demo store as published on 2026-11-12,
// with the brand colours set to the TiendIA palette. See docs/FABRICA_CREATIVOS_FASE3.md. Statuses verified against the platform: conventional mode in
// production since 2026-11-11 and included in every plan; AI photo tools use the plan's monthly
// allowances; AI video is switched off, so it is listed as upcoming.
import type { CSSProperties } from 'react'
import oferta from '../assets/studio/oferta-vertical.webp'
import carrusel1 from '../assets/studio/carrusel-1.webp'
import carrusel2 from '../assets/studio/carrusel-2.webp'
import historia from '../assets/studio/historia-volta.webp'
import whatsapp from '../assets/studio/whatsapp-vanta.webp'
import cuadro1 from '../assets/studio/video-cuadro-1.webp'
import cuadro2 from '../assets/studio/video-cuadro-2.webp'
import cuadro3 from '../assets/studio/video-cuadro-3.webp'
import fotoRuta from '../assets/studio/foto-ruta.webp'
import ofertaHeroe from '../assets/studio/oferta-ruta-heroe.webp'
import { Badge, SectionHeading } from '../components/ui/primitives'
import { Icon, type IconName } from '../components/ui/Icon'
import { Sparks } from '../components/brand/Decor'

const i = (n: number) => ({ '--i': n }) as CSSProperties

const INCLUDED: { icon: IconName; name: string; detail: string }[] = [
  { icon: 'image', name: 'Imágenes para redes', detail: 'Formatos 1:1, 4:5 e historias 9:16 con tu marca, el nombre y el precio exactos.' },
  { icon: 'layers', name: 'Carruseles', detail: 'Varias piezas de una colección, listas para publicar.' },
  { icon: 'play', name: 'Videos cortos automáticos', detail: 'De 6, 10 o 15 segundos, armados con tus fotos.' },
  { icon: 'wand', name: 'Fotos parejas', detail: 'Recorte, encuadre y tamaño uniformes para lotes de hasta 50 fotos.' },
]
const WITH_AI: { icon: IconName; name: string; detail: string }[] = [
  { icon: 'camera', name: 'Packshots de producto', detail: 'Fondo blanco o neutro, luz de estudio y sombra natural.' },
  { icon: 'image', name: 'Escenarios realistas', detail: 'Fondo publicitario, escenario comercial o presentación en local.' },
  { icon: 'sparkle', name: 'Calzado en escena', detail: 'Escenas pensadas para la categoría de tu producto.' },
]
const SOON = ['Video con IA', 'Modelos virtuales', 'Variantes de color', 'Marca de agua', 'Fondos prediseñados']

/** A generated piece shown whole: every cell has the piece's own aspect ratio (no cropping). The format
 * label sits top-left, a corner every piece leaves empty, so it never covers the piece's text. */
function Piece({ src, alt, label, width, height, className = '' }: { src: string; alt: string; label: string; width: number; height: number; className?: string }) {
  return (
    <figure className={`group relative h-72 shrink-0 snap-start overflow-hidden rounded-2xl bg-paper ring-1 ring-white/10 transition-shadow duration-500 hover:shadow-[0_0_0_2px_#c52af1,0_0_40px_-6px_rgba(197,42,241,.8)] md:h-auto md:w-full ${className}`}>
      <img src={src} alt={alt} width={width} height={height} loading="lazy" decoding="async" className="size-full object-cover transition-transform duration-700 ease-[var(--ease-out-expo)] group-hover:scale-[1.03]" />
      <figcaption className="absolute left-2.5 top-2.5 rounded-full bg-carbon/85 px-2.5 py-1 text-[0.7rem] font-semibold text-porcelain ring-1 ring-white/10 backdrop-blur">{label}</figcaption>
    </figure>
  )
}

export function Studio() {
  return (
    <section id="estudio" aria-labelledby="estudio-title" className="on-dark relative overflow-hidden bg-night py-24 text-porcelain md:py-32">
      <div className="pointer-events-none absolute -right-48 top-0 size-[44rem] rounded-full bg-[radial-gradient(closest-side,rgba(197,42,241,.28),transparent)]" aria-hidden="true" />
      <div className="pointer-events-none absolute -left-40 top-[38%] size-[36rem] rounded-full bg-[radial-gradient(closest-side,rgba(18,220,231,.12),transparent)]" aria-hidden="true" />
      <div className="wrap relative">
        <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-16">
          <div data-reveal>
            <SectionHeading id="estudio-title" onDark eyebrow="Estudio Creativo" title={<>Publicidad lista para tus redes, <span className="accent accent-gradient">hecha con tus productos.</span></>} intro="Desde el panel de tu tienda conviertes tus fotos en imágenes, carruseles y videos cortos con tu marca, el nombre y el precio de cada producto." />
            <ol className="mt-8 flex flex-wrap items-center gap-2 text-[0.88rem] font-semibold" aria-label="Cómo se crea una pieza">
              {['Eliges el producto', 'Eliges el formato', 'Descargas y publicas'].map((step, n) => (
                <li key={step} className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-2 rounded-full bg-white/6 py-1.5 pl-1.5 pr-3.5 ring-1 ring-inset ring-white/12"><span className="grid size-6 place-items-center rounded-full bg-lime font-display text-[0.75rem] font-extrabold text-night">{n + 1}</span>{step}</span>
                  {n < 2 ? <Icon name="arrowRight" size={14} className="text-cyan" /> : null}
                </li>
              ))}
            </ol>
          </div>

          {/* Before → after: the real store photo and the offer piece generated from it. */}
          <figure className="relative" data-reveal style={i(1)}>
            <div className="relative mx-auto flex max-w-[34rem] items-center justify-center [perspective:1400px]">
              <div className="relative z-10 w-[46%] rounded-2xl bg-paper p-2 pb-3 shadow-[0_30px_60px_-24px_rgba(0,0,0,.8)] [transform:rotateY(14deg)_rotateZ(-5deg)]">
                <img src={fotoRuta} alt="Foto original de los Ruta Canvas Classic, tal como está en la tienda" width={720} height={480} loading="lazy" decoding="async" className="aspect-[3/2] w-full rounded-xl object-cover" />
                <p className="mt-2 flex items-center gap-1.5 px-1 text-[0.75rem] font-bold text-night"><Icon name="camera" size={14} />Tu foto</p>
              </div>
              <span className="relative z-20 -mx-3 grid size-12 shrink-0 place-items-center rounded-full bg-lime text-night shadow-[0_0_30px_rgba(217,255,20,.6)]" aria-hidden="true"><Icon name="arrowRight" size={22} /></span>
              <div className="neon-rim relative z-10 w-[46%] overflow-hidden rounded-2xl [transform:rotateY(-12deg)_rotateZ(3deg)]">
                <img src={ofertaHeroe} alt="Una pieza de oferta generada con esa foto: 17 % de descuento, antes $ 179.900, ahora $ 149.900" width={720} height={900} loading="lazy" decoding="async" className="aspect-[4/5] w-full object-cover" />
              </div>
              <Sparks className="absolute -right-2 -top-4 size-10" color="var(--color-cyan)" />
            </div>
            <figcaption className="mt-5 text-center text-[0.8rem] text-mist">La foto real de la tienda y la pieza que el Estudio Creativo generó con ella.</figcaption>
          </figure>
        </div>

        {/* Phones: a horizontal strip. From md: a mosaic whose columns follow each piece's ratio
            (--h is the row height derived from the container width), so nothing is cropped. */}
        <div className="mt-14 [container-type:inline-size]" data-reveal>
          <div tabIndex={0} role="group" aria-label="Piezas generadas por el Estudio Creativo" className="-mx-5 flex snap-x gap-3 overflow-x-auto px-5 pb-3 studio-mosaic md:mx-0 md:gap-4 md:overflow-visible md:p-0">
            <Piece src={oferta} width={720} height={900} label="Oferta · 4:5" alt="Pieza de oferta vertical de los Ruta Canvas Classic: 17 % de descuento, antes $ 179.900, ahora $ 149.900" className="aspect-[4/5] md:aspect-auto md:h-full" />
            <div className="contents md:flex md:flex-col md:gap-4">
              <Piece src={carrusel1} width={600} height={600} label="Carrusel 1/3" alt="Pieza de carrusel cuadrada de los Vanta Court Low a $ 189.900" className="aspect-square" />
              <Piece src={carrusel2} width={600} height={600} label="Carrusel 2/3" alt="Pieza de carrusel cuadrada de los Astral Wave Runner a $ 174.900" className="aspect-square" />
            </div>
            <Piece src={historia} width={540} height={960} label="Historia · 9:16" alt="Historia vertical de los Volta Street Mid a $ 199.900 con botón para pedir por WhatsApp" className="aspect-[9/16] md:aspect-auto md:h-full" />
            <div className="contents md:flex md:min-w-0 md:flex-col md:gap-4">
              <Piece src={whatsapp} width={800} height={600} label="Para WhatsApp" alt="Pieza horizontal de los Vanta Court Low a $ 189.900 para compartir por WhatsApp" className="aspect-[4/3]" />
              <figure className="flex h-72 shrink-0 snap-start flex-col rounded-2xl bg-night-raised p-3 ring-1 ring-white/10 md:h-auto md:min-h-0 md:flex-1">
                <div className="flex min-h-0 flex-1 justify-center gap-1.5">
                  {[cuadro1, cuadro2, cuadro3].map((src, n) => <img key={src} src={src} alt={`Cuadro ${n + 1} de un video corto con tres productos de la tienda`} width={360} height={640} loading="lazy" decoding="async" className="video-frame aspect-[9/16] h-full w-auto rounded-lg object-cover" style={i(n)} />)}
                </div>
                <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-white/10" aria-hidden="true"><div className="video-progress h-full w-full origin-left rounded-full bg-[linear-gradient(90deg,#c52af1,#12dce7)]" /></div>
                <figcaption className="mt-2 flex items-center gap-2 text-[0.78rem] font-semibold text-mist"><Icon name="play" size={14} className="text-lime" />Cuadros de un video corto · 12 s</figcaption>
              </figure>
            </div>
          </div>
        </div>
        <p className="mt-5 text-[0.82rem] text-mist">Piezas generadas por el Estudio Creativo con productos, fotos y precios reales de la tienda de demostración SneakerHub Premium.</p>

        <div className="mt-16 grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
          <div data-reveal data-tilt="0.3" className="glass-dark rounded-[1.75rem] p-7 md:p-9">
            <div className="flex flex-wrap items-center gap-3"><h3 className="font-display text-2xl font-extrabold tracking-tight">Incluido en todos los planes</h3><Badge kind="live" onDark /></div>
            <p className="mt-2 text-mist">Se hace en tu navegador, sin inteligencia artificial y sin consumir créditos de IA.</p>
            <ul className="mt-7 grid gap-3 sm:grid-cols-2">
              {INCLUDED.map((t) => (
                <li key={t.name} className="rounded-2xl bg-white/5 p-4 ring-1 ring-inset ring-white/10">
                  <span className="grid size-10 place-items-center rounded-xl bg-lime text-night"><Icon name={t.icon} size={19} /></span>
                  <p className="mt-3 font-display font-bold">{t.name}</p>
                  <p className="mt-1 text-[0.92rem] leading-snug text-mist">{t.detail}</p>
                </li>
              ))}
            </ul>
          </div>
          <div data-reveal data-tilt="0.3" style={{ ...i(1), background: 'radial-gradient(30rem 20rem at 100% 0%, rgba(197,42,241,.5), transparent 65%), linear-gradient(160deg, #2b0b45, #12101f 70%)' }} className="relative overflow-hidden rounded-[1.75rem] p-7 ring-1 ring-inset ring-violet/40 md:p-9">
            <div className="flex flex-wrap items-center gap-3"><h3 className="font-display text-2xl font-extrabold tracking-tight">Fotografía con IA</h3><Badge kind="live" onDark label="Según las cuotas de tu plan" /></div>
            <p className="mt-2 text-mist">Usa las mejoras de fotografía con IA de tu plan. Antes de procesar ves cuántas vas a usar.</p>
            <ul className="mt-7 space-y-3">
              {WITH_AI.map((t) => (
                <li key={t.name} className="flex gap-3.5 rounded-2xl bg-white/5 p-4 ring-1 ring-inset ring-white/10">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-violet-deep text-white shadow-[0_0_20px_rgba(197,42,241,.6)]"><Icon name={t.icon} size={19} /></span>
                  <p><span className="block font-display font-bold">{t.name}</span><span className="mt-0.5 block text-[0.92rem] leading-snug text-mist">{t.detail}</span></p>
                </li>
              ))}
            </ul>
            <div className="mt-6 flex flex-wrap items-center gap-2">
              <Badge kind="soon" onDark />
              <ul className="flex flex-wrap gap-1.5 text-[0.82rem] text-mist">{SOON.map((item) => <li key={item} className="rounded-full bg-white/6 px-2.5 py-1 ring-1 ring-inset ring-white/10">{item}</li>)}</ul>
            </div>
          </div>
        </div>

        <div className="neon-border mt-4 rounded-2xl p-px">
        <div className="flex gap-4 rounded-[calc(1rem-1px)] bg-night p-5 text-[0.96rem] leading-relaxed text-mist md:p-6">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-lime/12 text-lime ring-1 ring-inset ring-lime/30"><Icon name="shield" size={22} /></span>
          <p><b className="text-porcelain">La foto real de tu producto sigue siendo la referencia.</b> La IA trabaja con reglas que le impiden inventar partes que no se ven en tu foto o cambiar formas, colores y logotipos. Como puede equivocarse, la original se conserva y tú comparas y apruebas cada resultado antes de publicarlo.</p>
        </div>
        </div>
      </div>
    </section>
  )
}
