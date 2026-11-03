import { describe, expect, it } from 'vitest'
import { createHarness, seedCatalog } from '../testing/harness'

describe('GET /api/products', () => {
  it('obtiene y agrupa productos con variantes usando una sola consulta de catálogo', async () => {
    const h = createHarness()
    await seedCatalog(h.db, 1, {
      categories: [{ name: 'Running', slug: 'running' }],
      products: Array.from({ length: 18 }, (_, index) => ({
        sku: `SH-${index + 1}`, name: `Sneaker ${index + 1}`, price: 100000 + index, category: 'running',
        variants: [{ size: '40', color: 'Negro', stock: 2 }, { size: '41', color: 'Negro', stock: 3 }],
      })),
    })
    const before = h.db.statements.length
    const response = await h.request('/api/products')
    expect(response.status).toBe(200)
    const products = await response.json() as Array<{ sku: string; variants: unknown[]; imageUrls: string[]; categorySlug: string }>
    expect(products).toHaveLength(18)
    expect(products[0]).toMatchObject({ categorySlug: 'running', imageUrls: [expect.stringContaining('/api/assets/')] })
    expect(products.every((product) => product.variants.length === 2)).toBe(true)
    const catalogQueries = h.db.statements.slice(before).filter((sql) => sql.includes('FROM products p'))
    expect(catalogQueries).toHaveLength(1)
  })

  it('devuelve la ficha individual con foto y categoría en el contrato del frontend', async () => {
    const h = createHarness()
    await seedCatalog(h.db, 1, {
      categories: [{ name: 'Running', slug: 'running' }],
      products: [{ sku: 'TERA-08', name: 'Tera 08', price: 280000, category: 'running', imageUrls: ['/seed-images/sneakerhub/TERA-08.jpg'], variants: [{ size: '42', color: 'Blanco', stock: 4 }] }],
    })
    const response = await h.request('/api/products/TERA-08')
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      sku: 'TERA-08', imageUrls: ['/seed-images/sneakerhub/TERA-08.jpg'], categoryName: 'Running', categorySlug: 'running',
      variants: [{ size: '42', color: 'Blanco', stock: 4, isActive: true }],
    })
    expect((await h.request('/api/products/NO-EXISTE')).status).toBe(404)
  })
})
