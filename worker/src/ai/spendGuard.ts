/** Central control of paid Gemini calls.
 *
 * Every paid request goes through `guardedGeminiFetch` (the Gemini clients call it; nothing else talks to the API).
 * Before the request it RESERVES the maximum the call can cost, in one INSERT that checks every applicable limit
 * (global day/month, store day/month, premium images per month, trials per day, cost per operation, attempts per
 * operation). SQLite/D1 run that statement atomically, so two simultaneous requests can never both slip under a
 * limit. After the request the reservation is SETTLED with the real cost from the official price table
 * (`pricing.ts`), or RELEASED when Google did not bill it (HTTP error). Reservations left open by a crashed
 * Worker EXPIRE after a few minutes and keep their reserved amount (conservative: the call may have been billed).
 *
 * The entry points (assistant, credits, master bot, trials) declare who pays with `runWithSpend`; the context
 * travels with the request (AsyncLocalStorage), so no low-level signature had to change. A paid call without a
 * context is refused in deployed environments when the guard enforces.
 *
 * Modes (AI_SPEND_GUARD_MODE): 'off' (nothing), 'shadow' (reserves, settles and alerts, never blocks) and
 * 'enforce' (also blocks). Default: 'shadow' in production until the owner approves 'enforce'; 'enforce' elsewhere.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import type { Env } from '../index'
import { costOf, estimateRequestMicros, PRICING_VERSION, usageFromMetadata, type GeminiUsage } from './pricing'
import { bogotaDate, copToMicros, COUNTED_UNITS, cycleOf, planQuota, unitsFor } from './planUsage'
import { markOwnKeyResult, parseProviderError, resolveOwnKey, statusFromHttp, STATUS_LABELS, useFor, type OwnKeyStatus } from './ownKey'

type Bindings = Partial<Env['Bindings']>

export type SpendScope = 'store' | 'platform' | 'trial' | 'test'
export type SpendKind = 'text' | 'image' | 'video'
export type GuardMode = 'off' | 'shadow' | 'enforce'

export type SpendContext = {
  db: D1Database
  env: Bindings
  scope: SpendScope
  storeId?: number | null
  feature: string
  /** Stable key of the operation (webhook update, job, idempotency key). Retries of the same operation share it,
   * so the number of paid attempts per operation is bounded even across duplicate deliveries. */
  opKey: string
  /** Set when the operation's credits were waived because the store's own key pays: then a failing own key can
   * never fall back to the platform key (that would be a free generation). */
  creditsWaived?: boolean
}

/** Who pays a call: the plan's queries, the store's own key, or the platform (master bot, free trials). */
export type BillingSource = 'plan' | 'own_key' | 'platform' | 'trial'

export type BlockReason =
  | 'global_day' | 'global_month' | 'store_day' | 'store_month' | 'images_month' | 'trial_day'
  | 'operation_max' | 'attempts' | 'duplicate' | 'unguarded' | 'guard_unavailable'
  | 'monthly_units' | 'concurrency' | 'burst' | 'duplicate_request' | 'too_large' | 'own_key_failed' | 'own_key_slow' | 'model_timeout'

export type BlockDetail = { limit?: number; resetAt?: string; ownKeyStatus?: OwnKeyStatus; left?: number; needed?: number }

const OWN_API_HINT = 'También puedes conectar tu propia API de Gemini en el panel: Configuración → Inteligencia artificial → Mi API.'
const KEEPS_WORKING = 'El catálogo, los pedidos, los botones y los comandos siguen funcionando.'

const USER_MESSAGES: Record<BlockReason, string> = {
  store_day: 'Tu tienda alcanzó el límite de IA de hoy. El catálogo, los pedidos, los botones y los comandos siguen funcionando; la IA vuelve mañana.',
  store_month: 'Tu tienda alcanzó el límite de IA de este mes. El catálogo, los pedidos, los botones y los comandos siguen funcionando. Para ampliarlo, contacta a soporte.',
  images_month: 'Tu tienda ya usó todas las fotos con IA de este mes. Tus fotos originales siguen guardadas y el resto de la tienda funciona normal.',
  global_day: 'La IA de la plataforma está en pausa por hoy. El catálogo, los pedidos, los botones y los comandos siguen funcionando.',
  global_month: 'La IA de la plataforma está en pausa. El catálogo, los pedidos, los botones y los comandos siguen funcionando.',
  trial_day: 'Las mejoras con IA de las pruebas gratuitas están en pausa por hoy. Inténtalo mañana.',
  operation_max: 'Esta solicitud es demasiado grande para la IA. Divídela en partes más pequeñas (por ejemplo, menos fotos a la vez).',
  attempts: 'Esta solicitud ya se intentó varias veces con la IA. Inténtalo de nuevo más tarde o de otra forma.',
  duplicate: 'Esta solicitud ya se está procesando. Espera un momento.',
  unguarded: 'La IA no está disponible en este momento. Todo lo demás sigue funcionando.',
  guard_unavailable: 'La IA no está disponible en este momento. Todo lo demás sigue funcionando.',
  monthly_units: `Usaste las consultas de IA de este mes. ${KEEPS_WORKING} ${OWN_API_HINT}`,
  concurrency: 'Hay varias tareas de IA en curso en tu tienda. Espera unos segundos y vuelve a intentarlo.',
  burst: 'Llegaron muchas solicitudes de IA seguidas. Espera un minuto y vuelve a intentarlo.',
  duplicate_request: 'Ya procesé esta misma solicitud hace un momento. Si necesitas otro resultado, cámbiala un poco o espera dos minutos.',
  too_large: 'El archivo es demasiado grande para la IA: fotos de hasta 5 MB, audios de hasta 2 minutos y documentos de hasta 10 MB.',
  own_key_failed: 'Tu API de Gemini no respondió bien. Revisa tu clave o la facturación de tu proyecto en Google.',
  own_key_slow: 'Tu API de Gemini tardó demasiado en responder y la detuvimos para no dejarte esperando. Las claves del nivel gratuito de Google pueden ser lentas o estar limitadas; con facturación activa suelen responder mejor. Inténtalo de nuevo en un momento.',
  model_timeout: 'La IA tardó demasiado en responder y la detuvimos para no dejarte esperando. Inténtalo de nuevo en un momento. El catálogo, los pedidos, los botones y los comandos siguen funcionando.',
}

function messageFor(reason: BlockReason, detail: BlockDetail): string {
  // The task weighs more than what is left (e.g. a voice note = 4 with 3 left): say so instead of «you used them all».
  // The task weighs more than what is left (e.g. a voice note = 4 with 3 left): say so instead of «you used them all».
  if (reason === 'monthly_units' && detail.resetAt && detail.left && detail.needed) {
    return `⏳ Esta tarea necesita ${detail.needed} consultas de IA y te quedan ${detail.left} de las incluidas este mes. Se renuevan el ${bogotaDate(detail.resetAt)}. Puedes hacer tareas más pequeñas (un mensaje de texto usa 1). ${KEEPS_WORKING} ${OWN_API_HINT}`
  }
  if (reason === 'monthly_units' && detail.resetAt) return `⛔ Usaste las ${detail.limit ?? ''} consultas de IA incluidas en tu plan este mes. Se renuevan el ${bogotaDate(detail.resetAt)}. ${KEEPS_WORKING} ${OWN_API_HINT}`
  if (reason === 'own_key_failed' && detail.ownKeyStatus) return `Tu API de Gemini respondió: ${STATUS_LABELS[detail.ownKeyStatus]}. Revisa tu clave o la facturación de tu proyecto en Google. No usamos el cupo de TiendIA porque así está configurado (puedes cambiarlo en Configuración → Inteligencia artificial → Mi API). ${KEEPS_WORKING}`
  return USER_MESSAGES[reason]
}

export class AiSpendBlockedError extends Error {
  readonly userMessage: string
  constructor(readonly reason: BlockReason, readonly shadow = false, readonly detail: BlockDetail = {}) {
    super(`AI spend blocked (${reason})`)
    this.name = 'AiSpendBlockedError'
    this.userMessage = messageFor(reason, detail)
  }
}

export const isSpendBlocked = (error: unknown): error is AiSpendBlockedError => error instanceof AiSpendBlockedError

// ---- configuration ---------------------------------------------------------------

/** Budget environment: AI_BUDGET_ENVIRONMENT when set (a staging Worker that runs with ENVIRONMENT=production
 * for CORS or cookies still gets staging limits), otherwise ENVIRONMENT. */
export function environmentOf(env: Bindings): string {
  return String((env as Record<string, unknown>).AI_BUDGET_ENVIRONMENT || env.ENVIRONMENT || 'development').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 20) || 'development'
}

export function guardMode(env: Bindings): GuardMode {
  const value = String((env as Record<string, unknown>).AI_SPEND_GUARD_MODE || '').toLowerCase()
  if (value === 'off' || value === 'shadow' || value === 'enforce') return value
  return environmentOf(env) === 'production' ? 'shadow' : 'enforce'
}

const deployed = (env: Bindings) => ['production', 'staging'].includes(environmentOf(env))

/** USD micros. Proposed values pending the owner's approval; every one can be changed in `ai_spend_limits`. */
export const DEFAULT_GLOBAL_LIMITS: Record<string, { day: number; month: number }> = {
  production: { day: 2_000_000, month: 30_000_000 },
  staging: { day: 500_000, month: 5_000_000 },
  development: { day: 1_000_000, month: 10_000_000 },
  test: { day: 1_000_000, month: 10_000_000 },
}

/** Per plan. New plans: the monthly amount covers what the offer includes, used to the top, at the official 2026
 * price + 10 % (photos + messages at the reasonable-use figure + descriptions + imports); the daily amount allows an
 * import day. Existing plans keep the monthly budgets they already have in production. Proposal pending approval. */
export const DEFAULT_PLAN_LIMITS: Record<string, { day: number; month: number; images: number }> = {
  emprendedor: { day: 1_000_000, month: 6_500_000, images: 50 },
  negocio: { day: 3_500_000, month: 20_000_000, images: 150 },
  mayorista: { day: 9_000_000, month: 55_000_000, images: 400 },
  basico: { day: 250_000, month: 1_000_000, images: 20 },
  profesional: { day: 500_000, month: 3_000_000, images: 50 },
  premium: { day: 1_200_000, month: 8_000_000, images: 100 },
  legacy: { day: 800_000, month: 5_000_000, images: 60 },
}

/** Free trials (all of them together) per day. */
export const DEFAULT_TRIAL_DAY_MICROS = 500_000
/** Largest single call allowed, by kind (USD micros): blocks runaway prompts, not normal work. */
export const OPERATION_MAX_MICROS: Record<SpendKind, number> = { text: 100_000, image: 300_000, video: 3_000_000 }
/** Paid attempts per operation (first try + retries + second readings). */
export const MAX_ATTEMPTS_PER_OPERATION = 3
/** Minutes after which an open reservation is considered abandoned. */
export const RESERVATION_TTL_MINUTES = 10
/** Technical limits per store, also with its own key (they protect the platform's infrastructure). */
export const DEFAULT_STORE_CONCURRENCY = 3
/** Money ceiling of a metered plan = this many times its internal budget (stops anomalies, never the allowance). */
export const ANOMALY_BUDGET_FACTOR = 3
export const DEFAULT_STORE_BURST_PER_MINUTE = 60
/** Longest wait for one call (ms), so a slow provider never outlives the webhook that asked for it (Telegram and
 * WhatsApp drop the request and the Worker is cancelled, leaving no answer). AI_CALL_TIMEOUT_MS overrides text. */
export const DEFAULT_CALL_TIMEOUT_MS: Record<SpendKind, number> = { text: 25_000, image: 90_000, video: 120_000 }
/** A call older than this cannot be alive any more (it timed out): it no longer counts as simultaneous. */
export const CONCURRENCY_WINDOW_SECONDS = 150
/** Same request (fingerprint) within this window: not charged again; from DUPLICATE_BLOCK_AT copies on, refused. */
export const DUPLICATE_WINDOW_SECONDS = 120
export const DUPLICATE_BLOCK_AT = 6
/** Size limits of what is sent to the model (decoded bytes). */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
export const MAX_AUDIO_BYTES = 2 * 1024 * 1024
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024
export const MAX_TEXT_CHARS = 120_000

export type ResolvedLimits = {
  environment: string
  globalDay: number
  globalMonth: number
  planCode: string | null
  storeDay: number | null
  storeMonth: number | null
  storeImages: number | null
  trialDay: number
  operationMax: number
  maxAttempts: number
  monthlyUnits: number | null
  /** Internal monthly budget of a metered plan (alert only; the money ceiling is an anomaly guard above it). */
  storeBudget: number | null
  concurrency: number
  burstPerMinute: number
}

export async function resolveLimits(db: D1Database, env: Bindings, _scope: SpendScope, storeId: number | null, kind: SpendKind): Promise<ResolvedLimits> {
  const environment = environmentOf(env)
  const store = storeId ? await db.prepare('SELECT plan_code AS planCode, ai_monthly_budget_micros AS budget FROM stores WHERE id = ?').bind(storeId).first<{ planCode: string | null; budget: number | null }>() : null
  const planCode = store?.planCode ?? null
  const quota = storeId ? await planQuota(db, storeId) : null
  const numberVar = (name: string, fallback: number) => { const value = Number((env as Record<string, unknown>)[name]); return Number.isInteger(value) && value > 0 ? value : fallback }
  const rows = (await db.prepare(
    `SELECT scope, scope_ref AS ref, period, metric, limit_value AS value FROM ai_spend_limits
     WHERE (scope = 'global' AND scope_ref = '*') OR (scope = 'trial' AND scope_ref = '*') OR (scope = 'plan' AND scope_ref = ?) OR (scope = 'store' AND scope_ref = ?)`,
  ).bind(planCode ?? '', storeId ? String(storeId) : '').all<{ scope: string; ref: string; period: string; metric: string; value: number }>()).results || []
  const pick = (scopeName: string, period: string, metric: string) => rows.find((row) => row.scope === scopeName && row.period === period && row.metric === metric)?.value
  const global = DEFAULT_GLOBAL_LIMITS[environment] || DEFAULT_GLOBAL_LIMITS.development!
  const plan = planCode ? DEFAULT_PLAN_LIMITS[planCode] : undefined
  const fallbackMonth = Number(store?.budget || 0) > 0 ? Number(store!.budget) : 1_000_000
  const storeLimit = (period: 'day' | 'month', metric: 'micros' | 'images', fallback: number) =>
    pick('store', period, metric) ?? pick('plan', period, metric) ?? fallback
  // New plans: the internal monthly budget in COP is the store's money ceiling (converted with AI_FX_COP_PER_USD).
  // Plans with a monthly allowance of queries: the queries ARE the limit. Money only stops an anomaly (3x the internal
  // budget), never the included allowance, and there is no daily cap. Other plans keep their monthly budget.
  const metered = Boolean(quota?.metered)
  const planMonth = metered && quota?.budgetCop ? copToMicros(env, quota.budgetCop) * ANOMALY_BUDGET_FACTOR : quota?.budgetCop ? copToMicros(env, quota.budgetCop) : plan?.month ?? fallbackMonth
  const month = storeId ? storeLimit('month', 'micros', planMonth) : null
  return {
    environment,
    globalDay: pick('global', 'day', 'micros') ?? global.day,
    globalMonth: pick('global', 'month', 'micros') ?? global.month,
    planCode,
    storeMonth: month,
    storeDay: storeId ? storeLimit('day', 'micros', metered ? month! : Math.min(plan?.day ?? Math.max(100_000, Math.ceil(month! / 8)), month!)) : null,
    // Metered plans pay images with credits: the credits are the limit (no hidden cap on bought credits).
    storeImages: storeId ? storeLimit('month', 'images', metered ? 100_000 : plan?.images ?? 20) : null,
    trialDay: pick('trial', 'day', 'micros') ?? DEFAULT_TRIAL_DAY_MICROS,
    operationMax: OPERATION_MAX_MICROS[kind],
    maxAttempts: MAX_ATTEMPTS_PER_OPERATION,
    storeBudget: quota?.metered && quota.budgetCop ? copToMicros(env, quota.budgetCop) : null,
    monthlyUnits: quota?.monthlyUnits ?? null,
    concurrency: numberVar('AI_STORE_CONCURRENCY', DEFAULT_STORE_CONCURRENCY),
    burstPerMinute: numberVar('AI_STORE_BURST_PER_MINUTE', DEFAULT_STORE_BURST_PER_MINUTE),
  }
}

// ---- context ---------------------------------------------------------------------

const storage = new AsyncLocalStorage<SpendContext>()

/** Declares who pays for the Gemini calls made inside `fn`. */
export function runWithSpend<T>(context: SpendContext, fn: () => Promise<T>): Promise<T> {
  return storage.run({ ...context, opKey: context.opKey.slice(0, 160), feature: context.feature.slice(0, 60) }, fn)
}

export const currentSpendContext = () => storage.getStore()

export function newOperationKey(prefix: string): string {
  return `${prefix}:${crypto.randomUUID()}`
}

// ---- reservation -----------------------------------------------------------------

const dayKey = (now: Date) => now.toISOString().slice(0, 10)
const monthKey = (now: Date) => now.toISOString().slice(0, 7)
/** Committed spend: open reservations at their reserved amount, closed ones at their real cost. */
const COMMITTED = `COALESCE(SUM(CASE WHEN billing_source = 'own_key' THEN 0 WHEN status = 'reserved' THEN reserved_micros ELSE COALESCE(actual_micros, 0) END), 0)`

export type Reservation = { id: number; attempt: number; reservedMicros: number; units: number; billingSource: BillingSource; mode: 'shadow' | 'enforce'; limits: ResolvedLimits; wouldBlock: BlockReason | null }

export type ReserveInput = { model: string; kind: SpendKind; amountMicros: number; units?: number; billingSource?: BillingSource; fingerprint?: string | null }

/** Reserves one paid call. Throws AiSpendBlockedError when a limit would be crossed (enforce mode).
 *
 * One INSERT checks, atomically: attempts per operation, size per call, simultaneous and per-minute calls of the
 * store (always, also with its own key), the platform and store money (not when the store's own key pays), premium
 * images per month, free-trial money, and the plan's queries of the month. */
export async function reserveSpend(context: SpendContext, input: ReserveInput, now = new Date()): Promise<Reservation> {
  const { db, env } = context
  const mode = guardMode(env) === 'enforce' ? 'enforce' : 'shadow'
  const storeId = context.scope === 'store' && context.storeId ? context.storeId : null
  const billingSource: BillingSource = input.billingSource ?? (context.scope === 'store' ? 'plan' : context.scope === 'trial' ? 'trial' : 'platform')
  const ownKey = billingSource === 'own_key' ? 1 : 0
  const limits = await resolveLimits(db, env, context.scope, storeId, input.kind)
  const day = dayKey(now)
  const month = monthKey(now)
  const amount = Math.max(0, Math.ceil(input.amountMicros))
  const enforce = mode === 'enforce' ? 1 : 0
  const env_ = limits.environment
  const fingerprint = input.fingerprint ? input.fingerprint.slice(0, 64) : null

  // Queries are charged once per operation (retries of the same operation are free) and never twice for the same
  // request repeated within the duplicate window.
  let units = billingSource === 'plan' && storeId ? Math.max(0, Math.floor(input.units ?? 0)) : 0
  let duplicates = 0
  if (storeId && fingerprint) {
    duplicates = Number((await db.prepare(
      `SELECT COUNT(*) AS n FROM ai_spend_reservations WHERE store_id = ? AND request_fingerprint = ? AND op_key <> ? AND status IN ('reserved', 'settled')
         AND created_at > datetime('now', ?)`,
    ).bind(storeId, fingerprint, context.opKey, `-${DUPLICATE_WINDOW_SECONDS} seconds`).first<{ n: number }>())?.n || 0)
  }
  if (units > 0) {
    const held = Number((await db.prepare(`SELECT COUNT(*) AS n FROM ai_spend_reservations WHERE op_key = ? AND units > 0 AND status <> 'released'`).bind(context.opKey).first<{ n: number }>())?.n || 0)
    if (held > 0 || duplicates > 0) units = 0
  }
  let cycleKey: string | null = null
  let cycleEnd: string | null = null
  if (storeId && billingSource === 'plan') {
    const cycle = await cycleOf(db, storeId, now)
    cycleKey = cycle.key
    cycleEnd = cycle.end
  }
  const unitsChecked = units > 0 && limits.monthlyUnits !== null ? 1 : 0
  const facts: DiagnoseInput = { amount, kind: input.kind, day, month, storeId, ownKey: Boolean(ownKey), units, cycleKey, cycleEnd, duplicates }

  const row = enforce && duplicates >= DUPLICATE_BLOCK_AT ? null : await db.prepare(
    `INSERT OR IGNORE INTO ai_spend_reservations (op_key, attempt, environment, scope, store_id, plan_code, feature, model, kind, day_key, month_key, reserved_micros, mode,
       units, session_id, cycle_key, billing_source, request_fingerprint)
     SELECT ?, (SELECT COALESCE(MAX(attempt), 0) + 1 FROM ai_spend_reservations WHERE op_key = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
     WHERE ? = 0 OR (
       (SELECT COALESCE(MAX(attempt), 0) FROM ai_spend_reservations WHERE op_key = ?) < ?
       AND ? <= ?
       AND (? IS NULL OR (
         (SELECT COUNT(*) FROM ai_spend_reservations WHERE store_id = ? AND status = 'reserved' AND created_at > datetime('now', '-${CONCURRENCY_WINDOW_SECONDS} seconds')) < ?
         AND (SELECT COUNT(*) FROM ai_spend_reservations WHERE store_id = ? AND created_at > datetime('now', '-60 seconds')) < ?
       ))
       AND (? = 1 OR (
         (SELECT ${COMMITTED} FROM ai_spend_reservations WHERE environment = ? AND day_key = ?) + ? <= ?
         AND (SELECT ${COMMITTED} FROM ai_spend_reservations WHERE environment = ? AND month_key = ?) + ? <= ?
         AND (? IS NULL OR (
           (SELECT ${COMMITTED} FROM ai_spend_reservations WHERE environment = ? AND store_id = ? AND day_key = ?) + ? <= ?
           AND (SELECT ${COMMITTED} FROM ai_spend_reservations WHERE environment = ? AND store_id = ? AND month_key = ?) + ? <= ?
           AND (? <> 'image' OR (SELECT COUNT(*) FROM ai_spend_reservations WHERE environment = ? AND store_id = ? AND month_key = ? AND kind = 'image'
                 AND billing_source <> 'own_key' AND status IN ('reserved', 'settled', 'expired')) < ?)
         ))
         AND (? <> 'trial' OR (SELECT ${COMMITTED} FROM ai_spend_reservations WHERE environment = ? AND scope = 'trial' AND day_key = ?) + ? <= ?)
       ))
       AND (? = 0 OR (
         (? IS NULL OR (SELECT ${COUNTED_UNITS} FROM ai_spend_reservations WHERE store_id = ? AND cycle_key = ?) + ? <= ?)
       ))
     )
     RETURNING id, attempt`,
  ).bind(
    context.opKey, context.opKey, env_, context.scope, storeId, limits.planCode, context.feature, input.model.slice(0, 80), input.kind, day, month, amount, mode,
    units, null, cycleKey, billingSource, fingerprint,
    enforce,
    context.opKey, limits.maxAttempts,
    amount, limits.operationMax,
    storeId,
    storeId, limits.concurrency,
    storeId, limits.burstPerMinute,
    ownKey,
    env_, day, amount, limits.globalDay,
    env_, month, amount, limits.globalMonth,
    storeId,
    env_, storeId, day, amount, limits.storeDay ?? 0,
    env_, storeId, month, amount, limits.storeMonth ?? 0,
    input.kind, env_, storeId, month, limits.storeImages ?? 0,
    context.scope, env_, day, amount, limits.trialDay,
    unitsChecked,
    limits.monthlyUnits, storeId, cycleKey, units, limits.monthlyUnits ?? 0,
  ).first<{ id: number; attempt: number }>()

  if (!row) {
    const found = (await diagnose(db, context, limits, facts)) ?? { reason: 'duplicate' as BlockReason, detail: {} }
    await alert(db, limitKey(found.reason, context, storeId), periodOf(found.reason, day, month), 100, context, `${limitLabel(found.reason, storeId)}: límite alcanzado, llamada bloqueada (${found.reason}, ${context.feature})`)
    throw new AiSpendBlockedError(found.reason, false, found.detail)
  }
  // In shadow mode the call goes ahead; still say whether it would have been blocked.
  const would = mode === 'shadow' ? await diagnose(db, context, limits, { ...facts, excludeId: row.id }) : null
  const wouldBlock = would && would.reason !== 'duplicate' ? would.reason : null
  if (wouldBlock) {
    await alert(db, `shadow:${limitKey(wouldBlock, context, storeId)}`, periodOf(wouldBlock, day, month), 100, context, `Modo observación (${limitLabel(wouldBlock, storeId)}): se habría bloqueado por ${wouldBlock} (${context.feature})`)
  }
  return { id: row.id, attempt: row.attempt, reservedMicros: amount, units, billingSource, mode, limits, wouldBlock }
}

type DiagnoseInput = {
  amount: number; kind: SpendKind; day: string; month: string; storeId: number | null; ownKey: boolean; units: number
  cycleKey: string | null; cycleEnd: string | null
  duplicates: number; excludeId?: number
}

/** Which limit refused (or would refuse) the reservation. Read-only; used for messages and alerts. */
async function diagnose(db: D1Database, context: SpendContext, limits: ResolvedLimits, input: DiagnoseInput): Promise<{ reason: BlockReason; detail: BlockDetail } | null> {
  const e = limits.environment
  const ex = input.excludeId ?? -1
  const found = (reason: BlockReason, detail: BlockDetail = {}) => ({ reason, detail })
  const count = async (sql: string, ...binds: unknown[]) => Number((await db.prepare(sql).bind(...binds).first<{ v: number }>())?.v || 0)
  const sum = (where: string, ...binds: unknown[]) => count(`SELECT ${COMMITTED} AS v FROM ai_spend_reservations WHERE environment = ? AND id <> ? AND ${where}`, e, ex, ...binds)
  if (input.duplicates >= DUPLICATE_BLOCK_AT) return found('duplicate_request')
  if (await count('SELECT COALESCE(MAX(attempt), 0) AS v FROM ai_spend_reservations WHERE op_key = ? AND id <> ?', context.opKey, ex) >= limits.maxAttempts) return found('attempts')
  if (input.amount > limits.operationMax) return found('operation_max')
  if (input.storeId) {
    if (await count(`SELECT COUNT(*) AS v FROM ai_spend_reservations WHERE store_id = ? AND id <> ? AND status = 'reserved' AND created_at > datetime('now', '-${CONCURRENCY_WINDOW_SECONDS} seconds')`, input.storeId, ex) >= limits.concurrency) return found('concurrency')
    if (await count(`SELECT COUNT(*) AS v FROM ai_spend_reservations WHERE store_id = ? AND id <> ? AND created_at > datetime('now', '-60 seconds')`, input.storeId, ex) >= limits.burstPerMinute) return found('burst')
  }
  if (!input.ownKey) {
    if (await sum('day_key = ?', input.day) + input.amount > limits.globalDay) return found('global_day')
    if (await sum('month_key = ?', input.month) + input.amount > limits.globalMonth) return found('global_month')
    if (input.storeId) {
      // Month first: when the day ceiling equals the month's (small budgets), the month is the real reason.
      if (await sum('store_id = ? AND month_key = ?', input.storeId, input.month) + input.amount > (limits.storeMonth ?? 0)) return found('store_month')
      if (await sum('store_id = ? AND day_key = ?', input.storeId, input.day) + input.amount > (limits.storeDay ?? 0)) return found('store_day')
      if (input.kind === 'image' && await count(`SELECT COUNT(*) AS v FROM ai_spend_reservations WHERE environment = ? AND id <> ? AND store_id = ? AND month_key = ? AND kind = 'image' AND billing_source <> 'own_key' AND status IN ('reserved', 'settled', 'expired')`, e, ex, input.storeId, input.month) >= (limits.storeImages ?? 0)) return found('images_month')
    }
    if (context.scope === 'trial' && await sum(`scope = 'trial' AND day_key = ?`, input.day) + input.amount > limits.trialDay) return found('trial_day')
  }
  if (input.units > 0 && input.storeId) {
    const monthUsed = limits.monthlyUnits !== null ? await count(`SELECT ${COUNTED_UNITS} AS v FROM ai_spend_reservations WHERE store_id = ? AND cycle_key = ? AND id <> ?`, input.storeId, input.cycleKey, ex) : 0
    if (limits.monthlyUnits !== null && monthUsed + input.units > limits.monthlyUnits) {
      return found('monthly_units', { limit: limits.monthlyUnits, resetAt: input.cycleEnd ?? undefined, left: Math.max(0, limits.monthlyUnits - monthUsed), needed: input.units })
    }
  }
  return input.excludeId === undefined ? found('duplicate') : null
}

export type SettleInput = { outcome: 'ok' | 'http_error' | 'network_error' | 'truncated'; usage?: GeminiUsage; model: string }

/** Closes a reservation with the real cost. Billed outcomes use the measured usage; HTTP errors release it;
 * network errors keep the reserved amount (the call may have been billed). Returns the real cost. */
export async function settleSpend(context: SpendContext, reservation: Reservation, input: SettleInput, now = new Date()): Promise<number> {
  const { db } = context
  const usage = input.usage
  const measured = usage && (usage.promptTokens > 0 || usage.outputTokens > 0 || Number(usage.thoughtsTokens || 0) > 0)
  const actual = input.outcome === 'http_error'
    ? 0
    : input.outcome === 'network_error' || !measured
      ? reservation.reservedMicros
      : costOf(context.env, input.model, usage!, now).totalMicros
  await db.prepare(
    `UPDATE ai_spend_reservations SET status = ?, actual_micros = ?, outcome = ?, prompt_tokens = ?, output_tokens = ?, thoughts_tokens = ?,
       cached_tokens = ?, image_tokens = ?, pricing_version = ?, settled_at = datetime('now')
     WHERE id = ? AND status = 'reserved'`,
  ).bind(
    input.outcome === 'http_error' ? 'released' : 'settled', actual, input.outcome,
    usage?.promptTokens || 0, usage?.outputTokens || 0, usage?.thoughtsTokens || 0, usage?.cachedTokens || 0, usage?.imageOutputTokens || 0,
    PRICING_VERSION, reservation.id,
  ).run()
  if (actual > 0) await checkThresholds(context, reservation, now)
  return actual
}

/** Cron: closes reservations whose Worker never came back, at their reserved amount. */
export async function expireStaleReservations(db: D1Database, minutes = RESERVATION_TTL_MINUTES): Promise<number> {
  const result = await db.prepare(
    `UPDATE ai_spend_reservations SET status = 'expired', actual_micros = reserved_micros, outcome = 'expired', settled_at = datetime('now')
     WHERE status = 'reserved' AND created_at < datetime('now', ?)`,
  ).bind(`-${Math.max(1, Math.floor(minutes))} minutes`).run()
  return Number(result.meta?.changes || 0)
}

// ---- alerts ----------------------------------------------------------------------

/** Same keys as the 50/80 % alerts, so «100 %» means «limit reached» whether it was crossed or a call was refused. */
const limitKey = (reason: BlockReason, context: SpendContext, storeId: number | null) => ({
  global_day: 'global:day', global_month: 'global:month', store_day: `store:${storeId}:day`, store_month: `store:${storeId}:month`, images_month: `store:${storeId}:images`,
  monthly_units: `store:${storeId}:units`,
} as Partial<Record<BlockReason, string>>)[reason] ?? `${context.scope}:${reason}`
const limitLabel = (reason: BlockReason, storeId: number | null) => ({
  global_day: 'IA de la plataforma hoy', global_month: 'IA de la plataforma este mes', store_day: `IA de la tienda ${storeId} hoy`,
  store_month: `IA de la tienda ${storeId} este mes`, images_month: `Fotos IA de la tienda ${storeId} este mes`,
  monthly_units: `Consultas de IA de la tienda ${storeId} este mes`,
} as Partial<Record<BlockReason, string>>)[reason] ?? 'IA'
const periodOf = (reason: BlockReason, day: string, month: string) => reason.endsWith('_month') ? month : day

async function alert(db: D1Database, scopeKey: string, periodKey: string, threshold: 50 | 80 | 100, context: SpendContext, detail: string): Promise<boolean> {
  try {
    const inserted = await db.prepare('INSERT OR IGNORE INTO ai_spend_alerts (scope_key, period_key, threshold) VALUES (?, ?, ?) RETURNING threshold')
      .bind(scopeKey.slice(0, 120), periodKey, threshold).first()
    if (!inserted) return false
    await db.prepare(`INSERT INTO platform_events (store_id, level, source, code, detail) VALUES (?, ?, 'ai_spend', ?, ?)`)
      .bind(context.scope === 'store' ? context.storeId ?? null : null, threshold === 100 ? 'error' : 'warning', `AI_SPEND_${threshold}`, detail.slice(0, 300)).run()
    console.warn(`AI spend alert ${threshold}%: ${scopeKey} ${periodKey}`)
    return true
  } catch (error) {
    console.error('AI spend alert failed:', error instanceof Error ? error.message : 'unknown')
    return false
  }
}

async function checkThresholds(context: SpendContext, reservation: Reservation, now: Date): Promise<void> {
  const { db } = context
  if (reservation.billingSource === 'own_key') return
  const limits = reservation.limits
  const e = limits.environment
  const day = dayKey(now)
  const month = monthKey(now)
  const storeId = context.scope === 'store' && context.storeId ? context.storeId : null
  const totals = await db.prepare(
    `SELECT
       (SELECT ${COMMITTED} FROM ai_spend_reservations WHERE environment = ? AND day_key = ?) AS globalDay,
       (SELECT ${COMMITTED} FROM ai_spend_reservations WHERE environment = ? AND month_key = ?) AS globalMonth,
       (SELECT ${COMMITTED} FROM ai_spend_reservations WHERE environment = ? AND store_id = ? AND day_key = ?) AS storeDay,
       (SELECT ${COMMITTED} FROM ai_spend_reservations WHERE environment = ? AND store_id = ? AND month_key = ?) AS storeMonth`,
  ).bind(e, day, e, month, e, storeId ?? -1, day, e, storeId ?? -1, month).first<Record<string, number>>()
  const checks: Array<[string, string, number, number, string]> = [
    ['global:day', day, Number(totals?.globalDay || 0), limits.globalDay, 'IA de la plataforma hoy'],
    ['global:month', month, Number(totals?.globalMonth || 0), limits.globalMonth, 'IA de la plataforma este mes'],
  ]
  if (storeId && limits.storeDay && limits.storeMonth) {
    checks.push([`store:${storeId}:day`, day, Number(totals?.storeDay || 0), limits.storeDay, `IA de la tienda ${storeId} hoy`])
    checks.push([`store:${storeId}:month`, month, Number(totals?.storeMonth || 0), limits.storeMonth, `IA de la tienda ${storeId} este mes`])
  }
  for (const [key, period, spent, limit, label] of checks) {
    if (limit <= 0) continue
    const percent = (spent / limit) * 100
    for (const threshold of [50, 80, 100] as const) {
      if (percent >= threshold) await alert(db, key, period, threshold, context, `${label}: ${Math.round(percent)} % del límite (US$ ${(spent / 1e6).toFixed(4)} de ${(limit / 1e6).toFixed(2)})`)
    }
  }
}

// ---- the guarded call --------------------------------------------------------------

let warnedUnguarded = false

/** Size limits of what a request carries (decoded bytes of photos, audio and documents; text length). */
function tooLarge(body: unknown): boolean {
  const b = (body || {}) as { systemInstruction?: unknown; contents?: Array<{ parts?: Array<{ text?: string; inlineData?: { mimeType?: string; data?: string } }> }> }
  let text = 0
  for (const content of b.contents || []) {
    for (const part of content.parts || []) {
      if (typeof part.text === 'string') text += part.text.length
      const mime = part.inlineData?.mimeType || ''
      const bytes = Math.floor((part.inlineData?.data?.length || 0) * 0.75)
      if (mime.startsWith('image/') && bytes > MAX_IMAGE_BYTES) return true
      if (mime.startsWith('audio/') && bytes > MAX_AUDIO_BYTES) return true
      if (part.inlineData && !mime.startsWith('image/') && !mime.startsWith('audio/') && bytes > MAX_DOCUMENT_BYTES) return true
    }
  }
  return text > MAX_TEXT_CHARS
}

async function fingerprintOf(model: string, init: RequestInit): Promise<string | null> {
  if (typeof init.body !== 'string') return null
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${model}\n${init.body}`))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function withKey(init: RequestInit, apiKey: string): RequestInit {
  const headers = new Headers(init.headers)
  headers.set('x-goog-api-key', apiKey)
  return { ...init, headers }
}

/** The only way the platform calls the paid Gemini API. Decide who pays → reserve → call → settle. */
export async function guardedGeminiFetch(
  env: Bindings,
  fetcher: typeof fetch,
  url: string,
  init: RequestInit,
  info: { model: string; kind: SpendKind },
  options: { forcePlatform?: boolean } = {},
): Promise<Response> {
  const mode = guardMode(env)
  if (mode === 'off') return fetcher(url, init)
  const context = storage.getStore()
  if (!context) {
    if (mode === 'enforce' && deployed(env)) throw new AiSpendBlockedError('unguarded')
    if (!warnedUnguarded) { warnedUnguarded = true; console.warn('Gemini call without spend context (allowed outside production/staging)') }
    return fetcher(url, init)
  }
  let body: unknown = null
  try { body = typeof init.body === 'string' ? JSON.parse(init.body) : null } catch { body = null }
  if (tooLarge(body)) throw new AiSpendBlockedError('too_large')
  const storeId = context.scope === 'store' && context.storeId ? context.storeId : null

  // Who pays: the store's own key when it applies to this use and model; otherwise the plan (or the platform).
  const own = storeId && !options.forcePlatform ? await resolveOwnKey(context.db, context.env, storeId, useFor(context.feature, info.kind), info.model, context.feature) : null
  const billingSource: BillingSource = own ? 'own_key' : context.scope === 'store' ? 'plan' : context.scope === 'trial' ? 'trial' : 'platform'
  const units = billingSource === 'plan' ? await unitsFor(context.db, context.feature, body).catch(() => 1) : 0
  const estimate = estimateRequestMicros(context.env, info.model, body, info.kind)
  let reservation: Reservation
  try {
    reservation = await reserveSpend(context, { model: info.model, kind: info.kind, amountMicros: estimate, units, billingSource, fingerprint: await fingerprintOf(info.model, init) })
  } catch (error) {
    if (isSpendBlocked(error)) throw error
    // The ledger is unavailable: fail closed when enforcing, keep serving when only observing.
    console.error('AI spend reservation failed:', error instanceof Error ? error.message : 'unknown')
    if (mode === 'enforce') throw new AiSpendBlockedError('guard_unavailable')
    return fetcher(url, own ? withKey(init, own.apiKey) : init)
  }
  const settle = (input: SettleInput) => settleSpend(context, reservation, input).catch((error) => {
    console.error('AI spend settlement failed:', error instanceof Error ? error.message : 'unknown')
    return 0
  })
  // Every call has a deadline. A caller's own signal (the planner's) is respected; otherwise the default applies.
  const configured = Number((env as Record<string, unknown>).AI_CALL_TIMEOUT_MS)
  const timeoutMs = info.kind === 'text' && Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_CALL_TIMEOUT_MS[info.kind]
  const deadline = init.signal ? null : AbortSignal.timeout(timeoutMs)
  let response: Response
  try {
    // Only this store's key, only for this call. The platform key (set by the client) is never sent with it.
    const request = own ? withKey(init, own.apiKey) : init
    response = await fetcher(url, deadline ? { ...request, signal: deadline } : request)
  } catch (error) {
    await settle({ outcome: 'network_error', model: info.model })
    // Our deadline, or the caller's own (the planner gives the model a few seconds): either way the call was too slow.
    const callerGaveUp = Boolean(init.signal?.aborted)
    if (deadline?.aborted || callerGaveUp) {
      console.warn(`Gemini call timed out (${callerGaveUp ? 'caller deadline' : `${timeoutMs} ms`}, ${own ? 'own key' : 'platform key'}, ${context.feature})`)
      if (own && storeId) {
        await markOwnKeyResult(context.db, storeId, { ok: false, status: 'activa', code: 'TIMEOUT' })
        // A retry with the platform key only makes sense while the caller is still waiting.
        if (!callerGaveUp && own.fallbackToPlatform && !context.creditsWaived) return guardedGeminiFetch(env, fetcher, url, init, info, { forcePlatform: true })
        throw new AiSpendBlockedError('own_key_slow')
      }
      if (deadline?.aborted) throw new AiSpendBlockedError('model_timeout')
    }
    throw error
  }
  if (!response.ok) {
    await settle({ outcome: 'http_error', model: info.model })
    if (own && storeId) {
      const errorBody = await response.clone().text().catch(() => '')
      const keyStatus = statusFromHttp(response.status, errorBody)
      if (keyStatus) {
        await markOwnKeyResult(context.db, storeId, { ok: false, status: keyStatus, code: `HTTP_${response.status}`, kind: info.kind, detail: parseProviderError(response.status, errorBody) })
        // No silent fallback: the platform key is used only if the owner switched it on, and never for an
        // operation whose credits were waived because the own key was going to pay.
        if (own.fallbackToPlatform && !context.creditsWaived) return guardedGeminiFetch(env, fetcher, url, init, info, { forcePlatform: true })
        throw new AiSpendBlockedError('own_key_failed', false, { ownKeyStatus: keyStatus })
      }
    }
    return response
  }
  if (own && storeId) await markOwnKeyResult(context.db, storeId, { ok: true, kind: info.kind })
  const json = await response.clone().json().catch(() => null) as {
    usageMetadata?: unknown
    usage?: { total_input_tokens?: number; total_output_tokens?: number }
    candidates?: Array<{ finishReason?: string }>
  } | null
  const usage: GeminiUsage = json?.usageMetadata
    ? usageFromMetadata(json.usageMetadata)
    : { promptTokens: Number(json?.usage?.total_input_tokens || 0), outputTokens: Number(json?.usage?.total_output_tokens || 0) }
  await settle({ outcome: json?.candidates?.[0]?.finishReason === 'MAX_TOKENS' ? 'truncated' : 'ok', usage, model: info.model })
  return response
}

// ---- reading -----------------------------------------------------------------------

/** Spend summary for reports (estimates from the official price table; never includes content). */
export async function spendSummary(db: D1Database, env: Bindings, now = new Date()) {
  const e = environmentOf(env)
  const day = dayKey(now)
  const month = monthKey(now)
  const limits = await resolveLimits(db, env, 'platform', null, 'text')
  const totals = await db.prepare(
    `SELECT (SELECT ${COMMITTED} FROM ai_spend_reservations WHERE environment = ? AND day_key = ?) AS day,
            (SELECT ${COMMITTED} FROM ai_spend_reservations WHERE environment = ? AND month_key = ?) AS month`,
  ).bind(e, day, e, month).first<{ day: number; month: number }>()
  const byFeature = (await db.prepare(
    `SELECT feature, kind, COUNT(*) AS calls, ${COMMITTED} AS micros, SUM(CASE WHEN status = 'released' THEN 1 ELSE 0 END) AS released
     FROM ai_spend_reservations WHERE environment = ? AND month_key = ? GROUP BY feature, kind ORDER BY micros DESC`,
  ).bind(e, month).all()).results || []
  return { environment: e, mode: guardMode(env), pricingVersion: PRICING_VERSION, day: { spent: Number(totals?.day || 0), limit: limits.globalDay }, month: { spent: Number(totals?.month || 0), limit: limits.globalMonth }, byFeature }
}
