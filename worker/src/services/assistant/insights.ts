/** Commercial indicators computed only from real records of one store.
 * A sale is an order from `confirmado` on; carts and WhatsApp requests never count,
 * and nothing is extrapolated when data is missing. */
import { CONFIRMED_SALE_STATUSES } from '../orders'
import { escapeHtml, formatMoney } from './tools'

export type InsightResult = { text: string; data?: Record<string, unknown> }

const SALE_STATUSES_SQL = CONFIRMED_SALE_STATUSES.map((status) => `'${status}'`).join(', ')
const clampDays = (days: unknown, fallback: number) => Math.min(365, Math.max(1, Number.isSafeInteger(days) ? Number(days) : fallback))

/** Confirmed sales grouped by day, ISO week or month. */
export async function salesByPeriodTool(db: D1Database, storeId: number, currency: string, daysInput?: unknown, granularityInput?: unknown): Promise<InsightResult> {
  const days = clampDays(daysInput, 30)
  const granularity = granularityInput === 'dia' || granularityInput === 'mes' ? granularityInput : 'semana'
  const bucket = granularity === 'dia' ? "date(created_at)" : granularity === 'mes' ? "strftime('%Y-%m', created_at)" : "strftime('%Y-S%W', created_at)"
  const rows = (await db.prepare(
    `SELECT ${bucket} AS period, COUNT(*) AS orders, COALESCE(SUM(subtotal - discount_total), 0) AS amount FROM orders
     WHERE store_id = ? AND status IN (${SALE_STATUSES_SQL}) AND created_at >= datetime('now', ?)
     GROUP BY period ORDER BY period`,
  ).bind(storeId, `-${days} days`).all<{ period: string; orders: number; amount: number }>()).results || []
  if (!rows.length) return { text: `No hay ventas confirmadas en los últimos ${days} días. Los pedidos recibidos sin confirmar no cuentan como ventas.`, data: { periods: [] } }
  const total = rows.reduce((sum, row) => sum + Number(row.amount), 0)
  const orders = rows.reduce((sum, row) => sum + Number(row.orders), 0)
  const label = granularity === 'dia' ? 'día' : granularity
  return {
    text: `📅 <b>Ventas confirmadas por ${label} · últimos ${days} días</b>\n${rows.map((row) => `• ${escapeHtml(row.period)}: ${row.orders} pedido(s) · ${formatMoney(Number(row.amount), currency)}`).join('\n')}\n\nTotal: <b>${orders}</b> pedidos · <b>${formatMoney(total, currency)}</b> (subtotal de productos, sin envío).`,
    data: { periods: rows, total, orders },
  }
}

/** Active products with stock and no confirmed sale in the window (new products are excluded). */
export async function slowMoversTool(db: D1Database, storeId: number, currency: string, daysInput?: unknown): Promise<InsightResult> {
  const days = clampDays(daysInput, 60)
  const rows = (await db.prepare(
    `SELECT p.sku, p.name, p.price, COALESCE((SELECT SUM(v.stock) FROM product_variants v WHERE v.product_id = p.id AND v.is_active = 1), 0) AS stock
     FROM products p
     WHERE p.store_id = ? AND p.is_active = 1 AND p.is_archived = 0 AND p.created_at <= datetime('now', ?)
       AND COALESCE((SELECT SUM(v.stock) FROM product_variants v WHERE v.product_id = p.id AND v.is_active = 1), 0) > 0
       AND NOT EXISTS (
         SELECT 1 FROM orders o, json_each(o.items_json) item
         WHERE o.store_id = p.store_id AND o.status IN (${SALE_STATUSES_SQL}) AND o.created_at >= datetime('now', ?)
           AND CAST(json_extract(item.value, '$.productId') AS INTEGER) = p.id)
     ORDER BY stock DESC, p.name LIMIT 15`,
  ).bind(storeId, `-${days} days`, `-${days} days`).all<{ sku: string; name: string; price: number; stock: number }>()).results || []
  if (!rows.length) return { text: `✅ Todos tus productos con existencias tuvieron al menos una venta confirmada en los últimos ${days} días (o son nuevos).`, data: { products: [] } }
  return {
    text: `🐢 <b>Productos sin ventas confirmadas · últimos ${days} días</b>\n${rows.map((row) => `• <b>${escapeHtml(row.sku)}</b> ${escapeHtml(row.name)} · ${row.stock} u. · ${formatMoney(row.price, currency)}`).join('\n')}\n\nIdeas: destácalos, revisa fotos y descripción o crea un cupón para ellos.`,
    data: { products: rows },
  }
}

/** Units sold per size in confirmed orders. */
export async function sizeRotationTool(db: D1Database, storeId: number, daysInput?: unknown): Promise<InsightResult> {
  const days = clampDays(daysInput, 60)
  const rows = (await db.prepare(
    `SELECT COALESCE(json_extract(item.value, '$.size'), 'Única') AS size, SUM(CAST(json_extract(item.value, '$.quantity') AS INTEGER)) AS units
     FROM orders o, json_each(o.items_json) item
     WHERE o.store_id = ? AND o.status IN (${SALE_STATUSES_SQL}) AND o.created_at >= datetime('now', ?)
     GROUP BY size ORDER BY units DESC LIMIT 15`,
  ).bind(storeId, `-${days} days`).all<{ size: string; units: number }>()).results || []
  if (!rows.length) return { text: `No hay ventas confirmadas en los últimos ${days} días para calcular la rotación por talla.`, data: { sizes: [] } }
  return { text: `📏 <b>Rotación por talla · últimos ${days} días</b>\n${rows.map((row) => `• ${escapeHtml(row.size)}: ${row.units} u.`).join('\n')}`, data: { sizes: rows } }
}

const maskPhone = (phone: string) => `•••${phone.slice(-4)}`

/** Customers with two or more confirmed orders (same phone). Contact data stays masked. */
export async function repeatCustomersTool(db: D1Database, storeId: number, currency: string, daysInput?: unknown): Promise<InsightResult> {
  const days = clampDays(daysInput, 180)
  const rows = (await db.prepare(
    `SELECT phone, MIN(name) AS name, COUNT(*) AS orders, SUM(subtotal) AS amount FROM (
       SELECT replace(replace(replace(replace(COALESCE(customer_phone, ''), ' ', ''), '-', ''), '+', ''), '(', '') AS phone, customer_name AS name, subtotal - discount_total AS subtotal
       FROM orders WHERE store_id = ? AND status IN (${SALE_STATUSES_SQL}) AND created_at >= datetime('now', ?)
     ) WHERE length(phone) >= 7 GROUP BY phone HAVING COUNT(*) >= 2 ORDER BY orders DESC, amount DESC LIMIT 10`,
  ).bind(storeId, `-${days} days`).all<{ phone: string; name: string | null; orders: number; amount: number }>()).results || []
  const buyers = await db.prepare(
    `SELECT COUNT(DISTINCT replace(replace(replace(COALESCE(customer_phone, ''), ' ', ''), '-', ''), '+', '')) AS n FROM orders
     WHERE store_id = ? AND status IN (${SALE_STATUSES_SQL}) AND created_at >= datetime('now', ?) AND length(COALESCE(customer_phone, '')) >= 7`,
  ).bind(storeId, `-${days} days`).first<{ n: number }>()
  const totalBuyers = Number(buyers?.n || 0)
  if (totalBuyers < 5) return { text: `Todavía no hay datos suficientes para hablar de clientes recurrentes: ${totalBuyers} comprador(es) con pedidos confirmados en ${days} días.`, data: { buyers: totalBuyers, repeat: [] } }
  if (!rows.length) return { text: `De ${totalBuyers} compradores con pedidos confirmados en ${days} días, ninguno ha comprado dos veces todavía.`, data: { buyers: totalBuyers, repeat: [] } }
  return {
    text: `🔁 <b>Clientes recurrentes · últimos ${days} días</b>\n${rows.length} de ${totalBuyers} compradores repitieron (${Math.round(100 * rows.length / totalBuyers)} %).\n${rows.map((row) => `• ${escapeHtml((row.name || 'Cliente').split(/\s+/)[0])} ${maskPhone(row.phone)} · ${row.orders} pedidos · ${formatMoney(row.amount, currency)}`).join('\n')}\n\nLos datos completos de contacto están en el panel.`,
    data: { buyers: totalBuyers, repeat: rows.length },
  }
}

/** No cost data is stored, so profitability is never estimated. */
export function profitabilityTool(): InsightResult {
  return { text: '💡 No tengo costos de compra registrados de tus productos, así que no calculo rentabilidad ni ganancia: sería inventar cifras. Puedo mostrarte ventas confirmadas, más vendidos, productos sin movimiento y rotación por talla.' }
}
