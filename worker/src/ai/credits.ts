/** AI credits per store: an append-only ledger with reservations, idempotency and manual recharges.
 *
 * Balance = SUM(amount). An AI action reserves its cost first (negative row), then the reservation is
 * closed exactly once: `consumo` (amount 0, the hold becomes the charge) or `liberacion` (+cost back).
 * Credits belong to the store, never to a user. Only the platform superadmin can add or adjust them. */
import type { Env } from '../index'
import { checkAiBudget, recordAiUsage, type TokenUsage } from './usage'

export const RESERVATION_MINUTES = 15
export const MAX_PENDING_REQUESTS = 3
export const MAX_CREDIT_AMOUNT = 1_000_000

/** Every AI action that can be priced in credits. A feature without a configured cost only uses the monthly budget. */
export const AI_CREDIT_FEATURES = {
  foto_a_producto: 'Crear un producto desde una foto',
  estudio_imagen: 'Estudio IA: mejorar una foto',
  importar_pdf_pagina: 'Leer una página de PDF con IA',
  leer_guia_envio: 'Leer una guía de envío con IA (Telegram)',
  foto_packshot: 'Estudio fotográfico: packshot (fondo, luz, sombra)',
  foto_premium: 'Estudio fotográfico: composición premium',
  creativo_texto: 'Creativos: sugerir textos comerciales con IA',
  video_ia_segundo: 'Video generativo con IA (precio por segundo)',
} as const
export type AiCreditFeature = keyof typeof AI_CREDIT_FEATURES
export const isAiCreditFeature = (value: unknown): value is AiCreditFeature => typeof value === 'string' && Object.hasOwn(AI_CREDIT_FEATURES, value)

export class CreditError extends Error {
  constructor(readonly code: string, message: string, readonly status: 400 | 403 | 404 | 409 = 400) { super(message) }
}

const IDEMPOTENCY_KEY = /^[\w.:-]{8,120}$/
export function validIdempotencyKey(value: unknown): value is string {
  return typeof value === 'string' && IDEMPOTENCY_KEY.test(value)
}
function positiveInt(value: unknown, field: string): number {
  const n = Number(value)
  if (!Number.isInteger(n) || n <= 0 || n > MAX_CREDIT_AMOUNT) throw new CreditError('INVALID_AMOUNT', `${field} debe ser un número entero entre 1 y ${MAX_CREDIT_AMOUNT}`)
  return n
}
const cleanText = (value: unknown, max = 300) => (typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '') || null

async function audit(db: D1Database, action: string, storeId: number | null, payload: unknown, actor: string) {
  await db.prepare(`INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id) VALUES (?, 'ai_credits', ?, ?, ?, 'platform', ?)`)
    .bind(action, String(storeId ?? ''), JSON.stringify(payload), actor, storeId).run()
}

// ---- reservations -------------------------------------------------------------

/** Closes reservations whose action never reported back, returning their credits. Safe to run anytime. */
export async function releaseExpiredReservations(db: D1Database, storeId?: number): Promise<number> {
  const result = await db.prepare(
    `INSERT OR IGNORE INTO ai_credit_ledger (store_id, kind, amount, feature, reservation_id, actor, reason)
     SELECT r.store_id, 'liberacion', -r.amount, r.feature, r.id, 'system', 'Reserva vencida'
     FROM ai_credit_ledger r
     WHERE r.kind = 'reserva' AND r.expires_at <= datetime('now') ${storeId ? 'AND r.store_id = ?' : ''}
       AND NOT EXISTS (SELECT 1 FROM ai_credit_ledger s WHERE s.reservation_id = r.id)`,
  ).bind(...(storeId ? [storeId] : [])).run()
  return Number(result.meta?.changes || 0)
}

export type Reservation = { ok: true; reservationId: number } | { ok: false; reason: 'insufficient' | 'duplicate' }

/** Atomically holds `credits` if the balance covers them. The same key never reserves twice. */
export async function reserveCredits(db: D1Database, input: { storeId: number; feature: string; credits: number; key: string; actor: string }): Promise<Reservation> {
  if (!validIdempotencyKey(input.key)) throw new CreditError('INVALID_IDEMPOTENCY_KEY', 'Falta una clave de idempotencia válida')
  const credits = positiveInt(input.credits, 'credits')
  const row = await db.prepare(
    `INSERT OR IGNORE INTO ai_credit_ledger (store_id, kind, amount, feature, idempotency_key, actor, expires_at)
     SELECT ?1, 'reserva', -?2, ?3, ?4, ?5, datetime('now', '+${RESERVATION_MINUTES} minutes')
     WHERE (SELECT COALESCE(SUM(amount), 0) FROM ai_credit_ledger WHERE store_id = ?1) >= ?2
     RETURNING id`,
  ).bind(input.storeId, credits, input.feature.slice(0, 60), input.key, input.actor.slice(0, 120)).first<{ id: number }>()
  if (row) return { ok: true, reservationId: row.id }
  const existing = await db.prepare('SELECT id FROM ai_credit_ledger WHERE store_id = ? AND idempotency_key = ?').bind(input.storeId, input.key).first()
  return { ok: false, reason: existing ? 'duplicate' : 'insufficient' }
}

/** Closes a reservation once. Returns false if it was already closed (for example, it expired first). */
export async function settleReservation(db: D1Database, reservationId: number, outcome: 'consumo' | 'liberacion', reason?: string): Promise<boolean> {
  const result = await db.prepare(
    `INSERT OR IGNORE INTO ai_credit_ledger (store_id, kind, amount, feature, reservation_id, actor, reason)
     SELECT store_id, ?2, CASE WHEN ?2 = 'consumo' THEN 0 ELSE -amount END, feature, id, 'system', ?3
     FROM ai_credit_ledger WHERE id = ?1 AND kind = 'reserva'`,
  ).bind(reservationId, outcome, reason?.slice(0, 200) ?? null).run()
  return Number(result.meta?.changes || 0) === 1
}

// ---- running an AI action -----------------------------------------------------

export type CreditGateReason = 'ai_unavailable' | 'disabled' | 'feature_disabled' | 'budget_exhausted' | 'store_unavailable' | 'platform_cap' | 'no_credits' | 'duplicate'
export const CREDIT_GATE_MESSAGES: Record<CreditGateReason, string> = {
  ai_unavailable: 'La IA todavía no está activada en esta plataforma.',
  disabled: 'La IA está desactivada para esta tienda. Todo lo demás sigue funcionando.',
  feature_disabled: 'Esta función de IA está pausada por la plataforma.',
  budget_exhausted: 'La tienda alcanzó el límite mensual de IA. Todo lo demás sigue funcionando.',
  store_unavailable: 'La tienda no está disponible para usar IA.',
  platform_cap: 'La IA de la plataforma alcanzó su límite por hoy. Inténtalo más tarde.',
  no_credits: 'No tienes créditos de IA suficientes. Puedes pedir una recarga en «Créditos IA».',
  duplicate: 'Esta solicitud ya se procesó. Vuelve a intentarlo desde el botón.',
}

export type CreditRun<T> =
  | { ok: true; value: T; charged: number }
  | { ok: false; reason: CreditGateReason; message: string }
  | { ok: false; reason: 'error'; message: string; error: unknown }

/** Runs an AI call behind the store switch, the monthly budget and (when the feature has a cost) a credit reservation.
 * Credits are released when the call fails, so a failed AI call never costs the store anything. */
export async function runWithCredits<T extends { usage?: TokenUsage; model?: string }>(
  db: D1Database,
  env: Partial<Env['Bindings']>,
  /** `units` multiplica el precio de la función (p. ej. segundos de video). Por defecto 1. */
  input: { storeId: number; feature: AiCreditFeature; key: string; actor: string; units?: number },
  call: () => Promise<T>,
): Promise<CreditRun<T>> {
  const blocked = (reason: CreditGateReason): CreditRun<T> => ({ ok: false, reason, message: CREDIT_GATE_MESSAGES[reason] })
  if (!env.GEMINI_API_KEY) return blocked('ai_unavailable')
  const cost = await db.prepare('SELECT credits, enabled FROM ai_credit_costs WHERE feature = ?').bind(input.feature).first<{ credits: number; enabled: number }>()
  if (cost && !cost.enabled) return blocked('feature_disabled')
  const budget = await checkAiBudget(db, env, input.storeId)
  if (!budget.allowed) {
    await recordAiUsage(db, env, { storeId: input.storeId, feature: input.feature, status: 'blocked' })
    return blocked(budget.reason || 'budget_exhausted')
  }
  const units = Number.isInteger(input.units) && input.units! > 0 ? input.units! : 1
  const credits = Number(cost?.credits || 0) * units
  let reservationId: number | null = null
  if (credits > 0) {
    await releaseExpiredReservations(db, input.storeId)
    const reservation = await reserveCredits(db, { storeId: input.storeId, feature: input.feature, credits, key: input.key, actor: input.actor })
    if (!reservation.ok) {
      if (reservation.reason === 'insufficient') await recordAiUsage(db, env, { storeId: input.storeId, feature: input.feature, status: 'blocked' })
      return blocked(reservation.reason === 'duplicate' ? 'duplicate' : 'no_credits')
    }
    reservationId = reservation.reservationId
  }
  try {
    const value = await call()
    if (reservationId) await settleReservation(db, reservationId, 'consumo')
    await recordAiUsage(db, env, { storeId: input.storeId, feature: input.feature, model: value.model, usage: value.usage, status: 'ok' })
    return { ok: true, value, charged: credits }
  } catch (error) {
    if (reservationId) await settleReservation(db, reservationId, 'liberacion', 'La acción de IA falló')
    await recordAiUsage(db, env, { storeId: input.storeId, feature: input.feature, status: 'error' })
    return { ok: false, reason: 'error', message: 'La IA no pudo completar la acción. No se descontaron créditos.', error }
  }
}

// ---- reading --------------------------------------------------------------------

export async function creditSummary(db: D1Database, storeId: number) {
  await releaseExpiredReservations(db, storeId)
  const totals = await db.prepare(
    `SELECT COALESCE(SUM(amount), 0) AS balance,
            COALESCE(SUM(CASE WHEN kind = 'recarga' THEN amount ELSE 0 END), 0) AS recharged,
            COALESCE(SUM(CASE WHEN kind = 'reserva' AND EXISTS (SELECT 1 FROM ai_credit_ledger s WHERE s.reservation_id = l.id AND s.kind = 'consumo') THEN -amount ELSE 0 END), 0) AS consumed,
            COALESCE(SUM(CASE WHEN kind = 'reserva' AND NOT EXISTS (SELECT 1 FROM ai_credit_ledger s WHERE s.reservation_id = l.id) THEN -amount ELSE 0 END), 0) AS reserved
     FROM ai_credit_ledger l WHERE store_id = ?`,
  ).bind(storeId).first<{ balance: number; recharged: number; consumed: number; reserved: number }>()
  return { balance: Number(totals?.balance || 0), reserved: Number(totals?.reserved || 0), recharged: Number(totals?.recharged || 0), consumed: Number(totals?.consumed || 0) }
}

export async function listCreditMovements(db: D1Database, storeId: number, limit = 50) {
  const { results } = await db.prepare(
    `SELECT id, kind, amount, feature, reservation_id AS reservationId, actor, reason, created_at AS createdAt
     FROM ai_credit_ledger WHERE store_id = ? ORDER BY id DESC LIMIT ?`,
  ).bind(storeId, Math.min(Math.max(1, limit), 200)).all()
  return results || []
}

export async function listCreditCosts(db: D1Database) {
  const { results } = await db.prepare('SELECT feature, credits, enabled, updated_by AS updatedBy, updated_at AS updatedAt FROM ai_credit_costs').all<{ feature: string; credits: number; enabled: number; updatedBy: string; updatedAt: string }>()
  const configured = new Map((results || []).map((row) => [row.feature, row]))
  return (Object.keys(AI_CREDIT_FEATURES) as AiCreditFeature[]).map((feature) => {
    const row = configured.get(feature)
    return { feature, label: AI_CREDIT_FEATURES[feature], configured: Boolean(row), credits: row ? Number(row.credits) : null, enabled: row ? Boolean(row.enabled) : true, updatedBy: row?.updatedBy ?? null, updatedAt: row?.updatedAt ?? null }
  })
}

export async function listCreditRequests(db: D1Database, filter: { storeId?: number; status?: string; limit?: number } = {}) {
  const where: string[] = []
  const binds: unknown[] = []
  if (filter.storeId) { where.push('r.store_id = ?'); binds.push(filter.storeId) }
  if (filter.status && ['pendiente', 'aprobada', 'rechazada'].includes(filter.status)) { where.push('r.status = ?'); binds.push(filter.status) }
  const { results } = await db.prepare(
    `SELECT r.id, r.store_id AS storeId, s.slug, s.name AS storeName, r.credits, r.note, r.status, r.requested_by AS requestedBy,
            r.resolved_by AS resolvedBy, r.resolution_note AS resolutionNote, r.approved_credits AS approvedCredits,
            r.created_at AS createdAt, r.resolved_at AS resolvedAt
     FROM ai_credit_requests r JOIN stores s ON s.id = r.store_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY r.id DESC LIMIT ?`,
  ).bind(...binds, Math.min(Math.max(1, filter.limit || 50), 200)).all()
  return results || []
}

// ---- platform (superadmin only) -------------------------------------------------

export async function setCreditCost(db: D1Database, feature: unknown, body: { credits?: unknown; enabled?: unknown }, actor: string) {
  if (!isAiCreditFeature(feature)) throw new CreditError('UNKNOWN_FEATURE', 'Función de IA desconocida', 404)
  const credits = Number(body.credits)
  if (!Number.isInteger(credits) || credits < 0 || credits > MAX_CREDIT_AMOUNT) throw new CreditError('INVALID_AMOUNT', 'credits debe ser un entero desde 0')
  const enabled = body.enabled === undefined ? 1 : body.enabled === true ? 1 : body.enabled === false ? 0 : -1
  if (enabled < 0) throw new CreditError('INVALID_ENABLED', 'enabled debe ser verdadero o falso')
  await db.prepare(
    `INSERT INTO ai_credit_costs (feature, credits, enabled, updated_by) VALUES (?, ?, ?, ?)
     ON CONFLICT(feature) DO UPDATE SET credits = excluded.credits, enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = datetime('now')`,
  ).bind(feature, credits, enabled, actor).run()
  await audit(db, 'ai_credit_cost_set', null, { feature, credits, enabled: Boolean(enabled) }, actor)
  return (await listCreditCosts(db)).find((row) => row.feature === feature)
}

/** Recharge (+) or adjustment (±) by the superadmin. An adjustment can never leave the balance below zero. */
export async function grantCredits(db: D1Database, storeId: number, body: { kind?: unknown; amount?: unknown; reason?: unknown }, key: string, actor: string) {
  if (!validIdempotencyKey(key)) throw new CreditError('INVALID_IDEMPOTENCY_KEY', 'Falta el encabezado Idempotency-Key')
  if (body.kind !== 'recarga' && body.kind !== 'ajuste') throw new CreditError('INVALID_KIND', 'kind debe ser recarga o ajuste')
  const reason = cleanText(body.reason)
  if (!reason) throw new CreditError('REASON_REQUIRED', 'Escribe el motivo del movimiento')
  const raw = Number(body.amount)
  const amount = body.kind === 'recarga' ? positiveInt(raw, 'amount') : (Number.isInteger(raw) && raw !== 0 && Math.abs(raw) <= MAX_CREDIT_AMOUNT ? raw : NaN)
  if (Number.isNaN(amount)) throw new CreditError('INVALID_AMOUNT', 'amount debe ser un entero distinto de 0')
  const row = await db.prepare(
    `INSERT OR IGNORE INTO ai_credit_ledger (store_id, kind, amount, idempotency_key, actor, reason)
     SELECT ?1, ?2, ?3, ?4, ?5, ?6
     WHERE ?3 > 0 OR (SELECT COALESCE(SUM(amount), 0) FROM ai_credit_ledger WHERE store_id = ?1) + ?3 >= 0
     RETURNING id`,
  ).bind(storeId, body.kind, amount, key, actor, reason).first<{ id: number }>()
  if (!row) {
    const existing = await db.prepare('SELECT id, kind, amount FROM ai_credit_ledger WHERE store_id = ? AND idempotency_key = ?').bind(storeId, key).first<{ id: number; kind: string; amount: number }>()
    if (existing) return { replayed: true, movementId: existing.id, ...(await creditSummary(db, storeId)) }
    throw new CreditError('INSUFFICIENT_BALANCE', 'El ajuste dejaría el saldo por debajo de cero', 409)
  }
  await audit(db, body.kind === 'recarga' ? 'ai_credits_recharged' : 'ai_credits_adjusted', storeId, { amount, reason, movementId: row.id }, actor)
  return { replayed: false, movementId: row.id, ...(await creditSummary(db, storeId)) }
}

/** Approves (creating the recharge in the same transaction) or rejects a pending request. */
export async function resolveCreditRequest(db: D1Database, requestId: number, body: { decision?: unknown; credits?: unknown; note?: unknown }, actor: string) {
  if (!Number.isInteger(requestId) || requestId <= 0) throw new CreditError('REQUEST_NOT_FOUND', 'Solicitud no encontrada', 404)
  const request = await db.prepare('SELECT id, store_id AS storeId, credits, status FROM ai_credit_requests WHERE id = ?').bind(requestId).first<{ id: number; storeId: number; credits: number; status: string }>()
  if (!request) throw new CreditError('REQUEST_NOT_FOUND', 'Solicitud no encontrada', 404)
  if (request.status !== 'pendiente') throw new CreditError('REQUEST_ALREADY_RESOLVED', 'Esta solicitud ya fue resuelta', 409)
  const note = cleanText(body.note)
  if (body.decision === 'rechazada') {
    const updated = await db.prepare(`UPDATE ai_credit_requests SET status = 'rechazada', resolved_by = ?, resolution_note = ?, resolved_at = datetime('now') WHERE id = ? AND status = 'pendiente'`).bind(actor, note, requestId).run()
    if (!updated.meta?.changes) throw new CreditError('REQUEST_ALREADY_RESOLVED', 'Esta solicitud ya fue resuelta', 409)
    await audit(db, 'ai_credit_request_rejected', request.storeId, { requestId, note }, actor)
  } else if (body.decision === 'aprobada') {
    const credits = body.credits === undefined ? request.credits : positiveInt(body.credits, 'credits')
    const key = `request:${requestId}`
    await db.batch([
      db.prepare(
        `INSERT INTO ai_credit_ledger (store_id, kind, amount, idempotency_key, actor, reason)
         SELECT store_id, 'recarga', ?2, ?3, ?4, ?5 FROM ai_credit_requests WHERE id = ?1 AND status = 'pendiente'`,
      ).bind(requestId, credits, key, actor, `Solicitud #${requestId} aprobada${note ? `: ${note}` : ''}`),
      db.prepare(
        `UPDATE ai_credit_requests SET status = 'aprobada', approved_credits = ?2, resolved_by = ?3, resolution_note = ?4, resolved_at = datetime('now'),
           ledger_id = (SELECT id FROM ai_credit_ledger WHERE store_id = ai_credit_requests.store_id AND idempotency_key = ?5)
         WHERE id = ?1 AND status = 'pendiente'`,
      ).bind(requestId, credits, actor, note, key),
    ])
    await audit(db, 'ai_credit_request_approved', request.storeId, { requestId, credits, note }, actor)
  } else {
    throw new CreditError('INVALID_DECISION', 'decision debe ser aprobada o rechazada')
  }
  return (await listCreditRequests(db, { storeId: request.storeId })).find((row: any) => row.id === requestId)
}

// ---- store (merchant: read and request only) -----------------------------------

export async function createCreditRequest(db: D1Database, storeId: number, body: { credits?: unknown; note?: unknown }, actor: string) {
  const credits = positiveInt(body.credits, 'credits')
  const pending = await db.prepare(`SELECT COUNT(*) AS n FROM ai_credit_requests WHERE store_id = ? AND status = 'pendiente'`).bind(storeId).first<{ n: number }>()
  if (Number(pending?.n || 0) >= MAX_PENDING_REQUESTS) throw new CreditError('TOO_MANY_PENDING', `Ya tienes ${MAX_PENDING_REQUESTS} solicitudes pendientes. Espera a que la plataforma las revise.`, 409)
  const row = await db.prepare(
    `INSERT INTO ai_credit_requests (store_id, credits, note, requested_by) VALUES (?, ?, ?, ?) RETURNING id, credits, note, status, created_at AS createdAt`,
  ).bind(storeId, credits, cleanText(body.note, 500), actor.slice(0, 160)).first()
  await db.prepare(`INSERT INTO platform_events (store_id, level, source, code, detail) VALUES (?, 'info', 'ai', 'AI_CREDIT_REQUEST', ?)`)
    .bind(storeId, `Solicitud de recarga de ${credits} créditos de IA`).run()
  return row
}
