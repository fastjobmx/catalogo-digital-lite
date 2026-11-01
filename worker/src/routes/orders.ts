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

function generateDisplayId(): string {
  const now = new Date()
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
  const random = Math.random().toString(36).slice(2, 6).toUpperCase()
  return `PED-${stamp}-${random}`
}

// POST /api/orders - Registrar pedido desde el checkout (público, best-effort)
app.post('/', zValidator('json', createOrderSchema), async (c) => {
  const body = c.req.valid('json')
  const db = c.env.DB

  const subtotal = body.items.reduce((sum, item) => sum + item.price * item.quantity, 0)
  const currency = body.currency || c.env.STORE_CURRENCY || 'COP'
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
    JSON.stringify(body.items),
    subtotal,
    subtotal,
    currency,
    body.notes || null,
  ).run()

  const orderId = result.meta.last_row_id as number

  await db.prepare(
    `INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source)
     VALUES ('order_created', 'order', ?, ?, 'storefront', 'api')`
  ).bind(String(orderId), JSON.stringify({ displayId, total: subtotal, items: body.items.length })).run()

  return c.json({ id: orderId, displayId, total: subtotal, currency }, 201)
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
