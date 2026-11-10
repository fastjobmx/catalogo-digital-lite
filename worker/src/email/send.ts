/** Email delivery. The provider is pluggable and configured only with Worker secrets; without it,
 * every message is recorded as "no_configurado" and nothing pretends to have been sent.
 * The history never stores bodies, links or tokens. */
import type { Env } from '../index'
import { DEFAULT_TEMPLATES, PLATFORM_NAME, renderTemplate, SYSTEM_TEMPLATE_KEYS, type RenderValues, type SystemTemplateKey } from './templates'

/** Stored states. 'enviado' only means the provider accepted the message; delivery is tracked apart
 * (delivery_status, from provider webhooks). 'omitido' is never stored: a paused category sent nothing. */
export type EmailStatus = 'enviando' | 'enviado' | 'fallido' | 'no_configurado' | 'omitido'
export type EmailProviderName = 'resend' | 'none'

export function emailConfig(env: Partial<Env['Bindings']>): { provider: EmailProviderName; from: string | null; configured: boolean } {
  const from = (env.EMAIL_FROM || '').trim() || null
  if ((env.EMAIL_PROVIDER || '').toLowerCase() === 'resend' && env.RESEND_API_KEY && from) return { provider: 'resend', from, configured: true }
  return { provider: 'none', from, configured: false }
}

export const isEmail = (value: unknown): value is string => typeof value === 'string' && value.length <= 320 && /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]{2,}$/.test(value)

/** Notification categories. Security messages are essential and can never be paused. */
export const EMAIL_CATEGORIES = {
  seguridad: { label: 'Seguridad y acceso', essential: true },
  bienvenida: { label: 'Bienvenida', essential: false },
  avisos: { label: 'Avisos administrativos', essential: false },
} as const
export type EmailCategory = keyof typeof EMAIL_CATEGORIES
const SECURITY_KEYS: ReadonlySet<string> = new Set(['password_reset', 'email_verification', 'invitation', 'password_changed'])

export function categoryFor(templateKey: string | null): EmailCategory {
  if (templateKey && SECURITY_KEYS.has(templateKey)) return 'seguridad'
  if (templateKey === 'welcome') return 'bienvenida'
  return 'avisos'
}

export async function isCategoryEnabled(db: D1Database, category: EmailCategory): Promise<boolean> {
  if (EMAIL_CATEGORIES[category].essential) return true
  const row = await db.prepare('SELECT enabled FROM email_category_settings WHERE category = ?').bind(category).first<{ enabled: number }>()
  return row ? row.enabled === 1 : true
}

export async function isSuppressed(db: D1Database, email: string): Promise<boolean> {
  return Boolean(await db.prepare('SELECT 1 AS hit FROM email_suppressions WHERE email = ?').bind(email.toLowerCase()).first())
}

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

/** Network errors, rate limits and provider 5xx are worth retrying; anything else is a final answer. */
export const isTransient = (code: string) => code === 'NETWORK' || code === 'HTTP_429' || /^HTTP_5\d\d$/.test(code)
const RETRY_DELAYS_MS = [300, 1200]

type OutgoingMessage = { to: string; subject: string; html: string; text: string; idempotencyKey: string; tag: string }
type DeliveryResult = ({ ok: true; id: string | null } | { ok: false; code: string }) & { attempts: number }

async function deliverOnce(env: Partial<Env['Bindings']>, message: OutgoingMessage, fetcher: typeof fetch): Promise<{ ok: true; id: string | null } | { ok: false; code: string }> {
  const config = emailConfig(env)
  if (!config.configured) return { ok: false, code: 'NOT_CONFIGURED' }
  const replyTo = (env.EMAIL_REPLY_TO || '').trim()
  try {
    const response = await fetcher('https://api.resend.com/emails', {
      method: 'POST',
      // The same Idempotency-Key on every attempt: the provider never sends the message twice.
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': message.idempotencyKey },
      body: JSON.stringify({
        from: config.from, to: [message.to], subject: message.subject, html: message.html, text: message.text,
        ...(isEmail(replyTo) ? { reply_to: replyTo } : {}),
        tags: [{ name: 'proposito', value: message.tag.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60) || 'general' }],
      }),
    })
    if (!response.ok) return { ok: false, code: `HTTP_${response.status}` }
    const body = await response.json().catch(() => ({})) as { id?: string }
    return { ok: true, id: typeof body.id === 'string' ? body.id.slice(0, 120) : null }
  } catch {
    return { ok: false, code: 'NETWORK' }
  }
}

async function deliver(env: Partial<Env['Bindings']>, message: OutgoingMessage, fetcher: typeof fetch, sleep: (ms: number) => Promise<void>): Promise<DeliveryResult> {
  let attempts = 0
  for (;;) {
    attempts += 1
    const result = await deliverOnce(env, message, fetcher)
    if (result.ok || !isTransient(result.code) || attempts > RETRY_DELAYS_MS.length) return { ...result, attempts }
    await sleep(RETRY_DELAYS_MS[attempts - 1]!)
  }
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

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

export async function sendEmail(db: D1Database, env: Partial<Env['Bindings']>, input: SendInput, fetcher: typeof fetch = fetch, sleep: (ms: number) => Promise<void> = defaultSleep): Promise<SendResult> {
  if (!isEmail(input.to)) throw new Error('INVALID_RECIPIENT')
  const template = await loadTemplate(db, input.template)
  if (!template) throw new Error('TEMPLATE_NOT_FOUND')
  if (!template.is_active && !template.system_key && !input.allowInactive) throw new Error('TEMPLATE_INACTIVE')
  const config = emailConfig(env)
  // Paused categories send nothing (security messages are never paused; superadmin tests always go out).
  if (input.purpose !== 'test' && !(await isCategoryEnabled(db, categoryFor(template.system_key)))) {
    return { status: 'omitido', messageId: 0, replayed: false, configured: config.configured }
  }
  const rendered = renderTemplate(template, { nombre_plataforma: PLATFORM_NAME, ...input.values })
  const claim = await db.prepare(
    `INSERT OR IGNORE INTO email_messages (template_id, template_key, purpose, store_id, user_id, to_email, subject, status, provider, idempotency_key, requested_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'enviando', ?, ?, ?) RETURNING id`,
  ).bind(template.id, template.system_key, input.purpose.slice(0, 60), input.storeId ?? null, input.userId ?? null, input.to.toLowerCase(), rendered.subject.slice(0, 200), config.provider, input.idempotencyKey.slice(0, 160), input.requestedBy.slice(0, 160)).first<{ id: number }>()
  if (!claim) {
    const existing = await db.prepare('SELECT id, status FROM email_messages WHERE idempotency_key = ?').bind(input.idempotencyKey.slice(0, 160)).first<{ id: number; status: EmailStatus }>()
    return { status: existing?.status || 'enviando', messageId: existing?.id || 0, replayed: true, configured: config.configured }
  }
  // Addresses that bounced permanently or reported spam are not contacted again.
  const result: DeliveryResult = await isSuppressed(db, input.to)
    ? { ok: false, code: 'SUPPRESSED', attempts: 0 }
    : await deliver(env, { to: input.to, ...rendered, idempotencyKey: input.idempotencyKey, tag: input.purpose }, fetcher, sleep)
  const status: EmailStatus = result.ok ? 'enviado' : result.code === 'NOT_CONFIGURED' ? 'no_configurado' : 'fallido'
  await db.prepare(`UPDATE email_messages SET status = ?, provider_message_id = ?, error_code = ?, attempts = ?, updated_at = datetime('now') WHERE id = ?`)
    .bind(status, result.ok ? result.id : null, result.ok ? null : result.code, result.attempts, claim.id).run()
  await db.prepare(`INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id) VALUES ('email_sent', 'email', ?, ?, ?, 'api', ?)`)
    .bind(String(claim.id), JSON.stringify({ purpose: input.purpose, template: template.system_key || template.id, status, error: result.ok ? null : result.code, attempts: result.attempts }), input.requestedBy.slice(0, 160), input.storeId ?? null).run()
  return { status, messageId: claim.id, replayed: false, configured: config.configured }
}

/** Retention: delivery history and provider events older than the configured days are deleted
 * (EMAIL_LOG_RETENTION_DAYS, default 180, minimum 30). Bodies, links and tokens are never stored anyway. */
export async function purgeEmailLogs(db: D1Database, env: Partial<Env['Bindings']>): Promise<{ messages: number; events: number }> {
  const configured = Number.parseInt(String(env.EMAIL_LOG_RETENTION_DAYS || ''), 10)
  const days = Number.isFinite(configured) ? Math.max(30, configured) : 180
  const cutoff = `-${days} days`
  const events = await db.prepare(`DELETE FROM email_events WHERE created_at < datetime('now', ?) OR message_id IN (SELECT id FROM email_messages WHERE created_at < datetime('now', ?))`).bind(cutoff, cutoff).run()
  const messages = await db.prepare(`DELETE FROM email_messages WHERE created_at < datetime('now', ?) AND status <> 'enviando'`).bind(cutoff).run()
  await db.prepare(`DELETE FROM email_verification_tokens WHERE created_at < datetime('now', ?) AND (used_at IS NOT NULL OR expires_at < unixepoch())`).bind(cutoff).run()
  return { messages: messages.meta.changes ?? 0, events: events.meta.changes ?? 0 }
}
