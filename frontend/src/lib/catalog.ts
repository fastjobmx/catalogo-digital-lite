import type { ProductApi } from '../services/api'

export function totalStock(product: ProductApi): number {
  return product.variants.reduce((sum, variant) => sum + (variant.isActive ? variant.stock : 0), 0)
}

export interface CatalogFilterValues {
  minPrice: string
  maxPrice: string
  size: string
  color: string
}

/** Finds a product by SKU, ignoring case, or by its numeric ID for legacy links. */
export function findProductBySku<T extends { sku: string; id: number }>(products: T[], sku: string): T | undefined {
  const normalized = sku.trim().toLocaleLowerCase('en-US')
  return products.find((product) =>
    product.sku.toLocaleLowerCase('en-US') === normalized || String(product.id) === sku.trim(),
  )
}

export function filterCatalogProducts(products: ProductApi[], slug: string | undefined, filters: CatalogFilterValues): ProductApi[] {
  const min = Number(filters.minPrice)
  const max = Number(filters.maxPrice)
  return products.filter((product) => {
    if (slug && slug !== 'all' && product.categorySlug !== slug) return false
    if (filters.minPrice && product.price < min) return false
    if (filters.maxPrice && product.price > max) return false
    if (filters.size && !product.variants.some((variant) => variant.isActive !== false && variant.size === filters.size && variant.stock > 0)) return false
    if (filters.color && !product.variants.some((variant) => variant.isActive !== false && variant.color === filters.color && variant.stock > 0)) return false
    return true
  })
}
