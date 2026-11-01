import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Search as SearchIcon } from 'lucide-react'
import { useCatalog } from '../contexts/CatalogContext'
import ProductCard from '../components/ProductCard'
import ProductFilters, { EMPTY_FILTERS, type ProductFilterValues } from '../components/ProductFilters'

export default function SearchPage() {
  const [searchParams] = useSearchParams()
  const query = (searchParams.get('q') || '').trim().toLowerCase()
  const { products, loading } = useCatalog()
  const [filters, setFilters] = useState<ProductFilterValues>(EMPTY_FILTERS)

  const results = useMemo(() => {
    const min = Number(filters.minPrice)
    const max = Number(filters.maxPrice)
    return products.filter((p) => {
      const matchesQuery =
        !query ||
        p.name.toLowerCase().includes(query) ||
        p.sku.toLowerCase().includes(query) ||
        (p.description || '').toLowerCase().includes(query) ||
        (p.brand || '').toLowerCase().includes(query)
      if (!matchesQuery) return false
      if (filters.minPrice && p.price < min) return false
      if (filters.maxPrice && p.price > max) return false
      if (filters.size && !p.variants.some((v) => v.size === filters.size && v.stock > 0)) return false
      if (filters.color && !p.variants.some((v) => v.color === filters.color && v.stock > 0)) return false
      return true
    })
  }, [products, query, filters])

  return (
    <div className="shell py-8 lg:py-12">
      <header className="mb-8">
        <h1 className="text-3xl sm:text-4xl font-extrabold text-ink tracking-tight">Resultados de búsqueda</h1>
        <p className="text-muted mt-2">
          {query
            ? `${results.length} ${results.length === 1 ? 'resultado' : 'resultados'} para “${query}”`
            : 'Escribe en el buscador de la barra superior para encontrar productos.'}
        </p>
      </header>

      {query && (
        <>
          <div className="mb-8">
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
          ) : results.length === 0 ? (
            <div className="card p-12 text-center">
              <span className="grid place-items-center w-14 h-14 rounded-full bg-canvas text-muted mx-auto mb-4">
                <SearchIcon size={24} />
              </span>
              <p className="text-lg font-semibold text-ink mb-1">Sin resultados</p>
              <p className="text-muted text-sm mb-6">
                No encontramos productos para “{query}”. Prueba con la referencia, la marca o revisa el catálogo completo.
              </p>
              <Link to="/category/all" className="btn-brand inline-flex">Ver todo el catálogo</Link>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-grid">
              {results.map((p, index) => <ProductCard key={p.id} product={p} priority={index < 4} />)}
            </div>
          )}
        </>
      )}

      {!query && (
        <div className="card p-12 text-center">
          <span className="grid place-items-center w-14 h-14 rounded-full bg-canvas text-muted mx-auto mb-4">
            <SearchIcon size={24} />
          </span>
          <p className="text-muted text-sm mb-6">Usa el buscador para encontrar productos por nombre, marca o referencia.</p>
          <Link to="/category/all" className="btn-brand inline-flex">Explorar catálogo</Link>
        </div>
      )}
    </div>
  )
}
