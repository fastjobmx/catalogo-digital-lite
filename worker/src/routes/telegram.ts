import { Hono } from 'hono'
import type { Env } from '../index'
import { processTelegramUpdate, linkTelegramAccount, sendTelegramMessage, type TelegramUpdate } from '../services/telegram'
import { adminAuth } from '../middleware/auth'

const app = new Hono<Env>()

// POST /api/telegram/webhook - Recibir actualizaciones de Telegram
app.post('/webhook', async (c) => {
  const botToken = c.env.TELEGRAM_BOT_TOKEN
  if (!botToken) {
    console.error('TELEGRAM_BOT_TOKEN not configured')
    return c.json({ error: 'Bot not configured' }, 503)
  }

  // A webhook without a configured secret is never accepted.
  const webhookSecret = c.env.TELEGRAM_WEBHOOK_SECRET
  const headerSecret = c.req.header('X-Telegram-Bot-Api-Secret-Token')
  if (!webhookSecret || !headerSecret || !constantTimeEqual(headerSecret, webhookSecret)) {
    return c.json({ error: 'Invalid webhook secret' }, 403)
  }

  const update = await c.req.json<TelegramUpdate>().catch(() => null)
  if (!update || !Number.isSafeInteger(update.update_id) || update.update_id < 0) {
    return c.json({ error: 'Invalid update payload' }, 400)
  }

  // Never authorize by username. Only the Telegram numeric user ID is accepted,
  // and the control bot is private-chat only.
  const message = update.message
  if (!message || message.chat.type !== 'private' || !message.from) return c.json({ ok: true })

  const now = Math.floor(Date.now() / 1000)
  const limit = await c.env.DB.prepare(
    `INSERT INTO telegram_rate_limits (chat_id, window_started_at, request_count)
     VALUES (?, ?, 1)
     ON CONFLICT(chat_id) DO UPDATE SET
       request_count = CASE WHEN window_started_at <= ? THEN 1 ELSE request_count + 1 END,
       window_started_at = CASE WHEN window_started_at <= ? THEN excluded.window_started_at ELSE window_started_at END
     RETURNING request_count`,
  ).bind(String(message.chat.id), now, now - 60, now - 60).first<{ request_count: number }>()
  // Acknowledge and drop abusive updates. Returning non-2xx makes Telegram
  // retry the same update and can amplify traffic during a rate-limit window.
  if (!limit || limit.request_count > 20) return c.json({ ok: true, rate_limited: true })

  const linkedOwner = await readLinkedOwner(c.env.DB)
  const configuredOwner = c.env.TELEGRAM_OWNER_ID || linkedOwner
  const linkMatch = message.text?.trim().match(/^\/link\s+([A-Za-z0-9-]{8,80})$/)
  // Preserve the one-time admin-generated linking flow when no owner has been set.
  const linkCode = linkMatch?.[1]
  if (!c.env.TELEGRAM_OWNER_ID && !linkedOwner && linkCode && String(message.chat.id) === String(message.from.id)) {
    try {
      await c.env.DB.prepare('INSERT INTO processed_updates (update_id) VALUES (?)').bind(update.update_id).run()
    } catch (error) {
      if (isUniqueConstraintError(error)) return c.json({ ok: true, duplicate: true })
      throw error
    }
    const result = await linkTelegramAccount(message.chat.id, linkCode, c.env.DB)
    await sendTelegramMessage(botToken, message.chat.id, result.message)
    return c.json({ ok: true })
  }
  if (!configuredOwner || String(message.from.id) !== configuredOwner || String(message.chat.id) !== configuredOwner) {
    // Ignore unauthorized messages without replying. A 2xx acknowledges the
    // delivery so Telegram does not repeatedly redeliver the rejected update.
    return c.json({ ok: true, rejected: true })
  }

  try {
    await c.env.DB.prepare('INSERT INTO processed_updates (update_id) VALUES (?)').bind(update.update_id).run()
  } catch (error) {
    if (isUniqueConstraintError(error)) return c.json({ ok: true, duplicate: true })
    throw error
  }

  try {
    await processTelegramUpdate(update, c.env, c.env.DB)
    return c.json({ ok: true })
  } catch (err) {
    console.error('Error processing Telegram update:', err)
    // Always return 200 to prevent Telegram from retrying
    return c.json({ ok: true, error: 'Processing failed' })
  }
})

// GET /api/telegram/setup - Configurar webhook (requiere admin auth o token directo)
app.get('/setup', adminAuth, async (c) => {
  const botToken = c.env.TELEGRAM_BOT_TOKEN
  if (!botToken) {
    return c.json({ error: 'TELEGRAM_BOT_TOKEN not configured' }, 503)
  }

  const webhookUrl = c.env.TELEGRAM_WEBHOOK_URL || `${new URL(c.req.url).origin}/api/telegram/webhook`
  const webhookSecret = c.env.TELEGRAM_WEBHOOK_SECRET

  const url = `https://api.telegram.org/bot${botToken}/setWebhook`
  const body: Record<string, string> = { url: webhookUrl }
  if (webhookSecret) {
    body.secret_token = webhookSecret
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ description: 'Unknown error' }))
    return c.json({ error: `Failed to set webhook: ${(error as any).description}` }, 500)
  }

  const result = await response.json()
  return c.json({ success: true, webhook_url: webhookUrl, telegram_response: result })
})

// DELETE /api/telegram/webhook - Eliminar webhook configurado
app.delete('/webhook', adminAuth, async (c) => {
  const botToken = c.env.TELEGRAM_BOT_TOKEN
  if (!botToken) {
    return c.json({ error: 'TELEGRAM_BOT_TOKEN not configured' }, 503)
  }

  const url = `https://api.telegram.org/bot${botToken}/deleteWebhook`
  const response = await fetch(url, { method: 'POST' })

  if (!response.ok) {
    return c.json({ error: 'Failed to delete webhook' }, 500)
  }

  return c.json({ success: true, message: 'Webhook deleted' })
})

export default app

async function readLinkedOwner(db: D1Database): Promise<string | null> {
  const row = await db.prepare('SELECT telegram_owner_id FROM store_config WHERE id = 1').first<{ telegram_owner_id?: string | null }>()
  return row?.telegram_owner_id || null
}

function constantTimeEqual(a: string, b: string): boolean {
  let difference = a.length ^ b.length
  const length = Math.max(a.length, b.length)
  for (let i = 0; i < length; i++) difference |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  return difference === 0
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Error && /unique constraint/i.test(error.message)
}
