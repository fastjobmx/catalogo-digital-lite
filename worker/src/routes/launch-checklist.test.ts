/** «Listo para vender»: computed from the store's real data, own store only. */
import { beforeEach, describe, expect, it } from 'vitest'
import { createHarness, createStoreUser, seedCatalog, seedStore, userToken, type Harness } from '../testing/harness'

let h: Harness
const json = async (response: Response) => response.json() as Promise<any>

beforeEach(() => { h = createHarness() })

describe('launch checklist', () => {
  it('starts empty, follows the real data and reaches «listo para vender»', async () => {
    const store = await seedStore(h.db, { slug: 'nueva', name: 'Mi Tienda', whatsapp: '' })
    const token = await userToken(await createStoreUser(h.db, { email: 'd@nueva.co', password: 'ClaveSegura123', storeId: store, role: 'owner' }), 'd@nueva.co')
    h.db.query("UPDATE store_config SET whatsapp_phone = '' WHERE id = ?", store)
    const first = await json(await h.request('/api/admin/launch-checklist', { token, store: 'nueva' }))
    expect(first).toMatchObject({ done: 0, total: 8, ready: false })
    h.db.query("UPDATE store_config SET name = 'Flores de Ana', logo_url = '/api/assets/x/logo.png', primary_color = '#A414CF', whatsapp_phone = '+57 300 111 2233' WHERE id = ?", store)
    await seedCatalog(h.db, store, { categories: [{ name: 'Ramos', slug: 'ramos' }], products: Array.from({ length: 5 }, (_, i) => ({ sku: `R-${i}`, name: `Ramo ${i}`, price: 1000, category: 'ramos', imageUrls: ['/api/assets/x/r.jpg'], variants: [{ stock: 2 }] })) })
    const almost = await json(await h.request('/api/admin/launch-checklist', { token, store: 'nueva' }))
    expect(almost.items.filter((item: any) => !item.done).map((item: any) => item.key)).toEqual(['pedido'])
    const product = h.db.query<{ id: number; v: number }>('SELECT p.id, v.id AS v FROM products p JOIN product_variants v ON v.product_id = p.id WHERE p.store_id = ? LIMIT 1', store)[0]!
    expect((await h.request('/api/orders', { method: 'POST', store: 'nueva', headers: { 'Idempotency-Key': 'checklist-order-000001' }, body: { customerName: 'Prueba', items: [{ productId: product.id, variantId: product.v, sku: 'R-0', name: 'Ramo 0', price: 1000, quantity: 1 }] } })).status).toBe(201)
    expect(await json(await h.request('/api/admin/launch-checklist', { token, store: 'nueva' }))).toMatchObject({ done: 8, ready: true })
  })

  it('a product without a photo keeps the photo step open, and another store cannot read it', async () => {
    const store = await seedStore(h.db, { slug: 'fotos', name: 'Fotos' })
    const other = await seedStore(h.db, { slug: 'otra', name: 'Otra' })
    const token = await userToken(await createStoreUser(h.db, { email: 'f@f.co', password: 'ClaveSegura123', storeId: store, role: 'owner' }), 'f@f.co')
    await seedCatalog(h.db, store, { products: [{ sku: 'A', name: 'A', price: 1, imageUrls: ['/x.jpg'] }, { sku: 'B', name: 'B', price: 1 }] })
    h.db.query("UPDATE products SET image_urls = '[]' WHERE store_id = ? AND sku = 'B'", store)
    const result = await json(await h.request('/api/admin/launch-checklist', { token, store: 'fotos' }))
    expect(result.items.find((item: any) => item.key === 'fotos').done).toBe(false)
    expect(result.items.find((item: any) => item.key === 'primer_producto').done).toBe(true)
    expect(other).toBeGreaterThan(0)
    expect((await h.request('/api/admin/launch-checklist', { token, store: 'otra' })).status).toBe(403)
    expect((await h.request('/api/admin/launch-checklist', { store: 'fotos' })).status).toBe(401)
  })
})
