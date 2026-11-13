// Real social proof (published stores and their public catalogue figures) and the problem/solution
// block. No testimonials, ratings, sales or customer counts: only what anyone can verify by opening
// the stores.
import type { CSSProperties } from 'react'
import { realCapturedAt, showcaseStores } from '../content/stores'
import { Eyebrow } from '../components/ui/primitives'
import { Icon } from '../components/ui/Icon'

const i = (n: number) => ({ '--i': n }) as CSSProperties
const date = new Date(realCapturedAt).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Bogota' })

export function Proof() {
  return (
    <section aria-labelledby="comercios-title" className="border-b border-forest/8 bg-ivory py-14 md:py-16">
      <div className="wrap grid items-center gap-10 lg:grid-cols-[minmax(0,0.42fr)_minmax(0,1fr)] lg:gap-16">
        <div>
          <h2 id="comercios-title" className="font-display text-[1.35rem] font-extrabold leading-snug tracking-tight md:text-2xl">Comercios reales ya venden con su tienda en TiendIA Exprés.</h2>
          <p className="mt-2 text-[0.88rem] text-ink-soft">Cifras de sus catálogos públicos al {date}.</p>
        </div>
        <ul className="grid gap-px overflow-hidden rounded-2xl bg-forest/10 ring-1 ring-forest/10 sm:grid-cols-3">
          {showcaseStores.map((store) => (
            <li key={store.slug} className="bg-ivory">
              <a href="#tiendas" className="group flex h-full flex-col gap-1 p-5 transition-colors hover:bg-paper md:p-6">
                <span className="font-display text-xl font-extrabold tracking-tight">{store.name}</span>
                <span className="text-[0.88rem] text-ink-soft">{store.category}</span>
                <span className="mt-3 flex items-center gap-1.5 text-[0.88rem] font-semibold">
                  {store.productCount} productos · {store.categoryCount} categorías
                  <Icon name="arrowRight" size={15} className="text-violet-ink transition-transform duration-300 group-hover:translate-x-1" />
                </span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

const BEFORE = [
  'Envías las mismas fotos y los mismos precios una y otra vez.',
  'Los pedidos se pierden entre mensajes, audios y capturas de pantalla.',
  'Tu catálogo en PDF o en estados se desactualiza rápido.',
  'Cada cliente pregunta talla, color y disponibilidad antes de decidir.',
]
const AFTER = [
  { title: 'Un solo enlace con todo tu catálogo', body: 'Lo compartes en estados, redes y conversaciones, y siempre está al día.' },
  { title: 'Pedidos completos en un mensaje', body: 'Llegan a tu WhatsApp con productos, tallas y datos de entrega.' },
  { title: 'Cambios en segundos', body: 'Actualizas precios, fotos y existencias desde el panel o por Telegram.' },
  { title: 'Menos preguntas repetidas', body: 'Tu cliente ve precios, tallas y variantes antes de escribirte.' },
]

export function Problem() {
  return (
    <section aria-labelledby="problema-title" className="bg-ivory py-24 md:py-32">
      <div className="wrap">
        <div className="max-w-3xl" data-reveal>
          <Eyebrow className="mb-5">El problema</Eyebrow>
          <h2 id="problema-title" className="display text-[clamp(2.1rem,4.6vw,3.75rem)]">Vender por chat no debería ser <span className="accent text-violet-ink">un desorden.</span></h2>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-ink-soft md:text-[1.2rem]">Si vendes por WhatsApp o Instagram, ya tienes clientes. Lo que falta es un lugar ordenado donde vean todo lo que ofreces y te pidan sin enredos.</p>
        </div>

        <div className="mt-14 grid gap-5 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-6">
          <div className="rounded-3xl border border-dashed border-forest/25 p-7 md:p-9" data-reveal>
            <h3 className="eyebrow text-ink-soft">Sin una tienda</h3>
            <ul className="mt-6 space-y-5">
              {BEFORE.map((item) => (
                <li key={item} className="flex gap-3.5 text-[1.02rem] leading-snug text-ink-soft">
                  <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-forest/8 text-forest/60"><Icon name="close" size={13} /></span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div className="on-dark relative overflow-hidden rounded-3xl bg-forest p-7 text-ivory md:p-9" data-reveal style={i(1)}>
            <div className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-[radial-gradient(closest-side,rgba(203,250,58,.16),transparent)]" aria-hidden="true" />
            <h3 className="eyebrow text-lime">Con TiendIA Exprés</h3>
            <ul className="mt-6 grid gap-x-8 gap-y-7 sm:grid-cols-2">
              {AFTER.map((item) => (
                <li key={item.title} className="flex gap-3.5">
                  <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-lime text-forest"><Icon name="check" size={14} /></span>
                  <p><span className="block font-display text-[1.08rem] font-bold leading-snug">{item.title}</span><span className="mt-1 block text-[0.96rem] leading-snug text-mist">{item.body}</span></p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  )
}
