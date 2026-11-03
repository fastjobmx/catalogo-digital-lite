import { Hono } from 'hono'
import type { Env } from '../index'
import type { TelegramUpdate } from '../services/assistant/telegramApi'
import { masterAdminIds, processMasterUpdate } from '../services/master/bot'
import { authorizeMaintenance, masterBotStatus, registerMasterWebhook } from '../services/master/maintenance'
import { constantTimeEqual } from './telegram'

const app = new Hono<Env>()

// POST /api/master/webhook — platform (master) bot. Separate token, secret and
// update ledger from the store assistant; only configured admin ids are served.
app.post('/webhook', async (c) => {
  const botToken = c.env.MASTER_BOT_TOKEN
  const secret = c.env.MASTER_WEBHOOK_SECRET
  if (!botToken || !secret) return c.json({ error: 'Master bot not configured' }, 503)
  const header = c.req.header('X-Telegram-Bot-Api-Secret-Token')
  if (!header || !constantTimeEqual(header, secret)) return c.json({ error: 'Invalid webhook secret' }, 403)
  const update = await c.req.json<TelegramUpdate>().catch(() => null)
  if (!update || !Number.isSafeInteger(update.update_id) || update.update_id < 0) return c.json({ error: 'Invalid update payload' }, 400)

  const message = update.message || update.callback_query?.message
  const userId = update.message?.from?.id ?? update.callback_query?.from.id
  if (!message || userId == null || message.chat.type !== 'private' || String(message.chat.id) !== String(userId)) return c.json({ ok: true })
  // Unknown users are acknowledged silently: the master bot reveals nothing.
  if (!masterAdminIds(c.env).has(String(userId))) return c.json({ ok: true, rejected: true })

  const now = Math.floor(Date.now() / 1000)
  const limit = await c.env.DB.prepare(
    `INSERT INTO telegram_rate_limits (chat_id, window_started_at, request_count) VALUES (?, ?, 1)
     ON CONFLICT(chat_id) DO UPDATE SET
       request_count = CASE WHEN window_started_at <= ? THEN 1 ELSE request_count + 1 END,
       window_started_at = CASE WHEN window_started_at <= ? THEN excluded.window_started_at ELSE window_started_at END
     RETURNING request_count`,
  ).bind(`master:${message.chat.id}`, now, now - 60, now - 60).first<{ request_count: number }>()
  if (!limit || limit.request_count > 30) return c.json({ ok: true, rate_limited: true })

  try {
    await c.env.DB.prepare(`INSERT INTO platform_processed_updates (bot, update_id) VALUES ('master', ?)`).bind(update.update_id).run()
  } catch (error) {
    if (error instanceof Error && /unique constraint/i.test(error.message)) return c.json({ ok: true, duplicate: true })
    throw error
  }
  try {
    await processMasterUpdate(update, c.env, c.env.DB)
  } catch (error) {
    console.error('Master webhook failed:', error instanceof Error ? error.message : 'unknown')
  }
  return c.json({ ok: true })
})

async function audit(db: D1Database, level: 'info' | 'warning', code: string, actor: string) {
  await db.prepare(`INSERT INTO platform_events (level, source, code, detail) VALUES (?, 'master_maintenance', ?, ?)`)
    .bind(level, code, actor.slice(0, 200)).run().catch(() => undefined)
}

// POST /api/master/maintenance/status — read-only identity and webhook check of
// the master bot and the store assistant. Never returns tokens or secrets.
app.post('/maintenance/status', async (c) => {
  const access = await authorizeMaintenance(c, 'status')
  if (access instanceof Response) return access
  const status = await masterBotStatus(c.env, new URL(c.req.url).origin)
  await audit(c.env.DB, 'info', 'STATUS_CHECKED', access.actor)
  return c.json({ success: true, data: status })
})

// POST /api/master/maintenance/webhook — registers the master webhook. Refuses
// when the master token belongs to the store assistant bot.
app.post('/maintenance/webhook', async (c) => {
  const access = await authorizeMaintenance(c, 'register_webhook')
  if (access instanceof Response) return access
  const result = await registerMasterWebhook(c.env, new URL(c.req.url).origin).catch((error: unknown) => ({
    ok: false, refused: error instanceof Error ? error.message.split(':')[0] : 'TELEGRAM_SETWEBHOOK_FAILED', status: null,
  }))
  await audit(c.env.DB, result.ok ? 'info' : 'warning', result.ok ? 'WEBHOOK_REGISTERED' : `WEBHOOK_REFUSED:${result.refused}`, access.actor)
  return c.json({ success: result.ok, refused: result.refused, data: result.status }, result.ok ? 200 : 409)
})

export default app
