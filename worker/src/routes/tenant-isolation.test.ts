/** Negative tests: a user of store A can never read, change or reference data of store B. */
import { beforeEach, describe, expect, it } from 'vitest'
import { createHarness, createStoreUser, seedCatalog, seedStore, superadminToken, userToken, type Harness } from '../testing/harness'

let h: Harness
let storeA: number
let storeB: number
let tokenA: string
let ids: Record<string, number>

beforeEach(async () => {
  h = createHarness()
  storeA = await seedStore(h.db, { slug: 'tienda-a', name: 'Tienda A' })
  storeB = await seedStore(h.db, { slug: 'tienda-b', name: 'Tienda B' })
  const ownerA = await createStoreUser(h.db, { email: 'a@tiendas.test', password: 'clave-segura-123', storeId: storeA, role: 'owner' })
  tokenA = await userToken(ownerA, 'a@tiendas.test')
  ids = {
    ...await seedCatalog(h.db, storeA, { categories: [{ name: 'Ropa', slug: 'ropa' }], products: [{ sku: 'SKU-1', name: 'Camisa A', price: 50000, category: 'ropa' }] }),
    ...Object.fromEntries(Object.entries(await seedCatalog(h.db, storeB, { categories: [{ name: 'Ropa', slug: 'ropa' }], products: [{ sku: 'SKU-1', name: 'Camisa B', price: 70000, category: 'ropa' }] })).map(([key, value]) => [`B:${key}`, value])),
  }
})

const json = async (response: Response) => response.json() as Promise<any>

describe('public storefront isolation', () => {
  it('serves each store its own catalog, configuration and categories; the primary store stays the default', async () => {
    expect((await json(await h.request('/api/products', { store: 'tienda-a' }))).map((product: any) => product.name)).toEqual(['Camisa A'])
    expect((await json(await h.request('/api/products', { store: 'tienda-b' }))).map((product: any) => product.name)).toEqual(['Camisa B'])
    expect(await json(await h.request('/api/products'))).toEqual([])
    expect(await json(await h.request('/api/store', { store: 'tienda-b' }))).toMatchObject({ name: 'Tienda B', slug: 'tienda-b' })
    expect((await json(await h.request('/api/products/SKU-1', { store: 'tienda-b' }))).name).toBe('Camisa B')
    expect(await json(await h.request('/api/categories', { store: 'tienda-a' }))).toEqual([expect.objectContaining({ slug: 'ropa', product_count: 1 })])
    expect((await h.request('/api/products', { store: 'no-existe' })).status).toBe(404)
  })

  it('keeps draft stores private except for their own team, and hides suspended stores', async () => {
    h.db.query("UPDATE stores SET status = 'draft' WHERE id = ?", storeA)
    h.db.query("UPDATE stores SET status = 'suspended' WHERE id = ?", storeB)
    expect((await h.request('/api/products', { store: 'tienda-a' })).status).toBe(404)
    const preview = await h.request('/api/products', { store: 'tienda-a', token: tokenA })
    expect(preview.status).toBe(200)
    expect(preview.headers.get('Cache-Control')).toContain('no-store')
    expect((await h.request('/api/store', { store: 'tienda-b' })).status).toBe(404)
    expect((await h.request('/api/store', { store: 'tienda-b', token: tokenA })).status).toBe(404)
  })

  it('rejects public orders that reference another store or a store that is not active', async () => {
    const item = { productId: String(ids['B:SKU-1']), variantId: String(ids['B:SKU-1#Única']), sku: 'x', name: 'x', price: 1, quantity: 1 }
    const crossStore = await h.request('/api/orders', { method: 'POST', store: 'tienda-a', headers: { 'Idempotency-Key': 'cross-store-key-001' }, body: { items: [item] } })
    expect(crossStore.status).toBe(409)
    h.db.query("UPDATE stores SET status = 'draft' WHERE id = ?", storeB)
    const draft = await h.request('/api/orders', { method: 'POST', store: 'tienda-b', token: tokenA, headers: { 'Idempotency-Key': 'draft-store-key-0001' }, body: { items: [item] } })
    expect(draft.status).toBe(404)
  })

  it('does not replay an idempotency key across stores', async () => {
    const itemA = { productId: String(ids['SKU-1']), variantId: String(ids['SKU-1#Única']), sku: 'x', name: 'x', price: 1, quantity: 1 }
    const itemB = { productId: String(ids['B:SKU-1']), variantId: String(ids['B:SKU-1#Única']), sku: 'x', name: 'x', price: 1, quantity: 1 }
    expect((await h.request('/api/orders', { method: 'POST', store: 'tienda-a', headers: { 'Idempotency-Key': 'shared-key-00000001' }, body: { items: [itemA] } })).status).toBe(201)
    expect((await h.request('/api/orders', { method: 'POST', store: 'tienda-b', headers: { 'Idempotency-Key': 'shared-key-00000001' }, body: { items: [itemB] } })).status).toBe(409)
  })
})

describe('administration isolation', () => {
  it('forbids a store owner from addressing another store', async () => {
    for (const path of ['/api/admin/stats', '/api/orders', '/api/admin/team', '/api/admin/audit']) {
      expect((await h.request(path, { token: tokenA, store: 'tienda-b' })).status).toBe(403)
    }
    expect((await h.request('/api/admin/stats', { token: tokenA })).status).toBe(403)
    expect((await h.request('/api/admin/stats', { token: tokenA, store: 'tienda-a' })).status).toBe(200)
  })

  it('cannot change, archive or restock another store’s product through its own store context', async () => {
    const foreignProduct = ids['B:SKU-1']!
    const foreignVariant = ids['B:SKU-1#Única']!
    expect((await h.request(`/api/admin/products/${foreignProduct}`, { method: 'PUT', token: tokenA, store: 'tienda-a', body: { name: 'Hack' } })).status).toBe(404)
    expect((await h.request(`/api/admin/products/${foreignProduct}`, { method: 'DELETE', token: tokenA, store: 'tienda-a' })).status).toBe(404)
    expect((await h.request(`/api/admin/products/${foreignProduct}/variants`, { method: 'PUT', token: tokenA, store: 'tienda-a', body: { variants: [{ id: foreignVariant, stock: 0 }] } })).status).toBe(404)
    expect(h.db.query('SELECT name, is_archived FROM products WHERE id = ?', foreignProduct)).toEqual([{ name: 'Camisa B', is_archived: 0 }])
  })

  it('cannot read or update another store’s order by id', async () => {
    const itemB = { productId: String(ids['B:SKU-1']), variantId: String(ids['B:SKU-1#Única']), sku: 'x', name: 'x', price: 1, quantity: 1 }
    const order = await json(await h.request('/api/orders', { method: 'POST', store: 'tienda-b', headers: { 'Idempotency-Key': 'order-of-store-b-01' }, body: { customerName: 'Cliente B', items: [itemB] } }))
    expect((await h.request(`/api/orders/${order.id}`, { token: tokenA, store: 'tienda-a' })).status).toBe(404)
    expect((await h.request(`/api/orders/${order.id}`, { method: 'PATCH', token: tokenA, store: 'tienda-a', body: { status: 'cancelado', expectedRevision: 1 } })).status).toBe(404)
    expect((await json(await h.request('/api/orders', { token: tokenA, store: 'tienda-a' }))).items).toEqual([])
  })

  it('rejects images that belong to another store and stores uploads under the store prefix', async () => {
    const foreign = `/api/assets/stores/${storeB}/store/logo.png`
    const response = await h.request('/api/admin/store', { method: 'PUT', token: tokenA, store: 'tienda-a', body: { logoUrl: foreign } })
    expect(response.status).toBe(400)
    expect(await json(response)).toMatchObject({ code: 'ASSET_NOT_OWNED' })
    expect((await h.request('/api/admin/products', { method: 'POST', token: tokenA, store: 'tienda-a', body: { sku: 'NEW-1', name: 'Nuevo', price: 1, imageUrls: [foreign] } })).status).toBe(400)
    const form = new FormData()
    form.append('file', new File([new Uint8Array([1, 2, 3])], 'logo.png', { type: 'image/png' }))
    form.append('folder', 'store')
    const upload = await json(await h.request('/api/upload/image', { method: 'POST', token: tokenA, store: 'tienda-a', body: form }))
    expect(upload.key).toMatch(new RegExp(`^stores/${storeA}/store/`))
  })

  it('lets the owner invite an operator with a limited role', async () => {
    const invite = await json(await h.request('/api/admin/team', { method: 'POST', token: tokenA, store: 'tienda-a', body: { email: 'op@tiendas.test', role: 'operator' } }))
    expect(invite.activationUrl).toContain('/t/tienda-a/admin/activar?token=')
    h.db.query("UPDATE platform_users SET status = 'active' WHERE email = 'op@tiendas.test'")
    const operator = await userToken(invite.userId, 'op@tiendas.test')
    expect((await h.request('/api/admin/store', { method: 'PUT', token: operator, store: 'tienda-a', body: { name: 'X' } })).status).toBe(403)
    expect((await h.request('/api/admin/team', { method: 'POST', token: operator, store: 'tienda-a', body: { email: 'z@z.test', role: 'admin' } })).status).toBe(403)
    expect((await h.request(`/api/admin/products/${ids['SKU-1']}/variants`, { method: 'PUT', token: operator, store: 'tienda-a', body: { variants: [{ id: ids['SKU-1#Única'], stock: 3 }] } })).status).toBe(200)
    expect((await h.request('/api/admin/stats', { token: operator, store: 'tienda-b' })).status).toBe(403)
  })

  it('lets only the platform superadmin act on any store', async () => {
    const superadmin = await superadminToken()
    expect((await h.request('/api/admin/stats', { token: superadmin, store: 'tienda-b' })).status).toBe(200)
    expect((await h.request('/api/platform/stores', { token: tokenA })).status).toBe(403)
  })

  it('blocks a suspended store’s team from administering it', async () => {
    h.db.query("UPDATE stores SET status = 'suspended' WHERE id = ?", storeA)
    const response = await h.request('/api/admin/stats', { token: tokenA, store: 'tienda-a' })
    expect(response.status).toBe(403)
    expect(await json(response)).toMatchObject({ code: 'STORE_UNAVAILABLE' })
  })
})
