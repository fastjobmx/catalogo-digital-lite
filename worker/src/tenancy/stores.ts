/** Store registry lookups. Every tenant-owned query must use the id resolved here,
 * never a store id supplied by the client. */
export const PRIMARY_STORE_ID = 1

export type StoreStatus = 'draft' | 'active' | 'suspended' | 'cancelled'

export interface StoreRecord {
  id: number
  slug: string
  name: string
  status: StoreStatus
  plan_code: string
  template: string
  business_type: string
  ai_enabled: number
  ai_monthly_budget_micros: number
  ai_warn_percent: number
}

const STORE_COLUMNS = 'id, slug, name, status, plan_code, template, business_type, ai_enabled, ai_monthly_budget_micros, ai_warn_percent'

export const RESERVED_SLUGS = new Set([
  'admin', 'api', 't', 'plataforma', 'platform', 'assets', 'www', 'app', 'tienda', 'tiendas',
  'login', 'static', 'soporte', 'ayuda', 'help', 'root', 'system', 'demo', 'test',
])

export function isValidSlug(value: string): boolean {
  return /^[a-z0-9](?:[a-z0-9]|-(?!-)){1,38}[a-z0-9]$/.test(value) && !RESERVED_SLUGS.has(value)
}

/** Converts a commercial name into a URL-safe slug ("Moda Urbana" → "moda-urbana"). */
export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' y ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 40)
    .replace(/-+$/g, '')
}

export async function getStoreById(db: D1Database, id: number): Promise<StoreRecord | null> {
  if (!Number.isSafeInteger(id) || id < 1) return null
  return db.prepare(`SELECT ${STORE_COLUMNS} FROM stores WHERE id = ?`).bind(id).first<StoreRecord>()
}

export async function getStoreBySlug(db: D1Database, slug: string): Promise<StoreRecord | null> {
  const normalized = slug.trim().toLowerCase()
  if (!/^[a-z0-9-]{3,40}$/.test(normalized)) return null
  return db.prepare(`SELECT ${STORE_COLUMNS} FROM stores WHERE slug = ?`).bind(normalized).first<StoreRecord>()
}

export async function getStoreByDomain(db: D1Database, host: string): Promise<StoreRecord | null> {
  const domain = host.trim().toLowerCase().replace(/:\d+$/, '')
  if (!/^[a-z0-9.-]{3,253}$/.test(domain)) return null
  return db.prepare(
    `SELECT ${STORE_COLUMNS.split(', ').map((column) => `s.${column}`).join(', ')}
     FROM store_domains d JOIN stores s ON s.id = d.store_id
     WHERE d.domain = ? AND d.status = 'activo'`,
  ).bind(domain).first<StoreRecord>()
}

export type StoreSelector = { slug?: string | null; host?: string | null }

/** Resolves the store addressed by a request. Without an explicit selector the
 * installation's primary store is used, keeping single-store clients working. */
export async function resolveStore(db: D1Database, selector: StoreSelector): Promise<StoreRecord | null> {
  const slug = selector.slug?.trim()
  if (slug) return getStoreBySlug(db, slug)
  const host = selector.host?.trim()
  if (host) {
    const byDomain = await getStoreByDomain(db, host)
    if (byDomain) return byDomain
  }
  return getStoreById(db, PRIMARY_STORE_ID)
}

export function storeSelectorFromRequest(request: { header(name: string): string | undefined; query(name: string): string | undefined }): StoreSelector {
  return {
    slug: request.header('X-Store-Slug') || request.query('store') || null,
    host: request.header('X-Store-Host') || null,
  }
}

export function publicStoreUrl(baseUrl: string | undefined, store: Pick<StoreRecord, 'id' | 'slug'>): string {
  const base = (baseUrl || '').replace(/\/+$/, '')
  if (!base) return store.id === PRIMARY_STORE_ID ? '/' : `/t/${store.slug}`
  return store.id === PRIMARY_STORE_ID ? `${base}/` : `${base}/t/${store.slug}`
}

export function adminStoreUrl(baseUrl: string | undefined, store: Pick<StoreRecord, 'id' | 'slug'>): string {
  const base = (baseUrl || '').replace(/\/+$/, '')
  return store.id === PRIMARY_STORE_ID ? `${base}/admin` : `${base}/t/${store.slug}/admin`
}
