// Cover. The phone screen and the floating product cards are real (SneakerHub Premium pilot store,
// src/content/media.ts, with its real prices); the "Nuevo pedido" notification is an illustration
// of how an order reaches WhatsApp, and the caption says so.
// The phone is 3D: WebGL when the device allows it, a CSS perspective phone otherwise. It follows
// the pointer, turns as the hero scrolls away and cycles through the real screens.
import { useEffect, useRef, type CSSProperties } from 'react'
import { site } from '../config/site'
import { formatCOP, products, store as pilot } from '../content/media'
import { Button } from '../components/ui/primitives'
import { Phone3D } from '../components/ui/Phone3D'
import { HERO_SCREENS, heroPose, heroScreen, type PhoneDriver } from '../motion/pose'
import { Icon } from '../components/ui/Icon'
import { Mascot, Sparks, Swoosh } from '../components/brand/Decor'

const i = (n: number) => ({ '--i': n }) as CSSProperties
const tilt = (n: number, r: number) => ({ '--i': n, '--r': `${r}deg` }) as CSSProperties
const depth = (z: number) => ({ '--z': z }) as CSSProperties
const byName = (sku: string) => products.find((p) => p.sku === sku) ?? products[0]

function FloatingProduct({ sku, className, index, rotate, z }: { sku: string; className: string; index: number; rotate: number; z: number }) {
  const product = byName(sku)
  if (!product) return null
  return (
    <div className={`parallax absolute z-30 ${className}`} style={depth(z)}>
    <figure className="float tilt-3d w-[7.5rem] rounded-2xl bg-paper p-1.5 text-night shadow-[0_30px_60px_-24px_rgba(0,0,0,.7)] sm:w-40" style={tilt(index, rotate)}>
      <img src={product.src} alt={`${product.name}, producto real de ${pilot.name}`} width={480} height={480} loading="eager" decoding="async" className="aspect-square w-full rounded-xl bg-porcelain object-cover" />
      <figcaption className="flex items-end justify-between gap-1 px-1.5 pb-1 pt-2">
        <span className="min-w-0">
          <span className="block truncate text-[0.74rem] font-semibold leading-tight sm:text-[0.8rem]">{product.name}</span>
          <span className="block whitespace-nowrap font-display text-[0.88rem] font-extrabold tracking-tight sm:text-[0.95rem]">{formatCOP(product.price)}</span>
        </span>
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-lime" aria-hidden="true"><Icon name="cart" size={14} /></span>
      </figcaption>
    </figure>
    </div>
  )
}

export function Hero() {
  const root = useRef<HTMLElement>(null)
  const input = useRef({ px: 0, py: 0, scroll: 0 })
  const drive: PhoneDriver = (_w, _h, t) => {
    const { px, py, scroll } = input.current
    return { pose: heroPose(scroll, px, py), screen: heroScreen(t) }
  }

  // Pointer (fine pointers only) and scroll feed the phone and the parallax layers (--px, --py, --sp).
  useEffect(() => {
    const el = root.current
    if (!el || !document.documentElement.classList.contains('motion')) return
    let raf = 0
    const write = () => {
      raf = 0
      const r = el.getBoundingClientRect()
      input.current.scroll = Math.min(1, Math.max(0, -r.top / Math.max(r.height, 1)))
      el.style.setProperty('--px', input.current.px.toFixed(3))
      el.style.setProperty('--py', input.current.py.toFixed(3))
      el.style.setProperty('--sp', input.current.scroll.toFixed(3))
    }
    const queue = () => { if (!raf) raf = requestAnimationFrame(write) }
    const move = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      const r = el.getBoundingClientRect()
      input.current.px = ((e.clientX - r.left) / r.width) * 2 - 1
      input.current.py = ((e.clientY - r.top) / r.height) * 2 - 1
      queue()
    }
    const leave = () => { input.current.px = 0; input.current.py = 0; queue() }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerleave', leave)
    window.addEventListener('scroll', queue, { passive: true })
    write()
    return () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerleave', leave)
      window.removeEventListener('scroll', queue)
      cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <section ref={root} id="inicio" aria-labelledby="inicio-title" className="on-dark relative overflow-hidden bg-night pb-16 pt-28 text-porcelain md:pb-24 md:pt-36 lg:pt-36">
      <div className="grid-fade pointer-events-none absolute inset-0" aria-hidden="true" />
      <div className="pointer-events-none absolute -right-32 top-0 size-[48rem] rounded-full bg-[radial-gradient(closest-side,rgba(18,220,231,.16),transparent)]" aria-hidden="true" />
      <div className="pointer-events-none absolute -left-52 bottom-[-20rem] size-[46rem] rounded-full bg-[radial-gradient(closest-side,rgba(197,42,241,.32),transparent)]" aria-hidden="true" />
      <div className="pointer-events-none absolute right-[18%] top-[30%] size-[30rem] rounded-full bg-[radial-gradient(closest-side,rgba(197,42,241,.34),transparent)]" aria-hidden="true" />

      <div className="wrap relative grid grid-cols-1 items-center gap-12 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,1fr)] lg:gap-6 xl:gap-10">
        <div className="relative z-10 min-w-0">
          {/* The h1 carries both the visible badge (the search phrase) and the headline. */}
          <h1 id="inicio-title">
            <span className="hero-in inline-flex items-center gap-2 rounded-full bg-white/6 py-1.5 pl-2 pr-3.5 font-body text-[0.84rem] font-semibold not-italic tracking-normal text-porcelain ring-1 ring-inset ring-white/12" style={i(0)}>
              <span className="grid size-6 place-items-center rounded-full bg-lime text-night" aria-hidden="true"><Icon name="whatsapp" size={13} /></span>
              Tienda online con IA y pedidos por WhatsApp<span className="sr-only">:</span>
            </span>
            <span className="display hero-in mt-6 block text-[clamp(2.4rem,4.6vw,3.85rem)] italic" style={i(1)}>
              Tu negocio merece algo mejor que enviar fotos{' '}
              <span className="relative inline-block whitespace-nowrap">
                <span className="accent accent-gradient">una por una.</span>
                <Swoosh className="absolute -bottom-3 left-0 w-[92%]" />
              </span>
            </span>
          </h1>
          <p className="hero-in mt-8 max-w-xl text-lg leading-relaxed text-mist md:text-[1.25rem]" style={i(2)}>
            Crea tu tienda online, adminístrala con inteligencia artificial y recibe los pedidos directamente por <strong className="font-bold text-porcelain">WhatsApp</strong>.
          </p>
          <div className="hero-in mt-9 flex flex-col gap-3 xs:flex-row xs:flex-wrap" style={i(3)}>
            <Button href={site.trialUrl} variant="lime" size="lg" lead="store" icon="arrowRight" external>Crear mi tienda gratis</Button>
            <Button href="#como-funciona" variant="outline-light" size="lg" lead="play">Ver cómo funciona</Button>
          </div>
          <p className="hero-in mt-6 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.95rem] text-mist" style={i(4)}>
            <span>¿Prefieres que la armemos contigo?</span>
            <a href="#contacto" className="font-bold text-porcelain underline decoration-lime decoration-2 underline-offset-4 hover:text-lime">Quiero mi tienda</a>
            <span aria-hidden="true">·</span>
            <a href="#tiendas" className="font-bold text-porcelain underline decoration-cyan decoration-2 underline-offset-4 hover:text-cyan">Ver tiendas reales</a>
            <span aria-hidden="true">·</span>
            <a href="#planes" className="font-bold text-porcelain underline decoration-violet decoration-2 underline-offset-4 hover:text-violet-soft">Conocer planes</a>
          </p>
          <ul className="hero-in mt-5 flex flex-wrap gap-x-6 gap-y-2 text-[0.92rem] text-mist" style={i(4)} aria-label="Condiciones de la prueba gratis">
            {[`Prueba de ${site.trial.days} días`, 'Sin correo ni contraseña', `Hasta ${site.trial.products} productos con foto`].map((item) => (
              <li key={item} className="flex items-center gap-2"><span className="grid size-5 place-items-center rounded-full bg-lime/15 text-lime"><Icon name="check" size={13} /></span>{item}</li>
            ))}
          </ul>
        </div>

        {/* Stage: neon pedestal, real phone screen, the assistant and floating real products. */}
        <div className="hero-in relative mx-auto aspect-[1/0.95] w-full max-w-[38rem] lg:max-w-none" style={i(3)}>
          <div className="parallax pedestal bottom-[2%] !w-[88%]" style={depth(0.3)} aria-hidden="true" />
          <div className="absolute inset-0 z-20">
            <Phone3D
              drive={drive}
              screenKeys={HERO_SCREENS}
              initial={heroPose(0, 0, 0)}
              eager
              sizes="(min-width: 1024px) 280px, 42vw"
              alt={`Captura real de una ficha de producto de ${pilot.name} en el celular`}
            />
          </div>
          <div className="parallax absolute bottom-[6%] left-[-2%] z-30 sm:left-[2%]" style={depth(1.4)}>
            <Mascot eager width="clamp(8.5rem, 19vw, 15rem)" className="float" style={i(1)} />
          </div>

          <FloatingProduct sku="NORD-02" index={0} rotate={-6} z={2} className="right-[0%] top-[4%] sm:right-[2%]" />
          <FloatingProduct sku="TERA-08" index={2} rotate={5} z={1.6} className="left-[8%] top-[2%] hidden sm:block lg:left-[4%]" />

          <div className="float glass absolute bottom-[20%] right-[-2%] z-40 sm:bottom-[30%] flex items-center gap-3 rounded-2xl py-2.5 pl-2.5 pr-4 text-night sm:right-[0%]" style={tilt(1, -3)} aria-hidden="true">
            <span className="grid size-10 place-items-center rounded-full bg-[#25d366] text-white"><Icon name="whatsapp" size={22} /></span>
            <span className="leading-tight">
              <span className="block font-display text-[0.95rem] font-extrabold">¡Nuevo pedido!</span>
              <span className="block text-[0.78rem] text-ink-soft">Llegó por WhatsApp</span>
            </span>
            <span className="ml-1 grid size-6 place-items-center rounded-full bg-lime"><Icon name="check" size={14} /></span>
          </div>

          <div className="glass-dark float absolute left-[34%] top-[-7%] z-40 hidden items-center gap-2 rounded-xl px-3 py-2 text-[0.82rem] font-semibold text-porcelain md:flex" style={i(3)} aria-hidden="true">
            <span className="grid size-7 place-items-center rounded-lg bg-violet-deep font-display text-[0.72rem] font-extrabold text-white shadow-[0_0_18px_rgba(197,42,241,.8)]">IA</span>
            Tienda inteligente
            <Sparks className="-mr-1 size-5" color="var(--color-cyan)" />
          </div>
        </div>
      </div>
      <p className="wrap relative mt-4 text-right text-[0.76rem] text-mist/90">Pantalla y productos reales de la tienda piloto {pilot.name}. La notificación es ilustrativa.</p>
    </section>
  )
}
