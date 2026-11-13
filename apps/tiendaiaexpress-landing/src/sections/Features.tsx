// "Funciones" as a bento grid. Only features verified in the platform code are listed as
// available; plan-specific ones say so (src/content/plans.ts) and upcoming ones are labelled.
import type { CSSProperties, ReactNode } from 'react'
import { products, screens, templates } from '../content/media'
import { orderMessageLines } from '../content/orderMessage'
import { Badge, SectionHeading } from '../components/ui/primitives'
import { PhoneFrame } from '../components/ui/PhoneFrame'
import { Icon, type IconName } from '../components/ui/Icon'

const i = (n: number) => ({ '--i': n }) as CSSProperties
const sizes = products[0]?.sizes.slice(0, 7) ?? []
/** First lines of the real order message (WhatsApp formatting marks removed). */
const orderPreview = orderMessageLines.filter(Boolean).slice(0, 2).concat(orderMessageLines.slice(9, 13)).map((line) => line.replace(/\*/g, ''))

function Tile({ className = '', children, index = 0 }: { className?: string; children: ReactNode; index?: number }) {
  return <article data-reveal style={i(index)} className={`relative overflow-hidden rounded-3xl p-7 md:p-8 ${className}`}>{children}</article>
}

const MORE: { icon: IconName; title: string; body: string; note?: string }[] = [
  { icon: 'file', title: 'Importa tu lista de productos', body: 'Desde Excel o CSV, o desde un PDF con lectura por IA opcional.' },
  { icon: 'ticket', title: 'Cupones de descuento', body: 'Los creas en tu panel y tus clientes los aplican en el carrito.' },
  { icon: 'truck', title: 'Pedidos con estados y guía', body: 'Recibido, confirmado, enviado y entregado, con transportadora y número de guía.', note: 'Desde el plan Negocio' },
  { icon: 'users', title: 'Tu equipo, con permisos', body: 'Varios administradores con roles para ventas o inventario.', note: 'Plan Mayorista' },
  { icon: 'stores', title: 'Varias tiendas, una cuenta', body: 'Administra más de una tienda desde la misma cuenta de Telegram.' },
  { icon: 'globe', title: 'Dominio propio', body: 'Tu tienda en tu propia dirección, con configuración asistida.', note: 'Complemento opcional' },
]
const SOON = ['Estadísticas avanzadas', 'Asistente de ventas para tus clientes', 'Promociones inteligentes']

export function Features() {
  return (
    <section id="funciones" aria-labelledby="funciones-title" className="bg-paper py-24 md:py-32">
      <div className="wrap">
        <div data-reveal>
          <SectionHeading id="funciones-title" eyebrow="Funciones" title={<>Todo lo que necesitas para <span className="accent text-violet-ink">vender en línea.</span></>} intro="Una tienda completa para tu cliente y herramientas sencillas para ti. Sin instalar nada y sin saber de tecnología." />
        </div>

        <div className="mt-14 grid gap-4 md:grid-cols-6 lg:grid-cols-12">
          <Tile className="on-dark bg-forest text-ivory md:col-span-6 lg:col-span-7 lg:row-span-2 lg:min-h-[34rem]">
            <div className="grid-fade pointer-events-none absolute inset-0" aria-hidden="true" />
            <div className="relative max-w-sm">
              <Icon name="devices" size={26} className="text-lime" />
              <h3 className="mt-5 font-display text-[1.7rem] font-extrabold leading-tight tracking-tight md:text-[2rem]">Un catálogo que se ve bien en cualquier celular</h3>
              <p className="mt-3 text-mist">Productos, categorías, fotos y precios ordenados en una tienda rápida, con tu marca y tu propia dirección.</p>
            </div>
            <div className="relative mt-8 flex justify-center gap-5 lg:absolute lg:bottom-[-7rem] lg:right-8 lg:mt-0 xl:right-12">
              <PhoneFrame src={screens.catalog} alt="Captura real del catálogo de SneakerHub Premium en el celular" width="clamp(9rem, 26vw, 13.5rem)" className="lg:translate-y-10" />
              <PhoneFrame src={screens.product} alt="Captura real de una ficha de producto de SneakerHub Premium" width="clamp(9rem, 26vw, 13.5rem)" className="max-sm:hidden" />
            </div>
            <p className="relative mt-6 text-[0.78rem] text-mist lg:absolute lg:bottom-7 lg:left-8 lg:mt-0 lg:max-w-[13rem]">Capturas reales de la tienda piloto SneakerHub Premium.</p>
          </Tile>

          <Tile index={1} className="bg-ivory ring-1 ring-forest/8 md:col-span-3 lg:col-span-5">
            <Icon name="whatsapp" size={26} className="text-forest" />
            <h3 className="mt-5 font-display text-[1.45rem] font-extrabold leading-tight tracking-tight">Pedidos completos por WhatsApp</h3>
            <p className="mt-2 text-ink-soft">Tu cliente arma el carrito y el pedido te llega listo para confirmar.</p>
            <div className="mt-6 rounded-2xl rounded-tl-none bg-paper p-4 text-[0.82rem] leading-relaxed text-[#111b21] shadow-[0_1px_1px_rgba(11,20,26,.12)] ring-1 ring-forest/6" aria-label="Fragmento del mensaje de pedido">
              {orderPreview.map((line, n) => <p key={n} className={`whitespace-pre-wrap ${n < 2 ? 'font-semibold' : ''}`}>{line}</p>)}
              <p className="text-ink-soft">…</p>
            </div>
            <p className="mt-3 text-[0.78rem] text-ink-soft">Formato real del mensaje. <a href="#demo" className="font-semibold text-forest underline decoration-lime decoration-2 underline-offset-4">Ver el mensaje completo</a></p>
          </Tile>

          <Tile index={2} className="bg-lime text-forest md:col-span-3 lg:col-span-5">
            <p className="display text-[clamp(3.6rem,7vw,5.2rem)] leading-none">0 %</p>
            <h3 className="mt-3 font-display text-[1.45rem] font-extrabold leading-tight tracking-tight">Sin comisión por venta</h3>
            <p className="mt-2 max-w-sm text-forest/85">Pagas tu plan y nada más. El pago lo acuerdas directamente con tu cliente.</p>
          </Tile>

          <Tile index={1} className="bg-ivory ring-1 ring-forest/8 md:col-span-3 lg:col-span-4">
            <Icon name="layers" size={26} className="text-forest" />
            <h3 className="mt-5 font-display text-[1.3rem] font-extrabold leading-tight tracking-tight">Tallas, variantes e inventario</h3>
            <p className="mt-2 text-ink-soft">Carga existencias por talla o color y tu cliente elige sin preguntar.</p>
            <ul className="mt-5 flex flex-wrap gap-1.5" aria-label={`Tallas de ${products[0]?.name}`}>
              {sizes.map((size, n) => <li key={size} className={`grid h-10 min-w-10 place-items-center rounded-xl px-2 text-sm font-bold ring-1 ring-inset ${n === 2 ? 'bg-forest text-ivory ring-forest' : 'bg-paper ring-forest/15'}`}>{size}</li>)}
            </ul>
          </Tile>

          <Tile index={2} className="bg-ivory ring-1 ring-forest/8 md:col-span-3 lg:col-span-4">
            <Icon name="palette" size={26} className="text-forest" />
            <h3 className="mt-5 font-display text-[1.3rem] font-extrabold leading-tight tracking-tight">{templates.length} plantillas para tu marca</h3>
            <p className="mt-2 text-ink-soft">Elige el estilo, pon tu logo y tus colores.</p>
            <div className="mt-5 flex" aria-hidden="true">
              {templates.slice(0, 4).map((t, n) => <img key={t.key} src={t.src} alt="" width={640} height={400} loading="lazy" decoding="async" className={`aspect-[4/3] w-[38%] rounded-xl object-cover object-top shadow-[0_10px_24px_-12px_rgba(6,43,37,.5)] ring-1 ring-forest/10 ${n ? '-ml-[17%]' : ''}`} style={{ transform: `rotate(${(n - 1.5) * 2.5}deg)` }} />)}
            </div>
          </Tile>

          <Tile index={3} className="bg-[#f3e9fd] md:col-span-6 lg:col-span-4">
            <Icon name="sparkle" size={26} className="text-violet-ink" />
            <h3 className="mt-5 font-display text-[1.3rem] font-extrabold leading-tight tracking-tight">Fichas con IA desde una foto</h3>
            <p className="mt-2 text-ink-soft">Subes la foto y la IA sugiere nombre, categoría y descripción. Tú revisas y completas precio y tallas.</p>
            <p className="mt-5 text-[0.82rem] font-semibold text-violet-ink">Usa las cuotas de IA de tu plan.</p>
          </Tile>
        </div>

        <ul className="mt-12 grid gap-x-10 gap-y-8 border-t border-forest/10 pt-12 sm:grid-cols-2 lg:grid-cols-3">
          {MORE.map((item, n) => (
            <li key={item.title} className="flex gap-4" data-reveal style={i(n % 3)}>
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-ivory text-forest ring-1 ring-forest/10"><Icon name={item.icon} size={20} /></span>
              <div>
                <h3 className="font-display text-[1.05rem] font-bold leading-snug">{item.title}</h3>
                <p className="mt-1 text-[0.95rem] leading-snug text-ink-soft">{item.body}</p>
                {item.note ? <p className="mt-1.5 text-[0.8rem] font-semibold text-violet-ink">{item.note}</p> : null}
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-12 flex flex-wrap items-center gap-2.5 rounded-2xl bg-ivory px-5 py-4 ring-1 ring-forest/8">
          <Badge kind="soon" label="En camino" />
          <ul className="flex flex-wrap gap-x-5 gap-y-1 text-[0.92rem] text-ink-soft">
            {SOON.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      </div>
    </section>
  )
}
