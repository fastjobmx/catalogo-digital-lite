import { Hono } from 'hono'
import type { Env } from '../index'
import { processTelegramUpdate, linkTelegramAccount, sendTelegramMessage, type TelegramUpdate } from '../services/telegram'
import { membershipsForTelegramUser } from '../services/assistant/context'
import { platformAuth } from '../middleware/auth'

const app = new Hono<Env>()

// POST /api/telegram/webhook - Asistente compartido de las tiendas
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
  // and the assistant works only in private chats.
  const message = update.message || update.callback_query?.message
  const telegramUserId = update.message?.from?.id ?? update.callback_query?.from.id
  if (!message || telegramUserId == null || message.chat.type !== 'private' || String(message.chat.id) !== String(telegramUserId)) return c.json({ ok: true })

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

  const text = update.callback_query ? '' : message.text?.trim() || ''
  const linkCode = text.match(/^\/link\s+([A-Za-z0-9-]{8,80})$/)?.[1] || text.match(/^\/start\s+link_([A-Za-z0-9-]{8,80})$/)?.[1]
  if (linkCode) {
    if (!await markProcessed(c.env.DB, update.update_id)) return c.json({ ok: true, duplicate: true })
    const result = await linkTelegramAccount(message.chat.id, linkCode, c.env.DB)
    await sendTelegramMessage(botToken, message.chat.id, result.message)
    return c.json({ ok: true })
  }

  const memberships = await membershipsForTelegramUser(c.env.DB, c.env, String(telegramUserId))
  if (!memberships.length) {
    // Unlinked users only get onboarding instructions; no store data is exposed.
    if (/^\/start\b/.test(text) && await markProcessed(c.env.DB, update.update_id)) {
      await sendTelegramMessage(botToken, message.chat.id,
        '👋 ¡Hola! Soy el Asistente TiendIA, un asistente con IA para administrar tiendas de Tienda IA Express.\n\nPara empezar, vincula tu cuenta: entra al panel de tu tienda → Configuración → Telegram, genera tu código y envíamelo así:\n<code>/link TU-CODIGO</code>')
    }
    // A 2xx acknowledges the delivery so Telegram does not redeliver it.
    return c.json({ ok: true, rejected: true })
  }

  if (!await markProcessed(c.env.DB, update.update_id)) return c.json({ ok: true, duplicate: true })

  try {
    await processTelegramUpdate(update, c.env, c.env.DB, { memberships })
    return c.json({ ok: true })
  } catch (err) {
    console.error('Error processing Telegram update:', err instanceof Error ? err.message : 'unknown error')
    // Always return 200 to prevent Telegram from retrying
    return c.json({ ok: true, error: 'Processing failed' })
  }
})

// GET /api/telegram/setup - Registrar webhook del asistente (solo superadministrador)
app.get('/setup', platformAuth, async (c) => {
  const botToken = c.env.TELEGRAM_BOT_TOKEN
  if (!botToken) {
    return c.json({ error: 'TELEGRAM_BOT_TOKEN not configured' }, 503)
  }

  const webhookUrl = c.env.TELEGRAM_WEBHOOK_URL || `${new URL(c.req.url).origin}/api/telegram/webhook`
  const webhookSecret = c.env.TELEGRAM_WEBHOOK_SECRET
  if (!webhookSecret) return c.json({ error: 'TELEGRAM_WEBHOOK_SECRET not configured' }, 503)

  // Telegram sends callback buttons only when callback_query is subscribed.
  const response = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: webhookUrl, allowed_updates: ['message', 'callback_query'], secret_token: webhookSecret }),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ description: 'Unknown error' }))
    return c.json({ error: `Failed to set webhook: ${(error as any).description}` }, 500)
  }

  const result = await response.json()
  return c.json({ success: true, webhook_url: webhookUrl, telegram_response: result })
})

// DELETE /api/telegram/webhook - Eliminar webhook configurado (solo superadministrador)
app.delete('/webhook', platformAuth, async (c) => {
  const botToken = c.env.TELEGRAM_BOT_TOKEN
  if (!botToken) {
    return c.json({ error: 'TELEGRAM_BOT_TOKEN not configured' }, 503)
  }

  const response = await fetch(`https://api.telegram.org/bot${botToken}/deleteWebhook`, { method: 'POST' })
  if (!response.ok) {
    return c.json({ error: 'Failed to delete webhook' }, 500)
  }

  return c.json({ success: true, message: 'Webhook deleted' })
})

export default app

async function markProcessed(db: D1Database, updateId: number): Promise<boolean> {
  try {
    await db.prepare('INSERT INTO processed_updates (update_id) VALUES (?)').bind(updateId).run()
    return true
  } catch (error) {
    if (error instanceof Error && /unique constraint/i.test(error.message)) return false
    throw error
  }
}

export function constantTimeEqual(a: string, b: string): boolean {
  let difference = a.length ^ b.length
  const length = Math.max(a.length, b.length)
  for (let i = 0; i < length; i++) difference |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  return difference === 0
}
