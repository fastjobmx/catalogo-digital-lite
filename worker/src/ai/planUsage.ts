/** Smart queries ("consultas inteligentes equivalentes") per plan: a 5-hour session that starts with the store's
 * first AI query, plus a monthly allowance per billing cycle.
 *
 * Each AI operation weighs a fixed, visible number of queries (table `ai_unit_weights`), calibrated with measured
 * costs: 1 query ≈ US$ 0.0011–0.0013 at the 2026 price. What the deterministic rules answer weighs 0.
 * The counters live in `ai_spend_reservations` (one row per paid call), so the same atomic reservation that checks
 * money limits also checks the session and the month. Operations paid with the store's own API key or with
 * artistic credits never count queries.
 */
import type { Env } from '../index'
import { resolveCycle, type BillingCycle } from './messageQuota'

type Bindings = Partial<Env['Bindings']>

export const SESSION_HOURS = 5

/** Fallback weights (the table in D1 is the source of truth; these cover installations before 0030). */
export const DEFAULT_UNIT_WEIGHTS: Record<string, { units: number; perItem: boolean; label: string }> = {
  interpretacion: { units: 1, perItem: false, label: 'Mensaje interpretado con IA' },
  pregunta: { units: 1, perItem: false, label: 'Pregunta respondida con IA' },
  consejos: { units: 1, perItem: false, label: 'Consejos con IA' },
  identidad_visual: { units: 1, perItem: false, label: 'Sugerencia de colores con IA' },
  creativo_texto: { units: 1, perItem: false, label: 'Textos comerciales con IA' },
  pedidos: { units: 2, perItem: false, label: 'Consulta o reporte de pedidos con IA' },
  voz: { units: 4, perItem: false, label: 'Nota de voz (hasta 2 minutos)' },
  fotos_ia: { units: 4, perItem: false, label: 'Foto a producto con IA' },
  foto_a_producto: { units: 4, perItem: false, label: 'Foto a producto con IA' },
  descripcion: { units: 4, perItem: false, label: 'Descripción con IA' },
  agrupar_fotos: { units: 2, perItem: true, label: 'Organizar fotos de un lote (por foto)' },
  documentos: { units: 4, perItem: true, label: 'Leer un documento (por archivo)' },
  importar_pdf_pagina: { units: 4, perItem: false, label: 'Leer una página de PDF' },
  leer_guia_envio: { units: 4, perItem: false, label: 'Leer una guía de envío' },
  estudio_imagen: { units: 0, perItem: false, label: 'Imagen premium (usa créditos)' },
  foto_packshot: { units: 0, perItem: false, label: 'Imagen premium (usa créditos)' },
  foto_premium: { units: 0, perItem: false, label: 'Imagen premium (usa créditos)' },
  video_ia_segundo: { units: 0, perItem: false, label: 'Video con IA (usa créditos)' },
}
/** An operation not in the table weighs like a message: nothing paid is ever free by omission. */
const UNKNOWN_FEATURE_UNITS = 1

export type UnitWeight = { feature: string; units: number; perItem: boolean; label: string }

export async function unitWeights(db: D1Database): Promise<UnitWeight[]> {
  const rows = (await db.prepare('SELECT feature, units, per_item AS perItem, label FROM ai_unit_weights ORDER BY units, feature').all<{ feature: string; units: number; perItem: number; label: string }>().catch(() => ({ results: [] }))).results || []
  if (rows.length) return rows.map((row) => ({ feature: row.feature, units: Number(row.units), perItem: Boolean(row.perItem), label: row.label }))
  return Object.entries(DEFAULT_UNIT_WEIGHTS).map(([feature, weight]) => ({ feature, ...weight }))
}

/** Items a per-item operation covers: photos (or documents) inside the request. */
function itemsIn(body: unknown): number {
  const b = (body || {}) as { contents?: Array<{ parts?: Array<{ inlineData?: { mimeType?: string } }> }> }
  let items = 0
  for (const content of b.contents || []) for (const part of content.parts || []) if (part.inlineData && !String(part.inlineData.mimeType || '').startsWith('audio/')) items++
  return Math.max(1, items)
}

/** Queries this request weighs. */
export async function unitsFor(db: D1Database, feature: string, body: unknown): Promise<number> {
  const row = await db.prepare('SELECT units, per_item AS perItem FROM ai_unit_weights WHERE feature = ?').bind(feature).first<{ units: number; perItem: number }>().catch(() => null)
  const weight = row ? { units: Number(row.units), perItem: Boolean(row.perItem) } : DEFAULT_UNIT_WEIGHTS[feature] ?? { units: UNKNOWN_FEATURE_UNITS, perItem: false }
  return weight.perItem ? weight.units * itemsIn(body) : weight.units
}

export type PlanQuota = {
  planCode: string | null
  sessionUnits: number | null
  monthlyUnits: number | null
  monthlyCredits: number | null
  budgetCop: number | null
  /** True when the plan (or an override) sets a numeric allowance of queries. */
  metered: boolean
}

export async function planQuota(db: D1Database, storeId: number): Promise<PlanQuota> {
  const row = await db.prepare(
    `SELECT s.plan_code AS planCode, s.ai_session_units_override AS sessionOverride, s.ai_monthly_units_override AS monthlyOverride,
            p.ai_session_units AS sessionUnits, p.ai_monthly_units AS monthlyUnits, p.ai_monthly_credits AS monthlyCredits, p.ai_monthly_budget_cop AS budgetCop
     FROM stores s LEFT JOIN plans p ON p.code = s.plan_code WHERE s.id = ?`,
  ).bind(storeId).first<Record<string, number | string | null>>()
  const num = (value: unknown) => value === null || value === undefined ? null : Number(value)
  const sessionUnits = num(row?.sessionOverride) ?? num(row?.sessionUnits)
  const monthlyUnits = num(row?.monthlyOverride) ?? num(row?.monthlyUnits)
  return {
    planCode: (row?.planCode as string | null) ?? null,
    sessionUnits, monthlyUnits,
    monthlyCredits: num(row?.monthlyCredits),
    budgetCop: num(row?.budgetCop),
    metered: sessionUnits !== null || monthlyUnits !== null,
  }
}

const sqlTime = (date: Date) => date.toISOString().slice(0, 19).replace('T', ' ')

export type OpenSession = { id: number; startedAt: string; endsAt: string; unitsLimit: number | null }

/** The store's open session, opening one if there is none. One statement: two simultaneous first queries
 * cannot open two sessions. */
export async function ensureSession(db: D1Database, storeId: number, unitsLimit: number | null, now = new Date()): Promise<OpenSession> {
  const at = sqlTime(now)
  const ends = sqlTime(new Date(now.getTime() + SESSION_HOURS * 3_600_000))
  await db.prepare(
    `INSERT INTO ai_sessions (store_id, started_at, ends_at, units_limit)
     SELECT ?1, ?2, ?3, ?4 WHERE NOT EXISTS (SELECT 1 FROM ai_sessions WHERE store_id = ?1 AND ends_at > ?2)`,
  ).bind(storeId, at, ends, unitsLimit).run()
  return (await currentSession(db, storeId, now))!
}

export async function currentSession(db: D1Database, storeId: number, now = new Date()): Promise<OpenSession | null> {
  const row = await db.prepare('SELECT id, started_at AS startedAt, ends_at AS endsAt, units_limit AS unitsLimit FROM ai_sessions WHERE store_id = ? AND ends_at > ? ORDER BY id DESC LIMIT 1')
    .bind(storeId, sqlTime(now)).first<OpenSession>()
  return row ?? null
}

export const cycleOf = (db: D1Database, storeId: number, now = new Date()): Promise<BillingCycle> => resolveCycle(db, storeId, now)

/** Units that count: open or closed reservations of the plan (released ones gave their units back). */
export const COUNTED_UNITS = `COALESCE(SUM(CASE WHEN billing_source = 'plan' AND status IN ('reserved', 'settled', 'expired') THEN units ELSE 0 END), 0)`

export async function usedUnits(db: D1Database, storeId: number, input: { sessionId?: number | null; cycleKey: string }): Promise<{ session: number; month: number }> {
  const row = await db.prepare(
    `SELECT (SELECT ${COUNTED_UNITS} FROM ai_spend_reservations WHERE session_id = ?1) AS session,
            (SELECT ${COUNTED_UNITS} FROM ai_spend_reservations WHERE store_id = ?2 AND cycle_key = ?3) AS month`,
  ).bind(input.sessionId ?? -1, storeId, input.cycleKey).first<{ session: number; month: number }>()
  return { session: Number(row?.session || 0), month: Number(row?.month || 0) }
}

/** Colombian local time, e.g. «3:40 p. m.». */
export function bogotaTime(iso: string): string {
  const date = new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`)
  return new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', hour: 'numeric', minute: '2-digit' }).format(date)
}

/** «5 de diciembre» from a Bogotá date key. */
export function bogotaDate(dateKey: string): string {
  return new Intl.DateTimeFormat('es-CO', { timeZone: 'UTC', day: 'numeric', month: 'long' }).format(new Date(`${dateKey}T12:00:00Z`))
}

export function fxCopPerUsd(env: Bindings): number {
  const value = Number((env as Record<string, unknown>).AI_FX_COP_PER_USD)
  return Number.isFinite(value) && value >= 1000 && value <= 20_000 ? value : 4000
}

export const copToMicros = (env: Bindings, cop: number) => Math.round((cop / fxCopPerUsd(env)) * 1_000_000)
