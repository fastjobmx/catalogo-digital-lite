import type { Env } from '../index'
import { getStoreBySlug, PRIMARY_STORE_ID, publicStoreUrl, adminStoreUrl, type StoreStatus } from '../tenancy/stores'
import { currentPeriod } from '../ai/usage'
import { createAccessToken, ensureUser, normalizeEmail, upsertMembership } from './platformUsers'
import { isSuperadminEmail } from './auth'
import { verifyStore, type HealthCheck } from './provisioning'
import { storeAssetPrefix } from '../lib/assets'

export type StoreListItem = {
  id: number; slug: string; name: string; status: StoreStatus; planCode: string; template: string; businessType: string
  products: number; ordersLast30: number; aiPercent: number; ownerEmail: string | null; createdAt: string; activationRequestStatus: string | null
}

export class PlatformError extends Error {
  constructor(readonly code: string, message: string) { super(message) }
}

async function platformAudit(db: D1Database, action: string, storeId: number | null, payload: unknown, actor: string): Promise<void> {
  await db.prepare(`INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id) VALUES (?, 'store', ?, ?, ?, 'platform', ?)`)
    .bind(action, storeId === null ? 'platform' : String(storeId), JSON.stringify(payload), actor, storeId).run()
}

export async function listStores(db: D1Database, filter: { status?: string; query?: string } = {}): Promise<StoreListItem[]> {
  const period = currentPeriod()
  const result = await db.prepare(
    `SELECT s.id, s.slug, s.name, s.status, s.plan_code AS planCode, s.template, s.business_type AS businessType, s.created_at AS createdAt,
            (SELECT COUNT(*) FROM products p WHERE p.store_id = s.id AND p.is_archived = 0) AS products,
            (SELECT COUNT(*) FROM orders o WHERE o.store_id = s.id AND o.created_at >= datetime('now', '-30 days')) AS ordersLast30,
            CASE WHEN s.ai_monthly_budget_micros > 0 THEN CAST(ROUND(100.0 * COALESCE(u.estimated_cost_micros, 0) / s.ai_monthly_budget_micros) AS INTEGER) ELSE 0 END AS aiPercent,
            (SELECT pu.email FROM store_memberships m JOIN platform_users pu ON pu.id = m.user_id WHERE m.store_id = s.id AND m.role = 'owner' AND m.status = 'active' LIMIT 1) AS ownerEmail,
            (SELECT r.status FROM store_activation_requests r WHERE r.store_id = s.id ORDER BY r.id DESC LIMIT 1) AS activationRequestStatus
     FROM stores s LEFT JOIN ai_usage_monthly u ON u.store_id = s.id AND u.period = ?
     WHERE (? IS NULL OR s.status = ?) AND (? IS NULL OR s.name LIKE ? OR s.slug LIKE ?)
     ORDER BY s.id`,
  ).bind(period, filter.status || null, filter.status || null, filter.query || null, `%${filter.query}%`, `%${filter.query}%`).all<StoreListItem>()
  return result.results || []
}

export async function requireStore(db: D1Database, slugOrId: string): Promise<NonNullable<Awaited<ReturnType<typeof getStoreBySlug>>>> {
  const store = /^\d+$/.test(slugOrId)
    ? await db.prepare('SELECT id, slug, name, status, plan_code, template, business_type, ai_enabled, ai_monthly_budget_micros, ai_warn_percent FROM stores WHERE id = ?').bind(Number(slugOrId)).first<NonNullable<Awaited<ReturnType<typeof getStoreBySlug>>>>()
    : await getStoreBySlug(db, slugOrId)
  if (!store) throw new PlatformError('STORE_NOT_FOUND', `No encontré la tienda “${slugOrId}”.`)
  return store
}

export async function getStoreDetail(db: D1Database, env: Partial<Env['Bindings']>, slugOrId: string) {
  const store = await requireStore(db, slugOrId)
  const period = currentPeriod()
  const [config, members, services, usage, events, counts] = await Promise.all([
    db.prepare('SELECT name, whatsapp_phone AS whatsapp, currency, country, logo_url AS logoUrl, cover_image_url AS coverImageUrl FROM store_config WHERE id = ?').bind(store.id).first(),
    db.prepare(`SELECT u.id, u.email, u.status, m.role, m.status AS membershipStatus, CASE WHEN u.telegram_user_id IS NULL THEN 0 ELSE 1 END AS telegramLinked
      FROM store_memberships m JOIN platform_users u ON u.id = m.user_id WHERE m.store_id = ? ORDER BY m.role`).bind(store.id).all(),
    db.prepare('SELECT service_code AS code, billing, price, currency, status FROM store_services WHERE store_id = ? ORDER BY id').bind(store.id).all(),
    db.prepare('SELECT requests, blocked_requests AS blocked, estimated_cost_micros AS costMicros FROM ai_usage_monthly WHERE store_id = ? AND period = ?').bind(store.id, period).first<{ requests: number; blocked: number; costMicros: number }>(),
    db.prepare('SELECT level, source, code, detail, created_at AS createdAt FROM platform_events WHERE store_id = ? ORDER BY id DESC LIMIT 5').bind(store.id).all(),
    db.prepare(`SELECT (SELECT COUNT(*) FROM products WHERE store_id = ? AND is_archived = 0) AS products,
      (SELECT COUNT(*) FROM categories WHERE store_id = ? AND is_active = 1) AS categories,
      (SELECT COUNT(*) FROM orders WHERE store_id = ?) AS orders,
      (SELECT COUNT(*) FROM orders WHERE store_id = ? AND status = 'pendiente') AS pendingOrders`).bind(store.id, store.id, store.id, store.id).first<Record<string, number>>(),
  ])
  return {
    store: { ...store, isPrimary: store.id === PRIMARY_STORE_ID, publicUrl: publicStoreUrl(env.PUBLIC_STORE_BASE_URL, store), adminUrl: adminStoreUrl(env.PUBLIC_STORE_BASE_URL, store) },
    config, members: members.results || [], services: services.results || [], counts,
    ai: { period, requests: Number(usage?.requests || 0), blocked: Number(usage?.blocked || 0), costMicros: Number(usage?.costMicros || 0), budgetMicros: store.ai_monthly_budget_micros, enabled: Boolean(store.ai_enabled) },
    health: await verifyStore(db, store.id),
    events: events.results || [],
  }
}

const STATUS_TRANSITIONS: Record<string, StoreStatus[]> = {
  draft: ['active', 'suspended', 'cancelled'],
  active: ['suspended', 'cancelled'],
  suspended: ['active', 'cancelled'],
  cancelled: [],
}

export async function setStoreStatus(db: D1Database, slugOrId: string, status: StoreStatus, actor: string, reason?: string) {
  const store = await requireStore(db, slugOrId)
  if (store.status === status) return { store, changed: false }
  if (!STATUS_TRANSITIONS[store.status]?.includes(status)) throw new PlatformError('INVALID_TRANSITION', `No se puede pasar de ${store.status} a ${status}.`)
  if (status === 'cancelled' && store.id === PRIMARY_STORE_ID) throw new PlatformError('PRIMARY_STORE', 'La tienda principal no se puede cancelar.')
  if (status === 'active') {
    const health = await verifyStore(db, store.id)
    const blocking = health.filter((check) => !check.ok && check.key !== 'whatsapp')
    if (blocking.length) throw new PlatformError('NOT_READY', `La tienda no está lista: ${blocking.map((check) => check.label).join(', ')}.`)
  }
  await db.batch([
    db.prepare(`UPDATE stores SET status = ?, suspended_reason = ?, updated_at = datetime('now'),
      activated_at = CASE WHEN ? = 'active' AND activated_at IS NULL THEN datetime('now') ELSE activated_at END,
      suspended_at = CASE WHEN ? = 'suspended' THEN datetime('now') ELSE suspended_at END WHERE id = ?`)
      .bind(status, status === 'suspended' ? (reason || '').slice(0, 300) || null : null, status, status, store.id),
    db.prepare(`INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id) VALUES ('store_status_changed', 'store', ?, ?, ?, 'platform', ?)`)
      .bind(String(store.id), JSON.stringify({ from: store.status, to: status, reason: reason || null }), actor, store.id),
    ...(status === 'active' ? [db.prepare("UPDATE store_activation_requests SET status = 'approved', resolved_at = unixepoch(), resolved_by = ? WHERE store_id = ? AND status = 'pending'").bind(actor, store.id)] : []),
  ])
  return { store: { ...store, status }, changed: true }
}

export async function setStorePlan(db: D1Database, slugOrId: string, planCode: string, actor: string, options: { updateAiBudget?: boolean } = { updateAiBudget: true }) {
  const store = await requireStore(db, slugOrId)
  const plan = await db.prepare('SELECT code, name, ai_monthly_budget_micros FROM plans WHERE code = ? AND is_active = 1').bind(planCode).first<{ code: string; name: string; ai_monthly_budget_micros: number }>()
  if (!plan) throw new PlatformError('PLAN_NOT_FOUND', 'Ese plan no existe.')
  await db.prepare(`UPDATE stores SET plan_code = ?, ai_monthly_budget_micros = CASE WHEN ? THEN ? ELSE ai_monthly_budget_micros END, updated_at = datetime('now') WHERE id = ?`)
    .bind(plan.code, options.updateAiBudget ? 1 : 0, plan.ai_monthly_budget_micros, store.id).run()
  await platformAudit(db, 'store_plan_changed', store.id, { from: store.plan_code, to: plan.code }, actor)
  return { store, plan }
}

export async function setStoreAiBudget(db: D1Database, slugOrId: string, input: { budgetUsd?: number; enabled?: boolean; warnPercent?: number }, actor: string) {
  const store = await requireStore(db, slugOrId)
  if (input.budgetUsd !== undefined && (!Number.isFinite(input.budgetUsd) || input.budgetUsd < 0 || input.budgetUsd > 10_000)) throw new PlatformError('INVALID_BUDGET', 'El presupuesto debe estar entre 0 y 10.000 USD.')
  if (input.warnPercent !== undefined && (!Number.isInteger(input.warnPercent) || input.warnPercent < 1 || input.warnPercent > 100)) throw new PlatformError('INVALID_WARN', 'El aviso debe estar entre 1 y 100 %.')
  const budget = input.budgetUsd === undefined ? store.ai_monthly_budget_micros : Math.round(input.budgetUsd * 1_000_000)
  const enabled = input.enabled === undefined ? store.ai_enabled : input.enabled ? 1 : 0
  const warn = input.warnPercent ?? store.ai_warn_percent
  await db.prepare(`UPDATE stores SET ai_monthly_budget_micros = ?, ai_enabled = ?, ai_warn_percent = ?, updated_at = datetime('now') WHERE id = ?`).bind(budget, enabled, warn, store.id).run()
  // Re-arm the monthly warning when the budget grows.
  if (budget > store.ai_monthly_budget_micros) await db.prepare('UPDATE ai_usage_monthly SET warned_at = NULL WHERE store_id = ? AND period = ?').bind(store.id, currentPeriod()).run()
  await platformAudit(db, 'store_ai_budget_changed', store.id, { budgetMicros: budget, enabled: Boolean(enabled), warnPercent: warn }, actor)
  return { store, budgetMicros: budget, enabled: Boolean(enabled), warnPercent: warn }
}

/** Assigns an owner (by email or Telegram id) and returns one-time access codes. */
export async function assignOwner(db: D1Database, env: Partial<Env['Bindings']>, slugOrId: string, input: { email?: string; telegramUserId?: string; name?: string }, actor: string) {
  const store = await requireStore(db, slugOrId)
  const email = input.email ? normalizeEmail(input.email) : null
  if (input.email && !email) throw new PlatformError('INVALID_EMAIL', 'El correo no es válido.')
  if (email && isSuperadminEmail(email, env as Env['Bindings'])) throw new PlatformError('RESERVED_EMAIL', 'Ese correo está reservado.')
  if (!email && !input.telegramUserId) throw new PlatformError('OWNER_REQUIRED', 'Indica un correo o un ID de Telegram.')
  const userId = await ensureUser(db, { email, displayName: input.name, createdBy: actor })
  if (input.telegramUserId) {
    const other = await db.prepare('SELECT id FROM platform_users WHERE telegram_user_id = ? AND id <> ?').bind(input.telegramUserId, userId).first()
    if (other) throw new PlatformError('TELEGRAM_IN_USE', 'Ese Telegram ya pertenece a otro usuario.')
    await db.prepare(`UPDATE platform_users SET telegram_user_id = ?, status = 'active', updated_at = datetime('now') WHERE id = ?`).bind(input.telegramUserId, userId).run()
  }
  // The previous owner keeps access as administrator.
  await db.prepare(`UPDATE store_memberships SET role = 'admin', updated_at = datetime('now') WHERE store_id = ? AND role = 'owner' AND user_id <> ?`).bind(store.id, userId).run()
  await upsertMembership(db, { storeId: store.id, userId, role: 'owner', createdBy: actor })
  await platformAudit(db, 'store_owner_assigned', store.id, { userId, email, telegram: Boolean(input.telegramUserId) }, actor)
  return { store, userId, ...(await issueOwnerAccess(db, env, store, userId, actor)) }
}

export async function issueOwnerAccess(db: D1Database, env: Partial<Env['Bindings']>, store: { id: number; slug: string }, userId: number, actor: string) {
  const user = await db.prepare('SELECT email, password_hash, telegram_user_id FROM platform_users WHERE id = ?').bind(userId).first<{ email: string | null; password_hash: string | null; telegram_user_id: string | null }>()
  let activationUrl: string | null = null
  if (user?.email && !user.password_hash) {
    const token = await createAccessToken(db, { userId, storeId: store.id, purpose: 'activation', ttlSeconds: 72 * 3600, createdBy: actor })
    activationUrl = `${adminStoreUrl(env.PUBLIC_STORE_BASE_URL, store)}/activar?token=${encodeURIComponent(token)}`
  }
  const telegramLinkCode = user?.telegram_user_id ? null : await createAccessToken(db, { userId, storeId: store.id, purpose: 'telegram_link', ttlSeconds: 72 * 3600, createdBy: actor })
  const username = env.TELEGRAM_BOT_USERNAME?.replace(/^@/, '')
  return { activationUrl, telegramLinkCode, telegramDeepLink: telegramLinkCode && username ? `https://t.me/${username}?start=link_${telegramLinkCode.replaceAll('-', '')}` : null }
}

export async function regenerateOwnerAccess(db: D1Database, env: Partial<Env['Bindings']>, slugOrId: string, actor: string) {
  const store = await requireStore(db, slugOrId)
  const owner = await db.prepare(`SELECT user_id FROM store_memberships WHERE store_id = ? AND role = 'owner' AND status = 'active' LIMIT 1`).bind(store.id).first<{ user_id: number }>()
  if (!owner) throw new PlatformError('OWNER_REQUIRED', 'La tienda no tiene propietario asignado.')
  await platformAudit(db, 'owner_access_regenerated', store.id, { userId: owner.user_id }, actor)
  return { store, ...(await issueOwnerAccess(db, env, store, owner.user_id, actor)) }
}

export async function addStoreService(db: D1Database, slugOrId: string, input: { serviceCode: string; billing?: string; price?: number; status?: string; notes?: string }, actor: string) {
  const store = await requireStore(db, slugOrId)
  const result = await db.prepare(
    `INSERT INTO store_services (store_id, service_code, billing, price, status, notes, created_by, starts_at) VALUES (?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'activo' THEN datetime('now') ELSE NULL END)`,
  ).bind(store.id, input.serviceCode, input.billing || 'unico', Math.max(0, Math.round(input.price || 0)), input.status || 'pendiente', input.notes || null, actor, input.status || 'pendiente').run()
  await platformAudit(db, 'store_service_added', store.id, input, actor)
  return { id: Number(result.meta.last_row_id) }
}

export async function requestCustomDomain(db: D1Database, slugOrId: string, domain: string, actor: string) {
  const store = await requireStore(db, slugOrId)
  const normalized = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  if (!/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/.test(normalized)) throw new PlatformError('INVALID_DOMAIN', 'El dominio no es válido.')
  const owner = await db.prepare('SELECT store_id FROM store_domains WHERE domain = ?').bind(normalized).first<{ store_id: number }>()
  if (owner && owner.store_id !== store.id) throw new PlatformError('DOMAIN_TAKEN', 'Ese dominio ya pertenece a otra tienda.')
  await db.prepare(`INSERT INTO store_domains (domain, store_id, status) VALUES (?, ?, 'pendiente') ON CONFLICT(domain) DO UPDATE SET updated_at = datetime('now')`).bind(normalized, store.id).run()
  await platformAudit(db, 'store_domain_requested', store.id, { domain: normalized }, actor)
  return { store, domain: normalized, status: 'pendiente' }
}

export async function platformSummary(db: D1Database) {
  const period = currentPeriod()
  const row = await db.prepare(
    `SELECT (SELECT COUNT(*) FROM stores) AS stores,
            (SELECT COUNT(*) FROM stores WHERE status = 'active') AS active,
            (SELECT COUNT(*) FROM stores WHERE status = 'draft') AS draft,
            (SELECT COUNT(*) FROM stores WHERE status = 'suspended') AS suspended,
            (SELECT COUNT(*) FROM products WHERE is_archived = 0) AS products,
            (SELECT COUNT(*) FROM orders WHERE created_at >= datetime('now', '-30 days')) AS ordersLast30,
            (SELECT COUNT(*) FROM orders WHERE status = 'pendiente') AS pendingOrders,
            (SELECT COALESCE(SUM(estimated_cost_micros), 0) FROM ai_usage_monthly WHERE period = ?) AS aiCostMicros,
            (SELECT COALESCE(SUM(requests), 0) FROM ai_usage_monthly WHERE period = ?) AS aiRequests,
            (SELECT COUNT(*) FROM platform_events WHERE level = 'error' AND created_at >= datetime('now', '-1 day')) AS errorsLast24h,
            (SELECT COUNT(*) FROM provisioning_jobs WHERE status = 'failed') AS failedJobs`,
  ).bind(period, period).first<Record<string, number>>()
  return { period, ...(row || {}) }
}

export async function recentEvents(db: D1Database, options: { level?: string; limit?: number } = {}) {
  const result = await db.prepare(
    `SELECT e.id, e.level, e.source, e.code, e.detail, e.created_at AS createdAt, s.slug
     FROM platform_events e LEFT JOIN stores s ON s.id = e.store_id
     WHERE (? IS NULL OR e.level = ?) ORDER BY e.id DESC LIMIT ?`,
  ).bind(options.level || null, options.level || null, Math.min(50, options.limit || 10)).all()
  return result.results || []
}

/** Technical health per store: data consistency plus recent errors. */
export async function storesHealth(db: D1Database): Promise<Array<{ slug: string; name: string; status: string; checks: HealthCheck[]; errorsLast24h: number }>> {
  const stores = await db.prepare(`SELECT id, slug, name, status FROM stores WHERE status <> 'cancelled' ORDER BY id`).all<{ id: number; slug: string; name: string; status: string }>()
  const output = []
  for (const store of stores.results || []) {
    const errors = await db.prepare(`SELECT COUNT(*) AS n FROM platform_events WHERE store_id = ? AND level = 'error' AND created_at >= datetime('now', '-1 day')`).bind(store.id).first<{ n: number }>()
    output.push({ slug: store.slug, name: store.name, status: store.status, checks: await verifyStore(db, store.id), errorsLast24h: Number(errors?.n || 0) })
  }
  return output
}

/** Stores a validated logo under the store's own prefix and points the
 * configuration to it. Keeps an existing logo unless `replace` is set, so a
 * repeated provisioning run does not overwrite what the owner uploaded. */
export async function setStoreLogo(
  db: D1Database,
  bucket: R2Bucket,
  storeId: number,
  image: { bytes: Uint8Array; contentType: string; extension: string },
  actor: string,
  options: { replace?: boolean } = {},
): Promise<{ logoUrl: string; changed: boolean }> {
  const current = await db.prepare('SELECT logo_url FROM store_config WHERE id = ?').bind(storeId).first<{ logo_url: string | null }>()
  if (!current) throw new PlatformError('STORE_NOT_FOUND', 'La tienda no existe.')
  if (current.logo_url && !options.replace) return { logoUrl: current.logo_url, changed: false }
  const key = `${storeAssetPrefix(storeId)}store/logo-${crypto.randomUUID()}.${image.extension}`
  await bucket.put(key, image.bytes, { httpMetadata: { contentType: image.contentType, cacheControl: 'public, max-age=31536000, immutable' }, customMetadata: { storeId: String(storeId), purpose: 'store-logo' } })
  const logoUrl = `/api/assets/${key}`
  await db.prepare(`UPDATE store_config SET logo_url = ?, updated_at = datetime('now') WHERE id = ?`).bind(logoUrl, storeId).run()
  await platformAudit(db, 'store_logo_set', storeId, { logoUrl }, actor)
  return { logoUrl, changed: true }
}

/**
 * Permanently removes one store and everything that belongs only to it (for
 * test stores and cancelled clients). Never the primary store, never an active
 * store, and only with the store's address typed as confirmation. Users who
 * belonged only to this store are removed too; shared users keep their other
 * memberships. Runs as a single D1 batch, so it applies completely or not at all.
 */
export async function purgeStore(db: D1Database, bucket: R2Bucket | undefined, slugOrId: string, confirm: string, actor: string) {
  const store = await requireStore(db, slugOrId)
  if (store.id === PRIMARY_STORE_ID) throw new PlatformError('PRIMARY_STORE', 'La tienda principal no se puede eliminar.')
  if (store.status === 'active') throw new PlatformError('STORE_ACTIVE', 'Suspende la tienda antes de eliminarla.')
  if (confirm.trim().toLowerCase() !== store.slug) throw new PlatformError('CONFIRMATION_REQUIRED', `Para eliminarla escribe exactamente su dirección: ${store.slug}.`)
  const id = store.id
  const orphanUsers = (await db.prepare(
    `SELECT user_id AS id FROM store_memberships m WHERE m.store_id = ?
       AND NOT EXISTS (SELECT 1 FROM store_memberships o WHERE o.user_id = m.user_id AND o.store_id <> ?)`,
  ).bind(id, id).all<{ id: number }>()).results?.map((row) => row.id) || []
  const counts = await db.prepare(
    `SELECT (SELECT COUNT(*) FROM products WHERE store_id = ?1) AS products, (SELECT COUNT(*) FROM categories WHERE store_id = ?1) AS categories,
            (SELECT COUNT(*) FROM orders WHERE store_id = ?1) AS orders, (SELECT COUNT(*) FROM store_memberships WHERE store_id = ?1) AS members`,
  ).bind(id).first<Record<string, number>>()
  const storeOrders = 'SELECT id FROM orders WHERE store_id = ?'
  const storeVariants = 'SELECT v.id FROM product_variants v JOIN products p ON p.id = v.product_id WHERE p.store_id = ?'
  const users = orphanUsers.length ? `(${orphanUsers.map(() => '?').join(',')})` : '(NULL)'
  await db.batch([
    db.prepare(`DELETE FROM order_inventory_operations WHERE order_id IN (${storeOrders}) OR variant_id IN (${storeVariants})`).bind(id, id),
    db.prepare(`DELETE FROM order_events WHERE order_id IN (${storeOrders})`).bind(id),
    db.prepare('DELETE FROM orders WHERE store_id = ?').bind(id),
    db.prepare('DELETE FROM product_variants WHERE product_id IN (SELECT id FROM products WHERE store_id = ?)').bind(id),
    db.prepare('DELETE FROM products WHERE store_id = ?').bind(id),
    db.prepare('DELETE FROM categories WHERE store_id = ?').bind(id),
    ...['ai_usage_events', 'ai_usage_monthly', 'assistant_messages', 'telegram_operations', 'platform_events', 'audit_log', 'store_domains', 'store_services', 'user_access_tokens', 'provisioning_jobs', 'store_memberships']
      .map((table) => db.prepare(`DELETE FROM ${table} WHERE store_id = ?`).bind(id)),
    db.prepare(`DELETE FROM user_access_tokens WHERE user_id IN ${users}`).bind(...orphanUsers),
    db.prepare(`DELETE FROM platform_users WHERE id IN ${users}`).bind(...orphanUsers),
    db.prepare('UPDATE telegram_sessions SET active_store_id = NULL, context_json = ? WHERE active_store_id = ?').bind('{}', id),
    db.prepare('DELETE FROM store_config WHERE id = ?').bind(id),
    db.prepare('DELETE FROM stores WHERE id = ?').bind(id),
    db.prepare(`INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id) VALUES ('store_purged', 'store', ?, ?, ?, 'platform', NULL)`)
      .bind(String(id), JSON.stringify({ slug: store.slug, name: store.name, ...counts, usersRemoved: orphanUsers.length }), actor),
  ])
  let assetsRemoved = 0
  if (bucket) {
    let cursor: string | undefined
    do {
      const page = await bucket.list({ prefix: storeAssetPrefix(id), limit: 1000, ...(cursor ? { cursor } : {}) })
      for (const object of page.objects) { await bucket.delete(object.key); assetsRemoved++ }
      cursor = page.truncated ? page.cursor : undefined
    } while (cursor)
  }
  return { slug: store.slug, name: store.name, ...counts, usersRemoved: orphanUsers.length, assetsRemoved }
}

export async function renameStoreSlug(db: D1Database, slugOrId: string, newSlug: string, actor: string) {
  const store = await requireStore(db, slugOrId)
  const { isValidSlug } = await import('../tenancy/stores')
  if (!isValidSlug(newSlug)) throw new PlatformError('INVALID_SLUG', 'La nueva dirección no es válida.')
  if (await getStoreBySlug(db, newSlug)) throw new PlatformError('SLUG_TAKEN', 'Esa dirección ya está en uso.')
  await db.prepare(`UPDATE stores SET slug = ?, updated_at = datetime('now') WHERE id = ?`).bind(newSlug, store.id).run()
  await platformAudit(db, 'store_slug_changed', store.id, { from: store.slug, to: newSlug }, actor)
  return { store: { ...store, slug: newSlug } }
}
