/** Read-only store tools used by the Telegram assistant and the AI layer.
 * Every query is scoped by store_id and the answers only state facts found
 * in D1; when data is missing the message says so instead of estimating. */

export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[character]!)
}

export function formatMoney(amount: number, currency = 'COP'): string {
  const value = Number(amount || 0)
  return `$${value.toLocaleString('es-CO')} ${currency}`
}

export type ToolResult = { text: string; skus?: string[]; data?: unknown }

type ProductTotals = { sku: string; name: string; price: number; stock: number; variants: number; description: string | null; image_urls: string }

async function activeProducts(db: D1Database, storeId: number): Promise<ProductTotals[]> {
  const result = await db.prepare(
    `SELECT p.sku, p.name, p.price, p.description, p.image_urls,
            COALESCE(SUM(CASE WHEN v.is_active = 1 THEN v.stock ELSE 0 END), 0) AS stock,
            COUNT(v.id) AS variants
     FROM products p LEFT JOIN product_variants v ON v.product_id = p.id
     WHERE p.store_id = ? AND p.is_active = 1 AND p.is_archived = 0
     GROUP BY p.id ORDER BY p.name`,
  ).bind(storeId).all<ProductTotals>()
  return result.results || []
}

function productLines(rows: ProductTotals[], currency: string, limit = 12, extra?: (row: ProductTotals) => string): string {
  const lines = rows.slice(0, limit).map((row) => `• <b>${escapeHtml(row.name)}</b> (${escapeHtml(row.sku)}) · ${extra ? extra(row) : `${Number(row.stock)} u. · ${formatMoney(row.price, currency)}`}`)
  if (rows.length > limit) lines.push(`…y ${rows.length - limit} más.`)
  return lines.join('\n')
}

export async function getInventoryTool(db: D1Database, storeId: number, currency: string, sku?: string): Promise<ToolResult> {
  if (sku) {
    const variants = await db.prepare(
      `SELECT p.name, v.size, v.color, v.stock FROM product_variants v JOIN products p ON p.id = v.product_id
       WHERE p.store_id = ? AND p.sku = ? AND p.is_archived = 0 AND v.is_active = 1 ORDER BY v.sort_order, v.id`,
    ).bind(storeId, sku).all<{ name: string; size: string | null; color: string | null; stock: number }>()
    const rows = variants.results || []
    if (!rows.length) return { text: `No encontré el producto ${escapeHtml(sku)} en tu catálogo.` }
    const total = rows.reduce((sum, row) => sum + Number(row.stock), 0)
    const lines = rows.map((row) => `• ${escapeHtml([row.color, row.size ? `talla ${row.size}` : null].filter(Boolean).join(' · ') || 'Única')}: ${row.stock} u.`)
    return { text: `📦 <b>${escapeHtml(rows[0]!.name)}</b> (${escapeHtml(sku)})\n${lines.join('\n')}\nTotal: <b>${total}</b> unidades.`, skus: [sku] }
  }
  const rows = await activeProducts(db, storeId)
  if (!rows.length) return { text: 'Todavía no tienes productos activos.' }
  const total = rows.reduce((sum, row) => sum + Number(row.stock), 0)
  return { text: `📦 <b>Inventario</b> · ${rows.length} productos · ${total} unidades\n${productLines(rows, currency, 15)}`, skus: rows.slice(0, 15).map((row) => row.sku) }
}

export async function searchProductsTool(db: D1Database, storeId: number, currency: string, query?: string): Promise<ToolResult> {
  const term = query?.trim()
  const result = await db.prepare(
    `SELECT p.sku, p.name, p.price, p.description, p.image_urls,
            COALESCE(SUM(CASE WHEN v.is_active = 1 THEN v.stock ELSE 0 END), 0) AS stock, COUNT(v.id) AS variants
     FROM products p LEFT JOIN product_variants v ON v.product_id = p.id
     WHERE p.store_id = ? AND p.is_active = 1 AND p.is_archived = 0
       AND (? IS NULL OR p.name LIKE ? OR p.sku LIKE ? OR p.description LIKE ?)
     GROUP BY p.id ORDER BY p.created_at DESC LIMIT 12`,
  ).bind(storeId, term || null, `%${term}%`, `%${term}%`, `%${term}%`).all<ProductTotals>()
  const rows = result.results || []
  if (!rows.length) return { text: term ? `No encontré productos que coincidan con “${escapeHtml(term)}”.` : 'Todavía no tienes productos activos.' }
  return { text: `🛍️ <b>${term ? `Resultados para “${escapeHtml(term)}”` : 'Tus productos'}</b>\n${productLines(rows, currency)}`, skus: rows.map((row) => row.sku) }
}

export async function lowStockTool(db: D1Database, storeId: number, currency: string, threshold = 5): Promise<ToolResult> {
  const rows = (await activeProducts(db, storeId)).filter((row) => Number(row.stock) < threshold)
  if (!rows.length) return { text: `✅ Ningún producto activo tiene menos de ${threshold} unidades.` }
  rows.sort((a, b) => Number(a.stock) - Number(b.stock))
  return { text: `⚠️ <b>Productos con menos de ${threshold} unidades</b> (${rows.length})\n${productLines(rows, currency)}`, skus: rows.map((row) => row.sku) }
}

export async function outOfStockTool(db: D1Database, storeId: number, currency: string): Promise<ToolResult> {
  const rows = (await activeProducts(db, storeId)).filter((row) => Number(row.stock) === 0)
  if (!rows.length) return { text: '✅ No tienes productos visibles agotados.' }
  return { text: `🚫 <b>Productos visibles y agotados</b> (${rows.length})\n${productLines(rows, currency)}\n\nPuedo ocultarlos de la tienda si me lo pides.`, skus: rows.map((row) => row.sku) }
}

export async function withoutDescriptionTool(db: D1Database, storeId: number, currency: string): Promise<ToolResult> {
  const rows = (await activeProducts(db, storeId)).filter((row) => !row.description || row.description.trim().length < 20)
  if (!rows.length) return { text: '✅ Todos tus productos activos tienen descripción.' }
  return { text: `📝 <b>Productos sin descripción o con una muy corta</b> (${rows.length})\n${productLines(rows, currency)}\n\nPuedo redactar una propuesta para cualquiera: escribe “escribe la descripción de SKU”.`, skus: rows.map((row) => row.sku) }
}

export async function withoutPhotosTool(db: D1Database, storeId: number, currency: string): Promise<ToolResult> {
  const rows = (await activeProducts(db, storeId)).filter((row) => {
    try { return !(JSON.parse(row.image_urls || '[]') as unknown[]).length } catch { return true }
  })
  if (!rows.length) return { text: '✅ Todos tus productos activos tienen al menos una foto.' }
  return { text: `🖼️ <b>Productos sin fotos</b> (${rows.length})\n${productLines(rows, currency)}`, skus: rows.map((row) => row.sku) }
}

export async function pendingOrdersTool(db: D1Database, storeId: number): Promise<ToolResult> {
  const result = await db.prepare(
    `SELECT display_id, subtotal, total, currency, payment_status, created_at FROM orders
     WHERE store_id = ? AND status = 'pendiente' ORDER BY created_at DESC LIMIT 10`,
  ).bind(storeId).all<{ display_id: string; subtotal: number; total: number | null; currency: string; payment_status: string; created_at: string }>()
  const count = await db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE store_id = ? AND status = 'pendiente'`).bind(storeId).first<{ n: number }>()
  const rows = result.results || []
  if (!rows.length) return { text: '✅ No tienes pedidos pendientes.' }
  const lines = rows.map((order) => `• <b>${escapeHtml(order.display_id)}</b> · ${formatMoney(order.subtotal, order.currency)} · pago ${escapeHtml(order.payment_status)} · ${escapeHtml(order.created_at.slice(0, 16))}`)
  return { text: `🛒 <b>Pedidos pendientes</b> (${Number(count?.n || rows.length)})\n${lines.join('\n')}\n\nLos datos del comprador se consultan en el panel.` }
}

export async function topProductsTool(db: D1Database, storeId: number, currency: string, days = 30): Promise<ToolResult> {
  const result = await db.prepare(
    `SELECT json_extract(i.value, '$.sku') AS sku, MAX(json_extract(i.value, '$.name')) AS name,
            SUM(CAST(json_extract(i.value, '$.quantity') AS INTEGER)) AS quantity,
            SUM(CAST(json_extract(i.value, '$.lineSubtotal') AS INTEGER)) AS revenue,
            COUNT(DISTINCT o.id) AS orders
     FROM orders o, json_each(o.items_json) i
     WHERE o.store_id = ? AND o.status IN ('confirmado', 'preparando', 'enviado', 'entregado') AND o.created_at >= datetime('now', ?)
     GROUP BY sku ORDER BY quantity DESC, revenue DESC LIMIT 10`,
  ).bind(storeId, `-${days} days`).all<{ sku: string; name: string; quantity: number; revenue: number; orders: number }>()
  const rows = result.results || []
  if (!rows.length) {
    const requests = await db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE store_id = ? AND status <> 'cancelado' AND created_at >= datetime('now', ?)`).bind(storeId, `-${days} days`).first<{ n: number }>()
    return { text: `Aún no hay pedidos confirmados en los últimos ${days} días, así que no puedo decir cuáles son los más vendidos.${Number(requests?.n) ? ` Hay ${requests!.n} solicitud(es) sin confirmar.` : ''}` }
  }
  const lines = rows.map((row, index) => `${index + 1}. <b>${escapeHtml(row.name)}</b> (${escapeHtml(row.sku)}) · ${row.quantity} u. · ${formatMoney(row.revenue, currency)}`)
  return { text: `🏆 <b>Más vendidos · últimos ${days} días</b>\nBasado en pedidos confirmados registrados.\n${lines.join('\n')}`, skus: rows.map((row) => row.sku) }
}

export async function salesSummaryTool(db: D1Database, storeId: number, currency: string, days = 30): Promise<ToolResult> {
  const result = await db.prepare(
    `SELECT status, COUNT(*) AS orders, COALESCE(SUM(subtotal), 0) AS amount FROM orders
     WHERE store_id = ? AND created_at >= datetime('now', ?) GROUP BY status`,
  ).bind(storeId, `-${days} days`).all<{ status: string; orders: number; amount: number }>()
  const rows = result.results || []
  if (!rows.length) return { text: `No hay pedidos registrados en los últimos ${days} días.` }
  const confirmed = rows.filter((row) => ['confirmado', 'preparando', 'enviado', 'entregado'].includes(row.status))
  const confirmedAmount = confirmed.reduce((sum, row) => sum + Number(row.amount), 0)
  const confirmedOrders = confirmed.reduce((sum, row) => sum + Number(row.orders), 0)
  const labels: Record<string, string> = { pendiente: 'Recibido (sin confirmar)', confirmado: 'Confirmado', preparando: 'En preparación', enviado: 'Despachado', entregado: 'Entregado', cancelado: 'Cancelado' }
  const lines = rows.map((row) => `• ${escapeHtml(labels[row.status] || row.status)}: ${row.orders} · ${formatMoney(row.amount, currency)}`)
  return {
    text: `📈 <b>Resumen de pedidos · últimos ${days} días</b>\n${lines.join('\n')}\n\nConfirmados: <b>${confirmedOrders}</b> pedidos por <b>${formatMoney(confirmedAmount, currency)}</b> (subtotal de productos, sin envío).\nLos pagos se verifican en el panel; un pedido por WhatsApp no equivale a un pago.`,
    data: { confirmedOrders, confirmedAmount },
  }
}

export async function storeSummaryTool(db: D1Database, storeId: number): Promise<ToolResult> {
  const row = await db.prepare(
    'SELECT name, description, primary_color, logo_url, cover_image_url, whatsapp_phone, hours, address, phone, email, instagram, facebook, tiktok, currency FROM store_config WHERE id = ?',
  ).bind(storeId).first<Record<string, string | null>>()
  if (!row) return { text: 'No encontré la configuración de tu tienda.' }
  const value = (item: string | null | undefined) => item ? escapeHtml(item) : '<i>sin configurar</i>'
  return {
    text: `🏪 <b>${escapeHtml(row.name)}</b>\n` +
      `Descripción: ${value(row.description)}\nColor principal: ${value(row.primary_color)}\n` +
      `Logo: ${row.logo_url ? 'configurado' : '<i>sin configurar</i>'} · Banner: ${row.cover_image_url ? 'configurado' : '<i>sin configurar</i>'}\n` +
      `WhatsApp: ${value(row.whatsapp_phone)}\nHorario: ${value(row.hours)}\nDirección: ${value(row.address)}\n` +
      `Redes: ${[row.instagram, row.facebook, row.tiktok].filter(Boolean).length ? [row.instagram, row.facebook, row.tiktok].filter(Boolean).map((item) => escapeHtml(item)).join(' · ') : '<i>sin configurar</i>'}`,
  }
}

/** Compact, factual metrics used as grounding for AI advice. */
export async function catalogFacts(db: D1Database, storeId: number): Promise<Record<string, number | string>> {
  const rows = await activeProducts(db, storeId)
  const categories = await db.prepare('SELECT COUNT(*) AS n FROM categories WHERE store_id = ? AND is_active = 1').bind(storeId).first<{ n: number }>()
  const orders = await db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE store_id = ? AND created_at >= datetime('now', '-30 days')`).bind(storeId).first<{ n: number }>()
  const config = await db.prepare('SELECT name, business_type, logo_url, cover_image_url, whatsapp_phone, hours FROM store_config WHERE id = ?').bind(storeId).first<Record<string, string | null>>()
  const withoutPhotos = rows.filter((row) => { try { return !(JSON.parse(row.image_urls || '[]') as unknown[]).length } catch { return true } }).length
  return {
    tienda: config?.name || '',
    tipo_negocio: config?.business_type || '',
    productos_activos: rows.length,
    categorias_activas: Number(categories?.n || 0),
    productos_agotados: rows.filter((row) => Number(row.stock) === 0).length,
    productos_bajo_stock_menor_5: rows.filter((row) => Number(row.stock) > 0 && Number(row.stock) < 5).length,
    productos_sin_descripcion: rows.filter((row) => !row.description || row.description.trim().length < 20).length,
    productos_sin_fotos: withoutPhotos,
    productos_una_sola_foto: rows.filter((row) => { try { return (JSON.parse(row.image_urls || '[]') as unknown[]).length === 1 } catch { return false } }).length,
    pedidos_ultimos_30_dias: Number(orders?.n || 0),
    tiene_logo: config?.logo_url ? 'si' : 'no',
    tiene_banner: config?.cover_image_url ? 'si' : 'no',
    tiene_whatsapp: config?.whatsapp_phone ? 'si' : 'no',
    tiene_horario: config?.hours ? 'si' : 'no',
  }
}

/** Deterministic tips used when Gemini is not available or the budget is exhausted. */
export function deterministicAdvice(facts: Record<string, number | string>): string[] {
  const tips: string[] = []
  if (Number(facts.productos_activos) === 0) tips.push('Publica tus primeros productos: envíame fotos y te ayudo a prepararlos.')
  if (Number(facts.productos_sin_fotos) > 0) tips.push(`Agrega fotos a ${facts.productos_sin_fotos} producto(s): los productos sin foto casi no se venden.`)
  if (Number(facts.productos_una_sola_foto) > 0) tips.push(`${facts.productos_una_sola_foto} producto(s) tienen una sola foto; suma ángulos y detalles.`)
  if (Number(facts.productos_sin_descripcion) > 0) tips.push(`Completa la descripción de ${facts.productos_sin_descripcion} producto(s); puedo redactar propuestas.`)
  if (Number(facts.productos_agotados) > 0) tips.push(`Tienes ${facts.productos_agotados} producto(s) agotados visibles: repón stock u ocúltalos.`)
  if (Number(facts.productos_bajo_stock_menor_5) > 0) tips.push(`Revisa ${facts.productos_bajo_stock_menor_5} producto(s) con menos de 5 unidades.`)
  if (facts.tiene_banner === 'no') tips.push('Configura un banner principal atractivo para tu portada.')
  if (facts.tiene_logo === 'no') tips.push('Sube tu logotipo para que la tienda se vea profesional.')
  if (facts.tiene_whatsapp === 'no') tips.push('Configura tu WhatsApp para recibir pedidos.')
  if (facts.tiene_horario === 'no') tips.push('Publica tu horario de atención.')
  if (Number(facts.categorias_activas) < 2 && Number(facts.productos_activos) > 6) tips.push('Organiza tus productos en categorías para que los clientes encuentren rápido lo que buscan.')
  if (!tips.length) tips.push('Tu catálogo está en buen estado. Mantén fotos y stock actualizados y destaca tus mejores productos.')
  return tips.slice(0, 6)
}
