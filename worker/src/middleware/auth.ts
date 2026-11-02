import { createMiddleware } from 'hono/factory'
import type { Env } from '../index'
import { verifyAdminToken, getJwtSecret, isAuthConfigurationReady } from '../services/auth'

export const adminAuth = createMiddleware<Env>(async (c, next) => {
  const authHeader = c.req.header('Authorization')

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid Authorization header' }, 401)
  }

  const token = authHeader.slice(7)
  if (!isAuthConfigurationReady(c.env)) {
    return c.json({ error: 'Authentication service is not configured' }, 503)
  }
  const secret = getJwtSecret(c.env)
  if (!secret) {
    return c.json({ error: 'Authentication service is not configured' }, 503)
  }
  const payload = await verifyAdminToken(token, secret)

  if (!payload) {
    return c.json({ error: 'Invalid or expired token' }, 401)
  }

  // Set admin context for downstream handlers
  c.set('isAdmin', true)
  c.set('adminEmail', payload.email)

  await next()
})
