import { describe, expect, it } from 'vitest'
import { DEMO_CATEGORIES, DEMO_PRODUCTS } from '../data/demoCatalog'
import { filterCatalogProducts, findProductBySku } from './catalog'

const noFilters = { minPrice: '', maxPrice: '', size: '', color: '' }

describe('visibilidad del catálogo demo', () => {
  it('no oculta productos en la ruta de catálogo completo sin filtros', () => {
    expect(filterCatalogProducts(DEMO_PRODUCTS, 'all', noFilters)).toHaveLength(18)
  })

  it('mantiene productos al filtrar cada categoría activa', () => {
    const visible = DEMO_CATEGORIES.flatMap((category) => filterCatalogProducts(DEMO_PRODUCTS, category.slug, noFilters))
    expect(visible).toHaveLength(18)
    expect(new Set(visible.map((product) => product.sku)).size).toBe(18)
  })
})

describe('búsqueda de producto por SKU de ruta', () => {
  it('encuentra KINETIK-06 sin distinguir mayúsculas ni confundirlo con otro producto', () => {
    const product = findProductBySku(DEMO_PRODUCTS, 'kinetik-06')
    expect(product?.sku).toBe('KINETIK-06')
    expect(product?.imageUrls).toEqual(['/seed-images/sneakerhub/KINETIK-06.jpg'])
    expect(findProductBySku(DEMO_PRODUCTS, 'kinetik-06')?.id).not.toBe(findProductBySku(DEMO_PRODUCTS, 'TERA-08')?.id)
  })
})
