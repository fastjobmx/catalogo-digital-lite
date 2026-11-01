import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { SlidersHorizontal } from 'lucide-react'
import { useCatalog } from '../contexts/CatalogContext'
import ProductCard from '../components/ProductCard'
import ProductFilters, { EMPTY_FILTERS, type ProductFilterValues } from '../components/ProductFilters'
import { filterCatalogProducts } from '../lib/catalog'

export default function CategoryPage() {
  const { slug } = useParams()
  const { products, categories, loading } = useCatalog()
  const [filters, setFilters] = useState<ProductFilterValues>(EMPTY_FILTERS)
  const [showFilters, setShowFilters] = useState(false)

  const category = categories.find((c) => c.slug === slug)
  const list = useMemo(() => {
    return filterCatalogProducts(products, slug, filters)
  }, [products, slug, filters])

  const title = slug === 'all' ? 'Todo el catálogo' : category?.name || `Categoría: ${slug}`

  return (
    <div className="shell py-8 lg:py-12">
      <nav className="flex items-center gap-1.5 text-sm text-muted mb-6" aria-label="Ruta">
        <Link to="/" className="hover:text-brand transition-colors">Inicio</Link>
        <span className="text-line">/</span>
        <span className="text-ink font-medium">{title}</span>
      </nav>

      <header className="mb-8">
        <h1 className="text-3xl sm:text-4xl font-extrabold text-ink tracking-tight">{title}</h1>
        <p className="text-muted mt-2">
          {category?.description || 'Explora nuestra selección y filtra por precio, talla o color.'}
        </p>
      </header>

      {/* Chips de categoría */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2 mb-6 -mx-4 px-4 sm:mx-0 sm:px-0">
        <Link
          to="/category/all"
          className="chip"
          data-active={slug === 'all' ? 'true' : 'false'}
        >
          Todos
        </Link>
        {categories.map((cat) => (
          <Link
            key={cat.slug}
            to={`/category/${cat.slug}`}
            className="chip"
            data-active={cat.slug === slug ? 'true' : 'false'}
          >
            {cat.name}
          </Link>
        ))}
      </div>

      <div className="flex items-center justify-between gap-4 mb-5">
        <p className="text-sm text-muted">
          {loading ? 'Cargando…' : `${list.length} ${list.length === 1 ? 'producto' : 'productos'}`}
        </p>
        <button
          type="button"
          onClick={() => setShowFilters((v) => !v)}
          className="inline-flex items-center gap-2 text-sm font-semibold text-ink hover:text-brand transition-colors lg:hidden"
        >
          <SlidersHorizontal size={16} />
          Filtros
        </button>
      </div>

      <div className={`mb-8 ${showFilters ? 'block' : 'hidden'} lg:block`}>
        <ProductFilters products={products} value={filters} onChange={setFilters} />
      </div>

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-grid">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="space-y-3">
              <div className="skeleton aspect-[4/5]" />
              <div className="skeleton h-4 w-2/3 rounded-md" />
            </div>
          ))}
        </div>
      ) : list.length === 0 ? (
        <div className="card p-12 text-center">
          <p className="text-lg font-semibold text-ink mb-1">Sin resultados</p>
          <p className="text-muted text-sm mb-6">No hay productos con esos filtros. Prueba a ajustarlos.</p>
          <button onClick={() => setFilters(EMPTY_FILTERS)} className="btn-ghost">
            Limpiar filtros
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-grid">
          {list.map((p, index) => <ProductCard key={p.id} product={p} priority={index < 4} />)}
        </div>
      )}
    </div>
  )
}
