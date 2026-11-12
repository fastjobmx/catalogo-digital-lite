/**
 * Asistente administrativo por WhatsApp (número central de TiendIA Exprés, Cloud API oficial).
 *   GET  /api/whatsapp/webhook     verificación de Meta
 *   POST /api/whatsapp/webhook     eventos firmados de Meta
 *   POST /api/whatsapp/link-code   código de vinculación del usuario autenticado
 *   GET  /api/whatsapp/link        estado de la vinculación del usuario autenticado
 *   DELETE /api/whatsapp/link      revocar la vinculación
 *   GET  /api/whatsapp/report      consumo por tienda (solo superadministrador)
 * No es el WhatsApp de pedidos de los compradores: ese flujo no pasa por aquí.
 */
import { Hono } from 'hono'
import type { Env } from '../index'
import { adminAuth, platformAuth } from '../middleware/auth'
import { constantTimeEqual, MAX_WEBHOOK_BYTES, verifyWebhookSignature, whatsappConfigured, whatsappEnabled } from '../whatsapp/api'
import { createLinkCode, LINK_CODE_TTL_SECONDS, revokeIdentity } from '../whatsapp/identity'
import { pilotAllows, processInbound, recordWebhook, whatsappUsageReport } from '../whatsapp/processor'

const app = new Hono<Env>()

app.get('/webhook', (c) => {
  const expected = c.env.WHATSAPP_VERIFY_TOKEN
  const token = c.req.query('hub.verify_token') || ''
  const challenge = c.req.query('hub.challenge') || ''
  if (!expected || c.req.query('hub.mode') !== 'subscribe' || !constantTimeEqual(token, expected) || !/^[\w.-]{1,200}$/.test(challenge)) {
    return c.json({ error: 'Verification failed' }, 403)
  }
  return c.text(challenge, 200)
})

app.post('/webhook', async (c) => {
  const secret = c.env.WHATSAPP_APP_SECRET
  // A webhook without a configured secret is never accepted.
  if (!secret) return c.json({ error: 'Channel not configured' }, 503)
  if (Number(c.req.header('content-length') || 0) > MAX_WEBHOOK_BYTES) return c.json({ error: 'Payload too large' }, 413)
  const raw = await c.req.arrayBuffer()
  if (raw.byteLength > MAX_WEBHOOK_BYTES) return c.json({ error: 'Payload too large' }, 413)
  // The signature is checked over the exact bytes received, before anything is parsed.
  if (!await verifyWebhookSignature(raw, c.req.header('X-Hub-Signature-256'), secret)) return c.json({ error: 'Invalid signature' }, 401)
  // Authentic events are always acknowledged so Meta does not redeliver them.
  if (!whatsappEnabled(c.env) || !whatsappConfigured(c.env)) return c.json({ ok: true, disabled: true })
  let payload: unknown
  try { payload = JSON.parse(new TextDecoder().decode(raw)) } catch { return c.json({ ok: true, ignored: 'invalid_json' }) }
  let pending: number[] = []
  try {
    pending = await recordWebhook(c.env, c.env.DB, payload)
  } catch (error) {
    console.error('WhatsApp webhook could not be stored:', error instanceof Error ? error.message : 'unknown')
    // Storage failed: ask Meta to deliver again later.
    return c.json({ error: 'Temporarily unavailable' }, 503)
  }
  // The answer to Meta never waits for the AI: messages are processed after the response.
  const work = (async () => { for (const id of pending) await processInbound(c.env, c.env.DB, id) })()
    .catch((error) => console.error('WhatsApp processing failed:', error instanceof Error ? error.message : 'unknown'))
  if (c.env.ENVIRONMENT === 'test') await work
  else c.executionCtx.waitUntil(work)
  return c.json({ ok: true, received: pending.length })
})

app.post('/link-code', adminAuth, async (c) => {
  const principal = c.get('principal')!
  const storeId = c.get('storeId')!
  if (!whatsappEnabled(c.env)) return c.json({ error: 'El asistente por WhatsApp aún no está activo.', code: 'WHATSAPP_DISABLED' }, 503)
  // The link belongs to a person: the platform superadmin has no merchant account to link.
  if (principal.kind !== 'user') return c.json({ error: 'Inicia sesión con la cuenta del comercio para vincular WhatsApp.', code: 'USER_ACCOUNT_REQUIRED' }, 400)
  if (!pilotAllows(c.env, storeId)) return c.json({ error: 'Esta tienda todavía no está habilitada para el asistente por WhatsApp.', code: 'WHATSAPP_NOT_AVAILABLE' }, 403)
  // The code is a credential: never cached and never logged.
  c.header('Cache-Control', 'no-store')
  const { code, expiresAt } = await createLinkCode(c.env.DB, { userId: principal.userId, storeId, createdBy: c.get('adminEmail') || `user:${principal.userId}` })
  const number = String(c.env.WHATSAPP_DISPLAY_NUMBER || '').replace(/\D/g, '')
  return c.json({
    code, expiresAt, expiresInMinutes: LINK_CODE_TTL_SECONDS / 60,
    deepLink: number ? `https://wa.me/${number}?text=${encodeURIComponent(`VINCULAR ${code}`)}` : null,
    instructions: `Envía este mensaje al WhatsApp oficial del Asistente TiendIA:\nVINCULAR ${code}`,
  })
})

app.get('/link', adminAuth, async (c) => {
  const principal = c.get('principal')!
  c.header('Cache-Control', 'no-store')
  // The panel shows the option only when this says so: channel on, a merchant account and a store in the pilot.
  const available = whatsappEnabled(c.env) && principal.kind === 'user' && pilotAllows(c.env, c.get('storeId')!)
  if (principal.kind !== 'user') return c.json({ available: false, linked: false })
  const row = await c.env.DB.prepare(`SELECT phone, linked_at AS linkedAt FROM whatsapp_identities WHERE user_id = ? AND status = 'active'`).bind(principal.userId).first<{ phone: string | null; linkedAt: string }>()
  const number = String(c.env.WHATSAPP_DISPLAY_NUMBER || '').replace(/\D/g, '')
  const base = { available, assistantNumber: available && number ? number : null }
  return c.json(row ? { ...base, linked: true, phoneEnding: row.phone ? row.phone.slice(-4) : null, linkedAt: row.linkedAt } : { ...base, linked: false })
})

app.delete('/link', adminAuth, async (c) => {
  const principal = c.get('principal')!
  if (principal.kind !== 'user') return c.json({ error: 'USER_ACCOUNT_REQUIRED' }, 400)
  const revoked = await revokeIdentity(c.env.DB, { userId: principal.userId }, c.get('adminEmail') || `user:${principal.userId}`)
  // A code generated but not yet used stops working too.
  await c.env.DB.prepare('UPDATE whatsapp_link_tokens SET used_at = unixepoch() WHERE user_id = ? AND used_at IS NULL').bind(principal.userId).run()
  return c.json({ success: true, revoked: Boolean(revoked) })
})

app.get('/report', platformAuth, async (c) => {
  const period = c.req.query('period') || new Date().toISOString().slice(0, 7)
  if (!/^\d{4}-\d{2}$/.test(period)) return c.json({ error: 'period must be YYYY-MM' }, 400)
  return c.json({ enabled: whatsappEnabled(c.env), configured: whatsappConfigured(c.env), ...await whatsappUsageReport(c.env.DB, period) })
})

export default app
