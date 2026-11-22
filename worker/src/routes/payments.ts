import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import type { Env } from '../index'
import { publicStore } from '../middleware/tenant'
import { BoldError, createBoldCheckout, findAttempt, handleBoldWebhook, refreshAttemptFromBold } from '../services/bold'

const app = new Hono<Env>()

const checkoutKey = z.string().regex(/^[\w.-]{16,100}$/)

/** Where Bold sends the buyer back: https, or http on localhost for local tests, and on the page's own origin. */
function safeReturnUrl(value: string, origin: string | undefined): string | null {
  let url: URL
  try { url = new URL(value) } catch { return null }
  const local = url.hostname === 'localhost'
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return null
  if (origin && origin !== 'null' && url.origin !== origin) return null
  url.hash = ''
  for (const key of [...url.searchParams.keys()]) if (key.startsWith('bold-')) url.searchParams.delete(key)
  return url.href.slice(0, 500)
}

function boldError(c: { json: (body: unknown, status: number) => Response }, error: unknown) {
  if (error instanceof BoldError) return c.json({ error: error.message, code: error.code }, error.status)
  throw error
}

// Signed button attributes for an order registered for online payment (only the browser that created it).
app.post('/bold/checkout', publicStore, zValidator('json', z.object({ displayId: z.string().regex(/^PED-\d{8}-[A-F0-9]{8}$/), checkoutKey, returnUrl: z.string().max(500) })), async (c) => {
  const store = c.get('store')!
  const body = c.req.valid('json')
  const returnUrl = safeReturnUrl(body.returnUrl, c.req.header('Origin'))
  if (!returnUrl) return c.json({ error: 'Dirección de regreso no válida', code: 'INVALID_RETURN_URL' }, 400)
  const name = (await c.env.DB.prepare('SELECT name FROM store_config WHERE id = ?').bind(store.id).first<{ name: string }>())?.name || store.slug
  try {
    return c.json(await createBoldCheckout(c.env.DB, c.env, { storeId: store.id, storeName: name, displayId: body.displayId, checkoutKey: body.checkoutKey, returnUrl }), 201)
  } catch (error) { return boldError(c, error) }
})

// The buyer came back from Bold: the redirect status is only a hint, so ask Bold and answer what the order says.
app.post('/bold/status', publicStore, zValidator('json', z.object({ reference: z.string().regex(/^[A-Za-z0-9_-]{8,60}$/), checkoutKey })), async (c) => {
  const store = c.get('store')!
  const body = c.req.valid('json')
  const attempt = await findAttempt(c.env.DB, body.reference)
  const order = attempt && attempt.store_id === store.id
    ? await c.env.DB.prepare('SELECT display_id, payment_status, idempotency_key FROM orders WHERE id = ? AND store_id = ?').bind(attempt.order_id, store.id).first<{ display_id: string; payment_status: string; idempotency_key: string }>()
    : null
  if (!attempt || !order || order.idempotency_key !== body.checkoutKey) return c.json({ error: 'Pago no encontrado', code: 'NOT_FOUND' }, 404)
  const status = await refreshAttemptFromBold(c.env.DB, attempt)
  const paymentStatus = (await c.env.DB.prepare('SELECT payment_status FROM orders WHERE id = ?').bind(attempt.order_id).first<{ payment_status: string }>())?.payment_status
  return c.json({ displayId: order.display_id, attemptStatus: status, paymentStatus, amount: attempt.amount, currency: attempt.currency, mode: attempt.mode })
})

// Bold webhook (one URL for every store: the reference identifies the store, whose secret checks the signature).
app.post('/bold/webhook', async (c) => {
  const raw = await c.req.text()
  if (raw.length > 64_000) return c.json({ error: 'Payload too large' }, 413)
  const outcome = await handleBoldWebhook(c.env.DB, c.env, raw, c.req.header('x-bold-signature') || '')
  return c.json({ result: outcome.result }, outcome.status as 200)
})

export default app
