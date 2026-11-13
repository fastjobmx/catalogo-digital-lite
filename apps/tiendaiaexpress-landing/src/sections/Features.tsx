// "Funciones" as a bento grid. Only features verified in the platform code are listed as
// available; plan-specific ones say so (src/content/plans.ts) and upcoming ones are labelled.
// Sizes, variants and the order flow are shown interactively right below (TryIt), so the bento
// does not repeat them: it shows the catalogue, the WhatsApp order, 0 % commission, templates and AI.
import type { CSSProperties, ReactNode } from 'react'
import { formatCOP, products, screens, templates } from '../content/media'
import { orderMessageLines } from '../content/orderMessage'
import { Badge, SectionHeading } from '../components/ui/primitives'
import { PhoneFrame } from '../components/ui/PhoneFrame'
import { Icon, type IconName } from '../components/ui/Icon'
import { Sparks } from '../components/brand/Decor'
import { TryIt } from './TryIt'

const i = (n: number) => ({ '--i': n }) as CSSProperties
const hero = products[0]
/** First lines of the real order message (WhatsApp formatting marks removed). */
const orderPreview = orderMessageLines.filter(Boolean).slice(0, 2).concat(orderMessageLines.slice(9, 13)).map((line) => line.replace(/\*/g, ''))

const NIGHT_GLOW = 'radial-gradient(40rem 26rem at 80% 100%, rgba(197,42,241,.45), transparent 65%), radial-gradient(26rem 18rem at 0% 0%, rgba(18,220,231,.14), transparent 60%), #0b0b13'

function Tile({ className = '', children, index = 0, background }: { className?: string; children: ReactNode; index?: number; background?: string }) {
  return <article data-reveal data-tilt="0.5" style={{ ...i(index), ...(background ? { background } : {}) }} className={`relative overflow-hidden rounded-[1.75rem] p-7 md:p-8 ${className}`}>{children}</article>
}

function TileIcon({ name, className = '' }: { name: IconName; className?: string }) {
  return <span className={`grid size-12 place-items-center rounded-2xl ${className}`}><Icon name={name} size={24} /></span>
}

const MORE: { icon: IconName; title: string; body: string; note?: string }[] = [
  { icon: 'file', title: 'Importa tu lista', body: 'Desde Excel o CSV, o desde un PDF con lectura por IA opcional.' },
  { icon: 'ticket', title: 'Cupones de descuento', body: 'Los creas en tu panel y tus clientes los aplican en el carrito.' },
  { icon: 'truck', title: 'Estados y guía de envío', body: 'Recibido, confirmado, enviado y entregado, con transportadora y número de guía.', note: 'Desde el plan Negocio' },
  { icon: 'users', title: 'Tu equipo, con permisos', body: 'Varios administradores con roles para ventas o inventario.', note: 'Plan Mayorista' },
  { icon: 'stores', title: 'Varias tiendas, una cuenta', body: 'Administra más de una tienda desde la misma cuenta de Telegram.' },
  { icon: 'globe', title: 'Dominio propio', body: 'Tu tienda en tu propia dirección, con configuración asistida.', note: 'Complemento opcional' },
]
const SOON = ['Estadísticas avanzadas', 'Asistente de ventas para tus clientes', 'Promociones inteligentes']

export function Features() {
  return (
    <section id="funciones" aria-labelledby="funciones-title" className="wash relative overflow-hidden py-24 md:py-32">
      <div className="wrap relative">
        <div className="flex flex-col justify-between gap-8 lg:flex-row lg:items-end" data-reveal>
          <SectionHeading id="funciones-title" eyebrow="Funciones" title={<>Todo lo que necesitas para <span className="accent hl">vender en línea.</span></>} intro="Una tienda completa para tu cliente y herramientas sencillas para ti. Sin instalar nada y sin saber de tecnología." />
          <ul className="flex flex-wrap gap-2 lg:max-w-xs lg:justify-end" aria-label="En resumen">
            {['Sin instalar nada', 'Desde el celular', '0 % de comisión'].map((t) => (
              <li key={t} className="inline-flex items-center gap-1.5 rounded-full bg-paper px-3.5 py-1.5 text-[0.85rem] font-semibold ring-1 ring-night/10"><Icon name="check" size={14} className="text-violet-ink" />{t}</li>
            ))}
          </ul>
        </div>

        <div className="mt-14 grid gap-4 md:grid-cols-6 lg:grid-cols-12">
          {/* 1 · The catalogue: two real captures in 3D on the neon pedestal. */}
          <Tile background={NIGHT_GLOW} className="on-dark flex flex-col bg-night text-porcelain md:col-span-6 lg:col-span-7 lg:row-span-2">
            <div className="grid-fade pointer-events-none absolute inset-0" aria-hidden="true" />
            <div className="relative max-w-md">
              <TileIcon name="devices" className="bg-lime/12 text-lime ring-1 ring-inset ring-lime/30" />
              <h3 className="mt-5 font-display text-[1.75rem] font-extrabold leading-tight tracking-tight md:text-[2.1rem]">Una tienda que se ve bien en <span className="text-lime">cualquier celular</span></h3>
              <p className="mt-3 text-mist">Productos, categorías, fotos y precios ordenados en una tienda rápida, con tu marca y tu propia dirección.</p>
            </div>
            <div className="relative mt-10 flex flex-1 items-end justify-center pb-6 [perspective:1400px]">
              <div className="pedestal bottom-0 !w-[78%]" aria-hidden="true" />
              <PhoneFrame src={screens.catalog} alt="Captura real de la tienda SneakerHub Premium en el celular: productos por categorías" width="clamp(8.5rem, 22vw, 12.5rem)" className="neon-rim relative z-10 -mr-6 translate-y-3 [transform:rotateY(18deg)_rotateZ(-3deg)]" />
              <PhoneFrame src={screens.product} alt="Captura real de una ficha de producto de SneakerHub Premium" width="clamp(8.5rem, 22vw, 12.5rem)" className="neon-rim relative z-20 -translate-y-4 [transform:rotateY(-16deg)_rotateZ(3deg)]" />
            </div>
            <p className="relative text-[0.76rem] text-mist">Capturas reales de la tienda piloto SneakerHub Premium.</p>
          </Tile>

          {/* 2 · The order, as it arrives on WhatsApp. */}
          <Tile index={1} className="bg-paper ring-1 ring-night/8 lift md:col-span-3 lg:col-span-5">
            <div className="flex items-start justify-between gap-4">
              <TileIcon name="whatsapp" className="bg-[#25d366] text-white shadow-[0_10px_24px_-8px_rgba(37,211,102,.7)]" />
              <span className="rounded-full bg-violet/10 px-3 py-1 text-[0.75rem] font-bold text-violet-ink">Formato real</span>
            </div>
            <h3 className="mt-5 font-display text-[1.45rem] font-extrabold leading-tight tracking-tight">Pedidos completos por WhatsApp</h3>
            <p className="mt-2 text-ink-soft">Tu cliente arma el carrito y el pedido te llega listo para confirmar.</p>
            <div className="mt-5 overflow-hidden rounded-2xl bg-[#efeae2] ring-1 ring-night/6">
              <p className="flex items-center gap-2 bg-[#075e54] px-4 py-2 text-[0.78rem] font-semibold text-white"><Icon name="whatsapp" size={14} />Nuevo pedido</p>
              <div className="p-3">
                <div className="relative rounded-xl rounded-tl-none bg-paper p-3.5 text-[0.8rem] leading-relaxed text-[#111b21] shadow-[0_1px_1px_rgba(11,20,26,.12)]" aria-label="Fragmento del mensaje de pedido">
                  {orderPreview.map((line, n) => <p key={n} className={`whitespace-pre-wrap ${n < 2 ? 'font-semibold' : ''}`}>{line}</p>)}
                  <p className="text-ink-soft">…</p>
                </div>
              </div>
            </div>
            <p className="mt-3 text-[0.8rem] text-ink-soft"><a href="#demo" className="font-semibold text-night underline decoration-violet decoration-2 underline-offset-4 hover:text-violet-ink">Ver el mensaje completo</a></p>
          </Tile>

          {/* 3 · 0 % commission. */}
          <Tile index={2} className="bg-lime text-night shadow-[0_30px_60px_-30px_rgba(150,180,0,.8)] md:col-span-3 lg:col-span-5">
            <Sparks className="absolute right-6 top-6 size-10" color="var(--color-night)" />
            <p className="display text-[clamp(4rem,8vw,6rem)] leading-none tracking-[-0.06em]">0 %</p>
            <h3 className="mt-3 font-display text-[1.45rem] font-extrabold leading-tight tracking-tight">Sin comisión por venta</h3>
            <p className="mt-2 max-w-sm text-night/85">Pagas tu plan y nada más. El pago lo acuerdas directamente con tu cliente.</p>
          </Tile>

          {/* 4 · Templates, fanned out in 3D. */}
          <Tile index={1} className="bg-paper ring-1 ring-night/8 lift md:col-span-3 lg:col-span-7">
            <div className="grid items-center gap-6 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <div>
                <TileIcon name="palette" className="bg-violet/10 text-violet-ink" />
                <h3 className="mt-5 font-display text-[1.45rem] font-extrabold leading-tight tracking-tight"><span className="text-violet-ink">{templates.length}</span> plantillas para tu marca</h3>
                <p className="mt-2 text-ink-soft">Elige el estilo, pon tu logo y tus colores. Cambias de plantilla cuando quieras.</p>
              </div>
              <div className="relative h-44 [perspective:1100px]" aria-hidden="true">
                {templates.slice(0, 4).map((t, n) => (
                  <img key={t.key} src={t.src} alt="" width={640} height={400} loading="lazy" decoding="async" className="absolute top-1/2 aspect-[4/3] w-[58%] rounded-xl object-cover object-top shadow-[0_18px_34px_-14px_rgba(11,11,19,.55)] ring-1 ring-night/10 transition-transform duration-500" style={{ left: `${n * 14}%`, zIndex: n, transform: `translateY(-50%) rotateY(-24deg) rotateZ(${(n - 1.5) * 2}deg) translateZ(${n * 18}px)` }} />
                ))}
              </div>
            </div>
          </Tile>

          {/* 5 · AI product cards from a photo. */}
          <Tile index={2} className="on-dark bg-[linear-gradient(150deg,#2b0b45,#0b0b13_70%)] text-porcelain md:col-span-6 lg:col-span-5">
            <div className="pointer-events-none absolute -right-16 -top-16 size-64 rounded-full bg-[radial-gradient(closest-side,rgba(197,42,241,.5),transparent)]" aria-hidden="true" />
            <div className="relative">
              <TileIcon name="sparkle" className="bg-violet-deep text-white shadow-[0_0_24px_rgba(197,42,241,.7)]" />
              <h3 className="mt-5 font-display text-[1.45rem] font-extrabold leading-tight tracking-tight">Fichas con IA desde una foto</h3>
              <p className="mt-2 text-mist">Subes la foto y la IA sugiere nombre, categoría y descripción. Tú revisas y completas precio y tallas.</p>
              <div className="mt-5 flex items-center gap-3" aria-hidden="true">
                <img src={hero.src} alt="" width={480} height={480} loading="lazy" decoding="async" className="size-16 shrink-0 rounded-xl object-cover ring-2 ring-violet/70" />
                <Icon name="arrowRight" size={18} className="shrink-0 text-cyan" />
                <div className="min-w-0 flex-1 space-y-1.5 text-[0.78rem]">
                  <p className="truncate rounded-lg bg-white/8 px-2.5 py-1"><span className="text-cyan">Nombre</span> · {hero.name}</p>
                  <p className="truncate rounded-lg bg-white/8 px-2.5 py-1"><span className="text-cyan">Categoría</span> · {hero.category} · <span className="text-lime">{formatCOP(hero.price)}</span></p>
                </div>
              </div>
              <p className="mt-4 text-[0.8rem] font-semibold text-violet-soft">Ejemplo con un producto real. Usa las cuotas de IA de tu plan.</p>
            </div>
          </Tile>
        </div>

        <TryIt />

        <div className="mt-16" data-reveal>
          <h3 className="font-display text-[1.5rem] font-extrabold tracking-tight">Y además</h3>
          <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {MORE.map((item, n) => (
              <li key={item.title} data-tilt="0.8" className="flex gap-4 rounded-2xl bg-paper p-5 ring-1 ring-night/8 transition-shadow hover:shadow-[0_24px_50px_-28px_rgba(164,20,207,.55)]" style={i(n % 3)}>
                <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[linear-gradient(135deg,#c52af1,#12dce7)] text-white shadow-[0_8px_20px_-8px_rgba(197,42,241,.7)]"><Icon name={item.icon} size={20} /></span>
                <div className="min-w-0">
                  <p className="font-display text-[1.05rem] font-bold leading-snug">{item.title}</p>
                  <p className="mt-1 text-[0.93rem] leading-snug text-ink-soft">{item.body}</p>
                  {item.note ? <p className="mt-2 inline-block rounded-full bg-violet/10 px-2.5 py-0.5 text-[0.75rem] font-bold text-violet-ink">{item.note}</p> : null}
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="on-dark mt-6 flex flex-wrap items-center gap-3 rounded-2xl bg-night px-5 py-4 text-porcelain">
          <Badge kind="soon" onDark label="En camino" />
          <ul className="flex flex-wrap gap-x-5 gap-y-1 text-[0.92rem] text-mist">
            {SOON.map((item) => <li key={item} className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-cyan" aria-hidden="true" />{item}</li>)}
          </ul>
        </div>
      </div>
    </section>
  )
}
