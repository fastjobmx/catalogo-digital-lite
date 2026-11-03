/**
 * Master bot maintenance: identity and webhook checks plus webhook
 * registration. The Worker calls Telegram with its own secrets and returns only
 * non-sensitive data (bot id/username, webhook URL and delivery status).
 */
import type { Context } from 'hono'
import type { Env } from '../../index'
import { authenticate } from '../../middleware/auth'
import { sha256Hex } from '../platformUsers'

const TELEGRAM_API = 'https://api.telegram.org'

export type MaintenanceScope = 'status' | 'register_webhook'

export type WebhookSummary = {
  url: string | null
  pendingUpdates: number
  lastError: string | null
  lastErrorAt: string | null
  allowedUpdates: string[] | null
}

export type BotStatus = {
  configured: boolean
  bot: { id: number; username: string; isBot: boolean } | null
  webhook: WebhookSummary | null
  error?: string
}

/** Tolerant parser: comma, semicolon or whitespace separated numeric ids. */
export function parseAdminIds(raw: string | undefined): { valid: string[]; invalid: number } {
  const parts = String(raw || '').split(/[\s,;]+/).map((part) => part.trim()).filter(Boolean)
  const valid = parts.filter((part) => /^\d{4,15}$/.test(part))
  return { valid: [...new Set(valid)], invalid: parts.length - valid.length }
}

async function telegram(token: string, method: string, body?: Record<string, unknown>): Promise<Record<string, any>> {
  const response = await fetch(`${TELEGRAM_API}/bot${token}/${method}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  })
  const json = await response.json().catch(() => ({})) as Record<string, any>
  if (!response.ok || json.ok === false) throw new Error(`TELEGRAM_${method.toUpperCase()}_FAILED:${response.status}`)
  return json
}

function summarizeWebhook(result: Record<string, any> | undefined): WebhookSummary {
  return {
    url: result?.url ? String(result.url) : null,
    pendingUpdates: Number(result?.pending_update_count || 0),
    lastError: result?.last_error_message ? String(result.last_error_message).slice(0, 200) : null,
    lastErrorAt: result?.last_error_date ? new Date(Number(result.last_error_date) * 1000).toISOString() : null,
    allowedUpdates: Array.isArray(result?.allowed_updates) ? result.allowed_updates.map(String) : null,
  }
}

async function botStatus(token: string | undefined): Promise<BotStatus> {
  if (!token) return { configured: false, bot: null, webhook: null }
  try {
    const me = await telegram(token, 'getMe')
    const info = await telegram(token, 'getWebhookInfo')
    return {
      configured: true,
      bot: { id: Number(me.result?.id), username: String(me.result?.username || ''), isBot: Boolean(me.result?.is_bot) },
      webhook: summarizeWebhook(info.result),
    }
  } catch (error) {
    // Never echo provider errors verbatim: they could contain request details.
    return { configured: true, bot: null, webhook: null, error: error instanceof Error ? error.message.split(':')[0] : 'TELEGRAM_UNREACHABLE' }
  }
}

export function masterWebhookUrl(origin: string): string {
  return `${origin.replace(/\/+$/, '')}/api/master/webhook`
}

export async function masterBotStatus(env: Env['Bindings'], origin: string) {
  const [master, assistant] = await Promise.all([botStatus(env.MASTER_BOT_TOKEN), botStatus(env.TELEGRAM_BOT_TOKEN)])
  const admins = parseAdminIds(env.MASTER_ADMIN_TELEGRAM_IDS)
  const expectedWebhookUrl = masterWebhookUrl(origin)
  return {
    master: {
      ...master,
      secretConfigured: Boolean(env.MASTER_WEBHOOK_SECRET && env.MASTER_WEBHOOK_SECRET.length >= 16),
      adminIdsValid: admins.valid.length,
      adminIdsInvalid: admins.invalid,
      expectedWebhookUrl,
      webhookMatches: master.webhook?.url === expectedWebhookUrl,
      sameTokenAsAssistant: Boolean(env.MASTER_BOT_TOKEN && env.MASTER_BOT_TOKEN === env.TELEGRAM_BOT_TOKEN),
      sameBotAsAssistant: Boolean(master.bot && assistant.bot && master.bot.id === assistant.bot.id),
    },
    assistant,
  }
}

/** Registers the master webhook only after proving it is a different bot. */
export async function registerMasterWebhook(env: Env['Bindings'], origin: string): Promise<{ ok: boolean; refused?: string; status: Awaited<ReturnType<typeof masterBotStatus>> }> {
  const before = await masterBotStatus(env, origin)
  const refuse = (refused: string) => ({ ok: false, refused, status: before })
  if (!env.MASTER_BOT_TOKEN) return refuse('MASTER_BOT_TOKEN_MISSING')
  if (!before.master.secretConfigured) return refuse('MASTER_WEBHOOK_SECRET_MISSING_OR_SHORT')
  if (!before.master.adminIdsValid) return refuse('MASTER_ADMIN_TELEGRAM_IDS_INVALID')
  if (!before.master.bot) return refuse('MASTER_BOT_UNREACHABLE')
  if (before.master.sameTokenAsAssistant || before.master.sameBotAsAssistant) return refuse('MASTER_BOT_IS_STORE_ASSISTANT')
  await telegram(env.MASTER_BOT_TOKEN, 'setWebhook', {
    url: before.master.expectedWebhookUrl,
    secret_token: env.MASTER_WEBHOOK_SECRET,
    allowed_updates: ['message', 'callback_query'],
  })
  return { ok: true, status: await masterBotStatus(env, origin) }
}

/**
 * Maintenance access: the platform superadmin session, or a one-time code
 * created by an operator with Cloudflare D1 access. Only the SHA-256 of the
 * code is stored; it expires in minutes and is valid for a single scope.
 */
export async function authorizeMaintenance(c: Context<Env>, scope: MaintenanceScope): Promise<{ actor: string } | Response> {
  if (c.req.header('Authorization')) {
    const principal = await authenticate(c)
    if ('status' in principal) return c.json({ error: principal.error }, principal.status)
    if (principal.kind !== 'superadmin') return c.json({ error: 'Platform administrator required' }, 403)
    return { actor: `platform:${principal.email}` }
  }
  const code = (c.req.header('X-Maintenance-Code') || '').trim()
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(code)) return c.json({ error: 'Maintenance authorization required' }, 401)
  const operationId = `maint-${await sha256Hex(code)}`
  const claimed = await c.env.DB.prepare(
    `UPDATE platform_operations SET status = 'applied', completed_at = datetime('now')
     WHERE operation_id = ? AND action = 'maintenance' AND status = 'pending' AND expires_at > unixepoch()
       AND json_extract(params_json, '$.scope') = ?
     RETURNING actor`,
  ).bind(operationId, scope).first<{ actor: string }>()
  if (!claimed) return c.json({ error: 'Invalid, expired or already used maintenance code' }, 403)
  return { actor: claimed.actor }
}
