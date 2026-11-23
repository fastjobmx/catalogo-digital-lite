import { Hono } from 'hono'
import type { Env } from '../index'
import { resendTrialLink, signupTrial, TrialFlowError, TRIAL_DAYS, TRIAL_PRODUCTS } from '../services/freeTrial'
import { purchasePlan, purchaseStatus } from '../services/directPurchase'
import { platformBoldPublic } from '../services/planPayments'
import { upgradePlans } from '../services/freeTrial'
import { safeReturnUrl } from './payments'

/** Public sign-up for the real free trial. Answers never reveal whether an address already has an account. */
const app = new Hono<Env>()
const ip = (c: { req: { header(name: string): string | undefined } }) => c.req.header('CF-Connecting-IP') || 'unknown'

app.get('/config', (c) => c.json({
  enabled: String(c.env.TRIAL_SIGNUP_ENABLED || '').toLowerCase() !== 'false',
  days: TRIAL_DAYS, products: TRIAL_PRODUCTS, creditCard: false, captcha: Boolean(c.env.TURNSTILE_SECRET_KEY),
}))

app.post('/', async (c) => {
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return c.json({ error: 'Invalid JSON body' }, 400)
  try {
    return c.json(await signupTrial(c.env.DB, c.env, body, ip(c)), 202)
  } catch (error) {
    if (error instanceof TrialFlowError) return c.json({ error: error.message, code: error.code }, error.status)
    throw error
  }
})

// Contratar sin prueba: planes con precio y si el pago en línea está disponible.
app.get('/plans', async (c) => c.json({ plans: await upgradePlans(c.env.DB), onlinePayment: platformBoldPublic(c.env) }))

// Contratar sin prueba: crea la tienda, la solicitud del plan y la pasarela de Bold (cuenta de la plataforma).
app.post('/purchase', async (c) => {
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return c.json({ error: 'Invalid JSON body' }, 400)
  const returnUrl = safeReturnUrl(String(body.returnUrl || ''), c.req.header('Origin'))
  if (!returnUrl) return c.json({ error: 'Dirección de regreso no válida', code: 'INVALID_RETURN_URL' }, 400)
  try {
    return c.json(await purchasePlan(c.env.DB, c.env, body, ip(c), returnUrl), 201)
  } catch (error) {
    if (error instanceof TrialFlowError) return c.json({ error: error.message, code: error.code }, error.status)
    throw error
  }
})

app.post('/purchase/status', async (c) => {
  const body = await c.req.json().catch(() => null) as { reference?: unknown; email?: unknown } | null
  const reference = String(body?.reference || '')
  if (!/^ACT-[A-Z0-9]{6}-[A-Z0-9]{4,20}$/.test(reference)) return c.json({ error: 'Referencia no válida', code: 'INVALID_REFERENCE' }, 400)
  try {
    return c.json(await purchaseStatus(c.env.DB, c.env, reference, body?.email))
  } catch (error) {
    if (error instanceof TrialFlowError) return c.json({ error: error.message, code: error.code }, error.status)
    throw error
  }
})

app.post('/resend', async (c) => {
  const body = await c.req.json().catch(() => null) as { email?: unknown } | null
  try {
    return c.json(await resendTrialLink(c.env.DB, c.env, body?.email, ip(c)), 202)
  } catch (error) {
    if (error instanceof TrialFlowError) return c.json({ error: error.message, code: error.code }, error.status)
    throw error
  }
})

export default app
