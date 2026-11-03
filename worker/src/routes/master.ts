import { Hono } from 'hono'
import type { Env } from '../index'
import type { TelegramUpdate } from '../services/assistant/telegramApi'
import { masterAdminIds, processMasterUpdate } from '../services/master/bot'
import { platformAuth } from '../middleware/auth'
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

// GET /api/master/setup — registers the master webhook (superadmin only).
app.get('/setup', platformAuth, async (c) => {
  const botToken = c.env.MASTER_BOT_TOKEN
  const secret = c.env.MASTER_WEBHOOK_SECRET
  if (!botToken || !secret) return c.json({ error: 'MASTER_BOT_TOKEN and MASTER_WEBHOOK_SECRET are required' }, 503)
  const url = `${new URL(c.req.url).origin}/api/master/webhook`
  const response = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, secret_token: secret, allowed_updates: ['message', 'callback_query'] }),
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) return c.json({ error: 'Failed to set master webhook', telegram_response: result }, 502)
  return c.json({ success: true, webhook_url: url, telegram_response: result })
})

export default app
