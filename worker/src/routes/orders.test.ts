import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import type { Env } from '../index'
import ordersRoutes from './orders'
import { createAdminToken } from '../services/auth'

const SECRET = 'unit-test-secret-with-at-least-32-characters'

function makeApp(options: { commerce?: boolean; stock?: number; noImages?: boolean; variantImage?: string } = {}) {
 const app = new Hono<Env>()
 app.route('/api/orders', ordersRoutes)
 let saved: Record<string, unknown> | null = null
 let eventCount = 0
 const catalog = { name: '', price: 250000, image: '' }
 const snapshots: string[] = []
 const db = {
  prepare(sql: string) {
   let values: unknown[] = []
   const statement = {
    bind(...args: unknown[]) { values = args; return statement },
    first: async () => {
     if (sql.includes('blocked_until')) return null
     if (sql.includes('SELECT request_count')) return { request_count: 1 }
     if (sql.includes('SELECT status, payment_status')) return { status: 'pendiente', payment_status: 'pendiente', internal_notes: '', shipping_cost: null, revision: 1 }
     if (sql.includes('SELECT id, display_id, request_fingerprint')) return saved && saved.key === values[0] ? { id: 4, display_id: saved.displayId, request_fingerprint: saved.fingerprint, subtotal: saved.subtotal, currency: 'COP', status: 'pendiente', payment_status: 'pendiente', items_json: saved.items } : null
     if (sql.includes('FROM products p JOIN product_variants')) {
      const id = Number(values[0])
      return { product_id: id, product_sku: `SH-${id}`, product_name: catalog.name || `Sneaker ${id}`, product_price: catalog.price,
       image_urls: options.noImages ? '[]' : JSON.stringify([catalog.image || `/api/assets/SH-${id}.jpg`]), variant_image_url: options.variantImage, variant_id: Number(values[1]),
       variant_sku: `SH-${id}-42`, size: '42', color: id === 12 ? 'Negro' : 'Blanco', price_override: null, stock: options.stock ?? 5 }
     }
     return null
    },
    all: async () => ({ results: [] }),
    run: async () => {
     if (sql.includes('INSERT INTO orders')) { saved = { displayId: values[0], items: values[8], subtotal: values[9], key: values[13], fingerprint: values[14] }; snapshots.push(String(values[8])); eventCount++ }
     if (sql.includes('INSERT INTO order_events')) eventCount++
     return { success: true, meta: { last_row_id: 4, changes: 1 } }
    },
   }
   return statement
  },
  batch: async () => [{ meta: { changes: 1 } }],
 } as unknown as D1Database
 return {
  app,
  env: { DB: db, ENVIRONMENT: 'test', JWT_SECRET: SECRET, ADMIN_EMAIL: 'admin@local.test', ADMIN_PASSWORD: 'test-password', STORE_CURRENCY: 'COP', COMMERCE_ENABLED: options.commerce === false ? 'false' : 'true' } as unknown as Env['Bindings'],
  get saved() { return saved },
  snapshots,
  editCatalog() { catalog.name = 'Renamed shoe'; catalog.price = 350000; catalog.image = '/api/assets/changed.jpg' },
  get eventCount() { return eventCount },
 }
}

const key = 'checkout-test-key-0001'
const createBody = (items = [{ productId: '12', variantId: '120', sku: 'tampered', name: 'Tampered', price: 1, quantity: 2 }]) => ({
 customerName: 'Test Buyer', customerCity: 'Bogotá', deliveryAddress: 'Calle 1', paymentMethod: 'Transferencia', currency: 'USD', items,
})
const post = (context: ReturnType<typeof makeApp>, body = createBody(), idempotencyKey = key) => context.app.request('/api/orders', {
 method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(body),
}, context.env)

describe('public order requests', () => {
 it('fails closed while commerce is disabled', async () => {
  const context = makeApp({ commerce: false })
  expect((await post(context)).status).toBe(503)
 })

 it('uses catalog prices and product image snapshots rather than browser values', async () => {
  const context = makeApp()
  const response = await post(context)
  expect(response.status).toBe(201)
  await expect(response.json()).resolves.toMatchObject({ subtotal: 500000, total: null, currency: 'COP', status: 'pendiente', paymentStatus: 'pendiente' })
  expect(JSON.parse(String(context.saved?.items))).toEqual([{
   productId: '12', variantId: '120', sku: 'SH-12-42', name: 'Sneaker 12', price: 250000, size: '42', color: 'Negro',
   imageUrl: '/api/assets/SH-12.jpg', quantity: 2, lineSubtotal: 500000,
  }])
 })

 it('stores three distinct bought variants and all three image snapshots', async () => {
  const context = makeApp()
  const items = [12, 13, 14].map((id) => ({ productId: String(id), variantId: String(id * 10), sku: 'browser', name: 'browser', price: 0, quantity: 1 }))
  const response = await post(context, createBody(items), 'three-items-checkout-001')
  expect(response.status).toBe(201)
  const savedItems = JSON.parse(String(context.saved?.items))
  expect(savedItems).toHaveLength(3)
  expect(savedItems.map((item: { imageUrl?: string }) => item.imageUrl)).toEqual(['/api/assets/SH-12.jpg', '/api/assets/SH-13.jpg', '/api/assets/SH-14.jpg'])
  expect(savedItems.map((item: { color?: string }) => item.color)).toEqual(['Negro', 'Blanco', 'Blanco'])
 })

 it('keeps a real missing-image state instead of inventing a photo', async () => {
  const context = makeApp({ noImages: true })
  expect((await post(context)).status).toBe(201)
  expect(JSON.parse(String(context.saved?.items))[0].imageUrl).toBeUndefined()
 })

 it('prefers the purchased variant photo over the product main photo', async () => {
  const context = makeApp({ variantImage: '/api/assets/SH-12-42.jpg' })
  await post(context)
  expect(JSON.parse(String(context.saved?.items))[0].imageUrl).toBe('/api/assets/SH-12-42.jpg')
 })

 it('keeps the original purchase snapshot when the catalog is later edited', async () => {
  const context = makeApp()
  await post(context, createBody(), 'purchase-before-edit-0001')
  context.editCatalog()
  await post(context, createBody(), 'purchase-after-edit-0002')
  const historical = JSON.parse(context.snapshots[0] || '[]')[0]
  expect(historical).toMatchObject({ name: 'Sneaker 12', price: 250000, imageUrl: '/api/assets/SH-12.jpg' })
  const current = JSON.parse(context.snapshots[1] || '[]')[0]
  expect(current).toMatchObject({ name: 'Renamed shoe', price: 350000, imageUrl: '/api/assets/changed.jpg' })
 })

 it('returns the same order on an idempotent retry without adding a second record', async () => {
  const context = makeApp()
  expect((await post(context)).status).toBe(201)
  const retry = await post(context)
  expect(retry.status).toBe(200)
  await expect(retry.json()).resolves.toMatchObject({ id: 4, replayed: true })
  expect(context.eventCount).toBe(1)
 })

 it('rejects reusing a checkout key for different order contents', async () => {
  const context = makeApp()
  await post(context)
  const response = await post(context, createBody([{ productId: '13', variantId: '130', sku: 'x', name: 'x', price: 1, quantity: 1 }]))
  expect(response.status).toBe(409)
 })

 it('rejects quantities above current catalog stock', async () => {
  const context = makeApp({ stock: 1 })
  const response = await post(context)
  expect(response.status).toBe(409)
 })

 it('requires a client idempotency key and protects buyer details on list routes', async () => {
  const context = makeApp()
  expect((await post(context, createBody(), '')).status).toBe(400)
  expect((await context.app.request('/api/orders', {}, context.env)).status).toBe(401)
 })

 it('allows an authorized admin to update a pending order with optimistic concurrency', async () => {
  const context = makeApp()
  const token = await createAdminToken('admin@local.test', SECRET)
  const response = await context.app.request('/api/orders/4', { method: 'PATCH',
   headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
   body: JSON.stringify({ status: 'confirmado', paymentStatus: 'pendiente', expectedRevision: 1 }),
  }, context.env)
  expect(response.status).toBe(200)
  await expect(response.json()).resolves.toMatchObject({ success: true, id: 4, revision: 2 })
 })

 it('rejects stale revisions and invalid state transitions', async () => {
  const context = makeApp()
  const token = await createAdminToken('admin@local.test', SECRET)
  const stale = await context.app.request('/api/orders/4', { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'confirmado', expectedRevision: 2 }) }, context.env)
  expect(stale.status).toBe(409)
  const transition = await context.app.request('/api/orders/4', { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'entregado', expectedRevision: 1 }) }, context.env)
  expect(transition.status).toBe(409)
 })
})
