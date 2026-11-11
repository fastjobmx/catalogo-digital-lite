/** Quota of AI messages per store and billing cycle (TiendIA phase 2).
 *
 * Modes (AI_MESSAGE_QUOTA_MODE): 'off' counts nothing (default), 'shadow' counts and alerts without ever
 * blocking, 'enforce' also refuses AI interpretation once the quota of the plan is used up.
 *
 * One AI interaction = one row of ai_message_ledger, keyed by (store, Telegram event). Retries of the same
 * event, several Gemini calls inside one message, and a voice note (transcription + interpretation in a single
 * call) never count twice. Only an interaction that finished successfully is 'consumed'. Deterministic
 * functions (buttons, help, queries, confirmations) never pass through here and are never blocked. */
import type { Env } from '../index'

export type QuotaMode = 'off' | 'shadow' | 'enforce'

/** Features that are a merchant conversation with the AI. Photos, documents and brand analysis are paid with
 * credits and are administered separately. */
export const COUNTED_FEATURES = new Set(['interpretacion', 'voz', 'consejos', 'pregunta'])
/** Included separately in the commercial offer (own monthly figures), so they do not use the message quota. */
export const PHOTO_FEATURES = ['estudio_imagen', 'foto_packshot', 'foto_premium'] as const
export const DESCRIPTION_FEATURE = 'descripcion'

/** Gemini audio is billed at about 32 tokens per second; used only to label the share of a voice note. */
const AUDIO_TOKENS_PER_SECOND = 32
const RESERVATION_TTL = '-10 minutes'
/** America/Bogota is UTC-5 all year (no daylight saving). */
const BOGOTA_OFFSET_MS = -5 * 3_600_000

export function quotaMode(env: Partial<Env['Bindings']>): QuotaMode {
  const value = String(env.AI_MESSAGE_QUOTA_MODE || 'off').trim().toLowerCase()
  return value === 'shadow' || value === 'enforce' ? value : 'off'
}

export type CycleSource = 'store' | 'service' | 'calendar'
export type BillingCycle = { key: string; start: string; end: string; source: CycleSource; provisional: boolean; anchorDay: number }

const pad = (value: number) => String(value).padStart(2, '0')
const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
const dateKey = (year: number, month: number, day: number) => `${year}-${pad(month + 1)}-${pad(day)}`

/** Cycle that contains `now`, in Bogotá local dates. The anchor day is clamped in short months (31 → 28/29/30). */
export function cycleFor(anchorDay: number, now: Date, source: CycleSource): BillingCycle {
  const local = new Date(now.getTime() + BOGOTA_OFFSET_MS)
  let year = local.getUTCFullYear()
  let month = local.getUTCMonth()
  const today = local.getUTCDate()
  const startDay = (y: number, m: number) => Math.min(anchorDay, daysInMonth(y, m))
  if (today < startDay(year, month)) { month -= 1; if (month < 0) { month = 11; year -= 1 } }
  let endYear = year
  let endMonth = month + 1
  if (endMonth > 11) { endMonth = 0; endYear += 1 }
  return {
    key: dateKey(year, month, startDay(year, month)),
    start: dateKey(year, month, startDay(year, month)),
    end: dateKey(endYear, endMonth, startDay(endYear, endMonth)),
    source,
    provisional: source === 'calendar',
    anchorDay,
  }
}

/** The real billing cycle when there is one: the store's own anchor day, else the start date of its active
 * monthly/annual service; otherwise the calendar month (provisional, observation only). */
export async function resolveCycle(db: D1Database, storeId: number, now = new Date()): Promise<BillingCycle> {
  const store = await db.prepare('SELECT ai_cycle_anchor_day AS anchor FROM stores WHERE id = ?').bind(storeId).first<{ anchor: number | null }>()
  const anchor = Number(store?.anchor)
  if (Number.isInteger(anchor) && anchor >= 1 && anchor <= 28) return cycleFor(anchor, now, 'store')
  const service = await db.prepare(
    `SELECT starts_at AS startsAt FROM store_services
     WHERE store_id = ? AND status = 'activo' AND billing IN ('mensual', 'anual') AND starts_at IS NOT NULL
       AND service_code IN ('asistente_ia', 'mantenimiento_mensual')
     ORDER BY starts_at ASC LIMIT 1`,
  ).bind(storeId).first<{ startsAt: string }>()
  const parsed = service?.startsAt ? new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(service.startsAt) ? service.startsAt : `${service.startsAt.replace(' ', 'T')}Z`) : null
  if (parsed && !Number.isNaN(parsed.getTime())) {
    const day = new Date(parsed.getTime() + BOGOTA_OFFSET_MS).getUTCDate()
    return cycleFor(day, now, 'service')
  }
  return cycleFor(1, now, 'calendar')
}

export type QuotaPolicy = 'none' | 'quota' | 'monitored'
export type QuotaLimit = { planCode: string | null; limit: number | null; policy: QuotaPolicy; overridden: boolean }

/** Limit of the store: its own override, else the one of its plan. NULL = no numeric cap. */
export async function resolveLimit(db: D1Database, storeId: number): Promise<QuotaLimit> {
  const row = await db.prepare(
    `SELECT s.plan_code AS planCode, s.ai_monthly_messages_override AS override, p.ai_monthly_messages AS planLimit, p.ai_usage_policy AS policy
     FROM stores s LEFT JOIN plans p ON p.code = s.plan_code WHERE s.id = ?`,
  ).bind(storeId).first<{ planCode: string | null; override: number | null; planLimit: number | null; policy: string | null }>()
  const override = row?.override
  const hasOverride = override !== null && override !== undefined && Number(override) >= 0
  const planLimit = row?.planLimit
  const limit = hasOverride ? Number(override) : (planLimit !== null && planLimit !== undefined && Number(planLimit) >= 0 ? Number(planLimit) : null)
  const policy = (row?.policy === 'quota' || row?.policy === 'monitored' ? row.policy : 'none') as QuotaPolicy
  return { planCode: row?.planCode ?? null, limit, policy: hasOverride ? 'quota' : policy, overridden: hasOverride }
}

const LIVE = `(status = 'consumed' OR (status = 'reserved' AND created_at > datetime('now', '${RESERVATION_TTL}')))`

export type Allowance = { used: number; included: number | null; remaining: number | null }

export type Consumption = {
  photos: Allowance
  descriptions: Allowance
  storeId: number
  planCode: string | null
  policy: QuotaPolicy
  cycle: BillingCycle
  used: number
  limit: number | null
  remaining: number | null
  percent: number | null
  overridden: boolean
  lastActivityAt: string | null
  aiCostMicros: number
  transcriptionCostMicros: number
  voiceMessages: number
}

export async function getConsumption(db: D1Database, storeId: number, now = new Date()): Promise<Consumption> {
  const [cycle, limit] = await Promise.all([resolveCycle(db, storeId, now), resolveLimit(db, storeId)])
  const row = await db.prepare(
    `SELECT COUNT(*) AS used, MAX(consumed_at) AS lastAt, COALESCE(SUM(ai_cost_micros), 0) AS cost,
            COALESCE(SUM(transcription_cost_micros), 0) AS transcription, COALESCE(SUM(channel = 'telegram_voice'), 0) AS voice
     FROM ai_message_ledger WHERE store_id = ? AND cycle_key = ? AND status = 'consumed'`,
  ).bind(storeId, cycle.key).first<{ used: number; lastAt: string | null; cost: number; transcription: number; voice: number }>()
  const used = Number(row?.used || 0)
  // Photo enhancements and descriptions: observed from the existing usage events, in the same billing cycle (UTC window of the Bogota days).
  const from = `${cycle.start} 05:00:00`
  const to = `${cycle.end} 05:00:00`
  const events = await db.prepare(
    `SELECT COALESCE(SUM(CASE WHEN feature IN (${PHOTO_FEATURES.map(() => '?').join(',')}) THEN 1 ELSE 0 END), 0) AS photos,
            COALESCE(SUM(CASE WHEN feature = ? THEN 1 ELSE 0 END), 0) AS descriptions
     FROM ai_usage_events WHERE store_id = ? AND status = 'ok' AND created_at >= ? AND created_at < ?`,
  ).bind(...PHOTO_FEATURES, DESCRIPTION_FEATURE, storeId, from, to).first<{ photos: number; descriptions: number }>()
  const included = await db.prepare(
    `SELECT p.ai_photo_monthly AS photos, p.ai_description_monthly AS descriptions FROM stores s LEFT JOIN plans p ON p.code = s.plan_code WHERE s.id = ?`,
  ).bind(storeId).first<{ photos: number | null; descriptions: number | null }>()
  const allowance = (usedCount: number, figure: number | null | undefined): Allowance => ({
    used: usedCount, included: figure ?? null, remaining: figure === null || figure === undefined ? null : Math.max(0, figure - usedCount),
  })
  return {
    photos: allowance(Number(events?.photos || 0), included?.photos), descriptions: allowance(Number(events?.descriptions || 0), included?.descriptions),
    storeId, planCode: limit.planCode, policy: limit.policy, cycle, used, limit: limit.limit,
    remaining: limit.limit === null ? null : Math.max(0, limit.limit - used),
    percent: limit.limit ? Math.min(999, Math.round((used / limit.limit) * 100)) : null,
    overridden: limit.overridden, lastActivityAt: row?.lastAt ?? null,
    aiCostMicros: Number(row?.cost || 0), transcriptionCostMicros: Number(row?.transcription || 0), voiceMessages: Number(row?.voice || 0),
  }
}

export type Reservation =
  | { state: 'off' }
  | { state: 'counted' | 'duplicate'; cycleKey: string; limit: number | null; used: number }
  | { state: 'blocked'; cycle: BillingCycle; limit: number; used: number }

export type MessageRef = { storeId: number; eventKey: string; feature: string; voiceSeconds?: number; fingerprint?: string | null }

/** Reserves one interaction. The insert and the quota check are a single statement, so two simultaneous
 * messages can never exceed the limit; the same event key never inserts twice. */
export async function reserveMessage(db: D1Database, env: Partial<Env['Bindings']>, ref: MessageRef, now = new Date()): Promise<Reservation> {
  const mode = quotaMode(env)
  if (mode === 'off' || !COUNTED_FEATURES.has(ref.feature)) return { state: 'off' }
  const [cycle, limit] = await Promise.all([resolveCycle(db, ref.storeId, now), resolveLimit(db, ref.storeId)])
  const enforce = mode === 'enforce' && limit.limit !== null ? 1 : 0
  const channel = ref.voiceSeconds ? 'telegram_voice' : 'telegram_text'
  const capacity = `(? = 0 OR (SELECT COUNT(*) FROM ai_message_ledger WHERE store_id = ? AND cycle_key = ? AND ${LIVE}) < ?)`
  const inserted = await db.prepare(
    `INSERT INTO ai_message_ledger (store_id, cycle_key, event_key, channel, feature, status, mode, plan_code, limit_at_time, fingerprint, audio_seconds)
     SELECT ?, ?, ?, ?, ?, 'reserved', ?, ?, ?, ?, ?
     WHERE ${capacity}
     ON CONFLICT(store_id, event_key) DO NOTHING`,
  ).bind(
    ref.storeId, cycle.key, ref.eventKey, channel, ref.feature, mode, limit.planCode, limit.limit, ref.fingerprint ?? null, Math.max(0, Math.round(ref.voiceSeconds || 0)),
    enforce, ref.storeId, cycle.key, limit.limit ?? 0,
  ).run()
  const used = (await getUsed(db, ref.storeId, cycle.key))
  if (Number(inserted.meta.changes || 0) > 0) return { state: 'counted', cycleKey: cycle.key, limit: limit.limit, used }
  const existing = await db.prepare('SELECT status, cycle_key AS cycleKey FROM ai_message_ledger WHERE store_id = ? AND event_key = ?').bind(ref.storeId, ref.eventKey).first<{ status: string; cycleKey: string }>()
  if (existing?.status === 'released') {
    // The first call of this message failed; a later call may take the reservation again if there is room.
    const retaken = await db.prepare(
      `UPDATE ai_message_ledger SET status = 'reserved', created_at = datetime('now')
       WHERE store_id = ? AND event_key = ? AND status = 'released' AND ${capacity}`,
    ).bind(ref.storeId, ref.eventKey, enforce, ref.storeId, existing.cycleKey, limit.limit ?? 0).run()
    if (Number(retaken.meta.changes || 0) > 0) return { state: 'counted', cycleKey: existing.cycleKey, limit: limit.limit, used: await getUsed(db, ref.storeId, existing.cycleKey) }
  } else if (existing) {
    return { state: 'duplicate', cycleKey: existing.cycleKey, limit: limit.limit, used }
  }
  return { state: 'blocked', cycle, limit: limit.limit ?? 0, used }
}

async function getUsed(db: D1Database, storeId: number, cycleKey: string): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM ai_message_ledger WHERE store_id = ? AND cycle_key = ? AND ${LIVE}`).bind(storeId, cycleKey).first<{ n: number }>()
  return Number(row?.n || 0)
}

export type QuotaAlert = { threshold: 80 | 100; used: number; limit: number; cycle: BillingCycle }

/** Marks the interaction as consumed (the first successful call) and reports a newly crossed 80 % / 100 %
 * threshold exactly once per cycle. A second successful call of the same message only adds its cost. */
export async function completeMessage(
  db: D1Database, env: Partial<Env['Bindings']>, ref: MessageRef, result: { costMicros: number; promptTokens: number },
  now = new Date(),
): Promise<{ alert: QuotaAlert | null }> {
  if (quotaMode(env) === 'off' || !COUNTED_FEATURES.has(ref.feature)) return { alert: null }
  const audioMicros = ref.voiceSeconds
    ? Math.min(result.costMicros, Math.ceil((Math.max(0, ref.voiceSeconds) * AUDIO_TOKENS_PER_SECOND * (Number(env.GEMINI_PRICE_INPUT_MICROS_PER_MTOK) || 300_000)) / 1_000_000))
    : 0
  const first = await db.prepare(
    `UPDATE ai_message_ledger SET status = 'consumed', consumed_at = datetime('now'), calls = calls + 1,
            ai_cost_micros = ai_cost_micros + ?, transcription_cost_micros = transcription_cost_micros + ?
     WHERE store_id = ? AND event_key = ? AND status = 'reserved' RETURNING cycle_key AS cycleKey, limit_at_time AS limitAt`,
  ).bind(Math.max(0, result.costMicros), audioMicros, ref.storeId, ref.eventKey).first<{ cycleKey: string; limitAt: number | null }>()
  if (!first) {
    await db.prepare(`UPDATE ai_message_ledger SET calls = calls + 1, ai_cost_micros = ai_cost_micros + ? WHERE store_id = ? AND event_key = ? AND status = 'consumed'`)
      .bind(Math.max(0, result.costMicros), ref.storeId, ref.eventKey).run()
    return { alert: null }
  }
  const consumption = await getConsumption(db, ref.storeId, now)
  await watchAnomalies(db, env, ref.storeId, consumption)
  const limit = consumption.limit
  if (!limit || limit <= 0 || consumption.policy === 'none') return { alert: null }
  let alert: QuotaAlert | null = null
  for (const threshold of [80, 100] as const) {
    if (consumption.used * 100 < limit * threshold) continue
    const marked = await db.prepare('INSERT OR IGNORE INTO ai_message_alerts (store_id, cycle_key, threshold, used, quota) VALUES (?, ?, ?, ?, ?)')
      .bind(ref.storeId, first.cycleKey, threshold, consumption.used, limit).run()
    if (Number(marked.meta.changes || 0) > 0) {
      alert = { threshold, used: consumption.used, limit, cycle: consumption.cycle }
      await db.prepare(`INSERT INTO platform_events (store_id, level, source, code, detail) VALUES (?, ?, 'ai', ?, ?)`)
        .bind(ref.storeId, threshold === 100 ? 'warning' : 'info', `AI_QUOTA_${threshold}`, `${consumption.used} de ${limit} mensajes con IA en el ciclo ${first.cycleKey}`).run().catch(() => undefined)
    }
  }
  return { alert }
}

/** The AI call failed: the interaction does not count. A message that already succeeded once is left alone. */
export async function releaseMessage(db: D1Database, env: Partial<Env['Bindings']>, ref: MessageRef): Promise<void> {
  if (quotaMode(env) === 'off' || !COUNTED_FEATURES.has(ref.feature)) return
  await db.prepare(`UPDATE ai_message_ledger SET status = 'released' WHERE store_id = ? AND event_key = ? AND status = 'reserved'`).bind(ref.storeId, ref.eventKey).run()
}

function threshold(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

/** Observation only (never blocks): unusually many messages in a day, or the same text repeated in a loop. */
async function watchAnomalies(db: D1Database, env: Partial<Env['Bindings']>, storeId: number, consumption: Consumption): Promise<void> {
  const daily = threshold(env.AI_MONITOR_DAILY_MESSAGES, consumption.policy === 'monitored' ? 300 : 150)
  const today = await db.prepare(`SELECT COUNT(*) AS n FROM ai_message_ledger WHERE store_id = ? AND status = 'consumed' AND consumed_at > datetime('now', '-1 day')`).bind(storeId).first<{ n: number }>()
  if (Number(today?.n || 0) >= daily) await onceEvent(db, storeId, 'AI_USAGE_ANOMALY', `${today?.n} mensajes con IA en 24 horas (umbral ${daily})`, '-1 day')
  const loop = await db.prepare(
    `SELECT fingerprint, COUNT(*) AS n FROM ai_message_ledger
     WHERE store_id = ? AND fingerprint IS NOT NULL AND created_at > datetime('now', '-10 minutes') GROUP BY fingerprint HAVING COUNT(*) >= ? LIMIT 1`,
  ).bind(storeId, threshold(env.AI_MONITOR_LOOP_REPEATS, 6)).first<{ n: number }>()
  if (loop) await onceEvent(db, storeId, 'AI_LOOP_SUSPECTED', `El mismo mensaje se repitió ${loop.n} veces en 10 minutos`, '-1 hour')
}

async function onceEvent(db: D1Database, storeId: number, code: string, detail: string, within: string): Promise<void> {
  const seen = await db.prepare(`SELECT 1 AS x FROM platform_events WHERE store_id = ? AND code = ? AND created_at > datetime('now', ?) LIMIT 1`).bind(storeId, code, within).first()
  if (seen) return
  await db.prepare(`INSERT INTO platform_events (store_id, level, source, code, detail) VALUES (?, 'warning', 'ai', ?, ?)`).bind(storeId, code, detail).run().catch(() => undefined)
}

/** Observation only: the included photos / descriptions of a plan are not enforced, so the platform is told
 * (once per cycle and threshold) when a store reaches 80 % and 100 % of them. Never blocks and never throws. */
export async function watchAllowances(db: D1Database, storeId: number, feature: string, now = new Date()): Promise<void> {
  const isPhoto = (PHOTO_FEATURES as readonly string[]).includes(feature)
  if (!isPhoto && feature !== DESCRIPTION_FEATURE) return
  try {
    const info = await getConsumption(db, storeId, now)
    const allowance = isPhoto ? info.photos : info.descriptions
    if (!allowance.included || allowance.included <= 0) return
    const code = isPhoto ? 'AI_PHOTOS' : 'AI_DESCRIPTIONS'
    for (const threshold of [80, 100] as const) {
      if (allowance.used * 100 < allowance.included * threshold) continue
      const tag = `[${info.cycle.key}]`
      const seen = await db.prepare(`SELECT 1 AS x FROM platform_events WHERE store_id = ? AND code = ? AND detail LIKE ? LIMIT 1`).bind(storeId, `${code}_${threshold}`, `%${tag}%`).first()
      if (seen) continue
      await db.prepare(`INSERT INTO platform_events (store_id, level, source, code, detail) VALUES (?, ?, 'ai', ?, ?)`)
        .bind(storeId, threshold === 100 ? 'warning' : 'info', `${code}_${threshold}`, `${tag} ${allowance.used} de ${allowance.included} incluidos (solo observación, no bloquea)`).run()
    }
  } catch (error) {
    console.error('Allowance watch failed:', error instanceof Error ? error.message : 'unknown')
  }
}

/** SHA-256 (first 16 hex chars) of the normalized text: lets us detect loops without storing the message. */
export async function fingerprintText(text: string): Promise<string> {
  const normalized = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().slice(0, 400)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized))
  return [...new Uint8Array(digest)].slice(0, 8).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function formatCycleDate(isoDate: string): string {
  const [, month, day] = isoDate.split('-')
  const names = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
  return `${Number(day)} de ${names[Number(month) - 1]}`
}

export const QUOTA_BLOCKED_MESSAGE = (limit: number, renewsOn: string) =>
  `Usaste los ${limit} mensajes con IA de este ciclo. Se renuevan el ${formatCycleDate(renewsOn)}. Mientras tanto puedes usar los botones, /menu, /ayuda, consultar tu inventario y confirmar o cancelar los cambios que ya preparé.`

export function quotaAlertText(alert: QuotaAlert): string {
  if (alert.threshold === 100) {
    return `ℹ️ Llegaste a ${alert.limit} de ${alert.limit} mensajes con IA de este ciclo. Se renuevan el ${formatCycleDate(alert.cycle.end)}. Los botones y las consultas siguen funcionando.`
  }
  return `ℹ️ Llevas ${alert.used} de ${alert.limit} mensajes con IA de este ciclo (80 %). Se renuevan el ${formatCycleDate(alert.cycle.end)}.`
}
