import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { Icon, type IconName } from './Icon'

type ButtonProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  variant?: 'lime' | 'forest' | 'ivory' | 'outline-dark' | 'outline-light'
  size?: 'md' | 'lg'
  icon?: IconName
  external?: boolean
  children: ReactNode
}

const VARIANTS = {
  lime: 'bg-lime text-forest shadow-[0_1px_0_rgba(255,255,255,.6)_inset,0_10px_30px_-12px_rgba(198,242,91,.8)] hover:bg-[#d4f77c]',
  forest: 'bg-forest text-ivory shadow-[0_12px_30px_-14px_rgba(16,47,37,.9)] hover:bg-forest-raised',
  ivory: 'bg-ivory text-forest hover:bg-paper',
  'outline-dark': 'text-forest ring-2 ring-forest/80 ring-inset hover:bg-forest hover:text-ivory',
  'outline-light': 'text-ivory ring-2 ring-ivory/70 ring-inset hover:bg-ivory hover:text-forest',
}

/** Link styled as a button. External links open in a new tab and say so to screen readers. */
export function Button({ variant = 'forest', size = 'md', icon, external, className = '', children, ...rest }: ButtonProps) {
  const sizing = size === 'lg' ? 'min-h-14 px-7 text-[0.95rem]' : 'min-h-12 px-5 text-[0.9rem]'
  return (
    <a
      {...rest}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className={`group/btn relative inline-flex select-none items-center whitespace-nowrap justify-center gap-2.5 rounded-full font-display font-bold uppercase tracking-[0.02em] transition-[transform,background-color,color,box-shadow] duration-300 ease-[var(--ease-out-expo)] active:scale-[0.97] ${sizing} ${VARIANTS[variant]} ${className}`}
    >
      <span>{children}</span>
      {icon ? (
        <span className="grid size-6 place-items-center overflow-hidden" aria-hidden="true">
          <Icon name={icon} size={18} className="transition-transform duration-300 ease-[var(--ease-out-expo)] group-hover/btn:translate-x-0.5 group-hover/btn:-translate-y-0.5" />
        </span>
      ) : null}
      {external ? <span className="sr-only"> (se abre en una pestaña nueva)</span> : null}
    </a>
  )
}

type BadgeKind = 'demo' | 'soon' | 'live' | 'real'
const BADGES: Record<BadgeKind, { label: string; className: string }> = {
  demo: { label: 'Demostración ilustrativa', className: 'bg-violet/15 text-[#5b16b8] ring-violet/40' },
  soon: { label: 'Próximamente', className: 'bg-forest/8 text-ink-soft ring-forest/25' },
  live: { label: 'Disponible', className: 'bg-lime/40 text-forest ring-forest/15' },
  real: { label: 'Captura real', className: 'bg-paper text-forest ring-forest/15' },
}

export function Badge({ kind, label, onDark }: { kind: BadgeKind; label?: string; onDark?: boolean }) {
  const style = onDark
    ? kind === 'demo'
      ? 'bg-violet/20 text-[#d6b4ff] ring-violet/50'
      : kind === 'soon'
        ? 'bg-ivory/8 text-mist ring-ivory/25'
        : 'bg-lime/15 text-lime ring-lime/40'
    : BADGES[kind].className
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.72rem] font-semibold leading-none ring-1 ring-inset ${style}`}>
      <span className={`size-1.5 rounded-full ${kind === 'demo' ? 'bg-violet' : kind === 'soon' ? 'bg-current opacity-60' : 'bg-current'}`} aria-hidden="true" />
      {label ?? BADGES[kind].label}
    </span>
  )
}

/** Animated underline echoing the brand swoosh. */
export function Swoosh({ children, color = 'var(--color-violet)', className = '' }: { children: ReactNode; color?: string; className?: string }) {
  return (
    <span className={`swoosh ${className}`}>
      {children}
      <svg viewBox="0 0 300 24" preserveAspectRatio="none" aria-hidden="true">
        <path data-swoosh d="M4 18C70 7 170 3 296 9" fill="none" stroke={color} strokeWidth="9" strokeLinecap="round" pathLength={1} />
      </svg>
    </span>
  )
}

export function SectionHeading({ id, kicker, title, intro, onDark, align = 'left', size = 'lg' }: { id: string; kicker?: ReactNode; title: ReactNode; intro?: ReactNode; onDark?: boolean; align?: 'left' | 'center'; size?: 'lg' | 'md' }) {
  return (
    <header className={`max-w-4xl ${align === 'center' ? 'mx-auto text-center' : ''}`}>
      {kicker ? <div className={`mb-5 ${align === 'center' ? 'flex justify-center' : ''}`}>{kicker}</div> : null}
      <h2 id={id} className={`display ${size === 'md' ? 'text-[clamp(2.3rem,4.6vw,4.4rem)]' : 'text-[clamp(2.3rem,7vw,6.4rem)]'} ${onDark ? 'text-ivory' : 'text-forest'}`}>{title}</h2>
      {intro ? <p className={`mt-6 max-w-2xl text-lg md:text-xl ${align === 'center' ? 'mx-auto' : ''} ${onDark ? 'text-mist' : 'text-ink-soft'}`}>{intro}</p> : null}
    </header>
  )
}
