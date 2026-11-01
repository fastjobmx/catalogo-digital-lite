import { createMiddleware } from 'hono/factory'
import type { Env } from '../index'
import { verifyAdminToken, getJwtSecret } from '../services/auth'

export const adminAuth = createMiddleware<Env>(async (c, next) => {
  const authHeader = c.req.header('Authorization')

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid Authorization header' }, 401)
  }

  const token = authHeader.slice(7)
  const secret = getJwtSecret(c.env)
  const payload = await verifyAdminToken(token, secret)

  if (!payload) {
    return c.json({ error: 'Invalid or expired token' }, 401)
  }

  // Set admin context for downstream handlers
  c.set('isAdmin', true)
  c.set('adminEmail', payload.email)

  await next()
})