import { storeAssetPrefix } from '../lib/assets'
import { TEMPLATE_KEYS, type TemplateKey } from './templates'

export type BusinessSource = 'admin' | 'telegram' | 'platform' | 'system'

/** Every business operation runs inside exactly one store. */
export type AuditContext = { actor: string; source: BusinessSource; storeId: number }
const ASSET_FOLDERS = new Set(['products', 'store', 'categories', 'campaigns'])

export async function uploadStoreImage(
  bucket: R2Bucket,
  file: File,
  requestedFolder: string,
  storeId: number,
): Promise<{ key: string; size: number; type: string }> {
  const folder = ASSET_FOLDERS.has(requestedFolder) ? requestedFolder : 'products'
  const extension = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
  const key = `${storeAssetPrefix(storeId)}${folder}/${Date.now()}-${crypto.randomUUID()}.${extension}`
  await bucket.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type },
    customMetadata: { originalName: file.name, uploadedAt: new Date().toISOString(), storeId: String(storeId) },
  })
  return { key, size: file.size, type: file.type }
}

export const STORE_CONFIG_FIELDS = new Set([
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
    'INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).bind(action, entityType, entityId, JSON.stringify(payload), context.actor, context.source, context.storeId).run()
}

async function assertCategoryInStore(db: D1Database, categoryId: unknown, storeId: number): Promise<void> {
  if (categoryId === null || categoryId === undefined || categoryId === '') return
  const id = Number(categoryId)
  const row = Number.isSafeInteger(id)
    ? await db.prepare('SELECT id FROM categories WHERE id = ? AND store_id = ?').bind(id, storeId).first()
    : null
  if (!row) throw new Error('CATEGORY_NOT_FOUND')
}

/** Active (non-archived) products against the store plan's max_products. */
export async function productLimit(db: D1Database, storeId: number): Promise<{ count: number; max: number | null; plan: string | null }> {
  const row = await db.prepare(
    `SELECT (SELECT COUNT(*) FROM products WHERE store_id = s.id AND is_archived = 0) AS count, p.max_products AS max, p.name AS plan
     FROM stores s LEFT JOIN plans p ON p.code = s.plan_code WHERE s.id = ?`,
  ).bind(storeId).first<{ count: number; max: number | null; plan: string | null }>()
  return { count: Number(row?.count || 0), max: row?.max ?? null, plan: row?.plan ?? null }
}

export async function createCatalogProduct(
  db: D1Database,
  product: CatalogProductInput,
  context: AuditContext,
): Promise<{ id: number; sku: string }> {
  const existing = await db.prepare('SELECT id FROM products WHERE store_id = ? AND sku = ?').bind(context.storeId, product.sku).first()
  if (existing) throw new Error('SKU_ALREADY_EXISTS')
  const limit = await productLimit(db, context.storeId)
  if (limit.max !== null && limit.count >= limit.max) throw new Error('PLAN_PRODUCT_LIMIT')
  await assertCategoryInStore(db, product.categoryId, context.storeId)
  const statements = buildCatalogProductStatements(db, product, context, { sku: product.sku })
  let results: D1Result[]
  try {
    results = await db.batch(statements)
  } catch (error) {
    if (error instanceof Error && /unique constraint/i.test(error.message)) throw new Error('SKU_ALREADY_EXISTS')
    throw error
  }
  const id = Number(results[0]?.meta.last_row_id)
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('PRODUCT_CREATE_FAILED')
  return { id, sku: product.sku }
}

export type CatalogProductInput = {
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
}

/** Shared product/variant/audit SQL used by the admin service and Telegram's guarded transaction. */
function buildCatalogProductStatements(
  db: D1Database,
  product: CatalogProductInput,
  context: AuditContext,
  guard: { sku: string; operationId?: string; executionToken?: string; chatId?: string; paramsJson?: string; beforeJson?: string; afterJson?: string; batchId?: string; batchItemId?: number; telegramUserId?: string; maxProducts?: number | null; auditPayload?: unknown },
): D1PreparedStatement[] {
  const guarded = Boolean(guard.operationId && guard.executionToken && guard.chatId && guard.paramsJson !== undefined && guard.beforeJson !== undefined && guard.afterJson !== undefined)
  const batchGuarded = Boolean(guard.batchId && guard.batchItemId && guard.chatId && guard.telegramUserId)
  const gate = guarded
    ? `EXISTS (SELECT 1 FROM telegram_operations WHERE operation_id = ? AND chat_id = ? AND store_id = ? AND status = 'applying' AND execution_token = ? AND params_json = ? AND before_json = ? AND after_json = ?)`
    : batchGuarded
      ? `EXISTS (SELECT 1 FROM telegram_product_batch_items i JOIN telegram_product_batches b ON b.id = i.batch_id
                WHERE i.id = ? AND i.batch_id = ? AND i.store_id = ? AND i.status = 'publishing' AND i.sku = ? AND i.product_id IS NULL
                  AND b.store_id = i.store_id AND b.chat_id = ? AND b.telegram_user_id = ? AND b.status = 'publishing'
                  AND EXISTS (SELECT 1 FROM stores s WHERE s.id = i.store_id AND s.telegram_bulk_import_enabled = 1))`
      : '1 = 1'
  const gateBindings = guarded
    ? [guard.operationId, guard.chatId, context.storeId, guard.executionToken, guard.paramsJson, guard.beforeJson, guard.afterJson]
    : batchGuarded
      ? [guard.batchItemId, guard.batchId, context.storeId, product.sku, guard.chatId, guard.telegramUserId]
      : []
  // The batch path checks max_products inside the INSERT statement so two storeside imports cannot
  // both observe the same last slot and publish beyond the plan concurrently.
  const productLimitSql = batchGuarded && guard.maxProducts !== null && guard.maxProducts !== undefined
    ? ' AND (SELECT COUNT(*) FROM products WHERE store_id = ?) < ?'
    : ''
  const productLimitBindings = productLimitSql ? [context.storeId, guard.maxProducts] : []
  const statements: D1PreparedStatement[] = [db.prepare(
    `INSERT INTO products (store_id, sku, name, description, brand, category_id, price, compare_at_price, is_featured, image_urls, is_active, is_archived)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0 WHERE ${gate}${productLimitSql}`,
  ).bind(
    context.storeId, product.sku, product.name, product.description || '', product.brand || null,
    product.categoryId ?? null, product.price, product.compareAtPrice ?? null,
    product.isFeatured ? 1 : 0, JSON.stringify(product.imageUrls || []), ...gateBindings, ...productLimitBindings,
  )]
  for (const [index, variant] of (product.variants || []).entries()) {
    statements.push(db.prepare(
      `INSERT INTO product_variants (product_id, sku, name, size, color, price_override, stock, sort_order)
       SELECT (SELECT id FROM products WHERE store_id = ? AND sku = ?), ?, ?, ?, ?, ?, ?, ? WHERE ${gate}`,
    ).bind(
      context.storeId, product.sku, variant.sku || `${product.sku}-${index + 1}`, variant.name || variant.size || '',
      variant.size || null, variant.color || null, variant.priceOverride ?? null,
      variant.stock, variant.sortOrder ?? index, ...gateBindings,
    ))
  }
  statements.push(db.prepare(
    `INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id)
     SELECT 'product_created', 'product', CAST(p.id AS TEXT), ?, ?, ?, p.store_id FROM products p
     WHERE p.store_id = ? AND p.sku = ? AND ${gate}`,
  ).bind(JSON.stringify(guard.auditPayload ?? { sku: product.sku }), context.actor, context.source, context.storeId, product.sku, ...gateBindings))
  return statements
}

/** Idempotent Telegram batch creation through the same catalogue insert/audit statements as panel and individual Telegram products. */
export async function applyTelegramProductBatchItem(
  db: D1Database,
  input: { batchId: string; itemId: number; chatId: string; telegramUserId: string; storeId: number; actor: string; product: CatalogProductInput },
): Promise<{ id: number; sku: string }> {
  const { batchId, itemId, chatId, telegramUserId, storeId, product } = input
  await assertCategoryInStore(db, product.categoryId, storeId)
  const limit = await productLimit(db, storeId)
  if (limit.max !== null && limit.count >= limit.max) throw new Error('PLAN_PRODUCT_LIMIT')
  const context: AuditContext = { actor: input.actor, source: 'telegram', storeId }
  const statements = buildCatalogProductStatements(db, product, context, {
    sku: product.sku, batchId, batchItemId: itemId, chatId, telegramUserId, maxProducts: limit.max,
    auditPayload: { batchId, batchItemId: itemId, sku: product.sku, imageCount: product.imageUrls?.length || 0 },
  })
  statements.push(db.prepare(
    `UPDATE telegram_product_batch_items SET status = 'published', product_id = (SELECT id FROM products WHERE store_id = ? AND sku = ?), category_id = ?, updated_at = datetime('now')
     WHERE id = ? AND batch_id = ? AND store_id = ? AND status = 'publishing' AND sku = ? AND product_id IS NULL
       AND EXISTS (SELECT 1 FROM telegram_product_batches WHERE id = ? AND store_id = ? AND chat_id = ? AND telegram_user_id = ? AND status = 'publishing')
       AND EXISTS (SELECT 1 FROM products WHERE store_id = ? AND sku = ?)`
  ).bind(storeId, product.sku, product.categoryId ?? null, itemId, batchId, storeId, product.sku, batchId, storeId, chatId, telegramUserId, storeId, product.sku))
  let results: D1Result[]
  try {
    results = await db.batch(statements)
  } catch (error) {
    if (error instanceof Error && /unique constraint/i.test(error.message)) {
      const existing = await db.prepare('SELECT id FROM products WHERE store_id = ? AND upper(sku) = upper(?)').bind(storeId, product.sku).first()
      if (existing) throw new Error('SKU_ALREADY_EXISTS')
    }
    throw error
  }
  if (Number(results[0]?.meta.changes || 0) !== 1 || Number(results.at(-1)?.meta.changes || 0) !== 1) {
    const currentLimit = await productLimit(db, storeId)
    if (currentLimit.max !== null && currentLimit.count >= currentLimit.max) throw new Error('PLAN_PRODUCT_LIMIT')
    throw new Error('BATCH_ITEM_NOT_PUBLISHABLE')
  }
  const id = Number(results[0]?.meta.last_row_id)
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('PRODUCT_CREATE_FAILED')
  return { id, sku: product.sku }
}

export async function applyConfirmedTelegramProductCreation(
  db: D1Database,
  input: {
    operationId: string
    chatId: string
    storeId: number
    actor: string
    paramsJson: string
    beforeJson: string
    afterJson: string
    category: { id: number; name: string; slug: string }
    product: CatalogProductInput
  },
): Promise<'applied' | 'sku_exists' | 'stale' | 'expired' | 'not_pending'> {
  const executionToken = crypto.randomUUID()
  const { operationId, chatId, product, category, storeId } = input
  const claim = db.prepare(
    `UPDATE telegram_operations SET status = 'applying', execution_token = ?
     WHERE operation_id = ? AND chat_id = ? AND store_id = ? AND action = 'create_product'
       AND status = 'pending' AND expires_at > unixepoch()
       AND params_json = ? AND before_json = ? AND after_json = ?
       AND NOT EXISTS (SELECT 1 FROM products WHERE store_id = ? AND sku = ?)
       AND EXISTS (SELECT 1 FROM categories WHERE id = ? AND store_id = ? AND name = ? AND slug = ? AND is_active = 1)`,
  ).bind(executionToken, operationId, chatId, storeId, input.paramsJson, input.beforeJson, input.afterJson,
    storeId, product.sku, category.id, storeId, category.name, category.slug)
  const productStatements = buildCatalogProductStatements(db, product, { actor: input.actor, source: 'telegram', storeId }, {
    sku: product.sku, operationId, executionToken, chatId,
    paramsJson: input.paramsJson, beforeJson: input.beforeJson, afterJson: input.afterJson,
    auditPayload: { operationId, sku: product.sku, categoryId: category.id, imageCount: product.imageUrls?.length || 0 },
  })
  const complete = db.prepare(
    `UPDATE telegram_operations SET status = 'applied', execution_token = NULL, completed_at = datetime('now')
     WHERE operation_id = ? AND chat_id = ? AND status = 'applying' AND execution_token = ?
       AND EXISTS (SELECT 1 FROM products WHERE store_id = ? AND sku = ?)`,
  ).bind(operationId, chatId, executionToken, storeId, product.sku)

  let results: D1Result[]
  try {
    results = await db.batch([claim, ...productStatements, complete])
  } catch (error) {
    if (error instanceof Error && /unique constraint/i.test(error.message)) {
      const exists = await db.prepare('SELECT id FROM products WHERE store_id = ? AND sku = ?').bind(storeId, product.sku).first()
      if (exists) return 'sku_exists'
    }
    throw error
  }
  if (Number(results[0]?.meta.changes || 0) === 1) return 'applied'

  const operation = await db.prepare('SELECT status, expires_at FROM telegram_operations WHERE operation_id = ? AND chat_id = ?').bind(operationId, chatId).first<{ status: string; expires_at: number }>()
  if (!operation || operation.status !== 'pending') return 'not_pending'
  if (Number(operation.expires_at) <= Math.floor(Date.now() / 1000)) return 'expired'
  const exists = await db.prepare('SELECT id FROM products WHERE store_id = ? AND sku = ?').bind(storeId, product.sku).first()
  if (exists) return 'sku_exists'
  return 'stale'
}

export async function createCatalogCategory(
  db: D1Database,
  category: { name: string; slug: string; description?: string; sortOrder?: number },
  context: AuditContext,
): Promise<{ id: number; slug: string }> {
  const existing = await db.prepare('SELECT id FROM categories WHERE store_id = ? AND slug = ?').bind(context.storeId, category.slug).first()
  if (existing) throw new Error('CATEGORY_SLUG_EXISTS')
  let result: D1Result
  try {
    result = await db.prepare(
      'INSERT INTO categories (store_id, name, slug, description, sort_order) VALUES (?, ?, ?, ?, ?)',
    ).bind(context.storeId, category.name, category.slug, category.description || '', category.sortOrder ?? 0).run()
  } catch (error) {
    if (error instanceof Error && /unique constraint/i.test(error.message)) throw new Error('CATEGORY_SLUG_EXISTS')
    throw error
  }
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
  const current = await db.prepare('SELECT id, slug FROM categories WHERE id = ? AND store_id = ? AND is_active = 1').bind(id, context.storeId).first() as { id: number; slug: string } | null
  if (!current) throw new Error('CATEGORY_NOT_FOUND')
  const slug = fields.slug ?? current.slug
  const duplicate = await db.prepare('SELECT id FROM categories WHERE store_id = ? AND slug = ? AND id != ?').bind(context.storeId, slug, id).first()
  if (duplicate) throw new Error('CATEGORY_SLUG_EXISTS')
  await db.prepare("UPDATE categories SET name = ?, slug = ?, updated_at = datetime('now') WHERE id = ? AND store_id = ?").bind(fields.name, slug, id, context.storeId).run()
  await recordBusinessAction(db, 'category_updated', 'category', String(id), { name: fields.name, slug }, context)
}

export async function deactivateCatalogCategory(db: D1Database, id: number, context: AuditContext): Promise<boolean> {
  const result = await db.prepare("UPDATE categories SET is_active = 0, updated_at = datetime('now') WHERE id = ? AND store_id = ? AND is_active = 1").bind(id, context.storeId).run()
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
  const result = await db.prepare(`UPDATE store_config SET ${updates.join(', ')} WHERE id = ?`).bind(...values, context.storeId).run()
  if (!result.meta.changes) throw new Error('STORE_CONFIG_NOT_FOUND')
  if (typeof fields.name === 'string' && fields.name.trim()) {
    await db.prepare("UPDATE stores SET name = ?, updated_at = datetime('now') WHERE id = ?").bind(fields.name.trim(), context.storeId).run()
  }
  await recordBusinessAction(db, 'store_updated', 'store', String(context.storeId), fields, context)
  return entries.length
}

export async function updateStoreTemplate(db: D1Database, template: string, context: AuditContext): Promise<number> {
  if (!(TEMPLATE_KEYS as readonly string[]).includes(template)) throw new Error('INVALID_STORE_TEMPLATE')
  const result = await db.prepare("UPDATE stores SET template = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(template as TemplateKey, context.storeId).run()
  if (!result.meta.changes) throw new Error('STORE_NOT_FOUND')
  await recordBusinessAction(db, 'store_template_updated', 'store', String(context.storeId), { template }, context)
  return 1
}

/** Applies an owner-confirmed Telegram store change in one atomic D1 batch.
 * The store fields are restricted by STORE_CONFIG_FIELDS and compared to the
 * proposal snapshot to reject stale confirmations. */
export async function applyConfirmedStoreMutation(
  db: D1Database,
  input: {
    operationId: string
    chatId: string
    storeId: number
    actor: string
    before: Record<string, unknown>
    beforeJson: string
    after: Record<string, unknown>
    fields: Record<string, unknown>
  },
): Promise<'applied' | 'stale' | 'expired' | 'not_pending'> {
  const entries = Object.entries(input.fields).filter(([key]) => STORE_CONFIG_FIELDS.has(key))
  if (!entries.length || entries.length !== Object.keys(input.fields).length) throw new Error('INVALID_STORE_MUTATION_FIELDS')
  if (entries.some(([key]) => !Object.prototype.hasOwnProperty.call(input.before, key))) throw new Error('INVALID_STORE_MUTATION_SNAPSHOT')

  const executionToken = crypto.randomUUID()
  const conditions = entries.map(([key]) => `${key} IS ?`)
  const expectedValues = entries.map(([key]) => input.before[key])
  const claim = db.prepare(
    `UPDATE telegram_operations SET status = 'applying', execution_token = ?
     WHERE operation_id = ? AND chat_id = ? AND store_id = ? AND status = 'pending' AND expires_at > unixepoch()
       AND before_json = ?
       AND EXISTS (SELECT 1 FROM store_config WHERE id = ? AND ${conditions.join(' AND ')})`,
  ).bind(executionToken, input.operationId, input.chatId, input.storeId, input.beforeJson, input.storeId, ...expectedValues)

  const updates = entries.map(([key]) => `${key} = ?`)
  const mutation = db.prepare(
    `UPDATE store_config SET ${updates.join(', ')}, updated_at = datetime('now')
     WHERE id = ? AND ${conditions.join(' AND ')}
       AND EXISTS (SELECT 1 FROM telegram_operations WHERE operation_id = ? AND chat_id = ? AND status = 'applying' AND execution_token = ?)`,
  ).bind(...entries.map(([, value]) => value), input.storeId, ...expectedValues, input.operationId, input.chatId, executionToken)
  const nameSync = db.prepare(
    `UPDATE stores SET name = (SELECT name FROM store_config WHERE id = ?), updated_at = datetime('now')
     WHERE id = ? AND EXISTS (SELECT 1 FROM telegram_operations WHERE operation_id = ? AND chat_id = ? AND status = 'applying' AND execution_token = ?)`,
  ).bind(input.storeId, input.storeId, input.operationId, input.chatId, executionToken)
  const audit = db.prepare(
    `INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id)
     SELECT 'store_updated', 'store', ?, ?, ?, 'telegram', ?
     WHERE EXISTS (SELECT 1 FROM telegram_operations WHERE operation_id = ? AND chat_id = ? AND status = 'applying' AND execution_token = ?)`,
  ).bind(String(input.storeId), JSON.stringify({ operationId: input.operationId, before: input.before, after: input.after }), input.actor, input.storeId, input.operationId, input.chatId, executionToken)
  const complete = db.prepare(
    `UPDATE telegram_operations SET status = 'applied', execution_token = NULL, completed_at = datetime('now')
     WHERE operation_id = ? AND chat_id = ? AND status = 'applying' AND execution_token = ?`,
  ).bind(input.operationId, input.chatId, executionToken)

  const results = await db.batch([claim, mutation, nameSync, audit, complete])
  if (Number(results[0]?.meta.changes || 0) === 1 && Number(results[1]?.meta.changes || 0) === 1) return 'applied'
  const current = await db.prepare(
    `UPDATE telegram_operations SET status = CASE WHEN expires_at <= unixepoch() THEN 'expired' ELSE 'stale' END,
       completed_at = datetime('now') WHERE operation_id = ? AND chat_id = ? AND status = 'pending' RETURNING status`,
  ).bind(input.operationId, input.chatId).first<{ status: 'stale' | 'expired' }>()
  return current?.status || 'not_pending'
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
  const category = entries.find(([key]) => key === 'categoryId' || key === 'category_id')
  if (category) await assertCategoryInStore(db, category[1], context.storeId)
  const updates = entries.map(([key]) => `${columnByField[key]} = ?`)
  const values = entries.map(([key, value]) => {
    if ((key === 'imageUrls' || key === 'image_urls') && Array.isArray(value)) return JSON.stringify(value)
    if (['isFeatured', 'isActive', 'is_featured', 'is_active'].includes(key) && typeof value === 'boolean') return value ? 1 : 0
    return value
  })
  updates.push("updated_at = datetime('now')")
  const byId = selector.id !== undefined
  values.push(byId ? selector.id : selector.sku, context.storeId)
  const result = await db.prepare(`UPDATE products SET ${updates.join(', ')} WHERE ${byId ? 'id' : 'sku'} = ? AND store_id = ? AND is_archived = 0`).bind(...values).run()
  if (!result.meta.changes) return false
  const entityId = String(selector.id ?? selector.sku)
  await recordBusinessAction(db, 'product_updated', 'product', entityId, fields, context)
  return true
}

/** Soft-archive or restore a product of the current store. */
export async function setProductArchived(
  db: D1Database,
  selector: { id?: number; sku?: string },
  archived: boolean,
  context: AuditContext,
): Promise<boolean> {
  const byId = selector.id !== undefined
  if (!byId && !selector.sku) return false
  const result = await db.prepare(
    `UPDATE products SET is_archived = ?, is_active = ?, updated_at = datetime('now') WHERE ${byId ? 'id' : 'sku'} = ? AND store_id = ?`,
  ).bind(archived ? 1 : 0, archived ? 0 : 1, byId ? selector.id : selector.sku, context.storeId).run()
  if (!result.meta.changes) return false
  await recordBusinessAction(db, archived ? 'product_archived' : 'product_restored', 'product', String(selector.id ?? selector.sku), {}, context)
  return true
}

export async function setFeaturedProducts(db: D1Database, skus: string[], context: AuditContext): Promise<number> {
  const statements = [db.prepare("UPDATE products SET is_featured = 0, updated_at = datetime('now') WHERE store_id = ? AND is_featured = 1").bind(context.storeId)]
  for (const sku of skus) {
    statements.push(db.prepare("UPDATE products SET is_featured = 1, updated_at = datetime('now') WHERE store_id = ? AND sku = ? AND is_archived = 0").bind(context.storeId, sku))
  }
  statements.push(db.prepare(
    'INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).bind('featured_updated', 'store', String(context.storeId), JSON.stringify({ skus }), context.actor, context.source, context.storeId))
  const results = await db.batch(statements)
  return results.slice(1, -1).reduce((total, result) => total + Number(result.meta.changes || 0), 0)
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
        WHERE p.store_id = ? AND p.sku = ? AND p.is_archived = 0 AND (v.sku = ? OR v.size = ?)`)
      .bind(context.storeId, sku, `${sku}-${size}`, size).all<{ id: number }>()
    : await db.prepare(`SELECT v.id FROM product_variants v JOIN products p ON p.id = v.product_id
        WHERE p.store_id = ? AND p.sku = ? AND p.is_archived = 0`).bind(context.storeId, sku).all<{ id: number }>()
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
    `UPDATE product_variants SET stock = ?, updated_at = datetime('now')
     WHERE id = ? AND product_id IN (SELECT id FROM products WHERE store_id = ?)`,
  ).bind(item.stock, item.id, context.storeId)))
  const changes = results.reduce((total, result) => total + Number(result.meta.changes || 0), 0)
  if (changes) await recordBusinessAction(db, 'inventory_updated', 'variant', 'multiple', auditDetails, context)
  return changes
}

export type ConfirmedCatalogMutation = {
  operationId: string
  chatId: string
  storeId: number
  actor: string
  action: 'update_price' | 'update_stock'
  params: { sku: string; price?: number; stock?: number; size?: string }
  before: Record<string, unknown>
  beforeJson: string
  after: unknown
}

export type ConfirmedProductEdit = {
  operationId: string
  chatId: string
  storeId: number
  actor: string
  sku: string
  fields: { name?: string; description?: string; isActive?: boolean }
  before: Record<string, unknown>
  beforeJson: string
  after: Record<string, unknown>
}

/** Applies an allowlisted Telegram product edit, its audit and operation state atomically. */
export async function applyConfirmedProductEdit(db: D1Database, input: ConfirmedProductEdit): Promise<'applied' | 'stale' | 'expired' | 'not_pending'> {
  const edits = Object.entries(input.fields).filter(([key]) => ['name', 'description', 'isActive'].includes(key))
  if (!edits.length || edits.length !== Object.keys(input.fields).length) throw new Error('INVALID_PRODUCT_EDIT_FIELDS')
  const columns: Record<string, string> = { name: 'name', description: 'description', isActive: 'is_active' }
  const values = edits.map(([key, value]) => key === 'isActive' ? (value ? 1 : 0) : value)
  const executionToken = crypto.randomUUID()
  const variants = parseExpectedVariants(input.before.variants)
  const productColumns: Array<[string, unknown]> = [
    ['sku', input.before.sku], ['name', input.before.name], ['price', input.before.price],
    ['description', input.before.description], ['brand', input.before.brand],
    ['category_id', input.before.category_id], ['is_featured', input.before.is_featured],
    ['is_active', input.before.is_active], ['is_archived', input.before.is_archived],
  ]
  const conditions = ['p.store_id = ?', ...productColumns.map(([column]) => `p.${column} IS ?`)]
  const bindings: unknown[] = [input.storeId, ...productColumns.map(([, value]) => value)]
  conditions.push(`(SELECT COUNT(*) FROM product_variants v WHERE v.product_id = p.id) = ?`)
  bindings.push(variants.length)
  for (const variant of variants) {
    conditions.push(`EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id=p.id AND v.id=? AND v.sku IS ? AND v.size IS ? AND v.stock=?)`)
    bindings.push(variant.id, variant.sku, variant.size, variant.stock)
  }
  const claim = db.prepare(`UPDATE telegram_operations SET status='applying', execution_token=?
    WHERE operation_id=? AND chat_id=? AND store_id=? AND status='pending' AND expires_at>unixepoch() AND before_json=?
    AND EXISTS (SELECT 1 FROM products p WHERE ${conditions.join(' AND ')})`)
    .bind(executionToken, input.operationId, input.chatId, input.storeId, input.beforeJson, ...bindings)
  const update = db.prepare(`UPDATE products SET ${edits.map(([key]) => `${columns[key]}=?`).join(', ')}, updated_at=datetime('now')
    WHERE store_id=? AND sku=? AND is_archived=0 AND EXISTS (SELECT 1 FROM telegram_operations WHERE operation_id=? AND chat_id=? AND status='applying' AND execution_token=?)`)
    .bind(...values, input.storeId, input.sku, input.operationId, input.chatId, executionToken)
  const audit = db.prepare(`INSERT INTO audit_log (action,entity_type,entity_id,payload,performed_by,source,store_id)
    SELECT 'product_updated','product',?,? ,?,'telegram',? WHERE EXISTS (SELECT 1 FROM telegram_operations WHERE operation_id=? AND chat_id=? AND status='applying' AND execution_token=?)`)
    .bind(input.sku, JSON.stringify({ operationId: input.operationId, before: input.before, after: input.after }), input.actor, input.storeId, input.operationId, input.chatId, executionToken)
  const complete = db.prepare(`UPDATE telegram_operations SET status='applied',execution_token=NULL,completed_at=datetime('now')
    WHERE operation_id=? AND chat_id=? AND status='applying' AND execution_token=?`)
    .bind(input.operationId, input.chatId, executionToken)
  const results = await db.batch([claim, update, audit, complete])
  if (Number(results[0]?.meta.changes || 0) === 1 && Number(results[1]?.meta.changes || 0) === 1) return 'applied'
  const current = await db.prepare(`UPDATE telegram_operations SET status=CASE WHEN expires_at<=unixepoch() THEN 'expired' ELSE 'stale' END, completed_at=datetime('now')
    WHERE operation_id=? AND chat_id=? AND status='pending' RETURNING status`).bind(input.operationId, input.chatId).first<{status:'stale'|'expired'}>()
  return current?.status || 'not_pending'
}

export async function applyConfirmedCatalogMutation(
  db: D1Database,
  operation: ConfirmedCatalogMutation,
): Promise<'applied' | 'stale' | 'expired' | 'not_pending'> {
  const { operationId, chatId, actor, action, params, before, beforeJson, after, storeId } = operation
  const executionToken = crypto.randomUUID()
  const sku = params.sku
  const variants = parseExpectedVariants(before.variants)
  const fields: Array<[string, unknown]> = [
    ['sku', before.sku], ['name', before.name], ['price', before.price],
    ['description', before.description], ['brand', before.brand],
    ['category_id', before.category_id], ['is_featured', before.is_featured],
    ['is_active', before.is_active], ['is_archived', before.is_archived],
  ]
  const productConditions = ['p.store_id = ?', ...fields.map(([column]) => `p.${column} IS ?`)]
  productConditions.push('p.is_active = 1', 'p.is_archived = 0')
  const productBindings: unknown[] = [storeId, ...fields.map(([, value]) => value)]
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
     WHERE operation_id = ? AND chat_id = ? AND store_id = ? AND status = 'pending' AND expires_at > unixepoch()
       AND before_json = ?
       AND EXISTS (SELECT 1 FROM products p WHERE ${productConditions.join(' AND ')})`,
  ).bind(executionToken, operationId, chatId, storeId, beforeJson, ...productBindings)

  let mutation: D1PreparedStatement
  if (action === 'update_price') {
    if (!Number.isInteger(params.price) || Number(params.price) < 0) throw new Error('INVALID_PRICE')
    mutation = db.prepare(
      `UPDATE products SET price = ?, updated_at = datetime('now')
       WHERE store_id = ? AND sku = ? AND is_archived = 0
         AND EXISTS (SELECT 1 FROM telegram_operations WHERE operation_id = ? AND status = 'applying' AND execution_token = ?)`,
    ).bind(params.price, storeId, sku, operationId, executionToken)
  } else {
    if (!Number.isInteger(params.stock) || Number(params.stock) < 0) throw new Error('INVALID_STOCK')
    const targetVariants = variants.filter((variant) => !params.size || variant.sku === `${sku}-${params.size}` || variant.size === params.size)
    if (!targetVariants.length) return 'stale'
    mutation = db.prepare(
      `UPDATE product_variants SET stock = ?, updated_at = datetime('now')
       WHERE id IN (${targetVariants.map(() => '?').join(', ')})
         AND product_id = (SELECT id FROM products WHERE store_id = ? AND sku = ? AND is_archived = 0)
         AND EXISTS (SELECT 1 FROM telegram_operations WHERE operation_id = ? AND status = 'applying' AND execution_token = ?)`,
    ).bind(params.stock, ...targetVariants.map((variant) => variant.id), storeId, sku, operationId, executionToken)
  }

  const audit = db.prepare(
    `INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id)
     SELECT ?, ?, ?, ?, ?, 'telegram', ?
     WHERE EXISTS (SELECT 1 FROM telegram_operations WHERE operation_id = ? AND status = 'applying' AND execution_token = ?)`,
  ).bind(action, action === 'update_stock' ? 'variant' : 'product', sku,
    JSON.stringify({ operationId, before, after }), actor, storeId, operationId, executionToken)
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

export function parseExpectedVariants(value: unknown): Array<{ id: number; sku: string; size: string | null; stock: number }> {
  let parsed: unknown
  try { parsed = typeof value === 'string' ? JSON.parse(value) : value } catch { throw new Error('INVALID_VARIANT_SNAPSHOT') }
  if (!Array.isArray(parsed)) throw new Error('INVALID_VARIANT_SNAPSHOT')
  return parsed.map((item) => {
    if (!item || !Number.isInteger(item.id) || typeof item.sku !== 'string' || !Number.isInteger(item.stock)) throw new Error('INVALID_VARIANT_SNAPSHOT')
    return { id: item.id as number, sku: item.sku as string, size: item.size == null ? null : String(item.size), stock: item.stock as number }
  })
}
