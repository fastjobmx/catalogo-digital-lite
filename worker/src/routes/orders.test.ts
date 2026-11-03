import { beforeEach, describe, expect, it } from 'vitest'
import { createHarness, seedCatalog, superadminToken, type Harness } from '../testing/harness'

let h: Harness
let ids: Record<string, number>

beforeEach(async () => {
 h = createHarness()
 ids = await seedCatalog(h.db, 1, {
  categories: [{ name: 'Running', slug: 'running' }],
  products: [
   { sku: 'SH-12', name: 'Sneaker 12', price: 250000, category: 'running', imageUrls: ['/api/assets/SH-12.jpg'], variants: [{ size: '42', color: 'Negro', stock: 5 }] },
   { sku: 'SH-13', name: 'Sneaker 13', price: 100000, imageUrls: ['/api/assets/SH-13.jpg'], variants: [{ size: '42', color: 'Blanco', stock: 5 }] },
   { sku: 'SH-14', name: 'Sneaker 14', price: 120000, imageUrls: ['/api/assets/SH-14.jpg'], variants: [{ size: '42', color: 'Blanco', stock: 5, imageUrl: '/api/assets/SH-14-42.jpg' }] },
   { sku: 'SH-15', name: 'Sneaker 15', price: 90000, imageUrls: [], variants: [{ size: '40', color: 'Gris', stock: 1 }] },
  ],
 })
})

const item = (sku: string, quantity = 2, size = '42') => ({ productId: String(ids[sku]), variantId: String(ids[`${sku}#${size}`]), sku: 'tampered', name: 'Tampered', price: 1, quantity })
const body = (items = [item('SH-12')]) => ({ customerName: 'Test Buyer', customerCity: 'Bogotá', deliveryAddress: 'Calle 1', paymentMethod: 'Transferencia', currency: 'USD', items })
const post = (payload = body(), key = 'checkout-test-key-0001', store?: string) => h.request('/api/orders', { method: 'POST', body: payload, headers: key ? { 'Idempotency-Key': key } : {}, store })
const savedItems = (displayId: string) => JSON.parse(String(h.db.query<{ items_json: string }>('SELECT items_json FROM orders WHERE display_id = ?', displayId)[0]?.items_json))

describe('public order requests', () => {
 it('fails closed while commerce is disabled', async () => {
  h = createHarness({ COMMERCE_ENABLED: 'false' })
  expect((await post()).status).toBe(503)
 })

 it('uses catalog prices and product image snapshots rather than browser values', async () => {
  const response = await post()
  expect(response.status).toBe(201)
  const order = await response.json() as { displayId: string }
  expect(order).toMatchObject({ subtotal: 500000, total: null, currency: 'COP', status: 'pendiente', paymentStatus: 'pendiente' })
  expect(savedItems(order.displayId)).toEqual([{
   productId: String(ids['SH-12']), variantId: String(ids['SH-12#42']), sku: 'SH-12-42', name: 'Sneaker 12', price: 250000, size: '42', color: 'Negro',
   imageUrl: '/api/assets/SH-12.jpg', quantity: 2, lineSubtotal: 500000,
  }])
 })

 it('stores three distinct bought variants, prefers variant photos and keeps missing images missing', async () => {
  const response = await post(body([item('SH-12', 1), item('SH-14', 1), item('SH-15', 1, '40')]), 'three-items-checkout-001')
  expect(response.status).toBe(201)
  const items = savedItems((await response.json() as { displayId: string }).displayId)
  expect(items.map((entry: { imageUrl?: string }) => entry.imageUrl)).toEqual(['/api/assets/SH-12.jpg', '/api/assets/SH-14-42.jpg', undefined])
  expect(items.map((entry: { color?: string }) => entry.color)).toEqual(['Negro', 'Blanco', 'Gris'])
 })

 it('keeps the original purchase snapshot when the catalog is later edited', async () => {
  const first = await (await post(body(), 'purchase-before-edit-0001')).json() as { displayId: string }
  await h.db.prepare("UPDATE products SET name = 'Renamed shoe', price = 350000 WHERE sku = 'SH-12'").run()
  const second = await (await post(body(), 'purchase-after-edit-0002')).json() as { displayId: string }
  expect(savedItems(first.displayId)[0]).toMatchObject({ name: 'Sneaker 12', price: 250000 })
  expect(savedItems(second.displayId)[0]).toMatchObject({ name: 'Renamed shoe', price: 350000 })
 })

 it('returns the same order on an idempotent retry without adding a second record', async () => {
  expect((await post()).status).toBe(201)
  const retry = await post()
  expect(retry.status).toBe(200)
  await expect(retry.json()).resolves.toMatchObject({ replayed: true })
  expect(h.db.query('SELECT id FROM orders')).toHaveLength(1)
  expect(h.db.query("SELECT id FROM order_events WHERE event_type = 'created'")).toHaveLength(1)
 })

 it('rejects reusing a checkout key for different order contents', async () => {
  await post()
  expect((await post(body([item('SH-13', 1)]))).status).toBe(409)
 })

 it('rejects quantities above current catalog stock', async () => {
  expect((await post(body([item('SH-15', 2, '40')]))).status).toBe(409)
 })

 it('requires a client idempotency key and protects buyer details on list routes', async () => {
  expect((await post(body(), '')).status).toBe(400)
  expect((await h.request('/api/orders')).status).toBe(401)
 })

 it('confirms a pending order with optimistic concurrency and reserves stock through the D1 trigger', async () => {
  const created = await (await post()).json() as { id: number }
  const token = await superadminToken()
  const response = await h.request(`/api/orders/${created.id}`, { method: 'PATCH', token, body: { status: 'confirmado', paymentStatus: 'pendiente', expectedRevision: 1 } })
  expect(response.status).toBe(200)
  await expect(response.json()).resolves.toMatchObject({ success: true, id: created.id, revision: 2 })
  expect(h.db.query<{ stock: number }>('SELECT stock FROM product_variants WHERE id = ?', ids['SH-12#42'])[0]?.stock).toBe(3)
 })

 it('rejects stale revisions and invalid state transitions', async () => {
  const created = await (await post()).json() as { id: number }
  const token = await superadminToken()
  expect((await h.request(`/api/orders/${created.id}`, { method: 'PATCH', token, body: { status: 'confirmado', expectedRevision: 2 } })).status).toBe(409)
  expect((await h.request(`/api/orders/${created.id}`, { method: 'PATCH', token, body: { status: 'entregado', expectedRevision: 1 } })).status).toBe(409)
 })
})
