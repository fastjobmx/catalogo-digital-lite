// Renders the example WhatsApp order message as the merchant receives it (a chat view).
// Text is real HTML: readable, selectable and indexable. Used by the showcase's WhatsApp tab.
import type { ReactNode } from 'react'
import { orderCustomer, orderMessageLines, orderTime } from '../../content/orderMessage'
import { Icon } from './Icon'

/** WhatsApp inline formatting: *bold* and _italics_. */
function format(line: string): ReactNode[] {
  return line.split(/(\*[^*]+\*|_[^_]+_)/g).filter(Boolean).map((part, i) => {
    if (part.startsWith('*') && part.endsWith('*')) return <strong key={i}>{part.slice(1, -1)}</strong>
    if (part.startsWith('_') && part.endsWith('_')) return <em key={i}>{part.slice(1, -1)}</em>
    const url = part.match(/https:\/\/\S+/)
    if (!url) return <span key={i}>{part}</span>
    const at = url.index ?? 0
    return <span key={i}>{part.slice(0, at)}<span className="break-all text-[#027eb5] underline">{url[0]}</span>{part.slice(at + url[0].length)}</span>
  })
}

function Bubble({ compact }: { compact?: boolean }) {
  return (
    <div className={`relative max-w-[min(34rem,92%)] rounded-xl rounded-tl-none bg-white text-[#111b21] shadow-[0_1px_0.5px_rgba(11,20,26,.13)] ${compact ? 'px-2 py-1.5 text-[0.5rem] leading-[1.35]' : 'px-3.5 py-2.5 text-[0.82rem] leading-[1.45] md:text-[0.9rem]'}`}>
      {orderMessageLines.map((line, i) => (
        <p key={i} className={`whitespace-pre-wrap ${line ? '' : compact ? 'h-1.5' : 'h-3'}`}>{format(line)}</p>
      ))}
      <p className={`mt-1 text-right text-[#54656f] ${compact ? 'text-[0.42rem]' : 'text-[0.7rem]'}`}>{orderTime}</p>
    </div>
  )
}

function ChatHeader({ compact }: { compact?: boolean }) {
  return (
    <div className={`flex items-center gap-3 bg-[#f0f2f5] text-[#111b21] ${compact ? 'gap-1.5 px-2 pb-1.5 pt-7' : 'px-4 py-2.5'}`}>
      <span className={`grid shrink-0 place-items-center rounded-full bg-[#dfe5e7] font-bold text-[#54656f] ${compact ? 'size-5 text-[0.5rem]' : 'size-9 text-sm'}`} aria-hidden="true">AG</span>
      <div className="min-w-0">
        <p className={`truncate font-semibold ${compact ? 'text-[0.55rem]' : 'text-[0.95rem]'}`}>{orderCustomer}</p>
        <p className={`truncate text-[#54656f] ${compact ? 'text-[0.45rem]' : 'text-xs'}`}>Cliente de ejemplo</p>
      </div>
      <Icon name="whatsapp" size={compact ? 11 : 18} className="ml-auto shrink-0 text-[#25d366]" />
    </div>
  )
}

/** Large chat panel (desktop frame). */
export function OrderMessageChat() {
  return (
    <div className="flex size-full flex-col bg-[#efeae2]">
      <ChatHeader />
      <div className="flex-1 overflow-hidden p-4 md:px-8 md:py-6">
        <p className="mx-auto mb-4 w-fit rounded-lg bg-white/90 px-3 py-1 text-[0.7rem] text-[#54656f] shadow-sm">Hoy</p>
        <Bubble />
      </div>
    </div>
  )
}

/** Compact chat for the phone frame: decorative copy of the same message. */
export function OrderMessagePhone() {
  return (
    <div className="absolute inset-0 flex flex-col bg-[#efeae2]" aria-hidden="true">
      <ChatHeader compact />
      <div className="flex-1 overflow-hidden p-2">
        <Bubble compact />
      </div>
    </div>
  )
}
