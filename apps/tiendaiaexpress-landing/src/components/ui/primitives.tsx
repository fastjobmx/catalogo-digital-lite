import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { Icon, type IconName } from './Icon'

type ButtonProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  variant?: 'lime' | 'violet' | 'night' | 'porcelain' | 'outline-dark' | 'outline-light'
  size?: 'sm' | 'md' | 'lg'
  icon?: IconName
  /** Optional icon before the label (the brand pieces lead with a store or play icon). */
  lead?: IconName
  external?: boolean
  children: ReactNode
}

const VARIANTS = {
  lime: 'bg-lime text-night shadow-[0_1px_0_rgba(255,255,255,.55)_inset,0_0_0_1px_rgba(11,11,19,.06),0_14px_34px_-12px_rgba(217,255,20,.75)] hover:bg-[#e6ff5c] hover:shadow-[0_1px_0_rgba(255,255,255,.55)_inset,0_18px_44px_-10px_rgba(217,255,20,.9)]',
  violet: 'bg-violet-deep text-white shadow-[0_1px_0_rgba(255,255,255,.3)_inset,0_0_0_1px_rgba(197,42,241,.6),0_14px_34px_-12px_rgba(197,42,241,.9)] hover:bg-violet-ink',
  night: 'bg-night text-porcelain shadow-[0_14px_30px_-16px_rgba(11,11,19,.85)] hover:bg-night-raised',
  porcelain: 'bg-porcelain text-night hover:bg-paper',
  'outline-dark': 'text-night ring-1 ring-night/25 ring-inset hover:bg-night hover:text-porcelain hover:ring-night',
  'outline-light': 'text-porcelain ring-1 ring-porcelain/30 ring-inset hover:bg-porcelain hover:text-night hover:ring-porcelain',
}
const SIZES = { sm: 'min-h-11 px-4 text-[0.9rem]', md: 'min-h-12 px-5 text-[0.95rem]', lg: 'min-h-14 px-7 text-[1rem]' }

/** Link styled as a button. External links open in a new tab and say so to screen readers. */
export function Button({ variant = 'night', size = 'md', icon, lead, external, className = '', children, ...rest }: ButtonProps) {
  return (
    <a
      {...rest}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className={`group/btn relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-full font-display font-bold tracking-[-0.01em] transition-[transform,background-color,color,box-shadow] duration-300 ease-[var(--ease-out-expo)] active:scale-[0.97] ${SIZES[size]} ${VARIANTS[variant]} ${className}`}
    >
      {lead ? <Icon name={lead} size={size === 'lg' ? 20 : 18} className="shrink-0" /> : null}
      <span>{children}</span>
      {icon ? <Icon name={icon} size={18} className="shrink-0 transition-transform duration-300 ease-[var(--ease-out-expo)] group-hover/btn:translate-x-0.5" /> : null}
      {external ? <span className="sr-only"> (se abre en una pestaña nueva)</span> : null}
    </a>
  )
}

type BadgeKind = 'demo' | 'soon' | 'live' | 'real'
const BADGES: Record<BadgeKind, { label: string; className: string }> = {
  demo: { label: 'Demostración ilustrativa', className: 'bg-violet/10 text-violet-ink ring-violet/30' },
  soon: { label: 'Próximamente', className: 'bg-night/6 text-ink-soft ring-night/20' },
  live: { label: 'Disponible', className: 'bg-lime/45 text-night ring-night/15' },
  real: { label: 'Captura real', className: 'bg-paper text-night ring-night/15' },
}

export function Badge({ kind, label, onDark }: { kind: BadgeKind; label?: string; onDark?: boolean }) {
  const style = onDark
    ? kind === 'demo'
      ? 'bg-violet/20 text-violet-soft ring-violet/50'
      : kind === 'soon'
        ? 'bg-porcelain/8 text-mist ring-porcelain/25'
        : 'bg-lime/12 text-lime ring-lime/35'
    : BADGES[kind].className
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.74rem] font-semibold leading-none ring-1 ring-inset ${style}`}>
      <span className={`size-1.5 rounded-full ${kind === 'demo' ? 'bg-violet' : kind === 'soon' ? 'bg-current opacity-60' : 'bg-current'}`} aria-hidden="true" />
      {label ?? BADGES[kind].label}
    </span>
  )
}

/** Small uppercase label above a heading. */
export function Eyebrow({ children, onDark, className = '' }: { children: ReactNode; onDark?: boolean; className?: string }) {
  return (
    <p className={`eyebrow flex items-center gap-2.5 ${onDark ? 'text-cyan' : 'text-violet-ink'} ${className}`}>
      <span className={`h-px w-6 ${onDark ? 'bg-cyan/70' : 'bg-violet-ink/60'}`} aria-hidden="true" />
      {children}
    </p>
  )
}

export function SectionHeading({ id, eyebrow, kicker, title, intro, onDark, align = 'left', size = 'lg' }: { id: string; eyebrow?: string; kicker?: ReactNode; title: ReactNode; intro?: ReactNode; onDark?: boolean; align?: 'left' | 'center'; size?: 'lg' | 'md' }) {
  const center = align === 'center'
  return (
    <header className={`max-w-3xl ${center ? 'mx-auto text-center' : ''}`}>
      {eyebrow ? <Eyebrow onDark={onDark} className={`mb-5 ${center ? 'justify-center' : ''}`}>{eyebrow}</Eyebrow> : null}
      {kicker ? <div className={`mb-5 ${center ? 'flex justify-center' : ''}`}>{kicker}</div> : null}
      <h2 id={id} className={`display ${size === 'md' ? 'text-[clamp(1.9rem,3.4vw,2.9rem)]' : 'text-[clamp(2.1rem,4.6vw,3.75rem)]'} ${onDark ? 'text-porcelain' : 'text-night'}`}>{title}</h2>
      {intro ? <p className={`mt-5 max-w-2xl text-lg leading-relaxed md:text-[1.2rem] ${center ? 'mx-auto' : ''} ${onDark ? 'text-mist' : 'text-ink-soft'}`}>{intro}</p> : null}
    </header>
  )
}

/** Browser chrome around a real capture. */
export function BrowserFrame({ url, children, className = '' }: { url: string; children: ReactNode; className?: string }) {
  return (
    <div className={`overflow-hidden rounded-2xl bg-carbon ring-1 ring-white/10 ${className}`}>
      <div className="flex items-center gap-3 px-3.5 py-2.5">
        <div className="flex gap-1.5" aria-hidden="true"><span className="size-2.5 rounded-full bg-white/20" /><span className="size-2.5 rounded-full bg-white/20" /><span className="size-2.5 rounded-full bg-white/20" /></div>
        <p className="min-w-0 flex-1 truncate rounded-md bg-white/8 px-3 py-1 text-center text-[0.72rem] text-mist">{url}</p>
        <span className="w-10" aria-hidden="true" />
      </div>
      {children}
    </div>
  )
}
