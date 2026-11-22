/** Bold «Botón de pagos» (https://developers.bold.co/pagos-en-linea/boton-de-pagos).
 *
 * - The store's identity key is public (it goes in the button). The secret key is stored encrypted and only used here:
 *   to sign the integrity hash SHA-256(reference + amount + currency + secret) and to check webhook signatures
 *   (HMAC-SHA256 of the Base64 raw body, header x-bold-signature).
 * - Each time the buyer opens the gateway a payment attempt with a unique reference is created. The amount is always
 *   computed on the server from the order (products − coupon + the store's fixed shipping).
 * - An order is marked paid only from Bold itself: a signed webhook or the transaction query API
 *   (GET /v2/payment-voucher/<reference>, «Authorization: x-api-key <identity key>»), never from the redirect URL,
 *   and only when the approved total equals the attempt amount.
 */
import type { Env } from '../index'
import { decryptStoreSecret, encryptStoreSecret, hintOf } from '../ai/ownKey'
import { transitionOrder } from './orders'
import { notifyPaymentResult } from './paymentNotices'

type Bindings = Env['Bindings']

export const BOLD_API = 'https://payments.api.bold.co'
export const BOLD_MIN_AMOUNT = 1000
const VAULT_PURPOSE = 'bold'
const IDENTITY_SHAPE = /^[A-Za-z0-9_-]{16,120}$/
const SECRET_SHAPE = /^[A-Za-z0-9_-]{12,120}$/

export class BoldError extends Error {
  constructor(readonly code: string, message: string, readonly status: 400 | 403 | 404 | 409 | 502 | 503 = 400) { super(message) }
}

export type GatewayRow = {
  store_id: number; enabled: number; mode: 'test' | 'live'; identity_key: string
  secret_ciphertext: string; secret_iv: string; secret_key_version: number; secret_hint: string
  shipping_fee: number; updated_by: string; updated_at: string
}

export type AttemptStatus = 'creado' | 'en_proceso' | 'aprobado' | 'rechazado' | 'fallido' | 'anulado' | 'monto_distinto'

const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('')

export async function integritySignature(reference: string, amount: number, currency: string, secret: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${reference}${amount}${currency}${secret}`)))
}

/** Bold signs the Base64 encoding of the raw body with HMAC-SHA256 and the secret key (hex). */
export async function webhookSignature(rawBody: string, secret: string): Promise<string> {
  const bytes = new TextEncoder().encode(rawBody)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(btoa(binary))))
}

function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// ---- store settings ------------------------------------------------------------------

export async function getGateway(db: D1Database, storeId: number): Promise<GatewayRow | null> {
  return db.prepare("SELECT * FROM store_payment_gateways WHERE store_id = ? AND provider = 'bold'").bind(storeId).first<GatewayRow>()
}

/** What the storefront needs: nothing secret. */
export async function publicBoldConfig(db: D1Database, storeId: number): Promise<{ mode: 'test' | 'live'; shippingFee: number } | null> {
  const row = await getGateway(db, storeId).catch(() => null)
  return row && row.enabled ? { mode: row.mode, shippingFee: Number(row.shipping_fee || 0) } : null
}

export function boldSettingsView(row: GatewayRow | null) {
  return row
    ? { configured: true, enabled: Boolean(row.enabled), mode: row.mode, identityKey: row.identity_key, secretHint: row.secret_hint, shippingFee: Number(row.shipping_fee || 0), updatedAt: row.updated_at, updatedBy: row.updated_by }
    : { configured: false, enabled: false, mode: 'test' as const, identityKey: '', secretHint: '', shippingFee: 0, updatedAt: null, updatedBy: null }
}

export type BoldSettingsInput = { identityKey?: unknown; secretKey?: unknown; mode?: unknown; enabled?: unknown; shippingFee?: unknown }

export async function saveBoldSettings(db: D1Database, env: Bindings, storeId: number, input: BoldSettingsInput, actor: string) {
  const current = await getGateway(db, storeId)
  const identityKey = typeof input.identityKey === 'string' && input.identityKey.trim() ? input.identityKey.trim() : current?.identity_key
  const secretKey = typeof input.secretKey === 'string' && input.secretKey.trim() ? input.secretKey.trim() : null
  if (!identityKey || !IDENTITY_SHAPE.test(identityKey)) throw new BoldError('INVALID_IDENTITY_KEY', 'La llave de identidad no parece válida. Cópiala completa desde Bold.')
  if (!current && !secretKey) throw new BoldError('SECRET_REQUIRED', 'Pega la llave secreta del Botón de pagos.')
  if (secretKey && !SECRET_SHAPE.test(secretKey)) throw new BoldError('INVALID_SECRET_KEY', 'La llave secreta no parece válida. Cópiala completa desde Bold.')
  const mode = input.mode === undefined ? current?.mode || 'test' : input.mode
  if (mode !== 'test' && mode !== 'live') throw new BoldError('INVALID_MODE', 'Elige modo de pruebas o producción.')
  const shippingFee = input.shippingFee === undefined ? Number(current?.shipping_fee || 0) : Number(input.shippingFee)
  if (!Number.isSafeInteger(shippingFee) || shippingFee < 0 || shippingFee > 10_000_000) throw new BoldError('INVALID_SHIPPING', 'El envío fijo debe ser un valor entero sin decimales.')
  const enabled = input.enabled === undefined ? Boolean(current?.enabled) : input.enabled === true
  let sealed = current ? { ciphertext: current.secret_ciphertext, iv: current.secret_iv, version: current.secret_key_version } : null
  let hint = current?.secret_hint || ''
  if (secretKey) {
    sealed = await encryptStoreSecret(env, storeId, VAULT_PURPOSE, secretKey).catch(() => { throw new BoldError('VAULT_UNAVAILABLE', 'No se pueden guardar llaves en esta plataforma todavía.', 503) })
    hint = hintOf(secretKey)
  }
  await db.prepare(`INSERT INTO store_payment_gateways (store_id, provider, enabled, mode, identity_key, secret_ciphertext, secret_iv, secret_key_version, secret_hint, shipping_fee, updated_by)
    VALUES (?, 'bold', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(store_id, provider) DO UPDATE SET enabled = excluded.enabled, mode = excluded.mode, identity_key = excluded.identity_key,
      secret_ciphertext = excluded.secret_ciphertext, secret_iv = excluded.secret_iv, secret_key_version = excluded.secret_key_version,
      secret_hint = excluded.secret_hint, shipping_fee = excluded.shipping_fee, updated_by = excluded.updated_by, updated_at = datetime('now')`)
    .bind(storeId, enabled ? 1 : 0, mode, identityKey, sealed!.ciphertext, sealed!.iv, sealed!.version, hint, shippingFee, actor).run()
  await db.prepare(`INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id) VALUES ('payment_gateway_updated', 'store', ?, ?, ?, 'admin', ?)`)
    .bind(String(storeId), JSON.stringify({ provider: 'bold', enabled, mode, shippingFee, secretReplaced: Boolean(secretKey) }), actor, storeId).run()
  return boldSettingsView(await getGateway(db, storeId))
}

async function secretOf(env: Bindings, row: GatewayRow): Promise<string> {
  try { return await decryptStoreSecret(env, row.store_id, VAULT_PURPOSE, { ciphertext: row.secret_ciphertext, iv: row.secret_iv, key_version: row.secret_key_version }) }
  catch { throw new BoldError('VAULT_UNAVAILABLE', 'El pago en línea no está disponible en este momento.', 503) }
}

// ---- checkout -------------------------------------------------------------------------

type OrderForPayment = { id: number; store_id: number; display_id: string; subtotal: number; discount_total: number | null; shipping_cost: number | null; currency: string; status: string; payment_status: string; payment_provider: string | null }

export const orderAmount = (order: Pick<OrderForPayment, 'subtotal' | 'discount_total' | 'shipping_cost'>) =>
  Number(order.subtotal || 0) - Number(order.discount_total || 0) + Number(order.shipping_cost || 0)

const MAX_ATTEMPTS_PER_ORDER = 15

/** Creates a payment attempt and returns the signed button attributes. */
export async function createBoldCheckout(db: D1Database, env: Bindings, input: { storeId: number; storeName: string; displayId: string; checkoutKey: string; returnUrl: string }) {
  const gateway = await getGateway(db, input.storeId)
  if (!gateway?.enabled) throw new BoldError('BOLD_DISABLED', 'Esta tienda no tiene activo el pago en línea.', 409)
  const order = await db.prepare(`SELECT id, store_id, display_id, subtotal, discount_total, shipping_cost, currency, status, payment_status, payment_provider
    FROM orders WHERE store_id = ? AND display_id = ? AND idempotency_key = ?`).bind(input.storeId, input.displayId, input.checkoutKey).first<OrderForPayment>()
  if (!order) throw new BoldError('ORDER_NOT_FOUND', 'No encontramos el pedido.', 404)
  if (order.payment_provider !== 'bold') throw new BoldError('NOT_ONLINE_ORDER', 'Este pedido no se registró para pago en línea.', 409)
  if (order.payment_status === 'verificado') throw new BoldError('ALREADY_PAID', 'Este pedido ya está pagado.', 409)
  if (order.status === 'cancelado') throw new BoldError('ORDER_CANCELLED', 'Este pedido fue cancelado.', 409)
  const currency = String(order.currency || 'COP').toUpperCase()
  if (currency !== 'COP' && currency !== 'USD') throw new BoldError('CURRENCY_UNSUPPORTED', 'Bold solo cobra en pesos colombianos o dólares.', 409)
  const amount = orderAmount(order)
  if (!Number.isSafeInteger(amount) || amount < BOLD_MIN_AMOUNT) throw new BoldError('AMOUNT_TOO_LOW', 'El valor mínimo para pagar en línea es $1.000.', 409)
  const count = await db.prepare('SELECT COUNT(*) n FROM payment_attempts WHERE order_id = ?').bind(order.id).first<{ n: number }>()
  if (Number(count?.n || 0) >= MAX_ATTEMPTS_PER_ORDER) throw new BoldError('TOO_MANY_ATTEMPTS', 'Superaste los intentos de pago de este pedido. Escríbele al comercio.', 409)
  // Unique per opening of the gateway (letters, digits and dashes, ≤ 60 characters).
  const reference = `${order.display_id}-${Date.now().toString(36).toUpperCase()}${crypto.randomUUID().slice(0, 4).toUpperCase()}`
  const secret = await secretOf(env, gateway)
  const signature = await integritySignature(reference, amount, currency, secret)
  await db.prepare(`INSERT INTO payment_attempts (store_id, order_id, provider, reference, amount, currency, mode) VALUES (?, ?, 'bold', ?, ?, ?, ?)`)
    .bind(input.storeId, order.id, reference, amount, currency, gateway.mode).run()
  const description = `Pedido ${order.display_id} · ${input.storeName}`.replace(/https?:\/\/\S+/g, '').slice(0, 100).trim()
  return {
    apiKey: gateway.identity_key, reference, amount, currency, signature, mode: gateway.mode,
    description: description.length >= 2 ? description : `Pedido ${order.display_id}`,
    redirectionUrl: input.returnUrl,
  }
}

// ---- results -------------------------------------------------------------------------

const FINAL_FROM_BOLD: Record<string, AttemptStatus> = {
  APPROVED: 'aprobado', REJECTED: 'rechazado', FAILED: 'fallido', VOIDED: 'anulado', PROCESSING: 'en_proceso', PENDING: 'en_proceso',
  SALE_APPROVED: 'aprobado', SALE_REJECTED: 'rechazado', VOID_APPROVED: 'anulado',
}

type AttemptRow = { id: number; store_id: number; order_id: number; reference: string; amount: number; currency: string; status: AttemptStatus; mode: string }

const FINAL_STATES: AttemptStatus[] = ['aprobado', 'rechazado', 'fallido', 'anulado', 'monto_distinto']

/** Applies a result reported by Bold to an attempt and, when it is an approval for the exact amount, to its order.
 * Idempotent: repeated or late reports never move a final state backwards; only a void can follow an approval. */
/** What an approval did to the order: stock set aside, no stock left, order was cancelled, or the order was already paid. */
export type PaymentOutcome = 'apartado' | 'sin_stock' | 'cancelado' | 'duplicado' | null

/** Where the result came from: with an environment the team and the buyer are notified (in the background when `defer` exists). */
export type NoticeHooks = { env: Bindings; defer?: (task: Promise<unknown>) => void; payerEmail?: string | null }

export async function applyBoldResult(db: D1Database, attempt: AttemptRow, result: { status: string; total?: number | null; txId?: string | null; method?: string | null; source: 'webhook' | 'consulta' }, hooks?: NoticeHooks) {
  let next = FINAL_FROM_BOLD[result.status]
  if (!next) return attempt.status
  if (next === 'aprobado' && result.total != null && Math.round(Number(result.total)) !== Number(attempt.amount)) next = 'monto_distinto'
  if (attempt.status === next) return next
  if (FINAL_STATES.includes(attempt.status) && !(attempt.status === 'aprobado' && next === 'anulado')) return attempt.status

  const changed = await db.prepare(`UPDATE payment_attempts SET status = ?, provider_tx_id = COALESCE(?, provider_tx_id), provider_method = COALESCE(?, provider_method),
    last_source = ?, updated_at = datetime('now') WHERE id = ? AND status = ?`)
    .bind(next, result.txId ?? null, result.method ?? null, result.source, attempt.id, attempt.status).run()
  if (!Number(changed.meta.changes || 0)) return (await findAttempt(db, attempt.reference))?.status ?? attempt.status

  const label = `Bold${attempt.mode === 'test' ? ' (modo de pruebas)' : ''} · ref. ${attempt.reference}${result.txId ? ` · transacción ${result.txId}` : ''}`
  const note = next === 'monto_distinto' ? `${label}. Bold aprobó ${result.total} pero el pedido es de ${attempt.amount}: revísalo antes de despachar.` : label
  await db.prepare(`INSERT INTO order_events (order_id, event_type, to_value, note, performed_by) VALUES (?, 'pago_en_linea', ?, ?, 'Bold')`).bind(attempt.order_id, next, note).run()

  const paymentStatus = next === 'aprobado' ? 'verificado' : next === 'anulado' ? 'reembolsado' : null
  let outcome: PaymentOutcome = null
  if (paymentStatus) {
    for (let tries = 0; tries < 3; tries++) {
      const order = await db.prepare('SELECT revision, status, payment_status FROM orders WHERE id = ? AND store_id = ?').bind(attempt.order_id, attempt.store_id).first<{ revision: number; status: string; payment_status: string }>()
      if (!order) break
      // The order was already paid with another attempt (the buyer paid twice): the team must refund this one.
      if (next === 'aprobado' && order.payment_status === 'verificado') { outcome = 'duplicado'; break }
      if (order.payment_status === paymentStatus) break
      const base = { storeId: attempt.store_id, orderId: attempt.order_id, expectedRevision: Number(order.revision), actor: 'Bold', source: 'pasarela' as const, paymentStatus: paymentStatus as 'verificado' | 'reembolsado' }
      // A paid order is confirmed at once so its stock is set aside (the database reserves it on confirmation):
      // two buyers can never both pay for the last unit and wait for a manual confirmation.
      if (next === 'aprobado' && order.status === 'pendiente') {
        const confirmed = await transitionOrder(db, { ...base, status: 'confirmado', note: 'Confirmado automáticamente: Bold aprobó el pago' })
        if (confirmed.ok) { outcome = 'apartado'; break }
        if (confirmed.code === 'STALE') continue
        if (confirmed.code !== 'INSUFFICIENT_STOCK') break
        outcome = 'sin_stock'
      } else if (next === 'aprobado' && order.status === 'cancelado') outcome = 'cancelado'
      const done = await transitionOrder(db, base)
      if (done.ok || done.code !== 'STALE') break
    }
  }
  // Only the request that moved the attempt gets here, so each result is announced once.
  if (hooks && (next === 'aprobado' || next === 'anulado' || next === 'monto_distinto')) {
    const task = notifyPaymentResult(hooks.env, db, {
      storeId: attempt.store_id, orderId: attempt.order_id, reference: attempt.reference, status: next, outcome, amount: Number(attempt.amount),
      currency: attempt.currency, mode: attempt.mode as 'test' | 'live', approvedTotal: result.total ?? null, txId: result.txId ?? null, method: result.method ?? null, payerEmail: hooks.payerEmail ?? null,
    }).catch(() => undefined)
    if (hooks.defer) hooks.defer(task)
    else await task
  }
  return next
}

/** Asks Bold for the attempt's state (used when the buyer comes back; webhooks are the main path). */
export async function refreshAttemptFromBold(db: D1Database, attempt: AttemptRow, fetcher: typeof fetch = fetch, hooks?: NoticeHooks): Promise<AttemptStatus> {
  if (FINAL_STATES.includes(attempt.status)) return attempt.status
  const gateway = await getGateway(db, attempt.store_id)
  if (!gateway) return attempt.status
  let response: Response
  try {
    response = await fetcher(`${BOLD_API}/v2/payment-voucher/${encodeURIComponent(attempt.reference)}`, { headers: { Authorization: `x-api-key ${gateway.identity_key}` } })
  } catch { return attempt.status }
  if (!response.ok) return attempt.status
  const data = await response.json().catch(() => null) as { payment_status?: string; total?: number; transaction_id?: string; payment_method?: string; payer_email?: string } | null
  if (!data?.payment_status || data.payment_status === 'NO_TRANSACTION_FOUND') return attempt.status
  return applyBoldResult(db, attempt, { status: data.payment_status, total: data.total ?? null, txId: data.transaction_id ?? null, method: data.payment_method ?? null, source: 'consulta' }, hooks && { ...hooks, payerEmail: data.payer_email ?? null })
}

export async function findAttempt(db: D1Database, reference: string): Promise<AttemptRow | null> {
  return db.prepare('SELECT id, store_id, order_id, reference, amount, currency, status, mode FROM payment_attempts WHERE reference = ?').bind(reference).first<AttemptRow>()
}

/** Signed webhook from Bold. Returns a short result code (stored, never the payload). */
export async function handleBoldWebhook(db: D1Database, env: Bindings, rawBody: string, signature: string, defer?: (task: Promise<unknown>) => void): Promise<{ status: number; result: string }> {
  let event: { id?: string; type?: string; subject?: string; data?: { payment_id?: string; payment_method?: string; payer_email?: string; metadata?: { reference?: string }; amount?: { total?: number } } }
  try { event = JSON.parse(rawBody) } catch { return { status: 400, result: 'json_invalido' } }
  const reference = String(event.data?.metadata?.reference || '')
  const eventId = String(event.id || event.subject || '')
  const type = String(event.type || '')
  if (!reference || !eventId || !type) return { status: 400, result: 'evento_incompleto' }
  const attempt = await findAttempt(db, reference)
  if (!attempt) return { status: 200, result: 'referencia_desconocida' }
  const gateway = await getGateway(db, attempt.store_id)
  if (!gateway) return { status: 200, result: 'sin_pasarela' }
  const expected = await webhookSignature(rawBody, await secretOf(env, gateway))
  if (!signature || !sameText(expected, signature.trim().toLowerCase())) return { status: 401, result: 'firma_invalida' }
  const inserted = await db.prepare(`INSERT OR IGNORE INTO payment_webhook_events (provider, event_id, event_type, reference, store_id, result) VALUES ('bold', ?, ?, ?, ?, 'recibido')`)
    .bind(eventId, type, reference, attempt.store_id).run()
  if (!Number(inserted.meta.changes || 0)) return { status: 200, result: 'duplicado' }
  const next = await applyBoldResult(db, attempt, { status: type, total: event.data?.amount?.total ?? null, txId: event.data?.payment_id ?? null, method: event.data?.payment_method ?? null, source: 'webhook' }, { env, defer, payerEmail: event.data?.payer_email ?? null })
  await db.prepare(`UPDATE payment_webhook_events SET result = ? WHERE provider = 'bold' AND event_id = ?`).bind(next, eventId).run()
  return { status: 200, result: next }
}

/** Safety net for the webhook: every cron tick (15 min) asks Bold about recent attempts that are still open, so a
 * payment is confirmed (and announced) even if the webhook never arrives and the buyer closed the page.
 * Only attempts between 2 minutes and 72 hours old, newest first, a few per tick. */
export async function reconcileBoldPayments(env: Bindings, db: D1Database, fetcher: typeof fetch = fetch, limit = 40): Promise<{ checked: number; changed: number }> {
  const { results } = await db.prepare(`SELECT id, store_id, order_id, reference, amount, currency, status, mode FROM payment_attempts
    WHERE status IN ('creado', 'en_proceso') AND created_at <= datetime('now', '-2 minutes') AND created_at >= datetime('now', '-72 hours')
    ORDER BY id DESC LIMIT ?`).bind(limit).all<AttemptRow>()
  let changed = 0
  for (const attempt of results || []) {
    try {
      const next = await refreshAttemptFromBold(db, attempt, fetcher, { env })
      if (next !== attempt.status) changed += 1
    } catch { /* one attempt failing never stops the rest */ }
  }
  return { checked: (results || []).length, changed }
}
