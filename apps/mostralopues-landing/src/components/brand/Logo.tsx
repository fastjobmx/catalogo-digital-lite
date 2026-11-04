import logo360 from '../../assets/brand/logo-principal-360.webp'
import logo720 from '../../assets/brand/logo-principal-720.webp'
import logo1200 from '../../assets/brand/logo-principal-1200.webp'
import iso96 from '../../assets/brand/isotipo-96.webp'
import iso192 from '../../assets/brand/isotipo-192.webp'

/**
 * Approved logo variants. The artwork is the official file with only its white background made
 * transparent (scripts/brand_transparent.py). Never recolour, crop or stretch it: width is set and
 * height follows the real aspect ratio (1615 × 612 for the logo, 1165 × 1162 for the isotipo).
 *
 * - "principal": "Logo moderno Mostralo Pues!" — only on light surfaces (ivory or white): its
 *   "MOSTRALO" lettering and outline are dark green.
 * - "isotipo": the official round icon (dark circle) — works on dark and light surfaces.
 */
const RATIO = { principal: 612 / 1615, isotipo: 1162 / 1165 }

type Props = {
  variant?: 'principal' | 'isotipo'
  width: number
  className?: string
  /** Decorative when the brand name is already written next to it. */
  decorative?: boolean
  priority?: boolean
}

export function Logo({ variant = 'principal', width, className, decorative, priority }: Props) {
  const height = Math.round(width * RATIO[variant])
  const common = {
    width,
    height,
    className,
    alt: decorative ? '' : 'MOSTRALO PUES!',
    decoding: 'async' as const,
    loading: priority ? ('eager' as const) : ('lazy' as const),
    fetchPriority: priority ? ('high' as const) : undefined,
    draggable: false,
  }
  if (variant === 'isotipo') {
    return <img src={iso192} srcSet={`${iso96} 96w, ${iso192} 192w`} sizes={`${width}px`} {...common} />
  }
  return <img src={logo720} srcSet={`${logo360} 360w, ${logo720} 720w, ${logo1200} 1200w`} sizes={`${width}px`} {...common} />
}
