// "Pruébalo aquí": a dark playground with the interactive cards of the production site (choose a
// product and a size, add to the cart, filter categories, advance an order, recolour a store,
// preview a template). Products, sizes, prices, categories and templates are real pilot-store data
// (src/content/media.ts); the order and the palettes are illustrative and say so.
import { useState, type CSSProperties, type ReactNode } from 'react'
import { categories, formatCOP, products, templates } from '../content/media'
import { Badge } from '../components/ui/primitives'
import { Icon, type IconName } from '../components/ui/Icon'

const i = (n: number) => ({ '--i': n }) as CSSProperties
const shoes = products.filter((p) => p.sizes.length > 1).slice(0, 3)
const STATUSES = ['Recibido', 'Confirmado', 'En preparación', 'Enviado', 'Entregado']
const PALETTES = [
  { name: 'Lima', bg: '#0b0b13', card: '#171726', accent: '#d9ff14', ink: '#0b0b13', text: '#fafafd' },
  { name: 'Coral', bg: '#fff4ef', card: '#ffffff', accent: '#b83a26', ink: '#ffffff', text: '#2b1510' },
  { name: 'Noche', bg: '#131a33', card: '#1d2648', accent: '#7aa2ff', ink: '#0b1020', text: '#eef2ff' },
  { name: 'Arena', bg: '#f6efe3', card: '#ffffff', accent: '#8a6a3b', ink: '#ffffff', text: '#2e2416' },
]

const chip = (on: boolean) => `inline-flex min-h-10 items-center gap-1.5 rounded-full px-3 text-[0.85rem] font-semibold ring-1 ring-inset transition-all duration-300 ${on ? 'bg-lime text-night ring-lime shadow-[0_0_20px_-4px_rgba(217,255,20,.6)]' : 'bg-white/5 text-porcelain ring-white/15 hover:ring-white/40'}`
const action = 'mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 font-display text-[0.92rem] font-bold transition-transform active:scale-95'

function Card({ icon, title, body, children, index, className = '' }: { icon: IconName; title: string; body: string; children: ReactNode; index: number; className?: string }) {
  return (
    <article data-reveal data-tilt="0.6" style={i(index)} className={`glass-dark flex min-w-0 flex-col rounded-3xl p-6 text-porcelain ${className}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="grid size-11 place-items-center rounded-xl bg-[linear-gradient(135deg,#c52af1,#12dce7)] text-white shadow-[0_8px_20px_-8px_rgba(197,42,241,.8)]"><Icon name={icon} size={20} /></span>
        <Badge kind="live" onDark />
      </div>
      <h4 className="mt-4 font-display text-[1.2rem] font-extrabold leading-snug tracking-tight">{title}</h4>
      <p className="mt-1 text-[0.93rem] leading-snug text-mist">{body}</p>
      <div className="mt-5 flex flex-1 flex-col justify-end">{children}</div>
    </article>
  )
}

function Sizes() {
  const [pick, setPick] = useState(0)
  const product = shoes[pick]
  const [size, setSize] = useState(product.sizes[2] ?? product.sizes[0])
  const choose = (n: number) => { setPick(n); const p = shoes[n]; setSize(p.sizes.includes(size) ? size : p.sizes[0]) }
  return (
    <Card index={0} icon="layers" title="Precios y variantes" body="Tallas, colores y precios por variante, con existencias de cada una.">
      <div className="flex gap-2" role="radiogroup" aria-label="Producto de ejemplo">
        {shoes.map((p, n) => (
          <button key={p.sku} type="button" role="radio" aria-checked={n === pick} aria-label={p.name} onClick={() => choose(n)} className={`size-14 overflow-hidden rounded-xl ring-2 transition-all ${n === pick ? 'ring-lime' : 'opacity-60 ring-transparent hover:opacity-100'}`}>
            <img src={p.src} alt="" width={480} height={480} loading="lazy" decoding="async" className="size-full object-cover" />
          </button>
        ))}
      </div>
      <p className="mt-3 font-display text-[0.95rem] font-bold" aria-live="polite">{product.name}</p>
      <p className="text-[0.85rem] text-mist"><span className="font-bold text-lime">{formatCOP(product.price)}</span> · talla {size}</p>
      <div className="mt-3 flex flex-wrap gap-1.5" role="radiogroup" aria-label={`Talla de ${product.name}`}>
        {product.sizes.map((s) => (
          <button key={s} type="button" role="radio" aria-checked={s === size} onClick={() => setSize(s)} className={`grid h-10 min-w-10 place-items-center rounded-xl px-2 text-sm font-bold ring-1 ring-inset transition-all ${s === size ? 'bg-lime text-night ring-lime' : 'bg-white/5 ring-white/15 hover:ring-white/40'}`}>{s}</button>
        ))}
      </div>
    </Card>
  )
}

function Cart() {
  const product = shoes[0]
  const [count, setCount] = useState(0)
  return (
    <Card index={1} icon="cart" title="Carrito de compras" body="Tus clientes suman productos y tallas antes de pedir.">
      <div className="rounded-2xl bg-white/5 p-3 ring-1 ring-inset ring-white/10">
        <div className="flex items-center gap-3">
          <img src={product.src} alt="" width={480} height={480} loading="lazy" decoding="async" className="size-14 rounded-xl object-cover" />
          <div className="min-w-0 flex-1"><p className="truncate text-[0.85rem] font-semibold">{product.name}</p><p className="text-[0.82rem] text-mist">{formatCOP(product.price)}</p></div>
          <span className="relative grid size-11 place-items-center rounded-full bg-white/8" aria-hidden="true">
            <Icon name="cart" size={19} />
            <span key={count} className={`cart-pop absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full px-1 text-[0.7rem] font-extrabold ${count ? 'bg-violet-deep text-white' : 'bg-white/15'}`}>{count}</span>
          </span>
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-2.5 text-[0.85rem]">
          <span className="text-mist">Subtotal</span>
          <span className="font-display font-extrabold text-lime" aria-live="polite">{formatCOP(product.price * count)}</span>
        </div>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={() => setCount((c) => c + 1)} className={`${action} flex-1 bg-lime text-night`}><Icon name="plus" size={16} />Agregar al carrito</button>
        {count ? <button type="button" onClick={() => setCount(0)} className={`${action} bg-white/8 px-4 text-porcelain`} aria-label="Vaciar el carrito de ejemplo"><Icon name="replay" size={16} /></button> : null}
      </div>
      <p className="sr-only" aria-live="polite">{count ? `${count} ${count === 1 ? 'producto' : 'productos'} en el carrito de ejemplo` : ''}</p>
    </Card>
  )
}

function Categories() {
  const [active, setActive] = useState(categories[1]?.slug ?? categories[0]?.slug)
  const current = categories.find((c) => c.slug === active)
  const shown = products.filter((p) => p.category === current?.name).slice(0, 3)
  return (
    <Card index={2} icon="tag" title="Productos y categorías" body="Organiza tus productos por categorías y tus clientes encuentran todo rápido.">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Categorías de SneakerHub Premium">
        {categories.map((c) => (
          <button key={c.slug} type="button" aria-pressed={c.slug === active} onClick={() => setActive(c.slug)} className={chip(c.slug === active)}>
            {c.name}<span className={`rounded-full px-1.5 text-[0.72rem] ${c.slug === active ? 'bg-night text-lime' : 'bg-white/10'}`}>{c.count}</span>
          </button>
        ))}
      </div>
      <div className="mt-3 flex min-h-14 items-center gap-2" aria-hidden="true">
        {shown.map((p) => <img key={p.sku} src={p.src} alt="" width={480} height={480} loading="lazy" decoding="async" className="size-14 rounded-xl object-cover ring-1 ring-white/10" />)}
        {current && current.count > shown.length ? <span className="grid size-14 place-items-center rounded-xl bg-white/5 text-[0.85rem] font-bold text-mist ring-1 ring-inset ring-white/10">+{current.count - shown.length}</span> : null}
      </div>
      <p className="mt-2 text-[0.82rem] text-mist" aria-live="polite">{current?.count} productos en {current?.name} en SneakerHub Premium.</p>
    </Card>
  )
}

function OrderStatus() {
  const [step, setStep] = useState(1)
  const done = step === STATUSES.length - 1
  return (
    <Card index={0} icon="truck" title="Gestión de pedidos" body="Un panel web para productos, categorías, apariencia y pedidos con sus estados.">
      <div className="rounded-2xl bg-white/5 p-4 ring-1 ring-inset ring-white/10">
        <div className="flex items-center justify-between gap-2 text-[0.82rem]"><span className="font-semibold">Pedido de ejemplo</span><span className="rounded-full bg-lime px-2.5 py-0.5 font-bold text-night" aria-live="polite">{STATUSES[step]}</span></div>
        <ol className="mt-4 grid grid-cols-5 gap-1" aria-label="Estados del pedido">
          {STATUSES.map((s, n) => (
            <li key={s} className="flex flex-col items-center gap-1.5 text-center">
              <span className={`grid size-6 place-items-center rounded-full text-[0.65rem] font-extrabold transition-all duration-500 ${n < step ? 'bg-[linear-gradient(135deg,#c52af1,#12dce7)] text-white' : n === step ? 'bg-lime text-night shadow-[0_0_16px_rgba(217,255,20,.6)]' : 'bg-white/10 text-mist'}`}>{n < step ? <Icon name="check" size={12} /> : n + 1}</span>
              <span className={`text-[0.62rem] leading-tight ${n <= step ? 'text-porcelain' : 'text-mist'}`}>{s}<span className="sr-only">{n <= step ? ' (hecho)' : ''}</span></span>
            </li>
          ))}
        </ol>
      </div>
      <button type="button" onClick={() => setStep((n) => (done ? 0 : n + 1))} className={`${action} bg-porcelain text-night`}>
        <Icon name={done ? 'replay' : 'arrowRight'} size={16} />{done ? 'Reiniciar' : 'Avanzar estado'}
      </button>
    </Card>
  )
}

function Palette() {
  const [pick, setPick] = useState(0)
  const p = PALETTES[pick]
  const product = shoes[1] ?? shoes[0]
  return (
    <Card index={1} icon="palette" title="Personalización por comercio" body="Tu logo, tus colores y tu plantilla. Proponemos paletas a partir de tu logo.">
      <div className="rounded-2xl p-3.5 transition-colors duration-500" style={{ background: p.bg, color: p.text }}>
        <div className="flex items-center justify-between">
          <p className="font-display text-[0.95rem] font-extrabold">Tu tienda</p>
          <span className="size-6 rounded-full transition-colors duration-500" style={{ background: p.accent }} aria-hidden="true" />
        </div>
        <div className="mt-2.5 flex items-center gap-3 rounded-xl p-2 transition-colors duration-500" style={{ background: p.card }}>
          <img src={product.src} alt="" width={480} height={480} loading="lazy" decoding="async" className="size-12 rounded-lg object-cover" />
          <div className="min-w-0 flex-1 text-[0.78rem]"><p className="truncate font-semibold">{product.name}</p><p className="opacity-75">{formatCOP(product.price)}</p></div>
          <span className="rounded-full px-3 py-1 text-[0.72rem] font-bold transition-colors duration-500" style={{ background: p.accent, color: p.ink }}>Pedir</span>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Paleta de ejemplo">
        {PALETTES.map((x, n) => (
          <button key={x.name} type="button" role="radio" aria-checked={n === pick} onClick={() => setPick(n)} className={chip(n === pick)}>
            <span className="size-4 rounded-full ring-1 ring-black/20" style={{ background: x.accent }} aria-hidden="true" />{x.name}
          </button>
        ))}
      </div>
    </Card>
  )
}

function Templates() {
  const [pick, setPick] = useState(templates.findIndex((t) => t.key === 'premium') >= 0 ? templates.findIndex((t) => t.key === 'premium') : 0)
  const t = templates[pick]
  return (
    <Card index={2} icon="devices" title="Tienda responsive" body={`Tu tienda se ve bien en el celular, la tablet y el computador. Elige entre ${templates.length} plantillas.`}>
      <div className="relative overflow-hidden rounded-xl ring-1 ring-white/12">
        <p className="flex items-center gap-1.5 bg-white/8 px-3 py-1.5 text-[0.7rem] text-mist" aria-hidden="true"><span className="size-2 rounded-full bg-white/25" /><span className="size-2 rounded-full bg-white/25" /><span className="ml-1 truncate">Plantilla {t.name}</span></p>
        <img key={t.key} src={t.src} alt={`Vista de la plantilla ${t.name}`} width={640} height={400} loading="lazy" decoding="async" className="cart-pop aspect-[16/9] w-full object-cover object-top" />
      </div>
      <div className="-mx-1 mt-3 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:thin]" role="radiogroup" aria-label="Plantillas disponibles">
        {templates.map((x, n) => <button key={x.key} type="button" role="radio" aria-checked={n === pick} onClick={() => setPick(n)} className={`shrink-0 ${chip(n === pick)} min-h-9 px-2.5 text-[0.78rem]`}>{x.name}</button>)}
      </div>
    </Card>
  )
}

export function TryIt() {
  return (
    <div className="on-dark relative mt-16 overflow-hidden rounded-[2.25rem] bg-night px-5 py-10 text-porcelain shadow-[0_60px_120px_-60px_rgba(164,20,207,.8)] md:px-10 md:py-14">
      <div className="grid-fade pointer-events-none absolute inset-0" aria-hidden="true" />
      <div className="pointer-events-none absolute -left-24 -top-24 size-[30rem] rounded-full bg-[radial-gradient(closest-side,rgba(18,220,231,.16),transparent)]" aria-hidden="true" />
      <div className="pointer-events-none absolute -bottom-32 -right-24 size-[36rem] rounded-full bg-[radial-gradient(closest-side,rgba(197,42,241,.35),transparent)]" aria-hidden="true" />
      <div className="relative flex flex-col justify-between gap-4 md:flex-row md:items-end" data-reveal>
        <div>
          <p className="eyebrow inline-flex items-center gap-2 text-cyan">
            <span className="relative flex size-2.5" aria-hidden="true"><span className="ping-soft absolute inset-0 rounded-full bg-lime" /><span className="relative size-2.5 rounded-full bg-lime" /></span>
            Pruébalo aquí
          </p>
          <h3 className="display mt-3 text-[clamp(1.8rem,3.2vw,2.7rem)]">Todo lo que tu tienda <span className="accent accent-gradient">ya puede hacer.</span></h3>
        </div>
        <p className="flex max-w-md items-start gap-3 text-mist">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/6 text-lime ring-1 ring-inset ring-white/10" aria-hidden="true"><Icon name="sparkle" size={18} /></span>
          Funciones disponibles hoy en la plataforma. Toca cada tarjeta para probarla.
        </p>
      </div>
      <div className="relative mt-9 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Sizes />
        <Cart />
        <Categories />
        <OrderStatus />
        <Palette />
        <Templates />
      </div>
      <p className="relative mt-5 text-[0.8rem] text-mist">Productos, tallas, precios, categorías y plantillas reales de la tienda piloto SneakerHub Premium. El pedido y las paletas son ejemplos.</p>
    </div>
  )
}
