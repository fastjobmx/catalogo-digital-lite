import type { Env } from '../../index'
import { can } from '../../tenancy/access'
import { adminStoreUrl } from '../../tenancy/stores'
import {
  CONFIRMED_SALE_STATUSES, DELIVERY_METHOD_LABELS, DELIVERY_METHODS, ORDER_STATUS_ICONS, ORDER_STATUS_LABELS, ORDER_TRANSITIONS, PAYMENT_STATUS_LABELS,
  SHIPPING_STATUS_LABELS, TRANSITION_MESSAGES, effectiveShippingStatus, findOrder, isOrderStatus, listOpenOrders, listOrdersByView, orderRecipients,
  parseOrderItems, transitionOrder, type DeliveryMethod, type OrderRow, type OrderStatus, type OrderView,
} from '../orders'
import { legacyOwnerIds, readSession, say, updateSessionState, type AssistantContext } from './context'
import { sendTelegramMessage, type InlineKeyboard } from './telegramApi'
import { escapeHtml, formatMoney } from './tools'

type Row = InlineKeyboard['inline_keyboard'][number]

const ACTION_LABELS: Record<OrderStatus, string> = {
  pendiente: 'Pendiente', confirmado: '✅ Confirmar pedido', preparando: '📦 En preparación',
  enviado: '🚚 Entregado a transportadora', entregado: '🏁 Marcar entregado', cancelado: '✖ Cancelar pedido',
}
const METHOD_ICONS: Record<DeliveryMethod, string> = { transportadora: '🚚', entrega_personal: '🤝', retiro_en_tienda: '🏬', mensajero: '🛵', otro: '📦' }

const CONFIRM_HINT: Partial<Record<OrderStatus, string>> = {
  confirmado: 'Confirmar significa que el cliente aceptó la compra. Se reservarán las existencias de cada talla; si no alcanzan, no se confirmará.',
  cancelado: 'Si el pedido estaba confirmado, las existencias reservadas vuelven al inventario.',
  enviado: 'Escribe la transportadora y la guía (por ejemplo <code>Servientrega 700012345678</code>) o envíame la foto de la guía. La guía no se inventa: si no la tienes, puedes registrarla después.',
}

const short = (order: Pick<OrderRow, 'display_id'>) => order.display_id.split('-').pop() || order.display_id
const cb = (ctx: AssistantContext, ...parts: Array<string | number>) => ['ord', ctx.store.id, ...parts].join(':')

function orderLine(order: OrderRow): string {
  const items = parseOrderItems(order.items_json)
  const units = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0)
  return `${ORDER_STATUS_ICONS[order.status]} <b>${escapeHtml(short(order))}</b> · ${ORDER_STATUS_LABELS[order.status]} · ${units} u. · ${formatMoney(order.subtotal, order.currency)}`
}

export function ordersMenuKeyboard(ctx: AssistantContext): InlineKeyboard {
  return { inline_keyboard: [
    [{ text: '📥 Pendientes', callback_data: cb(ctx, 'list', 'pendiente') }, { text: '✅ Confirmados', callback_data: cb(ctx, 'list', 'confirmado') }],
    [{ text: '📦 En preparación', callback_data: cb(ctx, 'list', 'preparando') }, { text: '📮 Por enviar', callback_data: cb(ctx, 'view_list', 'por_enviar') }],
    [{ text: '🚚 En transportadora', callback_data: cb(ctx, 'view_list', 'en_transportadora') }, { text: '🛣 En tránsito', callback_data: cb(ctx, 'view_list', 'en_transito') }],
    [{ text: '📈 Resumen 30 días', callback_data: 'm:sales' }, { text: '🏆 Más vendidos', callback_data: 'm:top' }],
    [{ text: '↩ Menú principal', callback_data: 'm:menu' }],
  ] }
}

/** /pedidos: open orders with one button each. Buyer contact data stays in the panel. */
export async function showOrders(ctx: AssistantContext, status?: OrderStatus): Promise<void> {
  const orders = await listOpenOrders(ctx.db, ctx.store.id, status)
  const title = status ? `${ORDER_STATUS_ICONS[status]} <b>Pedidos: ${ORDER_STATUS_LABELS[status]}</b>` : '🛒 <b>Pedidos en curso</b>'
  if (!orders.length) {
    await say(ctx, `${title}\n\nNo hay pedidos en este estado.`, ordersMenuKeyboard(ctx))
    return
  }
  const rows: Row[] = orders.map((order) => [{ text: `${ORDER_STATUS_ICONS[order.status]} ${short(order)} · ${formatMoney(order.subtotal, order.currency)}`, callback_data: cb(ctx, 'view', order.id) }])
  await say(ctx, `${title}\n\n${orders.map(orderLine).join('\n')}\n\n“Pendiente” es una solicitud del cliente; solo cuenta como venta cuando la confirmas. Toca un pedido para ver el detalle.`,
    { inline_keyboard: [...rows, ...ordersMenuKeyboard(ctx).inline_keyboard] })
}

const VIEW_TITLES: Record<OrderView, string> = {
  por_enviar: '📮 <b>Pedidos pendientes de enviar</b> (confirmados o en preparación)',
  en_transportadora: '🚚 <b>Pedidos entregados a transportadora</b>',
  en_transito: '🛣 <b>Pedidos en tránsito</b>',
  despachados_hoy: '🚚 <b>Pedidos entregados a transportadora hoy</b>',
  incidencias: '⚠️ <b>Pedidos con incidencia de entrega</b>',
}

/** Logistic lists: "pendientes de enviar", "en tránsito", "entregados a transportadora hoy". */
export async function showOrderView(ctx: AssistantContext, view: OrderView): Promise<void> {
  const orders = await listOrdersByView(ctx.db, ctx.store.id, view)
  if (!orders.length) { await say(ctx, `${VIEW_TITLES[view]}\n\nNo hay pedidos en este momento.${view === 'en_transito' ? '\nEl estado «En tránsito» lo marcas tú desde el panel: no hay seguimiento automático con la transportadora.' : ''}`, ordersMenuKeyboard(ctx)); return }
  const lines = orders.map((order) => `${orderLine(order)}${order.carrier ? ` · ${escapeHtml(order.carrier)}` : ''}${order.tracking_number ? ` · guía ${escapeHtml(order.tracking_number)}` : ''}`)
  const rows: Row[] = orders.map((order) => [{ text: `${ORDER_STATUS_ICONS[order.status]} ${short(order)} · ${formatMoney(order.subtotal, order.currency)}`, callback_data: cb(ctx, 'view', order.id) }])
  await say(ctx, `${VIEW_TITLES[view]}\n\n${lines.join('\n')}`, { inline_keyboard: [...rows, [{ text: '↩ Menú', callback_data: 'm:menu' }]] })
}

/** "¿Qué pedidos tengo pendientes de enviar?", "pedidos en tránsito", "¿qué entregué a transportadora hoy?". */
export function detectOrderViewIntent(text: string): OrderView | null {
  const lower = text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
  if (!/pedido|envi|despach|transportadora|transito/.test(lower)) return null
  if (/(?:pendientes?\s+(?:de|por)\s+(?:enviar|despachar|envio|despacho)|por\s+(?:enviar|despachar)|sin\s+(?:enviar|despachar))/.test(lower)) return 'por_enviar'
  if (/en\s+transito/.test(lower)) return 'en_transito'
  if (/incidencia/.test(lower)) return 'incidencias'
  if (/(?:entregu|entregamos|despach|envi)\w*.*\b(?:hoy)\b|\bhoy\b.*(?:entregu|despach|envi)/.test(lower) && /transportadora|despach|envi/.test(lower)) return 'despachados_hoy'
  if (/(?:entregad|en)\w*\s+(?:a\s+)?(?:la\s+)?transportadora/.test(lower) && /\bpedidos\b|cuales|que\b/.test(lower)) return 'en_transportadora'
  return null
}

export async function showOrder(ctx: AssistantContext, reference: string | number): Promise<void> {
  const order = await findOrder(ctx.db, ctx.store.id, reference)
  if (!order) {
    await say(ctx, `No encontré el pedido ${escapeHtml(String(reference))} en <b>${escapeHtml(ctx.store.name)}</b>. Escribe /pedidos para ver los pedidos en curso.`)
    return
  }
  const items = parseOrderItems(order.items_json)
  const lines = items.map((item) => `• ${escapeHtml(item.name)}${item.size ? ` · talla ${escapeHtml(item.size)}` : ''}${item.color ? ` · ${escapeHtml(item.color)}` : ''} × ${Number(item.quantity)} = ${formatMoney(Number(item.lineSubtotal || 0), order.currency)}`)
  await updateSessionState(ctx, { focusOrder: order.id })
  const shipping = effectiveShippingStatus(order)
  const guide = await ctx.db.prepare(`SELECT COUNT(*) AS n FROM order_documents WHERE store_id = ? AND order_id = ?`).bind(ctx.store.id, order.id).first<{ n: number }>()
  const delivery = [
    order.delivery_method ? `Entrega pedida: ${escapeHtml(order.delivery_method)}` : null,
    order.customer_city ? `Ciudad: ${escapeHtml(order.customer_city)}` : null,
    shipping ? `Envío: ${escapeHtml(SHIPPING_STATUS_LABELS[shipping])}` : null,
    order.carrier || order.tracking_number ? `Transportadora: ${escapeHtml(order.carrier || 'sin indicar')}${order.tracking_number ? ` · guía ${escapeHtml(order.tracking_number)}` : ''}${order.shipped_at ? ` · ${escapeHtml(order.shipped_at.slice(0, 10))}` : ''}` : null,
    Number(guide?.n || 0) ? '📄 Tiene foto de guía registrada.' : null,
  ].filter(Boolean)
  const sale = CONFIRMED_SALE_STATUSES.includes(order.status) ? 'Cuenta como venta confirmada.' : order.status === 'pendiente' ? 'Aún no es una venta: es una solicitud recibida.' : ''
  const text = [
    `🧾 <b>Pedido ${escapeHtml(order.display_id)}</b>`,
    `${ORDER_STATUS_ICONS[order.status]} ${ORDER_STATUS_LABELS[order.status]} · ${escapeHtml(PAYMENT_STATUS_LABELS[order.payment_status] || order.payment_status)}`,
    '',
    ...lines,
    `Subtotal: <b>${formatMoney(order.subtotal, order.currency)}</b>${order.shipping_cost != null ? ` · envío ${formatMoney(order.shipping_cost, order.currency)}` : ''}`,
    ...(delivery.length ? ['', ...delivery] : []),
    '',
    `<i>${sale} Los datos de contacto del cliente están en el panel.</i>`,
  ].join('\n')
  const rows: Row[] = []
  if (can(ctx.role, 'orders.manage')) {
    for (const next of ORDER_TRANSITIONS[order.status]) rows.push([{ text: ACTION_LABELS[next], callback_data: cb(ctx, 'ask', order.id, next, order.revision) }])
    if (order.status !== 'cancelado' && order.payment_status !== 'verificado') rows.push([{ text: '💳 Marcar pago verificado', callback_data: cb(ctx, 'askpay', order.id, order.revision) }])
    if (order.status !== 'cancelado' && order.status !== 'pendiente') rows.push([{ text: Number(guide?.n || 0) ? '📄 Ver guía' : '📷 Registrar guía con foto', callback_data: cb(ctx, Number(guide?.n || 0) ? 'guide' : 'addguide', order.id) }])
  }
  const base = (ctx.env.PUBLIC_STORE_BASE_URL || '').replace(/\/+$/, '')
  if (base) rows.push([{ text: '🧭 Abrir en el panel', url: `${adminStoreUrl(base, ctx.store)}/orders` }])
  rows.push([{ text: '🛒 Pedidos en curso', callback_data: cb(ctx, 'list', 'all') }, { text: '↩ Menú', callback_data: 'm:menu' }])
  await say(ctx, text, { inline_keyboard: rows })
}

async function askTransition(ctx: AssistantContext, orderId: number, to: OrderStatus, revision: number): Promise<void> {
  const order = await findOrder(ctx.db, ctx.store.id, orderId)
  if (!order) { await say(ctx, 'Ese pedido ya no existe en esta tienda.'); return }
  if (order.revision !== revision) { await say(ctx, 'El pedido cambió desde que viste este botón. Te muestro su estado actual.'); await showOrder(ctx, order.id); return }
  if (!ORDER_TRANSITIONS[order.status].includes(to)) { await say(ctx, `No se puede pasar de “${ORDER_STATUS_LABELS[order.status]}” a “${ORDER_STATUS_LABELS[to]}”.`); return }
  if (to === 'enviado') await updateSessionState(ctx, { awaiting: 'order_tracking', targetOrder: { id: order.id, revision: order.revision }, focusOrder: order.id })
  if (to === 'entregado') {
    // Delivery needs how it was delivered (no carrier needed for personal delivery or pickup).
    await say(ctx, `¿Cómo se entregó el pedido <b>${escapeHtml(short(order))}</b>?\nMarcarlo como entregado no cambia el estado del pago.`, { inline_keyboard: [
      ...DELIVERY_METHODS.filter((method) => method !== 'otro').map((method) => [{ text: `${METHOD_ICONS[method]} ${DELIVERY_METHOD_LABELS[method]}`, callback_data: cb(ctx, 'dm', order.id, method, order.revision) }]),
      [{ text: '✖ No', callback_data: cb(ctx, 'view', order.id) }],
    ] })
    return
  }
  await say(ctx, `¿Cambio el pedido <b>${escapeHtml(short(order))}</b> de “${ORDER_STATUS_LABELS[order.status]}” a “<b>${ORDER_STATUS_LABELS[to]}</b>”?\n\n${CONFIRM_HINT[to] || ''}${to === 'enviado' ? '\nEjemplo: <code>Servientrega 123456789</code>' : ''}`, { inline_keyboard: [
    [{ text: '✅ Sí, cambiar', callback_data: cb(ctx, 'ok', order.id, to, order.revision) }, { text: '✖ No', callback_data: cb(ctx, 'view', order.id) }],
  ] })
}

async function applyTransition(ctx: AssistantContext, orderId: number, change: { status?: OrderStatus; payment?: 'verificado' }, revision: number, delivery: { carrier?: string; trackingNumber?: string; method?: DeliveryMethod } = {}): Promise<void> {
  if (!can(ctx.role, 'orders.manage')) { await say(ctx, 'Tu rol no permite gestionar pedidos.'); return }
  await updateSessionState(ctx, { awaiting: undefined, targetOrder: undefined, pendingDelivery: undefined })
  const result = await transitionOrder(ctx.db, {
    storeId: ctx.store.id, orderId, expectedRevision: revision, actor: `telegram:${ctx.telegramUserId}`, source: 'telegram',
    status: change.status, paymentStatus: change.payment, carrier: delivery.carrier, trackingNumber: delivery.trackingNumber,
    ...(delivery.method ? { delivery: { method: delivery.method } } : {}),
  })
  if (!result.ok) {
    const messages: Record<string, string> = {
      NOT_FOUND: 'Ese pedido ya no existe en esta tienda.',
      STALE: 'Otra persona actualizó este pedido. No cambié nada; revisa su estado actual.',
      INVALID_TRANSITION: 'Ese cambio de estado ya no es válido.',
      INSUFFICIENT_STOCK: '⚠️ No hay existencias suficientes para confirmar este pedido. No cambié nada; revisa el inventario de esas tallas.',
      NOTHING_TO_CHANGE: 'El pedido ya estaba así; no hice cambios.',
      CARRIER_REQUIRED: 'Para marcarlo como entregado a transportadora necesito la transportadora. Escríbela con la guía (por ejemplo <code>Servientrega 700012345678</code>) o envíame la foto de la guía.',
    }
    await say(ctx, messages[result.code] || escapeHtml(result.message || TRANSITION_MESSAGES[result.code] || 'No pude actualizar el pedido.'))
    if (result.code !== 'NOT_FOUND') await showOrder(ctx, orderId)
    return
  }
  const what = change.status ? `quedó como <b>${ORDER_STATUS_LABELS[result.order.status]}</b>${change.status === 'enviado' ? ' (no significa que el cliente ya lo recibió)' : ''}${change.status === 'entregado' ? '. El pago sigue como estaba' : ''}` : 'tiene el <b>pago verificado</b>'
  const low = result.lowStock.length ? `\n\n⚠️ <b>Existencias bajas:</b>\n${result.lowStock.map((item) => `• ${escapeHtml(item.sku)}: ${item.stock} u.`).join('\n')}` : ''
  await say(ctx, `✅ El pedido <b>${escapeHtml(short(result.order))}</b> ${what}.${low}`, { inline_keyboard: [
    [{ text: '🧾 Ver pedido', callback_data: cb(ctx, 'view', orderId) }, { text: '🛒 Pedidos en curso', callback_data: cb(ctx, 'list', 'all') }],
  ] })
}

/** ord:<store>:<verb>:… — always bound to the store that produced the button. */
export async function handleOrderCallback(ctx: AssistantContext, data: string): Promise<boolean> {
  // `askpay` must be tried before `ask`.
  const match = data.match(/^ord:(\d+):(list|view_list|view|askpay|ask|ok|pay|dm|guide|addguide):([a-z0-9_]+)(?::([a-z_]+|\d+))?(?::(\d+))?$/)
  if (!match) return false
  const [, storeId, verb, a = '', b, c] = match
  if (Number(storeId) !== ctx.store.id) {
    const other = ctx.memberships.find((item) => item.storeId === Number(storeId))
    await say(ctx, other
      ? `Ese pedido es de <b>${escapeHtml(other.name)}</b> y ahora estás administrando <b>${escapeHtml(ctx.store.name)}</b>.`
      : 'Ese botón pertenece a otra tienda y no lo apliqué.', other ? { inline_keyboard: [[{ text: `🔄 Cambiar a ${other.name}`.slice(0, 60), callback_data: `s:select:${other.storeId}` }]] } : undefined)
    return true
  }
  if (verb === 'list') { await showOrders(ctx, isOrderStatus(a) ? a : undefined); return true }
  if (verb === 'view_list') { if (['por_enviar', 'en_transportadora', 'en_transito', 'despachados_hoy', 'incidencias'].includes(a)) await showOrderView(ctx, a as OrderView); return true }
  if (verb === 'guide') {
    const order = await findOrder(ctx.db, ctx.store.id, Number(a))
    if (order) { const { showGuide } = await import('./shippingGuide'); await showGuide(ctx, order) }
    return true
  }
  if (verb === 'view') { await showOrder(ctx, Number(a)); return true }
  if (!can(ctx.role, 'orders.manage')) { await say(ctx, 'Tu rol no permite gestionar pedidos.'); return true }
  if (verb === 'ask' && b && isOrderStatus(b) && c) { await askTransition(ctx, Number(a), b, Number(c)); return true }
  if (verb === 'ok' && b && isOrderStatus(b) && c) {
    const session = await readSession(ctx.db, ctx.telegramUserId)
    const pendingDelivery = session.state.pendingDelivery && session.state.pendingDelivery.orderId === Number(a) ? session.state.pendingDelivery : undefined
    await applyTransition(ctx, Number(a), { status: b }, Number(c), pendingDelivery || {})
    return true
  }
  if (verb === 'askpay' && b) {
    const order = await findOrder(ctx.db, ctx.store.id, Number(a))
    if (!order) { await say(ctx, 'Ese pedido ya no existe en esta tienda.'); return true }
    await say(ctx, `¿Marcar el pago del pedido <b>${escapeHtml(short(order))}</b> como verificado? Hazlo solo cuando el dinero esté en tu cuenta.`, { inline_keyboard: [
      [{ text: '✅ Sí, pago verificado', callback_data: cb(ctx, 'pay', order.id, b) }, { text: '✖ No', callback_data: cb(ctx, 'view', order.id) }],
    ] })
    return true
  }
  if (verb === 'pay' && b) { await applyTransition(ctx, Number(a), { payment: 'verificado' }, Number(b)); return true }
  if (verb === 'addguide') {
    await updateSessionState(ctx, { awaiting: 'shipping_guide', focusOrder: Number(a) })
    await say(ctx, '📷 Envíame la foto de la guía de este pedido. También puedes escribir los datos, por ejemplo <code>Servientrega 700012345678</code>.')
    return true
  }
  if (verb === 'dm' && b && c && (DELIVERY_METHODS as readonly string[]).includes(b)) {
    const order = await findOrder(ctx.db, ctx.store.id, Number(a))
    if (!order) { await say(ctx, 'Ese pedido ya no existe en esta tienda.'); return true }
    await updateSessionState(ctx, { pendingDelivery: { orderId: order.id, method: b as DeliveryMethod } })
    await say(ctx, `¿Marco el pedido <b>${escapeHtml(short(order))}</b> como <b>Entregado</b> (${escapeHtml(DELIVERY_METHOD_LABELS[b as DeliveryMethod].toLowerCase())})?\nEl estado del pago no cambia.`, { inline_keyboard: [
      [{ text: '✅ Sí, marcar entregado', callback_data: cb(ctx, 'ok', order.id, 'entregado', c) }, { text: '✖ No', callback_data: cb(ctx, 'view', order.id) }],
    ] })
    return true
  }
  return false
}

/** Free text while a dispatch is being confirmed: "Servientrega 123456789". */
export async function acceptTrackingText(ctx: AssistantContext, text: string, target: { id: number; revision: number }): Promise<void> {
  const value = text.trim().replace(/^(?:gu[ií]a|transportadora)\s*[:=]?\s*/i, '')
  const match = value.match(/^(.{2,60}?)\s*(?:gu[ií]a|n[uú]mero|#|:)?\s*([A-Z0-9-]{4,40})$/i)
  if (!match) {
    await say(ctx, 'Escríbelo así: <code>Servientrega 123456789</code>. O toca “Sí, cambiar” para despachar sin guía.')
    return
  }
  const delivery = { orderId: target.id, carrier: match[1]!.replace(/\s+(?:gu[ií]a|n[uú]mero)$/i, '').trim(), trackingNumber: match[2]!.toUpperCase() }
  await updateSessionState(ctx, { awaiting: undefined, targetOrder: undefined, pendingDelivery: delivery })
  await say(ctx, `Anoté <b>${escapeHtml(delivery.carrier)}</b> · guía <b>${escapeHtml(delivery.trackingNumber)}</b>. Es solo información para ti y el cliente: no hay seguimiento automático con la transportadora.`, { inline_keyboard: [
    [{ text: '🚚 Despachar con esta guía', callback_data: cb(ctx, 'ok', target.id, 'enviado', target.revision) }, { text: '✖ No', callback_data: cb(ctx, 'view', target.id) }],
  ] })
}

/** "confirma el pedido AB12CD34", "pedido AB12CD34 despachado", "ver pedido 12". */
export function detectOrderIntent(text: string): { reference: string; to?: OrderStatus | 'pagado' } | null {
  const lower = text.toLowerCase()
  // Display codes (AB12CD34) or the plain order number ("pedido 123").
  const reference = text.match(/\bpedido\s*(?:n[uú]mero\s*|#\s*)?([A-Z0-9][A-Z0-9-]{3,39}|\d{1,9})\b/i)?.[1]
  // Order codes always carry digits; "pedido pendiente" is a question, not a code.
  if (!reference || !/\d/.test(reference)) return null
  const to: OrderStatus | 'pagado' | undefined =
    /\bcancel/.test(lower) ? 'cancelado'
      : /transportadora/.test(lower) && /\bentreg|\bdespach|\benvi|\bmarc|\bpas/.test(lower) ? 'enviado'
      : /\bentregad|\bentreg[oó]\b|\brecibi[oó] el cliente/.test(lower) ? 'entregado'
        : /\bdespach|\benviad|\benv[ií]a\b|\bmand[ae]/.test(lower) ? 'enviado'
          : /\bprepar/.test(lower) ? 'preparando'
            : /\bpagad|\bpago verificado|\bya pag/.test(lower) ? 'pagado'
              : /\bconfirm/.test(lower) ? 'confirmado' : undefined
  return { reference, ...(to ? { to } : {}) }
}

export async function handleOrderIntent(ctx: AssistantContext, intent: { reference: string; to?: OrderStatus | 'pagado' }): Promise<void> {
  const order = await findOrder(ctx.db, ctx.store.id, intent.reference)
  if (!order) { await showOrder(ctx, intent.reference); return }
  if (!intent.to) { await showOrder(ctx, order.id); return }
  if (!can(ctx.role, 'orders.manage')) { await say(ctx, 'Tu rol no permite gestionar pedidos.'); return }
  if (intent.to === 'pagado') { await handleOrderCallback(ctx, cb(ctx, 'askpay', order.id, order.revision)); return }
  if (order.status === intent.to) { await say(ctx, `El pedido ${escapeHtml(short(order))} ya está como “${ORDER_STATUS_LABELS[order.status]}”.`); return }
  await askTransition(ctx, order.id, intent.to, order.revision)
}

/** New storefront order: tell the store team in Telegram (best effort, never blocks the checkout). */
export async function notifyNewOrder(env: Env['Bindings'], db: D1Database, order: { storeId: number; orderId: number }): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) return
  const row = await db.prepare(`SELECT o.id, o.display_id, o.subtotal, o.currency, o.items_json, s.name FROM orders o JOIN stores s ON s.id = o.store_id WHERE o.id = ? AND o.store_id = ?`)
    .bind(order.orderId, order.storeId).first<{ id: number; display_id: string; subtotal: number; currency: string; items_json: string; name: string }>()
  if (!row) return
  const recipients = await orderRecipients(db, order.storeId, await legacyOwnerIds(db, env))
  const units = parseOrderItems(row.items_json).reduce((sum, item) => sum + Number(item.quantity || 0), 0)
  const text = `🛒 <b>Nuevo pedido en ${escapeHtml(row.name)}</b>\n${escapeHtml(row.display_id)} · ${units} u. · ${formatMoney(row.subtotal, row.currency)}\n\n📥 Recibido: es una solicitud por WhatsApp, todavía no es una venta. Confírmalo cuando el cliente acepte.`
  await Promise.all(recipients.map((chatId) => sendTelegramMessage(env.TELEGRAM_BOT_TOKEN!, Number(chatId), text, 'HTML', {
    inline_keyboard: [[{ text: '🧾 Ver pedido', callback_data: `ord:${order.storeId}:view:${row.id}` }]],
  }).catch(() => undefined)))
}
