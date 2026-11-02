import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDown, ArrowRight } from 'lucide-react'
import { useStore } from '../../contexts/StoreContext'
import { useCatalog } from '../../contexts/CatalogContext'
import { localWebpSource, shouldFallbackToOriginal } from '../../lib/imageSources'

export default function HeroSection() {
  const { store } = useStore()
  const { products, categories } = useCatalog()
  const hero = store.theme.hero
  const heroWebp = localWebpSource(hero.imageUrl)
  const mobileWebp = localWebpSource(hero.imageUrlMobile)
  const [webpEnabled, setWebpEnabled] = useState(true)

  useEffect(() => setWebpEnabled(true), [hero.imageUrl, hero.imageUrlMobile])

  if (!hero.enabled) return null

  const hasImage = Boolean(hero.imageUrl)
  const title = (hero.title || '').replace(/\\n/g, '\n')
  const contentAlign = hero.align === 'center'
    ? 'items-center text-center'
    : hero.align === 'right'
      ? 'items-end text-right'
      : 'items-start text-left'
  const imageHeight = hero.height === 'compact'
    ? 'lg:min-h-[520px]'
    : hero.height === 'tall'
      ? 'lg:min-h-[760px]'
      : 'lg:min-h-[640px]'
  const ctaAlign = hero.align === 'center' ? 'sm:justify-center' : hero.align === 'right' ? 'sm:justify-end' : ''

  return (
    <section className="bg-canvas text-ink">
      <div className="grid lg:grid-cols-2">
        <div className="shell flex w-full flex-col justify-center py-10 sm:py-14 lg:py-20">
          <div className={`mx-auto flex w-full ${hero.align === 'center' ? 'max-w-2xl' : 'max-w-[42rem]'} flex-col ${contentAlign}`}>
            {hero.eyebrow && (
              <p className="eyebrow mb-5 inline-flex items-center gap-3 text-accent lg:mb-6">
                <span className="inline-block h-px w-8 bg-accent" aria-hidden="true" />
                {hero.eyebrow}
              </p>
            )}

            <h1 className="title-hero whitespace-pre-line text-balance animate-fade-up">
              {title}
            </h1>

            {hero.subtitle && (
              <p className="mt-5 text-base font-medium tracking-wide text-muted sm:text-lg">
                {hero.subtitle}
              </p>
            )}

            {hero.description && (
              <p className={`mt-5 max-w-xl text-[15px] leading-relaxed text-muted sm:text-base ${hero.align === 'center' ? 'mx-auto' : ''}`}>
                {hero.description}
              </p>
            )}

            <div className={`mt-8 flex w-full flex-col gap-3 sm:mt-9 sm:w-auto sm:flex-row ${ctaAlign}`}>
              {hero.ctaPrimaryLabel && (
                <Link
                  to={hero.ctaPrimaryHref || '/category/all'}
                  className="group inline-flex min-h-[50px] items-center justify-center gap-3 bg-ink px-7 py-3 text-[13px] font-semibold uppercase tracking-[0.1em] text-canvas transition-colors hover:bg-ink/85"
                  style={{ borderRadius: 'var(--radius-btn)' }}
                >
                  {hero.ctaPrimaryLabel}
                  <ArrowRight size={16} className="transition-transform duration-200 group-hover:translate-x-1" aria-hidden="true" />
                </Link>
              )}
              {hero.ctaSecondaryEnabled && hero.ctaSecondaryLabel && (
                <Link
                  to={hero.ctaSecondaryHref || '/category/all'}
                  className="inline-flex min-h-[50px] items-center justify-center gap-2 border border-ink/25 px-7 py-3 text-[13px] font-semibold uppercase tracking-[0.1em] text-ink transition-colors hover:border-ink"
                  style={{ borderRadius: 'var(--radius-btn)' }}
                >
                  {hero.ctaSecondaryLabel}
                </Link>
              )}
            </div>

            <div className="mt-10 flex w-full items-end justify-between gap-6 border-t border-line pt-5 text-muted sm:mt-14 lg:mt-16">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[10px] uppercase tracking-[0.14em] sm:text-[11px] sm:tracking-[0.16em]">
                <span>{products.length} {products.length === 1 ? 'producto' : 'productos'}</span>
                <span aria-hidden="true" className="hidden sm:inline">/</span>
                <span className="hidden sm:inline">{categories.length} categorías</span>
                {store.businessType && (
                  <>
                    <span aria-hidden="true" className="hidden md:inline">/</span>
                    <span className="hidden md:inline">{store.businessType}</span>
                  </>
                )}
              </div>
              <a
                href="#catalogo"
                className="hidden shrink-0 items-center gap-2 text-[11px] uppercase tracking-[0.16em] transition-opacity hover:opacity-70 sm:flex"
                aria-label="Ir al catálogo"
              >
                Descubrir <ArrowDown size={14} aria-hidden="true" />
              </a>
            </div>
          </div>
        </div>

        {hasImage ? (
          <picture className={`relative order-first block min-h-[270px] overflow-hidden bg-[#ECEAE5] sm:min-h-[360px] lg:order-last ${imageHeight}`}>
            {webpEnabled && hero.imageUrlMobile && mobileWebp && <source media="(max-width: 767px)" type="image/webp" srcSet={mobileWebp} />}
            {webpEnabled && heroWebp && <source type="image/webp" srcSet={heroWebp} />}
            {hero.imageUrlMobile && (
              <source media="(max-width: 767px)" srcSet={hero.imageUrlMobile} />
            )}
            <img
              src={hero.imageUrl!}
              alt={`${store.name}: imagen principal de la colección`}
              fetchPriority="high"
              className="absolute inset-0 h-full w-full object-contain p-2 sm:p-5 lg:p-8"
              onError={(event) => {
                if (shouldFallbackToOriginal(event.currentTarget.currentSrc, heroWebp || mobileWebp, webpEnabled)) {
                  setWebpEnabled(false)
                  return
                }
                event.currentTarget.style.display = 'none'
              }}
            />
          </picture>
        ) : (
          <div className="order-first min-h-[240px] bg-secondary/30 lg:order-last lg:min-h-[640px]" aria-hidden="true" />
        )}
      </div>
    </section>
  )
}
