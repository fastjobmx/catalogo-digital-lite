import { Hono } from 'hono'
import type { Env } from '../index'
import { createAdminToken, getJwtSecret, hashPassword } from '../services/auth'
import { consumeAccessToken, peekAccessToken, validatePasswordPolicy } from '../services/platformUsers'
import { clearAdminLoginFailures, isAdminLoginBlocked, recordAdminLoginFailure } from '../services/loginRateLimit'
import { listUserMemberships } from '../tenancy/access'
import { maskEmail, requestPasswordReset } from '../services/passwordReset'
import { confirmEmailVerification } from '../services/userAccess'
import { sendEmail } from '../email/send'
import { adminStoreUrl, publicStoreUrl } from '../tenancy/stores'

/** Security notice after a password change. Only to verified addresses; never contains links that grant access. */
async function notifyPasswordChanged(env: Env['Bindings'], user: { id: number; email: string; displayName?: string | null }, storeId: number, changedAt: number) {
  const store = await env.DB.prepare('SELECT id, slug, name FROM stores WHERE id = ?').bind(storeId).first<{ id: number; slug: string; name: string }>()
  const verified = await env.DB.prepare('SELECT email_verified_at IS NOT NULL AS verified FROM platform_users WHERE id = ?').bind(user.id).first<{ verified: number }>()
  const panel = store ? `${adminStoreUrl(env.PUBLIC_STORE_BASE_URL, store)}/login` : ''
  if (!store || !verified?.verified || !panel.startsWith('https://')) return
  const when = new Date(changedAt * 1000).toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'long', timeStyle: 'short' })
  await sendEmail(env.DB, env, {
    template: { key: 'password_changed' }, to: user.email, purpose: 'password_changed', storeId: store.id, userId: user.id, requestedBy: 'system',
    idempotencyKey: `password_changed:${user.id}:${changedAt}`,
    values: { nombre_usuario: user.displayName || user.email.split('@')[0]!, correo_usuario: user.email, nombre_comercio: store.name, enlace_panel: panel, fecha_evento: when },
  }).catch(() => null)
}

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
  const changedAt = Math.floor(Date.now() / 1000)
  if (!consumed) {
    await recordAdminLoginFailure(c.env.DB, clientIp, 'activation')
    return c.json({ error: 'This activation link is invalid or expired' }, 404)
  }
  await clearAdminLoginFailures(c.env.DB, clientIp, 'activation')
  // An invitation opened from an email proves the address. Older sessions end with the new password.
  const user = await c.env.DB.prepare(
    `UPDATE platform_users SET password_hash = ?, status = 'active', updated_at = datetime('now'), last_login_at = datetime('now'),
       credentials_changed_at = ?,
       email_verified_at = CASE WHEN ? = 'email' THEN COALESCE(email_verified_at, datetime('now')) ELSE email_verified_at END
     WHERE id = ? AND status <> 'disabled' RETURNING id, email, display_name AS displayName, email_verified_at IS NOT NULL AS verified`,
  ).bind(passwordHash, changedAt, consumed.deliveredVia, consumed.userId).first<{ id: number; email: string; displayName: string; verified: number }>()
  if (!user?.email) return c.json({ error: 'This account cannot be activated' }, 409)
  if (user.verified) {
    const store = await c.env.DB.prepare('SELECT s.id, s.slug, s.name, COALESCE(p.name, s.plan_code) AS planName FROM stores s LEFT JOIN plans p ON p.code = s.plan_code WHERE s.id = ?').bind(consumed.storeId).first<{ id: number; slug: string; name: string; planName: string | null }>()
    const panel = store ? `${adminStoreUrl(c.env.PUBLIC_STORE_BASE_URL, store)}/login` : ''
    if (store && panel.startsWith('https://')) {
      await sendEmail(c.env.DB, c.env, {
        template: { key: 'welcome' }, to: user.email, purpose: 'welcome', storeId: store.id, userId: user.id, requestedBy: 'system', idempotencyKey: `welcome:${user.id}:${store.id}`,
        values: { nombre_usuario: user.displayName || user.email.split('@')[0]!, correo_usuario: user.email, nombre_comercio: store.name, enlace_panel: panel, enlace_tienda: publicStoreUrl(c.env.PUBLIC_STORE_BASE_URL, store), nombre_plan: store.planName || 'Por confirmar' },
      }).catch(() => null)
    }
  }
  await c.env.DB.prepare(`INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id) VALUES ('account_activated', 'user', ?, '{}', ?, 'api', ?)`)
    .bind(String(user.id), user.email, consumed.storeId).run()
  const stores = await listUserMemberships(c.env.DB, user.id)
  const activeStore = stores.find((store) => store.storeId === consumed.storeId) || stores[0]
  return c.json({
    token: await createAdminToken(user.email, secret, { sub: String(user.id) }, changedAt + 1),
    email: user.email, role: 'user', stores, store: activeStore ? { slug: activeStore.slug, name: activeStore.name } : null,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  })
})

// POST /api/auth/password-reset/request — same answer whether or not the email exists.
app.post('/password-reset/request', async (c) => {
  const body = await c.req.json().catch(() => null) as { email?: unknown } | null
  const result = await requestPasswordReset(c.env.DB, c.env, body?.email, c.req.header('CF-Connecting-IP') || 'unknown')
  if (result.limited) return c.json({ error: 'Too many attempts. Try again later.' }, 429, { 'Retry-After': '900' })
  return c.json({ ok: true })
})

// GET /api/auth/password-reset?token=… — masked email and store, without consuming the link.
app.get('/password-reset', async (c) => {
  const clientIp = c.req.header('CF-Connecting-IP') || 'unknown'
  if (await isAdminLoginBlocked(c.env.DB, clientIp, 'password_reset_token')) return c.json({ error: 'Too many attempts. Try again later.' }, 429, { 'Retry-After': '900' })
  const info = await peekAccessToken(c.env.DB, c.req.query('token') || '', 'password_reset')
  if (!info?.email) {
    await recordAdminLoginFailure(c.env.DB, clientIp, 'password_reset_token')
    return c.json({ error: 'This reset link is invalid or expired' }, 404)
  }
  return c.json({ email: maskEmail(info.email), store: { slug: info.slug, name: info.storeName } })
})

// POST /api/auth/password-reset — sets the new password once and opens a session.
app.post('/password-reset', async (c) => {
  const body = await c.req.json().catch(() => null) as { token?: unknown; password?: unknown } | null
  const token = typeof body?.token === 'string' ? body.token : ''
  const password = typeof body?.password === 'string' ? body.password : ''
  const clientIp = c.req.header('CF-Connecting-IP') || 'unknown'
  if (await isAdminLoginBlocked(c.env.DB, clientIp, 'password_reset_token')) return c.json({ error: 'Too many attempts. Try again later.' }, 429, { 'Retry-After': '900' })
  const policy = validatePasswordPolicy(password)
  if (policy) return c.json({ error: policy, code: 'WEAK_PASSWORD' }, 400)
  const secret = getJwtSecret(c.env)
  if (!secret) return c.json({ error: 'Authentication service is not configured' }, 503)
  const passwordHash = await hashPassword(password)
  const consumed = await consumeAccessToken(c.env.DB, token, 'password_reset')
  const changedAt = Math.floor(Date.now() / 1000)
  if (!consumed) {
    await recordAdminLoginFailure(c.env.DB, clientIp, 'password_reset_token')
    return c.json({ error: 'This reset link is invalid or expired' }, 404)
  }
  // All other sessions of this account end now; a reset link that arrived by email also proves the address.
  const user = await c.env.DB.prepare(
    `UPDATE platform_users SET password_hash = ?, status = 'active', updated_at = datetime('now'), last_login_at = datetime('now'),
       credentials_changed_at = ?,
       email_verified_at = CASE WHEN ? = 'email' THEN COALESCE(email_verified_at, datetime('now')) ELSE email_verified_at END
     WHERE id = ? AND status <> 'disabled' AND email IS NOT NULL RETURNING id, email`,
  ).bind(passwordHash, changedAt, consumed.deliveredVia, consumed.userId).first<{ id: number; email: string }>()
  if (!user) return c.json({ error: 'This account cannot be updated' }, 409)
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE user_access_tokens SET used_at = unixepoch() WHERE user_id = ? AND purpose = 'password_reset' AND used_at IS NULL`).bind(user.id),
    c.env.DB.prepare(`INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id) VALUES ('password_reset_completed', 'user', ?, '{}', ?, 'api', ?)`)
      .bind(String(user.id), user.email, consumed.storeId),
  ])
  await clearAdminLoginFailures(c.env.DB, clientIp, 'password_reset_token')
  await notifyPasswordChanged(c.env, user, consumed.storeId, changedAt)
  const stores = await listUserMemberships(c.env.DB, user.id)
  const activeStore = stores.find((store) => store.storeId === consumed.storeId) || stores[0]
  return c.json({
    token: await createAdminToken(user.email, secret, { sub: String(user.id) }, changedAt + 1),
    email: user.email, role: 'user', stores, store: activeStore ? { slug: activeStore.slug, name: activeStore.name } : null,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  })
})

// POST /api/auth/verify-email — confirms an address from a verification link (no access is granted).
app.post('/verify-email', async (c) => {
  const body = await c.req.json().catch(() => null) as { token?: unknown } | null
  const clientIp = c.req.header('CF-Connecting-IP') || 'unknown'
  if (await isAdminLoginBlocked(c.env.DB, clientIp, 'email_verification')) return c.json({ error: 'Too many attempts. Try again later.' }, 429, { 'Retry-After': '900' })
  const result = await confirmEmailVerification(c.env.DB, typeof body?.token === 'string' ? body.token : '')
  if (!result) {
    await recordAdminLoginFailure(c.env.DB, clientIp, 'email_verification')
    return c.json({ error: 'This verification link is invalid or expired' }, 404)
  }
  return c.json(result)
})

export default app
