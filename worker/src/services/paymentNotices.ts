/** Avisos de pagos en línea (Bold). Cuando Bold confirma, anula o aprueba un monto distinto:
 * - el equipo de la tienda recibe el aviso por Telegram y por WhatsApp (los números vinculados al asistente);
 * - si el pago quedó aprobado, el comprador recibe un correo de confirmación.
 * Nada de esto cambia el pedido: solo informa. Un aviso que falla nunca deshace el pago registrado. */
import type { Env } from '../index'
import { sendEmail, isEmail } from '../email/send'
import { legacyOwnerIds } from './assistant/context'
import { sendTelegramMessage } from './assistant/telegramApi'
import { escapeHtml, formatMoney } from './assistant/tools'
import { orderRecipients, parseOrderItems } from './orders'
import { htmlToWhatsApp } from '../whatsapp/format'
import { sendWahaText, wahaConfigured, wahaEnabled } from '../whatsapp/waha'
import { sendWhatsApp, whatsappConfigured, whatsappEnabled } from '../whatsapp/api'
import { getStoreById, publicStoreUrl } from '../tenancy/stores'

type Bindings = Env['Bindings']

export type PaymentNoticeInput = {
  storeId: number
  orderId: number
  reference: string
  status: 'aprobado' | 'anulado' | 'monto_distinto'
  amount: number
  currency: string
  mode: 'test' | 'live'
  approvedTotal?: number | null
  txId?: string | null
  method?: string | null
  /** Correo que el comprador escribió en Bold (respaldo si no lo dejó en la tienda). */
  payerEmail?: string | null
}

type OrderRow = {
  id: number; display_id: string; customer_name: string | null; customer_email: string | null; customer_phone: string | null
  customer_city: string | null; delivery_address: string | null; items_json: string; subtotal: number; discount_total: number
  shipping_cost: number | null; currency: string
}

const METHOD_LABELS: Record<string, string> = {
  CREDIT_CARD: 'Tarjeta de crédito', DEBIT_CARD: 'Tarjeta débito', PSE: 'PSE', NEQUI: 'Nequi', BOTON_BANCOLOMBIA: 'Botón Bancolombia',
  DAVIPLATA: 'Daviplata', DAVIPLATA_PUSH: 'Daviplata', CASH: 'Efectivo',
}
export const methodLabel = (method?: string | null) => (method ? METHOD_LABELS[method.toUpperCase()] || method.replace(/_/g, ' ').toLowerCase() : 'Pago en línea')

/** Texto (HTML de Telegram) para el equipo. */
export function teamNotice(storeName: string, order: Pick<OrderRow, 'display_id' | 'customer_name'>, notice: PaymentNoticeInput): string {
  const test = notice.mode === 'test' ? '\n🧪 Modo de pruebas de Bold: no se cobró dinero real.' : ''
  const who = order.customer_name ? ` · ${escapeHtml(order.customer_name)}` : ''
  const ref = `\nRef. Bold ${escapeHtml(notice.reference)}${notice.txId ? ` · transacción ${escapeHtml(notice.txId)}` : ''}`
  if (notice.status === 'aprobado') {
    return `✅ <b>Pago confirmado por Bold en ${escapeHtml(storeName)}</b>\n${escapeHtml(order.display_id)}${who}\n💳 ${formatMoney(notice.amount, notice.currency)} · ${escapeHtml(methodLabel(notice.method))}${ref}\n\nEl pedido quedó como <b>Pago verificado</b>. Confírmalo y prepáralo para el despacho.${test}`
  }
  if (notice.status === 'anulado') {
    return `↩️ <b>Bold anuló un pago en ${escapeHtml(storeName)}</b>\n${escapeHtml(order.display_id)}${who}\n💳 ${formatMoney(notice.amount, notice.currency)}${ref}\n\nEl pedido quedó como <b>Reembolsado</b>. No lo despaches.${test}`
  }
  return `⚠️ <b>Pago con monto distinto en ${escapeHtml(storeName)}</b>\n${escapeHtml(order.display_id)}${who}\nBold aprobó ${formatMoney(Number(notice.approvedTotal || 0), notice.currency)}, pero el pedido es de ${formatMoney(notice.amount, notice.currency)}.${ref}\n\nEl pedido NO quedó pagado: revísalo con el cliente antes de despachar.${test}`
}

/** Números de WhatsApp vinculados al asistente por las personas activas del equipo de la tienda. */
async function whatsappRecipients(db: D1Database, storeId: number): Promise<Array<{ phone: string | null; businessUserId: string | null }>> {
  const { results } = await db.prepare(
    `SELECT DISTINCT w.phone AS phone, w.business_user_id AS businessUserId FROM whatsapp_identities w
     JOIN platform_users u ON u.id = w.user_id AND u.status = 'active'
     JOIN store_memberships m ON m.user_id = w.user_id AND m.store_id = ? AND m.status = 'active'
     WHERE w.status = 'active'`,
  ).bind(storeId).all<{ phone: string | null; businessUserId: string | null }>()
  return results || []
}

async function sendTeamWhatsApp(env: Bindings, db: D1Database, storeId: number, html: string): Promise<number> {
  const viaWaha = wahaEnabled(env) && wahaConfigured(env)
  const viaMeta = !viaWaha && whatsappEnabled(env) && whatsappConfigured(env)
  if (!viaWaha && !viaMeta) return 0
  const text = htmlToWhatsApp(html)
  let sent = 0
  for (const to of await whatsappRecipients(db, storeId)) {
    try {
      if (viaWaha) await sendWahaText(env, to, text)
      else await sendWhatsApp(env, to, { type: 'text', text: { body: text, preview_url: false } })
      sent += 1
    } catch { /* un número que falla no frena a los demás */ }
  }
  return sent
}

async function sendTeamTelegram(env: Bindings, db: D1Database, storeId: number, orderId: number, html: string): Promise<number> {
  if (!env.TELEGRAM_BOT_TOKEN) return 0
  const recipients = await orderRecipients(db, storeId, await legacyOwnerIds(db, env))
  const results = await Promise.all(recipients.map((chatId) => sendTelegramMessage(env.TELEGRAM_BOT_TOKEN!, Number(chatId), html, 'HTML', {
    inline_keyboard: [[{ text: '🧾 Ver pedido', callback_data: `ord:${storeId}:view:${orderId}` }]],
  }).then(() => true).catch(() => false)))
  return results.filter(Boolean).length
}

/** Detalle del pedido en texto (cada línea un producto). */
export function orderDetail(order: Pick<OrderRow, 'items_json' | 'discount_total' | 'shipping_cost' | 'currency'>): string {
  const lines = parseOrderItems(order.items_json).map((item) => {
    const variant = [item.size, item.color].filter(Boolean).join(' · ')
    return `${item.quantity} × ${item.name}${variant ? ` (${variant})` : ''}: ${formatMoney(Number(item.lineSubtotal || item.price * item.quantity || 0), order.currency)}`
  })
  if (Number(order.discount_total) > 0) lines.push(`Descuento: −${formatMoney(Number(order.discount_total), order.currency)}`)
  if (order.shipping_cost != null) lines.push(`Envío: ${Number(order.shipping_cost) > 0 ? formatMoney(Number(order.shipping_cost), order.currency) : 'gratis'}`)
  return lines.join('\n')
}

const brandColor = (value?: string | null) => (/^#[0-9a-f]{6}$/i.test((value || '').trim()) ? value!.trim().toUpperCase() : '')

function paletteOf(themeJson?: string | null): Partial<Record<'background' | 'text' | 'button' | 'buttonText', string>> {
  try {
    const palette = (JSON.parse(themeJson || '{}') as { style?: { palette?: Record<string, unknown> } }).style?.palette || {}
    return Object.fromEntries(Object.entries(palette).filter(([, value]) => typeof value === 'string')) as Partial<Record<'background' | 'text' | 'button' | 'buttonText', string>>
  } catch { return {} }
}

const luminance = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i]!, 0)
const contrastOk = (a: string, b: string) => {
  if (!brandColor(a) || !brandColor(b)) return false
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m)
  return (x! + 0.05) / (y! + 0.05) >= 4.5
}

/** Dark text on light store colors (like lime) and white text on dark ones. */
export function readableOn(hex: string): string {
  return luminance(hex) > 0.4 ? '#16131F' : '#FFFFFF'
}

/** Store assets are saved as paths (/api/assets/…); emails need the full https address. */
export function absoluteAsset(baseUrl: string | undefined, path?: string | null): string {
  const value = (path || '').trim()
  if (/^https:\/\//i.test(value)) return value
  if (!value.startsWith('/')) return ''
  try { return new URL(value, new URL(baseUrl || '').origin).toString().replace(/^http:/, 'https:') } catch { return '' }
}

/** 573022323472 → +57 302 232 3472 (otros países: +<dígitos>). */
export function displayPhone(digits: string): string {
  const match = /^57(\d{3})(\d{3})(\d{4})$/.exec(digits)
  return match ? `+57 ${match[1]} ${match[2]} ${match[3]}` : `+${digits}`
}

async function sendBuyerEmail(env: Bindings, db: D1Database, storeName: string, order: OrderRow, notice: PaymentNoticeInput): Promise<string> {
  const to = [order.customer_email, notice.payerEmail].map((value) => (value || '').trim()).find(isEmail)
  if (!to) return 'sin_correo'
  const store = await getStoreById(db, notice.storeId)
  const config = await db.prepare(`SELECT COALESCE(NULLIF(whatsapp_orders, ''), whatsapp_phone) AS whatsapp_phone, logo_url, primary_color, button_color, email, theme_config
    FROM store_config WHERE id = ?`).bind(notice.storeId).first<{ whatsapp_phone: string | null; logo_url: string | null; primary_color: string | null; button_color: string | null; email: string | null; theme_config: string | null }>()
  const phone = (config?.whatsapp_phone || '').replace(/\D/g, '')
  // The store's own palette (Apariencia), so the logo sits on the same background it has in the store.
  const palette = paletteOf(config?.theme_config)
  const color = brandColor(palette.button) || brandColor(config?.button_color) || brandColor(config?.primary_color) || '#16131F'
  const header = brandColor(palette.background) || '#FFFFFF'
  const logo = absoluteAsset(env.PUBLIC_STORE_BASE_URL, config?.logo_url)
  const storeEmail = isEmail((config?.email || '').trim()) ? config!.email!.trim() : ''
  const whatsappText = `Hola ${storeName}, tengo una pregunta sobre mi pedido ${order.display_id}.`
  const result = await sendEmail(db, env, {
    template: { key: 'order_paid' },
    to,
    // El comprador ve a la tienda como remitente y sus respuestas le llegan a la tienda (si tiene correo).
    fromName: storeName,
    replyTo: storeEmail || null,
    values: {
      logo_comercio: logo,
      color_comercio: color,
      color_texto_comercio: brandColor(palette.buttonText) || readableOn(color),
      color_cabecera: header,
      // The logo already shows the name; without a logo the name is the header.
      nombre_cabecera: logo ? '' : storeName,
      color_texto_cabecera: brandColor(palette.text) && contrastOk(header, palette.text!) ? brandColor(palette.text) : readableOn(header),
      enlace_whatsapp_comercio: phone ? `https://wa.me/${phone}?text=${encodeURIComponent(whatsappText)}` : (store ? publicStoreUrl(env.PUBLIC_STORE_BASE_URL, store) : ''),
      correo_comercio: storeEmail,
      nombre_usuario: (order.customer_name || '').split(' ')[0] || 'Hola',
      correo_usuario: to,
      nombre_comercio: storeName,
      numero_pedido: order.display_id,
      total_pagado: formatMoney(notice.amount, notice.currency),
      medio_pago: `${methodLabel(notice.method)}${notice.mode === 'test' ? ' (modo de pruebas: no se cobró dinero real)' : ''}`,
      referencia_pago: notice.txId || notice.reference,
      detalle_pedido: orderDetail(order),
      direccion_entrega: [order.delivery_address, order.customer_city].filter(Boolean).join(', ') || 'La que acordaste con el comercio',
      contacto_comercio: phone ? displayPhone(phone) : 'Escríbenos desde la tienda',
      enlace_tienda: store ? publicStoreUrl(env.PUBLIC_STORE_BASE_URL, store) : '',
    },
    purpose: 'pago_confirmado',
    storeId: notice.storeId,
    requestedBy: 'Bold',
    // Un solo correo por pago, aunque Bold repita el aviso o el comprador recargue.
    idempotencyKey: `order_paid:${notice.reference}`,
  })
  return result.status
}

export async function notifyPaymentResult(env: Bindings, db: D1Database, notice: PaymentNoticeInput): Promise<{ telegram: number; whatsapp: number; email: string }> {
  const order = await db.prepare(`SELECT id, display_id, customer_name, customer_email, customer_phone, customer_city, delivery_address, items_json, subtotal,
    discount_total, shipping_cost, currency FROM orders WHERE id = ? AND store_id = ?`).bind(notice.orderId, notice.storeId).first<OrderRow>()
  if (!order) return { telegram: 0, whatsapp: 0, email: 'sin_pedido' }
  const storeName = (await db.prepare('SELECT name FROM store_config WHERE id = ?').bind(notice.storeId).first<{ name: string }>())?.name || 'tu tienda'
  const html = teamNotice(storeName, order, notice)
  const [telegram, whatsapp, email] = await Promise.all([
    sendTeamTelegram(env, db, notice.storeId, order.id, html).catch(() => 0),
    sendTeamWhatsApp(env, db, notice.storeId, html).catch(() => 0),
    notice.status === 'aprobado' ? sendBuyerEmail(env, db, storeName, order, notice).catch(() => 'fallido') : Promise.resolve('no_aplica'),
  ])
  return { telegram, whatsapp, email }
}
