/** Superadmin management of email templates and the send history. */
import type { Env } from '../index'
import { emailConfig, ensureDefaultTemplates, isEmail, loadTemplate, sendEmail } from './send'
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
  if (filter.purpose && /^[a-z_]{2,40}$/.test(filter.purpose)) { where.push('m.purpose = ?'); binds.push(filter.purpose) }
  const { results } = await db.prepare(
    `SELECT m.id, m.purpose, m.to_email AS toEmail, m.subject, m.status, m.provider, m.error_code AS errorCode, m.requested_by AS requestedBy,
            m.created_at AS createdAt, s.name AS storeName, t.name AS templateName
     FROM email_messages m LEFT JOIN stores s ON s.id = m.store_id LEFT JOIN email_templates t ON t.id = m.template_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY m.id DESC LIMIT ?`,
  ).bind(...binds, Math.min(Math.max(1, filter.limit || 100), 200)).all()
  return results || []
}

export function emailStatus(env: Partial<Env['Bindings']>) {
  const config = emailConfig(env)
  return { configured: config.configured, provider: config.provider, from: config.from, testRecipients: testRecipients(env) }
}
