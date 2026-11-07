import { Hono } from 'hono'
import type { Env } from '../index'
import { adminAuth, requireCapability, requireRole } from '../middleware/auth'
import { createAdminToken, validateCredentials, getJwtSecret, isAuthConfigurationReady, isSuperadminEmail, verifyPasswordHash } from '../services/auth'
import { createCatalogCategory, createCatalogProduct, deactivateCatalogCategory, setProductArchived, updateCatalogCategory, updateCatalogProduct, updateStoreConfiguration, updateStoreTemplate, updateVariantStocksById, type AuditContext } from '../services/business'
import { normalizeStoreBody } from '../lib/storeMap'
import { findForeignAssetUrl } from '../lib/assets'
import { TEMPLATE_KEYS } from '../services/templates'
import { clearAdminLoginFailures, isAdminLoginBlocked, recordAdminLoginFailure } from '../services/loginRateLimit'
import { INVITABLE_ROLES, listUserMemberships, ROLE_LABELS, type StoreRole } from '../tenancy/access'
import { PRIMARY_STORE_ID } from '../tenancy/stores'
import { createAccessToken, ensureUser, findUserByEmail, normalizeEmail, upsertMembership } from '../services/platformUsers'
import { getStoreAiUsage } from '../ai/usage'
import { studioModel } from '../ai/imageStudio'
import { AccessError, listStoreMembers, requestEmailVerification, resendInvitation, resetMemberPassword, sendInvitation, setMemberAccess } from '../services/userAccess'
import { roleAllows } from '../tenancy/access'
import { AiCatalogError, photoToProduct, readCatalogPage, studioEdit } from '../services/aiCatalog'
import { ImportError, applyImportBatch, createImportJob, finishImportJob, listImportJobs, previewImport } from '../services/catalogImport'
import { CreditError, createCreditRequest, creditSummary, listCreditCosts, listCreditMovements, listCreditRequests } from '../ai/credits'
import { getTelegramBatchPhoto, getTelegramBatchReview, listTelegramBatches, updateTelegramBatchReviewItem } from '../services/telegramProductBatches'
import type { Context } from 'hono'

const app = new Hono<Env>()

function auditContext(c: Context<Env>): AuditContext {
 return { actor: c.get('adminEmail') || 'unknown', source: 'admin', storeId: c.get('storeId')! }
}

// POST /api/admin/login - Autenticación con JWT real (superadmin o usuario de tienda)
app.post('/login', async (c) => {
 if (!isAuthConfigurationReady(c.env)) {
 return c.json({ error: 'Authentication service is not configured' }, 503)
 }

 const body = await c.req.json().catch(() => null)
 const email = typeof body?.email === 'string' ? body.email : undefined
 const password = typeof body?.password === 'string' ? body.password : undefined

 if (!email || !password || email.length > 320 || password.length > 1024) {
 return c.json({ error: 'Email and password required' }, 400)
 }

 const clientIp = c.req.header('CF-Connecting-IP') || 'unknown'
 if (await isAdminLoginBlocked(c.env.DB, clientIp, email)) {
 return c.json({ error: 'Too many failed login attempts. Try again later.' }, 429, { 'Retry-After': '900' })
 }

 const secret = getJwtSecret(c.env)
 if (!secret) return c.json({ error: 'Authentication service is not configured' }, 503)

 // The platform superadmin is validated only against Worker secrets.
 if (isSuperadminEmail(email, c.env)) {
  const isValid = await validateCredentials(email, password, c.env)
  if (!isValid) {
   await recordAdminLoginFailure(c.env.DB, clientIp, email)
   return c.json({ error: 'Invalid credentials' }, 401)
  }
  await clearAdminLoginFailures(c.env.DB, clientIp, email)
  const token = await createAdminToken(email, secret, { sa: true })
  await c.env.DB.prepare(
   `INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id)
    VALUES ('admin_login', 'admin', ?, '{}', ?, 'api', NULL)`
  ).bind(email, email).run()
  const stores = await c.env.DB.prepare(`SELECT id AS storeId, slug, name, status FROM stores WHERE status <> 'cancelled' ORDER BY id`).all()
  return c.json({
   token, email, role: 'superadmin',
   stores: (stores.results || []).map((store) => ({ ...store, role: 'superadmin' })),
   expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  })
 }

 const user = await findUserByEmail(c.env.DB, email)
 const isValid = Boolean(user && user.status === 'active' && user.password_hash && await verifyPasswordHash(password, user.password_hash))
 if (!user || !isValid) {
  await recordAdminLoginFailure(c.env.DB, clientIp, email)
  return c.json({ error: 'Invalid credentials' }, 401)
 }
 await clearAdminLoginFailures(c.env.DB, clientIp, email)
 const memberships = await listUserMemberships(c.env.DB, user.id)
 if (!memberships.length) return c.json({ error: 'Your account has no active store' }, 403)
 const token = await createAdminToken(user.email, secret, { sub: String(user.id) })
 await c.env.DB.batch([
  c.env.DB.prepare("UPDATE platform_users SET last_login_at = datetime('now') WHERE id = ?").bind(user.id),
  ...memberships.map((membership) => c.env.DB.prepare(
   `INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id) VALUES ('admin_login', 'user', ?, '{}', ?, 'api', ?)`,
  ).bind(String(user.id), user.email, membership.storeId)),
 ])
 return c.json({
  token, email: user.email, role: 'user', stores: memberships,
  expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
 })
})

// GET /api/admin/session - Identidad, tienda activa y rol efectivo
app.get('/session', adminAuth, async (c) => {
 const principal = c.get('principal')!
 const store = c.get('store')!
 const stores = principal.kind === 'superadmin'
  ? ((await c.env.DB.prepare(`SELECT id AS storeId, slug, name, status FROM stores WHERE status <> 'cancelled' ORDER BY id`).all()).results || []).map((s) => ({ ...s, role: 'superadmin' }))
  : await listUserMemberships(c.env.DB, principal.userId)
 return c.json({
  email: principal.email,
  kind: principal.kind,
  role: c.get('role'),
  roleLabel: ROLE_LABELS[c.get('role')!],
  store: { id: store.id, slug: store.slug, name: store.name, status: store.status, planCode: store.plan_code, isPrimary: store.id === PRIMARY_STORE_ID },
  stores,
 })
})

// GET /api/admin/stats - Resumen para dashboard (protegido)
app.get('/stats', adminAuth, async (c) => {
 const db = c.env.DB
 const storeId = c.get('storeId')!

 const [productsResult, categoriesResult, variantsResult, ordersResult] = await Promise.all([
 db.prepare('SELECT COUNT(*) as count FROM products WHERE store_id = ? AND is_active = 1 AND is_archived = 0').bind(storeId).first(),
 db.prepare('SELECT COUNT(*) as count FROM categories WHERE store_id = ? AND is_active = 1').bind(storeId).first(),
 db.prepare('SELECT SUM(v.stock) as total FROM product_variants v JOIN products p ON p.id = v.product_id WHERE p.store_id = ? AND v.is_active = 1').bind(storeId).first(),
 db.prepare("SELECT COUNT(*) as count FROM orders WHERE store_id = ? AND date(created_at) = date('now')").bind(storeId).first(),
 ])

 return c.json({
 products: (productsResult as any)?.count ?? 0,
 categories: (categoriesResult as any)?.count ?? 0,
 totalStock: (variantsResult as any)?.total ?? 0,
 ordersToday: (ordersResult as any)?.count ?? 0,
 })
})

// PUT /api/admin/store - Actualizar configuración de la tienda (protegido)
app.put('/store', adminAuth, requireRole('admin'), async (c) => {
 const body = await c.req.json().catch(() => null)
 if (!body) {
 return c.json({ error: 'Invalid JSON body' }, 400)
 }

 const normalized = normalizeStoreBody(body as Record<string, unknown>)
 const foreign = findForeignAssetUrl(normalized, c.get('storeId')!)
 if (foreign) return c.json({ error: 'An image belongs to another store', code: 'ASSET_NOT_OWNED' }, 400)
 const { template, ...configuration } = normalized
 if (template !== undefined && (typeof template !== 'string' || !(TEMPLATE_KEYS as readonly string[]).includes(template))) return c.json({ error: 'Invalid store template' }, 400)
 const updatedConfig = await updateStoreConfiguration(c.env.DB, configuration, auditContext(c))
 let updatedTemplate = 0
 if (typeof template === 'string') {
  try { updatedTemplate = await updateStoreTemplate(c.env.DB, template, auditContext(c)) }
  catch (error) {
   if (error instanceof Error && error.message === 'INVALID_STORE_TEMPLATE') return c.json({ error: 'Invalid store template' }, 400)
   throw error
  }
 }
 const updated = updatedConfig + updatedTemplate
 if (updated === 0) {
 return c.json({ error: 'No valid fields to update' }, 400)
 }
 return c.json({ success: true, updated })
})

// ============================================
// Telegram Linking (Onboarding)
// ============================================

// POST /api/admin/telegram/link-code - Generar código de vinculación temporal
app.post('/telegram/link-code', adminAuth, async (c) => {
 const db = c.env.DB
 const principal = c.get('principal')!
 const storeId = c.get('storeId')!
 const adminEmail = c.get('adminEmail') || 'unknown'

 if (principal.kind === 'user') {
  const code = await createAccessToken(db, { userId: principal.userId, storeId, purpose: 'telegram_link', ttlSeconds: 24 * 60 * 60, createdBy: adminEmail })
  await db.prepare(
   `INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id)
    VALUES ('telegram_link_code_generated', 'user', ?, '{}', ?, 'admin', ?)`
  ).bind(String(principal.userId), adminEmail, storeId).run()
  const username = c.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, '')
  return c.json({
   code,
   expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
   expiresInMinutes: 24 * 60,
   deepLink: username ? `https://t.me/${username}?start=link_${code.replaceAll('-', '')}` : null,
   instructions: `Envía este comando a tu asistente de Telegram:\n/link ${code}`,
  })
 }

 if (storeId !== PRIMARY_STORE_ID) {
  return c.json({ error: 'The store owner must generate the Telegram code from their own account', code: 'OWNER_ACCOUNT_REQUIRED' }, 400)
 }

 // Legacy single-owner link for the primary store (kept for SneakerHub).
 const code = crypto.randomUUID().replaceAll('-', '')
 const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()

 await db.prepare(
 `UPDATE store_config SET telegram_link_code = ?, telegram_link_expires_at = ?, updated_at = datetime('now') WHERE id = ?`
 ).bind(code, expiresAt, PRIMARY_STORE_ID).run()

 await db.prepare(
 `INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id)
 VALUES ('telegram_link_code_generated', 'store', ?, ?, ?, 'admin', ?)`
 ).bind(String(PRIMARY_STORE_ID), JSON.stringify({ expiresAt }), adminEmail, PRIMARY_STORE_ID).run()

 return c.json({
 code,
 expiresAt,
 expiresInMinutes: 10,
 instructions: `Envía este comando a tu bot de Telegram:\n/link ${code}`,
 })
})

// GET /api/admin/telegram/status - Verificar estado de vinculación
app.get('/telegram/status', adminAuth, async (c) => {
 const principal = c.get('principal')!
 if (principal.kind === 'user') {
  const row = await c.env.DB.prepare('SELECT telegram_user_id FROM platform_users WHERE id = ?').bind(principal.userId).first<{ telegram_user_id: string | null }>()
  return c.json({ linked: Boolean(row?.telegram_user_id), ownerId: row?.telegram_user_id || null })
 }
 const result = await c.env.DB.prepare(
 `SELECT telegram_owner_id FROM store_config WHERE id = ?`
 ).bind(c.get('storeId')).first()

 const ownerId = (result as any)?.telegram_owner_id

 return c.json({
 linked: !!ownerId,
 ownerId: ownerId || null,
 })
})

// ============================================
// Equipo de la tienda (propietario)
// ============================================

app.get('/team', adminAuth, requireRole('admin'), async (c) => {
 const { results } = await c.env.DB.prepare(
  `SELECT u.id, u.email, u.display_name AS displayName, u.status, m.role, m.status AS membershipStatus,
          CASE WHEN u.telegram_user_id IS NULL THEN 0 ELSE 1 END AS telegramLinked
   FROM store_memberships m JOIN platform_users u ON u.id = m.user_id
   WHERE m.store_id = ? ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.email`,
 ).bind(c.get('storeId')).all()
 return c.json({ items: (results || []).map((row) => ({ ...row, telegramLinked: Boolean((row as any).telegramLinked) })) })
})

app.post('/team', adminAuth, requireRole('owner'), async (c) => {
 const body = await c.req.json().catch(() => null) as { email?: unknown; role?: unknown; displayName?: unknown } | null
 const email = normalizeEmail(body?.email)
 const role = typeof body?.role === 'string' && (INVITABLE_ROLES as string[]).includes(body.role) ? body.role as StoreRole : null
 if (!email || !role) return c.json({ error: 'A valid email and role (admin, operator, seller or inventory) are required' }, 400)
 if (isSuperadminEmail(email, c.env)) return c.json({ error: 'This email is reserved' }, 400)
 const actor = c.get('adminEmail') || 'unknown'
 const storeId = c.get('storeId')!
 const userId = await ensureUser(c.env.DB, { email, displayName: typeof body?.displayName === 'string' ? body.displayName : '', createdBy: actor })
 const existingOwner = await c.env.DB.prepare("SELECT role FROM store_memberships WHERE store_id = ? AND user_id = ? AND role = 'owner'").bind(storeId, userId).first()
 if (existingOwner) return c.json({ error: 'The owner role cannot be changed here' }, 409)
 await upsertMembership(c.env.DB, { storeId, userId, role, createdBy: actor })
 const user = await c.env.DB.prepare('SELECT status, password_hash, display_name FROM platform_users WHERE id = ?').bind(userId).first<{ status: string; password_hash: string | null; display_name: string }>()
 let activationUrl: string | null = null
 let delivery: 'email' | 'manual' | null = null
 if (!user?.password_hash) {
  // Invitation by email when configured; otherwise the one-time link is shown to share privately (as before).
  const store = c.get('store')!
  const invitation = await sendInvitation(c.env.DB, c.env, { userId, email, displayName: user?.display_name || '', storeId, slug: store.slug, storeName: store.name }, actor)
  activationUrl = invitation.activationUrl
  delivery = invitation.delivery
 }
 await c.env.DB.prepare(
  `INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id) VALUES ('team_member_added', 'user', ?, ?, ?, 'admin', ?)`,
 ).bind(String(userId), JSON.stringify({ role }), actor, storeId).run()
 return c.json({ success: true, userId, role, activationUrl, delivery }, 201)
})

app.delete('/team/:userId', adminAuth, requireRole('owner'), async (c) => {
 const userId = Number(c.req.param('userId'))
 const principal = c.get('principal')!
 if (!Number.isSafeInteger(userId) || userId < 1) return c.json({ error: 'Invalid user' }, 400)
 if (principal.kind === 'user' && principal.userId === userId) return c.json({ error: 'You cannot remove your own access' }, 409)
 const result = await c.env.DB.prepare(
  `UPDATE store_memberships SET status = 'revoked', updated_at = datetime('now') WHERE store_id = ? AND user_id = ? AND role <> 'owner' AND status = 'active'`,
 ).bind(c.get('storeId'), userId).run()
 if (!result.meta.changes) return c.json({ error: 'Member not found or cannot be removed' }, 404)
 await c.env.DB.prepare(
  `INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id) VALUES ('team_member_revoked', 'user', ?, '{}', ?, 'admin', ?)`,
 ).bind(String(userId), c.get('adminEmail') || 'unknown', c.get('storeId')).run()
 return c.json({ success: true })
})

// ============================================
// Auditoría y consumo de IA de la tienda
// ============================================

app.get('/audit', adminAuth, requireRole('admin'), async (c) => {
 const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') || 30)))
 const { results } = await c.env.DB.prepare(
  `SELECT id, action, entity_type AS entityType, entity_id AS entityId, performed_by AS performedBy, source, created_at AS createdAt
   FROM audit_log WHERE store_id = ? ORDER BY id DESC LIMIT ?`,
 ).bind(c.get('storeId'), limit).all()
 return c.json({ items: results || [] })
})

app.get('/ai-usage', adminAuth, requireRole('admin'), async (c) => {
 return c.json(await getStoreAiUsage(c.env.DB, c.get('storeId')!))
})

// AI credits of the current store: read-only balance and history, plus recharge requests.
// Merchants can never add or change credits; that happens only in /api/platform.
app.get('/credits', adminAuth, requireRole('admin'), async (c) => {
 const storeId = c.get('storeId')!
 const store = await c.env.DB.prepare('SELECT ai_enabled FROM stores WHERE id = ?').bind(storeId).first<{ ai_enabled: number }>()
 const costs = (await listCreditCosts(c.env.DB)).map(({ feature, label, configured, credits, enabled }) => ({ feature, label, configured, credits, enabled }))
 return c.json({
  aiEnabled: Boolean(store?.ai_enabled) && Boolean(c.env.GEMINI_API_KEY),
 studioAvailable: Boolean(store?.ai_enabled) && Boolean(c.env.GEMINI_API_KEY) && Boolean(studioModel(c.env)),
  ...(await creditSummary(c.env.DB, storeId)),
  costs,
  movements: (await listCreditMovements(c.env.DB, storeId, 30)).map((row: any) => ({ ...row, actor: row.actor === 'system' ? 'system' : String(row.actor).startsWith('platform:') ? 'platform' : 'store' })),
  requests: (await listCreditRequests(c.env.DB, { storeId, limit: 10 })).map((row: any) => ({ id: row.id, credits: row.credits, note: row.note, status: row.status, approvedCredits: row.approvedCredits, resolutionNote: row.resolutionNote, createdAt: row.createdAt, resolvedAt: row.resolvedAt })),
 })
})

app.post('/credits/requests', adminAuth, requireRole('admin'), async (c) => {
 const body = await c.req.json().catch(() => null) as { credits?: unknown; note?: unknown } | null
 if (!body) return c.json({ error: 'Invalid JSON body' }, 400)
 try {
  return c.json(await createCreditRequest(c.env.DB, c.get('storeId')!, body, c.get('adminEmail') || 'unknown'), 201)
 } catch (error) {
  if (error instanceof CreditError) return c.json({ error: error.message, code: error.code }, error.status)
  throw error
 }
})

// Bulk product import. Files are read in the browser; these routes receive normalized rows in
// batches, validate everything again and only touch existing products when the job allows it.
function importFail(c: Context<Env>, error: unknown) {
 if (error instanceof ImportError) return c.json({ error: error.message, code: error.code }, error.status)
 throw error
}
app.get('/imports', adminAuth, requireRole('admin'), async (c) => c.json({ items: await listImportJobs(c.env.DB, c.get('storeId')!) }))
app.get('/telegram-imports', adminAuth, requireRole('admin'), async (c) => c.json({ items: await listTelegramBatches(c.env.DB, c.get('storeId')!) }))
app.get('/telegram-imports/:id', adminAuth, requireRole('admin'), async (c) => {
 const result = await getTelegramBatchReview(c.env.DB, c.get('storeId')!, c.req.param('id'))
 return result ? c.json(result) : c.json({ error: 'Telegram import not found' }, 404)
})
app.get('/telegram-imports/:id/items/:itemId/photo', adminAuth, requireRole('admin'), async (c) => {
 const itemId = Number(c.req.param('itemId'))
 if (!Number.isSafeInteger(itemId) || itemId <= 0) return c.json({ error: 'Invalid item' }, 400)
 const photo = await getTelegramBatchPhoto(c.env.DB, c.env.ASSETS, c.get('storeId')!, c.req.param('id'), itemId)
 if (!photo) return c.json({ error: 'Photo not found' }, 404)
 return c.body(photo.body, 200, { 'Content-Type': photo.httpMetadata?.contentType || 'application/octet-stream', 'Cache-Control': 'private, no-store' })
})
app.put('/telegram-imports/:id/items/:itemId', adminAuth, requireRole('admin'), async (c) => {
 const itemId = Number(c.req.param('itemId'))
 const body = await c.req.json().catch(() => null) as Record<string, unknown> | null
 if (!Number.isSafeInteger(itemId) || itemId <= 0 || !body || Array.isArray(body)) return c.json({ error: 'Invalid item update' }, 400)
 try {
  return c.json(await updateTelegramBatchReviewItem(c.env.DB, c.get('storeId')!, c.req.param('id'), itemId, body, c.get('adminEmail') || 'unknown'))
 } catch (error) {
  const code = error instanceof Error ? error.message : 'UPDATE_FAILED'
  if (code === 'BATCH_NOT_FOUND' || code === 'BATCH_ITEM_NOT_FOUND') return c.json({ error: 'Telegram import item not found' }, 404)
  if (code === 'INVALID_SKU' || code === 'INVALID_PRICE' || code === 'INVALID_STOCK') return c.json({ error: code }, 400)
  if (code === 'BATCH_NOT_EDITABLE' || code === 'BATCH_ITEM_NOT_EDITABLE' || code === 'SKU_ALREADY_EXISTS') return c.json({ error: code }, 409)
  throw error
 }
})
app.post('/imports', adminAuth, requireRole('admin'), async (c) => {
 const body = await c.req.json().catch(() => null)
 if (!body) return c.json({ error: 'Invalid JSON body' }, 400)
 try { return c.json(await createImportJob(c.env.DB, c.get('storeId')!, body, c.get('adminEmail') || 'unknown'), 201) } catch (error) { return importFail(c, error) }
})
app.post('/imports/:id/preview', adminAuth, requireRole('admin'), async (c) => {
 const body = await c.req.json().catch(() => null) as { products?: unknown } | null
 if (!body) return c.json({ error: 'Invalid JSON body' }, 400)
 try { return c.json(await previewImport(c.env.DB, c.get('storeId')!, c.req.param('id'), body.products)) } catch (error) { return importFail(c, error) }
})
app.post('/imports/:id/batches/:index', adminAuth, requireRole('admin'), async (c) => {
 const body = await c.req.json().catch(() => null) as { products?: unknown } | null
 if (!body) return c.json({ error: 'Invalid JSON body' }, 400)
 try { return c.json(await applyImportBatch(c.env.DB, auditContext(c), c.req.param('id'), Number(c.req.param('index')), body.products)) } catch (error) { return importFail(c, error) }
})
app.post('/imports/:id/finish', adminAuth, requireRole('admin'), async (c) => {
 try { return c.json(await finishImportJob(c.env.DB, c.get('storeId')!, c.req.param('id'))) } catch (error) { return importFail(c, error) }
})

// AI for the catalogue (photo → product suggestion, scanned PDF page → rows). Each call goes through
// the store AI switch, the monthly budget and credits; failed calls never consume credits.
async function aiAction(c: Context<Env>, action: (key: string, body: Record<string, unknown>) => Promise<unknown>) {
 const body = await c.req.json().catch(() => null) as Record<string, unknown> | null
 if (!body) return c.json({ error: 'Invalid JSON body' }, 400)
 try { return c.json(await action((c.req.header('Idempotency-Key') || '').trim(), body)) } catch (error) {
  if (error instanceof AiCatalogError) return c.json({ error: error.message, code: error.code }, error.status)
  throw error
 }
}
app.post('/ai/photo-product', adminAuth, requireRole('admin'), (c) => aiAction(c, (key, body) => photoToProduct(c.env, c.get('storeId')!, c.get('adminEmail') || 'unknown', key, body)))
app.post('/ai/catalog-page', adminAuth, requireRole('admin'), (c) => aiAction(c, (key, body) => readCatalogPage(c.env, c.get('storeId')!, c.get('adminEmail') || 'unknown', key, body)))
app.post('/ai/studio', adminAuth, requireRole('admin'), (c) => aiAction(c, (key, body) => studioEdit(c.env, c.get('storeId')!, c.get('adminEmail') || 'unknown', key, body)))

// ============================================
// Usuarios y accesos (one store; the backend scopes every action to the resolved store)
// ============================================
function accessFail(c: Context<Env>, error: unknown) {
 if (error instanceof AccessError) return c.json({ error: error.message, code: error.code }, error.status)
 throw error
}
const memberId = (c: Context<Env>) => { const id = Number(c.req.param('id')); return Number.isSafeInteger(id) && id > 0 ? id : 0 }
const actorUserId = (c: Context<Env>) => { const principal = c.get('principal'); return principal?.kind === 'user' ? principal.userId : null }

app.get('/users', adminAuth, requireRole('admin'), async (c) => c.json({ items: await listStoreMembers(c.env.DB, c.get('storeId')!) }))
app.post('/users/:id/password-reset', adminAuth, requireRole('owner'), async (c) => {
 try { return c.json(await resetMemberPassword(c.env.DB, c.env, c.get('storeId')!, memberId(c), c.get('adminEmail') || 'unknown')) } catch (error) { return accessFail(c, error) }
})
app.post('/users/:id/invitation', adminAuth, requireRole('owner'), async (c) => {
 try { return c.json(await resendInvitation(c.env.DB, c.env, c.get('storeId')!, memberId(c), c.get('adminEmail') || 'unknown')) } catch (error) { return accessFail(c, error) }
})
// The owner can ask for any member's verification; everyone can ask for their own.
app.post('/users/:id/verify-email', adminAuth, async (c) => {
 const id = memberId(c)
 if (actorUserId(c) !== id && !roleAllows(c.get('role'), 'owner')) return c.json({ error: 'Your role does not allow this action', code: 'ROLE_FORBIDDEN' }, 403)
 try { return c.json(await requestEmailVerification(c.env.DB, c.env, c.get('storeId')!, id, c.get('adminEmail') || 'unknown')) } catch (error) { return accessFail(c, error) }
})
app.post('/users/:id/access', adminAuth, requireRole('owner'), async (c) => {
 const body = await c.req.json().catch(() => null) as { active?: unknown } | null
 if (typeof body?.active !== 'boolean') return c.json({ error: 'active must be true or false' }, 400)
 try { return c.json(await setMemberAccess(c.env.DB, c.get('storeId')!, memberId(c), body.active, c.get('adminEmail') || 'unknown', actorUserId(c))) } catch (error) { return accessFail(c, error) }
})

// ============================================
// CRUD Productos (protegido)
// ============================================

// POST /api/admin/products - Crear producto
app.post('/products', adminAuth, requireRole('admin'), async (c) => {
 const body = await c.req.json().catch(() => null)
 if (!body || !body.sku || !body.name) {
 return c.json({ error: 'SKU and name are required' }, 400)
 }
 if (findForeignAssetUrl(body.imageUrls, c.get('storeId')!)) return c.json({ error: 'An image belongs to another store', code: 'ASSET_NOT_OWNED' }, 400)

 try {
 const product = await createCatalogProduct(c.env.DB, body, auditContext(c))
 return c.json(product, 201)
 } catch (error) {
 if (error instanceof Error && error.message === 'SKU_ALREADY_EXISTS') return c.json({ error: 'SKU already exists' }, 409)
 if (error instanceof Error && error.message === 'PLAN_PRODUCT_LIMIT') return c.json({ error: 'Your plan product limit was reached. Archive products or change plan.', code: 'PLAN_PRODUCT_LIMIT' }, 409)
 if (error instanceof Error && error.message === 'CATEGORY_NOT_FOUND') return c.json({ error: 'Category not found' }, 400)
 throw error
 }
})

// PUT /api/admin/products/:id - Actualizar producto
app.put('/products/:id', adminAuth, requireRole('admin'), async (c) => {
 const id = parseInt(c.req.param('id'))
 const body = await c.req.json().catch(() => null)
 if (!body || isNaN(id)) {
 return c.json({ error: 'Invalid request' }, 400)
 }
 if (findForeignAssetUrl((body as Record<string, unknown>).imageUrls ?? (body as Record<string, unknown>).image_urls, c.get('storeId')!)) {
  return c.json({ error: 'An image belongs to another store', code: 'ASSET_NOT_OWNED' }, 400)
 }

 const exists = await c.env.DB.prepare('SELECT id FROM products WHERE id = ? AND store_id = ?').bind(id, c.get('storeId')).first()
 if (!exists) return c.json({ error: 'Product not found' }, 404)
 let updated: boolean
 try {
  updated = await updateCatalogProduct(c.env.DB, { id }, body as Record<string, unknown>, auditContext(c))
 } catch (error) {
  if (error instanceof Error && error.message === 'CATEGORY_NOT_FOUND') return c.json({ error: 'Category not found' }, 400)
  throw error
 }
 if (!updated) {
 return c.json({ error: 'No valid fields to update' }, 400)
 }
 return c.json({ success: true, id })
})

// DELETE /api/admin/products/:id - Archivar producto (soft delete)
app.delete('/products/:id', adminAuth, requireRole('admin'), async (c) => {
 const id = parseInt(c.req.param('id'))
 if (isNaN(id)) return c.json({ error: 'Invalid ID' }, 400)

 const archived = await setProductArchived(c.env.DB, { id }, true, auditContext(c))
 if (!archived) return c.json({ error: 'Product not found' }, 404)
 return c.json({ success: true, archived: id })
})

// ============================================
// CRUD Categorías (protegido)
// ============================================

// POST /api/admin/categories - Crear categoría
app.post('/categories', adminAuth, requireRole('admin'), async (c) => {
 const body = await c.req.json().catch(() => null)
 if (!body || !body.name || !body.slug) {
 return c.json({ error: 'Name and slug are required' }, 400)
 }

 try {
 const category = await createCatalogCategory(c.env.DB, body, auditContext(c))
 return c.json(category, 201)
 } catch (error) {
 if (error instanceof Error && error.message === 'CATEGORY_SLUG_EXISTS') return c.json({ error: 'Slug already exists' }, 409)
 throw error
 }
})

// PUT /api/admin/categories/:id - Editar categoría
app.put('/categories/:id', adminAuth, requireRole('admin'), async (c) => {
 const id = Number(c.req.param('id'))
 const body = await c.req.json().catch(() => null) as { name?: string; slug?: string } | null
 const name = typeof body?.name === 'string' ? body.name.trim() : ''
 const slug = typeof body?.slug === 'string' ? body.slug.trim() : ''
 if (!Number.isInteger(id) || id <= 0 || !name || !slug) return c.json({ error: 'Valid category name and slug are required' }, 400)
 try {
 await updateCatalogCategory(c.env.DB, id, { name, slug }, auditContext(c))
 } catch (error) {
 if (error instanceof Error && error.message === 'CATEGORY_NOT_FOUND') return c.json({ error: 'Category not found' }, 404)
 if (error instanceof Error && error.message === 'CATEGORY_SLUG_EXISTS') return c.json({ error: 'Slug already exists' }, 409)
 throw error
 }
 return c.json({ success: true, id, slug })
})

// DELETE /api/admin/categories/:id - Desactivar categoría
app.delete('/categories/:id', adminAuth, requireRole('admin'), async (c) => {
 const id = parseInt(c.req.param('id'))
 if (isNaN(id)) return c.json({ error: 'Invalid ID' }, 400)
 const changed = await deactivateCatalogCategory(c.env.DB, id, auditContext(c))
 if (!changed) return c.json({ error: 'Category not found' }, 404)
 return c.json({ success: true, deactivated: id })
})

app.put('/products/:id/variants', adminAuth, requireCapability('inventory.manage'), async (c) => {
  const id = parseInt(c.req.param('id'))
  const body = await c.req.json().catch(() => null)
  if (!body?.variants || isNaN(id)) return c.json({ error: 'Invalid request' }, 400)
  const updates = body.variants as Array<{ id: number; stock: number }>
  const variants = await c.env.DB.prepare(
    'SELECT v.id FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.product_id = ? AND p.store_id = ?',
  ).bind(id, c.get('storeId')).all<{ id: number }>()
  const ownedIds = new Set((variants.results || []).map((variant) => variant.id))
  if (!ownedIds.size) return c.json({ error: 'Product not found' }, 404)
  if (updates.some((variant) => !ownedIds.has(variant.id) || !Number.isInteger(variant.stock) || variant.stock < 0)) {
    return c.json({ error: 'Invalid variant or stock value' }, 400)
  }
  await updateVariantStocksById(c.env.DB, updates, auditContext(c), { productId: id, variants: updates })
  return c.json({ success: true })
})

app.post('/products/:id/restore', adminAuth, requireRole('admin'), async (c) => {
  const id = parseInt(c.req.param('id'))
  if (isNaN(id)) return c.json({ error: 'Invalid ID' }, 400)
  const restored = await setProductArchived(c.env.DB, { id }, false, auditContext(c))
  if (!restored) return c.json({ error: 'Product not found' }, 404)
  return c.json({ success: true, id })
})

export default app
