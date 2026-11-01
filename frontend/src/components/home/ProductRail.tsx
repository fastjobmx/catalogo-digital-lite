import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import type { ProductApi } from '../../services/api'
import ProductCard from '../ProductCard'

interface ProductRailProps {
  id?: string
  eyebrow?: string
  title: string
  href?: string
  hrefLabel?: string
  products: ProductApi[]
  loading?: boolean
  emptyText?: string
  /** Columnas máximas en escritorio: 3 o 4. */
  columns?: 3 | 4
}

export default function ProductRail({
  id,
  eyebrow,
  title,
  href,
  hrefLabel = 'Ver todo',
  products,
  loading = false,
  emptyText,
  columns = 4,
}: ProductRailProps) {
  const gridClass = columns === 3
    ? 'grid grid-cols-2 md:grid-cols-3 gap-x-3 gap-y-8 sm:gap-x-5 lg:gap-x-6 lg:gap-y-10'
    : 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-3 gap-y-8 sm:gap-x-5 lg:gap-x-6 lg:gap-y-10'

  return (
    <section className="shell section" id={id}>
      <div className="flex items-end justify-between gap-6 mb-7 lg:mb-9">
        <div>
          {eyebrow && <p className="eyebrow text-accent mb-3">{eyebrow}</p>}
          <h2 className="title-section text-ink">{title}</h2>
        </div>
        {href && (
          <Link to={href} className="link-underline shrink-0">
            {hrefLabel} <ArrowRight size={15} aria-hidden="true" />
          </Link>
        )}
      </div>

      {loading ? (
        <div className={gridClass}>
          {Array.from({ length: columns }).map((_, i) => (
            <div key={i} className="space-y-3">
              <div className="skeleton aspect-[4/5]" />
              <div className="skeleton h-3 w-1/3 rounded-sm" />
              <div className="skeleton h-4 w-2/3 rounded-sm" />
            </div>
          ))}
        </div>
      ) : products.length === 0 ? (
        // Sin datos: no inventamos contenido. Estado vacío discreto y accionable.
        <div className="border-t border-line pt-8">
          <p className="text-sm text-muted">
            {emptyText || 'Todavía no hay productos publicados en esta selección.'}
          </p>
          <Link to="/category/all" className="link-underline mt-4">
            Ir al catálogo <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </div>
      ) : (
        <div className={gridClass}>
          {products.map((p, i) => (
            <div key={p.id} className="animate-fade-up" style={{ animationDelay: `${i * 45}ms` }}>
              <ProductCard product={p} priority={i < 2} />
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
