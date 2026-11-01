import { Hono } from 'hono'
import type { Env } from '../index'
import { adminAuth } from '../middleware/auth'
import { createAdminToken, validateCredentials, getJwtSecret } from '../services/auth'
import { normalizeStoreBody } from '../lib/storeMap'

const app = new Hono<Env>()

// POST /api/admin/login - Autenticación con JWT real
app.post('/login', async (c) => {
 const body = await c.req.json().catch(() => null)
 const email = body?.email as string | undefined
 const password = body?.password as string | undefined

 if (!email || !password) {
 return c.json({ error: 'Email and password required' }, 400)
 }

 const isValid = await validateCredentials(email, password, c.env)
 if (!isValid) {
 return c.json({ error: 'Invalid credentials' }, 401)
 }

 const secret = getJwtSecret(c.env)
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

 const db = c.env.DB
 const allowedFields = [
 'name', 'description', 'slogan', 'business_type', 'logo_url', 'favicon_url',
 'cover_image_url', 'primary_color', 'secondary_color', 'accent_color',
 'button_color', 'whatsapp_phone', 'whatsapp_orders', 'phone', 'email',
 'address', 'hours', 'instagram', 'facebook', 'tiktok', 'maps_url',
 'currency', 'country', 'delivery_methods', 'pickup_available',
 'payment_info', 'default_whatsapp_message', 'theme_config',
 ]

 const normalized = normalizeStoreBody(body as Record<string, unknown>)
 const updates: string[] = []
 const values: any[] = []

 for (const field of allowedFields) {
 if (field in normalized) {
 updates.push(`${field} = ?`)
 values.push(normalized[field])
 }
 }

 if (updates.length === 0) {
 return c.json({ error: 'No valid fields to update' }, 400)
 }

 updates.push("updated_at = datetime('now')")
 values.push(1)

 await db.prepare(
 `UPDATE store_config SET ${updates.join(', ')} WHERE id = ?`
 ).bind(...values).run()

 const adminEmail = c.get('adminEmail') || 'unknown'
 await db.prepare(
 `INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source)
 VALUES ('store_updated', 'store', '1', ?, ?, 'admin')`
 ).bind(JSON.stringify(body), adminEmail).run()

 return c.json({ success: true, updated: updates.length - 1 })
})

// ============================================
// Telegram Linking (Onboarding)
// ============================================

// POST /api/admin/telegram/link-code - Generar código de vinculación temporal
app.post('/telegram/link-code', adminAuth, async (c) => {
 const db = c.env.DB

 // Generate a 6-character alphanumeric code
 const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // No ambiguous chars (0/O, 1/I)
 let code = ''
 for (let i = 0; i < 6; i++) {
 code += chars[Math.floor(Math.random() * chars.length)]
 }

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

 const db = c.env.DB

 // Verificar SKU único
 const existing = await db.prepare('SELECT id FROM products WHERE sku = ?').bind(body.sku).first()
 if (existing) {
 return c.json({ error: 'SKU already exists' }, 409)
 }

 const result = await db.prepare(`
 INSERT INTO products (sku, name, description, brand, category_id, price, compare_at_price, is_featured, image_urls)
 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
 `).bind(
 body.sku,
 body.name,
 body.description || '',
 body.brand || null,
 body.categoryId || null,
 body.price || 0,
 body.compareAtPrice || null,
 body.isFeatured ? 1 : 0,
 JSON.stringify(body.imageUrls || [])
 ).run()

 const productId = result.meta.last_row_id as number

 // Insertar variantes si se proporcionan
 if (body.variants && Array.isArray(body.variants)) {
 for (let i = 0; i < body.variants.length; i++) {
 const v = body.variants[i]
 await db.prepare(`
 INSERT INTO product_variants (product_id, sku, name, size, color, price_override, stock, sort_order)
 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
 `).bind(
 productId,
 v.sku || `${body.sku}-${i + 1}`,
 v.name || '',
 v.size || null,
 v.color || null,
 v.priceOverride || null,
 v.stock || 0,
 v.sortOrder || i
 ).run()
 }
 }

 const adminEmail = c.get('adminEmail') || 'unknown'
 await db.prepare(
 `INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source)
 VALUES ('product_created', 'product', ?, ?, ?, 'admin')`
 ).bind(String(productId), JSON.stringify({ sku: body.sku }), adminEmail).run()

 return c.json({ id: productId, sku: body.sku }, 201)
})

// PUT /api/admin/products/:id - Actualizar producto
app.put('/products/:id', adminAuth, async (c) => {
 const id = parseInt(c.req.param('id'))
 const body = await c.req.json().catch(() => null)
 if (!body || isNaN(id)) {
 return c.json({ error: 'Invalid request' }, 400)
 }

 const db = c.env.DB
 const allowedFields = ['name', 'description', 'brand', 'category_id', 'price', 'compare_at_price', 'is_featured', 'image_urls', 'is_active']
 const updates: string[] = []
 const values: any[] = []

 for (const field of allowedFields) {
 if (field in body) {
 const snakeField = field.replace(/([A-Z])/g, '_$1').toLowerCase()
 updates.push(`${snakeField} = ?`)
 let val = body[field]
 if (field === 'image_urls' && Array.isArray(val)) val = JSON.stringify(val)
 if (field === 'is_featured' || field === 'is_active') val = val ? 1 : 0
 values.push(val)
 }
 }

 if (updates.length === 0) {
 return c.json({ error: 'No valid fields to update' }, 400)
 }

 updates.push("updated_at = datetime('now')")
 values.push(id)

 await db.prepare(`UPDATE products SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run()

 const adminEmail = c.get('adminEmail') || 'unknown'
 await db.prepare(
 `INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source)
 VALUES ('product_updated', 'product', ?, ?, ?, 'admin')`
 ).bind(String(id), JSON.stringify(body), adminEmail).run()

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

 const db = c.env.DB
 const existing = await db.prepare('SELECT id FROM categories WHERE slug = ?').bind(body.slug).first()
 if (existing) {
 return c.json({ error: 'Slug already exists' }, 409)
 }

 const result = await db.prepare(
 `INSERT INTO categories (name, slug, description, sort_order) VALUES (?, ?, ?, ?)`
 ).bind(body.name, body.slug, body.description || '', body.sortOrder || 0).run()

 const adminEmail = c.get('adminEmail') || 'unknown'
 await db.prepare(
 `INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source)
 VALUES ('category_created', 'category', ?, ?, ?, 'admin')`
 ).bind(String(result.meta.last_row_id), JSON.stringify({ slug: body.slug }), adminEmail).run()

 return c.json({ id: result.meta.last_row_id, slug: body.slug }, 201)
})

// DELETE /api/admin/categories/:id - Desactivar categoría
app.put('/categories/:id', adminAuth, async (c) => {
 const id = Number(c.req.param('id'))
 const body = await c.req.json().catch(() => null) as { name?: string; slug?: string } | null
 const name = typeof body?.name === 'string' ? body.name.trim() : ''
 const slug = typeof body?.slug === 'string' ? body.slug.trim() : ''
 if (!Number.isInteger(id) || id <= 0 || !name || !slug) return c.json({ error: 'Valid category name and slug are required' }, 400)
 const db = c.env.DB
 const current = await db.prepare('SELECT id FROM categories WHERE id = ? AND is_active = 1').bind(id).first()
 if (!current) return c.json({ error: 'Category not found' }, 404)
 const duplicate = await db.prepare('SELECT id FROM categories WHERE slug = ? AND id != ?').bind(slug, id).first()
 if (duplicate) return c.json({ error: 'Slug already exists' }, 409)
 await db.prepare("UPDATE categories SET name = ?, slug = ?, updated_at = datetime('now') WHERE id = ?").bind(name, slug, id).run()
 const adminEmail = c.get('adminEmail') || 'unknown'
 await db.prepare(`INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source) VALUES ('category_updated', 'category', ?, ?, ?, 'admin')`).bind(String(id), JSON.stringify({ name, slug }), adminEmail).run()
 return c.json({ success: true, id, slug })
})

app.delete('/categories/:id', adminAuth, async (c) => {
 const id = parseInt(c.req.param('id'))
 if (isNaN(id)) return c.json({ error: 'Invalid ID' }, 400)

 await c.env.DB.prepare(
 `UPDATE categories SET is_active = 0, updated_at = datetime('now') WHERE id = ?`
 ).bind(id).run()

 const adminEmail = c.get('adminEmail') || 'unknown'
 await c.env.DB.prepare(
 `INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source)
 VALUES ('category_deactivated', 'category', ?, '{}', ?, 'admin')`
 ).bind(String(id), adminEmail).run()

 return c.json({ success: true, deactivated: id })
})

app.put('/products/:id/variants', adminAuth, async (c) => {
  const id = parseInt(c.req.param('id'))
  const body = await c.req.json().catch(() => null)
  if (!body?.variants || isNaN(id)) return c.json({ error: 'Invalid request' }, 400)
  const db = c.env.DB
  const statements = (body.variants as Array<{ id: number; stock: number }>).map((v) =>
    db.prepare('UPDATE product_variants SET stock = ?, updated_at = datetime(\'now\') WHERE id = ? AND product_id = ?').bind(v.stock, v.id, id),
  )
  await db.batch(statements)
  return c.json({ success: true })
})

app.post('/products/:id/restore', adminAuth, async (c) => {
  const id = parseInt(c.req.param('id'))
  await c.env.DB.prepare(`UPDATE products SET is_archived = 0, is_active = 1, updated_at = datetime('now') WHERE id = ?`).bind(id).run()
  return c.json({ success: true, id })
})

export default app
