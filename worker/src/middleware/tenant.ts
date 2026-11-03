import { createMiddleware } from 'hono/factory'
import type { Env } from '../index'
import { resolveStore, storeSelectorFromRequest } from '../tenancy/stores'
import { resolveStoreRole } from '../tenancy/access'
import { optionalPrincipal } from './auth'

/**
 * Resolves the store for public storefront endpoints. Active stores are public;
 * draft stores are visible only to principals with access (private preview);
 * suspended and cancelled stores are hidden.
 */
export const publicStore = createMiddleware<Env>(async (c, next) => {
  const store = await resolveStore(c.env.DB, storeSelectorFromRequest(c.req))
  if (!store || store.status === 'cancelled') return c.json({ error: 'Store not found', code: 'STORE_NOT_FOUND' }, 404)
  if (store.status === 'suspended') return c.json({ error: 'Store not available', code: 'STORE_UNAVAILABLE' }, 404)
  if (store.status === 'draft') {
    const principal = await optionalPrincipal(c)
    const role = principal ? await resolveStoreRole(c.env.DB, principal, store) : null
    if (!role) return c.json({ error: 'Store not available', code: 'STORE_UNAVAILABLE' }, 404)
    c.header('Cache-Control', 'private, no-store')
    c.header('X-Store-Preview', 'draft')
  }
  c.set('store', store)
  c.set('storeId', store.id)
  await next()
})
