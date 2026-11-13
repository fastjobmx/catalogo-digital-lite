// "Cómo funciona" in three steps. With motion: a sticky, scroll-driven story where the 3D phone
// (WebGL or CSS) turns between acts, its real screens crossfade and the pieces of each step fly in
// (GSAP ScrollTrigger). Reduced motion / no JS: the three cards with a real capture each.
import { useRef, type CSSProperties } from 'react'
import { site } from '../config/site'
import { categories, formatCOP, products, screens, type ScreenKey } from '../content/media'
import { Button, SectionHeading } from '../components/ui/primitives'
import { PhoneFrame } from '../components/ui/PhoneFrame'
import { Phone3D } from '../components/ui/Phone3D'
import { Icon } from '../components/ui/Icon'
import { useScrollScene } from '../motion/useScrollScene'
import { isNarrow, screenAcross, storyPose, STORY_SCREENS, STORY_SWITCHES, type PhoneDriver } from '../motion/pose'

const i = (n: number) => ({ '--i': n }) as CSSProperties
const address = `${new URL(site.appUrl).host}/t/tu-negocio`
const hero = products[0]

const STEPS: { title: string; body: string; screen: ScreenKey; alt: string }[] = [
  {
    title: 'Sube tus productos',
    body: 'Con fotos desde el panel, con tu lista en Excel o con un mensaje a tu asistente de Telegram. Cada producto queda con nombre, precio, tallas y descripción.',
    screen: 'product',
    alt: 'Captura real de una ficha de producto en el celular',
  },
  {
    title: 'Comparte tu enlace',
    body: `Tu tienda queda en una dirección propia, como ${address}. Compártela en tus estados, tus redes y tus conversaciones.`,
    screen: 'catalog',
    alt: 'Captura real de la tienda en el celular, con sus categorías',
  },
  {
    title: 'Recibe pedidos por WhatsApp',
    body: 'Tu cliente arma el carrito y te envía el pedido con productos, tallas y datos de entrega. Tú confirmas y acuerdas el pago.',
    screen: 'cart',
    alt: 'Captura real del carrito con el botón para enviar el pedido por WhatsApp',
  },
]

/** Scroll progress of the sticky track, written by ScrollTrigger and read by the phone each frame. */
const story = { progress: 0 }
const drive: PhoneDriver = (w) => ({ pose: storyPose(story.progress, isNarrow(w)), screen: screenAcross(story.progress, STORY_SWITCHES) })

function Acts() {
  return (
    <div className="pointer-events-none absolute inset-x-5 bottom-[max(1.5rem,5svh)] z-30 lg:inset-x-auto lg:bottom-auto lg:left-[max(2rem,5vw)] lg:top-1/2 lg:w-[min(32rem,38vw)] lg:-translate-y-1/2">
      {STEPS.map((step, n) => (
        <article key={step.title} className={`act act-${n} absolute bottom-0 left-0 right-0 opacity-0 lg:bottom-auto lg:top-1/2 lg:-translate-y-1/2`} aria-hidden="true">
          <p className="inline-grid h-10 min-w-12 place-items-center rounded-full bg-lime px-3 font-display text-[1.05rem] font-extrabold text-night shadow-[0_0_24px_rgba(217,255,20,.45)]">0{n + 1}</p>
          <h3 className="display mt-4 text-[clamp(2rem,8vw,3rem)] lg:text-[clamp(2.6rem,4.4vw,4.4rem)]">{step.title}</h3>
          <p className="mt-3 max-w-md text-[0.98rem] leading-relaxed text-mist lg:text-lg">{step.body}</p>
        </article>
      ))}
    </div>
  )
}

function Props() {
  return (
    <div className="pointer-events-none absolute inset-0 z-20" aria-hidden="true">
      {/* 1 — the photo becomes a product page */}
      <div className="prop-photo absolute left-[44%] top-[20%] w-[min(17vw,15rem)] opacity-0 max-lg:left-[5%] max-lg:top-[9%] max-lg:w-[30vw]">
        <div className="rounded-[1.4rem] bg-paper p-2 shadow-2xl ring-2 ring-violet/70">
          <img src={hero.src} alt="" width={480} height={480} loading="lazy" decoding="async" className="aspect-square w-full rounded-[1rem] object-cover" />
          <p className="flex items-center gap-1.5 px-1.5 pb-0.5 pt-2 text-[0.78rem] font-bold text-night"><Icon name="camera" size={15} /> Foto del producto</p>
        </div>
      </div>
      <div className="prop-tags absolute left-[80%] top-[26%] flex flex-col items-start gap-2.5 max-lg:left-auto max-lg:right-[4%] max-lg:top-[10%] max-lg:gap-1.5">
        {[
          ['Nombre', hero.name],
          ['Precio', formatCOP(hero.price)],
          ['Tallas', `${hero.sizes[0]} a ${hero.sizes[hero.sizes.length - 1]}`],
          ['Categoría', hero.category],
        ].map(([k, v]) => (
          <span key={k} className="tag glass-dark rounded-2xl px-3.5 py-2 text-porcelain opacity-0 max-lg:px-2.5 max-lg:py-1.5">
            <span className="block text-[0.66rem] font-bold uppercase tracking-wide text-cyan max-lg:text-[0.58rem]">{k}</span>
            <span className="block font-display text-[0.95rem] font-bold leading-tight max-lg:text-[0.76rem]">{v}</span>
          </span>
        ))}
      </div>
      {/* 2 — organised catalogue, shared by link */}
      <div className="prop-cats absolute left-[80%] top-[22%] flex flex-col gap-2 max-lg:left-auto max-lg:right-[4%] max-lg:top-[9%] max-lg:gap-1.5">
        {categories.slice(0, 5).map((c) => (
          <span key={c.slug} className="cat flex items-center justify-between gap-4 rounded-full bg-night-raised px-4 py-2.5 text-sm font-semibold text-porcelain opacity-0 ring-1 ring-violet/50 shadow-[0_0_24px_-6px_rgba(197,42,241,.6)] max-lg:gap-2 max-lg:px-3 max-lg:py-1.5 max-lg:text-[0.7rem]">
            {c.name}
            <span className="rounded-full bg-lime px-2 py-0.5 text-[0.72rem] font-bold text-night">{c.count}</span>
          </span>
        ))}
      </div>
      <div className="prop-link absolute left-[max(2rem,5vw)] top-[80%] opacity-0 max-lg:left-[4%] max-lg:top-[9%]">
        <div className="flex items-center gap-3 rounded-full bg-porcelain py-2 pl-2 pr-5 text-night shadow-[0_20px_50px_-12px_rgba(18,220,231,.55)] max-lg:pr-3">
          <span className="grid size-9 place-items-center rounded-full bg-violet-deep text-white max-lg:size-7"><Icon name="link" size={17} /></span>
          <span className="font-display text-sm font-bold max-lg:text-[0.7rem]">{address}</span>
        </div>
      </div>
      {/* 3 — the order arrives on WhatsApp */}
      <div className="prop-wa absolute left-[80%] top-[50%] w-[min(16vw,16rem)] opacity-0 max-lg:left-auto max-lg:right-[4%] max-lg:top-[34%] max-lg:w-[46vw]">
        <div className="rounded-[1.4rem] rounded-br-md bg-[#d9fdd3] p-3.5 text-[#0b2e1f] shadow-2xl max-lg:p-2.5">
          <p className="flex items-center gap-2 text-[0.8rem] font-bold max-lg:text-[0.7rem]"><Icon name="whatsapp" size={16} className="text-[#128c4a]" /> Pedido nuevo</p>
          <p className="mt-1.5 text-[0.85rem] leading-snug max-lg:text-[0.7rem]">1 × {hero.name}, talla {hero.sizes[Math.min(2, hero.sizes.length - 1)]}. Subtotal {formatCOP(hero.price)}.</p>
        </div>
      </div>
      <div className="prop-ok absolute left-[45%] top-[24%] opacity-0 max-lg:hidden">
        <span className="flex items-center gap-2 rounded-full bg-lime py-2 pl-2 pr-4 font-display text-sm font-extrabold text-night shadow-[0_0_30px_rgba(217,255,20,.5)]">
          <span className="grid size-7 place-items-center rounded-full bg-night text-lime"><Icon name="check" size={15} /></span>
          Pedido generado
        </span>
      </div>
    </div>
  )
}

function Rail() {
  return (
    <div className="rail absolute bottom-6 right-6 z-30 hidden gap-2 opacity-0 lg:flex" aria-hidden="true">
      {STEPS.map((step, n) => (
        <div key={step.title} className="w-28">
          <div className="h-1 overflow-hidden rounded-full bg-white/12"><div className={`rail-${n} h-full origin-left scale-x-0 rounded-full bg-[linear-gradient(90deg,#12dce7,#c52af1)]`} /></div>
          <p className="mt-2 text-xs font-semibold text-mist">Paso {n + 1}</p>
        </div>
      ))}
    </div>
  )
}

export function HowItWorks() {
  const track = useRef<HTMLDivElement>(null)

  useScrollScene(track, ({ gsap, ScrollTrigger }) => {
    const mm = gsap.matchMedia()
    mm.add({ motion: '(prefers-reduced-motion: no-preference)', narrow: '(max-width: 1023px)' }, (ctx) => {
      const { motion, narrow } = ctx.conditions as { motion: boolean; narrow: boolean }
      const box = track.current?.querySelector<HTMLElement>('.story-sticky')
      if (!motion || !track.current || !box) return
      // Where the phone's centre is during act 1, to fly the photo into it.
      const toPhone = (selector: string) => {
        const centre = () => { const p = storyPose(0.2, narrow); return { x: p.cx * box.clientWidth, y: p.cy * box.clientHeight } }
        const rect = () => { const r = box.querySelector(selector)!.getBoundingClientRect(); const b = box.getBoundingClientRect(); return { x: r.left - b.left + r.width / 2, y: r.top - b.top + r.height / 2 } }
        return { x: () => centre().x - rect().x, y: () => centre().y - rect().y }
      }
      const tl = gsap.timeline({
        defaults: { ease: 'none' },
        scrollTrigger: {
          trigger: track.current,
          start: 'top top',
          end: 'bottom bottom',
          scrub: 0.6,
          invalidateOnRefresh: true,
          onUpdate: (self) => { story.progress = self.progress },
        },
      })
      tl.to('.rail', { autoAlpha: 1, duration: 0.3 }, 0.2)
        // 1 · Sube tus productos
        .fromTo('.act-0', { autoAlpha: 0, y: 40 }, { autoAlpha: 1, y: 0, duration: 0.5, ease: 'power2.out' }, 0.3)
        .fromTo('.prop-photo', { autoAlpha: 0, scale: 0.8, rotate: -8 }, { autoAlpha: 1, scale: 1, rotate: -3, duration: 0.5, ease: 'back.out(1.6)' }, 0.5)
        .to('.prop-photo', { ...toPhone('.prop-photo'), scale: 0.2, rotate: 0, duration: 0.6, ease: 'power3.in' }, 1.2)
        .to('.prop-photo', { autoAlpha: 0, duration: 0.15 }, 1.7)
        .fromTo('.prop-tags .tag', { autoAlpha: 0, x: -50, scale: 0.8, rotateY: -40 }, { autoAlpha: 1, x: 0, scale: 1, rotateY: 0, duration: 0.45, stagger: 0.12, ease: 'back.out(1.7)' }, 1.85)
        .to('.prop-tags .tag', { autoAlpha: 0, x: 20, duration: 0.3, stagger: 0.04 }, 2.9)
        .to('.act-0', { autoAlpha: 0, y: -40, duration: 0.4 }, 2.95)
        .to('.rail-0', { scaleX: 1, duration: 2.8 }, 0.3)
        // 2 · Comparte tu enlace
        .fromTo('.act-1', { autoAlpha: 0, y: 40 }, { autoAlpha: 1, y: 0, duration: 0.5, ease: 'power2.out' }, 3.4)
        .fromTo('.prop-cats .cat', { autoAlpha: 0, x: 60, rotate: (n) => (n % 2 ? 8 : -8) }, { autoAlpha: 1, x: 0, rotate: 0, duration: 0.5, stagger: 0.1, ease: 'back.out(1.5)' }, 3.6)
        .fromTo('.prop-link', { autoAlpha: 0, y: 30, scale: 0.9 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.5, ease: 'back.out(1.6)' }, 4.2)
        .to(['.prop-cats .cat', '.prop-link'], { autoAlpha: 0, duration: 0.3, stagger: 0.02 }, 5.6)
        .to('.act-1', { autoAlpha: 0, y: -40, duration: 0.4 }, 5.8)
        .to('.rail-1', { scaleX: 1, duration: 2.6 }, 3.3)
        // 3 · Recibe pedidos por WhatsApp
        .fromTo('.act-2', { autoAlpha: 0, y: 40 }, { autoAlpha: 1, y: 0, duration: 0.5, ease: 'power2.out' }, 6.3)
        .fromTo('.prop-wa', { autoAlpha: 0, y: 40, scale: 0.85, transformOrigin: '100% 100%' }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.5, ease: 'back.out(1.6)' }, 6.6)
        .fromTo('.prop-ok', { autoAlpha: 0, scale: 0.6 }, { autoAlpha: 1, scale: 1, duration: 0.45, ease: 'back.out(2)' }, 7.2)
        .to('.rail-2', { scaleX: 1, duration: 2 }, 6.2)
        .to({}, { duration: 1.2 }, 8.2)
      ScrollTrigger.refresh()
    })
    return () => mm.revert()
  })

  return (
    <section id="como-funciona" aria-labelledby="como-funciona-title" className="on-dark relative bg-night text-porcelain">
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className="grid-fade absolute inset-0" />
      </div>
      <div className="wrap relative pt-24 md:pt-32">
        <div className="flex flex-col justify-between gap-8 lg:flex-row lg:items-end" data-reveal>
          <SectionHeading id="como-funciona-title" onDark eyebrow="Cómo funciona" title={<>De la foto al pedido, <span className="accent text-lime">en tres pasos.</span></>} intro="No necesitas programadores ni instalar aplicaciones. Si sabes usar WhatsApp, sabes usar tu tienda." />
          <Button href={site.trialUrl} variant="lime" size="lg" icon="arrowUpRight" external className="self-start lg:self-auto">Probar gratis</Button>
        </div>
      </div>

      {/* Cinematic version (html.motion). The acts are aria-hidden; the list below is their text. */}
      <div ref={track} className="motion-only story-track relative h-[340svh] lg:h-[380svh]">
        <div className="story-sticky sticky top-0 h-[100svh] overflow-hidden">
          <div className="pointer-events-none absolute left-[68%] top-1/2 size-[72vmin] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(197,42,241,.34),rgba(18,220,231,.1)_45%,transparent_70%)] max-lg:left-1/2 max-lg:top-[34%]" aria-hidden="true" />
          <div className="pedestal pointer-events-none !w-[min(34rem,46vw)] max-lg:!w-[78vw] left-[68%] top-[88%] max-lg:left-1/2 max-lg:top-[60%]" aria-hidden="true" />
          <div className="absolute inset-0 z-10">
            <Phone3D drive={drive} screenKeys={STORY_SCREENS} initial={storyPose(0.2, false)} sizes="(max-width: 1023px) 46vw, 26vw" />
          </div>
          <Acts />
          <Props />
          <Rail />
        </div>
      </div>

      <div className="wrap relative pb-24 md:pb-32">
        <ol className="still-only mt-16 grid gap-5 lg:grid-cols-3">
          {STEPS.map((step, n) => (
            <li key={step.title} data-reveal style={i(n)} className="relative flex flex-col overflow-hidden rounded-3xl bg-night-raised/70 ring-1 ring-inset ring-white/8">
              <div className="p-7 md:p-8">
                <p className="inline-grid h-10 min-w-12 place-items-center rounded-full bg-lime px-3 font-display text-[1.05rem] font-extrabold text-night shadow-[0_0_24px_rgba(217,255,20,.45)]" aria-hidden="true">0{n + 1}</p>
                <h3 className="mt-3 font-display text-[1.6rem] font-extrabold leading-tight tracking-tight"><span className="sr-only">Paso {n + 1}: </span>{step.title}</h3>
                <p className="mt-3 text-[1rem] leading-relaxed text-mist">{step.body}</p>
              </div>
              <div className="mt-auto flex h-64 justify-center overflow-hidden px-8 [mask-image:linear-gradient(to_bottom,#000_70%,transparent)] sm:h-72">
                <PhoneFrame src={screens[step.screen]} alt={step.alt} width="13.5rem" className="neon-rim self-start" />
              </div>
            </li>
          ))}
        </ol>
        <ol className="motion-only sr-only">
          {STEPS.map((step, n) => <li key={step.title}><h3>Paso {n + 1}: {step.title}</h3><p>{step.body}</p></li>)}
        </ol>
        <p className="mt-6 text-[0.8rem] text-mist">Pantallas reales de la tienda piloto SneakerHub Premium.</p>
      </div>
    </section>
  )
}
