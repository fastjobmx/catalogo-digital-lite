// "Administración inteligente": the web panel and the Telegram assistant. The conversation is an
// illustrative demonstration of the real flow (photo → draft → confirmation → published) and is
// labelled as such; the product and its photo are real data of the pilot store.
import type { CSSProperties, ReactNode } from 'react'
import assistant160 from '../assets/brand/asistente-160.webp'
import assistant480 from '../assets/brand/asistente-480.webp'
import { products, formatCOP } from '../content/media'
import { Badge, SectionHeading } from '../components/ui/primitives'
import { Icon, type IconName } from '../components/ui/Icon'

const i = (n: number) => ({ '--i': n }) as CSSProperties
const product = products[0]

const WAYS: { icon: IconName; title: string; body: string }[] = [
  { icon: 'panel', title: 'Panel web', body: 'Productos, categorías, pedidos, cupones y ajustes de tu tienda, desde el computador o el celular.' },
  { icon: 'telegram', title: 'Asistente en Telegram', body: 'Le escribes como a una persona: agrega productos, cambia precios, carga existencias y revisa pedidos.' },
  { icon: 'shield', title: 'Siempre te pide confirmación', body: 'Antes de guardar cualquier cambio te muestra lo que va a hacer y tú decides.' },
  { icon: 'truck', title: 'Guías de envío con una foto', body: 'Envías la foto de la guía y el pedido queda con transportadora y número. Desde el plan Negocio.' },
]

function Bubble({ me, children, index }: { me?: boolean; children: ReactNode; index: number }) {
  return (
    <li data-reveal style={i(index * 2)} className={`flex ${me ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[82%] rounded-2xl px-4 py-2.5 text-[0.95rem] leading-snug ${me ? 'rounded-br-md bg-lime text-forest' : 'rounded-bl-md bg-white/8 text-ivory ring-1 ring-inset ring-white/10'}`}>{children}</div>
    </li>
  )
}

export function Assistant() {
  return (
    <section id="administracion" aria-labelledby="administracion-title" className="bg-ivory py-24 md:py-32">
      <div className="wrap grid grid-cols-1 items-center gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] lg:gap-20">
        <div className="min-w-0">
          <div data-reveal>
            <SectionHeading id="administracion-title" eyebrow="Administración inteligente" title={<>Administra tu tienda <span className="accent text-violet-ink">escribiendo un mensaje.</span></>} intro="Un mensaje a tu asistente reemplaza varios clics en un panel. Cambias un precio o cargas existencias mientras atiendes tu negocio." />
          </div>
          <ul className="mt-10 grid gap-x-8 gap-y-7 sm:grid-cols-2">
            {WAYS.map((way, n) => (
              <li key={way.title} data-reveal style={i(n)}>
                <span className="grid size-11 place-items-center rounded-xl bg-forest text-lime"><Icon name={way.icon} size={20} /></span>
                <h3 className="mt-4 font-display text-[1.1rem] font-bold leading-snug">{way.title}</h3>
                <p className="mt-1 text-[0.96rem] leading-snug text-ink-soft">{way.body}</p>
              </li>
            ))}
          </ul>
        </div>

        <div className="on-dark relative mx-auto w-full min-w-0 max-w-[30rem] rounded-[2rem] bg-forest p-3 text-ivory shadow-[0_50px_100px_-50px_rgba(6,43,37,.75)] lg:mx-0" data-reveal>
          <div className="flex items-center gap-3 rounded-[1.4rem] bg-forest-raised px-4 py-3">
            <img src={assistant160} srcSet={`${assistant160} 160w, ${assistant480} 480w`} sizes="48px" alt="" width={48} height={48} loading="lazy" decoding="async" className="size-12 rounded-full object-cover ring-2 ring-lime/60" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-display font-bold leading-tight">Asistente de tu tienda</p>
              <p className="flex items-center gap-1.5 text-[0.8rem] text-mist"><Icon name="telegram" size={13} className="text-[#6cc1f5]" />En Telegram</p>
            </div>
            <Badge kind="demo" onDark />
          </div>
          <ol className="space-y-2.5 px-2 pb-3 pt-5" aria-label="Conversación de ejemplo con el asistente">
            <Bubble me index={0}>Quiero agregar un producto.</Bubble>
            <Bubble index={1}>¡Listo! Envíame una foto.</Bubble>
            <li data-reveal style={i(4)} className="flex justify-end">
              <img src={product.src} alt={`Foto real de ${product.name} enviada al asistente`} width={480} height={480} loading="lazy" decoding="async" className="w-36 rounded-2xl rounded-br-md object-cover ring-2 ring-lime" />
            </li>
            <li data-reveal style={i(6)} className="flex justify-start">
              <div className="max-w-[86%] rounded-2xl rounded-bl-md bg-white/8 p-3 ring-1 ring-inset ring-white/10">
                <p className="px-1 text-[0.95rem] leading-snug">Preparé la ficha del producto. ¿La publico?</p>
                <dl className="mt-2.5 space-y-1 rounded-xl bg-forest-deep p-3 text-[0.85rem]">
                  <div className="flex justify-between gap-4"><dt className="text-mist">Nombre</dt><dd className="text-right font-semibold">{product.name}</dd></div>
                  <div className="flex justify-between gap-4"><dt className="text-mist">Categoría</dt><dd className="font-semibold">{product.category}</dd></div>
                  <div className="flex justify-between gap-4"><dt className="text-mist">Precio</dt><dd className="font-semibold">{formatCOP(product.price)}</dd></div>
                  <div className="flex justify-between gap-4"><dt className="text-mist">Tallas</dt><dd className="font-semibold">{product.sizes.slice(0, 4).join(' · ')}</dd></div>
                </dl>
              </div>
            </li>
            <Bubble me index={4}>Sí, publícala.</Bubble>
            <Bubble index={5}><span className="flex items-center gap-2"><Icon name="check" size={16} className="text-lime" />Publicado. Ya está en tu tienda.</span></Bubble>
          </ol>
        </div>
      </div>
    </section>
  )
}
