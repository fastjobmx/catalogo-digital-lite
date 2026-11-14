/** Asistente TiendIA — capa conversacional, paso 3: pedidos y reportes dentro de la conversación.
 *
 * El comerciante pregunta y ordena con sus palabras («cómo van los pedidos», «cuánto vendí esta semana», «el último
 * pedido», «confírmalo», «ya pagó el 2», «salió por Servientrega guía 7000…»). Esta capa solo entiende a qué pedido
 * y a qué acción se refiere y responde en corto; el trabajo lo hacen las piezas que ya existían:
 *   · lectura de pedidos y contadores (services/orders: findOrder, listOpenOrders, listOrdersByView, orderStatusCounts);
 *   · cambio de estado y pago con sus validaciones, reserva de inventario, revisión concurrente y auditoría
 *     (handleOrderCallback → transitionOrder);
 *   · guías con foto o texto (shippingGuide), que siguen por su flujo de siempre.
 * Ningún cambio se aplica sin que el comerciante diga que sí en su propio mensaje. Los datos de contacto del
 * cliente no se muestran aquí (siguen en el panel) y el texto de un pedido es dato, nunca instrucciones.
 *
 * Interruptor propio: ASSISTANT_ORDERS_STORE_IDS (independiente de texto y multimedia). Apagado = flujo anterior. */
import { z } from 'zod'
import { callGeminiJson, UNTRUSTED_CONTENT_RULE, type GeminiJsonResult } from '../../../ai/geminiClient'
import { can } from '../../../tenancy/access'
import {
  CONFIRMED_SALE_STATUSES, DELIVERY_METHOD_LABELS, ORDER_STATUS_LABELS, ORDER_TRANSITIONS, PAYMENT_STATUS_LABELS, findOrder, isOrderStatus,
  listOpenOrders, listOrdersByView, orderStatusCounts, parseOrderItems, type DeliveryMethod, type OrderRow, type OrderStatus, type OrderView,
} from '../../orders'
import { withAiBudget } from '../ai'
import { colorOf, fold } from '../commerce/language'
import { loadCatalog } from '../commerce/resolve'
import { handleAgentText, looksMulti, splitTasks } from './orchestrator'
import { parseCommerce } from '../commerce/parse'
import { readSession, say, updateSessionState, type AssistantContext } from '../context'
import { getPendingOperation } from '../operations'
import { detectOrderViewIntent, handleOrderCallback } from '../orders'
import { carrierOf, parseGuideText } from '../shippingGuide'
import { escapeHtml, formatMoney } from '../tools'

export function ordersEnabled(ctx: Pick<AssistantContext, 'env' | 'store'>): boolean {
  const raw = String(ctx.env.ASSISTANT_ORDERS_STORE_IDS || '').trim()
  if (!raw) return false
  return raw === '*' || raw.split(',').map((value) => Number(value.trim())).includes(ctx.store.id)
}

type Change = OrderStatus | 'pagado'
type ToolSpec = { description: string; kind: 'read' | 'write'; confirm: boolean; allowed: (ctx: Pick<AssistantContext, 'role'>) => boolean; wraps: string }
const anyMember = () => true
const manager = (ctx: Pick<AssistantContext, 'role'>) => can(ctx.role, 'orders.manage')

/** Tools of this step, in the registry style of agent/tools.ts. Reads answer at once; writes always ask first. */
export const ORDER_TOOLS = {
  ver_pedido: { description: 'Estado, productos, pago y envío de un pedido de esta tienda (sin datos de contacto del cliente).', kind: 'read', confirm: false, allowed: anyMember, wraps: 'findOrder' },
  listar_pedidos: { description: 'Pedidos en curso, por estado, por vista logística o por periodo.', kind: 'read', confirm: false, allowed: anyMember, wraps: 'listOpenOrders / listOrdersByView' },
  resumen_pedidos: { description: 'Cuántos pedidos hay en cada estado y cuántos llegaron hoy.', kind: 'read', confirm: false, allowed: anyMember, wraps: 'orderStatusCounts' },
  reporte_periodo: { description: 'Pedidos recibidos y ventas confirmadas de hoy, ayer, la semana, el mes o los últimos N días.', kind: 'read', confirm: false, allowed: anyMember, wraps: 'tabla orders (solo lectura)' },
  mas_vendidos: { description: 'Productos con más unidades en ventas confirmadas del periodo.', kind: 'read', confirm: false, allowed: anyMember, wraps: 'tabla orders (solo lectura)' },
  cambiar_estado_pedido: { description: 'Confirmar, preparar, despachar, entregar o cancelar un pedido.', kind: 'write', confirm: true, allowed: manager, wraps: 'handleOrderCallback → transitionOrder (inventario, revisión y auditoría)' },
  marcar_pago: { description: 'Marcar el pago de un pedido como verificado.', kind: 'write', confirm: true, allowed: manager, wraps: 'handleOrderCallback → transitionOrder' },
} as const satisfies Record<string, ToolSpec>
type OrderTool = keyof typeof ORDER_TOOLS

export type OrdersState = {
  /** A change shown to the merchant and waiting for their «sí». */
  confirm?: { orderId: number; to: Change; revision: number; at: number }
  /** One missing datum of a change: the carrier of a dispatch or how it was delivered. */
  ask?: { kind: 'carrier' | 'method'; orderId: number; revision: number; at: number }
  /** Orders of the last numbered list, in order («el 2»), and when this layer last showed an order. */
  list?: number[]
  at?: number
}

const TTL = 10 * 60 * 1000
const fresh = (at?: number) => Boolean(at && Date.now() - at < TTL)
const SALES = CONFIRMED_SALE_STATUSES.map((status) => `'${status}'`).join(', ')
const shortId = (order: Pick<OrderRow, 'display_id'>) => order.display_id.split('-').pop() || order.display_id
const unitsOf = (order: Pick<OrderRow, 'items_json'>) => parseOrderItems(order.items_json).reduce((sum, item) => sum + Number(item.quantity || 0), 0)
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`
/** Hours between UTC and the store's day (Colombia by default): «hoy» is the merchant's today, not UTC's. */
const offset = (ctx: AssistantContext) => { const hours = Number(ctx.env.ASSISTANT_TZ_OFFSET_HOURS); return `${Number.isInteger(hours) && hours >= -12 && hours <= 14 ? hours : -5} hours` }

async function readOrders(ctx: AssistantContext): Promise<OrdersState> {
  return ((await readSession(ctx.db, ctx.telegramUserId)).state.agent as { orders?: OrdersState } | undefined)?.orders || {}
}
async function saveOrders(ctx: AssistantContext, patch: Partial<OrdersState>): Promise<void> {
  const session = await readSession(ctx.db, ctx.telegramUserId)
  const agent = { ...(session.state.agent || {}) } as Record<string, unknown>
  const next = { ...((agent.orders as OrdersState) || {}), ...patch }
  for (const key of Object.keys(next) as Array<keyof OrdersState>) if (next[key] === undefined) delete next[key]
  if (Object.keys(next).length) agent.orders = next; else delete agent.orders
  await updateSessionState(ctx, { agent: Object.keys(agent).length ? agent : undefined })
}
async function measure(ctx: AssistantContext, started: number, tool: OrderTool | 'confirmar' | 'cancelar' | 'aclarar', outcome: string, path = 'orders', usage?: { promptTokens: number; outputTokens: number }): Promise<void> {
  await ctx.db.prepare(`INSERT INTO assistant_agent_turns (store_id, channel, path, tools, outcome, latency_ms, prompt_tokens, output_tokens) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(ctx.store.id, ctx.channel ? (ctx.channel.provider === 'waha' ? 'waha' : 'whatsapp') : 'telegram', path, tool, outcome.slice(0, 40), Date.now() - started, usage?.promptTokens ?? 0, usage?.outputTokens ?? 0).run().catch(() => undefined)
}

// ───────────────────────── Lo que pidió: periodo, pedido y acción ─────────────────────────

export type Period = { key: 'hoy' | 'ayer' | 'semana' | 'mes' | 'mes_pasado' | 'dias'; days?: number }
const NUMBER_WORDS: Record<string, number> = { dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, diez: 10, quince: 15, veinte: 20, treinta: 30, sesenta: 60, noventa: 90 }

export function periodOf(lower: string): Period | null {
  const last = lower.match(/\bultim[oa]s\s+(\d{1,3}|dos|tres|cuatro|cinco|seis|siete|ocho|diez|quince|veinte|treinta|sesenta|noventa)\s+dias\b/)
  if (last) return { key: 'dias', days: Math.min(365, Math.max(1, Number(last[1]) || NUMBER_WORDS[last[1]!] || 7)) }
  if (/\b(?:mes\s+pasado|mes\s+anterior)\b/.test(lower)) return { key: 'mes_pasado' }
  if (/\b(?:este\s+mes|del\s+mes|en\s+el\s+mes|lo\s+que\s+va\s+del\s+mes|mensual(?:es)?)\b/.test(lower)) return { key: 'mes' }
  if (/\b(?:ultima\s+semana|ultimos\s+siete\s+dias)\b/.test(lower)) return { key: 'dias', days: 7 }
  if (/\b(?:esta\s+semana|de\s+la\s+semana|en\s+la\s+semana|semanal(?:es)?|lo\s+que\s+va\s+de\s+la\s+semana)\b/.test(lower)) return { key: 'semana' }
  if (/\b(?:ayer)\b/.test(lower)) return { key: 'ayer' }
  if (/\b(?:hoy|del\s+dia|el\s+dia\s+de\s+hoy)\b/.test(lower)) return { key: 'hoy' }
  return null
}

/** SQL condition on the store's local day. Only fixed text and a clamped integer reach the query. */
function periodSql(ctx: AssistantContext, period: Period): { where: string; label: string } {
  const off = offset(ctx)
  const day = `date(created_at, '${off}')`
  const today = `date('now', '${off}')`
  switch (period.key) {
    case 'hoy': return { where: `${day} = ${today}`, label: 'Hoy' }
    case 'ayer': return { where: `${day} = date('now', '${off}', '-1 day')`, label: 'Ayer' }
    case 'semana': return { where: `${day} >= date('now', '${off}', 'weekday 0', '-6 days')`, label: 'Esta semana' }
    case 'mes': return { where: `${day} >= date('now', '${off}', 'start of month')`, label: 'Este mes' }
    case 'mes_pasado': return { where: `${day} >= date('now', '${off}', 'start of month', '-1 month') AND ${day} < date('now', '${off}', 'start of month')`, label: 'El mes pasado' }
    default: { const days = Math.min(365, Math.max(1, Math.trunc(period.days || 7))); return { where: `${day} >= date('now', '${off}', '-${days - 1} days')`, label: `En los últimos ${days} días` } }
  }
}

type Ref = { code?: string; latest?: boolean; position?: number; focus?: boolean }
const ORDINALS: Record<string, number> = { primero: 1, primer: 1, primera: 1, segundo: 2, segunda: 2, tercero: 3, tercer: 3, tercera: 3, cuarto: 4, cuarta: 4, quinto: 5, quinta: 5 }

export function refOf(raw: string, hasList: boolean): Ref | null {
  const lower = fold(raw)
  if (/\b(?:ultimo|mas\s+reciente|que\s+acaba\s+de\s+(?:llegar|entrar)|que\s+(?:llego|entro)\s+(?:ahorita|ahora|recien))\b/.test(lower) && !/\bultim[oa]s\b/.test(lower)) return { latest: true }
  const coded = raw.match(/\bpedido\s*(?:n[uú]mero\s*|#\s*|n[o°º]\.?\s*)?([A-Z0-9][A-Z0-9-]{3,39})\b/i)?.[1]
  // Order codes are 8 hexadecimal characters: some have no digit at all («DDCCAFBC») and some no letter.
  if (coded && (/\d/.test(coded) || /^[A-F]{8}$/i.test(coded))) return { code: coded }
  const numbered = lower.match(/\b(?:pedido|orden)\s*(?:numero\s*|#\s*)?(\d{1,9})\b/)
  if (numbered) return hasList && Number(numbered[1]) >= 1 && Number(numbered[1]) <= 15 ? { position: Number(numbered[1]) } : { code: numbered[1] }
  // The short code as the merchant sees it («AB12CD34»): letters and digits together.
  const bare = raw.match(/\b(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{6,12}\b/)?.[0] || raw.match(/\b[A-F]{8}\b/)?.[0]
  if (bare) return { code: bare }
  if (hasList) {
    const ordinal = lower.match(/\b(?:el|la|al|del|numero)\s+(\d{1,2}|primer[oa]?|segund[oa]|tercer[oa]?|cuart[oa]|quint[oa])\b(?!\s*(?:mil|unidades|pares|dias|de\s+la\s+\d))/)
    if (ordinal) return { position: Number(ordinal[1]) || ORDINALS[ordinal[1]!] || 0 }
  }
  if (/\b(?:ese|este|el\s+mismo|dicho)\s+pedido\b|\b(?:confirmal[oa]|cancelal[oa]|preparal[oa]|alistal[oa]|despachal[oa]|envial[oa]|entregal[oa]|marcal[oa])\b|\bya\s+(?:lo\s+)?(?:pago|pagaron|despache|envie|entregue|recibio|salio|confirme)\b|\b(?:lo|la)\s+(?:despache|envie|entregue|confirmo|cancelo|preparo)\b/.test(lower)) return { focus: true }
  return null
}

export function changeOf(raw: string): Change | null {
  const lower = fold(raw)
  if (/\?\s*$/.test(raw.trim()) || /^(?:¿|como\s+va|en\s+que\s+va|que\s+paso|cual\s+es\s+el\s+estado|estado\s+del|ya\s+se\s+)/.test(lower)) return null
  if (/\b(?:ya\s+)?(?:pago|pagaron|pagad[oa]|consigno|transfirio)\b|\bpago\s+(?:verificado|recibido)\b|\b(?:llego|entro|recibi)\s+(?:el\s+)?pago\b|\b(?:marca|confirma|verifica)\w*\s+(?:el\s+)?pago\b/.test(lower) && !/\bno\s+(?:ha\s+)?pag/.test(lower)) return 'pagado'
  if (/\b(?:cancel|anul)\w*/.test(lower)) return 'cancelado'
  if (/\btransportadora\b/.test(lower) && /\b(?:entreg|despach|envi|marc|pas|sali|dej)\w*/.test(lower)) return 'enviado'
  if (/\bentregad[oa]\b|\bentregue\b|\bentregamos\b|\bentregal[oa]\b|\bya\s+(?:lo\s+)?recibio\b|\bya\s+le\s+llego\b|\b(?:lo\s+)?recogio\b|\b(?:lo\s+)?retiro\b/.test(lower)) return 'entregado'
  if (/\bdespach\w*|\benviad[oa]\b|\benvie\b|\benvial[oa]\b|\benviamos\b|\b(?:lo\s+)?mande\b|\bya\s+salio\b|\bsalio\s+(?:por|con)\b/.test(lower)) return 'enviado'
  if (/\b(?:prepar|alist|empac)\w*/.test(lower)) return 'preparando'
  if (/\b(?:confirm|acept|aprueb|aprob)\w*/.test(lower)) return 'confirmado'
  return null
}

export function methodOf(lower: string): DeliveryMethod | null {
  if (/\b(?:recogi\w*|retir\w*|en\s+(?:la\s+)?tienda|en\s+el\s+local|paso\s+por)\b/.test(lower)) return 'retiro_en_tienda'
  if (/\b(?:mensajer\w*|domicili\w*|moto)\b/.test(lower)) return 'mensajero'
  if (/\b(?:personal\w*|en\s+persona|yo\s+mism[oa]|se\s+lo\s+(?:entregue|lleve)|en\s+la\s+mano)\b/.test(lower)) return 'entrega_personal'
  if (/\btransportadora\b/.test(lower) || carrierOf(lower)) return 'transportadora'
  return null
}

type ListFilter = { status?: OrderStatus; view?: OrderView; period?: Period }
type Request =
  | { kind: 'show'; ref: Ref }
  | { kind: 'list'; filter: ListFilter }
  | { kind: 'summary' }
  | { kind: 'report'; period: Period; focus: 'sales' | 'orders' }
  | { kind: 'top'; period: Period }
  | { kind: 'change'; to: Change; ref: Ref | null }

const STATUS_WORDS: Array<[RegExp, OrderStatus]> = [
  [/\b(?:pendientes?|sin\s+confirmar|por\s+confirmar|nuevos)\b/, 'pendiente'], [/\bconfirmad[oa]s\b/, 'confirmado'],
  [/\b(?:en\s+preparacion|preparando|alistando)\b/, 'preparando'], [/\b(?:enviad[oa]s|despachad[oa]s)\b/, 'enviado'],
  [/\bentregad[oa]s\b/, 'entregado'], [/\b(?:cancelad[oa]s|anulad[oa]s)\b/, 'cancelado'],
]
const ABOUT_ORDERS = /\b(?:pedidos?|ordenes|orden|ventas?|vendi|vendido|vendimos|vendiste|despach\w*|facturad\w*)\b/
/** Only messages that plainly name orders or sales reach the model («vendí 2 de la 39» is an inventory movement). */
const MODEL_GATE = /\b(?:pedidos?|ordenes|ventas)\b/

/** Deterministic reading. Null = not about orders, or not clear enough (the model may read it when it is on). */
export function readOrderRequest(raw: string, context: { hasList: boolean; hasFocus: boolean }): Request | null {
  const lower = fold(raw.trim()).replace(/^[¿¡]+/, '')
  const about = ABOUT_ORDERS.test(lower)
  const ref = refOf(raw, context.hasList)
  const change = changeOf(raw)
  // A change needs an order named in the message, or the one being talked about.
  if (change && (about || ref) && (ref ? !ref.focus || context.hasFocus || about : true) && !/\bpedidos\b/.test(lower)) {
    return { kind: 'change', to: change, ref: ref && (!ref.focus || context.hasFocus) ? ref : context.hasFocus ? { focus: true } : null }
  }
  if (/\bmas\s+(?:vendid|pedid)\w*|\bque\s+(?:es\s+lo\s+que\s+)?mas\s+(?:se\s+)?(?:vende|pide|vendo|sale)\b|\blo\s+que\s+mas\s+(?:se\s+)?(?:vende|pide|sale)\b|\bproductos?\s+estrella\b/.test(lower)) {
    return { kind: 'top', period: periodOf(lower) || { key: 'dias', days: 30 } }
  }
  const period = periodOf(lower)
  if (/\bcuant[oa]s?\b.*\b(?:vendi|vendido|vendimos|vendiste|ventas|facturad\w*|llevo\s+vendido)\b|\b(?:como|que\s+tal)\s+(?:van|vamos|voy|estuvo|estuvieron|me\s+fue|nos\s+fue)\b.*\bventas?\b|\b(?:ventas|vendido)\s+(?:de|del|en)\b|\b(?:reporte|informe|resumen)\s+de\s+ventas\b/.test(lower)) {
    return { kind: 'report', period: period || { key: 'hoy' }, focus: 'sales' }
  }
  if (!/\bpedidos?\b|\bordenes\b/.test(lower)) {
    // «el 2», «muéstrame el último»: a reference with no other request is a look at that order.
    if (ref && !ref.focus && !change && (ref.code || ref.latest && /\bpedido|llego|entro\b/.test(lower) || ref.position && /^(?:(?:y|ver|muestrame|abre|dame|cual\s+es|como\s+va)\s+)?(?:el|la|al|numero)\s+\S+[?.! ]*$/.test(lower))) return { kind: 'show', ref }
    return null
  }
  if (/\bcuantos\s+pedidos\b|\b(?:reporte|informe)\s+de\s+pedidos\b|\bpedidos\s+(?:llegaron|entraron|recibi|recibidos)\b/.test(lower) && period) return { kind: 'report', period, focus: 'orders' }
  if (/\b(?:como|que\s+tal)\s+(?:van|vamos|voy|estan|andan)\b|\bresumen\b|\bcuantos\s+pedidos\b|\bestado\s+de\s+(?:los|mis)\s+pedidos\b/.test(lower) && !ref) return period ? { kind: 'report', period, focus: 'orders' } : { kind: 'summary' }
  if (ref && !/\bpedidos\b/.test(lower)) return { kind: 'show', ref }
  const view = detectOrderViewIntent(raw)
  if (view) return { kind: 'list', filter: { view } }
  const status = STATUS_WORDS.find(([pattern]) => pattern.test(lower))?.[1]
  if (/\bpedidos\b|\bordenes\b/.test(lower) && (status || period || /\b(?:que|cuales|mis|ver|muestrame|dame|lista\w*|tengo|hay|en\s+curso|abiertos)\b/.test(lower))) return { kind: 'list', filter: { ...(status ? { status } : {}), ...(period ? { period } : {}) } }
  return null
}

// ───────────────────────── Lecturas ─────────────────────────

const COLUMNS = `id, display_id, status, payment_status, revision, subtotal, shipping_cost, currency, items_json, customer_name, customer_city, delivery_method,
  payment_method, carrier, tracking_number, created_at, inventory_managed, shipping_status, shipped_at, delivered_at, tracking_url`

function whenOf(ctx: AssistantContext, order: Pick<OrderRow, 'created_at'>): string {
  const hours = Number(offset(ctx).split(' ')[0])
  const local = (date: Date) => new Date(date.getTime() + hours * 3600_000).toISOString().slice(0, 10)
  const created = new Date(`${order.created_at.replace(' ', 'T')}Z`)
  if (Number.isNaN(created.getTime())) return ''
  const day = local(created)
  if (day === local(new Date())) return 'hoy'
  if (day === local(new Date(Date.now() - 86_400_000))) return 'ayer'
  return `${day.slice(8, 10)}/${day.slice(5, 7)}`
}

const lineOf = (ctx: AssistantContext, order: OrderRow, index: number) =>
  `${index + 1}) <b>${escapeHtml(shortId(order))}</b> · ${ORDER_STATUS_LABELS[order.status]} · ${unitsOf(order)} u. · ${formatMoney(order.subtotal, order.currency)} · ${whenOf(ctx, order)}`

async function resolve(ctx: AssistantContext, ref: Ref | null, state: OrdersState): Promise<OrderRow | null> {
  if (!ref) return null
  if (ref.code) return findOrder(ctx.db, ctx.store.id, ref.code)
  if (ref.latest) return ctx.db.prepare(`SELECT ${COLUMNS} FROM orders WHERE store_id = ? ORDER BY id DESC LIMIT 1`).bind(ctx.store.id).first<OrderRow>()
  if (ref.position) { const id = fresh(state.at) ? state.list?.[ref.position - 1] : undefined; return id ? findOrder(ctx.db, ctx.store.id, id) : null }
  const focus = fresh(state.at) ? (await readSession(ctx.db, ctx.telegramUserId)).state.focusOrder : undefined
  return focus ? findOrder(ctx.db, ctx.store.id, focus) : null
}

function nextSteps(order: OrderRow): string {
  const next = ORDER_TRANSITIONS[order.status].map((status) => ORDER_STATUS_LABELS[status].toLowerCase())
  const pay = order.status !== 'cancelado' && order.payment_status !== 'verificado' ? 'marcar el pago' : ''
  const all = [...next, pay].filter(Boolean)
  return all.length ? `Puede pasar a: ${all.join(', ')}.` : ''
}

async function showOne(ctx: AssistantContext, order: OrderRow, lead = ''): Promise<void> {
  const items = parseOrderItems(order.items_json)
  const lines = items.slice(0, 8).map((item) => `• ${Number(item.quantity)} × ${escapeHtml(item.name)}${item.size ? ` (${escapeHtml(item.size)})` : ''}${item.color ? ` ${escapeHtml(item.color)}` : ''}`)
  const shipping = order.carrier || order.tracking_number ? `Envío: ${escapeHtml(order.carrier || 'sin transportadora')}${order.tracking_number ? ` · guía ${escapeHtml(order.tracking_number)}` : ''}` : order.customer_city ? `Ciudad: ${escapeHtml(order.customer_city)}` : ''
  await updateSessionState(ctx, { focusOrder: order.id })
  await saveOrders(ctx, { at: Date.now(), list: [order.id] })
  await say(ctx, [
    `${lead}Pedido <b>${escapeHtml(shortId(order))}</b> · ${ORDER_STATUS_LABELS[order.status]} · ${escapeHtml(PAYMENT_STATUS_LABELS[order.payment_status] || order.payment_status)} · ${whenOf(ctx, order)}`,
    ...lines, items.length > 8 ? `…y ${items.length - 8} más` : '',
    `Total productos: <b>${formatMoney(order.subtotal, order.currency)}</b>`,
    shipping,
    order.status === 'pendiente' ? 'Todavía es una solicitud: cuenta como venta cuando la confirmes.' : '',
    can(ctx.role, 'orders.manage') ? nextSteps(order) : '',
  ].filter(Boolean).join('\n'))
}

async function showList(ctx: AssistantContext, filter: ListFilter): Promise<void> {
  let orders: OrderRow[]
  let title: string
  if (filter.view) {
    orders = await listOrdersByView(ctx.db, ctx.store.id, filter.view)
    title = ({ por_enviar: 'Por enviar (confirmados o en preparación)', en_transportadora: 'Entregados a transportadora', en_transito: 'En tránsito', despachados_hoy: 'Despachados hoy', incidencias: 'Con incidencia de entrega' } as const)[filter.view]
  } else if (filter.period) {
    const sql = periodSql(ctx, filter.period)
    orders = (await ctx.db.prepare(`SELECT ${COLUMNS} FROM orders WHERE store_id = ? AND ${sql.where}${filter.status ? ' AND status = ?' : ''} ORDER BY id DESC LIMIT 10`)
      .bind(...[ctx.store.id, ...(filter.status ? [filter.status] : [])]).all<OrderRow>()).results || []
    title = `${sql.label}${filter.status ? ` · ${ORDER_STATUS_LABELS[filter.status].toLowerCase()}` : ''}`
  } else {
    orders = await listOpenOrders(ctx.db, ctx.store.id, filter.status)
    title = filter.status ? `Pedidos en estado «${ORDER_STATUS_LABELS[filter.status].toLowerCase()}»` : 'Pedidos en curso'
  }
  if (!orders.length) {
    await saveOrders(ctx, { list: undefined })
    await say(ctx, `${title}: no hay pedidos.`)
    return
  }
  const shown = orders.slice(0, 8)
  await saveOrders(ctx, { list: shown.map((order) => order.id), at: Date.now() })
  if (shown.length === 1) await updateSessionState(ctx, { focusOrder: shown[0]!.id })
  await say(ctx, `<b>${title}</b> (${orders.length}${orders.length >= 10 ? '+' : ''})\n${shown.map((order, index) => lineOf(ctx, order, index)).join('\n')}${orders.length > shown.length ? `\n…y ${orders.length - shown.length} más en el panel.` : ''}\n${shown.length === 1 ? 'Dime qué hago con él o escribe «ver» para el detalle.' : 'Dime cuál quieres ver («el 2») o qué hago con alguno.'}`)
}

async function showSummary(ctx: AssistantContext): Promise<void> {
  const counts = await orderStatusCounts(ctx.db, ctx.store.id)
  const today = periodSql(ctx, { key: 'hoy' })
  const arrived = Number((await ctx.db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE store_id = ? AND ${today.where}`).bind(ctx.store.id).first<{ n: number }>())?.n || 0)
  const sent = (counts.entregado_transportadora || 0) + (counts.en_transito || 0) + (counts.incidencia || 0)
  const parts = [
    counts.pendiente ? `${plural(counts.pendiente, 'pendiente', 'pendientes')} de confirmar` : '',
    counts.confirmado ? plural(counts.confirmado, 'confirmado', 'confirmados') : '',
    counts.preparando ? `${counts.preparando} en preparación` : '',
    sent ? `${plural(sent, 'enviado', 'enviados')}${counts.incidencia ? ` (${counts.incidencia} con incidencia)` : ''}` : '',
  ].filter(Boolean)
  await say(ctx, `${parts.length ? `Pedidos en curso: ${parts.join(' · ')}.` : 'No tienes pedidos en curso.'}\nHoy ${arrived === 1 ? 'llegó 1 pedido' : `llegaron ${arrived} pedidos`}.${counts.pendiente ? '\nLos pendientes son solicitudes: cuentan como venta cuando los confirmas.' : ''}`)
}

async function showReport(ctx: AssistantContext, period: Period, focus: 'sales' | 'orders'): Promise<void> {
  const sql = periodSql(ctx, period)
  const row = await ctx.db.prepare(
    `SELECT COUNT(*) AS n, COALESCE(SUM(subtotal - discount_total), 0) AS amount,
            COALESCE(SUM(status IN (${SALES})), 0) AS sales, COALESCE(SUM(CASE WHEN status IN (${SALES}) THEN subtotal - discount_total ELSE 0 END), 0) AS sales_amount,
            COALESCE(SUM(status = 'pendiente'), 0) AS pending, COALESCE(SUM(CASE WHEN status = 'pendiente' THEN subtotal - discount_total ELSE 0 END), 0) AS pending_amount,
            COALESCE(SUM(status = 'cancelado'), 0) AS cancelled
     FROM orders WHERE store_id = ? AND ${sql.where}`,
  ).bind(ctx.store.id).first<Record<string, number>>()
  const n = Number(row?.n || 0)
  const money = (value: unknown) => formatMoney(Number(value || 0), ctx.store.currency)
  const label = sql.label
  if (!n) { await say(ctx, `${label} no ${period.key === 'hoy' || period.key === 'semana' || period.key === 'mes' ? 'han llegado' : 'llegaron'} pedidos.`); return }
  const sales = Number(row?.sales || 0)
  const pending = Number(row?.pending || 0)
  const cancelled = Number(row?.cancelled || 0)
  const tail = [
    pending ? `${plural(pending, 'pedido espera', 'pedidos esperan')} tu confirmación (${money(row?.pending_amount)}) y todavía no ${pending === 1 ? 'cuenta' : 'cuentan'} como venta` : '',
    cancelled ? plural(cancelled, 'cancelado', 'cancelados') : '',
  ].filter(Boolean).join(' · ')
  const text = focus === 'sales'
    ? `${label}: ventas confirmadas por <b>${money(row?.sales_amount)}</b> en ${plural(sales, 'pedido', 'pedidos')}.${tail ? `\nAdemás: ${tail}.` : ''}`
    : `${label}: ${plural(n, 'pedido recibido', 'pedidos recibidos')} por ${money(row?.amount)}.\n${sales ? `${plural(sales, 'ya es venta confirmada', 'ya son ventas confirmadas')} (<b>${money(row?.sales_amount)}</b>)` : 'Ninguno confirmado todavía'}${tail ? ` · ${tail}` : ''}.`
  await say(ctx, `${text}\n<i>Valor de los productos, sin envío.</i>`)
}

async function showTop(ctx: AssistantContext, period: Period): Promise<void> {
  const sql = periodSql(ctx, period)
  const rows = (await ctx.db.prepare(`SELECT items_json FROM orders WHERE store_id = ? AND status IN (${SALES}) AND ${sql.where} ORDER BY id DESC LIMIT 500`).bind(ctx.store.id).all<{ items_json: string }>()).results || []
  const totals = new Map<string, { name: string; units: number; amount: number }>()
  for (const row of rows) for (const item of parseOrderItems(row.items_json)) {
    const key = item.name || item.sku
    const entry = totals.get(key) || { name: item.name, units: 0, amount: 0 }
    entry.units += Number(item.quantity || 0); entry.amount += Number(item.lineSubtotal || 0)
    totals.set(key, entry)
  }
  const top = [...totals.values()].sort((a, b) => b.units - a.units || b.amount - a.amount).slice(0, 5)
  if (!top.length) { await say(ctx, `${sql.label} no hay ventas confirmadas, así que todavía no hay un más vendido. Los pedidos sin confirmar no cuentan.`); return }
  await say(ctx, `<b>Lo más vendido · ${sql.label.toLowerCase()}</b> (ventas confirmadas)\n${top.map((item, index) => `${index + 1}) ${escapeHtml(item.name)} · ${item.units} u. · ${formatMoney(item.amount, ctx.store.currency)}`).join('\n')}`)
}

// ───────────────────────── Cambios: se muestran, se confirman y los aplica el motor ─────────────────────────


async function proposeChange(ctx: AssistantContext, order: OrderRow, to: Change, raw: string): Promise<OrderTool> {
  const tool: OrderTool = to === 'pagado' ? 'marcar_pago' : 'cambiar_estado_pedido'
  const id = escapeHtml(shortId(order))
  if (!ORDER_TOOLS[tool].allowed(ctx)) { await say(ctx, 'Tu rol en esta tienda no permite gestionar pedidos. Pídeselo al propietario o a un administrador.'); return tool }
  if (await getPendingOperation(ctx)) { await say(ctx, 'Tienes un cambio esperando confirmación. Confírmalo o cancélalo primero y luego vemos el pedido.'); return tool }
  await updateSessionState(ctx, { focusOrder: order.id })
  await saveOrders(ctx, { at: Date.now(), confirm: undefined, ask: undefined })
  if (to === 'pagado') {
    if (order.status === 'cancelado') { await say(ctx, `El pedido ${id} está cancelado; no le marco pago.`); return tool }
    if (order.payment_status === 'verificado') { await say(ctx, `El pedido ${id} ya tiene el pago verificado.`); return tool }
    await saveOrders(ctx, { confirm: { orderId: order.id, to, revision: order.revision, at: Date.now() } })
    await say(ctx, `Pedido <b>${id}</b> (${formatMoney(order.subtotal, order.currency)}): marco el <b>pago como verificado</b>. Hazlo solo si el dinero ya está en tu cuenta.\n¿Confirmas?`)
    return tool
  }
  if (order.status === to) { await say(ctx, `El pedido ${id} ya está como “${ORDER_STATUS_LABELS[to]}”.`); return tool }
  if (!ORDER_TRANSITIONS[order.status].includes(to)) {
    const next = ORDER_TRANSITIONS[order.status].map((status) => ORDER_STATUS_LABELS[status]).join(' o ')
    await say(ctx, `El pedido ${id} está como “${ORDER_STATUS_LABELS[order.status]}” y no puede pasar a “${ORDER_STATUS_LABELS[to]}”.${next ? ` Desde ahí puede pasar a: ${next}.` : ' Ya no admite más cambios de estado.'}`)
    return tool
  }
  const lower = fold(raw)
  let hint = ''
  if (to === 'enviado') {
    const guide = parseGuideText(raw)
    const carrier = guide.carrier || carrierOf(raw)
    if (!carrier) {
      await saveOrders(ctx, { ask: { kind: 'carrier', orderId: order.id, revision: order.revision, at: Date.now() } })
      await say(ctx, `Para despachar el pedido <b>${id}</b>, ¿con qué transportadora salió y cuál es la guía? Por ejemplo «Servientrega 700012345678». La guía no se inventa: si aún no la tienes, dime solo la transportadora.`)
      return tool
    }
    await updateSessionState(ctx, { pendingDelivery: { orderId: order.id, carrier: carrier.slice(0, 60), ...(guide.trackingNumber ? { trackingNumber: guide.trackingNumber } : {}) } })
    hint = `Sale con ${escapeHtml(carrier)}${guide.trackingNumber ? ` · guía ${escapeHtml(guide.trackingNumber)}` : ' (sin número de guía)'}. No significa que el cliente ya lo recibió.`
  } else if (to === 'entregado') {
    const method = methodOf(lower) || (order.status === 'enviado' && order.carrier ? 'transportadora' : null)
    if (!method) {
      await saveOrders(ctx, { ask: { kind: 'method', orderId: order.id, revision: order.revision, at: Date.now() } })
      await say(ctx, `¿Cómo se entregó el pedido <b>${id}</b>? Por transportadora, entrega personal, retiro en tienda o mensajero.`)
      return tool
    }
    await updateSessionState(ctx, { pendingDelivery: { orderId: order.id, method } })
    hint = `Entrega: ${DELIVERY_METHOD_LABELS[method].toLowerCase()}. El estado del pago no cambia.`
  } else if (to === 'confirmado') hint = 'Se reservan las existencias de cada talla; si no alcanzan, no se confirma.'
  else if (to === 'cancelado') hint = order.status === 'pendiente' ? 'No se publicó ni descontó nada.' : 'Las existencias reservadas vuelven al inventario.'
  await saveOrders(ctx, { confirm: { orderId: order.id, to, revision: order.revision, at: Date.now() } })
  await say(ctx, `Pedido <b>${id}</b> (${unitsOf(order)} u. · ${formatMoney(order.subtotal, order.currency)}): ${ORDER_STATUS_LABELS[order.status]} → <b>${ORDER_STATUS_LABELS[to]}</b>.${hint ? ` ${hint}` : ''}\n¿Confirmas?`)
  return tool
}

const AFFIRM = /^(?:(?:si+|sip|dale|hagale|hagalo|hazlo|confirm\w*|listo|de\s+una|aplica\w*|correcto|ok|okay|adelante|perfecto|claro|eso)\b[\s,.!]*){1,3}(?:por\s+favor)?[\s.!]*$/
const DENY = /^(?:no+|nop|mejor\s+no|cancel\w*|dejal[oa]\s+asi|dejal[oa]|todavia\s+no|aun\s+no|espera\w*|olvidal[oa])\b/

async function applyConfirmed(ctx: AssistantContext, confirm: NonNullable<OrdersState['confirm']>): Promise<void> {
  await saveOrders(ctx, { confirm: undefined, ask: undefined, at: Date.now() })
  // The engine applies it with its own checks (role, revision, valid transition, stock) and writes the audit trail.
  const sub = { ...ctx, capture: [] as NonNullable<AssistantContext['capture']> }
  const data = confirm.to === 'pagado' ? `ord:${ctx.store.id}:pay:${confirm.orderId}:${confirm.revision}` : `ord:${ctx.store.id}:ok:${confirm.orderId}:${confirm.to}:${confirm.revision}`
  await handleOrderCallback(sub, data)
  await say(ctx, sub.capture[0]?.text || 'No pude actualizar el pedido. No cambié nada.')
}

// ───────────────────────── El modelo, solo cuando las reglas no bastan ─────────────────────────

const modelSchema = z.object({
  tool: z.enum(['ver_pedido', 'listar_pedidos', 'resumen_pedidos', 'reporte_periodo', 'mas_vendidos', 'cambiar_estado_pedido', 'marcar_pago', 'otro_tema']),
  pedido: z.string().trim().max(40).nullish(),
  estado: z.string().trim().max(20).nullish(),
  periodo: z.enum(['hoy', 'ayer', 'semana', 'mes', 'mes_pasado', 'dias']).nullish(),
  dias: z.number().int().min(1).max(365).nullish(),
  enfoque: z.enum(['ventas', 'pedidos']).nullish(),
})
const MODEL_SCHEMA = {
  type: 'object',
  properties: {
    tool: { type: 'string', enum: ['ver_pedido', 'listar_pedidos', 'resumen_pedidos', 'reporte_periodo', 'mas_vendidos', 'cambiar_estado_pedido', 'marcar_pago', 'otro_tema'] },
    pedido: { type: 'string' }, estado: { type: 'string', enum: ['pendiente', 'confirmado', 'preparando', 'enviado', 'entregado', 'cancelado'] },
    periodo: { type: 'string', enum: ['hoy', 'ayer', 'semana', 'mes', 'mes_pasado', 'dias'] }, dias: { type: 'integer' }, enfoque: { type: 'string', enum: ['ventas', 'pedidos'] },
  },
  required: ['tool'],
}
const MODEL_SYSTEM = [
  'Eres el intérprete de pedidos del Asistente TiendIA. Lees el mensaje de un comerciante y respondes SOLO con una herramienta y sus campos. No conoces los datos de la tienda, no afirmas cifras y nunca confirmas un cambio: el sistema muestra el cambio y el comerciante lo confirma.',
  '- ver_pedido {pedido}: ver un pedido. "pedido" es el código que escribió (por ejemplo AB12CD34), "ultimo" para el más reciente, "foco" para el pedido del que se viene hablando, o el número de la lista ("2").',
  '- listar_pedidos {estado?, periodo?, dias?}: listas de pedidos ("qué pedidos tengo", "los que faltan por confirmar" = estado pendiente, "los de hoy").',
  '- resumen_pedidos: cómo van los pedidos en general.',
  '- reporte_periodo {periodo, dias?, enfoque}: cuánto se vendió (enfoque ventas) o cuántos pedidos llegaron (enfoque pedidos) en hoy, ayer, semana (esta semana), mes (este mes), mes_pasado o dias (últimos N días).',
  '- mas_vendidos {periodo?, dias?}: los productos que más se venden.',
  '- cambiar_estado_pedido {pedido, estado}: confirmar (confirmado), alistar (preparando), despachar (enviado), entregar (entregado) o cancelar (cancelado) un pedido. Solo si el comerciante lo pide o afirma que ya pasó; una pregunta ("¿ya se envió?") es ver_pedido.',
  '- marcar_pago {pedido}: el cliente ya pagó.',
  '- otro_tema: el mensaje no es sobre pedidos ni ventas (productos, inventario, precios, fotos, publicidad, saludos).',
  UNTRUSTED_CONTENT_RULE,
]

async function askModel(ctx: AssistantContext, text: string, state: OrdersState): Promise<{ request: Request | null; usage?: GeminiJsonResult['usage'] } | null> {
  if (!ctx.env.GEMINI_API_KEY) return null
  const timeout = Math.min(20000, Math.max(2000, Number(ctx.env.ASSISTANT_AGENT_TIMEOUT_MS) || 9000))
  const timed: typeof fetch = (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(timeout) })
  const context = `Tienda: ${ctx.store.name}\n${fresh(state.at) && state.list?.length ? `Hay una lista numerada de ${state.list.length} pedido(s) en pantalla.` : 'No hay lista de pedidos en pantalla.'}\nMensaje del comerciante: ${text.slice(0, 600)}`
  const outcome = await withAiBudget(ctx, 'pedidos', () => callGeminiJson(ctx.env, timed, { system: MODEL_SYSTEM, parts: [{ text: context }], schema: MODEL_SCHEMA, maxOutputTokens: 200, thinkingBudget: 0 })).catch(() => null)
  if (!outcome || !outcome.ok) return null
  const parsed = modelSchema.safeParse(outcome.value.data)
  if (!parsed.success) return null
  const step = parsed.data
  const period: Period | null = step.periodo ? { key: step.periodo, ...(step.periodo === 'dias' ? { days: step.dias || 7 } : {}) } : null
  const word = fold(step.pedido || '')
  const ref: Ref | null = !word ? null : word === 'ultimo' ? { latest: true } : word === 'foco' ? { focus: true } : /^\d{1,2}$/.test(word) && fresh(state.at) && state.list?.length ? { position: Number(word) } : { code: step.pedido!.trim() }
  const status = step.estado && isOrderStatus(step.estado) ? step.estado : null
  let request: Request | null = null
  if (step.tool === 'ver_pedido') request = ref ? { kind: 'show', ref } : null
  else if (step.tool === 'listar_pedidos') request = { kind: 'list', filter: { ...(status ? { status } : {}), ...(period ? { period } : {}) } }
  else if (step.tool === 'resumen_pedidos') request = { kind: 'summary' }
  else if (step.tool === 'reporte_periodo') request = { kind: 'report', period: period || { key: 'hoy' }, focus: step.enfoque === 'pedidos' ? 'orders' : 'sales' }
  else if (step.tool === 'mas_vendidos') request = { kind: 'top', period: period || { key: 'dias', days: 30 } }
  // The model may name a change only when the merchant's own words carry one: it never invents an order to modify.
  else if (step.tool === 'cambiar_estado_pedido') request = status && changeOf(text) ? { kind: 'change', to: status, ref } : ref ? { kind: 'show', ref } : null
  else if (step.tool === 'marcar_pago') request = changeOf(text) === 'pagado' ? { kind: 'change', to: 'pagado', ref } : ref ? { kind: 'show', ref } : null
  return { request, usage: outcome.value.usage }
}

// ───────────────────────── Mensajes mixtos: pedidos y catálogo en la misma frase ─────────────────────────

const GENERIC = new Set(['pedido', 'pedidos', 'venta', 'ventas', 'producto', 'productos', 'tienda', 'para', 'nuevo', 'nueva', 'original', 'hombre', 'mujer', 'dama', 'caballero', 'unisex', 'talla', 'color', 'marca', 'envio', 'guia', 'semana', 'ayer'])
const stem = (word: string) => word.replace(/(?:es|s)$/, '')

/** The message names a product of this store («cuánto vendí de las sandalias»): it is a catalogue matter, and the
 * totals of this layer would answer something the merchant did not ask. */
async function namesProduct(ctx: AssistantContext, raw: string): Promise<boolean> {
  const words = new Set(fold(raw).split(/[^a-z0-9-]+/).filter((word) => word.length >= 4).map(stem))
  if (!words.size) return false
  const catalog = await loadCatalog(ctx)
  return catalog.some((product) => words.has(stem(fold(product.sku))) || fold(product.name).split(/[^a-z0-9]+/).some((token) => token.length >= 4 && !GENERIC.has(token) && !colorOf(token) && words.has(stem(token))))
}
const isTotals = (request: Request) => request.kind === 'report' || request.kind === 'top' || request.kind === 'summary' || request.kind === 'list'

/**
 * Several requests in one message. The parts about orders are answered here, in order; the catalogue and inventory
 * parts go to the text layer with their own words. One change waits for confirmation at a time: after an order
 * change is proposed, what is left is named back to the merchant instead of being dropped or half-applied.
 * Returns null when no part is about orders (the whole message follows its usual path).
 */
async function handleMixed(ctx: AssistantContext, parts: string[], started: number): Promise<boolean | null> {
  const state = await readOrders(ctx)
  const context = { hasList: fresh(state.at) && Boolean(state.list?.length), hasFocus: fresh(state.at) }
  const read: Array<{ part: string; request: Request | null }> = []
  for (const part of parts) {
    const request = readOrderRequest(part, context)
    read.push({ part, request: request && isTotals(request) && await namesProduct(ctx, part) ? null : request })
  }
  if (!read.some((item) => item.request)) return null
  if (await getPendingOperation(ctx)) return null
  const rest: string[] = []
  let proposed = false
  for (const item of read) {
    if (!item.request || proposed) { rest.push(item.part); continue }
    const tool = await run(ctx, item.request, await readOrders(ctx), item.part)
    const after = await readOrders(ctx)
    if (item.request.kind === 'change' && (after.confirm || after.ask)) proposed = true
    await measure(ctx, started, tool, `mixed_${item.request.kind}`)
  }
  if (!rest.length) return true
  const left = escapeHtml(rest.join(' y '))
  if (proposed) { await say(ctx, `Lo otro que me pediste («${left}») dímelo cuando terminemos con el pedido; no lo perdí de vista, pero va un cambio a la vez.`); return true }
  if (await handleAgentText(ctx, rest.join(' y ')) !== 'handled') await say(ctx, `Lo de «${left}» dímelo en un mensaje aparte, por favor.`)
  return true
}

// ───────────────────────── Entrada ─────────────────────────

async function run(ctx: AssistantContext, request: Request, state: OrdersState, raw: string): Promise<OrderTool | 'aclarar'> {
  if (request.kind === 'summary') { await showSummary(ctx); return 'resumen_pedidos' }
  if (request.kind === 'report') { await showReport(ctx, request.period, request.focus); return 'reporte_periodo' }
  if (request.kind === 'top') { await showTop(ctx, request.period); return 'mas_vendidos' }
  if (request.kind === 'list') { await showList(ctx, request.filter); return 'listar_pedidos' }
  const order = await resolve(ctx, request.ref, state)
  if (!order) {
    const named = request.ref?.code ? `No encontré el pedido ${escapeHtml(request.ref.code)} en <b>${escapeHtml(ctx.store.name)}</b>.` : request.ref?.position ? 'Ese número no está en la última lista que te mostré.' : request.ref?.latest ? 'Todavía no hay pedidos en esta tienda.' : '¿De cuál pedido me hablas?'
    const open = await listOpenOrders(ctx.db, ctx.store.id)
    if (!open.length) { await say(ctx, `${named}${request.ref?.latest ? '' : ' No tienes pedidos en curso.'}`); return 'aclarar' }
    const shown = open.slice(0, 5)
    await saveOrders(ctx, { list: shown.map((item) => item.id), at: Date.now() })
    await say(ctx, `${named} Estos están en curso:\n${shown.map((item, index) => lineOf(ctx, item, index)).join('\n')}\nDime el número o el código.`)
    return 'aclarar'
  }
  if (request.kind === 'show') { await showOne(ctx, order); return 'ver_pedido' }
  return proposeChange(ctx, order, request.to, raw)
}

/**
 * Text or transcribed voice. Returns true when the message was about orders or reports and was answered here.
 * Runs before the text layer and the previous engine; anything else returns false and follows its usual path.
 */
export async function handleAgentOrders(ctx: AssistantContext, text: string): Promise<boolean> {
  if (!ordersEnabled(ctx)) return false
  const started = Date.now()
  const raw = text.trim()
  if (!raw || raw.startsWith('/')) return false
  const lower = fold(raw)
  let state = await readOrders(ctx)

  if (state.confirm) {
    const confirm = state.confirm
    const stale = !fresh(confirm.at) || Boolean(await getPendingOperation(ctx))
    if (!stale && AFFIRM.test(lower)) { await applyConfirmed(ctx, confirm); await measure(ctx, started, 'confirmar', confirm.to); return true }
    if (!stale && DENY.test(lower) && !refOf(raw, false)?.code) {
      await saveOrders(ctx, { confirm: undefined, ask: undefined, at: Date.now() })
      await updateSessionState(ctx, { pendingDelivery: undefined })
      await say(ctx, 'Listo, el pedido sigue como estaba. No cambié nada.')
      await measure(ctx, started, 'cancelar', confirm.to)
      return true
    }
    // Anything else leaves the change unapplied: a later «sí» about something else can never apply it.
    await saveOrders(ctx, { confirm: undefined })
    await updateSessionState(ctx, { pendingDelivery: undefined })
    if (!stale) ctx.afterNote = 'El cambio del pedido quedó sin aplicar; si lo quieres, pídemelo de nuevo.'
    state = { ...state, confirm: undefined }
  }
  if (state.ask) {
    const ask = state.ask
    await saveOrders(ctx, { ask: undefined })
    state = { ...state, ask: undefined }
    const order = fresh(ask.at) && !DENY.test(lower) ? await findOrder(ctx.db, ctx.store.id, ask.orderId) : null
    if (DENY.test(lower) && fresh(ask.at)) { await say(ctx, 'Listo, el pedido sigue como estaba. No cambié nada.'); await measure(ctx, started, 'cancelar', ask.kind); return true }
    if (order && ask.kind === 'carrier') {
      const guide = parseGuideText(raw)
      const free = raw.match(/^([A-Za-zÁÉÍÓÚÑáéíóúñ][\wÁÉÍÓÚÑáéíóúñ .-]{1,40}?)(?:\s+(?:gu[ií]a\s*)?([A-Z0-9-]{5,30}))?[.! ]*$/i)
      const carrier = guide.carrier || carrierOf(raw) || (free && !ABOUT_ORDERS.test(lower) && free[1]!.trim().split(/\s+/).length <= 3 ? free[1]!.trim() : null)
      if (carrier) {
        const tracking = guide.trackingNumber || (free?.[2] && /\d{4,}/.test(free[2]) ? free[2].toUpperCase() : undefined)
        await measure(ctx, started, await proposeChange(ctx, order, 'enviado', `${carrier}${tracking ? ` guía ${tracking}` : ''} transportadora ${carrier}`), 'carrier')
        return true
      }
    }
    if (order && ask.kind === 'method') {
      const method = methodOf(lower)
      if (method) { await measure(ctx, started, await proposeChange(ctx, order, 'entregado', raw), 'method'); return true }
    }
  }

  if (looksMulti(raw)) {
    const parts = splitTasks(raw)
    const mixed = parts.length > 1 ? await handleMixed(ctx, parts, started) : null
    if (mixed !== null) return mixed
    if (parts.length > 1) return false
  }
  const context = { hasList: fresh(state.at) && Boolean(state.list?.length), hasFocus: fresh(state.at) }
  let request = readOrderRequest(raw, context)
  // Totals of orders are not the answer to a question about one product.
  if (request && isTotals(request) && await namesProduct(ctx, raw)) return false
  if (!request && context.hasFocus && /^(?:ver|verlo|muestramelo|muestrame(?:lo)?|el\s+detalle|detalle|abrelo)[.! ]*$/.test(lower)) request = { kind: 'show', ref: state.list?.length === 1 ? { position: 1 } : { focus: true } }
  let path = 'orders'
  let usage: GeminiJsonResult['usage'] | undefined
  if (!request) {
    // Not clear by rules but plainly about orders or sales: the model reads it. It only names a tool.
    if (!MODEL_GATE.test(lower) || parseCommerce(raw) || await getPendingOperation(ctx)) return false
    const read = await askModel(ctx, raw, state)
    if (!read?.request) { if (read) await measure(ctx, started, 'aclarar', 'not_orders', 'orders_model', read.usage); return false }
    request = read.request; usage = read.usage; path = 'orders_model'
  }
  // «confírmalo» with a catalogue change waiting belongs to that change, not to the order that was on screen.
  if (request.kind === 'change' && !request.ref?.code && !request.ref?.position && !request.ref?.latest && await getPendingOperation(ctx)) return false
  await measure(ctx, started, await run(ctx, request, state, raw), request.kind, path, usage)
  return true
}
