import { createMiddleware } from 'hono/factory'
import type { Env } from '../index'
import { isTrialExpired, resolveStore, storeSelectorFromRequest } from '../tenancy/stores'
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
  // A trial store that ended keeps its data but is private again, like a draft: only its team can preview it.
  const trialEnded = isTrialExpired(store)
  if (store.status === 'draft' || trialEnded) {
    const principal = await optionalPrincipal(c)
    const role = principal ? await resolveStoreRole(c.env.DB, principal, store) : null
    if (!role) return c.json({ error: 'Store not available', code: trialEnded ? 'TRIAL_EXPIRED' : 'STORE_UNAVAILABLE' }, 404)
    c.header('Cache-Control', 'private, no-store')
    c.header('X-Store-Preview', trialEnded ? 'trial-expired' : 'draft')
  }
  c.set('store', store)
  c.set('storeId', store.id)
  await next()
})
