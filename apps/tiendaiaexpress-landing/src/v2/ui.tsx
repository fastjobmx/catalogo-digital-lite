// Small building blocks of the V2 visual system (tokens in home-v2.css). Four type levels:
// h1 (hero), h2 (sections), h3 (items) and body; one container width; three button styles.
import { useEffect, type AnchorHTMLAttributes, type CSSProperties, type ReactNode } from 'react'
import { Icon, type IconName } from '../components/ui/Icon'

/** Content column: ~1200 px with the same gutters everywhere. */
export const wrap = 'mx-auto w-full max-w-[80rem] px-5 sm:px-8'

export const type = {
  h1: 'text-[clamp(2.5rem,4.3vw,3.75rem)] font-extrabold leading-[1.02] tracking-[-0.045em] text-balance',
  h2: 'text-[clamp(1.85rem,3.3vw,2.75rem)] font-bold leading-[1.08] tracking-[-0.03em]',
  h3: 'text-[1.0625rem] font-semibold leading-snug tracking-[-0.01em]',
  body: 'text-[1rem] leading-[1.65] text-(--v2-muted)',
  small: 'text-[0.8125rem] leading-relaxed text-(--v2-subtle)',
}

/** Section shell: a scene. Dark by default; `light` re-themes everything inside (home-v2.css .v2-light). */
export function Section({ id, labelledBy, alt, light, className = '', children }: { id?: string; labelledBy: string; alt?: boolean; light?: boolean; className?: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={labelledBy} className={`py-24 md:py-36 ${light ? 'v2-light' : alt ? 'bg-(--v2-bg-alt)' : ''} ${className}`}>
      {children}
    </section>
  )
}

/** Scene heading: small kicker, one strong statement, short lead. `center` for editorial scenes. */
export function Heading({ id, kicker, title, intro, center, className = '' }: { id: string; kicker: string; title: ReactNode; intro?: ReactNode; center?: boolean; className?: string }) {
  return (
    <header className={`${center ? 'mx-auto max-w-4xl text-center' : 'max-w-3xl'} ${className}`}>
      <p className="text-[1.0625rem] font-semibold text-(--v2-subtle) md:text-[1.3125rem]">{kicker}</p>
      <h2 id={id} className="v2-display mt-2">{title}</h2>
      {intro ? <p className={`v2-lead mt-5 text-(--v2-muted) ${center ? 'mx-auto max-w-2xl' : 'max-w-2xl'}`}>{intro}</p> : null}
    </header>
  )
}

type CtaProps = AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: 'primary' | 'secondary' | 'quiet'; size?: 'md' | 'lg'; icon?: IconName; external?: boolean; children: ReactNode }

const CTA = {
  primary: 'bg-(--v2-lime) text-[#0c0e14] hover:bg-[#e6ff66]',
  secondary: 'text-(--v2-text) ring-1 ring-inset ring-(--v2-text)/60 hover:bg-(--v2-text) hover:text-(--v2-bg)',
  quiet: 'text-(--v2-text) hover:underline underline-offset-4 after:ml-1 after:content-["›"] after:text-[1.15em] after:leading-none',
}

/** Link styled as a button. External links open in a new tab and say so to screen readers. */
export function Cta({ variant = 'primary', size = 'md', icon, external, className = '', children, ...rest }: CtaProps) {
  const shape = variant === 'quiet' ? 'min-h-11 px-1 text-[1.0625rem]' : size === 'lg' ? 'min-h-12 px-6 rounded-full text-[1.0625rem]' : 'min-h-10 px-4 rounded-full text-[0.9375rem]'
  return (
    <a
      {...rest}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className={`group/cta inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-medium transition-[background-color,color,box-shadow,transform,text-decoration-color] duration-150 ease-out active:scale-[0.98] ${shape} ${CTA[variant]} ${className}`}
    >
      <span>{children}</span>
      {icon ? <Icon name={icon} size={17} className="shrink-0 transition-transform duration-200 group-hover/cta:translate-x-0.5" /> : null}
      {external ? <span className="sr-only"> (se abre en una pestaña nueva)</span> : null}
    </a>
  )
}

/** Neutral icon tile (never lime). */
export function IconTile({ name }: { name: IconName }) {
  return <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-(--v2-surface) text-(--v2-text) ring-1 ring-inset ring-(--v2-line)"><Icon name={name} size={18} /></span>
}

/** Reveals [data-v2-reveal] groups once when they enter the viewport (progressive enhancement):
 * groups already on screen or above it are marked first, and only then is html.v2-js set (the CSS
 * hides nothing without it). No IntersectionObserver: everything is shown. */
export function useSectionReveal() {
  useEffect(() => {
    const groups = [...document.querySelectorAll<HTMLElement>('[data-v2-reveal]')]
    if (!('IntersectionObserver' in window)) { groups.forEach((g) => g.classList.add('is-in')); return }
    const limit = window.innerHeight * 0.92
    for (const g of groups) if (g.getBoundingClientRect().top < limit) g.classList.add('is-in')
    document.documentElement.classList.add('v2-js')
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        entry.target.classList.add('is-in')
        io.unobserve(entry.target)
      }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 })
    groups.filter((g) => !g.classList.contains('is-in')).forEach((g) => io.observe(g))
    return () => io.disconnect()
  }, [])
}

/** CSS custom property helper for stagger indexes and delays. */
export const vars = (v: Record<string, number | string>) => Object.fromEntries(Object.entries(v).map(([k, val]) => [`--${k}`, val])) as CSSProperties
