/** Email delivery. The provider is pluggable and configured only with Worker secrets; without it,
 * every message is recorded as "no_configurado" and nothing pretends to have been sent.
 * The history never stores bodies, links or tokens. */
import type { Env } from '../index'
import { DEFAULT_TEMPLATES, PLATFORM_NAME, renderTemplate, SYSTEM_TEMPLATE_KEYS, type RenderValues, type SystemTemplateKey } from './templates'

export type EmailStatus = 'enviando' | 'enviado' | 'fallido' | 'no_configurado'
export type EmailProviderName = 'resend' | 'none'

export function emailConfig(env: Partial<Env['Bindings']>): { provider: EmailProviderName; from: string | null; configured: boolean } {
  const from = (env.EMAIL_FROM || '').trim() || null
  if ((env.EMAIL_PROVIDER || '').toLowerCase() === 'resend' && env.RESEND_API_KEY && from) return { provider: 'resend', from, configured: true }
  return { provider: 'none', from, configured: false }
}

export const isEmail = (value: unknown): value is string => typeof value === 'string' && value.length <= 320 && /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]{2,}$/.test(value)

/** Inserts the built-in templates the first time (never overwrites edits). */
export async function ensureDefaultTemplates(db: D1Database): Promise<void> {
  const { results } = await db.prepare('SELECT system_key, html, updated_by FROM email_templates WHERE system_key IS NOT NULL').all<{ system_key: SystemTemplateKey; html: string; updated_by: string }>()
  const rows = new Map((results || []).map((row) => [row.system_key, row]))
  const statements = SYSTEM_TEMPLATE_KEYS.flatMap((key) => {
    const template = DEFAULT_TEMPLATES[key]
    const row = rows.get(key)
    if (!row) return [db.prepare('INSERT OR IGNORE INTO email_templates (system_key, name, subject, html, text, updated_by) VALUES (?, ?, ?, ?, ?, ?)').bind(key, template.name, template.subject, template.html, template.text, 'system')]
    // Untouched system templates follow the current built-in design (for example, a new brand).
    if (row.updated_by === 'system' && row.html !== template.html) {
      return [db.prepare(`UPDATE email_templates SET name = ?, subject = ?, html = ?, text = ?, updated_at = datetime('now') WHERE system_key = ? AND updated_by = 'system'`).bind(template.name, template.subject, template.html, template.text, key)]
    }
    return []
  })
  if (statements.length) await db.batch(statements)
}

type TemplateRow = { id: number; system_key: string | null; name: string; subject: string; html: string; text: string; is_active: number }

export async function loadTemplate(db: D1Database, selector: { key?: SystemTemplateKey; id?: number }): Promise<TemplateRow | null> {
  await ensureDefaultTemplates(db)
  return selector.key
    ? db.prepare('SELECT * FROM email_templates WHERE system_key = ?').bind(selector.key).first<TemplateRow>()
    : db.prepare('SELECT * FROM email_templates WHERE id = ?').bind(selector.id ?? 0).first<TemplateRow>()
}

async function deliver(env: Partial<Env['Bindings']>, message: { to: string; subject: string; html: string; text: string; idempotencyKey: string }, fetcher: typeof fetch): Promise<{ ok: true; id: string | null } | { ok: false; code: string }> {
  const config = emailConfig(env)
  if (!config.configured) return { ok: false, code: 'NOT_CONFIGURED' }
  try {
    const response = await fetcher('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': message.idempotencyKey },
      body: JSON.stringify({ from: config.from, to: [message.to], subject: message.subject, html: message.html, text: message.text }),
    })
    if (!response.ok) return { ok: false, code: `HTTP_${response.status}` }
    const body = await response.json().catch(() => ({})) as { id?: string }
    return { ok: true, id: typeof body.id === 'string' ? body.id.slice(0, 120) : null }
  } catch {
    return { ok: false, code: 'NETWORK' }
  }
}

export type SendInput = {
  template: { key?: SystemTemplateKey; id?: number }
  to: string
  values: RenderValues
  purpose: string
  storeId?: number | null
  userId?: number | null
  requestedBy: string
  /** Same key → same message: a retry or double click never sends twice. */
  idempotencyKey: string
  /** Allows inactive custom templates only for previews/tests by the superadmin. */
  allowInactive?: boolean
}

export type SendResult = { status: EmailStatus; messageId: number; replayed: boolean; configured: boolean }

export async function sendEmail(db: D1Database, env: Partial<Env['Bindings']>, input: SendInput, fetcher: typeof fetch = fetch): Promise<SendResult> {
  if (!isEmail(input.to)) throw new Error('INVALID_RECIPIENT')
  const template = await loadTemplate(db, input.template)
  if (!template) throw new Error('TEMPLATE_NOT_FOUND')
  if (!template.is_active && !template.system_key && !input.allowInactive) throw new Error('TEMPLATE_INACTIVE')
  const rendered = renderTemplate(template, { nombre_plataforma: PLATFORM_NAME, ...input.values })
  const config = emailConfig(env)
  const claim = await db.prepare(
    `INSERT OR IGNORE INTO email_messages (template_id, template_key, purpose, store_id, user_id, to_email, subject, status, provider, idempotency_key, requested_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'enviando', ?, ?, ?) RETURNING id`,
  ).bind(template.id, template.system_key, input.purpose.slice(0, 60), input.storeId ?? null, input.userId ?? null, input.to.toLowerCase(), rendered.subject.slice(0, 200), config.provider, input.idempotencyKey.slice(0, 160), input.requestedBy.slice(0, 160)).first<{ id: number }>()
  if (!claim) {
    const existing = await db.prepare('SELECT id, status FROM email_messages WHERE idempotency_key = ?').bind(input.idempotencyKey.slice(0, 160)).first<{ id: number; status: EmailStatus }>()
    return { status: existing?.status || 'enviando', messageId: existing?.id || 0, replayed: true, configured: config.configured }
  }
  const result = await deliver(env, { to: input.to, ...rendered, idempotencyKey: input.idempotencyKey }, fetcher)
  const status: EmailStatus = result.ok ? 'enviado' : result.code === 'NOT_CONFIGURED' ? 'no_configurado' : 'fallido'
  await db.prepare(`UPDATE email_messages SET status = ?, provider_message_id = ?, error_code = ?, updated_at = datetime('now') WHERE id = ?`)
    .bind(status, result.ok ? result.id : null, result.ok ? null : result.code, claim.id).run()
  await db.prepare(`INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id) VALUES ('email_sent', 'email', ?, ?, ?, 'api', ?)`)
    .bind(String(claim.id), JSON.stringify({ purpose: input.purpose, template: template.system_key || template.id, status, error: result.ok ? null : result.code }), input.requestedBy.slice(0, 160), input.storeId ?? null).run()
  return { status, messageId: claim.id, replayed: false, configured: config.configured }
}
