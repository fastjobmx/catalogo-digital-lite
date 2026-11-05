import logo360 from '../../assets/brand/logo-principal-360.webp'
import logo720 from '../../assets/brand/logo-principal-720.webp'
import logo1200 from '../../assets/brand/logo-principal-1200.webp'
import iso96 from '../../assets/brand/isotipo-96.webp'
import iso192 from '../../assets/brand/isotipo-192.webp'

/**
 * Approved logo variants, cut from the official "TiendIA Exprés" artwork (brand/tiendaiaexpress/).
 * Never recolour or stretch it: width is set and height follows the real aspect ratio
 * (1290 × 490 for the logo with its slogan, 515 × 515 for the app icon).
 *
 * - "principal": logo + "TU TIENDA ONLINE, MÁS FÁCIL." on its own dark-green background (rounded plate).
 * - "isotipo": the official app icon (rounded square) — works on dark and light surfaces.
 */
const RATIO = { principal: 490 / 1290, isotipo: 1 }

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
    alt: decorative ? '' : 'Tienda IA Express',
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
