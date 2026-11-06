import { Hono } from 'hono'
import { customerNotice, DELIVERY_METHODS, effectiveShippingStatus, orderStatusCounts, SHIPPING_STATUSES, TRANSITION_MESSAGES, transitionOrder } from '../services/orders'
import { DocumentError, listOrderDocuments, ORDER_DOCUMENT_MAX_BYTES, readOrderDocument, storeOrderDocument } from '../services/orderDocuments'
import { checkCoupon, claimCouponUse, normalizePhone, recordMarketingConsent } from '../services/marketing'
import { notifyNewOrder } from '../services/assistant/orders'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import type { Env } from '../index'
import { adminAuth, requireCapability } from '../middleware/auth'
import { publicStore } from '../middleware/tenant'

const app = new Hono<Env>()

const orderItemSchema = z.object({
  productId: z.union([z.string(), z.number()]),
  variantId: z.union([z.string(), z.number()]),
  sku: z.string().min(1).max(80),
  name: z.string().min(1).max(200),
  price: z.number().int().nonnegative(),
  size: z.string().max(40).optional(),
  color: z.string().max(40).optional(),
  quantity: z.number().int().positive().max(999),
})

const createOrderSchema = z.object({
  customerName: z.string().trim().min(1).max(120).optional(),
  customerPhone: z.string().trim().max(40).refine((phone) => {
    if (!phone) return true
    const digits = phone.replace(/\D/g, '')
    return /^\+?[0-9\s().-]+$/.test(phone) && digits.length >= 7 && digits.length <= 15
  }, 'Invalid international phone number').optional(),
  customerEmail: z.string().trim().email().max(254).optional(),
  customerCity: z.string().trim().max(100).optional(),
  deliveryAddress: z.string().trim().max(300).optional(),
  deliveryMethod: z.string().trim().max(60).optional(),
  paymentMethod: z.string().trim().max(60).optional(),
  notes: z.string().trim().max(500).optional(),
  currency: z.string().max(8).optional(),
  items: z.array(orderItemSchema).min(1).max(100),
  couponCode: z.string().trim().max(30).optional(),
  /** Explicit opt-in to receive promotions by WhatsApp; never pre-checked. */
  marketingConsent: z.boolean().optional(),
})

const ALLOWED_STATUSES = ['pendiente', 'confirmado', 'preparando', 'enviado', 'entregado', 'cancelado'] as const
const ALLOWED_PAYMENT_STATUSES = ['pendiente', 'comprobante_recibido', 'verificado', 'reembolsado'] as const
const MAX_ORDER_REQUESTS = 5
const ORDER_WINDOW_SECONDS = 15 * 60

type SnapshotItem = {
  productId: string; variantId: string; sku: string; name: string; price: number
  size?: string; color?: string; imageUrl?: string; quantity: number; lineSubtotal: number
}

async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function orderRateKey(ip: string): Promise<string> {
  return digest(`public-order:${ip.slice(0, 100) || 'unknown'}`)
}

function generateDisplayId(): string {
  const now = new Date()
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
  return `PED-${stamp}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`
}

function parseItems(value: unknown): SnapshotItem[] {
  try { return JSON.parse(String(value || '[]')) as SnapshotItem[] } catch { return [] }
}

function publicImageUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const source = value.trim()
  const path = source.split(/[?#]/, 1)[0] || ''
  if (!source || /[\\\u0000-\u001f]/.test(source) || source.startsWith('//') || path.split('/').includes('..')) return undefined
  if (/^https:\/\//i.test(source)) {
    try {
      const url = new URL(source)
      if (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname.endsWith('.local')) return undefined
      return url.href
    } catch { return undefined }
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(source)) return undefined
  return source.startsWith('/') ? source : `/${source}`
}

function mapOrder(o: Record<string, any>) {
  const shippingCost = o.shipping_cost == null ? null : Number(o.shipping_cost)
  return {
    id: Number(o.id), displayId: String(o.display_id), customerName: o.customer_name ?? null,
    customerPhone: o.customer_phone ?? null, customerEmail: o.customer_email ?? null,
    customerCity: o.customer_city ?? null, deliveryAddress: o.delivery_address ?? null,
    deliveryMethod: o.delivery_method ?? null, paymentMethod: o.payment_method ?? null,
    customerNotes: o.notes ?? null,
    items: parseItems(o.items_json), subtotal: Number(o.subtotal || 0), discountTotal: Number(o.discount_total || 0), couponCode: o.coupon_code ?? null, shippingCost,
    total: shippingCost == null ? null : Number(o.subtotal || 0) - Number(o.discount_total || 0) + shippingCost,
    currency: String(o.currency || 'COP'), status: String(o.status || 'pendiente'),
    paymentStatus: String(o.payment_status || 'pendiente'), internalNotes: o.internal_notes ?? '',
    revision: Number(o.revision || 1), createdAt: String(o.created_at || ''), updatedAt: String(o.updated_at || ''),
    carrier: o.carrier ?? null, trackingNumber: o.tracking_number ?? null, shippedAt: o.shipped_at ?? null, deliveredAt: o.delivered_at ?? null,
    shippingStatus: o.shipping_status ?? null, effectiveShippingStatus: effectiveShippingStatus(o as never), trackingUrl: o.tracking_url ?? null, shippingNotes: o.shipping_notes ?? null,
    delivery: { method: o.delivery_confirmation_method ?? null, receiver: o.delivery_receiver ?? null, notes: o.delivery_notes ?? null, reference: o.delivery_reference ?? null },
  }
}

// Public checkout: prices, product details and image snapshots are read from D1.
app.post('/', publicStore, zValidator('json', createOrderSchema), async (c) => {
  if (String(c.env.COMMERCE_ENABLED || '').toLowerCase() !== 'true') return c.json({ error: 'Order requests are not enabled' }, 503)
  const store = c.get('store')!
  if (store.status !== 'active') return c.json({ error: 'This store is not accepting orders yet', code: 'STORE_NOT_ACTIVE' }, 409)
  const storeId = store.id
  const body = c.req.valid('json')
  const db = c.env.DB
  const idempotencyKey = (c.req.header('Idempotency-Key') || '').trim()
  if (!/^[\w.-]{16,100}$/.test(idempotencyKey)) return c.json({ error: 'A valid Idempotency-Key is required' }, 400)
  const fingerprint = await digest(JSON.stringify(body))
  const previous = await db.prepare('SELECT id, store_id, display_id, request_fingerprint, subtotal, discount_total, currency, status, payment_status, items_json FROM orders WHERE idempotency_key = ?').bind(idempotencyKey).first<Record<string, any>>()
  if (previous) {
    if (Number(previous.store_id) !== storeId || previous.request_fingerprint !== fingerprint) return c.json({ error: 'This checkout key was already used for a different order' }, 409)
    return c.json({ id: Number(previous.id), displayId: String(previous.display_id), subtotal: Number(previous.subtotal), discountTotal: Number(previous.discount_total || 0), total: null, currency: String(previous.currency), status: String(previous.status), paymentStatus: String(previous.payment_status), items: parseItems(previous.items_json), replayed: true })
  }

  const rateKey = await orderRateKey(c.req.header('CF-Connecting-IP') || 'unknown')
  const blocked = await db.prepare(`SELECT 1 AS blocked FROM public_order_rate_limits WHERE rate_key = ? AND blocked_until > unixepoch('now')`).bind(rateKey).first()
  if (blocked) return c.json({ error: 'Too many order requests. Try again later.' }, 429, { 'Retry-After': '900' })
  await db.prepare(`INSERT INTO public_order_rate_limits (rate_key, window_started_at, request_count) VALUES (?, unixepoch('now'), 1)
    ON CONFLICT(rate_key) DO UPDATE SET request_count = CASE WHEN window_started_at <= unixepoch('now') - ? THEN 1 ELSE request_count + 1 END,
    window_started_at = CASE WHEN window_started_at <= unixepoch('now') - ? THEN unixepoch('now') ELSE window_started_at END,
    blocked_until = CASE WHEN window_started_at <= unixepoch('now') - ? THEN NULL WHEN request_count + 1 >= ? THEN unixepoch('now') + ? ELSE blocked_until END`)
    .bind(rateKey, ORDER_WINDOW_SECONDS, ORDER_WINDOW_SECONDS, ORDER_WINDOW_SECONDS, MAX_ORDER_REQUESTS, ORDER_WINDOW_SECONDS).run()
  const count = await db.prepare('SELECT request_count FROM public_order_rate_limits WHERE rate_key = ?').bind(rateKey).first<{ request_count: number }>()
  if ((count?.request_count ?? 0) > MAX_ORDER_REQUESTS) return c.json({ error: 'Too many order requests. Try again later.' }, 429, { 'Retry-After': '900' })

  const snapshots: SnapshotItem[] = []
  const quantities = new Map<number, number>()
  for (const item of body.items) {
    const productId = Number(item.productId), variantId = Number(item.variantId)
    if (!Number.isSafeInteger(productId) || !Number.isSafeInteger(variantId)) return c.json({ error: 'Each order item must include a valid product and variant' }, 400)
    const row = await db.prepare(`SELECT p.id product_id, p.sku product_sku, p.name product_name, p.price product_price, p.image_urls,
      v.id variant_id, v.sku variant_sku, v.size, v.color, v.image_url variant_image_url, v.price_override, v.stock
      FROM products p JOIN product_variants v ON v.product_id = p.id
      WHERE p.store_id = ? AND p.id = ? AND v.id = ? AND p.is_active = 1 AND p.is_archived = 0 AND v.is_active = 1`)
      .bind(storeId, productId, variantId).first<Record<string, any>>()
    if (!row) return c.json({ error: 'An item is no longer available' }, 409)
    const qty = (quantities.get(variantId) || 0) + item.quantity
    quantities.set(variantId, qty)
    if (qty > Number(row.stock)) return c.json({ error: 'Requested quantity exceeds available stock' }, 409)
    let images: unknown = []
    try { images = JSON.parse(String(row.image_urls || '[]')) } catch { images = [] }
    const imageUrl = Array.isArray(images) ? images.find((url) => typeof url === 'string' && url.trim()) : undefined
    const price = row.price_override == null ? Number(row.product_price) : Number(row.price_override)
    if (!Number.isSafeInteger(price) || price < 0 || !Number.isSafeInteger(price * item.quantity)) return c.json({ error: 'Catalog price is invalid for checkout' }, 409)
    snapshots.push({ productId: String(row.product_id), variantId: String(row.variant_id), sku: String(row.variant_sku || row.product_sku),
      name: String(row.product_name), price, size: row.size || undefined, color: row.color || undefined,
      imageUrl: publicImageUrl(row.variant_image_url) || publicImageUrl(imageUrl),
      quantity: item.quantity, lineSubtotal: price * item.quantity })
  }
  const subtotal = snapshots.reduce((sum, item) => sum + item.lineSubtotal, 0)
  if (!Number.isSafeInteger(subtotal)) return c.json({ error: 'Order subtotal exceeds supported limits' }, 400)
  const storeConfig = await db.prepare('SELECT currency FROM store_config WHERE id = ?').bind(storeId).first<{ currency: string }>()
  const currency = storeConfig?.currency || c.env.STORE_CURRENCY || 'COP'
  let discount = 0
  let couponCode: string | null = null
  let couponId: number | null = null
  if (body.couponCode) {
    const check = await checkCoupon(db, storeId, body.couponCode, subtotal)
    if (!check.ok) return c.json({ error: check.reason, code: 'COUPON_INVALID' }, 409)
    if (!await claimCouponUse(db, check.coupon.id)) return c.json({ error: 'Ese cupón ya alcanzó su límite de usos.', code: 'COUPON_INVALID' }, 409)
    discount = check.discount
    couponCode = check.coupon.code
    couponId = check.coupon.id
  }
  const displayId = generateDisplayId()
  let result
  try {
    result = await db.prepare(`INSERT INTO orders (store_id, display_id, customer_name, customer_phone, customer_email, customer_city,
      delivery_address, delivery_method, payment_method, items_json, subtotal, total, currency, status, payment_status,
      shipping_cost, whatsapp_sent, notes, idempotency_key, request_fingerprint, inventory_managed, coupon_code, discount_total, marketing_consent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendiente', 'pendiente', NULL, 0, ?, ?, ?, 1, ?, ?, ?)`)
      .bind(storeId, displayId, body.customerName || null, body.customerPhone || null, body.customerEmail || null, body.customerCity || null,
        body.deliveryAddress || null, body.deliveryMethod || null, body.paymentMethod || null, JSON.stringify(snapshots), subtotal,
        subtotal - discount, currency, body.notes || null, idempotencyKey, fingerprint, couponCode, discount, body.marketingConsent ? 1 : 0).run()
  } catch {
    if (couponId) await db.prepare('UPDATE coupons SET uses = uses - 1 WHERE id = ? AND uses > 0').bind(couponId).run()
    const raced = await db.prepare('SELECT id, store_id, display_id, request_fingerprint, subtotal, currency, status, payment_status, items_json FROM orders WHERE idempotency_key = ?').bind(idempotencyKey).first<Record<string, any>>()
    if (!raced) throw new Error('Could not register order')
    if (Number(raced.store_id) !== storeId || raced.request_fingerprint !== fingerprint) return c.json({ error: 'This checkout key was already used for a different order' }, 409)
    return c.json({ id: Number(raced.id), displayId: String(raced.display_id), subtotal: Number(raced.subtotal), discountTotal: 0, total: null, currency: String(raced.currency), status: String(raced.status), paymentStatus: String(raced.payment_status), items: parseItems(raced.items_json), replayed: true })
  }
  const orderId = Number(result.meta.last_row_id)
  const consentPhone = body.marketingConsent ? normalizePhone(body.customerPhone, c.env.STORE_COUNTRY || 'CO') : null
  if (consentPhone) await recordMarketingConsent(db, storeId, consentPhone, body.customerName || null).catch(() => undefined)
  // Tell the store team in Telegram without delaying the buyer's checkout.
  try { c.executionCtx.waitUntil(notifyNewOrder(c.env, db, { storeId, orderId }).catch(() => undefined)) } catch { /* no execution context in some tests */ }
  return c.json({ id: orderId, displayId, subtotal, discountTotal: discount, couponCode, total: null, currency, status: 'pendiente', paymentStatus: 'pendiente', items: snapshots, replayed: false }, 201)
})

// Public coupon preview for the cart. The order endpoint validates it again.
app.post('/coupon', publicStore, async (c) => {
  const body = await c.req.json().catch(() => null) as { code?: unknown; subtotal?: unknown } | null
  const subtotal = Number(body?.subtotal)
  if (!body || !Number.isSafeInteger(subtotal) || subtotal < 0) return c.json({ error: 'Invalid request' }, 400)
  const check = await checkCoupon(c.env.DB, c.get('store')!.id, body.code, subtotal)
  if (!check.ok) return c.json({ valid: false, message: check.reason })
  return c.json({ valid: true, code: check.coupon.code, discount: check.discount, kind: check.coupon.kind, value: check.coupon.value })
})

// Current-status counters (each order counted once).
app.get('/stats', adminAuth, async (c) => c.json(await orderStatusCounts(c.env.DB, c.get('storeId')!)))

// Protected list and details keep buyer information out of public endpoints.
app.get('/', adminAuth, async (c) => {
  const page = Math.max(1, Number(c.req.query('page') || 1))
  const pageSize = Math.min(100, Math.max(1, Number(c.req.query('pageSize') || 20)))
  const status = c.req.query('status')
  const from = c.req.query('from'), to = c.req.query('to'), query = (c.req.query('q') || '').trim().slice(0, 120)
  const conditions: string[] = ['store_id = ?'], values: unknown[] = [c.get('storeId')]
  if (status && status !== 'todos' && ALLOWED_STATUSES.includes(status as typeof ALLOWED_STATUSES[number])) { conditions.push('status = ?'); values.push(status) }
  const shipping = c.req.query('shipping')
  if (shipping && (SHIPPING_STATUSES as readonly string[]).includes(shipping)) { conditions.push('shipping_status = ?'); values.push(shipping) }
  if (from) { conditions.push("date(created_at) >= date(?)"); values.push(from) }
  if (to) { conditions.push("date(created_at) <= date(?)"); values.push(to) }
  if (query) { conditions.push("(display_id LIKE ? OR customer_name LIKE ? OR customer_phone LIKE ? OR items_json LIKE ?)"); const like = `%${query}%`; values.push(like, like, like, like) }
  const where = ` WHERE ${conditions.join(' AND ')}`
  const countRow = await c.env.DB.prepare(`SELECT COUNT(*) total FROM orders${where}`).bind(...values).first<{ total: number }>()
  const { results } = await c.env.DB.prepare(`SELECT * FROM orders${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
    .bind(...values, pageSize, (page - 1) * pageSize).all<Record<string, any>>()
  return c.json({ items: (results || []).map(mapOrder), page, pageSize, total: Number(countRow?.total || 0) })
})

app.get('/:id', adminAuth, async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isSafeInteger(id) || id < 1) return c.json({ error: 'Invalid order id' }, 400)
  const row = await c.env.DB.prepare('SELECT * FROM orders WHERE id = ? AND store_id = ?').bind(id, c.get('storeId')).first<Record<string, any>>()
  if (!row) return c.json({ error: 'Order not found' }, 404)
  const { results } = await c.env.DB.prepare('SELECT id, event_type eventType, from_value fromValue, to_value toValue, note, performed_by performedBy, created_at createdAt FROM order_events WHERE order_id = ? ORDER BY created_at DESC, id DESC').bind(id).all()
  const store = c.get('store')!
  const storeName = (await c.env.DB.prepare('SELECT name FROM stores WHERE id = ?').bind(store.id).first<{ name: string }>())?.name || ''
  return c.json({ ...mapOrder(row), events: results || [], documents: await listOrderDocuments(c.env.DB, store.id, id), customerNotice: customerNotice(row as never, storeName) })
})

app.patch('/:id', adminAuth, requireCapability('orders.manage'), async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null
  if (!Number.isSafeInteger(id) || id < 1 || !body) return c.json({ error: 'Invalid request' }, 400)
  const optionalText = (max: number) => z.string().trim().max(max).nullable().optional()
  const patchSchema = z.object({
    status: z.enum(ALLOWED_STATUSES).optional(), paymentStatus: z.enum(ALLOWED_PAYMENT_STATUSES).optional(),
    shippingStatus: z.enum(SHIPPING_STATUSES).nullable().optional(),
    internalNotes: z.string().max(4000).optional(), shippingCost: z.number().int().nonnegative().max(100000000).nullable().optional(),
    carrier: optionalText(60), trackingNumber: optionalText(80), trackingUrl: optionalText(300), shippedAt: optionalText(40), shippingNotes: optionalText(500),
    delivery: z.object({ deliveredAt: optionalText(40), method: z.enum(DELIVERY_METHODS).nullable().optional(), receiver: optionalText(120), notes: optionalText(500), reference: optionalText(120) }).strict().optional(),
    reason: optionalText(300),
    expectedRevision: z.number().int().positive(),
  }).strict()
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success || !Object.keys(parsed.data).some((key) => key !== 'expectedRevision')) return c.json({ error: 'Invalid order update' }, 400)
  const p = parsed.data
  const role = c.get('role')
  const result = await transitionOrder(c.env.DB, {
    storeId: c.get('storeId')!, orderId: id, expectedRevision: p.expectedRevision, actor: c.get('adminEmail') || 'unknown', source: 'admin',
    canRevert: role === 'owner' || role === 'admin',
    ...(p.status ? { status: p.status } : {}), ...(p.paymentStatus ? { paymentStatus: p.paymentStatus } : {}),
    ...(p.shippingStatus !== undefined ? { shippingStatus: p.shippingStatus } : {}),
    ...(p.internalNotes !== undefined ? { internalNotes: p.internalNotes } : {}),
    shipment: {
      ...(p.carrier !== undefined ? { carrier: p.carrier } : {}), ...(p.trackingNumber !== undefined ? { trackingNumber: p.trackingNumber } : {}),
      ...(p.trackingUrl !== undefined ? { trackingUrl: p.trackingUrl } : {}), ...(p.shippedAt !== undefined ? { shippedAt: p.shippedAt } : {}),
      ...(p.shippingCost !== undefined ? { shippingCost: p.shippingCost } : {}), ...(p.shippingNotes !== undefined ? { shippingNotes: p.shippingNotes } : {}),
    },
    ...(p.delivery ? { delivery: p.delivery } : {}), ...(p.reason !== undefined ? { reason: p.reason } : {}),
  })
  if (!result.ok) {
    if (result.code === 'NOTHING_TO_CHANGE') {
      const row = await c.env.DB.prepare('SELECT revision FROM orders WHERE id = ? AND store_id = ?').bind(id, c.get('storeId')).first<{ revision: number }>()
      return c.json({ success: true, id, revision: Number(row?.revision || p.expectedRevision), changed: 0 })
    }
    const status = result.code === 'NOT_FOUND' ? 404 : result.code === 'REVERT_FORBIDDEN' ? 403 : ['STALE', 'INVALID_TRANSITION', 'INSUFFICIENT_STOCK', 'SHIPPING_CONFLICT'].includes(result.code) ? 409 : 400
    return c.json({ error: result.message || TRANSITION_MESSAGES[result.code], code: result.code }, status)
  }
  return c.json({ success: true, id, revision: Number(result.order.revision), changed: result.events })
})

// Shipping-guide photos: private, only for users of the same store.
app.get('/:id/documents/:documentId', adminAuth, async (c) => {
  const id = Number(c.req.param('id')), documentId = Number(c.req.param('documentId'))
  if (!Number.isSafeInteger(id) || !Number.isSafeInteger(documentId)) return c.json({ error: 'Invalid request' }, 400)
  try { return await readOrderDocument(c.env.DB, c.env.ASSETS, c.get('storeId')!, id, documentId, c.req.query('download') === '1') }
  catch { return c.json({ error: 'Documento no encontrado' }, 404) }
})
app.post('/:id/documents', adminAuth, requireCapability('orders.manage'), async (c) => {
  const id = Number(c.req.param('id'))
  const form = await c.req.formData().catch(() => null)
  const file = form?.get('file')
  if (!Number.isSafeInteger(id) || !(file instanceof File)) return c.json({ error: 'Adjunta la foto de la guía' }, 400)
  if (file.size > ORDER_DOCUMENT_MAX_BYTES) return c.json({ error: 'La foto pesa más de 10 MB', code: 'TOO_LARGE' }, 413)
  try {
    const stored = await storeOrderDocument(c.env.DB, c.env.ASSETS, { storeId: c.get('storeId')!, orderId: id, bytes: new Uint8Array(await file.arrayBuffer()), source: 'panel', actor: c.get('adminEmail') || 'unknown' })
    return c.json({ id: stored.id, duplicate: stored.duplicate }, stored.duplicate ? 200 : 201)
  } catch (error) {
    if (error instanceof DocumentError) return c.json({ error: error.message, code: error.code }, error.code === 'NOT_FOUND' ? 404 : error.code === 'STORAGE_UNAVAILABLE' || error.code === 'STORAGE_FAILED' ? 503 : 400)
    throw error
  }
})

export default app
