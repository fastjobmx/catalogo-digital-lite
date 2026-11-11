/** Gestión de trabajos creativos (creative_jobs). Cada consulta filtra por la tienda resuelta en el backend.
 * Idempotencia: (store_id, idempotency_key) es único. Anti-abuso: límite de trabajos activos y por hora por tienda.
 * Los trabajos de foto se crean por lotes desde creative/photoEngine.ts; la ruta genérica POST /jobs no crea nada. */
import { settleReservation, validIdempotencyKey } from '../ai/credits'
import { CreativeError } from './brandKit'
import type { CreativeContext, CreativeJob, CreativeJobKind, CreativeJobService, CreativeJobStatus } from './contracts'

export const JOB_KINDS: CreativeJobKind[] = ['foto', 'video', 'creativo', 'oportunidades', 'campana', 'analitica']
export const JOB_STATUSES: CreativeJobStatus[] = ['pendiente', 'en_proceso', 'completado', 'fallido', 'cancelado']
/** Trabajos en cola (pendientes + en proceso) por tienda: admite lotes sin dejar crecer la cola sin límite. */
export const MAX_ACTIVE_JOBS_PER_STORE = 100
export const MAX_JOBS_PER_HOUR_PER_STORE = 300
/** Trabajos ejecutándose a la vez por tienda. */
export const MAX_RUNNING_JOBS_PER_STORE = 2
export const MAX_JOB_ATTEMPTS = 3
export const MAX_INPUT_BYTES = 8 * 1024
/** Un trabajo en proceso más tiempo que esto se considera caído: se marca fallido y se devuelven sus créditos. */
export const STALE_JOB_MINUTES = 30

type Row = {
  id: string; kind: CreativeJobKind; status: CreativeJobStatus; input_json: string; result_json: string | null; error_code: string | null
  provider: string | null; model: string | null; attempts: number; requested_by: string; created_at: string; started_at: string | null; finished_at: string | null; batch_id: string | null
}
const COLUMNS = 'id, kind, status, input_json, result_json, error_code, provider, model, attempts, requested_by, created_at, started_at, finished_at, batch_id'
const parse = (raw: string | null) => { if (!raw) return null; try { const v = JSON.parse(raw); return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null } catch { return null } }

function toJob(row: Row): CreativeJob {
  return {
    id: row.id, kind: row.kind, status: row.status, input: parse(row.input_json) ?? {}, result: parse(row.result_json), errorCode: row.error_code,
    provider: row.provider, model: row.model, attempts: row.attempts, requestedBy: row.requested_by, createdAt: row.created_at, startedAt: row.started_at, finishedAt: row.finished_at, batchId: row.batch_id,
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
        `INSERT OR IGNORE INTO creative_jobs (id, store_id, kind, idempotency_key, input_json, requested_by, batch_id)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?9
         WHERE (SELECT COUNT(*) FROM creative_jobs WHERE store_id = ?2 AND status IN ('pendiente', 'en_proceso')) < ?7
           AND (SELECT COUNT(*) FROM creative_jobs WHERE store_id = ?2 AND created_at > datetime('now', '-1 hour')) < ?8
         RETURNING ${COLUMNS}`,
      ).bind(id, ctx.storeId, input.kind, input.idempotencyKey, payload, ctx.actor.slice(0, 160), MAX_ACTIVE_JOBS_PER_STORE, MAX_JOBS_PER_HOUR_PER_STORE, input.batchId ?? null).first<Row>()
      if (row) {
        await db.prepare(`INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id) VALUES ('creative_job_created', 'creative_job', ?, ?, ?, 'admin', ?)`)
          .bind(row.id, JSON.stringify({ kind: row.kind }), ctx.actor, ctx.storeId).run()
        return { job: toJob(row), replayed: false }
      }
      const raced = await db.prepare(`SELECT ${COLUMNS} FROM creative_jobs WHERE store_id = ? AND idempotency_key = ?`).bind(ctx.storeId, input.idempotencyKey).first<Row>()
      if (raced) return { job: toJob(raced), replayed: true }
      throw new CreativeError('TOO_MANY_JOBS', 'Tu tienda tiene demasiados trabajos en cola o alcanzó el límite por hora. Espera a que terminen.', 429)
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

// ---- ejecución (la usan los motores) -------------------------------------------------------

export type ClaimedJob = CreativeJob & { storeId: number }

/** Toma un trabajo pendiente para ejecutarlo. Devuelve null si ya no está pendiente o si la tienda ya
 * tiene el máximo de trabajos ejecutándose (se respeta en la misma sentencia). */
export async function claimJob(db: D1Database, storeId: number, id: string): Promise<CreativeJob | null> {
  if (!validId(id)) return null
  const row = await db.prepare(
    `UPDATE creative_jobs SET status = 'en_proceso', started_at = datetime('now'), attempts = attempts + 1, error_code = NULL
     WHERE id = ?1 AND store_id = ?2 AND status = 'pendiente'
       AND (SELECT COUNT(*) FROM creative_jobs WHERE store_id = ?2 AND status = 'en_proceso') < ?3
     RETURNING ${COLUMNS}`,
  ).bind(id, storeId, MAX_RUNNING_JOBS_PER_STORE).first<Row>()
  return row ? toJob(row) : null
}

export async function finishJob(db: D1Database, storeId: number, id: string, outcome: { status: 'completado' | 'fallido'; result?: Record<string, unknown>; errorCode?: string; provider?: string | null; model?: string | null }): Promise<void> {
  await db.prepare(
    `UPDATE creative_jobs SET status = ?, result_json = ?, error_code = ?, provider = ?, model = ?, finished_at = datetime('now')
     WHERE id = ? AND store_id = ? AND status = 'en_proceso'`,
  ).bind(outcome.status, outcome.result ? JSON.stringify(outcome.result) : null, outcome.errorCode?.slice(0, 60) ?? null, outcome.provider ?? null, outcome.model ?? null, id, storeId).run()
}

/** Vuelve a poner en cola un trabajo fallido (máximo MAX_JOB_ATTEMPTS intentos). */
export async function retryJob(db: D1Database, ctx: CreativeContext, id: string): Promise<CreativeJob> {
  const row = validId(id) ? await db.prepare(
    `UPDATE creative_jobs SET status = 'pendiente', finished_at = NULL, started_at = NULL WHERE id = ? AND store_id = ? AND status = 'fallido' AND attempts < ? RETURNING ${COLUMNS}`,
  ).bind(id, ctx.storeId, MAX_JOB_ATTEMPTS).first<Row>() : null
  if (row) return toJob(row)
  const current = await creativeJobService(db).get(ctx, id)
  if (!current) throw new CreativeError('JOB_NOT_FOUND', 'Trabajo no encontrado', 404)
  throw new CreativeError('JOB_NOT_RETRYABLE', current.status === 'fallido' ? 'Este trabajo ya se intentó el máximo de veces' : 'Solo se reintentan trabajos que fallaron', 409)
}

export async function listBatchJobs(db: D1Database, storeId: number, batchId: string): Promise<CreativeJob[]> {
  const { results } = await db.prepare(`SELECT ${COLUMNS} FROM creative_jobs WHERE store_id = ? AND batch_id = ? ORDER BY created_at, idempotency_key`).bind(storeId, batchId).all<Row>()
  return (results || []).map(toJob)
}

/** Cancela los trabajos del lote que siguen pendientes; los que ya terminaron no cambian. */
export async function cancelBatch(db: D1Database, ctx: CreativeContext, batchId: string): Promise<number> {
  const result = await db.prepare(`UPDATE creative_jobs SET status = 'cancelado', finished_at = datetime('now') WHERE store_id = ? AND batch_id = ? AND status = 'pendiente'`).bind(ctx.storeId, batchId).run()
  const cancelled = Number(result.meta?.changes || 0)
  if (cancelled) await db.prepare(`INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id) VALUES ('creative_batch_cancelled', 'creative_job', ?, ?, ?, 'admin', ?)`)
    .bind(batchId, JSON.stringify({ cancelled }), ctx.actor, ctx.storeId).run()
  return cancelled
}
