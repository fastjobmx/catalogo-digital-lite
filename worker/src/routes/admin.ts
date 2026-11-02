import { Hono } from 'hono'
import type { Env } from '../index'
import { adminAuth } from '../middleware/auth'
import { createAdminToken, validateCredentials, getJwtSecret, isAuthConfigurationReady } from '../services/auth'
import { createCatalogCategory, createCatalogProduct, deactivateCatalogCategory, updateCatalogCategory, updateCatalogProduct, updateStoreConfiguration, updateVariantStocksById } from '../services/business'
import { normalizeStoreBody } from '../lib/storeMap'
import { clearAdminLoginFailures, isAdminLoginBlocked, recordAdminLoginFailure } from '../services/loginRateLimit'

const app = new Hono<Env>()

// POST /api/admin/login - Autenticación con JWT real
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

 const isValid = await validateCredentials(email, password, c.env)
 if (!isValid) {
 await recordAdminLoginFailure(c.env.DB, clientIp, email)
 return c.json({ error: 'Invalid credentials' }, 401)
 }

 await clearAdminLoginFailures(c.env.DB, clientIp, email)

 const secret = getJwtSecret(c.env)
 if (!secret) return c.json({ error: 'Authentication service is not configured' }, 503)
 const token = await createAdminToken(email, secret)

 // Audit log
 await c.env.DB.prepare(
 `INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source)
 VALUES ('admin_login', 'admin', ?, '{}', ?, 'api')`
 ).bind(email, email).run()

 return c.json({
 token,
 email,
 expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
 })
})

// GET /api/admin/stats - Resumen para dashboard (protegido)
app.get('/stats', adminAuth, async (c) => {
 const db = c.env.DB

 const [productsResult, categoriesResult, variantsResult, ordersResult] = await Promise.all([
 db.prepare('SELECT COUNT(*) as count FROM products WHERE is_active = 1 AND is_archived = 0').first(),
 db.prepare('SELECT COUNT(*) as count FROM categories WHERE is_active = 1').first(),
 db.prepare('SELECT SUM(stock) as total FROM product_variants WHERE is_active = 1').first(),
 db.prepare("SELECT COUNT(*) as count FROM orders WHERE date(created_at) = date('now')").first(),
 ])

 return c.json({
 products: (productsResult as any)?.count ?? 0,
 categories: (categoriesResult as any)?.count ?? 0,
 totalStock: (variantsResult as any)?.total ?? 0,
 ordersToday: (ordersResult as any)?.count ?? 0,
 })
})

// PUT /api/admin/store - Actualizar configuración de la tienda (protegido)
app.put('/store', adminAuth, async (c) => {
 const body = await c.req.json().catch(() => null)
 if (!body) {
 return c.json({ error: 'Invalid JSON body' }, 400)
 }

 const normalized = normalizeStoreBody(body as Record<string, unknown>)
 const updated = await updateStoreConfiguration(c.env.DB, normalized, {
 actor: c.get('adminEmail') || 'unknown', source: 'admin',
 })
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

 // Generate a short-lived, high-entropy code using the platform CSPRNG.
 const code = crypto.randomUUID().replaceAll('-', '')

 // Code expires in 10 minutes
 const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()

 await db.prepare(
 `UPDATE store_config SET telegram_link_code = ?, telegram_link_expires_at = ?, updated_at = datetime('now') WHERE id = 1`
 ).bind(code, expiresAt).run()

 const adminEmail = c.get('adminEmail') || 'unknown'
 await db.prepare(
 `INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source)
 VALUES ('telegram_link_code_generated', 'store', '1', ?, ?, 'admin')`
 ).bind(JSON.stringify({ code, expiresAt }), adminEmail).run()

 return c.json({
 code,
 expiresAt,
 expiresInMinutes: 10,
 instructions: `Envía este comando a tu bot de Telegram:\n/link ${code}`,
 })
})

// GET /api/admin/telegram/status - Verificar estado de vinculación
app.get('/telegram/status', adminAuth, async (c) => {
 const result = await c.env.DB.prepare(
 `SELECT telegram_owner_id FROM store_config WHERE id = 1`
 ).first()

 const ownerId = (result as any)?.telegram_owner_id

 return c.json({
 linked: !!ownerId,
 ownerId: ownerId || null,
 })
})

// ============================================
// CRUD Productos (protegido)
// ============================================

// POST /api/admin/products - Crear producto
app.post('/products', adminAuth, async (c) => {
 const body = await c.req.json().catch(() => null)
 if (!body || !body.sku || !body.name) {
 return c.json({ error: 'SKU and name are required' }, 400)
 }

 try {
 const product = await createCatalogProduct(c.env.DB, body, {
 actor: c.get('adminEmail') || 'unknown', source: 'admin',
 })
 return c.json(product, 201)
 } catch (error) {
 if (error instanceof Error && error.message === 'SKU_ALREADY_EXISTS') return c.json({ error: 'SKU already exists' }, 409)
 throw error
 }
})

// PUT /api/admin/products/:id - Actualizar producto
app.put('/products/:id', adminAuth, async (c) => {
 const id = parseInt(c.req.param('id'))
 const body = await c.req.json().catch(() => null)
 if (!body || isNaN(id)) {
 return c.json({ error: 'Invalid request' }, 400)
 }

 const updated = await updateCatalogProduct(c.env.DB, { id }, body as Record<string, unknown>, {
 actor: c.get('adminEmail') || 'unknown', source: 'admin',
 })
 if (!updated) {
 return c.json({ error: 'No valid fields to update' }, 400)
 }
 return c.json({ success: true, id })
})

// DELETE /api/admin/products/:id - Archivar producto (soft delete)
app.delete('/products/:id', adminAuth, async (c) => {
 const id = parseInt(c.req.param('id'))
 if (isNaN(id)) return c.json({ error: 'Invalid ID' }, 400)

 await c.env.DB.prepare(
 `UPDATE products SET is_archived = 1, is_active = 0, updated_at = datetime('now') WHERE id = ?`
 ).bind(id).run()

 const adminEmail = c.get('adminEmail') || 'unknown'
 await c.env.DB.prepare(
 `INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source)
 VALUES ('product_archived', 'product', ?, '{}', ?, 'admin')`
 ).bind(String(id), adminEmail).run()

 return c.json({ success: true, archived: id })
})

// ============================================
// CRUD Categorías (protegido)
// ============================================

// POST /api/admin/categories - Crear categoría
app.post('/categories', adminAuth, async (c) => {
 const body = await c.req.json().catch(() => null)
 if (!body || !body.name || !body.slug) {
 return c.json({ error: 'Name and slug are required' }, 400)
 }

 try {
 const category = await createCatalogCategory(c.env.DB, body, {
 actor: c.get('adminEmail') || 'unknown', source: 'admin',
 })
 return c.json(category, 201)
 } catch (error) {
 if (error instanceof Error && error.message === 'CATEGORY_SLUG_EXISTS') return c.json({ error: 'Slug already exists' }, 409)
 throw error
 }
})

// DELETE /api/admin/categories/:id - Desactivar categoría
app.put('/categories/:id', adminAuth, async (c) => {
 const id = Number(c.req.param('id'))
 const body = await c.req.json().catch(() => null) as { name?: string; slug?: string } | null
 const name = typeof body?.name === 'string' ? body.name.trim() : ''
 const slug = typeof body?.slug === 'string' ? body.slug.trim() : ''
 if (!Number.isInteger(id) || id <= 0 || !name || !slug) return c.json({ error: 'Valid category name and slug are required' }, 400)
 try {
 await updateCatalogCategory(c.env.DB, id, { name, slug }, { actor: c.get('adminEmail') || 'unknown', source: 'admin' })
 } catch (error) {
 if (error instanceof Error && error.message === 'CATEGORY_NOT_FOUND') return c.json({ error: 'Category not found' }, 404)
 if (error instanceof Error && error.message === 'CATEGORY_SLUG_EXISTS') return c.json({ error: 'Slug already exists' }, 409)
 throw error
 }
 return c.json({ success: true, id, slug })
})

app.delete('/categories/:id', adminAuth, async (c) => {
 const id = parseInt(c.req.param('id'))
 if (isNaN(id)) return c.json({ error: 'Invalid ID' }, 400)
 await deactivateCatalogCategory(c.env.DB, id, { actor: c.get('adminEmail') || 'unknown', source: 'admin' })
 return c.json({ success: true, deactivated: id })
})

app.put('/products/:id/variants', adminAuth, async (c) => {
  const id = parseInt(c.req.param('id'))
  const body = await c.req.json().catch(() => null)
  if (!body?.variants || isNaN(id)) return c.json({ error: 'Invalid request' }, 400)
  const updates = body.variants as Array<{ id: number; stock: number }>
  const variants = await c.env.DB.prepare('SELECT id FROM product_variants WHERE product_id = ?').bind(id).all<{ id: number }>()
  const ownedIds = new Set((variants.results || []).map((variant) => variant.id))
  if (updates.some((variant) => !ownedIds.has(variant.id) || !Number.isInteger(variant.stock) || variant.stock < 0)) {
    return c.json({ error: 'Invalid variant or stock value' }, 400)
  }
  await updateVariantStocksById(c.env.DB, updates, {
    actor: c.get('adminEmail') || 'unknown', source: 'admin',
  }, { productId: id, variants: updates })
  return c.json({ success: true })
})

app.post('/products/:id/restore', adminAuth, async (c) => {
  const id = parseInt(c.req.param('id'))
  await c.env.DB.prepare(`UPDATE products SET is_archived = 0, is_active = 1, updated_at = datetime('now') WHERE id = ?`).bind(id).run()
  return c.json({ success: true, id })
})

export default app
