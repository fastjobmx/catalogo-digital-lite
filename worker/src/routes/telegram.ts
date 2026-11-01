import { Hono } from 'hono'
import type { Env } from '../index'
import { processTelegramUpdate, linkTelegramAccount, type TelegramUpdate } from '../services/telegram'
import { adminAuth } from '../middleware/auth'

const app = new Hono<Env>()

// POST /api/telegram/webhook - Recibir actualizaciones de Telegram
app.post('/webhook', async (c) => {
  const botToken = c.env.TELEGRAM_BOT_TOKEN
  if (!botToken) {
    console.error('TELEGRAM_BOT_TOKEN not configured')
    return c.json({ error: 'Bot not configured' }, 503)
  }

  // Verify webhook secret if configured
  const webhookSecret = c.env.TELEGRAM_WEBHOOK_SECRET
  if (webhookSecret) {
    const headerSecret = c.req.header('X-Telegram-Bot-Api-Secret-Token')
    if (headerSecret !== webhookSecret) {
      return c.json({ error: 'Invalid webhook secret' }, 403)
    }
  }

  const update = await c.req.json<TelegramUpdate>().catch(() => null)
  if (!update) {
    return c.json({ error: 'Invalid update payload' }, 400)
  }

  const already = await c.env.DB.prepare('SELECT update_id FROM processed_updates WHERE update_id = ?').bind(update.update_id).first()
  if (already) return c.json({ ok: true, duplicate: true })
  await c.env.DB.prepare('INSERT INTO processed_updates (update_id) VALUES (?)').bind(update.update_id).run()

  try {
    // Check for account linking command first
    const messageText = update.message?.text?.trim()
    if (messageText && messageText.startsWith('/link ')) {
      const code = messageText.replace('/link ', '').trim()
      const chatId = update.message!.chat.id
      const result = await linkTelegramAccount(chatId, code, c.env.DB)

      const { sendTelegramMessage } = await import('../services/telegram')
      await sendTelegramMessage(botToken, chatId, result.message)
      return c.json({ ok: true })
    }

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
app.delete('/webhook', async (c) => {
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