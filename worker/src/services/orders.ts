/** Order lifecycle shared by the web panel and the Telegram assistant.
 * A storefront order starts as `pendiente`: it is a purchase request sent by WhatsApp, not a paid
 * sale. Sales count from `confirmado`. Internal identifiers are the historical Spanish ones
 * (pendiente, confirmado, preparando, enviado, entregado, cancelado); `enviado` means
 * "Entregado a transportadora". Payment and shipping are tracked independently of the order status. */

export const ORDER_STATUSES = ['pendiente', 'confirmado', 'preparando', 'enviado', 'entregado', 'cancelado'] as const
export type OrderStatus = typeof ORDER_STATUSES[number]

/** Forward transitions. Confirmed or prepared orders delivered in person or picked up go straight to
 * `entregado` (no carrier required). */
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pendiente: ['confirmado', 'cancelado'],
  confirmado: ['preparando', 'enviado', 'entregado', 'cancelado'],
  preparando: ['enviado', 'entregado', 'cancelado'],
  enviado: ['entregado'],
  entregado: [],
  cancelado: [],
}

/** Going back (a mistake or a returned parcel): owner/admin only, with a recorded reason. They never
 * touch the stock reservation (made on confirmation and released only on cancellation). */
export const ORDER_REVERSIONS: Record<OrderStatus, OrderStatus[]> = {
  pendiente: [], confirmado: [], preparando: ['confirmado'], enviado: ['preparando'], entregado: ['enviado', 'preparando'], cancelado: [],
}

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pendiente: 'Pendiente', confirmado: 'Confirmado', preparando: 'En preparación',
  enviado: 'Entregado a transportadora', entregado: 'Entregado', cancelado: 'Cancelado',
}

/** Equivalent English identifiers (documentation and exports). */
export const ORDER_STATUS_CODES: Record<OrderStatus, string> = {
  pendiente: 'pending', confirmado: 'confirmed', preparando: 'preparing', enviado: 'handed_to_carrier', entregado: 'delivered', cancelado: 'cancelled',
}

export const ORDER_STATUS_ICONS: Record<OrderStatus, string> = {
  pendiente: '📥', confirmado: '✅', preparando: '📦', enviado: '🚚', entregado: '🏁', cancelado: '✖',
}

/** Statuses that represent a confirmed sale (never a cart or a WhatsApp conversation). */
export const CONFIRMED_SALE_STATUSES: OrderStatus[] = ['confirmado', 'preparando', 'enviado', 'entregado']

export const PAYMENT_STATUSES = ['pendiente', 'comprobante_recibido', 'verificado', 'reembolsado'] as const
export type PaymentStatus = typeof PAYMENT_STATUSES[number]
export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  pendiente: 'Pago pendiente', comprobante_recibido: 'Comprobante recibido', verificado: 'Pago verificado', reembolsado: 'Reembolsado',
}

export const SHIPPING_STATUSES = ['por_cotizar', 'por_despachar', 'preparando_envio', 'en_transportadora', 'en_transito', 'entregado_cliente', 'incidencia', 'no_aplica'] as const
export type ShippingStatus = typeof SHIPPING_STATUSES[number]
export const SHIPPING_STATUS_LABELS: Record<ShippingStatus, string> = {
  por_cotizar: 'Pendiente de cotización', por_despachar: 'Pendiente de despacho', preparando_envio: 'Preparando envío',
  en_transportadora: 'Entregado a transportadora', en_transito: 'En tránsito', entregado_cliente: 'Entregado al cliente',
  incidencia: 'Incidencia de entrega', no_aplica: 'Sin envío (entrega personal o retiro)',
}

/** Shipping states that make sense for each order status: contradictions are rejected. */
const SHIPPING_FOR_STATUS: Record<OrderStatus, ShippingStatus[]> = {
  pendiente: ['por_cotizar', 'por_despachar', 'no_aplica'],
  confirmado: ['por_cotizar', 'por_despachar', 'preparando_envio', 'no_aplica'],
  preparando: ['por_cotizar', 'por_despachar', 'preparando_envio', 'no_aplica'],
  enviado: ['en_transportadora', 'en_transito', 'incidencia'],
  entregado: ['entregado_cliente', 'no_aplica'],
  cancelado: [],
}

export const DELIVERY_METHODS = ['transportadora', 'entrega_personal', 'retiro_en_tienda', 'mensajero', 'otro'] as const
export type DeliveryMethod = typeof DELIVERY_METHODS[number]
export const DELIVERY_METHOD_LABELS: Record<DeliveryMethod, string> = {
  transportadora: 'Transportadora', entrega_personal: 'Entrega personal', retiro_en_tienda: 'Retiro en tienda', mensajero: 'Mensajero', otro: 'Otro',
}

export function isOrderStatus(value: string): value is OrderStatus {
  return (ORDER_STATUSES as readonly string[]).includes(value)
}
export function isShippingStatus(value: unknown): value is ShippingStatus {
  return typeof value === 'string' && (SHIPPING_STATUSES as readonly string[]).includes(value)
}

export function canTransition(from: string, to: string): boolean {
  return isOrderStatus(from) && isOrderStatus(to) && ORDER_TRANSITIONS[from].includes(to)
}
export function isReversion(from: string, to: string): boolean {
  return isOrderStatus(from) && isOrderStatus(to) && ORDER_REVERSIONS[from].includes(to)
}

/** Shipping state shown when none was recorded explicitly (old orders and new ones alike). */
export function effectiveShippingStatus(order: { status: string; shipping_status?: string | null; shipping_cost?: number | null }): ShippingStatus | null {
  if (isShippingStatus(order.shipping_status)) return order.shipping_status
  switch (order.status) {
    case 'pendiente':
    case 'confirmado': return order.shipping_cost == null ? 'por_cotizar' : 'por_despachar'
    case 'preparando': return 'preparando_envio'
    case 'enviado': return 'en_transportadora'
    case 'entregado': return 'entregado_cliente'
    default: return null
  }
}

export type OrderRow = {
  id: number; display_id: string; status: OrderStatus; payment_status: string; revision: number
  subtotal: number; shipping_cost: number | null; currency: string; items_json: string
  customer_name: string | null; customer_city: string | null; delivery_method: string | null; payment_method: string | null
  carrier: string | null; tracking_number: string | null; created_at: string; inventory_managed: number
  shipping_status: string | null; shipped_at: string | null; delivered_at: string | null; tracking_url: string | null
}

const ORDER_COLUMNS = `id, display_id, status, payment_status, revision, subtotal, shipping_cost, currency, items_json,
  customer_name, customer_city, delivery_method, payment_method, carrier, tracking_number, created_at, inventory_managed,
  shipping_status, shipped_at, delivered_at, tracking_url`

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

export type OrderView = 'por_enviar' | 'en_transportadora' | 'en_transito' | 'despachados_hoy' | 'incidencias'
/** Logistic lists for the assistant: "pendientes de enviar", "en tránsito", "entregados a transportadora hoy". */
export async function listOrdersByView(db: D1Database, storeId: number, view: OrderView): Promise<OrderRow[]> {
  const where: Record<OrderView, string> = {
    por_enviar: "status IN ('confirmado', 'preparando')",
    en_transportadora: "status = 'enviado' AND COALESCE(shipping_status, 'en_transportadora') = 'en_transportadora'",
    en_transito: "status = 'enviado' AND shipping_status = 'en_transito'",
    despachados_hoy: "status IN ('enviado', 'entregado') AND date(shipped_at) = date('now')",
    incidencias: "status = 'enviado' AND shipping_status = 'incidencia'",
  }
  const result = await db.prepare(`SELECT ${ORDER_COLUMNS} FROM orders WHERE store_id = ? AND ${where[view]} ORDER BY id DESC LIMIT 15`).bind(storeId).all<OrderRow>()
  return result.results || []
}

/** Current-status counters: each order counts once (the shipped ones are split by transit). */
export async function orderStatusCounts(db: D1Database, storeId: number): Promise<Record<string, number>> {
  const row = await db.prepare(
    `SELECT SUM(status = 'pendiente') AS pendiente, SUM(status = 'confirmado') AS confirmado, SUM(status = 'preparando') AS preparando,
            SUM(status = 'enviado' AND COALESCE(shipping_status, '') NOT IN ('en_transito', 'incidencia')) AS entregado_transportadora,
            SUM(status = 'enviado' AND shipping_status = 'en_transito') AS en_transito,
            SUM(status = 'enviado' AND shipping_status = 'incidencia') AS incidencia,
            SUM(status = 'entregado') AS entregado, SUM(status = 'cancelado') AS cancelado, COUNT(*) AS total
     FROM orders WHERE store_id = ?`,
  ).bind(storeId).first<Record<string, number | null>>()
  return Object.fromEntries(Object.entries(row || {}).map(([key, value]) => [key, Number(value || 0)]))
}

export type ShipmentInput = {
  carrier?: string | null; trackingNumber?: string | null; trackingUrl?: string | null
  shippedAt?: string | null; shippingCost?: number | null; shippingNotes?: string | null
}
export type DeliveryInput = { deliveredAt?: string | null; method?: DeliveryMethod | null; receiver?: string | null; notes?: string | null; reference?: string | null }

export type TransitionInput = {
  storeId: number; orderId: number; expectedRevision: number; actor: string; source: 'telegram' | 'admin'
  /** Role of the actor: reversions need owner or admin. */
  canRevert?: boolean
  status?: OrderStatus; paymentStatus?: PaymentStatus; shippingStatus?: ShippingStatus | null
  carrier?: string | null; trackingNumber?: string | null; note?: string | null
  shipment?: ShipmentInput; delivery?: DeliveryInput; internalNotes?: string; reason?: string | null
}
export type TransitionCode = 'NOT_FOUND' | 'STALE' | 'INVALID_TRANSITION' | 'INSUFFICIENT_STOCK' | 'NOTHING_TO_CHANGE'
  | 'REVERT_FORBIDDEN' | 'REASON_REQUIRED' | 'CARRIER_REQUIRED' | 'DELIVERY_METHOD_REQUIRED' | 'SHIPPING_CONFLICT' | 'INVALID_DATA'
export type TransitionResult =
  | { ok: true; order: OrderRow; lowStock: Array<{ sku: string; stock: number }>; events: number }
  | { ok: false; code: TransitionCode; message?: string }

export const TRANSITION_MESSAGES: Record<TransitionCode, string> = {
  NOT_FOUND: 'El pedido no existe en esta tienda.',
  STALE: 'Otra persona actualizó este pedido. Recárgalo y vuelve a intentarlo.',
  INVALID_TRANSITION: 'Ese cambio de estado no es válido para el estado actual del pedido.',
  INSUFFICIENT_STOCK: 'No hay existencias suficientes para confirmar este pedido. Revisa el inventario de esas tallas.',
  NOTHING_TO_CHANGE: 'No hay cambios para guardar.',
  REVERT_FORBIDDEN: 'Volver a un estado anterior requiere un rol de propietario o administrador.',
  REASON_REQUIRED: 'Para volver a un estado anterior escribe el motivo; queda en el historial.',
  CARRIER_REQUIRED: 'Indica la transportadora para marcarlo como entregado a transportadora.',
  DELIVERY_METHOD_REQUIRED: 'Indica cómo se entregó el pedido (transportadora, entrega personal, retiro en tienda…).',
  SHIPPING_CONFLICT: 'El estado del envío no corresponde con el estado del pedido.',
  INVALID_DATA: 'Revisa los datos de envío o de entrega.',
}

export const LOW_STOCK_THRESHOLD = 3

const text = (value: string | null | undefined, max: number) => (typeof value === 'string' && value.trim() ? value.trim().replace(/\s+/g, ' ').slice(0, max) : null)
/** "2026-11-05" or an ISO date-time → SQLite datetime text; null when absent; undefined when invalid. */
function sqlDate(value: string | null | undefined): string | null | undefined {
  if (value == null || value === '') return null
  const parsed = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00Z` : value)
  if (!Number.isFinite(parsed) || parsed > Date.now() + 86_400_000 || parsed < Date.UTC(2020, 0, 1)) return undefined
  return new Date(parsed).toISOString().replace('T', ' ').slice(0, 19)
}

/** Applies one validated change atomically: status, payment, shipping and delivery data, history and
 * audit. The revision check rejects stale buttons and concurrent edits. Stock reservation and release
 * happen in the existing database triggers when the status changes. */
export async function transitionOrder(db: D1Database, input: TransitionInput): Promise<TransitionResult> {
  const current = await db.prepare(`SELECT ${ORDER_COLUMNS}, internal_notes, shipping_notes, delivery_confirmation_method, delivery_receiver, delivery_notes, delivery_reference
    FROM orders WHERE id = ? AND store_id = ?`).bind(input.orderId, input.storeId).first<OrderRow & Record<string, any>>()
  if (!current) return { ok: false, code: 'NOT_FOUND' }
  if (Number(current.revision) !== input.expectedRevision) return { ok: false, code: 'STALE' }
  const target = input.status && input.status !== current.status ? input.status : null
  const reverting = Boolean(target && isReversion(current.status, target))
  if (target && !canTransition(current.status, target) && !reverting) return { ok: false, code: 'INVALID_TRANSITION' }
  if (reverting && !input.canRevert) return { ok: false, code: 'REVERT_FORBIDDEN' }
  const reason = text(input.reason, 300)
  if (reverting && !reason) return { ok: false, code: 'REASON_REQUIRED' }
  const finalStatus = (target || current.status) as OrderStatus

  const updates: string[] = []
  const values: unknown[] = []
  const events: Array<{ type: string; from: string | null; to: string | null; note?: string | null }> = []
  const set = (column: string, value: unknown, event?: { type: string; from: unknown; to: unknown }) => {
    updates.push(`${column} = ?`); values.push(value)
    if (event) events.push({ type: event.type, from: event.from == null ? null : String(event.from), to: event.to == null ? null : String(event.to) })
  }

  // Shipment data (carrier, guide, date, cost, tracking URL). A guide number is never generated.
  const shipment = { ...(input.shipment || {}) }
  if (input.carrier !== undefined) shipment.carrier = input.carrier
  if (input.trackingNumber !== undefined) shipment.trackingNumber = input.trackingNumber
  const carrier = shipment.carrier === undefined ? undefined : text(shipment.carrier, 60)
  const tracking = shipment.trackingNumber === undefined ? undefined : text(shipment.trackingNumber, 80)?.toUpperCase() ?? null
  const trackingUrl = shipment.trackingUrl === undefined ? undefined : text(shipment.trackingUrl, 300)
  if (trackingUrl && !/^https:\/\/[^\s]+$/i.test(trackingUrl)) return { ok: false, code: 'INVALID_DATA', message: 'La URL de seguimiento debe empezar por https://.' }
  const shippedAt = shipment.shippedAt === undefined ? undefined : sqlDate(shipment.shippedAt)
  if (shippedAt === undefined && shipment.shippedAt !== undefined) return { ok: false, code: 'INVALID_DATA', message: 'La fecha de entrega a la transportadora no es válida.' }
  if (shipment.shippingCost !== undefined && shipment.shippingCost !== null && (!Number.isSafeInteger(shipment.shippingCost) || shipment.shippingCost < 0 || shipment.shippingCost > 100_000_000)) {
    return { ok: false, code: 'INVALID_DATA', message: 'El costo del envío debe ser un valor entero sin decimales.' }
  }
  const finalCarrier = carrier === undefined ? current.carrier : carrier
  if (finalStatus === 'enviado' && target === 'enviado' && !finalCarrier) return { ok: false, code: 'CARRIER_REQUIRED' }

  // Delivery confirmation (no carrier needed for personal delivery or pickup). Payment is not touched.
  const delivery = input.delivery || {}
  const method = delivery.method === undefined ? undefined : delivery.method
  if (method !== undefined && method !== null && !(DELIVERY_METHODS as readonly string[]).includes(method)) return { ok: false, code: 'INVALID_DATA', message: 'Método de entrega no válido.' }
  const deliveredAt = delivery.deliveredAt === undefined ? undefined : sqlDate(delivery.deliveredAt)
  if (deliveredAt === undefined && delivery.deliveredAt !== undefined) return { ok: false, code: 'INVALID_DATA', message: 'La fecha de entrega no es válida.' }
  if (target === 'entregado' && !(method || current.delivery_confirmation_method)) return { ok: false, code: 'DELIVERY_METHOD_REQUIRED' }

  // Shipping status: explicit value validated against the order status, or derived on status changes.
  let shippingStatus: ShippingStatus | null | undefined = input.shippingStatus
  if (target === 'enviado' && (shippingStatus === undefined || shippingStatus === null)) shippingStatus = 'en_transportadora'
  if (target === 'entregado' && shippingStatus === undefined) shippingStatus = (method || current.delivery_confirmation_method) === 'retiro_en_tienda' ? 'no_aplica' : 'entregado_cliente'
  if (target && ['pendiente', 'confirmado', 'preparando'].includes(target) && shippingStatus === undefined && current.shipping_status) shippingStatus = null
  if (target === 'cancelado' && shippingStatus === undefined && current.shipping_status) shippingStatus = null
  if (shippingStatus !== undefined && shippingStatus !== null && !SHIPPING_FOR_STATUS[finalStatus].includes(shippingStatus)) {
    return { ok: false, code: 'SHIPPING_CONFLICT', message: `“${SHIPPING_STATUS_LABELS[shippingStatus]}” no corresponde a un pedido “${ORDER_STATUS_LABELS[finalStatus]}”.` }
  }

  if (target) {
    set('status', target)
    events.push({ type: reverting ? 'status_revert' : 'status', from: current.status, to: target, note: reverting ? reason : text(input.note, 300) })
    if (target === 'enviado' && shippedAt === undefined && !current.shipped_at) updates.push("shipped_at = datetime('now')")
    if (target === 'entregado' && deliveredAt === undefined) updates.push("delivered_at = datetime('now')")
    if (reverting && current.status === 'entregado') { updates.push('delivered_at = NULL') }
  }
  if (shippingStatus !== undefined && shippingStatus !== (current.shipping_status ?? null)) set('shipping_status', shippingStatus, { type: 'shipping_status', from: current.shipping_status, to: shippingStatus })
  if (input.paymentStatus && input.paymentStatus !== current.payment_status) set('payment_status', input.paymentStatus, { type: 'payment_status', from: current.payment_status, to: input.paymentStatus })
  if (carrier !== undefined && carrier !== (current.carrier ?? null)) set('carrier', carrier, { type: 'carrier', from: current.carrier, to: carrier })
  if (tracking !== undefined && tracking !== (current.tracking_number ?? null)) set('tracking_number', tracking, { type: 'tracking_number', from: current.tracking_number, to: tracking })
  if (trackingUrl !== undefined && trackingUrl !== (current.tracking_url ?? null)) set('tracking_url', trackingUrl, { type: 'tracking_url', from: current.tracking_url ? 'registrada' : null, to: trackingUrl ? 'registrada' : null })
  if (shippedAt !== undefined && shippedAt !== (current.shipped_at ?? null)) set('shipped_at', shippedAt, { type: 'shipped_at', from: current.shipped_at, to: shippedAt })
  if (shipment.shippingCost !== undefined && shipment.shippingCost !== current.shipping_cost) set('shipping_cost', shipment.shippingCost, { type: 'shipping_cost', from: current.shipping_cost, to: shipment.shippingCost })
  const shippingNotes = shipment.shippingNotes === undefined ? undefined : text(shipment.shippingNotes, 500)
  if (shippingNotes !== undefined && shippingNotes !== (current.shipping_notes ?? null)) set('shipping_notes', shippingNotes, { type: 'shipping_notes', from: null, to: 'actualizadas' })
  if (method !== undefined && method !== (current.delivery_confirmation_method ?? null)) set('delivery_confirmation_method', method, { type: 'delivery_method', from: current.delivery_confirmation_method, to: method })
  if (deliveredAt !== undefined && deliveredAt !== (current.delivered_at ?? null)) set('delivered_at', deliveredAt, { type: 'delivered_at', from: current.delivered_at, to: deliveredAt })
  for (const [field, column, max] of [['receiver', 'delivery_receiver', 120], ['notes', 'delivery_notes', 500], ['reference', 'delivery_reference', 120]] as const) {
    const value = delivery[field] === undefined ? undefined : text(delivery[field], max)
    if (value !== undefined && value !== (current[column] ?? null)) set(column, value, { type: column, from: null, to: value ? 'registrado' : null })
  }
  if (input.internalNotes !== undefined && input.internalNotes !== (current.internal_notes ?? '')) set('internal_notes', input.internalNotes.slice(0, 4000), { type: 'internal_note', from: null, to: 'actualizadas' })
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
  if (target === 'confirmado') {
    const variantIds = parseOrderItems(order.items_json).map((item) => Number(item.variantId)).filter(Number.isSafeInteger)
    if (variantIds.length) {
      const rows = await db.prepare(`SELECT v.sku, v.stock FROM product_variants v JOIN products p ON p.id = v.product_id
        WHERE p.store_id = ? AND v.id IN (${variantIds.map(() => '?').join(', ')}) AND v.stock <= ? ORDER BY v.stock, v.sku`)
        .bind(input.storeId, ...variantIds, LOW_STOCK_THRESHOLD).all<{ sku: string; stock: number }>()
      lowStock = rows.results || []
    }
  }
  return { ok: true, order, lowStock, events: events.length }
}

/** Message the merchant can send to the buyer through a channel they already use (never sent
 * automatically). It never claims the parcel reached the buyer when it was only handed to the carrier. */
export function customerNotice(order: { display_id: string; status: string; carrier?: string | null; tracking_number?: string | null; tracking_url?: string | null; customer_name?: string | null }, storeName: string): string | null {
  const hello = `Hola${order.customer_name ? ` ${order.customer_name.split(' ')[0]}` : ''}, te escribimos de ${storeName}.`
  if (order.status === 'enviado') {
    return [`${hello} Tu pedido ${order.display_id} fue entregado a la transportadora${order.carrier ? ` ${order.carrier}` : ''}.`,
      order.tracking_number ? `Número de guía: ${order.tracking_number}.` : null,
      order.tracking_url ? `Puedes consultarlo en: ${order.tracking_url}` : null].filter(Boolean).join(' ')
  }
  if (order.status === 'entregado') return `${hello} Registramos tu pedido ${order.display_id} como entregado. ¡Gracias por tu compra!`
  if (order.status === 'confirmado') return `${hello} Confirmamos tu pedido ${order.display_id}. Te avisaremos cuando lo despachemos.`
  if (order.status === 'preparando') return `${hello} Estamos preparando tu pedido ${order.display_id}.`
  return null
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
