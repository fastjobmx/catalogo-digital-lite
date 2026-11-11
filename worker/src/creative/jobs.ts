/** Gestión de trabajos creativos (creative_jobs). Cada consulta filtra por la tienda resuelta en el backend.
 * Idempotencia: (store_id, idempotency_key) es único. Anti-abuso: límite de trabajos activos y por hora por tienda.
 * En la fase 1 no hay motores conectados: la ruta HTTP no crea trabajos (ver creative/modules.ts). */
import { settleReservation, validIdempotencyKey } from '../ai/credits'
import { CreativeError } from './brandKit'
import type { CreativeContext, CreativeJob, CreativeJobKind, CreativeJobService, CreativeJobStatus } from './contracts'

export const JOB_KINDS: CreativeJobKind[] = ['foto', 'video', 'creativo', 'oportunidades', 'campana', 'analitica']
export const JOB_STATUSES: CreativeJobStatus[] = ['pendiente', 'en_proceso', 'completado', 'fallido', 'cancelado']
export const MAX_ACTIVE_JOBS_PER_STORE = 3
export const MAX_JOBS_PER_HOUR_PER_STORE = 30
export const MAX_INPUT_BYTES = 8 * 1024
/** Un trabajo en proceso más tiempo que esto se considera caído: se marca fallido y se devuelven sus créditos. */
export const STALE_JOB_MINUTES = 30

type Row = {
  id: string; kind: CreativeJobKind; status: CreativeJobStatus; input_json: string; result_json: string | null; error_code: string | null
  provider: string | null; model: string | null; attempts: number; requested_by: string; created_at: string; started_at: string | null; finished_at: string | null
}
const COLUMNS = 'id, kind, status, input_json, result_json, error_code, provider, model, attempts, requested_by, created_at, started_at, finished_at'
const parse = (raw: string | null) => { if (!raw) return null; try { const v = JSON.parse(raw); return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null } catch { return null } }

function toJob(row: Row): CreativeJob {
  return {
    id: row.id, kind: row.kind, status: row.status, input: parse(row.input_json) ?? {}, result: parse(row.result_json), errorCode: row.error_code,
    provider: row.provider, model: row.model, attempts: row.attempts, requestedBy: row.requested_by, createdAt: row.created_at, startedAt: row.started_at, finishedAt: row.finished_at,
  }
}

export const isJobKind = (value: unknown): value is CreativeJobKind => typeof value === 'string' && (JOB_KINDS as string[]).includes(value)
const validId = (id: string) => /^[0-9a-f-]{36}$/.test(id)

export function creativeJobService(db: D1Database): CreativeJobService {
  const find = async (storeId: number, id: string) => validId(id)
    ? db.prepare(`SELECT ${COLUMNS} FROM creative_jobs WHERE id = ? AND store_id = ?`).bind(id, storeId).first<Row>()
    : null
  return {
    async create(ctx: CreativeContext, input) {
      if (!isJobKind(input.kind)) throw new CreativeError('INVALID_KIND', 'Tipo de trabajo desconocido')
      if (!validIdempotencyKey(input.idempotencyKey)) throw new CreativeError('INVALID_IDEMPOTENCY_KEY', 'Falta una clave de idempotencia válida')
      const payload = JSON.stringify(input.input ?? {})
      if (new TextEncoder().encode(payload).length > MAX_INPUT_BYTES) throw new CreativeError('INPUT_TOO_LARGE', 'Los datos del trabajo son demasiado grandes')
      const existing = await db.prepare(`SELECT ${COLUMNS} FROM creative_jobs WHERE store_id = ? AND idempotency_key = ?`).bind(ctx.storeId, input.idempotencyKey).first<Row>()
      if (existing) {
        if (existing.kind !== input.kind) throw new CreativeError('IDEMPOTENCY_KEY_REUSED', 'Esa clave ya se usó para otro trabajo', 409)
        return { job: toJob(existing), replayed: true }
      }
      // Límites por tienda dentro de la misma sentencia para que dos solicitudes simultáneas no los rebasen.
      const id = crypto.randomUUID()
      const row = await db.prepare(
        `INSERT OR IGNORE INTO creative_jobs (id, store_id, kind, idempotency_key, input_json, requested_by)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6
         WHERE (SELECT COUNT(*) FROM creative_jobs WHERE store_id = ?2 AND status IN ('pendiente', 'en_proceso')) < ?7
           AND (SELECT COUNT(*) FROM creative_jobs WHERE store_id = ?2 AND created_at > datetime('now', '-1 hour')) < ?8
         RETURNING ${COLUMNS}`,
      ).bind(id, ctx.storeId, input.kind, input.idempotencyKey, payload, ctx.actor.slice(0, 160), MAX_ACTIVE_JOBS_PER_STORE, MAX_JOBS_PER_HOUR_PER_STORE).first<Row>()
      if (row) {
        await db.prepare(`INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id) VALUES ('creative_job_created', 'creative_job', ?, ?, ?, 'admin', ?)`)
          .bind(row.id, JSON.stringify({ kind: row.kind }), ctx.actor, ctx.storeId).run()
        return { job: toJob(row), replayed: false }
      }
      const raced = await db.prepare(`SELECT ${COLUMNS} FROM creative_jobs WHERE store_id = ? AND idempotency_key = ?`).bind(ctx.storeId, input.idempotencyKey).first<Row>()
      if (raced) return { job: toJob(raced), replayed: true }
      throw new CreativeError('TOO_MANY_JOBS', `Tu tienda ya tiene ${MAX_ACTIVE_JOBS_PER_STORE} trabajos en curso o alcanzó el límite por hora. Espera a que terminen.`, 429)
    },
    async get(ctx, id) {
      const row = await find(ctx.storeId, id)
      return row ? toJob(row) : null
    },
    async list(ctx, filter = {}) {
      const status = filter.status && JOB_STATUSES.includes(filter.status) ? filter.status : null
      const limit = Math.min(Math.max(1, Number(filter.limit) || 50), 100)
      const { results } = await db.prepare(
        `SELECT ${COLUMNS} FROM creative_jobs WHERE store_id = ? ${status ? 'AND status = ?' : ''} ORDER BY created_at DESC, id LIMIT ?`,
      ).bind(...(status ? [ctx.storeId, status, limit] : [ctx.storeId, limit])).all<Row>()
      return (results || []).map(toJob)
    },
    async cancel(ctx, id) {
      const row = await find(ctx.storeId, id)
      if (!row) throw new CreativeError('JOB_NOT_FOUND', 'Trabajo no encontrado', 404)
      if (row.status !== 'pendiente') throw new CreativeError('JOB_NOT_CANCELLABLE', 'Solo se pueden cancelar trabajos pendientes', 409)
      const updated = await db.prepare(
        `UPDATE creative_jobs SET status = 'cancelado', finished_at = datetime('now') WHERE id = ? AND store_id = ? AND status = 'pendiente' RETURNING credit_reservation_id AS reservationId`,
      ).bind(id, ctx.storeId).first<{ reservationId: number | null }>()
      if (!updated) throw new CreativeError('JOB_NOT_CANCELLABLE', 'Solo se pueden cancelar trabajos pendientes', 409)
      if (updated.reservationId) await settleReservation(db, updated.reservationId, 'liberacion', 'Trabajo creativo cancelado')
      await db.prepare(`INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id) VALUES ('creative_job_cancelled', 'creative_job', ?, '{}', ?, 'admin', ?)`)
        .bind(id, ctx.actor, ctx.storeId).run()
      return toJob((await find(ctx.storeId, id))!)
    },
  }
}

/** Mantenimiento (cron): trabajos caídos pasan a fallido devolviendo sus créditos; los vencidos se borran. */
export async function maintainCreativeJobs(db: D1Database): Promise<{ failed: number; purged: number }> {
  const { results } = await db.prepare(
    `UPDATE creative_jobs SET status = 'fallido', error_code = 'TIMEOUT', finished_at = datetime('now')
     WHERE status = 'en_proceso' AND started_at <= datetime('now', '-${STALE_JOB_MINUTES} minutes')
     RETURNING credit_reservation_id AS reservationId`,
  ).all<{ reservationId: number | null }>()
  for (const row of results || []) if (row.reservationId) await settleReservation(db, row.reservationId, 'liberacion', 'Trabajo creativo sin respuesta')
  const purged = await db.prepare(`DELETE FROM creative_jobs WHERE status IN ('completado', 'fallido', 'cancelado') AND expires_at <= datetime('now')`).run()
  return { failed: (results || []).length, purged: Number(purged.meta?.changes || 0) }
}
