import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import type { Env } from '../index'
import { adminAuth } from '../middleware/auth'

const app = new Hono<Env>()

const orderItemSchema = z.object({
  productId: z.union([z.string(), z.number()]).optional(),
  variantId: z.union([z.string(), z.number()]).optional(),
  sku: z.string().min(1).max(80),
  name: z.string().min(1).max(200),
  price: z.number().int().nonnegative(),
  size: z.string().max(40).optional(),
  color: z.string().max(40).optional(),
  quantity: z.number().int().positive().max(999),
})

const createOrderSchema = z.object({
  customerName: z.string().max(120).optional(),
  customerPhone: z.string().max(40).optional(),
  deliveryAddress: z.string().max(300).optional(),
  deliveryMethod: z.string().max(60).optional(),
  notes: z.string().max(500).optional(),
  currency: z.string().max(8).optional(),
  items: z.array(orderItemSchema).min(1).max(100),
})

const ALLOWED_STATUSES = ['pendiente', 'confirmado', 'enviado', 'entregado', 'cancelado'] as const
const MAX_ORDER_REQUESTS = 5
const ORDER_WINDOW_SECONDS = 15 * 60

async function orderRateKey(ip: string): Promise<string> {
 const value = `public-order:${ip.slice(0, 100) || 'unknown'}`
 const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
 return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function generateDisplayId(): string {
  const now = new Date()
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
  const random = Math.random().toString(36).slice(2, 6).toUpperCase()
  return `PED-${stamp}-${random}`
}

// POST /api/orders - Registrar pedido desde el checkout (público, best-effort)
app.post('/', zValidator('json', createOrderSchema), async (c) => {
  if (String(c.env.COMMERCE_ENABLED || '').toLowerCase() !== 'true') {
    return c.json({ error: 'Order requests are not enabled' }, 503)
  }
  const body = c.req.valid('json')
  const db = c.env.DB

  const rateKey = await orderRateKey(c.req.header('CF-Connecting-IP') || 'unknown')
  const blocked = await db.prepare(
    `SELECT 1 AS blocked FROM public_order_rate_limits WHERE rate_key = ? AND blocked_until > unixepoch('now')`
  ).bind(rateKey).first<{ blocked: number }>()
  if (blocked) return c.json({ error: 'Too many order requests. Try again later.' }, 429, { 'Retry-After': '900' })

  await db.prepare(
    `INSERT INTO public_order_rate_limits (rate_key, window_started_at, request_count)
     VALUES (?, unixepoch('now'), 1)
     ON CONFLICT(rate_key) DO UPDATE SET
       request_count = CASE WHEN window_started_at <= unixepoch('now') - ? THEN 1 ELSE request_count + 1 END,
       window_started_at = CASE WHEN window_started_at <= unixepoch('now') - ? THEN unixepoch('now') ELSE window_started_at END,
       blocked_until = CASE WHEN window_started_at <= unixepoch('now') - ? THEN NULL
         WHEN request_count + 1 >= ? THEN unixepoch('now') + ? ELSE blocked_until END`
  ).bind(rateKey, ORDER_WINDOW_SECONDS, ORDER_WINDOW_SECONDS, ORDER_WINDOW_SECONDS, MAX_ORDER_REQUESTS, ORDER_WINDOW_SECONDS).run()
  const count = await db.prepare(
    `SELECT request_count FROM public_order_rate_limits WHERE rate_key = ?`
  ).bind(rateKey).first<{ request_count: number }>()
  if ((count?.request_count ?? 0) > MAX_ORDER_REQUESTS) {
    return c.json({ error: 'Too many order requests. Try again later.' }, 429, { 'Retry-After': '900' })
  }

  const authoritativeItems = []
  const quantitiesByVariant = new Map<number, number>()
  for (const item of body.items) {
    const productId = Number(item.productId)
    const variantId = Number(item.variantId)
    if (!Number.isInteger(productId) || !Number.isInteger(variantId)) return c.json({ error: 'Each order item must include a valid product and variant' }, 400)
    const current = await db.prepare(
      `SELECT p.id AS product_id, p.sku AS product_sku, p.name AS product_name, p.price AS product_price,
              v.id AS variant_id, v.sku AS variant_sku, v.name AS variant_name, v.size, v.color,
              v.price_override, v.stock
       FROM products p JOIN product_variants v ON v.product_id = p.id
       WHERE p.id = ? AND v.id = ? AND p.is_active = 1 AND p.is_archived = 0 AND v.is_active = 1`
    ).bind(productId, variantId).first<Record<string, any>>()
    if (!current) return c.json({ error: 'An item is no longer available' }, 409)
    const nextQuantity = (quantitiesByVariant.get(variantId) || 0) + item.quantity
    quantitiesByVariant.set(variantId, nextQuantity)
    if (nextQuantity > Number(current.stock)) return c.json({ error: 'Requested quantity exceeds available stock' }, 409)
    const currentPrice = current.price_override == null ? Number(current.product_price) : Number(current.price_override)
    authoritativeItems.push({
      productId: String(current.product_id), variantId: String(current.variant_id),
      sku: String(current.variant_sku || current.product_sku), name: String(current.product_name),
      price: currentPrice, size: current.size || undefined, color: current.color || undefined,
      quantity: item.quantity,
    })
  }

  const subtotal = authoritativeItems.reduce((sum, item) => sum + item.price * item.quantity, 0)
  const currency = c.env.STORE_CURRENCY || 'COP'
  const displayId = generateDisplayId()

  const result = await db.prepare(
    `INSERT INTO orders
       (display_id, customer_name, customer_phone, delivery_address, delivery_method,
        items_json, subtotal, total, currency, status, whatsapp_sent, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendiente', 0, ?)`
  ).bind(
    displayId,
    body.customerName || null,
    body.customerPhone || null,
    body.deliveryAddress || null,
    body.deliveryMethod || null,
    JSON.stringify(authoritativeItems),
    subtotal,
    subtotal,
    currency,
    body.notes || null,
  ).run()

  const orderId = result.meta.last_row_id as number

  await db.prepare(
    `INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source)
     VALUES ('order_created', 'order', ?, ?, 'storefront', 'api')`
  ).bind(String(orderId), JSON.stringify({ displayId, total: subtotal, items: authoritativeItems.length })).run()

  return c.json({ id: orderId, displayId, total: subtotal, currency, status: 'pendiente' }, 201)
})

// GET /api/orders - Listar pedidos recientes (protegido)
app.get('/', adminAuth, async (c) => {
  const limit = Math.min(Number(c.req.query('limit') || 50), 100)
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM orders ORDER BY created_at DESC, id DESC LIMIT ?`
  ).bind(limit).all()

  const orders = (results || []).map((o: any) => ({
    id: o.id,
    displayId: o.display_id,
    customerName: o.customer_name,
    customerPhone: o.customer_phone,
    deliveryAddress: o.delivery_address,
    deliveryMethod: o.delivery_method,
    items: JSON.parse(o.items_json || '[]'),
    subtotal: o.subtotal,
    total: o.total,
    currency: o.currency,
    status: o.status,
    createdAt: o.created_at,
  }))

  return c.json(orders)
})

// PATCH /api/orders/:id - Actualizar estado del pedido (protegido)
app.patch('/:id', adminAuth, async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json().catch(() => null)
  const status = body?.status as string | undefined

  if (!id || !status || !ALLOWED_STATUSES.includes(status as (typeof ALLOWED_STATUSES)[number])) {
    return c.json({ error: 'Invalid order id or status' }, 400)
  }

  await c.env.DB.prepare(
    `UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?`
  ).bind(status, id).run()

  const adminEmail = c.get('adminEmail') || 'unknown'
  await c.env.DB.prepare(
    `INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source)
     VALUES ('order_status_updated', 'order', ?, ?, ?, 'admin')`
  ).bind(String(id), JSON.stringify({ status }), adminEmail).run()

  return c.json({ success: true, id, status })
})

export default app
