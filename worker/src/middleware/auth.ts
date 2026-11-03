import { createMiddleware } from 'hono/factory'
import type { Context } from 'hono'
import type { Env } from '../index'
import { verifyAdminToken, getJwtSecret, isAuthConfigurationReady, principalFromToken } from '../services/auth'
import { resolveStore, storeSelectorFromRequest } from '../tenancy/stores'
import { resolveStoreRole, roleAllows, type Principal, type StoreRole } from '../tenancy/access'

type AuthFailure = { status: 401 | 503; error: string }

/** Verifies the bearer token and returns the acting principal. */
export async function authenticate(c: Context<Env>): Promise<Principal | AuthFailure> {
  const authHeader = c.req.header('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) return { status: 401, error: 'Missing or invalid Authorization header' }
  if (!isAuthConfigurationReady(c.env)) return { status: 503, error: 'Authentication service is not configured' }
  const secret = getJwtSecret(c.env)
  if (!secret) return { status: 503, error: 'Authentication service is not configured' }
  const payload = await verifyAdminToken(authHeader.slice(7), secret)
  if (!payload) return { status: 401, error: 'Invalid or expired token' }
  const principal = principalFromToken(payload, c.env)
  if (!principal) return { status: 401, error: 'Invalid or expired token' }
  return principal
}

function isFailure(value: Principal | AuthFailure): value is AuthFailure {
  return 'status' in value
}

/**
 * Store administration guard. The store comes from the request selector
 * (X-Store-Slug / X-Store-Host, primary store by default) and access is checked
 * against the principal's membership in the backend; the client never chooses
 * a store id directly.
 */
export const adminAuth = createMiddleware<Env>(async (c, next) => {
  const principal = await authenticate(c)
  if (isFailure(principal)) return c.json({ error: principal.error }, principal.status)

  const store = await resolveStore(c.env.DB, storeSelectorFromRequest(c.req))
  if (!store) return c.json({ error: 'Store not found', code: 'STORE_NOT_FOUND' }, 404)
  const role = await resolveStoreRole(c.env.DB, principal, store)
  if (!role) {
    const suspended = store.status === 'suspended' || store.status === 'cancelled'
    return c.json({ error: suspended ? 'Store is not available' : 'You do not have access to this store', code: suspended ? 'STORE_UNAVAILABLE' : 'STORE_FORBIDDEN' }, 403)
  }

  c.set('isAdmin', true)
  c.set('adminEmail', principal.email)
  c.set('principal', principal)
  c.set('store', store)
  c.set('storeId', store.id)
  c.set('role', role)
  await next()
})

/** Requires a minimum store role after adminAuth (superadmin always passes). */
export function requireRole(minimum: StoreRole) {
  return createMiddleware<Env>(async (c, next) => {
    if (!roleAllows(c.get('role'), minimum)) return c.json({ error: 'Your role does not allow this action', code: 'ROLE_FORBIDDEN' }, 403)
    await next()
  })
}

/** Platform-wide administration: only the superadmin defined by Worker secrets. */
export const platformAuth = createMiddleware<Env>(async (c, next) => {
  const principal = await authenticate(c)
  if (isFailure(principal)) return c.json({ error: principal.error }, principal.status)
  if (principal.kind !== 'superadmin') return c.json({ error: 'Platform administrator required', code: 'PLATFORM_FORBIDDEN' }, 403)
  c.set('isAdmin', true)
  c.set('adminEmail', principal.email)
  c.set('principal', principal)
  await next()
})

/** Optional authentication used for private previews of draft stores. */
export async function optionalPrincipal(c: Context<Env>): Promise<Principal | null> {
  if (!c.req.header('Authorization')) return null
  const principal = await authenticate(c)
  return isFailure(principal) ? null : principal
}
