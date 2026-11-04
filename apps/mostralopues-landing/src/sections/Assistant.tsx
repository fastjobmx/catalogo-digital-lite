// "Tu negocio tiene un nuevo asistente": illustrative Telegram conversation. It is labelled as a
// demonstration: it shows the flow, it is not a live transaction.
import { useEffect, useRef, useState } from 'react'
import { products, formatCOP } from '../content/media'
import { Badge, SectionHeading } from '../components/ui/primitives'
import { Icon } from '../components/ui/Icon'

const product = products[0]
const STEPS = ['Foto recibida', 'Información procesada', 'Ficha preparada', 'Confirmación', 'Producto publicado']

type Message = { from: 'me' | 'bot'; step: number; kind: 'text' | 'photo' | 'draft' | 'done'; text?: string }
const MESSAGES: Message[] = [
  { from: 'me', step: -1, kind: 'text', text: 'Quiero agregar un producto.' },
  { from: 'bot', step: -1, kind: 'text', text: '¡Listo! Enviame una foto.' },
  { from: 'me', step: 0, kind: 'photo' },
  { from: 'bot', step: 1, kind: 'text', text: 'Recibí la foto. Estoy preparando la ficha…' },
  { from: 'bot', step: 2, kind: 'draft', text: 'Preparé la ficha del producto. ¿Querés revisarla antes de publicarla?' },
  { from: 'me', step: 3, kind: 'text', text: 'Sí, publicala.' },
  { from: 'bot', step: 4, kind: 'done', text: 'Publicado. Ya está en tu tienda.' },
]

export function Assistant() {
  const root = useRef<HTMLElement>(null)
  const [shown, setShown] = useState(MESSAGES.length)
  const [typing, setTyping] = useState(false)
  const [run, setRun] = useState(0)
  const started = useRef(false)

  const play = () => {
    if (!document.documentElement.classList.contains('motion')) { setShown(MESSAGES.length); return }
    setShown(0)
    setRun((r) => r + 1)
  }

  // Start once, the first time the chat is mostly visible.
  useEffect(() => {
    const el = root.current?.querySelector('[data-chat]')
    if (!el || !document.documentElement.classList.contains('motion')) return
    setShown(0)
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !started.current) { started.current = true; setRun((r) => r + 1) }
    }, { threshold: 0.45 })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (run === 0) return
    let cancelled = false
    const timers: number[] = []
    let t = 300
    MESSAGES.forEach((m, i) => {
      const wait = m.from === 'bot' ? 900 : 650
      if (m.from === 'bot') timers.push(window.setTimeout(() => !cancelled && setTyping(true), t))
      t += wait
      timers.push(window.setTimeout(() => { if (cancelled) return; setTyping(false); setShown(i + 1) }, t))
      t += m.kind === 'draft' ? 900 : 350
    })
    return () => { cancelled = true; timers.forEach(clearTimeout) }
  }, [run])

  useEffect(() => {
    const log = root.current?.querySelector('[data-chat-scroll]')
    if (log) log.scrollTo({ top: log.scrollHeight, behavior: 'smooth' })
  }, [shown, typing])

  const step = Math.max(-1, ...MESSAGES.slice(0, shown).map((m) => m.step))

  return (
    <section ref={root} aria-labelledby="asistente-title" className="relative overflow-hidden bg-ivory py-24 md:py-36">
      <div className="wrap grid grid-cols-1 items-center gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] lg:gap-20">
        <div>
          <SectionHeading
            id="asistente-title"
            title="Tu negocio tiene un nuevo asistente."
            intro="Administrá tu catálogo desde Telegram. Le escribís como a una persona y te pide confirmación antes de guardar."
          />
          <ol className="mt-12 grid gap-1.5" aria-label="Pasos de la demostración">
            {STEPS.map((label, i) => {
              const state = i < step ? 'done' : i === step ? 'now' : 'next'
              return (
                <li key={label} className="flex items-center gap-4">
                  <span className={`grid size-9 shrink-0 place-items-center rounded-full font-display text-sm font-bold transition-colors duration-500 ${state === 'next' ? 'bg-forest/6 text-ink-soft' : state === 'now' ? 'bg-lime text-forest ring-4 ring-lime/40' : 'bg-forest text-lime'}`}>
                    {state === 'done' ? <Icon name="check" size={16} /> : i + 1}
                  </span>
                  <span className={`py-2 font-display text-lg font-semibold transition-colors duration-500 md:text-xl ${state === 'next' ? 'font-medium text-ink-soft' : 'text-forest'}`}>{label}</span>
                </li>
              )
            })}
          </ol>
        </div>

        <div data-chat className="relative">
          <div className="absolute -inset-6 -z-10 rounded-[3rem] bg-[radial-gradient(circle_at_70%_30%,rgba(198,242,91,.55),transparent_60%)]" aria-hidden="true" />
          <div className="overflow-hidden rounded-[2rem] bg-[#0e1b16] shadow-[0_50px_100px_-40px_rgba(10,33,26,.8)] ring-1 ring-forest/20">
            <div className="flex items-center gap-3 bg-[#17241f] px-5 py-4 text-ivory">
              <span className="grid size-10 place-items-center rounded-full bg-lime text-forest"><Icon name="bot" size={20} /></span>
              <div className="min-w-0 flex-1">
                <p className="font-display font-bold leading-tight">Tu asistente</p>
                <p className="text-xs text-mist">{typing ? 'escribiendo…' : 'en Telegram'}</p>
              </div>
              <Icon name="telegram" size={22} className="text-[#7cc4ee]" title="Telegram" />
            </div>
            <div className="flex justify-center bg-[#0e1b16] pt-3"><Badge kind="demo" onDark /></div>
            <div data-chat-scroll className="h-[29rem] space-y-2.5 overflow-y-auto px-4 pb-5 pt-3 [scrollbar-width:none] md:h-[31rem]">
              {MESSAGES.map((m, i) => (
                <div
                  key={i}
                  className={`${i < shown ? 'flex' : 'hidden'} animate-[fade-up_.5s_var(--ease-out-expo)] ${m.from === 'me' ? 'justify-end' : 'justify-start'}`}
                >
                  <Bubble message={m} />
                </div>
              ))}
              <div className={`${typing ? 'flex' : 'hidden'} justify-start`} aria-hidden="true">
                <div className="flex gap-1 rounded-2xl rounded-bl-md bg-[#1f2e28] px-4 py-3">
                  {[0, 1, 2].map((d) => <span key={d} className="size-1.5 animate-bounce rounded-full bg-mist" style={{ animationDelay: `${d * 120}ms` }} />)}
                </div>
              </div>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-xs text-sm text-ink-soft">Conversación de ejemplo con un producto real de SneakerHub. No es una operación en vivo.</p>
            <button type="button" onClick={play} className="inline-flex min-h-11 items-center gap-2 rounded-full px-4 font-semibold text-forest ring-2 ring-forest/15 hover:bg-forest hover:text-ivory">
              <Icon name="replay" size={18} /> Repetir demostración
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}

function Bubble({ message }: { message: Message }) {
  const mine = message.from === 'me'
  const base = `max-w-[82%] rounded-2xl px-3.5 py-2.5 text-[0.95rem] leading-snug ${mine ? 'rounded-br-md bg-[#2b5a47] text-ivory' : 'rounded-bl-md bg-[#1f2e28] text-ivory'}`
  if (message.kind === 'photo') {
    return (
      <div className="w-[62%] overflow-hidden rounded-2xl rounded-br-md bg-[#2b5a47] p-1">
        <img src={product.src} alt={`Foto de ${product.name}`} width={480} height={480} loading="lazy" className="aspect-square w-full rounded-[0.9rem] object-cover" />
      </div>
    )
  }
  if (message.kind === 'draft') {
    return (
      <div className={`${base} w-[86%]`}>
        <p>{message.text}</p>
        <div className="mt-2.5 overflow-hidden rounded-xl bg-ivory text-forest">
          <div className="flex gap-3 p-2.5">
            <img src={product.src} alt="" width={480} height={480} loading="lazy" className="size-16 rounded-lg object-cover" />
            <div className="min-w-0 text-sm">
              <p className="font-display font-bold leading-tight">{product.name}</p>
              <p className="text-ink-soft">{product.category} · tallas {product.sizes[0]}–{product.sizes[product.sizes.length - 1]}</p>
              <p className="font-semibold">{formatCOP(product.price)}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 border-t border-forest/10 text-center text-sm font-bold">
            <span className="flex items-center justify-center gap-1.5 py-2"><Icon name="check" size={15} /> Publicar</span>
            <span className="border-l border-forest/10 py-2">Editar</span>
          </div>
        </div>
      </div>
    )
  }
  if (message.kind === 'done') {
    return (
      <div className={`${base} w-[86%]`}>
        <p className="flex items-center gap-2"><span className="grid size-5 place-items-center rounded-full bg-lime text-forest"><Icon name="check" size={13} /></span>{message.text}</p>
        <div className="mt-2.5 flex items-center gap-2 rounded-xl bg-lime px-3 py-2 text-sm font-bold text-forest">
          <Icon name="store" size={17} /> Ver en la tienda <Icon name="arrowUpRight" size={15} className="ml-auto" />
        </div>
      </div>
    )
  }
  return <div className={base}>{message.text}</div>
}
