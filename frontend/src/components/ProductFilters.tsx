import type { ProductApi } from '../services/api'

export interface ProductFilterValues {
  minPrice: string
  maxPrice: string
  size: string
  color: string
}

export const EMPTY_FILTERS: ProductFilterValues = { minPrice: '', maxPrice: '', size: '', color: '' }

interface ProductFiltersProps {
  products: ProductApi[]
  value: ProductFilterValues
  onChange: (next: ProductFilterValues) => void
}

export default function ProductFilters({ products, value, onChange }: ProductFiltersProps) {
  const sizes = [...new Set(products.flatMap((p) => p.variants.map((v) => v.size).filter((s): s is string => Boolean(s))))].sort()
  const colors = [...new Set(products.flatMap((p) => p.variants.map((v) => v.color).filter((c): c is string => Boolean(c))))].sort()
  const hasFilters = Boolean(value.minPrice || value.maxPrice || value.size || value.color)

  return (
    <div className="card p-4 sm:p-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <label className="block">
          <span className="block text-xs font-semibold uppercase tracking-wide text-muted mb-1.5">Precio mínimo</span>
          <input
            className="input-field"
            value={value.minPrice}
            onChange={(e) => onChange({ ...value, minPrice: e.target.value })}
            inputMode="numeric"
            placeholder="0"
          />
        </label>
        <label className="block">
          <span className="block text-xs font-semibold uppercase tracking-wide text-muted mb-1.5">Precio máximo</span>
          <input
            className="input-field"
            value={value.maxPrice}
            onChange={(e) => onChange({ ...value, maxPrice: e.target.value })}
            inputMode="numeric"
            placeholder="Sin límite"
          />
        </label>
        {sizes.length > 0 && (
          <label className="block">
            <span className="block text-xs font-semibold uppercase tracking-wide text-muted mb-1.5">Talla</span>
            <select className="input-field" value={value.size} onChange={(e) => onChange({ ...value, size: e.target.value })}>
              <option value="">Todas</option>
              {sizes.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        )}
        {colors.length > 0 && (
          <label className="block">
            <span className="block text-xs font-semibold uppercase tracking-wide text-muted mb-1.5">Color</span>
            <select className="input-field" value={value.color} onChange={(e) => onChange({ ...value, color: e.target.value })}>
              <option value="">Todos</option>
              {colors.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        )}
      </div>

      {hasFilters && (
        <button
          type="button"
          className="mt-3 text-sm font-semibold text-brand hover:opacity-80 transition-opacity"
          onClick={() => onChange(EMPTY_FILTERS)}
        >
          Limpiar filtros
        </button>
      )}
    </div>
  )
}
