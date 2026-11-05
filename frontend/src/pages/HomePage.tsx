import { useMemo } from 'react'
import { useStore } from '../contexts/StoreContext'
import { useCatalog } from '../contexts/CatalogContext'
import HeroSection from '../components/home/HeroSection'
import CategoryGrid from '../components/home/CategoryGrid'
import ProductRail from '../components/home/ProductRail'
import PromoBanner from '../components/home/PromoBanner'
import BenefitsSection from '../components/home/BenefitsSection'
import ContactSection from '../components/home/ContactSection'
import TestimonialsSection from '../components/home/TestimonialsSection'
import CtaSection from '../components/home/CtaSection'
import StoriesFeed from '../components/home/StoriesFeed'
import type { SectionKey } from '../types/theme'

export default function HomePage() {
  const { store } = useStore()
  const { products, loading } = useCatalog()

  const { featured, offers, newest } = useMemo(() => {
    const theme = store.theme
    const limit = Math.max(theme.sections.featuredLimit || 8, 4)

    const featuredList = theme.featuredSelectionEnabled
      ? (theme.featuredSkus
          .map((sku) => products.find((p) => p.sku === sku))
          .filter(Boolean) as typeof products)
      : products.filter((p) => p.isFeatured)
    const finalFeatured = (theme.featuredSelectionEnabled
      ? featuredList
      : featuredList.length > 0 ? featuredList : products).slice(0, limit)

    const offersList = products.filter((p) => p.compareAtPrice && p.compareAtPrice > p.price)

    return {
      featured: finalFeatured,
      offers: offersList.slice(0, limit),
      newest: [...products].sort((a, b) => Number(b.id) - Number(a.id)).slice(0, limit),
    }
  }, [products, store.theme])

  const sections: Record<SectionKey, React.ReactNode> = {
    hero: <HeroSection key="hero" />,
    categories: <CategoryGrid key="categories" />,
    featured: (
      <ProductRail
        key="featured"
        id="catalogo"
        eyebrow="Colección destacada"
        title="Selección editorial"
        href="/category/all"
        products={featured}
        loading={loading}
        emptyText="Todavía no hay productos en la colección."
      />
    ),
    promo: <PromoBanner key="promo" />,
    offers: offers.length > 0 ? (
      <ProductRail
        key="offers"
        eyebrow="Precio especial"
        title="Ofertas vigentes"
        href="/category/all?sort=price-asc"
        hrefLabel="Ver catálogo"
        products={offers}
        loading={loading}
        columns={3}
      />
    ) : null,
    newest: (
      <ProductRail
        key="newest"
        eyebrow="Recién llegados"
        title="Nuevos lanzamientos"
        href="/category/all?sort=newest"
        products={newest}
        loading={loading}
        emptyText="El catálogo está vacío por ahora."
        columns={4}
      />
    ),
    benefits: <BenefitsSection key="benefits" />,
    contact: <ContactSection key="contact" />,
    testimonials: <TestimonialsSection key="testimonials" />,
    cta: <CtaSection key="cta" />,
  }

  const { order, enabled } = store.theme.sections

  const template = store.theme.template || 'personalizado'
  // Stories replaces the home sections with a vertical, one-product-per-screen feed.
  if (template === 'stories') return <div className="store-home template--stories" data-template="stories"><StoriesFeed /></div>

  return (
    <div className={`bg-canvas store-home template--${template}`} data-template={template}>
      {order
        .filter((key) => enabled[key])
        .map((key) => sections[key])
        .filter(Boolean)}
    </div>
  )
}
