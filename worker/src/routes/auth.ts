import { Hono } from 'hono'
import type { Env } from '../index'
import { createAdminToken, getJwtSecret, hashPassword } from '../services/auth'
import { consumeAccessToken, peekAccessToken, validatePasswordPolicy } from '../services/platformUsers'
import { clearAdminLoginFailures, isAdminLoginBlocked, recordAdminLoginFailure } from '../services/loginRateLimit'
import { listUserMemberships } from '../tenancy/access'

const app = new Hono<Env>()

// GET /api/auth/activation?token=… — shows who is activating, without consuming the token.
app.get('/activation', async (c) => {
  const token = c.req.query('token') || ''
  const clientIp = c.req.header('CF-Connecting-IP') || 'unknown'
  if (await isAdminLoginBlocked(c.env.DB, clientIp, 'activation')) return c.json({ error: 'Too many attempts. Try again later.' }, 429, { 'Retry-After': '900' })
  const info = await peekAccessToken(c.env.DB, token, 'activation')
  if (!info) {
    await recordAdminLoginFailure(c.env.DB, clientIp, 'activation')
    return c.json({ error: 'This activation link is invalid or expired' }, 404)
  }
  return c.json({ email: info.email, store: { slug: info.slug, name: info.storeName } })
})

// POST /api/auth/activate — sets the password once and opens a session.
app.post('/activate', async (c) => {
  const body = await c.req.json().catch(() => null) as { token?: unknown; password?: unknown } | null
  const token = typeof body?.token === 'string' ? body.token : ''
  const password = typeof body?.password === 'string' ? body.password : ''
  const clientIp = c.req.header('CF-Connecting-IP') || 'unknown'
  if (await isAdminLoginBlocked(c.env.DB, clientIp, 'activation')) return c.json({ error: 'Too many attempts. Try again later.' }, 429, { 'Retry-After': '900' })
  const policy = validatePasswordPolicy(password)
  if (policy) return c.json({ error: policy, code: 'WEAK_PASSWORD' }, 400)
  const secret = getJwtSecret(c.env)
  if (!secret) return c.json({ error: 'Authentication service is not configured' }, 503)
  const passwordHash = await hashPassword(password)
  const consumed = await consumeAccessToken(c.env.DB, token, 'activation')
  if (!consumed) {
    await recordAdminLoginFailure(c.env.DB, clientIp, 'activation')
    return c.json({ error: 'This activation link is invalid or expired' }, 404)
  }
  await clearAdminLoginFailures(c.env.DB, clientIp, 'activation')
  const user = await c.env.DB.prepare(
    `UPDATE platform_users SET password_hash = ?, status = 'active', updated_at = datetime('now'), last_login_at = datetime('now')
     WHERE id = ? AND status <> 'disabled' RETURNING id, email`,
  ).bind(passwordHash, consumed.userId).first<{ id: number; email: string }>()
  if (!user?.email) return c.json({ error: 'This account cannot be activated' }, 409)
  await c.env.DB.prepare(`INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id) VALUES ('account_activated', 'user', ?, '{}', ?, 'api', ?)`)
    .bind(String(user.id), user.email, consumed.storeId).run()
  const stores = await listUserMemberships(c.env.DB, user.id)
  const activeStore = stores.find((store) => store.storeId === consumed.storeId) || stores[0]
  return c.json({
    token: await createAdminToken(user.email, secret, { sub: String(user.id) }),
    email: user.email, role: 'user', stores, store: activeStore ? { slug: activeStore.slug, name: activeStore.name } : null,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  })
})

export default app
