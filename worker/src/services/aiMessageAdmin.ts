/** Administrative view of the AI message counter: per-store consumption, anomalies, costs, and the two per-store
 * settings (cycle anchor day, quota override). Never exposes message content (the ledger does not keep any). */
import { getConsumption, quotaMode, type Consumption } from '../ai/messageQuota'

export class AiMessageAdminError extends Error {
  constructor(readonly code: string, message: string, readonly status: 400 | 404 = 400) { super(message) }
}

const ANOMALY_CODES = ['AI_USAGE_ANOMALY', 'AI_LOOP_SUSPECTED', 'AI_QUOTA_80', 'AI_QUOTA_100']

type StoreRow = { id: number; slug: string; name: string; status: string }

async function findStore(db: D1Database, slugOrId: string): Promise<StoreRow> {
  const row = await db.prepare('SELECT id, slug, name, status FROM stores WHERE slug = ? OR CAST(id AS TEXT) = ?').bind(slugOrId, slugOrId).first<StoreRow>()
  if (!row) throw new AiMessageAdminError('STORE_NOT_FOUND', `No encontré la tienda “${slugOrId}”.`, 404)
  return row
}

export function publicConsumption(info: Consumption) {
  return {
    planCode: info.planCode, policy: info.policy, overridden: info.overridden,
    cycle: { key: info.cycle.key, start: info.cycle.start, end: info.cycle.end, source: info.cycle.source, provisional: info.cycle.provisional },
    used: info.used, limit: info.limit, remaining: info.remaining, percent: info.percent,
    lastActivityAt: info.lastActivityAt, voiceMessages: info.voiceMessages,
    photos: info.photos, descriptions: info.descriptions,
    costs: { aiMicros: info.aiCostMicros, transcriptionMicros: info.transcriptionCostMicros, isEstimate: true },
  }
}

/** Own store (merchant panel): the same numbers the /consumo command shows. */
export async function storeConsumption(db: D1Database, env: Parameters<typeof quotaMode>[0], storeId: number) {
  return { mode: quotaMode(env), ...publicConsumption(await getConsumption(db, storeId)) }
}

/** All stores, most consumed first, with the observation signals of the last 7 days. */
export async function platformConsumption(db: D1Database, env: Parameters<typeof quotaMode>[0], options: { limit?: number } = {}) {
  const { results } = await db.prepare(`SELECT id, slug, name, status FROM stores WHERE status <> 'deleted' ORDER BY id LIMIT ?`).bind(Math.min(500, Math.max(1, options.limit || 200))).all<StoreRow>()
  const items = []
  for (const store of results || []) {
    const info = await getConsumption(db, store.id)
    const signals = await db.prepare(
      `SELECT code, COUNT(*) AS n FROM platform_events WHERE store_id = ? AND code IN (${ANOMALY_CODES.map(() => '?').join(',')}) AND created_at > datetime('now', '-7 days') GROUP BY code`,
    ).bind(store.id, ...ANOMALY_CODES).all<{ code: string; n: number }>()
    items.push({ store: { id: store.id, slug: store.slug, name: store.name, status: store.status }, ...publicConsumption(info), signals: Object.fromEntries((signals.results || []).map((row) => [row.code, Number(row.n)])) })
  }
  items.sort((a, b) => (b.percent ?? -1) - (a.percent ?? -1) || b.used - a.used)
  return {
    mode: quotaMode(env), items,
    totals: { stores: items.length, used: items.reduce((sum, item) => sum + item.used, 0), aiCostMicros: items.reduce((sum, item) => sum + item.costs.aiMicros, 0), nearLimit: items.filter((item) => (item.percent ?? 0) >= 80).length },
  }
}

export async function storeConsumptionDetail(db: D1Database, env: Parameters<typeof quotaMode>[0], slugOrId: string) {
  const store = await findStore(db, slugOrId)
  const [info, recent, alerts, events] = await Promise.all([
    getConsumption(db, store.id),
    db.prepare(
      `SELECT id, cycle_key AS cycleKey, channel, feature, status, mode, ai_cost_micros AS aiCostMicros, transcription_cost_micros AS transcriptionCostMicros, calls, audio_seconds AS audioSeconds, created_at AS createdAt, consumed_at AS consumedAt
       FROM ai_message_ledger WHERE store_id = ? ORDER BY id DESC LIMIT 50`,
    ).bind(store.id).all(),
    db.prepare('SELECT cycle_key AS cycleKey, threshold, used, quota, created_at AS createdAt FROM ai_message_alerts WHERE store_id = ? ORDER BY created_at DESC LIMIT 20').bind(store.id).all(),
    db.prepare(`SELECT code, level, detail, created_at AS createdAt FROM platform_events WHERE store_id = ? AND code IN (${ANOMALY_CODES.map(() => '?').join(',')}) ORDER BY id DESC LIMIT 20`).bind(store.id, ...ANOMALY_CODES).all(),
  ])
  return { mode: quotaMode(env), store, ...publicConsumption(info), recent: recent.results || [], alerts: alerts.results || [], events: events.results || [] }
}

/** Per-store settings: cycle anchor day (1-28 or null) and quota override (>= 0 or null). Audited; never touches
 * invoices, contracts or billing dates. */
export async function setStoreMessageSettings(
  db: D1Database, slugOrId: string, input: { cycleAnchorDay?: number | null; monthlyMessagesOverride?: number | null }, actor: string,
) {
  const store = await findStore(db, slugOrId)
  const { cycleAnchorDay: anchor, monthlyMessagesOverride: override } = input
  if (anchor !== undefined && anchor !== null && (!Number.isInteger(anchor) || anchor < 1 || anchor > 28)) throw new AiMessageAdminError('INVALID_ANCHOR', 'El día del ciclo debe ser un entero entre 1 y 28.')
  if (override !== undefined && override !== null && (!Number.isInteger(override) || override < 0 || override > 1_000_000)) throw new AiMessageAdminError('INVALID_OVERRIDE', 'La cuota debe ser un entero entre 0 y 1.000.000.')
  if (anchor === undefined && override === undefined) throw new AiMessageAdminError('NOTHING_TO_CHANGE', 'Indica el día del ciclo o la cuota de mensajes.')
  const current = await db.prepare('SELECT ai_cycle_anchor_day AS anchor, ai_monthly_messages_override AS override FROM stores WHERE id = ?').bind(store.id).first<{ anchor: number | null; override: number | null }>()
  const next = { anchor: anchor === undefined ? current?.anchor ?? null : anchor, override: override === undefined ? current?.override ?? null : override }
  await db.batch([
    db.prepare(`UPDATE stores SET ai_cycle_anchor_day = ?, ai_monthly_messages_override = ?, updated_at = datetime('now') WHERE id = ?`).bind(next.anchor, next.override, store.id),
    db.prepare(`INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id) VALUES ('store_ai_messages_changed', 'store', ?, ?, ?, 'platform', ?)`)
      .bind(String(store.id), JSON.stringify({ before: current, after: next }), actor, store.id),
  ])
  return { store, cycleAnchorDay: next.anchor, monthlyMessagesOverride: next.override }
}

const CATEGORY_OF: Record<string, string> = {
  interpretacion: 'conversaciones', consejos: 'conversaciones', pregunta: 'conversaciones',
  voz: 'voz',
  estudio_imagen: 'fotos', foto_packshot: 'fotos', foto_premium: 'fotos',
  descripcion: 'descripciones',
}

/** Measured (estimated-from-tokens) AI cost by category over the last N days, from the usage events that already exist.
 * Distinguishes conversations, voice (with the audio share recorded in the message ledger), photos, descriptions and the rest.
 * Infrastructure (Workers, D1, R2, email) is NOT measurable per store: the operator passes the monthly figure from the provider invoices. */
export async function aiCostReport(db: D1Database, options: { days?: number; infraMonthlyMicros?: number } = {}) {
  const days = Math.min(365, Math.max(1, Math.round(options.days || 30)))
  const since = `-${days} days`
  const { results } = await db.prepare(
    `SELECT feature, status, COUNT(*) AS calls, COALESCE(SUM(prompt_tokens), 0) AS promptTokens, COALESCE(SUM(output_tokens), 0) AS outputTokens, COALESCE(SUM(estimated_cost_micros), 0) AS costMicros
     FROM ai_usage_events WHERE created_at >= datetime('now', ?) GROUP BY feature, status`,
  ).bind(since).all<{ feature: string; status: string; calls: number; promptTokens: number; outputTokens: number; costMicros: number }>()
  const categories: Record<string, { calls: number; errors: number; blocked: number; promptTokens: number; outputTokens: number; costMicros: number; avgCostPerCallMicros: number | null }> = {}
  for (const row of results || []) {
    const name = CATEGORY_OF[row.feature] || 'otros'
    const entry = categories[name] ||= { calls: 0, errors: 0, blocked: 0, promptTokens: 0, outputTokens: 0, costMicros: 0, avgCostPerCallMicros: null }
    if (row.status === 'ok') { entry.calls += Number(row.calls); entry.promptTokens += Number(row.promptTokens); entry.outputTokens += Number(row.outputTokens); entry.costMicros += Number(row.costMicros) }
    else if (row.status === 'error') entry.errors += Number(row.calls)
    else entry.blocked += Number(row.calls)
  }
  for (const entry of Object.values(categories)) entry.avgCostPerCallMicros = entry.calls ? Math.round(entry.costMicros / entry.calls) : null
  const transcription = await db.prepare(
    `SELECT COUNT(*) AS notes, COALESCE(SUM(audio_seconds), 0) AS seconds, COALESCE(SUM(transcription_cost_micros), 0) AS micros
     FROM ai_message_ledger WHERE channel = 'telegram_voice' AND status = 'consumed' AND created_at >= datetime('now', ?)`,
  ).bind(since).first<{ notes: number; seconds: number; micros: number }>()
  const top = await db.prepare(
    `SELECT s.slug, COALESCE(SUM(e.estimated_cost_micros), 0) AS costMicros, COUNT(*) AS calls
     FROM ai_usage_events e JOIN stores s ON s.id = e.store_id WHERE e.status = 'ok' AND e.created_at >= datetime('now', ?) GROUP BY s.id ORDER BY costMicros DESC LIMIT 10`,
  ).bind(since).all()
  const total = Object.values(categories).reduce((sum, entry) => sum + entry.costMicros, 0)
  const infra = options.infraMonthlyMicros && options.infraMonthlyMicros > 0 ? Math.round((options.infraMonthlyMicros * days) / 30) : null
  return {
    windowDays: days, isEstimate: true,
    note: 'Costos estimados con los tokens registrados y los precios configurados; no son la factura del proveedor.',
    categories,
    transcription: { voiceNotes: Number(transcription?.notes || 0), audioSeconds: Number(transcription?.seconds || 0), estimatedAudioShareMicros: Number(transcription?.micros || 0), isEstimate: true },
    topStores: top.results || [],
    totals: { aiCostMicros: total, infrastructureMicros: infra, infrastructureMeasured: false },
    infrastructure: 'Workers, D1, R2 y correo se facturan por cuenta: no hay medición por tienda. Se prorratea solo si se informa el costo mensual de la factura.',
  }
}
