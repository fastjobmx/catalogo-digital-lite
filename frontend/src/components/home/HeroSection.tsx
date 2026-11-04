import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDown, ArrowRight } from 'lucide-react'
import { useStore } from '../../contexts/StoreContext'
import { useCatalog } from '../../contexts/CatalogContext'
import { localWebpSource, shouldFallbackToOriginal } from '../../lib/imageSources'
import { templateLayout } from '../../lib/templateLayouts'

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
  const imageHeight = hero.height === 'compact'
    ? 'lg:min-h-[520px]'
    : hero.height === 'tall'
      ? 'lg:min-h-[760px]'
      : 'lg:min-h-[640px]'

  const requested = templateLayout(store.theme.template).hero
  // Overlay and editorial need a photo; without one the copy stays centered and legible.
  const layout = !hasImage && (requested === 'overlay' || requested === 'editorial') ? 'centered' : requested
  const align = layout === 'centered' || layout === 'overlay' ? 'center' : hero.align
  const alignClass = align === 'center'
    ? 'items-center text-center'
    : align === 'right'
      ? 'items-end text-right'
      : 'items-start text-left'
  const ctaAlign = align === 'center' ? 'sm:justify-center' : align === 'right' ? 'sm:justify-end' : ''
  const inverse = layout === 'overlay'

  const copy = (
    <div className={`mx-auto flex w-full ${align === 'center' ? 'max-w-2xl' : 'max-w-[42rem]'} flex-col ${alignClass}`}>
      {hero.eyebrow && (
        <p className={`eyebrow mb-5 inline-flex items-center gap-3 lg:mb-6 ${inverse ? 'text-white/85' : 'text-accent'}`}>
          <span className={`inline-block h-px w-8 ${inverse ? 'bg-white/70' : 'bg-accent'}`} aria-hidden="true" />
          {hero.eyebrow}
        </p>
      )}

      <h1 className={`title-hero whitespace-pre-line text-balance animate-fade-up ${inverse ? 'text-white' : ''} ${layout === 'editorial' ? 'hero-title--editorial' : ''}`}>
        {title}
      </h1>

      {hero.subtitle && (
        <p className={`mt-5 text-base font-medium tracking-wide sm:text-lg ${inverse ? 'text-white/85' : 'text-muted'}`}>
          {hero.subtitle}
        </p>
      )}

      {hero.description && (
        <p className={`mt-5 max-w-xl text-[15px] leading-relaxed sm:text-base ${inverse ? 'text-white/80' : 'text-muted'} ${align === 'center' ? 'mx-auto' : ''}`}>
          {hero.description}
        </p>
      )}

      <div className={`mt-8 flex w-full flex-col gap-3 sm:mt-9 sm:w-auto sm:flex-row sm:flex-wrap ${ctaAlign}`}>
        {hero.ctaPrimaryLabel && (
          <Link
            to={hero.ctaPrimaryHref || '/category/all'}
            className={`group inline-flex min-h-[50px] items-center justify-center gap-3 px-7 py-3 text-[13px] font-semibold uppercase tracking-[0.1em] transition-colors ${inverse ? 'bg-white text-[#111111] hover:bg-white/85' : 'bg-ink text-canvas hover:bg-ink/85'}`}
            style={{ borderRadius: 'var(--radius-btn)' }}
          >
            {hero.ctaPrimaryLabel}
            <ArrowRight size={16} className="transition-transform duration-200 group-hover:translate-x-1" aria-hidden="true" />
          </Link>
        )}
        {hero.ctaSecondaryEnabled && hero.ctaSecondaryLabel && (
          <Link
            to={hero.ctaSecondaryHref || '/category/all'}
            className={`inline-flex min-h-[50px] items-center justify-center gap-2 border px-7 py-3 text-[13px] font-semibold uppercase tracking-[0.1em] transition-colors ${inverse ? 'border-white/60 text-white hover:border-white' : 'border-ink/25 text-ink hover:border-ink'}`}
            style={{ borderRadius: 'var(--radius-btn)' }}
          >
            {hero.ctaSecondaryLabel}
          </Link>
        )}
      </div>

      {!inverse && (
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
      )}
    </div>
  )

  // `contain` keeps the whole photo (products and logos are never cropped or stretched);
  // `cover` fills a full-bleed frame while keeping the photo's proportions.
  const picture = (className: string, fit: 'contain' | 'cover') => (
    <picture className={`block overflow-hidden ${className.includes('absolute') ? '' : 'relative'} ${fit === 'contain' ? 'bg-[#ECEAE5]' : ''} ${className}`}>
      {webpEnabled && hero.imageUrlMobile && mobileWebp && <source media="(max-width: 767px)" type="image/webp" srcSet={mobileWebp} />}
      {webpEnabled && heroWebp && <source type="image/webp" srcSet={heroWebp} />}
      {hero.imageUrlMobile && (
        <source media="(max-width: 767px)" srcSet={hero.imageUrlMobile} />
      )}
      <img
        src={hero.imageUrl!}
        alt={`${store.name}: imagen principal de la colección`}
        fetchPriority="high"
        className={`absolute inset-0 h-full w-full ${fit === 'contain' ? 'object-contain p-2 sm:p-5 lg:p-8' : 'object-cover'}`}
        onError={(event) => {
          if (shouldFallbackToOriginal(event.currentTarget.currentSrc, heroWebp || mobileWebp, webpEnabled)) {
            setWebpEnabled(false)
            return
          }
          event.currentTarget.style.display = 'none'
        }}
      />
    </picture>
  )

  if (layout === 'overlay') {
    return (
      <section className="hero hero--overlay relative isolate overflow-hidden bg-[#111111] text-white" data-hero-layout="overlay">
        {picture('absolute inset-0 -z-10 h-full w-full', 'cover')}
        <div className="absolute inset-0 -z-10 bg-gradient-to-t from-black/85 via-black/60 to-black/45" aria-hidden="true" />
        <div className={`shell flex min-h-[460px] flex-col justify-center py-16 sm:min-h-[540px] sm:py-20 ${imageHeight}`}>
          {copy}
        </div>
      </section>
    )
  }

  if (layout === 'centered') {
    return (
      <section className="hero hero--centered bg-canvas text-ink" data-hero-layout="centered">
        <div className="shell py-12 sm:py-16 lg:py-20">{copy}</div>
        {hasImage
          ? <div className="shell pb-10 sm:pb-14">{picture('min-h-[260px] sm:min-h-[380px] lg:min-h-[520px]', 'contain')}</div>
          : <div className="shell pb-8" aria-hidden="true"><div className="h-px w-full bg-line" /></div>}
      </section>
    )
  }

  if (layout === 'editorial') {
    return (
      <section className="hero hero--editorial bg-canvas text-ink" data-hero-layout="editorial">
        <div className="shell grid gap-8 py-10 sm:py-14 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)] lg:items-end lg:gap-12 lg:py-20">
          {picture('min-h-[300px] sm:min-h-[420px] lg:min-h-[620px]', 'contain')}
          <div className="lg:pb-6">{copy}</div>
        </div>
      </section>
    )
  }

  const reverse = layout === 'split-reverse'
  return (
    <section className={`hero hero--${layout} bg-canvas text-ink`} data-hero-layout={layout}>
      <div className="grid lg:grid-cols-2">
        <div className="shell flex w-full flex-col justify-center py-10 sm:py-14 lg:py-20">
          {copy}
        </div>

        {hasImage ? (
          picture(`order-first min-h-[270px] sm:min-h-[360px] ${reverse ? 'lg:order-first' : 'lg:order-last'} ${imageHeight}`, 'contain')
        ) : (
          <div className={`order-first min-h-[240px] bg-secondary/30 lg:min-h-[640px] ${reverse ? 'lg:order-first' : 'lg:order-last'}`} aria-hidden="true" />
        )}
      </div>
    </section>
  )
}
