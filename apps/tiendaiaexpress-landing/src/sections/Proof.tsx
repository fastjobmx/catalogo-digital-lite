// Real social proof (published stores and their public catalogue figures) and the before/after
// block. No testimonials, ratings, sales or customer counts: only what anyone can verify by opening
// the stores. The chat in "Antes" is an illustration and is labelled as such for screen readers.
import type { CSSProperties } from 'react'
import { realCapturedAt, showcaseStores } from '../content/stores'
import { Icon } from '../components/ui/Icon'
import { Sparks, Swoosh } from '../components/brand/Decor'

const i = (n: number) => ({ '--i': n }) as CSSProperties
const d = (n: number) => ({ '--d': n }) as CSSProperties
const date = new Date(realCapturedAt).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Bogota' })

export function Proof() {
  return (
    <section aria-labelledby="comercios-title" className="border-b border-night/8 bg-paper py-12 md:py-14">
      <div className="wrap grid items-center gap-8 lg:grid-cols-[minmax(0,0.42fr)_minmax(0,1fr)] lg:gap-16">
        <div>
          <p className="eyebrow flex items-center gap-2 text-violet-ink"><span className="size-2 rounded-full bg-cyan ring-4 ring-cyan/30" aria-hidden="true" />En vivo</p>
          <h2 id="comercios-title" className="mt-3 font-display text-[1.35rem] font-extrabold leading-snug tracking-tight md:text-2xl">Comercios reales ya venden con su tienda en TiendIA Exprés.</h2>
          <p className="mt-2 text-[0.88rem] text-ink-soft">Cifras de sus tiendas públicas al {date}.</p>
        </div>
        <ul className="grid gap-3 sm:grid-cols-3">
          {showcaseStores.map((store) => (
            <li key={store.slug}>
              <a href="#tiendas" className="hover-lift group flex h-full flex-col gap-1 rounded-2xl bg-porcelain p-5 ring-1 ring-night/8 md:p-6">
                <span className="font-display text-xl font-extrabold tracking-tight">{store.name}</span>
                <span className="text-[0.88rem] text-ink-soft">{store.category}</span>
                <span className="mt-3 flex items-center gap-1.5 text-[0.88rem] font-semibold">
                  <span className="whitespace-nowrap rounded-full bg-lime px-2 py-0.5">{store.productCount} productos</span> · {store.categoryCount} categorías
                  <Icon name="arrowRight" size={15} className="ml-auto text-violet-ink transition-transform duration-300 group-hover:translate-x-1" />
                </span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

const CHAT = [
  { text: '¿Cuánto vale?', time: '10:20' },
  { text: '¿Qué tallas tienes?', time: '10:21' },
  { text: '¿Tienes otro color?', time: '10:22' },
  { text: '¿Cómo hago el pedido?', time: '10:23' },
]
const BEFORE = [
  'Envías las mismas fotos y los mismos precios una y otra vez.',
  'Los pedidos se pierden entre mensajes, audios y capturas.',
  'Tu catálogo en PDF o en estados se desactualiza rápido.',
]
const AFTER = [
  { title: 'Tu tienda online siempre abierta', body: 'Un solo enlace con todos tus productos, siempre al día.' },
  { title: 'Precios y tallas claros', body: 'Tu cliente ve precios, tallas y variantes antes de escribirte.' },
  { title: 'Pedidos completos por WhatsApp', body: 'Llegan con productos, tallas y datos de entrega.' },
  { title: 'Todo organizado, sin repetir mensajes', body: 'Cambias precios, fotos y existencias desde el panel o por Telegram.' },
]

/** Illustrative WhatsApp chat: the questions every seller answers by hand. */
function ChatPhone() {
  return (
    <div role="img" aria-label="Ilustración: un cliente pregunta el precio, las tallas, otro color y cómo hacer el pedido" className="relative w-[15rem] shrink-0 -rotate-[5deg] rounded-[2.4rem] bg-[linear-gradient(145deg,#f6d6ec,#e6b8fb)] p-[0.5rem] shadow-[0_40px_70px_-30px_rgba(164,20,207,.55)] sm:w-[16.5rem]">
      <div className="overflow-hidden rounded-[2rem] bg-[#f1e9f7]">
        <div className="flex items-center gap-2.5 bg-[#075e54] px-4 pb-3 pt-6 text-white">
          <span className="grid size-8 place-items-center rounded-full bg-white/25"><Icon name="users" size={16} /></span>
          <span className="leading-tight"><span className="block text-[0.9rem] font-bold">Cliente</span><span className="block text-[0.7rem] opacity-80">en línea</span></span>
        </div>
        <ul className="space-y-2.5 px-3 pb-5 pt-4" aria-hidden="true">
          {CHAT.map((m, n) => (
            <li key={m.text} className="pop w-fit max-w-[92%] rounded-2xl rounded-tl-sm bg-white px-3.5 py-2 text-[0.88rem] font-medium text-[#111b21] shadow-[0_1px_1px_rgba(11,20,26,.12)]" style={d(n)}>
              {m.text} <span className="ml-1 text-[0.62rem] text-[#5d6e78]">{m.time}</span>
            </li>
          ))}
        </ul>
        <div className="mx-3 mb-4 flex items-center gap-2 rounded-full bg-white px-3.5 py-2 text-[0.78rem] text-[#5d6e78]" aria-hidden="true">
          <span className="flex-1">Mensaje…</span>
          <span className="grid size-7 place-items-center rounded-full bg-[#128c7e] text-white"><Icon name="camera" size={14} /></span>
        </div>
      </div>
      <span className="absolute -bottom-5 -left-6 grid size-16 place-items-center rounded-full bg-[#ffcd3c] text-[2rem] shadow-[0_14px_30px_-10px_rgba(229,36,94,.6)]" aria-hidden="true">😩</span>
    </div>
  )
}

export function Problem() {
  return (
    <section aria-labelledby="problema-title" className="wash relative overflow-hidden py-24 md:py-32">
      <div className="wrap">
        <div className="mx-auto max-w-4xl text-center" data-reveal>
          <h2 id="problema-title" className="display text-[clamp(2.1rem,4.8vw,4rem)]">
            De responder cada precio a{' '}
            <span className="relative">
              <span className="accent hl">recibir pedidos organizados.</span>
              <Sparks className="absolute -right-11 -top-7 hidden md:inline-block" />
            </span>
          </h2>
          <Swoosh className="mx-auto mt-5 w-56" />
          <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-ink-soft md:text-[1.2rem]">Si vendes por WhatsApp o Instagram, ya tienes clientes. Lo que falta es un lugar ordenado donde vean todo lo que ofreces y te pidan sin enredos.</p>
        </div>

        <div className="relative mt-16 grid items-center gap-8 lg:grid-cols-2 lg:gap-20">
          <div data-tilt="0.4" className="relative flex flex-col items-center gap-10 rounded-[2rem] bg-[linear-gradient(160deg,#fde8f3,#f6e3fd)] p-7 ring-1 ring-violet/15 sm:flex-row md:p-9" data-reveal>
            <div className="sm:max-w-[13rem]">
              <p className="inline-flex rounded-full bg-[#d81b55] px-4 py-1.5 font-display text-[1.05rem] font-extrabold uppercase tracking-wide text-white shadow-[0_10px_24px_-10px_rgba(216,27,85,.8)]">Antes</p>
              <h3 className="mt-4 font-display text-[1.3rem] font-extrabold leading-tight">Tu WhatsApp lleno de preguntas repetidas y desorden.</h3>
              <ul className="mt-5 space-y-3">
                {BEFORE.map((item) => (
                  <li key={item} className="flex gap-2.5 text-[0.95rem] leading-snug text-ink-soft">
                    <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-[#d81b55]/12 text-[#a80f3d]"><Icon name="close" size={11} /></span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <ChatPhone />
          </div>

          <div className="flex justify-center lg:pointer-events-none lg:absolute lg:left-1/2 lg:top-1/2 lg:z-10 lg:-translate-x-1/2 lg:-translate-y-1/2" aria-hidden="true">
            <svg viewBox="0 0 120 80" className="w-20 rotate-90 drop-shadow-[0_12px_20px_rgba(197,42,241,.35)] lg:w-24 lg:rotate-0" fill="none">
              <defs><linearGradient id="arrow-g" x1="0" x2="1"><stop offset="0" stopColor="#c52af1" /><stop offset="1" stopColor="#12dce7" /></linearGradient></defs>
              <path d="M8 60C30 24 62 16 88 30" stroke="url(#arrow-g)" strokeWidth="14" strokeLinecap="round" />
              <path d="M76 8l36 24-40 12z" fill="#12dce7" />
            </svg>
          </div>

          <div data-tilt="0.4" className="on-dark relative overflow-hidden rounded-[2rem] bg-night p-7 text-porcelain shadow-[0_50px_90px_-45px_rgba(11,11,19,.9)] md:p-9" data-reveal style={i(1)}>
            <div className="pointer-events-none absolute -right-24 -top-24 size-80 rounded-full bg-[radial-gradient(closest-side,rgba(18,220,231,.25),transparent)]" aria-hidden="true" />
            <div className="pointer-events-none absolute -bottom-28 -left-16 size-80 rounded-full bg-[radial-gradient(closest-side,rgba(197,42,241,.4),transparent)]" aria-hidden="true" />
            <p className="relative inline-flex items-center gap-2 rounded-full bg-lime px-4 py-1.5 font-display text-[1.05rem] font-extrabold uppercase tracking-wide text-night"><Icon name="check" size={16} />Con TiendIA Exprés</p>
            <ul className="relative mt-7 grid gap-x-8 gap-y-6 sm:grid-cols-2">
              {AFTER.map((item, n) => (
                <li key={item.title} className="pop flex gap-3.5" style={d(n)}>
                  <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-lime text-night shadow-[0_0_18px_rgba(217,255,20,.55)]"><Icon name="check" size={15} /></span>
                  <p><span className="block font-display text-[1.08rem] font-bold leading-snug">{item.title}</span><span className="mt-1 block text-[0.95rem] leading-snug text-mist">{item.body}</span></p>
                </li>
              ))}
            </ul>
            <div className="relative mt-8 flex w-fit max-w-full items-center gap-3 rounded-2xl bg-paper py-2.5 pl-2.5 pr-4 text-night shadow-[0_20px_40px_-20px_rgba(0,0,0,.6)]" aria-hidden="true">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[#25d366] text-white"><Icon name="whatsapp" size={22} /></span>
              <span className="leading-tight"><span className="block font-display font-extrabold">Pedido generado</span><span className="block text-[0.8rem] text-ink-soft">Enviado por WhatsApp, listo para confirmar</span></span>
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-lime"><Icon name="check" size={14} /></span>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
