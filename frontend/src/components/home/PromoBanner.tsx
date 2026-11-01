import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { useStore } from '../../contexts/StoreContext'
import { localWebpSource } from '../../lib/imageSources'

export default function PromoBanner() {
  const { store } = useStore()
  const promo = store.theme.promo
  if (!promo.enabled) return null

  const hasImage = Boolean(promo.imageUrl)
  const webpImage = localWebpSource(promo.imageUrl)

  return (
    <section className="shell section-tight">
      <div
        className={`relative overflow-hidden bg-ink text-canvas ${hasImage ? '' : 'surface-muted'}`}
        style={{ borderRadius: 'var(--radius-card)' }}
      >
        {hasImage ? (
          <>
            <picture className="absolute inset-0 block h-full w-full">
              {webpImage && <source type="image/webp" srcSet={webpImage} />}
              <img src={promo.imageUrl!} alt="" aria-hidden="true" loading="lazy" decoding="async" className="absolute inset-0 w-full h-full object-cover" />
            </picture>
            <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/60 to-black/15" aria-hidden="true" />
          </>
        ) : (
          <div className="absolute inset-0 bg-canvas" aria-hidden="true" />
        )}

        <div className={`relative grid lg:grid-cols-12 gap-8 items-end min-h-[380px] sm:min-h-[440px] p-7 sm:p-10 lg:p-14 ${hasImage ? '' : 'text-ink'}`}>
          <div className="lg:col-span-8">
            {promo.eyebrow && (
              <p className={`eyebrow mb-4 inline-flex items-center gap-3 ${hasImage ? 'text-canvas/75' : 'text-accent'}`}>
                <span className={`inline-block w-8 h-px ${hasImage ? 'bg-canvas/40' : 'bg-accent'}`} aria-hidden="true" />
                {promo.eyebrow}
              </p>
            )}
            <h2 className={`font-display text-[clamp(2rem,1.3rem+2.4vw,3.6rem)] leading-[1.02] tracking-[-0.03em] ${hasImage ? 'text-canvas' : 'text-ink'}`}>
              {promo.title}
            </h2>
            {promo.text && (
              <p className={`mt-4 max-w-lg text-[15px] leading-relaxed ${hasImage ? 'text-canvas/75' : 'text-muted'}`}>
                {promo.text}
              </p>
            )}
            {promo.ctaLabel && (
              <Link
                to={promo.ctaHref || '/category/all'}
                className="group mt-8 inline-flex items-center gap-3 min-h-[48px] px-6 py-3
                           text-[12px] font-semibold uppercase tracking-[0.12em] transition-colors
                           bg-[var(--color-background)] text-[var(--color-text)] hover:bg-[var(--color-surface)]"
                style={{ borderRadius: 'var(--radius-btn)' }}
              >
                {promo.ctaLabel}
                <ArrowRight size={15} className="transition-transform duration-200 group-hover:translate-x-1" aria-hidden="true" />
              </Link>
            )}
          </div>

          <div className={`lg:col-span-4 lg:text-right ${hasImage ? 'text-canvas/60' : 'text-muted'}`}>
            <p className="text-[10px] uppercase tracking-[0.2em]">Lookbook</p>
            <p className="font-display text-lg mt-2">Selección editorial</p>
          </div>
        </div>
      </div>
    </section>
  )
}
