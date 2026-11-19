// Single source of the price-change simulation and the product UI pieces that show it (hero and
// story scenes). It is a SIMULATION: nothing leaves the page and no store changes. Product, photos,
// category and prices are real data of the SneakerHub Premium pilot store (src/content/media.ts).
// The flow is the assistant's real one: a summary with Confirmar / Corregir / Cancelar and nothing
// saved without confirmation (worker/src/whatsapp/processor.ts, WHATSAPP_HELP_TEXT). The messages
// themselves are illustrative.
import type { KeyboardEvent, ReactNode } from 'react'
import { formatCOP, products, store as pilot } from '../content/media'
import { site } from '../config/site'
import { Icon } from '../components/ui/Icon'

export const target = products.find((p) => p.sku === 'NORD-02') ?? products[0]
export const others = ['ASTRAL-03', 'KINETIK-06'].map((sku) => products.find((p) => p.sku === sku)).filter((p): p is (typeof products)[number] => Boolean(p))
export const storeHost = `${new URL(site.appUrl).host}/t/sneakerhub-premium`
export const pilotName = pilot.name

/** Every figure and text of the simulation comes from here, on both sides. */
export const SIM = { sku: target.sku, name: target.name, oldPrice: target.price, newPrice: target.price - 20_000 }
export const money = (n: number) => formatCOP(n)
export const REQUEST = `Cambia el precio del ${SIM.sku} a ${money(SIM.newPrice).replace('$ ', '')}`

/** Stages of one run (ms = time on screen before the next one). */
export const STAGES = [
  { key: 'inicial', ms: 900 },
  { key: 'pedido', ms: 800 },
  { key: 'escribiendo', ms: 700 },
  { key: 'resumen', ms: 1500 },
  { key: 'confirmado', ms: 800 },
  { key: 'guardando', ms: 700 },
  { key: 'tienda', ms: 0 },
] as const
export const FINAL = STAGES.length - 1

export type Channel = 'whatsapp' | 'telegram'
export const CHANNELS: { key: Channel; label: string; color: string }[] = [
  { key: 'whatsapp', label: 'WhatsApp', color: 'text-[#25d366]' },
  { key: 'telegram', label: 'Telegram', color: 'text-[#2aabee]' },
]

/** Roving-tabindex keyboard handler for a small tab list. */
export function tabKeys<T extends string>(items: { key: T }[], current: T, select: (k: T) => void, idPrefix: string) {
  return (e: KeyboardEvent<HTMLButtonElement>) => {
    const at = items.findIndex((c) => c.key === current)
    const next = { ArrowRight: at + 1, ArrowLeft: at - 1, ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: items.length - 1 }[e.key]
    if (next === undefined) return
    e.preventDefault()
    const item = items[(next + items.length) % items.length]
    select(item.key)
    document.getElementById(`${idPrefix}-${item.key}`)?.focus()
  }
}

/** Price that slides from the old value to the new one; the hidden value is out of the a11y tree. */
export function Price({ updated, className = '' }: { updated: boolean; className?: string }) {
  return (
    <span className={`v2-price font-bold tracking-[-0.02em] tabular-nums ${className}`} data-updated={updated}>
      <span className="v2-price-old" aria-hidden={updated}>{money(SIM.oldPrice)}</span>
      <span className="v2-price-new" aria-hidden={!updated}>{money(SIM.newPrice)}</span>
    </span>
  )
}

export function UpdatedTag() {
  return <span className="v2-tag v2-pop rounded-full bg-(--v2-lime) px-2 py-0.5 text-[0.72rem] font-bold text-[#0c0e14]">Actualizado</span>
}

function Bubble({ me, wide, shown, children }: { me?: boolean; wide?: boolean; shown: boolean; children: ReactNode }) {
  // Hidden bubbles keep their space (no layout shift) and are out of the accessibility tree.
  return (
    <li className={`flex ${me ? 'justify-end' : 'justify-start'} ${shown ? 'v2-bubble' : 'invisible'}`}>
      <div className={`${wide ? 'w-full' : 'max-w-[90%]'} rounded-2xl px-4 py-2.5 text-[0.9375rem] leading-snug ${me ? 'rounded-br-md bg-[#2a2e38] text-[#f5f5f7]' : 'rounded-bl-md bg-[#0b0c10] text-[#f5f5f7]'}`}>{children}</div>
    </li>
  )
}

/** The owner's private admin chat, at a given stage. The channel only changes the skin. */
export function ChatPanel({ stage, channel, onChannel, idPrefix = 'canal-tab', panelId = 'demo-chat' }: { stage: number; channel: Channel; onChannel?: (c: Channel) => void; idPrefix?: string; panelId?: string }) {
  const current = CHANNELS.find((c) => c.key === channel)!
  const onKey = onChannel ? tabKeys(CHANNELS, channel, onChannel, idPrefix) : undefined
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-[1.75rem] bg-[#16181f] text-[#f5f5f7] shadow-[0_40px_90px_-40px_rgba(0,0,0,.9)]">
      <div className="flex items-center gap-3 px-5 pb-3 pt-4">
        <span className={`grid size-9 shrink-0 place-items-center rounded-full bg-[#0b0c10] ${current.color}`}><Icon name={channel} size={17} /></span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-[0.9375rem] font-semibold">Asistente TiendIA</span>
          <span className="flex items-center gap-1 text-[0.75rem] text-[#9a9fa9]"><Icon name="shield" size={11} />Chat privado de administración</span>
        </span>
        {onChannel ? (
          <div role="tablist" aria-label="Canal del asistente" className="relative flex shrink-0 rounded-full bg-[#0b0c10] p-0.5">
            <span className="v2-indicator absolute left-0.5 top-0.5 size-9 rounded-full bg-[#2a2e38]" style={{ transform: `translateX(${channel === 'telegram' ? '100%' : '0'})` }} aria-hidden="true" />
            {CHANNELS.map((c) => {
              const selected = c.key === channel
              return (
                <button key={c.key} type="button" role="tab" id={`${idPrefix}-${c.key}`} aria-selected={selected} aria-controls={panelId} tabIndex={selected ? 0 : -1} onClick={() => onChannel(c.key)} onKeyDown={onKey}
                  className={`relative grid size-9 place-items-center rounded-full transition-colors duration-150 ${selected ? c.color : 'text-[#9a9fa9] hover:text-[#f5f5f7]'}`}>
                  <Icon name={c.key} size={16} /><span className="sr-only">{c.label}</span>
                </button>
              )
            })}
          </div>
        ) : null}
      </div>
      <div id={panelId} role={onChannel ? 'tabpanel' : undefined} aria-labelledby={onChannel ? `${idPrefix}-${channel}` : undefined} className="flex flex-1 flex-col">
        <ol className="flex flex-col gap-2.5 px-4 pb-5 pt-2" aria-label={`Conversación simulada en ${current.label}`}>
          <Bubble me shown={stage >= 1}>{REQUEST}</Bubble>
          {stage === 2 ? (
            <li className="flex justify-start" aria-hidden="true">
              <span className="v2-bubble v2-typing flex gap-1 rounded-2xl rounded-bl-md bg-[#0b0c10] px-4 py-3.5"><span className="size-1.5 rounded-full bg-[#9a9fa9]" /><span className="size-1.5 rounded-full bg-[#9a9fa9]" /><span className="size-1.5 rounded-full bg-[#9a9fa9]" /></span>
            </li>
          ) : (
            <Bubble wide shown={stage >= 3}>
              <span className="block text-[0.72rem] font-semibold uppercase tracking-[0.06em] text-[#9a9fa9]">Resumen del cambio</span>
              <span className="mt-1 block">Precio de {SIM.name}</span>
              <span className="mt-0.5 block text-[1.0625rem] font-semibold tabular-nums"><s className="text-[0.875rem] font-normal text-[#9a9fa9]">{money(SIM.oldPrice)}</s> → {money(SIM.newPrice)}</span>
              <span className="mt-3 flex flex-wrap gap-1.5" aria-hidden="true">
                {['Confirmar', 'Corregir', 'Cancelar'].map((b) => <span key={b} className={`rounded-lg px-3 py-1.5 text-[0.8rem] font-semibold transition-[background-color,color,transform] duration-200 ${b === 'Confirmar' && stage >= 4 ? 'scale-[0.97] bg-[#f5f5f7] text-[#0b0c10]' : 'bg-[#1f222b] text-[#c9ccd3]'}`}>{b}</span>)}
              </span>
            </Bubble>
          )}
          <Bubble me shown={stage >= 4}>Confirmar</Bubble>
          <Bubble shown={stage >= 5}><span className="flex items-center gap-1.5"><Icon name="check" size={15} className="shrink-0" />Listo, precio actualizado.</span></Bubble>
        </ol>
      </div>
    </div>
  )
}

/** The buyer's view, one product: the store page that reflects the change. */
export function StoreSingle({ stage }: { stage: number }) {
  const updated = stage >= FINAL
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-[1.75rem] bg-white text-[#1d1d1f] shadow-[0_40px_90px_-40px_rgba(0,0,0,.6)]">
      <p className="truncate bg-[#f5f5f7] px-4 py-2 text-center text-[0.75rem] text-[#6e6e73]" aria-hidden="true">{storeHost}</p>
      <div className="flex items-center justify-between px-5 pb-1 pt-3.5">
        <p className="text-[1rem] font-bold tracking-[-0.02em]">{pilotName}</p>
        <Icon name="cart" size={18} className="text-[#6e6e73]" />
      </div>
      <div className="relative mx-3 mt-1 rounded-2xl px-2 pb-3 pt-1">
        {updated ? <span className="v2-tint pointer-events-none absolute inset-0 rounded-2xl" aria-hidden="true" /> : null}
        <img src={target.src} alt={`${SIM.name}, producto real de ${pilotName}`} width={480} height={480} loading="eager" decoding="async" className="aspect-[16/10] w-full rounded-xl bg-[#eef0f3] object-cover" />
        <p className="mt-3 text-[0.75rem] font-semibold uppercase tracking-[0.08em] text-[#6e6e73]">{target.category}</p>
        <p className="text-[1.25rem] font-bold leading-tight tracking-[-0.02em]">{SIM.name}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          {updated ? <s className="v2-pop text-[0.9rem] font-medium text-[#6e6e73] tabular-nums">{money(SIM.oldPrice)}</s> : null}
          <Price updated={updated} className="text-[1.5rem]" />
          {updated ? <UpdatedTag /> : stage === 5 ? <span className="text-[0.75rem] font-semibold text-[#6e6e73]">Actualizando…</span> : null}
        </div>
        <span className="mt-2 block h-0.5 overflow-hidden rounded-full" aria-hidden="true">{stage === 5 ? <span className="v2-run block h-full bg-[#1d1d1f]/25" /> : null}</span>
      </div>
    </div>
  )
}

/** The buyer's view as a catalogue (hero): three real products, the changed one in the middle. */
export function StoreGrid({ updated }: { updated: boolean }) {
  const grid = [others[0], target, others[1]].filter(Boolean)
  return (
    <div className="overflow-hidden rounded-[1.75rem] bg-white text-[#1d1d1f] shadow-[0_60px_120px_-50px_rgba(0,0,0,.95)]">
      <div className="flex items-center gap-3 bg-[#f5f5f7] px-5 py-2.5" aria-hidden="true">
        <span className="flex gap-1.5"><span className="size-2.5 rounded-full bg-black/12" /><span className="size-2.5 rounded-full bg-black/12" /><span className="size-2.5 rounded-full bg-black/12" /></span>
        <span className="min-w-0 flex-1 truncate text-center text-[0.75rem] text-[#6e6e73]">{storeHost}</span>
        <span className="w-10" />
      </div>
      <div className="flex items-center justify-between px-6 pb-2 pt-5 md:px-8">
        <p className="text-[1.125rem] font-bold tracking-[-0.02em]">{pilotName}</p>
        <Icon name="cart" size={19} className="text-[#6e6e73]" />
      </div>
      <ul className="grid grid-cols-2 gap-4 px-6 pb-7 pt-3 sm:grid-cols-3 md:gap-6 md:px-8" aria-label={`Productos de ${pilotName}`}>
        {grid.map((p, n) => {
          const isTarget = p.sku === target.sku
          return (
            <li key={p.sku} className={`relative ${n === 2 ? 'hidden sm:block' : ''} ${isTarget ? 'order-first sm:order-none' : ''}`}>
              {isTarget ? <span className={`pointer-events-none absolute -inset-3 rounded-[1.4rem] transition-opacity duration-700 ${updated ? 'opacity-100' : 'opacity-0'} bg-[radial-gradient(closest-side,rgba(217,255,24,.28),transparent)]`} aria-hidden="true" /> : null}
              <img src={p.src} alt={`${p.name}, producto real de ${pilotName}`} width={480} height={480} loading="eager" decoding="async" className={`relative aspect-square w-full rounded-2xl bg-[#eef0f3] object-cover ${isTarget && updated ? 'ring-2 ring-(--v2-lime) ring-offset-2 ring-offset-white' : ''}`} />
              <p className="relative mt-3 truncate text-[0.9375rem] font-semibold">{p.name}</p>
              <div className="relative mt-0.5 flex flex-wrap items-center gap-2">
                {isTarget ? <Price updated={updated} className="text-[1.0625rem]" /> : <span className="text-[1.0625rem] font-bold tabular-nums">{money(p.price)}</span>}
                {isTarget && updated ? <UpdatedTag /> : null}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
