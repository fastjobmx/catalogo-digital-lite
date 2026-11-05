// Hero + cinematic story ("De una foto a un negocio en movimiento").
// One sticky stage: the hero's dark stage grows to full screen and the phone carries the
// three acts (Mostrá · Organizá · Vendé), driven by scroll. Reduced motion / no JS: the first
// frame stays still and the acts are listed below (html:not(.motion)).
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useScrollScene } from '../motion/useScrollScene'
import { story } from '../motion/state'
import { canUse3D } from '../motion/capabilities'
import { isNarrow, poseAt, screenAt, SCREEN_ORDER } from '../motion/pose'
import { acts } from '../content/copy'
import { categories, formatCOP, products, screens, screenSrcSet } from '../content/media'
import { site } from '../config/site'
import { Badge, Button, Swoosh } from '../components/ui/primitives'
import { Icon } from '../components/ui/Icon'
import { Logo } from '../components/brand/Logo'
import { PhoneFrame } from '../components/ui/PhoneFrame'

const PhoneCanvas = lazy(() => import('../three/PhoneCanvas'))
const [heroProduct, ...floatProducts] = products

function HeroCopy() {
  return (
    <div className="hero-copy relative z-20 flex flex-col justify-center pb-6 pt-24 lg:absolute lg:inset-y-0 lg:left-0 lg:h-[100svh] lg:w-[47%] lg:pb-12 lg:pt-24">
      <div className="pl-4 pr-4 lg:pl-8 xl:pl-12">
        <p className="intro-1 mb-5 flex items-center gap-3 text-[0.95rem] font-semibold text-ink-soft lg:mb-8">
          <Logo variant="isotipo" width={34} decorative priority />
          {site.concept}
        </p>
        <h1 className="display text-[min(14.5vw,8.6svh)] text-forest lg:text-[clamp(3.4rem,7.1vw,8.4rem)]">
          <span className="intro-line -mt-[0.16em] block overflow-hidden pb-[0.04em] pt-[0.16em]"><span className="block">Si no lo</span></span>
          <span className="intro-line -mt-[0.16em] block overflow-hidden pb-[0.04em] pt-[0.16em]">
            <span className="block">
              <mark className="rounded-[0.12em] bg-lime px-[0.08em] text-forest [box-decoration-break:clone]">Mostrás,</mark>
            </span>
          </span>
          <span className="intro-line -mt-[0.16em] block overflow-hidden pb-[0.04em] pt-[0.16em]"><span className="block">no lo</span></span>
          <span className="intro-line -mt-[0.16em] block overflow-hidden pb-[0.16em] pt-[0.16em]">
            <span className="block">
              <Swoosh className="intro-swoosh">vendés.</Swoosh>
            </span>
          </span>
        </h1>
        <p className="intro-2 mt-5 max-w-[34rem] lg:mt-7 text-lg leading-relaxed text-ink-soft lg:text-xl">
          Creá tu tienda digital, mostrá tus productos y administrá tu catálogo con inteligencia artificial.
        </p>
        <div className="intro-3 mt-6 flex flex-col gap-3 lg:mt-8 xs:flex-row xs:flex-wrap">
          <Button href="#contacto" variant="forest" size="lg" icon="arrowRight">Quiero mi tienda</Button>
          <Button href={site.demoStoreUrl} variant="outline-dark" size="lg" icon="arrowUpRight" external>Ver una tienda real</Button>
        </div>
        <p className="intro-3 mt-4 text-[0.95rem] text-ink-soft">
          ¿Querés verlo con tus productos? <a href={site.trialUrl} target="_blank" rel="noopener noreferrer" className="font-bold text-forest underline decoration-lime decoration-[3px] underline-offset-4 hover:decoration-forest">Probalo gratis, sin registrarte<span className="sr-only"> (se abre en una pestaña nueva)</span></a>
        </p>
      </div>
    </div>
  )
}

function CssPhone({ posterRef, hidden, allScreens }: { posterRef: React.RefObject<HTMLDivElement | null>; hidden: boolean; allScreens: boolean }) {
  return (
    <div
      ref={posterRef}
      className="css-phone absolute will-change-transform transition-opacity duration-700"
      style={{ opacity: hidden ? 0 : 1 }}
      aria-hidden="true"
    >
      <PhoneFrame width="100%" eager fill className="size-full">
        {SCREEN_ORDER.slice(0, allScreens ? SCREEN_ORDER.length : 1).map((key, index) => (
          <img key={key} fetchPriority={index === 0 ? 'high' : 'low'} data-screen={index} src={screens[key]} srcSet={screenSrcSet[key]} sizes="(max-width: 1023px) 62vw, 24vw" alt="" width={390} height={844} decoding="async" className="absolute inset-0 size-full object-cover object-top" style={{ opacity: index === 0 ? 1 : 0 }} />
        ))}
      </PhoneFrame>
    </div>
  )
}

function FloatCard({ product, className }: { product: (typeof products)[number]; className: string }) {
  return (
    <div className={`float-card absolute z-10 w-[clamp(9.5rem,13vw,13rem)] ${className}`}>
      <div className="float-inner rounded-3xl bg-paper p-2.5 pb-3 shadow-[0_30px_60px_-28px_rgba(6,20,15,.65)] ring-1 ring-forest/5">
        <img src={product.src} alt="" width={480} height={480} loading="lazy" decoding="async" className="aspect-square w-full rounded-[1.1rem] object-cover" />
        <p className="mt-2.5 px-1 text-[0.7rem] font-bold uppercase tracking-wide text-ink-soft">{product.brand}</p>
        <p className="px-1 font-display text-[0.95rem] font-bold leading-tight text-forest">{product.name}</p>
        <p className="mt-1 px-1 text-sm font-semibold text-forest">{formatCOP(product.price)}</p>
      </div>
    </div>
  )
}

function Chip({ icon, label, className }: { icon: Parameters<typeof Icon>[0]['name']; label: string; className: string }) {
  return (
    <div className={`micro absolute z-10 flex items-center gap-2 rounded-full bg-forest-raised/90 py-2 pl-2 pr-4 text-sm font-semibold text-ivory shadow-xl ring-1 ring-ivory/10 backdrop-blur ${className}`}>
      <span className="grid size-8 place-items-center rounded-full bg-lime text-forest"><Icon name={icon} size={17} /></span>
      {label}
    </div>
  )
}

function Acts() {
  return (
    <div className="pointer-events-none absolute inset-x-4 bottom-[max(1.25rem,4svh)] z-30 lg:inset-x-auto lg:bottom-auto lg:left-[max(2rem,5vw)] lg:top-1/2 lg:w-[min(34rem,36vw)] lg:-translate-y-1/2">
      {acts.map((act, index) => (
        <article key={act.id} className={`act act-${index} absolute bottom-0 left-0 right-0 opacity-0 lg:bottom-auto lg:top-1/2 lg:-translate-y-1/2`} aria-hidden="true">
          <p className="mb-2 font-display text-sm font-semibold text-mist lg:mb-4">{index + 1} de 3</p>
          <p className="display text-[clamp(3.2rem,15vw,5rem)] text-lime lg:text-[clamp(4.5rem,8.5vw,9rem)]">{act.verb}</p>
          <h3 className="mt-3 font-display text-[clamp(1.35rem,5.6vw,1.75rem)] font-bold leading-tight text-ivory lg:mt-6 lg:text-[clamp(1.6rem,2.3vw,2.4rem)]">{act.title}</h3>
          <p className="mt-2 max-w-md text-[0.98rem] leading-relaxed text-mist lg:mt-4 lg:text-lg">{act.body}</p>
        </article>
      ))}
    </div>
  )
}

function ActProps() {
  const kinetik = heroProduct
  return (
    <div className="pointer-events-none absolute inset-0 z-20" aria-hidden="true">
      {/* A — photo becomes a product page */}
      <div className="prop-photo absolute left-[46%] top-[24%] w-[min(19vw,17rem)] opacity-0 max-lg:left-[6%] max-lg:top-[15%] max-lg:w-[36vw]">
        <div className="rounded-[1.6rem] bg-paper p-2 shadow-2xl">
          <img src={kinetik.src} alt="" width={480} height={480} loading="lazy" decoding="async" className="aspect-square w-full rounded-[1.2rem] object-cover" />
          <p className="flex items-center gap-1.5 px-1.5 pb-0.5 pt-2 text-[0.78rem] font-bold text-forest"><Icon name="camera" size={15} /> Foto del producto</p>
        </div>
      </div>
      <div className="prop-tags absolute left-[80%] top-[30%] flex flex-col items-start gap-2.5 max-lg:left-auto max-lg:right-[3%] max-lg:top-[16%] max-lg:gap-1.5">
        {[
          ['Nombre', kinetik.name],
          ['Precio', formatCOP(kinetik.price)],
          ['Tallas', `${kinetik.sizes[0]} a ${kinetik.sizes[kinetik.sizes.length - 1]}`],
          ['Categoría', kinetik.category],
        ].map(([k, v]) => (
          <span key={k} className="tag rounded-2xl bg-ivory px-3.5 py-2 text-forest opacity-0 shadow-lg max-lg:px-2.5 max-lg:py-1.5">
            <span className="block text-[0.68rem] font-bold uppercase tracking-wide text-ink-soft max-lg:text-[0.6rem]">{k}</span>
            <span className="block font-display text-[0.95rem] font-bold leading-tight max-lg:text-[0.78rem]">{v}</span>
          </span>
        ))}
      </div>
      {/* B — organised catalogue */}
      <div className="prop-cats absolute left-[81%] top-[24%] flex flex-col gap-2 max-lg:left-auto max-lg:right-[3%] max-lg:top-[15%] max-lg:gap-1.5">
        {categories.map((c) => (
          <span key={c.slug} className="cat flex items-center justify-between gap-4 rounded-full bg-forest-raised px-4 py-2.5 text-sm font-semibold text-ivory opacity-0 ring-1 ring-lime/30 max-lg:gap-2 max-lg:px-3 max-lg:py-1.5 max-lg:text-[0.72rem]">
            {c.name}
            <span className="rounded-full bg-lime px-2 py-0.5 text-[0.72rem] font-bold text-forest">{c.count}</span>
          </span>
        ))}
      </div>
      <div className="prop-sizes absolute left-[81%] top-[62%] grid w-[10.5rem] grid-cols-3 gap-2 max-lg:hidden">
        {kinetik.sizes.map((size) => (
          <span key={size} className="size grid size-11 place-items-center rounded-xl bg-ivory font-display text-sm font-bold text-forest opacity-0 shadow-lg">{size}</span>
        ))}
      </div>
      {/* C — share and receive the order on WhatsApp */}
      <div className="prop-wa absolute left-[82.5%] top-[54%] w-[min(15.5vw,16rem)] opacity-0 max-lg:left-auto max-lg:right-[3%] max-lg:top-[44%] max-lg:w-[48vw]">
        <div className="rounded-[1.4rem] rounded-br-md bg-[#d9fdd3] p-3.5 text-[#0b2e1f] shadow-2xl max-lg:p-2.5">
          <p className="flex items-center gap-2 text-[0.8rem] font-bold max-lg:text-[0.7rem]"><Icon name="whatsapp" size={16} className="text-[#128c4a]" /> Pedido nuevo</p>
          <p className="mt-1.5 text-[0.85rem] leading-snug max-lg:text-[0.72rem]">1 × {kinetik.name}, talla {kinetik.sizes[2]}. Subtotal {formatCOP(kinetik.price)}.</p>
        </div>
      </div>
      <div className="prop-link absolute left-[max(2rem,5vw)] top-[76%] opacity-0 max-lg:left-[4%] max-lg:top-[14%]">
        <div className="flex items-center gap-3 rounded-full bg-ivory py-2 pl-2 pr-5 text-forest shadow-2xl max-lg:pr-3">
          <span className="grid size-9 place-items-center rounded-full bg-forest text-lime max-lg:size-7"><Icon name="link" size={17} /></span>
          <span className="font-display text-sm font-bold max-lg:text-[0.72rem]">Compartí tu enlace</span>
          <span className="flex gap-1.5 text-forest max-lg:hidden"><Icon name="whatsapp" size={16} /><Icon name="instagram" size={16} /><Icon name="facebook" size={16} /></span>
        </div>
      </div>
    </div>
  )
}

function Rail() {
  return (
    <div className="rail absolute bottom-6 right-6 z-30 hidden gap-2 opacity-0 lg:flex" aria-hidden="true">
      {acts.map((act, index) => (
        <div key={act.id} className="w-24">
          <div className="h-1 overflow-hidden rounded-full bg-ivory/15"><div className={`rail-fill rail-${index} h-full origin-left scale-x-0 rounded-full bg-lime`} /></div>
          <p className="mt-2 text-xs font-semibold text-mist">{act.verb}</p>
        </div>
      ))}
    </div>
  )
}

function StillActs() {
  return (
    <div className="still-only bg-forest py-20 text-ivory md:py-28">
      <div className="wrap grid grid-cols-1 gap-16 md:gap-24">
        {acts.map((act, index) => (
          <article key={act.id} className="grid items-center gap-8 md:grid-cols-[1fr_auto] md:gap-16">
            <div>
              <p className="mb-3 font-display text-sm font-semibold text-mist">{index + 1} de 3</p>
              <p className="display text-[clamp(3.2rem,9vw,7rem)] text-lime">{act.verb}</p>
              <h3 className="mt-4 font-display text-2xl font-bold text-ivory md:text-4xl">{act.title}</h3>
              <p className="mt-3 max-w-xl text-lg text-mist">{act.body}</p>
            </div>
            <PhoneFrame src={screens[act.screen]} alt={`Captura real de SneakerHub: ${act.screen === 'cart' ? 'carrito con envío del pedido por WhatsApp' : act.screen === 'catalog' ? 'catálogo por categorías' : 'ficha de producto'}`} width={260} className="mx-auto" />
          </article>
        ))}
      </div>
    </div>
  )
}

export function Story() {
  const track = useRef<HTMLDivElement>(null)
  const sticky = useRef<HTMLDivElement>(null)
  const poster = useRef<HTMLDivElement>(null)
  const [use3D, setUse3D] = useState(false)
  const [ready3D, setReady3D] = useState(false)
  const [active, setActive] = useState(true)

  const [allScreens, setAllScreens] = useState(false)
  const posterLive = useRef(true)
  posterLive.current = !ready3D && active

  // WebGL is decided after the page is idle, and on small screens only after the first scroll,
  // so the hero (HTML + CSS phone) is never blocked by it. The other screens load the same way.
  useEffect(() => {
    let done = false
    const start = () => {
      if (done) return
      done = true
      setAllScreens(true)
      setUse3D(canUse3D())
    }
    const narrow = window.innerWidth < 1024
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback
    const onFirstScroll = () => start()
    window.addEventListener('scroll', onFirstScroll, { once: true, passive: true })
    let timer = 0
    if (!narrow) {
      const afterLoad = () => { timer = window.setTimeout(() => (idle ? idle(start, { timeout: 1500 }) : start()), 1200) }
      if (document.readyState === 'complete') afterLoad()
      else window.addEventListener('load', afterLoad, { once: true })
    }
    return () => { window.removeEventListener('scroll', onFirstScroll); window.clearTimeout(timer) }
  }, [])

  // Render the phone only while the stage is on screen.
  useEffect(() => {
    const el = sticky.current
    if (!el) return
    const io = new IntersectionObserver(([entry]) => setActive(entry.isIntersecting), { rootMargin: '10% 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  // CSS phone follows the same pose as the 3D phone (it is the phone when WebGL is unavailable).
  // It only works while visible, while the 3D phone is not shown, and while something changes.
  useEffect(() => {
    if (!document.documentElement.classList.contains('motion')) return
    let raf = 0
    let smooth = story.progress
    let last = ''
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const el = poster.current
      const box = sticky.current
      if (!el || !box || !posterLive.current) return
      smooth += (story.progress - smooth) * 0.12
      const w = box.clientWidth
      const h = box.clientHeight
      const key = `${w}x${h}:${smooth.toFixed(4)}:${story.pointerX.toFixed(2)}:${story.pointerY.toFixed(2)}`
      if (key === last) return
      last = key
      const pose = poseAt(smooth, isNarrow(w, h))
      const height = pose.h * h
      const width = height * 0.49
      const heroWeight = Math.max(0, 1 - smooth / 0.13)
      el.style.width = `${width}px`
      el.style.height = `${height}px`
      el.style.left = `${pose.cx * w - width / 2}px`
      el.style.top = `${pose.cy * h - height / 2}px`
      el.style.transform = `perspective(1600px) rotateX(${-(pose.rx + story.pointerY * 0.08 * heroWeight)}rad) rotateY(${pose.ry + story.pointerX * 0.14 * heroWeight}rad) rotateZ(${-pose.rz}rad)`
      const screen = screenAt(smooth)
      el.querySelectorAll<HTMLImageElement>('img[data-screen]').forEach((img) => {
        const i = Number(img.dataset.screen)
        img.style.opacity = String(Math.max(0, 1 - Math.abs(screen - i)))
      })
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [])

  // Pointer parallax (fine pointers only): CSS variables, eased by a CSS transition.
  useEffect(() => {
    const box = sticky.current
    if (!box || !window.matchMedia('(pointer: fine)').matches) return
    const move = (e: PointerEvent) => {
      const r = box.getBoundingClientRect()
      story.pointerX = ((e.clientX - r.left) / r.width) * 2 - 1
      story.pointerY = ((e.clientY - r.top) / r.height) * 2 - 1
      box.style.setProperty('--px', story.pointerX.toFixed(3))
      box.style.setProperty('--py', story.pointerY.toFixed(3))
    }
    box.addEventListener('pointermove', move)
    return () => box.removeEventListener('pointermove', move)
  }, [])

  useScrollScene(track, ({ gsap, ScrollTrigger }) => {
    const mm = gsap.matchMedia()
    mm.add({ motion: '(prefers-reduced-motion: no-preference)', narrow: '(max-width: 1023px)' }, (ctx) => {
      const { motion, narrow } = ctx.conditions as { motion: boolean; narrow: boolean }
      if (!motion || !track.current || !sticky.current) return
      const stage = sticky.current.querySelector('.stage')
      const heroInset = () => {
        const w = sticky.current!.clientWidth
        return narrow ? 'inset(12px 12px 12px 12px round 28px)' : `inset(${Math.round(Math.max(88, window.innerHeight * 0.1))}px 24px 24px ${Math.round(w * 0.47)}px round 32px)`
      }
      const phoneCenter = () => {
        const w = sticky.current!.clientWidth
        const h = sticky.current!.clientHeight
        const pose = poseAt(0.3, isNarrow(w, h))
        return { x: pose.cx * w, y: pose.cy * h }
      }
      const toPhone = (selector: string) => ({
        x: () => { const el = sticky.current!.querySelector(selector)!; const r = el.getBoundingClientRect(); const b = sticky.current!.getBoundingClientRect(); return phoneCenter().x - (r.left - b.left + r.width / 2) },
        y: () => { const el = sticky.current!.querySelector(selector)!; const r = el.getBoundingClientRect(); const b = sticky.current!.getBoundingClientRect(); return phoneCenter().y - (r.top - b.top + r.height / 2) },
      })

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
      tl.fromTo(stage, { clipPath: heroInset }, { clipPath: 'inset(0px 0px 0px 0px round 0px)', duration: 1.3, ease: 'power2.inOut' }, 0)
        .to('.float-card', { yPercent: (i) => [-60, 40, 70][i] ?? 0, xPercent: (i) => [-30, 40, 10][i] ?? 0, scale: 0.85, autoAlpha: 0, duration: 1.1, ease: 'power2.in', stagger: 0.05 }, 0)
        .to('.micro', { autoAlpha: 0, scale: 0.8, duration: 0.6, stagger: 0.05 }, 0.1)
        .to('.stage-caption', { autoAlpha: 0, duration: 0.4 }, 0)
        .to('.rail', { autoAlpha: 1, duration: 0.4 }, 1.1)
        // Act A
        .fromTo('.act-0', { autoAlpha: 0, y: 40 }, { autoAlpha: 1, y: 0, duration: 0.5, ease: 'power2.out' }, 1.4)
        .fromTo('.prop-photo', { autoAlpha: 0, scale: 0.85, rotate: -6 }, { autoAlpha: 1, scale: 1, rotate: -3, duration: 0.5, ease: 'back.out(1.6)' }, 1.6)
        .to('.prop-photo', { ...toPhone('.prop-photo'), scale: 0.22, rotate: 0, duration: 0.6, ease: 'power3.in' }, 2.3)
        .to('.prop-photo', { autoAlpha: 0, duration: 0.18 }, 2.78)
        .fromTo('.prop-tags .tag', { autoAlpha: 0, x: -50, scale: 0.8 }, { autoAlpha: 1, x: 0, scale: 1, duration: 0.45, stagger: 0.12, ease: 'back.out(1.7)' }, 3.05)
        .to('.prop-tags .tag', { autoAlpha: 0, x: 20, duration: 0.35, stagger: 0.04 }, 3.9)
        .to('.act-0', { autoAlpha: 0, y: -40, duration: 0.4 }, 3.95)
        .to('.rail-0', { scaleX: 1, duration: 2.6 }, 1.4)
        // Act B
        .fromTo('.act-1', { autoAlpha: 0, y: 40 }, { autoAlpha: 1, y: 0, duration: 0.5, ease: 'power2.out' }, 4.4)
        .fromTo('.prop-cats .cat', { autoAlpha: 0, x: 60, rotate: (i) => (i % 2 ? 8 : -8) }, { autoAlpha: 1, x: 0, rotate: 0, duration: 0.5, stagger: 0.1, ease: 'back.out(1.5)' }, 4.6)
        .fromTo('.prop-sizes .size', { autoAlpha: 0, y: 30 }, { autoAlpha: 1, y: 0, duration: 0.4, stagger: 0.06, ease: 'back.out(2)' }, 5.0)
        .to(['.prop-cats .cat', '.prop-sizes .size'], { autoAlpha: 0, duration: 0.35, stagger: 0.02 }, 6.3)
        .to('.act-1', { autoAlpha: 0, y: -40, duration: 0.4 }, 6.5)
        .to('.rail-1', { scaleX: 1, duration: 2.5 }, 4.2)
        // Act C
        .fromTo('.act-2', { autoAlpha: 0, y: 40 }, { autoAlpha: 1, y: 0, duration: 0.5, ease: 'power2.out' }, 6.9)
        .fromTo('.prop-link', { autoAlpha: 0, y: 30, scale: 0.9 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.5, ease: 'back.out(1.6)' }, 7.2)
        .fromTo('.prop-wa', { autoAlpha: 0, y: 40, scale: 0.85, transformOrigin: '100% 100%' }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.5, ease: 'back.out(1.6)' }, 7.7)
        .to('.rail-2', { scaleX: 1, duration: 2 }, 6.8)
        .to({}, { duration: 1.4 }, 8.6)
      ScrollTrigger.refresh()
    })
    return () => mm.revert()
  })

  return (
    <section id="inicio" aria-labelledby="hero-title" className="relative bg-ivory">
      <h2 id="hero-title" className="sr-only">Inicio</h2>
      <HeroCopy />
      <div ref={track} className="story-track">
        <span id="como-funciona" className="story-anchor block" aria-hidden="true" />
        <div ref={sticky} className="story-sticky h-[86svh] lg:h-[100svh]">
          <div className="stage grain on-dark absolute inset-0 bg-forest [clip-path:inset(12px_12px_12px_12px_round_28px)] lg:[clip-path:inset(max(88px,10svh)_24px_24px_47%_round_32px)]">
            <div className="absolute left-[68%] top-1/2 size-[70vmin] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(198,242,91,.28),rgba(198,242,91,.06)_45%,transparent_70%)] max-lg:left-1/2 max-lg:top-[40%]" aria-hidden="true" />
            <p className="stage-caption absolute right-[calc(24px+1.5rem)] top-[calc(max(88px,10svh)+1.25rem)] z-10 max-w-[15rem] text-right text-xs leading-snug text-mist max-lg:bottom-6 max-lg:left-6 max-lg:right-6 max-lg:top-auto max-lg:max-w-none max-lg:text-left">
              Capturas y productos reales de SneakerHub, la tienda piloto.
            </p>
          </div>

          <div className="absolute inset-0 z-[5]">
            {use3D ? (
              <Suspense fallback={null}>
                <div className="absolute inset-0 transition-opacity duration-700" style={{ opacity: ready3D ? 1 : 0 }}>
                  <PhoneCanvas active={active} onReady={() => setReady3D(true)} />
                </div>
              </Suspense>
            ) : null}
            <CssPhone posterRef={poster} hidden={ready3D} allScreens={allScreens} />
          </div>

          <FloatCard product={floatProducts[0]} className="left-[46%] top-[19%] -rotate-[5deg] max-lg:hidden" />
          <FloatCard product={floatProducts[1]} className="right-[3.5%] top-[56%] rotate-[4deg] max-lg:hidden" />
          <FloatCard product={floatProducts[2]} className="left-[51%] top-[66%] rotate-[2deg] max-lg:hidden" />
          <Chip icon="camera" label="Foto" className="left-[85%] top-[24%] max-lg:left-auto max-lg:right-[7%] max-lg:top-[16%]" />
          <Chip icon="whatsapp" label="Mensaje" className="left-[57%] top-[44%] max-lg:left-[6%] max-lg:top-[44%]" />
          <Chip icon="cart" label="Venta" className="left-[84%] top-[40%] max-lg:left-auto max-lg:right-[6%] max-lg:top-[70%]" />

          <div className="motion-only">
            <Acts />
            <ActProps />
            <Rail />
          </div>
        </div>
      </div>
      <StillActs />
      <ScreenReaderStory />
    </section>
  )
}

/** The cinematic acts are aria-hidden; this is their accessible version. */
function ScreenReaderStory() {
  return (
    <div className="sr-only motion-only">
      <h2>Cómo funciona</h2>
      <ol>
        {acts.map((act) => (
          <li key={act.id}><strong>{act.verb}.</strong> {act.title} {act.body}</li>
        ))}
      </ol>
      <p><Badge kind="real" /> Las pantallas son capturas reales de la tienda piloto SneakerHub.</p>
    </div>
  )
}
