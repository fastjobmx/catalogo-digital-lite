import type { CSSProperties, ReactNode } from 'react'

/**
 * Lightweight CSS phone used where WebGL is not needed or not available. Screens are real
 * captures (390 × 844 viewport) so the inner aspect ratio is fixed at 390 / 844.
 */
export function PhoneFrame({ src, alt, width = 300, className = '', style, children, eager, fill }: { src?: string; alt?: string; width?: number | string; className?: string; style?: CSSProperties; children?: ReactNode; eager?: boolean; fill?: boolean }) {
  return (
    <div
      className={`relative shrink-0 rounded-[2.6rem] bg-[linear-gradient(145deg,#2b4a40,#0a211a_45%,#1d3a31)] p-[0.55rem] shadow-[0_40px_80px_-30px_rgba(10,33,26,.75),0_0_0_1px_rgba(255,255,255,.08)_inset,0_2px_0_rgba(255,255,255,.18)_inset] ${className}`}
      style={{ width, ...style }}
    >
      <div className={`relative overflow-hidden rounded-[2.1rem] bg-ivory ${fill ? 'h-full' : ''}`} style={fill ? undefined : { aspectRatio: '390 / 844' }}>
        {src ? <img src={src} alt={alt ?? ''} width={390} height={844} loading={eager ? 'eager' : 'lazy'} decoding="async" className="absolute inset-0 size-full object-cover object-top" /> : null}
        {children}
        <div className="pointer-events-none absolute left-1/2 top-2 h-[1.35rem] w-[32%] -translate-x-1/2 rounded-full bg-[#06140f]" aria-hidden="true" />
        <div className="pointer-events-none absolute inset-0 rounded-[2.1rem] bg-[linear-gradient(115deg,rgba(255,255,255,.16),transparent_32%)]" aria-hidden="true" />
      </div>
    </div>
  )
}
