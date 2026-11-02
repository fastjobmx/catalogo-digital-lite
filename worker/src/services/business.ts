export type BusinessSource = 'admin' | 'telegram'

type AuditContext = { actor: string; source: BusinessSource }
const ASSET_FOLDERS = new Set(['products', 'store', 'categories', 'campaigns'])

export async function uploadStoreImage(
  bucket: R2Bucket,
  file: File,
  requestedFolder: string,
): Promise<{ key: string; size: number; type: string }> {
  const folder = ASSET_FOLDERS.has(requestedFolder) ? requestedFolder : 'products'
  const extension = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
  const key = `${folder}/${Date.now()}-${crypto.randomUUID()}.${extension}`
  await bucket.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type },
    customMetadata: { originalName: file.name, uploadedAt: new Date().toISOString() },
  })
  return { key, size: file.size, type: file.type }
}

const STORE_CONFIG_FIELDS = new Set([
  'name', 'description', 'slogan', 'business_type', 'logo_url', 'favicon_url',
  'cover_image_url', 'primary_color', 'secondary_color', 'accent_color',
  'button_color', 'whatsapp_phone', 'whatsapp_orders', 'phone', 'email',
  'address', 'hours', 'instagram', 'facebook', 'tiktok', 'maps_url',
  'currency', 'country', 'delivery_methods', 'pickup_available',
  'payment_info', 'default_whatsapp_message', 'theme_config',
])

export async function recordBusinessAction(
  db: D1Database,
  action: string,
  entityType: string,
  entityId: string,
  payload: unknown,
  context: AuditContext,
): Promise<void> {
  await db.prepare(
    'INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source) VALUES (?, ?, ?, ?, ?, ?)',
  ).bind(action, entityType, entityId, JSON.stringify(payload), context.actor, context.source).run()
}

export async function createCatalogProduct(
  db: D1Database,
  product: {
    sku: string
    name: string
    description?: string
    brand?: string | null
    categoryId?: number | null
    price: number
    compareAtPrice?: number | null
    isFeatured?: boolean
    imageUrls?: string[]
    variants?: Array<{ sku?: string; name?: string; size?: string | null; color?: string | null; priceOverride?: number | null; stock: number; sortOrder?: number }>
  },
  context: AuditContext,
): Promise<{ id: number; sku: string }> {
  const existing = await db.prepare('SELECT id FROM products WHERE sku = ?').bind(product.sku).first()
  if (existing) throw new Error('SKU_ALREADY_EXISTS')

  const result = await db.prepare(
    `INSERT INTO products (sku, name, description, brand, category_id, price, compare_at_price, is_featured, image_urls)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    product.sku, product.name, product.description || '', product.brand || null,
    product.categoryId ?? null, product.price, product.compareAtPrice ?? null,
    product.isFeatured ? 1 : 0, JSON.stringify(product.imageUrls || []),
  ).run()
  const id = Number(result.meta.last_row_id)
  const variants = product.variants || []
  if (variants.length) {
    await db.batch(variants.map((variant, index) => db.prepare(
      `INSERT INTO product_variants (product_id, sku, name, size, color, price_override, stock, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id, variant.sku || `${product.sku}-${index + 1}`, variant.name || variant.size || '',
      variant.size || null, variant.color || null, variant.priceOverride ?? null,
      variant.stock, variant.sortOrder ?? index,
    )))
  }
  await recordBusinessAction(db, 'product_created', 'product', String(id), { sku: product.sku }, context)
  return { id, sku: product.sku }
}

export async function createCatalogCategory(
  db: D1Database,
  category: { name: string; slug: string; description?: string; sortOrder?: number },
  context: AuditContext,
): Promise<{ id: number; slug: string }> {
  const existing = await db.prepare('SELECT id FROM categories WHERE slug = ?').bind(category.slug).first()
  if (existing) throw new Error('CATEGORY_SLUG_EXISTS')
  const result = await db.prepare(
    'INSERT INTO categories (name, slug, description, sort_order) VALUES (?, ?, ?, ?)',
  ).bind(category.name, category.slug, category.description || '', category.sortOrder ?? 0).run()
  const id = Number(result.meta.last_row_id)
  await recordBusinessAction(db, 'category_created', 'category', String(id), { slug: category.slug }, context)
  return { id, slug: category.slug }
}

export async function updateCatalogCategory(
  db: D1Database,
  id: number,
  fields: { name: string; slug?: string },
  context: AuditContext,
): Promise<void> {
  const current = await db.prepare('SELECT id, slug FROM categories WHERE id = ? AND is_active = 1').bind(id).first() as { id: number; slug: string } | null
  if (!current) throw new Error('CATEGORY_NOT_FOUND')
  const slug = fields.slug ?? current.slug
  const duplicate = await db.prepare('SELECT id FROM categories WHERE slug = ? AND id != ?').bind(slug, id).first()
  if (duplicate) throw new Error('CATEGORY_SLUG_EXISTS')
  await db.prepare("UPDATE categories SET name = ?, slug = ?, updated_at = datetime('now') WHERE id = ?").bind(fields.name, slug, id).run()
  await recordBusinessAction(db, 'category_updated', 'category', String(id), { name: fields.name, slug }, context)
}

export async function deactivateCatalogCategory(db: D1Database, id: number, context: AuditContext): Promise<boolean> {
  const result = await db.prepare("UPDATE categories SET is_active = 0, updated_at = datetime('now') WHERE id = ? AND is_active = 1").bind(id).run()
  if (!result.meta.changes) return false
  await recordBusinessAction(db, 'category_deactivated', 'category', String(id), {}, context)
  return true
}

export async function updateStoreConfiguration(
  db: D1Database,
  fields: Record<string, unknown>,
  context: AuditContext,
): Promise<number> {
  const entries = Object.entries(fields).filter(([key]) => STORE_CONFIG_FIELDS.has(key))
  if (!entries.length) return 0
  const updates = entries.map(([key]) => `${key} = ?`)
  const values = entries.map(([, value]) => value)
  updates.push("updated_at = datetime('now')")
  await db.prepare(`UPDATE store_config SET ${updates.join(', ')} WHERE id = 1`).bind(...values).run()
  await recordBusinessAction(db, 'store_updated', 'store', '1', fields, context)
  return entries.length
}

export async function updateProductPrice(
  db: D1Database,
  sku: string,
  price: number,
  context: AuditContext,
): Promise<boolean> {
  return updateCatalogProduct(db, { sku }, { price }, context)
}

export async function updateCatalogProduct(
  db: D1Database,
  selector: { id?: number; sku?: string },
  fields: Record<string, unknown>,
  context: AuditContext,
): Promise<boolean> {
  const columnByField: Record<string, string> = {
    name: 'name', description: 'description', brand: 'brand', categoryId: 'category_id',
    price: 'price', compareAtPrice: 'compare_at_price', isFeatured: 'is_featured',
    imageUrls: 'image_urls', isActive: 'is_active',
    category_id: 'category_id', compare_at_price: 'compare_at_price',
    is_featured: 'is_featured', image_urls: 'image_urls', is_active: 'is_active',
  }
  const entries = Object.entries(fields).filter(([key]) => key in columnByField)
  if (!entries.length || (!selector.id && !selector.sku)) return false
  const updates = entries.map(([key]) => `${columnByField[key]} = ?`)
  const values = entries.map(([key, value]) => {
    if ((key === 'imageUrls' || key === 'image_urls') && Array.isArray(value)) return JSON.stringify(value)
    if (['isFeatured', 'isActive', 'is_featured', 'is_active'].includes(key) && typeof value === 'boolean') return value ? 1 : 0
    return value
  })
  updates.push("updated_at = datetime('now')")
  const byId = selector.id !== undefined
  values.push(byId ? selector.id : selector.sku)
  const result = await db.prepare(`UPDATE products SET ${updates.join(', ')} WHERE ${byId ? 'id' : 'sku'} = ? AND is_archived = 0`).bind(...values).run()
  if (!result.meta.changes) return false
  const entityId = String(selector.id ?? selector.sku)
  await recordBusinessAction(db, 'product_updated', 'product', entityId, fields, context)
  return true
}

export async function updateProductInventory(
  db: D1Database,
  sku: string,
  stock: number,
  context: AuditContext,
  size?: string,
): Promise<number> {
  const variants = size
    ? await db.prepare(`SELECT v.id FROM product_variants v JOIN products p ON p.id = v.product_id
        WHERE p.sku = ? AND p.is_archived = 0 AND (v.sku = ? OR v.size = ?)`)
      .bind(sku, `${sku}-${size}`, size).all<{ id: number }>()
    : await db.prepare(`SELECT v.id FROM product_variants v JOIN products p ON p.id = v.product_id
        WHERE p.sku = ? AND p.is_archived = 0`).bind(sku).all<{ id: number }>()
  const updates = (variants.results || []).map((variant) => ({ id: variant.id, stock }))
  return updateVariantStocksById(db, updates, context, { sku, size })
}

export async function updateVariantStocksById(
  db: D1Database,
  updates: Array<{ id: number; stock: number }>,
  context: AuditContext,
  auditDetails: unknown = updates,
): Promise<number> {
  if (updates.some((item) => !Number.isInteger(item.stock) || item.stock < 0)) throw new Error('INVALID_STOCK')
  if (!updates.length) return 0
  const results = await db.batch(updates.map((item) => db.prepare(
    "UPDATE product_variants SET stock = ?, updated_at = datetime('now') WHERE id = ?",
  ).bind(item.stock, item.id)))
  const changes = results.reduce((total, result) => total + Number(result.meta.changes || 0), 0)
  if (changes) await recordBusinessAction(db, 'inventory_updated', 'variant', 'multiple', auditDetails, context)
  return changes
}

export type ConfirmedCatalogMutation = {
  operationId: string
  chatId: string
  actor: string
  action: 'update_price' | 'update_stock'
  params: { sku: string; price?: number; stock?: number; size?: string }
  before: Record<string, unknown>
  beforeJson: string
  after: unknown
}

export async function applyConfirmedCatalogMutation(
  db: D1Database,
  operation: ConfirmedCatalogMutation,
): Promise<'applied' | 'stale' | 'expired' | 'not_pending'> {
  const { operationId, chatId, actor, action, params, before, beforeJson, after } = operation
  const executionToken = crypto.randomUUID()
  const sku = params.sku
  const variants = parseExpectedVariants(before.variants)
  const fields: Array<[string, unknown]> = [
    ['sku', before.sku], ['name', before.name], ['price', before.price],
    ['description', before.description], ['brand', before.brand],
    ['category_id', before.category_id], ['is_featured', before.is_featured],
    ['is_active', before.is_active], ['is_archived', before.is_archived],
  ]
  const productConditions = fields.map(([column]) => `p.${column} IS ?`)
  productConditions.push('p.is_active = 1', 'p.is_archived = 0')
  const productBindings = fields.map(([, value]) => value)
  productConditions.push(`(SELECT COUNT(*) FROM product_variants v WHERE v.product_id = p.id) = ?`)
  productBindings.push(variants.length)
  for (const variant of variants) {
    productConditions.push(`EXISTS (
      SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.id = ?
        AND v.sku IS ? AND v.size IS ? AND v.stock = ?
    )`)
    productBindings.push(variant.id, variant.sku, variant.size, variant.stock)
  }

  const claim = db.prepare(
    `UPDATE telegram_operations SET status = 'applying', execution_token = ?
     WHERE operation_id = ? AND chat_id = ? AND status = 'pending' AND expires_at > unixepoch()
       AND before_json = ?
       AND EXISTS (SELECT 1 FROM products p WHERE ${productConditions.join(' AND ')})`,
  ).bind(executionToken, operationId, chatId, beforeJson, ...productBindings)

  let mutation: D1PreparedStatement
  if (action === 'update_price') {
    if (!Number.isInteger(params.price) || Number(params.price) < 0) throw new Error('INVALID_PRICE')
    mutation = db.prepare(
      `UPDATE products SET price = ?, updated_at = datetime('now')
       WHERE sku = ? AND is_archived = 0
         AND EXISTS (SELECT 1 FROM telegram_operations WHERE operation_id = ? AND status = 'applying' AND execution_token = ?)`,
    ).bind(params.price, sku, operationId, executionToken)
  } else {
    if (!Number.isInteger(params.stock) || Number(params.stock) < 0) throw new Error('INVALID_STOCK')
    const targetVariants = variants.filter((variant) => !params.size || variant.sku === `${sku}-${params.size}` || variant.size === params.size)
    if (!targetVariants.length) return 'stale'
    mutation = db.prepare(
      `UPDATE product_variants SET stock = ?, updated_at = datetime('now')
       WHERE id IN (${targetVariants.map(() => '?').join(', ')})
         AND product_id = (SELECT id FROM products WHERE sku = ? AND is_archived = 0)
         AND EXISTS (SELECT 1 FROM telegram_operations WHERE operation_id = ? AND status = 'applying' AND execution_token = ?)`,
    ).bind(params.stock, ...targetVariants.map((variant) => variant.id), sku, operationId, executionToken)
  }

  const audit = db.prepare(
    `INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source)
     SELECT ?, ?, ?, ?, ?, 'telegram'
     WHERE EXISTS (SELECT 1 FROM telegram_operations WHERE operation_id = ? AND status = 'applying' AND execution_token = ?)`,
  ).bind(action, action === 'update_stock' ? 'variant' : 'product', sku,
    JSON.stringify({ operationId, before, after }), actor, operationId, executionToken)
  const complete = db.prepare(
    `UPDATE telegram_operations SET status = 'applied', execution_token = NULL, completed_at = datetime('now')
     WHERE operation_id = ? AND chat_id = ? AND status = 'applying' AND execution_token = ?`,
  ).bind(operationId, chatId, executionToken)
  const results = await db.batch([claim, mutation, audit, complete])
  if (Number(results[0]?.meta.changes || 0) === 1) return 'applied'

  const current = await db.prepare(
    `UPDATE telegram_operations SET
       status = CASE WHEN expires_at <= unixepoch() THEN 'expired' ELSE 'stale' END,
       completed_at = datetime('now')
     WHERE operation_id = ? AND chat_id = ? AND status = 'pending'
     RETURNING status`,
  ).bind(operationId, chatId).first<{ status: 'stale' | 'expired' }>()
  return current?.status || 'not_pending'
}

function parseExpectedVariants(value: unknown): Array<{ id: number; sku: string; size: string | null; stock: number }> {
  let parsed: unknown
  try { parsed = typeof value === 'string' ? JSON.parse(value) : value } catch { throw new Error('INVALID_VARIANT_SNAPSHOT') }
  if (!Array.isArray(parsed)) throw new Error('INVALID_VARIANT_SNAPSHOT')
  return parsed.map((item) => {
    if (!item || !Number.isInteger(item.id) || typeof item.sku !== 'string' || !Number.isInteger(item.stock)) throw new Error('INVALID_VARIANT_SNAPSHOT')
    return { id: item.id as number, sku: item.sku as string, size: item.size == null ? null : String(item.size), stock: item.stock as number }
  })
}
