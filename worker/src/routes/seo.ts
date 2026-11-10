/** Public data for search-engine sitemaps. Only active stores and their visible products are listed;
 * drafts, suspended or cancelled stores, trials, archived products and every private field stay out.
 * The frontend Worker turns this into sitemap.xml (paths only: it adds its own canonical origin). */
import { Hono } from 'hono'
import type { Env } from '../index'
import { PRIMARY_STORE_ID } from '../tenancy/stores'

const app = new Hono<Env>()
/** One sitemap file holds at most 50,000 URLs (sitemaps.org protocol). */
export const SITEMAP_MAX_URLS = 50000
const CACHE = 'public, max-age=3600'

const isoDate = (value: string | null | undefined) => {
  if (!value) return null
  const date = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`)
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10)
}

// GET /api/seo/stores — every active store with its public path and last change.
app.get('/stores', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT s.id, s.slug, MAX(s.updated_at, COALESCE((SELECT MAX(p.updated_at) FROM products p WHERE p.store_id = s.id AND p.is_active = 1 AND p.is_archived = 0), s.updated_at)) AS lastmod
     FROM stores s WHERE s.status = 'active' AND EXISTS (SELECT 1 FROM store_config c WHERE c.id = s.id) ORDER BY s.id LIMIT ?`,
  ).bind(SITEMAP_MAX_URLS).all<{ id: number; slug: string; lastmod: string | null }>()
  const items = (results || []).map((row) => ({ slug: row.slug, path: row.id === PRIMARY_STORE_ID ? '/' : `/t/${row.slug}`, primary: row.id === PRIMARY_STORE_ID, lastmod: isoDate(row.lastmod) }))
  return c.json({ items }, 200, { 'Cache-Control': CACHE })
})

// GET /api/seo/stores/:slug/products — visible products of one active store.
app.get('/stores/:slug/products', async (c) => {
  const slug = c.req.param('slug')
  if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(slug)) return c.json({ error: 'Store not found', code: 'STORE_NOT_FOUND' }, 404)
  const store = await c.env.DB.prepare(`SELECT id, slug FROM stores WHERE slug = ? AND status = 'active'`).bind(slug).first<{ id: number; slug: string }>()
  if (!store) return c.json({ error: 'Store not found', code: 'STORE_NOT_FOUND' }, 404)
  const { results } = await c.env.DB.prepare(
    `SELECT sku, updated_at FROM products WHERE store_id = ? AND is_active = 1 AND is_archived = 0 ORDER BY id LIMIT ?`,
  ).bind(store.id, SITEMAP_MAX_URLS).all<{ sku: string; updated_at: string | null }>()
  const base = store.id === PRIMARY_STORE_ID ? '' : `/t/${store.slug}`
  const items = (results || []).map((row) => ({ path: `${base}/producto/${encodeURIComponent(row.sku)}`, lastmod: isoDate(row.updated_at) }))
  return c.json({ items }, 200, { 'Cache-Control': CACHE })
})

export default app
