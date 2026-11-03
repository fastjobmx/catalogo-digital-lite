import { Hono } from 'hono'
import type { Env } from '../index'
import { publicStore } from '../middleware/tenant'

const app = new Hono<Env>()

// GET /api/products - Listar productos activos con variantes
app.get('/', publicStore, async (c) => {
 const db = c.env.DB
 const storeId = c.get('storeId')!
 const categorySlug = c.req.query('category')
 const search = c.req.query('q')
 const featured = c.req.query('featured')

 let query = `
 SELECT p.id, p.sku, p.name, p.description, p.brand, p.price, p.compare_at_price,
 p.is_featured, p.image_urls, p.category_id, c.name as category_name, c.slug as category_slug,
 v.id as variant_id, v.sku as variant_sku, v.name as variant_name, v.size as variant_size,
 v.color as variant_color, v.price_override as variant_price_override, v.stock as variant_stock, v.is_active as variant_is_active
 FROM products p
 LEFT JOIN categories c ON p.category_id = c.id AND c.store_id = p.store_id
 LEFT JOIN product_variants v ON v.product_id = p.id AND v.is_active = 1
 WHERE p.store_id = ? AND p.is_active = 1 AND p.is_archived = 0
 `
 const params: (string | number)[] = [storeId]

 if (categorySlug && categorySlug !== 'all') {
 query += ` AND c.slug = ?`
 params.push(categorySlug)
 }

 if (search) {
 query += ` AND (p.name LIKE ? OR p.sku LIKE ? OR p.description LIKE ?)`
 const term = `%${search}%`
 params.push(term, term, term)
 }

 if (featured === '1') {
 query += ` AND p.is_featured = 1`
 }

 query += ` ORDER BY p.is_featured DESC, p.created_at DESC, v.sort_order ASC`

 const { results } = await db.prepare(query).bind(...params).all()
 const byId = new Map<number, Record<string, any>>()
 for (const row of results || []) {
  const product = row as Record<string, any>
  let item = byId.get(product.id)
  if (!item) {
   item = {
    id: product.id, sku: product.sku, name: product.name, description: product.description, brand: product.brand,
    price: product.price, compareAtPrice: product.compare_at_price, isFeatured: Boolean(product.is_featured),
    imageUrls: JSON.parse(product.image_urls || '[]'), categoryId: product.category_id,
    categoryName: product.category_name, categorySlug: product.category_slug, variants: [],
   }
   byId.set(product.id, item)
  }
  if (product.variant_id != null) item.variants.push({
   id: product.variant_id, sku: product.variant_sku, name: product.variant_name, size: product.variant_size,
   color: product.variant_color, priceOverride: product.variant_price_override, stock: product.variant_stock,
   isActive: Boolean(product.variant_is_active),
  })
 }
 const products = [...byId.values()]

 return c.json(products)
})

// GET /api/products/:slug - Obtener producto individual por SKU
app.get('/:sku', publicStore, async (c) => {
 const db = c.env.DB
 const storeId = c.get('storeId')!
 const sku = c.req.param('sku')

 const product = await db.prepare(
 `SELECT p.*, c.name as category_name, c.slug as category_slug
 FROM products p
 LEFT JOIN categories c ON p.category_id = c.id AND c.store_id = p.store_id
 WHERE p.store_id = ? AND p.sku = ? AND p.is_active = 1 AND p.is_archived = 0`
 ).bind(storeId, sku).first()

 if (!product) {
 return c.json({ error: 'Product not found' }, 404)
 }

 const variantsResult = await db.prepare(
 `SELECT id, sku, name, size, color, price_override, stock, is_active
 FROM product_variants
 WHERE product_id = ? AND is_active = 1
 ORDER BY sort_order ASC`
 ).bind((product as any).id).all()

 const row = product as Record<string, any>
 return c.json({
 ...row,
 imageUrls: JSON.parse(row.image_urls || '[]'),
 compareAtPrice: row.compare_at_price,
 isFeatured: Boolean(row.is_featured),
 isActive: Boolean(row.is_active),
 pickupAvailable: Boolean(row.pickup_available),
 categoryId: row.category_id,
 categoryName: row.category_name,
 categorySlug: row.category_slug,
 variants: (variantsResult.results || []).map((v: any) => ({
 id: v.id,
 sku: v.sku,
 name: v.name,
 size: v.size,
 color: v.color,
 priceOverride: v.price_override,
 stock: v.stock,
 isActive: Boolean(v.is_active),
 })),
 })
})

export default app
