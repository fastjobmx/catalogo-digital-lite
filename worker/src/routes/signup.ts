import { Hono } from 'hono'
import type { Env } from '../index'
import { resendTrialLink, signupTrial, TrialFlowError, TRIAL_DAYS, TRIAL_PRODUCTS } from '../services/freeTrial'

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
