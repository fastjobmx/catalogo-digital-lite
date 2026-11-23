/** Pago del plan de TiendIA Exprés con Bold (la cuenta Bold de la PLATAFORMA, no la de cada tienda).
 *
 * - Llaves en el Worker: PLATFORM_BOLD_IDENTITY_KEY (pública, va en el botón), PLATFORM_BOLD_SECRET_KEY (secreto) y
 *   PLATFORM_BOLD_MODE (test | live). Sin llaves, todo sigue como antes: ventas escribe con los datos de pago.
 * - El comercio paga la contratación abierta (store_plan_requests 'pendiente_pago'): cada apertura de la pasarela
 *   crea un intento con referencia única y el monto sale siempre de la contratación, nunca del navegador.
 * - El plan se activa solo con la confirmación de Bold (webhook firmado o consulta), por el valor exacto, y solo
 *   en modo producción: un pago de pruebas nunca regala un plan (salvo PLATFORM_BOLD_TEST_ACTIVATES=true en local).
 */
import type { Env } from '../index'
import { BOLD_API, BOLD_MIN_AMOUNT, FINAL_FROM_BOLD, integritySignature, sameText, webhookSignature, type AttemptStatus } from './bold'
import { activatePlanRequest, TrialFlowError } from './freeTrial'

type Bindings = Env['Bindings']

const IDENTITY_SHAPE = /^[A-Za-z0-9_-]{16,120}$/
const SECRET_SHAPE = /^[A-Za-z0-9_-]{12,120}$/
const MAX_ATTEMPTS_PER_REQUEST = 15
const FINAL: AttemptStatus[] = ['aprobado', 'rechazado', 'fallido', 'anulado', 'monto_distinto']

export type PlatformBold = { identityKey: string; secret: string; mode: 'test' | 'live' }

/** The platform's own Bold account, or null when it is not configured (then plans are paid as before). */
export function platformBold(env: Partial<Bindings>): PlatformBold | null {
  const identityKey = String(env.PLATFORM_BOLD_IDENTITY_KEY || '').trim()
  const secret = String(env.PLATFORM_BOLD_SECRET_KEY || '').trim()
  const mode = String(env.PLATFORM_BOLD_MODE || 'test').trim() === 'live' ? 'live' : 'test'
  if (!IDENTITY_SHAPE.test(identityKey) || !SECRET_SHAPE.test(secret)) return null
  return { identityKey, secret, mode }
}

/** A test-mode approval activates a plan only where it is explicitly allowed (local and staging checks). */
const testActivates = (env: Partial<Bindings>) => String(env.PLATFORM_BOLD_TEST_ACTIVATES || '').toLowerCase() === 'true'

/** Merchants are offered the online payment only when it really activates the plan: live keys, or test keys where
 * test approvals are allowed to activate. With production test keys the panel keeps the sales flow. */
export function platformBoldOffered(env: Partial<Bindings>): PlatformBold | null {
  const bold = platformBold(env)
  return bold && (bold.mode === 'live' || testActivates(env)) ? bold : null
}

/** What the panel may know: only whether plans can be paid online and in which mode. */
export function platformBoldPublic(env: Partial<Bindings>): { mode: 'test' | 'live' } | null {
  const bold = platformBoldOffered(env)
  return bold ? { mode: bold.mode } : null
}

type RequestRow = { id: number; store_id: number; code: string; plan_code: string; billing_cycle: string; amount: number; currency: string; status: string }
export type PlanAttemptRow = { id: number; request_id: number; store_id: number; reference: string; amount: number; currency: string; status: AttemptStatus; mode: 'test' | 'live' }

/** Owner: opens Bold for the store's pending plan request. Returns the signed values for Bold's checkout. */
export async function createPlanCheckout(db: D1Database, env: Bindings, input: { storeId: number; returnUrl: string; actor: string }) {
  const bold = platformBoldOffered(env)
  if (!bold) throw new TrialFlowError('ONLINE_PAYMENT_UNAVAILABLE', 'El pago en línea del plan no está disponible. Nuestro equipo de ventas te escribe con los datos de pago.', 409)
  const request = await db.prepare(`SELECT r.id, r.store_id, r.code, r.plan_code, r.billing_cycle, r.amount, r.currency, r.status, p.name AS plan_name
    FROM store_plan_requests r LEFT JOIN plans p ON p.code = r.plan_code WHERE r.store_id = ? AND r.status = 'pendiente_pago'`).bind(input.storeId).first<RequestRow & { plan_name: string | null }>()
  if (!request) throw new TrialFlowError('NO_OPEN_REQUEST', 'Primero elige tu plan.', 409)
  const currency = String(request.currency || 'COP').toUpperCase()
  if (currency !== 'COP') throw new TrialFlowError('CURRENCY_UNSUPPORTED', 'Este plan no se puede pagar en línea. Escríbenos por WhatsApp.', 409)
  const amount = Number(request.amount)
  if (!Number.isSafeInteger(amount) || amount < BOLD_MIN_AMOUNT) throw new TrialFlowError('AMOUNT_TOO_LOW', 'Este valor no se puede pagar en línea. Escríbenos por WhatsApp.', 409)
  const count = await db.prepare('SELECT COUNT(*) AS n FROM plan_payment_attempts WHERE request_id = ?').bind(request.id).first<{ n: number }>()
  if (Number(count?.n || 0) >= MAX_ATTEMPTS_PER_REQUEST) throw new TrialFlowError('TOO_MANY_ATTEMPTS', 'Superaste los intentos de pago de esta contratación. Escríbenos por WhatsApp y te ayudamos.', 429)
  // Unique per opening of the gateway (letters, digits and dashes, ≤ 60 characters).
  const reference = `${request.code}-${Date.now().toString(36).toUpperCase()}${crypto.randomUUID().slice(0, 4).toUpperCase()}`
  await db.prepare(`INSERT INTO plan_payment_attempts (request_id, store_id, reference, amount, currency, mode, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(request.id, request.store_id, reference, amount, currency, bold.mode, input.actor.slice(0, 160)).run()
  const cycle = request.billing_cycle === 'anual' ? 'anual' : 'mensual'
  return {
    apiKey: bold.identityKey, reference, amount, currency, mode: bold.mode,
    signature: await integritySignature(reference, amount, currency, bold.secret),
    description: `Plan ${request.plan_name || request.plan_code} (${cycle}) · TiendIA Exprés · ${request.code}`.slice(0, 100),
    redirectionUrl: input.returnUrl,
    request: { code: request.code, planName: request.plan_name || request.plan_code, cycle, amount, currency },
  }
}

export async function findPlanAttempt(db: D1Database, reference: string): Promise<PlanAttemptRow | null> {
  return db.prepare('SELECT id, request_id, store_id, reference, amount, currency, status, mode FROM plan_payment_attempts WHERE reference = ?').bind(reference).first<PlanAttemptRow>()
}

async function platformEvent(db: D1Database, storeId: number, level: 'info' | 'warning', code: string, detail: string) {
  await db.prepare(`INSERT INTO platform_events (store_id, level, source, code, detail) VALUES (?, ?, 'bold-plan', ?, ?)`).bind(storeId, level, code, detail.slice(0, 500)).run().catch(() => undefined)
}

/** Applies a result reported by Bold. Idempotent: a final state never moves back (only a void follows an approval).
 * An approval for the exact amount activates the plan through the same step the platform uses by hand. */
export async function applyPlanPayment(db: D1Database, env: Bindings, attempt: PlanAttemptRow,
  result: { status: string; total?: number | null; txId?: string | null; method?: string | null; source: 'webhook' | 'consulta' }): Promise<AttemptStatus> {
  let next = FINAL_FROM_BOLD[result.status]
  if (!next) return attempt.status
  if (next === 'aprobado' && result.total != null && Math.round(Number(result.total)) !== Number(attempt.amount)) next = 'monto_distinto'
  if (attempt.status === next) return next
  if (FINAL.includes(attempt.status) && !(attempt.status === 'aprobado' && next === 'anulado')) return attempt.status
  const changed = await db.prepare(`UPDATE plan_payment_attempts SET status = ?, provider_tx_id = COALESCE(?, provider_tx_id), provider_method = COALESCE(?, provider_method),
    last_source = ?, updated_at = datetime('now') WHERE id = ? AND status = ?`)
    .bind(next, result.txId ?? null, result.method ?? null, result.source, attempt.id, attempt.status).run()
  if (!Number(changed.meta.changes || 0)) return (await findPlanAttempt(db, attempt.reference))?.status ?? attempt.status

  const ref = `Bold ${result.txId || attempt.reference}${attempt.mode === 'test' ? ' (modo de pruebas)' : ''}`
  let outcome = next as string
  if (next === 'aprobado') {
    if (attempt.mode === 'test' && !testActivates(env)) {
      outcome = 'prueba_sin_activar'
      await platformEvent(db, attempt.store_id, 'info', 'PLAN_TEST_PAYMENT', `${attempt.reference}: pago de pruebas aprobado; el plan no se activa en modo de pruebas.`)
    } else {
      try {
        const done = await activatePlanRequest(db, env, { id: attempt.request_id }, { actor: 'Bold', paymentReference: ref })
        // Another payment had already activated this request: this one is a duplicate to refund.
        outcome = done.replayed ? 'duplicado' : 'plan_activado'
        if (done.replayed) await platformEvent(db, attempt.store_id, 'warning', 'PLAN_PAYMENT_DUPLICATE', `${attempt.reference}: el plan ya estaba activo; devuelve este pago desde Bold (${ref}).`)
      } catch (error) {
        outcome = 'revisar'
        const why = error instanceof TrialFlowError ? error.message : 'error al activar'
        await platformEvent(db, attempt.store_id, 'warning', 'PLAN_PAYMENT_NEEDS_REVIEW', `${attempt.reference}: Bold aprobó el pago pero no se activó el plan (${why}). Revísalo o devuelve el pago.`)
      }
    }
  } else if (next === 'monto_distinto') {
    await platformEvent(db, attempt.store_id, 'warning', 'PLAN_PAYMENT_AMOUNT_MISMATCH', `${attempt.reference}: Bold aprobó ${result.total} pero la contratación es de ${attempt.amount}. No se activó el plan.`)
  } else if (next === 'anulado') {
    await platformEvent(db, attempt.store_id, 'warning', 'PLAN_PAYMENT_VOIDED', `${attempt.reference}: Bold anuló un pago de plan. Revisa si el plan debe seguir activo.`)
  }
  await db.prepare(`UPDATE plan_payment_attempts SET outcome = ? WHERE id = ?`).bind(outcome, attempt.id).run()
  return next
}

/** Asks Bold about one attempt (when the owner comes back, and from the cron). */
export async function refreshPlanAttempt(db: D1Database, env: Bindings, attempt: PlanAttemptRow, fetcher: typeof fetch = fetch): Promise<AttemptStatus> {
  if (FINAL.includes(attempt.status)) return attempt.status
  const bold = platformBold(env)
  if (!bold) return attempt.status
  let response: Response
  try { response = await fetcher(`${BOLD_API}/v2/payment-voucher/${encodeURIComponent(attempt.reference)}`, { headers: { Authorization: `x-api-key ${bold.identityKey}` } }) }
  catch { return attempt.status }
  if (!response.ok) return attempt.status
  const data = await response.json().catch(() => null) as { payment_status?: string; total?: number; transaction_id?: string; payment_method?: string } | null
  if (!data?.payment_status || data.payment_status === 'NO_TRANSACTION_FOUND') return attempt.status
  return applyPlanPayment(db, env, attempt, { status: data.payment_status, total: data.total ?? null, txId: data.transaction_id ?? null, method: data.payment_method ?? null, source: 'consulta' })
}

/** Webhook for a plan payment: signed with the PLATFORM's secret. */
export async function handlePlanWebhook(db: D1Database, env: Bindings, attempt: PlanAttemptRow, rawBody: string, signature: string,
  event: { eventId: string; type: string; total?: number | null; txId?: string | null; method?: string | null }): Promise<{ status: number; result: string }> {
  const bold = platformBold(env)
  if (!bold) return { status: 200, result: 'sin_pasarela' }
  const expected = await webhookSignature(rawBody, bold.secret)
  if (!signature || !sameText(expected, signature.trim().toLowerCase())) return { status: 401, result: 'firma_invalida' }
  const inserted = await db.prepare(`INSERT OR IGNORE INTO payment_webhook_events (provider, event_id, event_type, reference, store_id, result) VALUES ('bold', ?, ?, ?, ?, 'recibido')`)
    .bind(event.eventId, event.type, attempt.reference, attempt.store_id).run()
  if (!Number(inserted.meta.changes || 0)) return { status: 200, result: 'duplicado' }
  const next = await applyPlanPayment(db, env, attempt, { status: event.type, total: event.total ?? null, txId: event.txId ?? null, method: event.method ?? null, source: 'webhook' })
  await db.prepare(`UPDATE payment_webhook_events SET result = ? WHERE provider = 'bold' AND event_id = ?`).bind(`plan:${next}`, event.eventId).run()
  return { status: 200, result: `plan:${next}` }
}

/** Safety net for the webhook (every cron tick): open plan attempts between 2 minutes and 72 hours old. */
export async function reconcilePlanPayments(env: Bindings, db: D1Database, fetcher: typeof fetch = fetch, limit = 20): Promise<{ checked: number; changed: number }> {
  if (!platformBold(env)) return { checked: 0, changed: 0 }
  const { results } = await db.prepare(`SELECT id, request_id, store_id, reference, amount, currency, status, mode FROM plan_payment_attempts
    WHERE status IN ('creado', 'en_proceso') AND created_at <= datetime('now', '-2 minutes') AND created_at >= datetime('now', '-72 hours')
    ORDER BY id DESC LIMIT ?`).bind(limit).all<PlanAttemptRow>()
  let changed = 0
  for (const attempt of results || []) {
    try { if ((await refreshPlanAttempt(db, env, attempt, fetcher)) !== attempt.status) changed += 1 } catch { /* next one */ }
  }
  return { checked: (results || []).length, changed }
}

/** Owner came back from Bold: the state comes from Bold and from the request, never from the address bar. */
export async function planPaymentStatus(db: D1Database, env: Bindings, storeId: number, reference: string) {
  const attempt = await findPlanAttempt(db, reference)
  if (!attempt || attempt.store_id !== storeId) throw new TrialFlowError('PAYMENT_NOT_FOUND', 'No encontramos ese pago.', 404)
  const attemptStatus = await refreshPlanAttempt(db, env, attempt)
  const row = await db.prepare(`SELECT a.outcome, a.mode, r.code, r.status AS request_status, r.amount, r.currency, p.name AS plan_name FROM plan_payment_attempts a
    JOIN store_plan_requests r ON r.id = a.request_id LEFT JOIN plans p ON p.code = r.plan_code WHERE a.id = ?`).bind(attempt.id)
    .first<{ outcome: string | null; mode: string; code: string; request_status: string; amount: number; currency: string; plan_name: string | null }>()
  return {
    attemptStatus, outcome: row?.outcome ?? null, mode: row?.mode ?? attempt.mode, code: row?.code ?? null,
    planActive: row?.request_status === 'activada', planName: row?.plan_name ?? null, amount: Number(row?.amount ?? attempt.amount), currency: row?.currency ?? attempt.currency,
  }
}
