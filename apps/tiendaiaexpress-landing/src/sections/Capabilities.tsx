// Bento of real capabilities. Each tile has its own small interaction (a button, never hover-only).
import { useState, type ReactNode } from 'react'
import { categories, formatCOP, products, templates } from '../content/media'
import { moreCapabilities, upcoming } from '../content/copy'
import { Badge, SectionHeading } from '../components/ui/primitives'
import { Icon, type IconName } from '../components/ui/Icon'

const product = products[0]

function Tile({ title, body, icon, className = '', children, tone = 'raised' }: { title: string; body: string; icon: IconName; className?: string; children?: ReactNode; tone?: 'raised' | 'ivory' | 'lime' }) {
  const tones = {
    raised: 'bg-forest-raised text-ivory ring-ivory/8',
    ivory: 'bg-ivory text-forest ring-forest/5',
    lime: 'bg-lime text-forest ring-forest/10',
  }
  const sub = tone === 'raised' ? 'text-mist' : 'text-ink-soft'
  return (
    <article className={`group relative flex flex-col overflow-hidden rounded-[1.75rem] p-6 ring-1 ring-inset md:p-7 ${tones[tone]} ${className}`}>
      <div className="flex items-start justify-between gap-4">
        <span className={`grid size-11 place-items-center rounded-2xl ${tone === 'raised' ? 'bg-lime text-forest' : 'bg-forest text-lime'}`}><Icon name={icon} size={21} /></span>
        <Badge kind="live" onDark={tone === 'raised'} />
      </div>
      <h3 className="mt-6 font-display text-[1.45rem] font-bold leading-tight md:text-[1.6rem]">{title}</h3>
      <p className={`mt-2 max-w-md text-[0.98rem] leading-relaxed ${sub}`}>{body}</p>
      {children ? <div className="mt-6 flex-1">{children}</div> : null}
    </article>
  )
}

function TemplatesDemo() {
  const [index, setIndex] = useState(templates.findIndex((t) => t.key === 'urban'))
  const current = templates[index]
  return (
    <div className="flex h-full flex-col gap-4">
      <div className="relative flex-1 overflow-hidden rounded-2xl bg-forest-deep ring-1 ring-ivory/10">
        <div className="flex items-center gap-1.5 px-3 py-2"><span className="size-2 rounded-full bg-ivory/25" /><span className="size-2 rounded-full bg-ivory/25" /><span className="size-2 rounded-full bg-ivory/25" /></div>
        <img key={current.key} src={current.src} alt={`Plantilla ${current.name}: captura real de una tienda de prueba`} width={960} height={1100} loading="lazy" className="aspect-[16/11] w-full animate-[fade-up_.5s_var(--ease-out-expo)] object-cover object-top" />
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Elegir plantilla">
        {templates.map((t, i) => (
          <button key={t.key} type="button" aria-pressed={i === index} onClick={() => setIndex(i)} className={`min-h-9 rounded-full px-3 text-[0.8rem] font-semibold transition-colors ${i === index ? 'bg-lime text-forest' : 'bg-ivory/8 text-ivory hover:bg-ivory/15'}`}>{t.name}</button>
        ))}
      </div>
    </div>
  )
}

function CategoriesDemo() {
  const [active, setActive] = useState(categories[1].slug)
  return (
    <div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por categoría">
        {categories.map((c) => (
          <button key={c.slug} type="button" aria-pressed={active === c.slug} onClick={() => setActive(c.slug)} className={`flex min-h-10 items-center gap-2 rounded-full px-4 text-sm font-semibold transition-colors ${active === c.slug ? 'bg-forest text-ivory' : 'bg-forest/6 text-forest hover:bg-forest/12'}`}>
            {c.name}<span className={`rounded-full px-1.5 text-xs ${active === c.slug ? 'bg-lime text-forest' : 'bg-forest/10'}`}>{c.count}</span>
          </button>
        ))}
      </div>
      <p className="mt-4 text-sm text-ink-soft" aria-live="polite">{categories.find((c) => c.slug === active)?.count} productos en {categories.find((c) => c.slug === active)?.name} en SneakerHub.</p>
    </div>
  )
}

function VariantsDemo() {
  const [size, setSize] = useState(product.sizes[2])
  return (
    <div className="flex h-full flex-col justify-end">
      <div className="flex items-center gap-3 rounded-2xl bg-forest-deep p-3">
        <img src={product.src} alt="" width={480} height={480} loading="lazy" className="size-14 rounded-xl object-cover" />
        <div className="min-w-0">
          <p className="truncate font-display font-bold">{product.name}</p>
          <p className="text-sm text-mist">{formatCOP(product.price)} · talla {size}</p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-6 gap-1.5" role="group" aria-label="Elegir talla">
        {product.sizes.map((s) => (
          <button key={s} type="button" aria-pressed={s === size} onClick={() => setSize(s)} className={`min-h-11 rounded-xl font-display text-sm font-bold transition-[background-color,transform] active:scale-95 ${s === size ? 'bg-lime text-forest' : 'bg-ivory/8 text-ivory hover:bg-ivory/15'}`}>{s}</button>
        ))}
      </div>
    </div>
  )
}

function CartDemo() {
  const [count, setCount] = useState(0)
  const [bump, setBump] = useState(0)
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl bg-forest p-3 pl-4 text-ivory">
      <span className="relative">
        <Icon name="cart" size={28} />
        <span key={bump} className={`absolute -right-2.5 -top-2 grid min-w-5 place-items-center rounded-full bg-violet px-1 text-xs font-bold text-forest ${bump ? 'animate-[pop_.45s_var(--ease-spring)]' : ''}`} aria-live="polite">{count}</span>
      </span>
      <button type="button" onClick={() => { setCount((c) => c + 1); setBump((b) => b + 1) }} className="min-h-11 rounded-full bg-lime px-5 font-display text-sm font-bold uppercase text-forest active:scale-95">
        Agregar al carrito
      </button>
    </div>
  )
}

const PALETTES = [
  { name: 'Logo verde', bg: '#102f25', accent: '#c6f25b', text: '#f7f8f3' },
  { name: 'Coral', bg: '#fff4ef', accent: '#8a2ff5', text: '#3b160a' },
  { name: 'Noche', bg: '#14161c', accent: '#e9e3d4', text: '#f4f2ec' },
  { name: 'Arena', bg: '#f3ead9', accent: '#2d4a3e', text: '#21302a' },
]
function PaletteDemo() {
  const [p, setP] = useState(PALETTES[0])
  return (
    <div>
      <div className="rounded-2xl p-4 transition-colors duration-500" style={{ background: p.bg, color: p.text }}>
        <p className="font-display text-sm font-bold">Tu tienda</p>
        <span className="mt-3 inline-flex rounded-full px-3 py-1.5 text-xs font-bold transition-colors duration-500" style={{ background: p.accent, color: p.bg }}>Ver catálogo</span>
      </div>
      <div className="mt-3 flex gap-2" role="group" aria-label="Probar paleta">
        {PALETTES.map((x) => (
          <button key={x.name} type="button" aria-pressed={x === p} onClick={() => setP(x)} className={`grid size-11 place-items-center rounded-full ring-2 transition-transform active:scale-90 ${x === p ? 'ring-forest' : 'ring-transparent'}`} style={{ background: `linear-gradient(135deg, ${x.bg} 50%, ${x.accent} 50%)` }}>
            <span className="sr-only">{x.name}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function OrdersDemo() {
  const steps = ['Recibido', 'Confirmado', 'En preparación', 'Enviado', 'Entregado']
  const [at, setAt] = useState(1)
  return (
    <div className="rounded-2xl bg-forest-deep p-4">
      <div className="flex items-center justify-between text-sm"><span className="font-display font-bold">Pedido de ejemplo</span><span className="text-mist">{steps[at]}</span></div>
      <div className="mt-3 grid grid-cols-5 gap-1">
        {steps.map((s, i) => <span key={s} className={`h-1.5 rounded-full transition-colors duration-500 ${i <= at ? 'bg-lime' : 'bg-ivory/15'}`} />)}
      </div>
      <button type="button" onClick={() => setAt((a) => (a + 1) % steps.length)} className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-full bg-ivory/10 px-4 text-sm font-semibold hover:bg-ivory/20">
        Avanzar estado <Icon name="arrowRight" size={15} />
      </button>
    </div>
  )
}

function TelegramDemo() {
  return (
    <div className="space-y-2 text-[0.92rem]">
      <p className="ml-auto w-fit max-w-[90%] rounded-2xl rounded-br-md bg-forest px-3.5 py-2 text-ivory">Cargá 10 pares de la talla 42</p>
      <p className="w-fit max-w-[90%] rounded-2xl rounded-bl-md bg-paper px-3.5 py-2 text-forest">¿Confirmo +10 unidades en talla 42?</p>
      <p className="pt-1 text-xs text-ink-soft">Ejemplo ilustrativo</p>
    </div>
  )
}

function WhatsAppDemo() {
  return (
    <div className="rounded-2xl bg-[#e7f6e5] p-4 text-[#0b2e1f]">
      <p className="flex items-center gap-2 text-sm font-bold"><Icon name="whatsapp" size={18} className="text-[#128c4a]" /> Pedido desde tu tienda</p>
      <p className="mt-2 text-sm leading-snug">1 × {product.name} · talla {product.sizes[2]}<br />Envío a: ciudad y dirección del cliente</p>
    </div>
  )
}

export function Capabilities() {
  return (
    <section id="caracteristicas" aria-labelledby="caracteristicas-title" className="on-dark grain relative bg-forest py-24 text-ivory md:py-36">
      <div className="wrap relative z-10">
        <div className="flex flex-col justify-between gap-8 md:flex-row md:items-end">
          <SectionHeading id="caracteristicas-title" onDark title={<>Todo lo que tu tienda <span className="text-lime">ya puede hacer.</span></>} intro="Funciones disponibles hoy en la plataforma. Tocá cada tarjeta para probarla." />
        </div>

        <div className="mt-14 grid gap-4 md:grid-cols-6 lg:grid-cols-12">
          <Tile className="md:col-span-6 lg:col-span-7 lg:row-span-2" icon="devices" title="Catálogo responsive" body="Tu tienda se ve bien en el celular, la tablet y el computador. Elegí entre 13 plantillas.">
            <TemplatesDemo />
          </Tile>
          <Tile className="md:col-span-6 lg:col-span-5" tone="ivory" icon="layers" title="Productos y categorías" body="Organizá tu catálogo por categorías y tus clientes encuentran todo rápido.">
            <CategoriesDemo />
          </Tile>
          <Tile className="md:col-span-3 lg:col-span-5" icon="tag" title="Precios y variantes" body="Tallas, colores y precios por variante, con stock de cada una.">
            <VariantsDemo />
          </Tile>
          <Tile className="md:col-span-3 lg:col-span-4" tone="lime" icon="cart" title="Carrito de compras" body="Tus clientes suman productos y tallas antes de pedir.">
            <CartDemo />
          </Tile>
          <Tile className="md:col-span-3 lg:col-span-4" tone="ivory" icon="whatsapp" title="Pedidos por WhatsApp" body="El pedido te llega a WhatsApp con productos, tallas y datos de entrega.">
            <WhatsAppDemo />
          </Tile>
          <Tile className="md:col-span-3 lg:col-span-4" tone="ivory" icon="telegram" title="Administración desde Telegram" body="Agregá productos, cambiá precios y cargá stock escribiéndole a tu asistente.">
            <TelegramDemo />
          </Tile>
          <Tile className="md:col-span-3 lg:col-span-7" icon="panel" title="Gestión administrativa" body="Un panel web para productos, categorías, apariencia y pedidos con sus estados.">
            <OrdersDemo />
          </Tile>
          <Tile className="md:col-span-3 lg:col-span-5" tone="ivory" icon="palette" title="Personalización por comercio" body="Tu logo, tus colores y tu plantilla. Proponemos paletas a partir de tu logo.">
            <PaletteDemo />
          </Tile>
        </div>

        <div className="mt-20 grid gap-12 lg:grid-cols-2 lg:gap-16">
          <div>
            <h3 className="font-display text-2xl font-bold md:text-3xl">Y además</h3>
            <ul className="mt-6 divide-y divide-ivory/10 border-y border-ivory/10">
              {moreCapabilities.map((c) => (
                <li key={c.title} className="flex gap-4 py-4">
                  <Icon name={c.icon} size={22} className="mt-0.5 shrink-0 text-lime" />
                  <div><p className="font-display font-bold">{c.title}</p><p className="text-[0.95rem] text-mist">{c.body}</p></div>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="font-display text-2xl font-bold md:text-3xl">En camino</h3>
              <Badge kind="soon" onDark />
            </div>
            <ul className="mt-6 divide-y divide-ivory/10 border-y border-ivory/10">
              {upcoming.map((c) => (
                <li key={c.title} className="flex gap-4 py-4 text-ivory/80">
                  <Icon name={c.icon} size={22} className="mt-0.5 shrink-0 text-mist" />
                  <div><p className="font-display font-bold">{c.title}</p><p className="text-[0.95rem] text-mist">{c.body}</p></div>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-sm text-mist">Estas funciones todavía no están disponibles. Te avisamos cuando lo estén.</p>
          </div>
        </div>
      </div>
    </section>
  )
}
