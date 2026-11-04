/** Platform billing: invoices from active services and plan prices. No payment is
 * collected automatically; the superadmin marks invoices as paid or void. */
import { PlatformError } from './platform'

export type Invoice = { id: number; store_id: number; store_name: string; slug: string; period: string; concept: string; amount: number; currency: string; status: string; due_date: string | null; paid_at: string | null }

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/

export function currentBillingPeriod(date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

async function audit(db: D1Database, action: string, storeId: number | null, payload: unknown, actor: string): Promise<void> {
  await db.prepare(`INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id) VALUES (?, 'invoice', ?, ?, ?, 'platform', ?)`)
    .bind(action, String(storeId ?? ''), JSON.stringify(payload), actor, storeId).run()
}

/** Idempotent: running it twice for the same period never duplicates an invoice. */
export async function generateInvoices(db: D1Database, period: string, actor: string): Promise<{ created: number; period: string }> {
  if (!PERIOD.test(period)) throw new PlatformError('INVALID_PERIOD', 'Usa el periodo con formato AAAA-MM, por ejemplo 2026-11.')
  const [year, month] = period.split('-')
  const due = `${period}-10`
  const statements = [
    // Monthly services every period.
    db.prepare(`INSERT OR IGNORE INTO store_invoices (store_id, service_id, period, concept, amount, currency, due_date, created_by)
      SELECT sv.store_id, sv.id, ?, 'Servicio mensual: ' || sv.service_code, sv.price, sv.currency, ?, ?
      FROM store_services sv JOIN stores s ON s.id = sv.store_id
      WHERE sv.status = 'activo' AND sv.billing = 'mensual' AND sv.price > 0 AND s.status <> 'cancelled'`).bind(period, due, actor),
    // Annual services in their anniversary month (year key).
    db.prepare(`INSERT OR IGNORE INTO store_invoices (store_id, service_id, period, concept, amount, currency, due_date, created_by)
      SELECT sv.store_id, sv.id, ?, 'Servicio anual: ' || sv.service_code, sv.price, sv.currency, ?, ?
      FROM store_services sv JOIN stores s ON s.id = sv.store_id
      WHERE sv.status = 'activo' AND sv.billing = 'anual' AND sv.price > 0 AND s.status <> 'cancelled'
        AND strftime('%m', COALESCE(sv.starts_at, sv.created_at)) = ?`).bind(year!, due, actor, month!),
    // One-time services once.
    db.prepare(`INSERT OR IGNORE INTO store_invoices (store_id, service_id, period, concept, amount, currency, due_date, created_by)
      SELECT sv.store_id, sv.id, 'unico', 'Servicio: ' || sv.service_code, sv.price, sv.currency, ?, ?
      FROM store_services sv JOIN stores s ON s.id = sv.store_id
      WHERE sv.status = 'activo' AND sv.billing = 'unico' AND sv.price > 0 AND s.status <> 'cancelled'`).bind(due, actor),
    // Plan monthly price (no service row): deduplicated by store, period and concept.
    db.prepare(`INSERT INTO store_invoices (store_id, service_id, period, concept, amount, currency, due_date, created_by)
      SELECT s.id, NULL, ?, 'Plan ' || p.name, p.monthly_price, p.currency, ?, ?
      FROM stores s JOIN plans p ON p.code = s.plan_code
      WHERE s.status = 'active' AND p.monthly_price > 0
        AND NOT EXISTS (SELECT 1 FROM store_invoices i WHERE i.store_id = s.id AND i.service_id IS NULL AND i.period = ? AND i.concept = 'Plan ' || p.name)`).bind(period, due, actor, period),
  ]
  const results = await db.batch(statements)
  const created = results.reduce((sum, result) => sum + Number(result.meta.changes || 0), 0)
  await audit(db, 'invoices_generated', null, { period, created }, actor)
  return { created, period }
}

export async function listInvoices(db: D1Database, filter: { status?: string; slug?: string } = {}): Promise<Invoice[]> {
  const status = filter.status && ['pendiente', 'pagada', 'anulada'].includes(filter.status) ? filter.status : null
  return (await db.prepare(
    `SELECT i.id, i.store_id, s.name AS store_name, s.slug, i.period, i.concept, i.amount, i.currency, i.status, i.due_date, i.paid_at
     FROM store_invoices i JOIN stores s ON s.id = i.store_id
     WHERE (? IS NULL OR i.status = ?) AND (? IS NULL OR s.slug = ?)
     ORDER BY CASE i.status WHEN 'pendiente' THEN 0 ELSE 1 END, i.due_date, i.id DESC LIMIT 100`,
  ).bind(status, status, filter.slug || null, filter.slug || null).all<Invoice>()).results || []
}

/** Only pending invoices change; paid and void are final. */
export async function setInvoiceStatus(db: D1Database, id: number, status: 'pagada' | 'anulada', actor: string): Promise<Invoice> {
  const result = await db.prepare(`UPDATE store_invoices SET status = ?, paid_at = CASE WHEN ? = 'pagada' THEN datetime('now') ELSE NULL END, updated_at = datetime('now')
    WHERE id = ? AND status = 'pendiente' RETURNING store_id`).bind(status, status, id).first<{ store_id: number }>()
  if (!result) throw new PlatformError('INVOICE_NOT_PENDING', 'Esa factura no existe o ya no está pendiente.')
  await audit(db, status === 'pagada' ? 'invoice_paid' : 'invoice_voided', result.store_id, { id }, actor)
  return (await db.prepare(`SELECT i.id, i.store_id, s.name AS store_name, s.slug, i.period, i.concept, i.amount, i.currency, i.status, i.due_date, i.paid_at FROM store_invoices i JOIN stores s ON s.id = i.store_id WHERE i.id = ?`).bind(id).first<Invoice>())!
}

const DOMAIN_TRANSITIONS: Record<string, string[]> = { pendiente: ['verificado', 'retirado'], verificado: ['activo', 'retirado'], activo: ['retirado'], retirado: [] }

/** pendiente → verificado (DNS comprobado) → activo (sirve la tienda) → retirado. Requires the plan feature. */
export async function setDomainStatus(db: D1Database, domain: string, status: 'verificado' | 'activo' | 'retirado', actor: string): Promise<{ domain: string; status: string; storeId: number }> {
  const normalized = domain.trim().toLowerCase()
  const row = await db.prepare(`SELECT d.status, d.store_id, p.features_json FROM store_domains d JOIN stores s ON s.id = d.store_id LEFT JOIN plans p ON p.code = s.plan_code WHERE d.domain = ?`)
    .bind(normalized).first<{ status: string; store_id: number; features_json: string | null }>()
  if (!row) throw new PlatformError('DOMAIN_NOT_FOUND', 'Ese dominio no está registrado.')
  if (!DOMAIN_TRANSITIONS[row.status]?.includes(status)) throw new PlatformError('INVALID_TRANSITION', `No se puede pasar de ${row.status} a ${status}.`)
  if (status === 'activo' && !String(row.features_json || '').includes('dominio_propio')) throw new PlatformError('PLAN_FEATURE', 'El plan de la tienda no incluye dominio propio.')
  await db.prepare(`UPDATE store_domains SET status = ?, updated_at = datetime('now') WHERE domain = ?`).bind(status, normalized).run()
  await db.prepare(`INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id) VALUES ('store_domain_status', 'domain', ?, ?, ?, 'platform', ?)`)
    .bind(normalized, JSON.stringify({ from: row.status, to: status }), actor, row.store_id).run()
  return { domain: normalized, status, storeId: row.store_id }
}

/** Stores at or above their AI warning threshold this month. */
export async function aiUsageAlerts(db: D1Database): Promise<Array<{ slug: string; name: string; percent: number; budgetMicros: number }>> {
  const period = currentBillingPeriod()
  return (await db.prepare(
    `SELECT s.slug, s.name, CAST(ROUND(100.0 * COALESCE(u.estimated_cost_micros, 0) / s.ai_monthly_budget_micros) AS INTEGER) AS percent, s.ai_monthly_budget_micros AS budgetMicros
     FROM stores s LEFT JOIN ai_usage_monthly u ON u.store_id = s.id AND u.period = ?
     WHERE s.ai_monthly_budget_micros > 0 AND s.status <> 'cancelled'
       AND 100.0 * COALESCE(u.estimated_cost_micros, 0) / s.ai_monthly_budget_micros >= COALESCE(s.ai_warn_percent, 80)
     ORDER BY percent DESC`,
  ).bind(period).all<{ slug: string; name: string; percent: number; budgetMicros: number }>()).results || []
}
