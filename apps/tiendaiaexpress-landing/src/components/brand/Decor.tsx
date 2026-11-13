import type { CSSProperties } from 'react'
import mascot320 from '../../assets/brand/mascota-320.webp'
import mascot640 from '../../assets/brand/mascota-640.webp'

/**
 * Brand assistant (owner artwork brand-originals/mascota-asistente.webp, cut out to
 * mascota-asistente-transparente.png; never redrawn or recoloured). Decorative by default.
 */
export function Mascot({ width = 280, className = '', style, eager, alt = '' }: { width?: number | string; className?: string; style?: CSSProperties; eager?: boolean; alt?: string }) {
  return (
    <img
      src={mascot640}
      srcSet={`${mascot320} 320w, ${mascot640} 640w`}
      sizes={typeof width === 'number' ? `${width}px` : '(min-width: 1024px) 300px, 45vw'}
      width={640}
      height={718}
      alt={alt}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      draggable={false}
      className={`pointer-events-none select-none drop-shadow-[0_30px_40px_rgba(0,0,0,.35)] ${className}`}
      style={{ width, height: 'auto', ...style }}
    />
  )
}

/** The three "energy" strokes that sit next to the headlines of the brand pieces. */
export function Sparks({ className = '', color = 'var(--color-violet)' }: { className?: string; color?: string }) {
  return (
    <svg viewBox="0 0 48 48" width="40" height="40" fill="none" stroke={color} strokeWidth="5" strokeLinecap="round" aria-hidden="true" className={`shrink-0 ${className}`}>
      <path d="M14 18 22 6M24 27 40 19M26 40h16" />
    </svg>
  )
}

/** Hand-drawn violet underline under a headline. */
export function Swoosh({ className = '', color = 'var(--color-violet)' }: { className?: string; color?: string }) {
  return (
    <svg viewBox="0 0 320 22" preserveAspectRatio="none" fill="none" aria-hidden="true" className={`block h-3 ${className}`}>
      <path d="M4 16C80 5 200 2 316 9" stroke={color} strokeWidth="6" strokeLinecap="round" />
    </svg>
  )
}
