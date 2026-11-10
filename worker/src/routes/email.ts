/** Provider callbacks for email delivery. Authenticated only by the provider's signature (no session). */
import { Hono } from 'hono'
import type { Env } from '../index'
import { applyProviderEvent, verifySvixSignature } from '../email/webhooks'

const app = new Hono<Env>()
const MAX_BODY_BYTES = 256 * 1024

// POST /api/email/webhooks/resend — delivered, delayed, bounced, complained and failed events.
app.post('/webhooks/resend', async (c) => {
  const secret = c.env.RESEND_WEBHOOK_SECRET
  if (!secret) return c.json({ error: 'Webhook not configured' }, 503)
  const length = Number(c.req.header('Content-Length') || 0)
  if (length > MAX_BODY_BYTES) return c.json({ error: 'Payload too large' }, 413)
  const body = await c.req.text()
  if (body.length > MAX_BODY_BYTES) return c.json({ error: 'Payload too large' }, 413)
  const headers = { id: c.req.header('svix-id') || null, timestamp: c.req.header('svix-timestamp') || null, signature: c.req.header('svix-signature') || null }
  if (!(await verifySvixSignature(secret, headers, body))) return c.json({ error: 'Invalid signature' }, 401)
  let event: Record<string, unknown>
  try { event = JSON.parse(body) } catch { return c.json({ error: 'Invalid JSON body' }, 400) }
  const result = await applyProviderEvent(c.env.DB, headers.id!, event)
  return c.json({ ok: true, duplicate: !result.stored })
})

export default app
