/** Sitemap data: only active stores and visible products, no private fields. */
import { beforeEach, describe, expect, it } from 'vitest'
import { createHarness, seedCatalog, seedStore, type Harness } from '../testing/harness'

let h: Harness
beforeEach(async () => {
  h = createHarness()
  const active = await seedStore(h.db, { slug: 'tienda-activa', name: 'Activa' })
  await seedStore(h.db, { slug: 'tienda-borrador', name: 'Borrador', status: 'draft' })
  await seedStore(h.db, { slug: 'tienda-suspendida', name: 'Suspendida', status: 'suspended' })
  await seedCatalog(h.db, active, { products: [{ sku: 'VIS-1', name: 'Visible', price: 1000 }, { sku: 'ARC 2', name: 'Archivado', price: 1000 }, { sku: 'OFF-3', name: 'Inactivo', price: 1000 }] })
  h.db.query("UPDATE products SET is_archived = 1 WHERE sku = 'ARC 2'")
  h.db.query("UPDATE products SET is_active = 0 WHERE sku = 'OFF-3'")
})

const json = async (response: Response) => response.json() as Promise<any>

describe('sitemap data', () => {
  it('lists only active stores, with public paths and cache headers', async () => {
    const response = await h.request('/api/seo/stores')
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toContain('max-age=3600')
    const { items } = await json(response)
    const slugs = items.map((item: any) => item.slug)
    expect(slugs).toContain('tienda-activa')
    expect(slugs).not.toContain('tienda-borrador')
    expect(slugs).not.toContain('tienda-suspendida')
    expect(items.find((item: any) => item.slug === 'tienda-activa')).toMatchObject({ path: '/t/tienda-activa', primary: false })
    expect(Object.keys(items[0]).sort()).toEqual(['lastmod', 'path', 'primary', 'slug'])
  })

  it('lists only visible products of an active store and hides other stores', async () => {
    const { items } = await json(await h.request('/api/seo/stores/tienda-activa/products'))
    expect(items.map((item: any) => item.path)).toEqual(['/t/tienda-activa/producto/VIS-1'])
    expect((await h.request('/api/seo/stores/tienda-borrador/products')).status).toBe(404)
    expect((await h.request('/api/seo/stores/no-existe/products')).status).toBe(404)
    expect((await h.request('/api/seo/stores/..%2Fadmin/products')).status).toBe(404)
  })
})
