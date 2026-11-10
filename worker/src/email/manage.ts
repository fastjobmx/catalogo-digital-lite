/** Superadmin management of email templates and the send history. */
import type { Env } from '../index'
import { categoryFor, EMAIL_CATEGORIES, emailConfig, ensureDefaultTemplates, isEmail, loadTemplate, sendEmail, type EmailCategory } from './send'
import { EMAIL_VARIABLES, LINK_VARIABLES, renderTemplate, SAMPLE_VALUES, TemplateError, validateTemplate, type TemplateInput } from './templates'

async function audit(db: D1Database, action: string, templateId: number, payload: unknown, actor: string) {
  await db.prepare(`INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id) VALUES (?, 'email_template', ?, ?, ?, 'platform', NULL)`)
    .bind(action, String(templateId), JSON.stringify(payload), actor).run()
}

const view = (row: { id: number; system_key: string | null; name: string; subject: string; html: string; text: string; is_active: number; updated_by: string; updated_at: string }) => ({
  id: row.id, systemKey: row.system_key, name: row.name, subject: row.subject, html: row.html, text: row.text,
  active: Boolean(row.is_active), system: Boolean(row.system_key), updatedBy: row.updated_by, updatedAt: row.updated_at,
})

export async function listTemplates(db: D1Database) {
  await ensureDefaultTemplates(db)
  const { results } = await db.prepare('SELECT * FROM email_templates ORDER BY system_key IS NULL, id').all<Parameters<typeof view>[0]>()
  return (results || []).map(view)
}

export function variablesFor(systemKey: string | null) {
  return Object.entries(EMAIL_VARIABLES)
    .filter(([key]) => { const owner = LINK_VARIABLES[key as keyof typeof LINK_VARIABLES]; return !owner || owner === systemKey })
    .map(([key, label]) => ({ key, label, systemLink: Boolean(LINK_VARIABLES[key as keyof typeof LINK_VARIABLES]) }))
}

async function requireTemplate(db: D1Database, id: number) {
  const row = await loadTemplate(db, { id })
  if (!row) throw new TemplateError('TEMPLATE_NOT_FOUND', 'Plantilla no encontrada')
  return row
}

export async function createTemplate(db: D1Database, input: TemplateInput, actor: string) {
  const clean = validateTemplate(input, null)
  const row = await db.prepare('INSERT INTO email_templates (name, subject, html, text, updated_by) VALUES (?, ?, ?, ?, ?) RETURNING *').bind(clean.name, clean.subject, clean.html, clean.text, actor).first<Parameters<typeof view>[0]>()
  await audit(db, 'email_template_created', row!.id, { name: clean.name }, actor)
  return view(row!)
}

export async function updateTemplate(db: D1Database, id: number, input: TemplateInput, actor: string) {
  const current = await requireTemplate(db, id)
  const clean = validateTemplate(input, current.system_key)
  const row = await db.prepare(`UPDATE email_templates SET name = ?, subject = ?, html = ?, text = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ? RETURNING *`).bind(clean.name, clean.subject, clean.html, clean.text, actor, id).first<Parameters<typeof view>[0]>()
  await audit(db, 'email_template_updated', id, { name: clean.name, system: current.system_key }, actor)
  return view(row!)
}

/** Copies a template as a new custom one. System links cannot travel to a copy: they become the panel link. */
export async function duplicateTemplate(db: D1Database, id: number, actor: string) {
  const current = await requireTemplate(db, id)
  const strip = (value: string) => value.replace(/\{\{\s*enlace_(recuperacion|invitacion|verificacion)\s*\}\}/g, '{{enlace_panel}}')
  return createTemplate(db, { name: `${current.name} (copia)`.slice(0, 120), subject: current.subject, html: strip(current.html), text: strip(current.text) }, actor)
}

export async function setTemplateActive(db: D1Database, id: number, active: boolean, actor: string) {
  const current = await requireTemplate(db, id)
  if (current.system_key) throw new TemplateError('SYSTEM_TEMPLATE', 'Las plantillas del sistema siempre están activas: el acceso de los usuarios depende de ellas')
  await db.prepare(`UPDATE email_templates SET is_active = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?`).bind(active ? 1 : 0, actor, id).run()
  await audit(db, active ? 'email_template_enabled' : 'email_template_disabled', id, {}, actor)
  return view((await requireTemplate(db, id)) as Parameters<typeof view>[0])
}

/** Preview of a saved template or of an unsaved draft, always with sample data and fake links. */
export async function previewTemplate(db: D1Database, id: number, draft?: TemplateInput) {
  const current = await requireTemplate(db, id)
  const source = draft ? validateTemplate(draft, current.system_key) : current
  return renderTemplate(source, SAMPLE_VALUES)
}

export function testRecipients(env: Partial<Env['Bindings']>): string[] {
  return [env.ADMIN_EMAIL || '', ...String(env.EMAIL_TEST_RECIPIENTS || '').split(',')].map((value) => value.trim().toLowerCase()).filter(isEmail)
}

/** Sends a template with sample data (fake links) to an authorised address only. */
export async function sendTestEmail(db: D1Database, env: Partial<Env['Bindings']>, id: number, to: unknown, key: string, actor: string) {
  const template = await requireTemplate(db, id)
  const recipient = typeof to === 'string' ? to.trim().toLowerCase() : ''
  if (!testRecipients(env).includes(recipient)) throw new TemplateError('RECIPIENT_NOT_ALLOWED', 'Solo se puede enviar la prueba a una dirección autorizada')
  if (!/^[\w.:-]{8,120}$/.test(key)) throw new TemplateError('INVALID_IDEMPOTENCY_KEY', 'Falta el encabezado Idempotency-Key')
  const sent = await sendEmail(db, env, { template: { id }, to: recipient, values: SAMPLE_VALUES, purpose: 'test', requestedBy: actor, idempotencyKey: `test:${key}`, allowInactive: true })
  await audit(db, 'email_template_test_sent', id, { status: sent.status, to: recipient }, actor)
  return { status: sent.status, replayed: sent.replayed, template: template.name }
}

export async function emailHistory(db: D1Database, filter: { status?: string; purpose?: string; limit?: number } = {}) {
  const where: string[] = []
  const binds: unknown[] = []
  if (filter.status && ['enviando', 'enviado', 'fallido', 'no_configurado'].includes(filter.status)) { where.push('m.status = ?'); binds.push(filter.status) }
  if (filter.status && ['entregado', 'rebotado', 'queja', 'retrasado'].includes(filter.status)) { where.push('m.delivery_status = ?'); binds.push(filter.status) }
  if (filter.purpose && /^[a-z_]{2,40}$/.test(filter.purpose)) { where.push('m.purpose = ?'); binds.push(filter.purpose) }
  const { results } = await db.prepare(
    `SELECT m.id, m.purpose, m.to_email AS toEmail, m.subject, m.status, m.provider, m.error_code AS errorCode, m.requested_by AS requestedBy,
            m.delivery_status AS deliveryStatus, m.attempts,
            m.created_at AS createdAt, s.name AS storeName, t.name AS templateName
     FROM email_messages m LEFT JOIN stores s ON s.id = m.store_id LEFT JOIN email_templates t ON t.id = m.template_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY m.id DESC LIMIT ?`,
  ).bind(...binds, Math.min(Math.max(1, filter.limit || 100), 200)).all()
  return results || []
}

export function emailStatus(env: Partial<Env['Bindings']>) {
  const config = emailConfig(env)
  return {
    configured: config.configured, provider: config.provider, from: config.from, testRecipients: testRecipients(env),
    replyTo: isEmail((env.EMAIL_REPLY_TO || '').trim()) ? env.EMAIL_REPLY_TO!.trim() : null,
    webhookConfigured: Boolean(env.RESEND_WEBHOOK_SECRET),
  }
}

/** Counters of the last 30 days and alerts when access emails (verification, recovery, invitation) fail. */
export async function emailOverview(db: D1Database) {
  const counts = await db.prepare(
    `SELECT COUNT(*) AS total,
            SUM(status = 'enviado') AS accepted, SUM(status = 'fallido') AS failed, SUM(status = 'no_configurado') AS notConfigured,
            SUM(status = 'enviando') AS pending, SUM(delivery_status = 'entregado') AS delivered, SUM(delivery_status = 'rebotado') AS bounced,
            SUM(delivery_status = 'queja') AS complained, SUM(delivery_status = 'retrasado') AS delayed
     FROM email_messages WHERE created_at >= datetime('now', '-30 days')`,
  ).first<Record<string, number | null>>()
  const { results: alerts } = await db.prepare(
    `SELECT purpose, COUNT(*) AS count, MAX(created_at) AS lastAt
     FROM email_messages
     WHERE created_at >= datetime('now', '-7 days') AND purpose IN ('password_reset', 'email_verification', 'invitation')
       AND (status = 'fallido' OR delivery_status IN ('rebotado', 'queja'))
     GROUP BY purpose ORDER BY lastAt DESC`,
  ).all<{ purpose: string; count: number; lastAt: string }>()
  const suppressed = await db.prepare('SELECT COUNT(*) AS n FROM email_suppressions').first<{ n: number }>()
  const n = (value: number | null | undefined) => Number(value || 0)
  return {
    windowDays: 30,
    totals: {
      total: n(counts?.total), accepted: n(counts?.accepted), failed: n(counts?.failed), notConfigured: n(counts?.notConfigured), pending: n(counts?.pending),
      delivered: n(counts?.delivered), bounced: n(counts?.bounced), complained: n(counts?.complained), delayed: n(counts?.delayed),
    },
    suppressed: n(suppressed?.n),
    alerts: alerts || [],
  }
}

const SYSTEM_KEYS = ['password_reset', 'invitation', 'welcome', 'admin_notice', 'email_verification', 'password_changed'] as const

export async function listCategories(db: D1Database) {
  const { results } = await db.prepare('SELECT category, enabled, updated_by AS updatedBy, updated_at AS updatedAt FROM email_category_settings').all<{ category: string; enabled: number; updatedBy: string; updatedAt: string }>()
  const saved = new Map((results || []).map((row) => [row.category, row]))
  return Object.entries(EMAIL_CATEGORIES).map(([key, info]) => ({
    key, label: info.label, essential: info.essential,
    enabled: info.essential ? true : (saved.get(key)?.enabled ?? 1) === 1,
    updatedBy: saved.get(key)?.updatedBy ?? null, updatedAt: saved.get(key)?.updatedAt ?? null,
    templates: SYSTEM_KEYS.filter((template) => categoryFor(template) === key),
  }))
}

export async function setCategoryEnabled(db: D1Database, category: string, enabled: boolean, actor: string) {
  const info = EMAIL_CATEGORIES[category as EmailCategory]
  if (!info) throw new TemplateError('CATEGORY_NOT_FOUND', 'Categoría no encontrada')
  if (info.essential) throw new TemplateError('CATEGORY_ESSENTIAL', 'Los correos de seguridad y acceso no se pueden desactivar')
  await db.prepare(`INSERT INTO email_category_settings (category, enabled, updated_by, updated_at) VALUES (?, ?, ?, datetime('now'))
                    ON CONFLICT(category) DO UPDATE SET enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
    .bind(category, enabled ? 1 : 0, actor).run()
  await db.prepare(`INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id) VALUES (?, 'email_category', ?, '{}', ?, 'platform', NULL)`)
    .bind(enabled ? 'email_category_enabled' : 'email_category_disabled', category, actor).run()
  return listCategories(db)
}

export async function listSuppressions(db: D1Database) {
  const { results } = await db.prepare('SELECT email, reason, source, created_at AS createdAt FROM email_suppressions ORDER BY created_at DESC LIMIT 200').all()
  return results || []
}

/** Lifts a suppression (for example, after the person fixed a full mailbox). Audited. */
export async function removeSuppression(db: D1Database, email: string, actor: string) {
  const address = email.trim().toLowerCase()
  if (!isEmail(address)) throw new TemplateError('INVALID_EMAIL', 'Correo no válido')
  const result = await db.prepare('DELETE FROM email_suppressions WHERE email = ?').bind(address).run()
  if (!result.meta.changes) throw new TemplateError('SUPPRESSION_NOT_FOUND', 'Esa dirección no está bloqueada')
  await db.prepare(`INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id) VALUES ('email_suppression_removed', 'email', ?, '{}', ?, 'platform', NULL)`)
    .bind(address, actor).run()
  return { ok: true }
}
