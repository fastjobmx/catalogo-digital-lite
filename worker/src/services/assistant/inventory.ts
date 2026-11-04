import { LOW_STOCK_THRESHOLD } from '../orders'
import { parseSpanishNumber } from './intents'
import { proposeChange } from './operations'
import { say, type AssistantContext } from './context'
import { escapeHtml } from './tools'

export type StockMovementIntent = { direction: 'entrada' | 'salida'; quantity: number; sku: string; size?: string; reason: string }

const KIND_LABELS: Record<string, string> = {
  entrada: '⬆️ Entrada', salida: '⬇️ Salida', ajuste: '✏️ Ajuste', pedido: '🛒 Pedido', devolucion_pedido: '↩️ Pedido cancelado',
}

/** "Llegaron 10 unidades de ABC123 talla M", "salida de 2 ABC123 talla 38 por daño". Quantity, SKU
 * and direction must all be explicit; nothing is guessed. */
export function detectStockMovement(text: string): StockMovementIntent | null {
  const lower = text.toLowerCase()
  const entry = /\b(entrada|entrar[oó]n|entr[oó]|llegar[oó]n|lleg[oó]|ingres\w*|recib(?:[ií]|imos)|repus\w*|repon\w*|compr(?:[eé]|amos))\b/.test(lower)
  const exit = /\b(salida|salier[oó]n|sali[oó]|da[ñn]ad[oa]s?|se da[ñn]ar[oó]n|perd(?:i|imos|ieron)\w*|vend(?:[ií]|imos)\b.*\b(?:f[ií]sica|local|feria|fuera)|regal\w*|muestra)\b/.test(lower)
  if (entry === exit) return null
  const sku = text.match(/\b(?:sku|c[oó]digo|referencia|ref\.?)?\s*([A-Z0-9]*[0-9][A-Z0-9]*(?:[-_.][A-Z0-9]+)*|[A-Z]+(?:[-_.][A-Z0-9]+)+)\b/gi)
    ?.map((token) => token.replace(/^(?:sku|c[oó]digo|referencia|ref\.?)\s*/i, '').trim())
    .find((token) => /[A-Z]/i.test(token) && /[0-9-]/.test(token) && !/^\d+$/.test(token))
  const quantity = parseSpanishNumber(text.match(/\b(\d{1,5}|un[oa]?|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|quince|veinte|treinta|cincuenta)\s+(?:unidades?|pares?|piezas?|u\b|de\b)/i)?.[1]
    || text.match(/\b(?:entrada|salida)\s+de\s+(\d{1,5})\b/i)?.[1])
  if (!sku || !quantity || quantity <= 0) return null
  const size = text.match(/\btalla\s+([A-Z0-9][A-Z0-9.]{0,5})\b/i)?.[1]?.toUpperCase()
  const explicitReason = text.match(/\b(?:por|motivo:?)\s+([^.,;]{3,80})$/i)?.[1]?.trim()
  const reason = explicitReason
    || (exit && /da[ñn]/.test(lower) ? 'Producto dañado' : exit && /perd/.test(lower) ? 'Pérdida' : exit && /vend/.test(lower) ? 'Venta fuera de la tienda en línea' : exit ? 'Salida registrada por el propietario' : 'Compra o reposición')
  return { direction: entry ? 'entrada' : 'salida', quantity, sku: sku.toUpperCase(), ...(size ? { size } : {}), reason: reason.slice(0, 80) }
}

/** Proposes the new absolute stock (current ± quantity) through the usual confirmation. */
export async function proposeStockMovement(ctx: AssistantContext, intent: StockMovementIntent): Promise<void> {
  const product = await ctx.db.prepare('SELECT id, name, sku FROM products WHERE store_id = ? AND upper(sku) = ? AND is_archived = 0').bind(ctx.store.id, intent.sku).first<{ id: number; name: string; sku: string }>()
  if (!product) { await say(ctx, `No encontré el producto ${escapeHtml(intent.sku)} en <b>${escapeHtml(ctx.store.name)}</b>. Revisa el código con “mis productos”.`); return }
  const variants = (await ctx.db.prepare('SELECT id, sku, size, stock FROM product_variants WHERE product_id = ? AND is_active = 1 ORDER BY id').bind(product.id).all<{ id: number; sku: string; size: string | null; stock: number }>()).results || []
  const variant = intent.size
    ? variants.find((item) => (item.size || '').toUpperCase() === intent.size || item.sku.toUpperCase() === `${product.sku}-${intent.size}`.toUpperCase())
    : variants.length === 1 ? variants[0] : undefined
  if (!variant) {
    const sizes = variants.map((item) => item.size || item.sku).join(', ')
    await say(ctx, intent.size
      ? `${escapeHtml(product.name)} no tiene la talla ${escapeHtml(intent.size)}. Tallas: ${escapeHtml(sizes)}.`
      : `¿De qué talla? ${escapeHtml(product.name)} tiene: ${escapeHtml(sizes)}. Ejemplo: “${intent.direction === 'entrada' ? 'llegaron' : 'salida de'} ${intent.quantity} unidades de ${escapeHtml(product.sku)} talla ${escapeHtml(variants[0]?.size || 'M')}”.`)
    return
  }
  const next = intent.direction === 'entrada' ? variant.stock + intent.quantity : variant.stock - intent.quantity
  if (next < 0) {
    await say(ctx, `Solo hay ${variant.stock} unidad(es) de ${escapeHtml(product.sku)} talla ${escapeHtml(variant.size || 'única')}. No puedo registrar una salida de ${intent.quantity}; el inventario nunca queda negativo.`)
    return
  }
  await proposeChange(ctx, 'update_stock', {
    sku: product.sku, size: variant.size || 'Única', stock: next,
    movementKind: intent.direction, movementQuantity: intent.quantity, movementReason: intent.reason,
  }, `${intent.direction === 'entrada' ? 'Entrada' : 'Salida'} de ${intent.quantity} u. · Motivo: ${intent.reason}`)
}

/** Labels the movement row written by the database trigger for a confirmed Telegram stock change. */
export async function annotateStockMovement(
  db: D1Database,
  input: { storeId: number; variantIds: number[]; kind: 'entrada' | 'salida' | 'ajuste'; reason: string; reference: string; actor: string },
): Promise<void> {
  if (!input.variantIds.length) return
  await db.prepare(
    `UPDATE inventory_movements SET kind = ?, reason = ?, reference = ?, performed_by = ?
     WHERE id IN (SELECT MAX(id) FROM inventory_movements WHERE store_id = ? AND reference IS NULL
       AND variant_id IN (${input.variantIds.map(() => '?').join(', ')}) GROUP BY variant_id)`,
  ).bind(input.kind, input.reason.slice(0, 120), input.reference, input.actor, input.storeId, ...input.variantIds).run()
}

export async function lowStockWarning(db: D1Database, storeId: number, variantIds: number[]): Promise<string> {
  if (!variantIds.length) return ''
  const rows = (await db.prepare(`SELECT v.sku, v.stock FROM product_variants v JOIN products p ON p.id = v.product_id
    WHERE p.store_id = ? AND v.id IN (${variantIds.map(() => '?').join(', ')}) AND v.stock <= ?`).bind(storeId, ...variantIds, LOW_STOCK_THRESHOLD).all<{ sku: string; stock: number }>()).results || []
  return rows.length ? `\n\n⚠️ Existencias bajas: ${rows.map((row) => `${escapeHtml(row.sku)} (${row.stock} u.)`).join(', ')}.` : ''
}

/** "movimientos de ABC123" / "historial de inventario": last movements of this store only. */
export async function showStockMovements(ctx: AssistantContext, sku?: string): Promise<void> {
  const rows = (await ctx.db.prepare(
    `SELECT m.sku, m.kind, m.quantity, m.stock_after, m.reason, m.created_at FROM inventory_movements m
     JOIN products p ON p.id = m.product_id
     WHERE m.store_id = ? ${sku ? 'AND upper(p.sku) = ?' : ''} ORDER BY m.id DESC LIMIT 12`,
  ).bind(...[ctx.store.id, ...(sku ? [sku.toUpperCase()] : [])]).all<{ sku: string; kind: string; quantity: number; stock_after: number; reason: string | null; created_at: string }>()).results || []
  if (!rows.length) {
    await say(ctx, `Todavía no hay movimientos de inventario registrados${sku ? ` para ${escapeHtml(sku)}` : ''} en <b>${escapeHtml(ctx.store.name)}</b>. Se registran desde ahora en cada entrada, salida, ajuste o pedido confirmado.`)
    return
  }
  const lines = rows.map((row) => `${KIND_LABELS[row.kind] || row.kind} · ${escapeHtml(row.sku)} · ${row.quantity > 0 ? '+' : ''}${row.quantity} → ${row.stock_after} u.${row.reason ? ` · ${escapeHtml(row.reason)}` : ''} · ${escapeHtml(row.created_at.slice(0, 16))}`)
  await say(ctx, `📒 <b>Movimientos de inventario${sku ? ` · ${escapeHtml(sku)}` : ''}</b>\n\n${lines.join('\n')}`)
}

export function detectMovementsQuery(text: string): { sku?: string } | null {
  if (!/\b(movimientos?|historial|kardex)\b/i.test(text) || !/\b(inventario|stock|existencias|movimientos?|kardex)\b/i.test(text)) return null
  const sku = text.match(/\b(?:de|del)\s+([A-Z0-9]*\d[A-Z0-9-]*)\b/i)?.[1]
  return sku && /[A-Z]/i.test(sku) ? { sku: sku.toUpperCase() } : {}
}
