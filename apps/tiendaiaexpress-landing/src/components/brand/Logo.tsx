import iso96 from '../../assets/brand/isotipo-carrito-96.webp'
import iso192 from '../../assets/brand/isotipo-carrito-192.webp'

/**
 * Brand lockup for dark surfaces: the official cart isotype (owner artwork with transparency,
 * brand-originals/isotipo-carrito-transparente.png — never recoloured or stretched) next to the
 * wordmark set in the display typeface with the logo's own colours: white "Tiend", violet "IA",
 * lime "Exprés" plate. The wordmark is ≥ 19.2 px bold, so the violet meets large-text contrast.
 */
export function Logo({ size = 'md', priority, className = '' }: { size?: 'md' | 'lg'; priority?: boolean; className?: string }) {
  const large = size === 'lg'
  const width = large ? 64 : 46
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <img
        src={iso192}
        srcSet={`${iso96} 96w, ${iso192} 192w`}
        sizes={`${width}px`}
        width={width}
        height={Math.round(width * (132 / 192))}
        alt=""
        decoding="async"
        loading={priority ? 'eager' : 'lazy'}
        draggable={false}
      />
      <span className={`flex items-baseline gap-1.5 font-display font-extrabold italic leading-none tracking-[-0.04em] ${large ? 'text-[1.75rem]' : 'text-[1.2rem]'}`} aria-hidden="true">
        <span className="text-porcelain">Tiend<span className="text-violet">IA</span></span>
        <span className={`rounded-md bg-lime text-night ${large ? 'px-2 py-1 text-[1.2rem]' : 'px-1.5 py-[0.2rem] text-[0.82rem]'}`}>Exprés</span>
      </span>
    </span>
  )
}
