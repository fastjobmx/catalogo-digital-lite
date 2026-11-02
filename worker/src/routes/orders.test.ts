import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import type { Env } from '../index'
import ordersRoutes from './orders'

function makeApp(overrides: Partial<Env['Bindings']> = {}) {
 const app = new Hono<Env>()
 app.route('/api/orders', ordersRoutes)
 let savedItems = ''
 const db = {
  prepare(sql: string) {
   let values: unknown[] = []
   const statement = {
    bind(...args: unknown[]) { values = args; return statement },
    first: async () => {
     if (sql.includes('blocked_until')) return null
     if (sql.includes('SELECT request_count')) return { request_count: 1 }
     if (sql.includes('FROM products p JOIN product_variants')) return {
      product_id: 12, product_sku: 'SH-12', product_name: 'Sneaker Original', product_price: 250000,
      variant_id: 120, variant_sku: 'SH-12-42', variant_name: 'Talla 42', size: '42', color: 'Negro',
      price_override: null, stock: 3,
     }
     return null
    },
    run: async () => {
     if (sql.includes('INSERT INTO orders')) savedItems = String(values[5] || '')
     return { success: true, meta: { last_row_id: 1 } }
    },
   }
   return statement
  },
 } as unknown as D1Database
 return {
  app,
  env: { DB: db, ENVIRONMENT: 'production', STORE_CURRENCY: 'COP', COMMERCE_ENABLED: 'true', ...overrides } as unknown as Env['Bindings'],
  get savedItems() { return savedItems },
 }
}

const body = {
 customerName: 'Test Buyer',
 currency: 'USD',
 items: [{ productId: '12', variantId: '120', sku: 'tampered', name: 'Tampered', price: 1, quantity: 2 }],
}

describe('public order requests', () => {
 it('fails closed while commerce is disabled', async () => {
  const { app, env } = makeApp({ COMMERCE_ENABLED: 'false' })
  const response = await app.request('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env)
  expect(response.status).toBe(503)
 })

 it('uses catalog prices and identifiers instead of browser-provided values', async () => {
  const context = makeApp()
  const response = await context.app.request('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, context.env)
  expect(response.status).toBe(201)
  await expect(response.json()).resolves.toMatchObject({ total: 500000, currency: 'COP', status: 'pendiente' })
  expect(JSON.parse(context.savedItems)).toEqual([{
   productId: '12', variantId: '120', sku: 'SH-12-42', name: 'Sneaker Original',
   price: 250000, size: '42', color: 'Negro', quantity: 2,
  }])
 })
})
