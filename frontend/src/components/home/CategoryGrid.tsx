import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight } from 'lucide-react'
import { useCatalog } from '../../contexts/CatalogContext'
import { useStore } from '../../contexts/StoreContext'
import { localWebpSource, shouldFallbackToOriginal } from '../../lib/imageSources'

function CategoryImage({ cover, alt }: { cover: string; alt: string }) {
  const [webpEnabled, setWebpEnabled] = useState(true)
  const [failed, setFailed] = useState(false)
  const webpCover = localWebpSource(cover)

  useEffect(() => {
    setWebpEnabled(true)
    setFailed(false)
  }, [cover])

  if (failed) return null
  return (
    <picture className="absolute inset-0 block h-full w-full">
      {webpEnabled && webpCover && <source type="image/webp" srcSet={webpCover} />}
      <img
        src={cover}
        alt={alt}
        loading="lazy"
        decoding="async"
        className="absolute inset-0 w-full h-full object-cover transition-transform duration-[900ms] ease-out group-hover:scale-[1.04]"
        onError={(event) => {
          if (shouldFallbackToOriginal(event.currentTarget.currentSrc, webpCover, webpEnabled)) {
            setWebpEnabled(false)
            return
          }
          setFailed(true)
        }}
      />
    </picture>
  )
}

export default function CategoryGrid() {
  const { categories, products } = useCatalog()
  const { store } = useStore()
  const selectedCategories = store.theme.categorySelectionEnabled
    ? categories.filter((category) => store.theme.featuredCategorySlugs.includes(category.slug))
    : categories
  const visibleCategories = store.theme.categorySelectionEnabled
    ? [...selectedCategories].sort((a, b) => store.theme.featuredCategorySlugs.indexOf(a.slug) - store.theme.featuredCategorySlugs.indexOf(b.slug))
    : selectedCategories
  if (visibleCategories.length === 0) return null

  // Prioriza la foto elegida por el comercio y conserva la imagen del catálogo como respaldo.
  const coverFor = (slug: string) =>
    store.theme.categoryImages[slug]
      || products.find((p) => p.categorySlug === slug && p.imageUrls.length > 0)?.imageUrls[0]
      || null

  return (
    <section className="shell section" id="categorias">
      <div className="flex items-end justify-between gap-6 mb-8 lg:mb-10">
        <div>
          <p className="eyebrow text-accent mb-3">Selección</p>
          <h2 className="title-section text-ink">Compra por categoría</h2>
        </div>
        <Link to="/category/all" className="link-underline shrink-0">
          Ver todo <ArrowUpRight size={15} aria-hidden="true" />
        </Link>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4 lg:gap-5">
        {visibleCategories.map((cat, index) => {
          const cover = coverFor(cat.slug)
          // La primera categoría ocupa un bloque editorial doble en escritorio.
          const featured = index === 0
          return (
            <Link
              key={cat.slug}
              to={`/category/${cat.slug}`}
              className={`group relative overflow-hidden bg-surface border border-line animate-fade-up
                          flex items-end
                          ${featured ? 'col-span-2 row-span-2 min-h-[300px] sm:min-h-[420px] lg:min-h-[520px]' : 'min-h-[160px] sm:min-h-[220px] lg:min-h-[250px]'}`}
              style={{ animationDelay: `${index * 50}ms`, borderRadius: 'var(--radius-card)' }}
            >
              {cover ? (
                <CategoryImage cover={cover} alt={`Categoría ${cat.name}`} />
              ) : (
                <div className="absolute inset-0 surface-muted" aria-hidden="true" />
              )}

              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" aria-hidden="true" />

              <div className="relative p-4 sm:p-5 w-full flex items-end justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-white/60 mb-1.5 tabular-nums">
                    {String(index + 1).padStart(2, '0')}
                  </p>
                  <h3 className={`font-display text-white leading-tight ${featured ? 'text-2xl sm:text-3xl' : 'text-base sm:text-lg'}`}>
                    {cat.name}
                  </h3>
                  <p className="text-[11px] text-white/70 mt-1">
                    {cat.productCount} {cat.productCount === 1 ? 'producto' : 'productos'}
                  </p>
                </div>
                <span className="grid place-items-center w-9 h-9 shrink-0 border border-white/40 text-white
                                 opacity-0 -translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-300">
                  <ArrowUpRight size={17} aria-hidden="true" />
                </span>
              </div>
            </Link>
          )
        })}
      </div>
    </section>
  )
}
