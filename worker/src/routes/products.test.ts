import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import productsRoute from './products'
import type { Env } from '../index'

describe('GET /api/products', () => {
  it('obtiene y agrupa productos con variantes usando una sola consulta', async () => {
    const rows = Array.from({ length: 18 }, (_, index) => ({
      id: index + 1,
      sku: `SKU-${index + 1}`,
      name: `Producto ${index + 1}`,
      description: null,
      brand: 'SneakerHub',
      price: 100000,
      compare_at_price: null,
      is_featured: index < 4 ? 1 : 0,
      image_urls: JSON.stringify([`/seed-images/sneakerhub/${index + 1}.jpg`]),
      category_id: 1,
      category_name: 'Calzado',
      category_slug: 'calzado',
      variant_id: index * 10 + 1,
      variant_sku: `SKU-${index + 1}-38`,
      variant_name: 'Talla 38',
      variant_size: '38',
      variant_color: null,
      variant_price_override: null,
      variant_stock: 5,
      variant_is_active: 1,
    }))
    let queryCount = 0
    const db = {
      prepare: () => ({
        bind() { return this },
        all: async () => { queryCount += 1; return { results: rows } },
      }),
    }
    const app = new Hono<Env>()
    app.route('/api/products', productsRoute)
    const response = await app.request('/api/products', {}, { DB: db } as unknown as Env['Bindings'])

    expect(response.status).toBe(200)
    const products = await response.json() as Array<Record<string, any>>
    expect(products).toHaveLength(18)
    expect(products[0]).toMatchObject({
      id: 1,
      sku: 'SKU-1',
      imageUrls: ['/seed-images/sneakerhub/1.jpg'],
      categorySlug: 'calzado',
      variants: [{ sku: 'SKU-1-38', size: '38', stock: 5, isActive: true }],
    })
    expect(queryCount).toBe(1)
  })

  it('devuelve la ficha individual con foto y categoría en el contrato del frontend', async () => {
    const product = {
      id: 17,
      sku: 'KINETIK-06',
      name: 'Kinetik Aero Carbon',
      description: 'Ficha de demostración',
      brand: 'Kinetik',
      price: 389900,
      compare_at_price: null,
      is_featured: 1,
      is_active: 1,
      image_urls: '["/seed-images/sneakerhub/KINETIK-06.jpg"]',
      category_id: 2,
      category_name: 'Running',
      category_slug: 'running',
    }
    const db = {
      prepare: () => ({
        bind() { return this },
        first: async () => product,
        all: async () => ({ results: [{ id: 1701, sku: 'KINETIK-06-40', name: '40', size: '40', color: null, price_override: null, stock: 9, is_active: 1 }] }),
      }),
    }
    const app = new Hono<Env>()
    app.route('/api/products', productsRoute)
    const response = await app.request('/api/products/KINETIK-06', {}, { DB: db } as unknown as Env['Bindings'])

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      id: 17,
      sku: 'KINETIK-06',
      imageUrls: ['/seed-images/sneakerhub/KINETIK-06.jpg'],
      categoryId: 2,
      categoryName: 'Running',
      categorySlug: 'running',
      variants: [{ sku: 'KINETIK-06-40', isActive: true }],
    })
  })
})
