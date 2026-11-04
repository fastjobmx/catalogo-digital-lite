/** Order lifecycle shared by the web panel and the Telegram assistant.
 * A storefront order starts as `pendiente` ("Recibido"): it is a purchase
 * request sent by WhatsApp, not a paid sale. Sales count from `confirmado`. */

export const ORDER_STATUSES = ['pendiente', 'confirmado', 'preparando', 'enviado', 'entregado', 'cancelado'] as const
export type OrderStatus = typeof ORDER_STATUSES[number]

export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pendiente: ['confirmado', 'cancelado'],
  confirmado: ['preparando', 'cancelado'],
  preparando: ['enviado', 'cancelado'],
  enviado: ['entregado'],
  entregado: [],
  cancelado: [],
}

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pendiente: 'Recibido', confirmado: 'Confirmado', preparando: 'En preparación',
  enviado: 'Despachado', entregado: 'Entregado', cancelado: 'Cancelado',
}

export const ORDER_STATUS_ICONS: Record<OrderStatus, string> = {
  pendiente: '📥', confirmado: '✅', preparando: '📦', enviado: '🚚', entregado: '🏁', cancelado: '✖',
}

/** Statuses that represent a confirmed sale (never a cart or a WhatsApp conversation). */
export const CONFIRMED_SALE_STATUSES: OrderStatus[] = ['confirmado', 'preparando', 'enviado', 'entregado']

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  pendiente: 'Pago pendiente', comprobante_recibido: 'Comprobante recibido', verificado: 'Pago verificado', reembolsado: 'Reembolsado',
}

export function isOrderStatus(value: string): value is OrderStatus {
  return (ORDER_STATUSES as readonly string[]).includes(value)
}

export function canTransition(from: string, to: string): boolean {
  return isOrderStatus(from) && isOrderStatus(to) && ORDER_TRANSITIONS[from].includes(to)
}

export type OrderRow = {
  id: number; display_id: string; status: OrderStatus; payment_status: string; revision: number
  subtotal: number; shipping_cost: number | null; currency: string; items_json: string
  customer_name: string | null; customer_city: string | null; delivery_method: string | null; payment_method: string | null
  carrier: string | null; tracking_number: string | null; created_at: string; inventory_managed: number
}

const ORDER_COLUMNS = `id, display_id, status, payment_status, revision, subtotal, shipping_cost, currency, items_json,
  customer_name, customer_city, delivery_method, payment_method, carrier, tracking_number, created_at, inventory_managed`

/** Finds an order of this store by id, full display id or its last characters (e.g. "AB12CD34"). */
export async function findOrder(db: D1Database, storeId: number, reference: string | number): Promise<OrderRow | null> {
  const ref = String(reference).trim().toUpperCase().replace(/^#/, '')
  if (/^\d{1,9}$/.test(ref)) {
    const byId = await db.prepare(`SELECT ${ORDER_COLUMNS} FROM orders WHERE store_id = ? AND id = ?`).bind(storeId, Number(ref)).first<OrderRow>()
    if (byId) return byId
  }
  if (!/^[A-Z0-9-]{4,40}$/.test(ref)) return null
  const rows = await db.prepare(`SELECT ${ORDER_COLUMNS} FROM orders WHERE store_id = ? AND (upper(display_id) = ? OR upper(display_id) LIKE ?) ORDER BY id DESC LIMIT 2`)
    .bind(storeId, ref, `%-${ref}`).all<OrderRow>()
  const found = rows.results || []
  return found.length === 1 ? found[0]! : found.find((row) => row.display_id.toUpperCase() === ref) || null
}

export async function listOpenOrders(db: D1Database, storeId: number, status?: OrderStatus): Promise<OrderRow[]> {
  const where = status ? 'status = ?' : "status IN ('pendiente', 'confirmado', 'preparando', 'enviado')"
  const result = await db.prepare(`SELECT ${ORDER_COLUMNS} FROM orders WHERE store_id = ? AND ${where} ORDER BY id DESC LIMIT 10`)
    .bind(...[storeId, ...(status ? [status] : [])]).all<OrderRow>()
  return result.results || []
}

export type TransitionInput = {
  storeId: number; orderId: number; expectedRevision: number; actor: string; source: 'telegram' | 'admin'
  status?: OrderStatus; paymentStatus?: 'pendiente' | 'comprobante_recibido' | 'verificado' | 'reembolsado'
  carrier?: string | null; trackingNumber?: string | null; note?: string | null
}
export type TransitionResult =
  | { ok: true; order: OrderRow; lowStock: Array<{ sku: string; stock: number }> }
  | { ok: false; code: 'NOT_FOUND' | 'STALE' | 'INVALID_TRANSITION' | 'INSUFFICIENT_STOCK' | 'NOTHING_TO_CHANGE' }

export const LOW_STOCK_THRESHOLD = 3

/** Applies one validated change atomically: status/payment, delivery data, history and audit.
 * The revision check rejects stale buttons and concurrent edits. Stock reservation and
 * release happen in the existing database triggers when the status changes. */
export async function transitionOrder(db: D1Database, input: TransitionInput): Promise<TransitionResult> {
  const current = await db.prepare(`SELECT ${ORDER_COLUMNS} FROM orders WHERE id = ? AND store_id = ?`).bind(input.orderId, input.storeId).first<OrderRow>()
  if (!current) return { ok: false, code: 'NOT_FOUND' }
  if (Number(current.revision) !== input.expectedRevision) return { ok: false, code: 'STALE' }
  if (input.status && input.status !== current.status && !canTransition(current.status, input.status)) return { ok: false, code: 'INVALID_TRANSITION' }

  const updates: string[] = []
  const values: unknown[] = []
  const events: Array<{ type: string; from: string | null; to: string | null; note?: string | null }> = []
  if (input.status && input.status !== current.status) {
    updates.push('status = ?'); values.push(input.status)
    events.push({ type: 'status', from: current.status, to: input.status, note: input.note || null })
    if (input.status === 'enviado') updates.push("shipped_at = datetime('now')")
    if (input.status === 'entregado') updates.push("delivered_at = datetime('now')")
  }
  if (input.paymentStatus && input.paymentStatus !== current.payment_status) {
    updates.push('payment_status = ?'); values.push(input.paymentStatus)
    events.push({ type: 'payment_status', from: current.payment_status, to: input.paymentStatus })
  }
  const carrier = input.carrier?.trim().slice(0, 60) || null
  const tracking = input.trackingNumber?.trim().slice(0, 80) || null
  if (carrier && carrier !== current.carrier) { updates.push('carrier = ?'); values.push(carrier); events.push({ type: 'carrier', from: current.carrier, to: carrier }) }
  if (tracking && tracking !== current.tracking_number) { updates.push('tracking_number = ?'); values.push(tracking); events.push({ type: 'tracking_number', from: current.tracking_number, to: tracking }) }
  if (!updates.length) return { ok: false, code: 'NOTHING_TO_CHANGE' }

  updates.push('revision = revision + 1', "updated_at = datetime('now')")
  const statements: D1PreparedStatement[] = [
    db.prepare(`UPDATE orders SET ${updates.join(', ')} WHERE id = ? AND store_id = ? AND revision = ?`).bind(...values, input.orderId, input.storeId, input.expectedRevision),
  ]
  // History and audit only exist if the guarded update above changed the row.
  const gate = 'EXISTS (SELECT 1 FROM orders WHERE id = ? AND store_id = ? AND revision = ?)'
  for (const event of events) {
    statements.push(db.prepare(`INSERT INTO order_events (order_id, event_type, from_value, to_value, note, performed_by) SELECT ?, ?, ?, ?, ?, ? WHERE ${gate}`)
      .bind(input.orderId, event.type, event.from, event.to, event.note ?? null, input.actor, input.orderId, input.storeId, input.expectedRevision + 1))
  }
  statements.push(db.prepare(`INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id) SELECT 'order_updated', 'order', ?, ?, ?, ?, ? WHERE ${gate}`)
    .bind(String(input.orderId), JSON.stringify(events.map(({ type, from, to }) => ({ type, from, to }))), input.actor, input.source, input.storeId, input.orderId, input.storeId, input.expectedRevision + 1))

  let results: D1Result[]
  try { results = await db.batch(statements) }
  catch (error) {
    if (/insufficient order inventory|negative stock/i.test(String(error))) return { ok: false, code: 'INSUFFICIENT_STOCK' }
    throw error
  }
  if (!Number(results[0]?.meta.changes || 0)) return { ok: false, code: 'STALE' }
  const order = (await db.prepare(`SELECT ${ORDER_COLUMNS} FROM orders WHERE id = ?`).bind(input.orderId).first<OrderRow>())!
  let lowStock: Array<{ sku: string; stock: number }> = []
  if (input.status === 'confirmado') {
    const variantIds = parseOrderItems(order.items_json).map((item) => Number(item.variantId)).filter(Number.isSafeInteger)
    if (variantIds.length) {
      const rows = await db.prepare(`SELECT v.sku, v.stock FROM product_variants v JOIN products p ON p.id = v.product_id
        WHERE p.store_id = ? AND v.id IN (${variantIds.map(() => '?').join(', ')}) AND v.stock <= ? ORDER BY v.stock, v.sku`)
        .bind(input.storeId, ...variantIds, LOW_STOCK_THRESHOLD).all<{ sku: string; stock: number }>()
      lowStock = rows.results || []
    }
  }
  return { ok: true, order, lowStock }
}

export type OrderItem = { variantId: string; sku: string; name: string; price: number; size?: string; color?: string; quantity: number; lineSubtotal: number }
export function parseOrderItems(value: unknown): OrderItem[] {
  try {
    const parsed = JSON.parse(String(value || '[]'))
    return Array.isArray(parsed) ? parsed as OrderItem[] : []
  } catch { return [] }
}

/** Telegram accounts that may operate this store's orders (active memberships plus the legacy owner of store 1). */
export async function orderRecipients(db: D1Database, storeId: number, legacyOwnerIds: string[]): Promise<string[]> {
  const rows = await db.prepare(
    `SELECT DISTINCT u.telegram_user_id AS id FROM store_memberships m JOIN platform_users u ON u.id = m.user_id
     WHERE m.store_id = ? AND m.status = 'active' AND u.status = 'active' AND u.telegram_user_id IS NOT NULL`,
  ).bind(storeId).all<{ id: string }>()
  const ids = new Set((rows.results || []).map((row) => String(row.id)))
  if (storeId === 1) for (const id of legacyOwnerIds) if (/^\d{4,15}$/.test(id)) ids.add(id)
  return [...ids]
}
