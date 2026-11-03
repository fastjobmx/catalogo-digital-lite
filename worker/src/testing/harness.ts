/** End-to-end test harness: the real Worker (routes, middleware, services) over
 * SQLite with every D1 migration applied and an in-memory R2 bucket. */
import { vi } from 'vitest'
import worker, { type Env } from '../index'
import { createTestDatabase, MemoryR2, type SqliteD1 } from '../../test/sqliteD1'
import { createAdminToken, hashPassword } from '../services/auth'
import type { StoreRole } from '../tenancy/access'

export const TEST_SECRET = 'unit-test-secret-with-at-least-32-characters'
export const PLATFORM_EMAIL = 'platform@admin.test'
export const PLATFORM_PASSWORD = 'platform-password-123'

export type Harness = ReturnType<typeof createHarness>

export function createHarness(overrides: Partial<Env['Bindings']> = {}) {
  const db = createTestDatabase() as SqliteD1 & D1Database
  const assets = new MemoryR2()
  const env = {
    DB: db, ASSETS: assets as unknown as R2Bucket, ENVIRONMENT: 'test', JWT_SECRET: TEST_SECRET,
    ADMIN_EMAIL: PLATFORM_EMAIL, ADMIN_PASSWORD: PLATFORM_PASSWORD,
    STORE_NAME: 'Test', STORE_CURRENCY: 'COP', STORE_COUNTRY: 'CO', COMMERCE_ENABLED: 'true',
    PUBLIC_STORE_BASE_URL: 'https://tiendas.test',
    ...overrides,
  } as Env['Bindings']
  const executionContext = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext

  async function request(path: string, init: { method?: string; body?: unknown; token?: string; store?: string; headers?: Record<string, string> } = {}): Promise<Response> {
    const headers = new Headers(init.headers)
    const isForm = typeof FormData !== 'undefined' && init.body instanceof FormData
    if (init.body !== undefined && !isForm) headers.set('Content-Type', 'application/json')
    if (init.token) headers.set('Authorization', `Bearer ${init.token}`)
    if (init.store) headers.set('X-Store-Slug', init.store)
    const body = init.body === undefined ? undefined : isForm ? init.body as FormData : JSON.stringify(init.body)
    return worker.fetch(new Request(`https://api.test${path}`, { method: init.method || 'GET', headers, body }), env, executionContext)
  }

  return { db, assets, env, request }
}

export async function seedStore(db: D1Database, input: { slug: string; name: string; status?: string; currency?: string; plan?: string; whatsapp?: string }): Promise<number> {
  const result = await db.prepare(`INSERT INTO stores (slug, name, status, plan_code, created_by) VALUES (?, ?, ?, ?, 'test')`)
    .bind(input.slug, input.name, input.status || 'active', input.plan || 'profesional').run()
  const id = Number(result.meta.last_row_id)
  await db.prepare(`INSERT INTO store_config (id, name, whatsapp_phone, currency) VALUES (?, ?, ?, ?)`)
    .bind(id, input.name, input.whatsapp || '+573001112233', input.currency || 'COP').run()
  return id
}

export type SeedProduct = { sku: string; name: string; price: number; category?: string; description?: string; imageUrls?: string[]; featured?: boolean; variants?: Array<{ size?: string; color?: string; stock: number; imageUrl?: string }> }

export async function seedCatalog(db: D1Database, storeId: number, input: { categories?: Array<{ name: string; slug: string }>; products?: SeedProduct[] }): Promise<Record<string, number>> {
  const categoryIds: Record<string, number> = {}
  for (const [index, category] of (input.categories || []).entries()) {
    const result = await db.prepare('INSERT INTO categories (store_id, name, slug, sort_order) VALUES (?, ?, ?, ?)').bind(storeId, category.name, category.slug, index).run()
    categoryIds[category.slug] = Number(result.meta.last_row_id)
  }
  const productIds: Record<string, number> = {}
  for (const product of input.products || []) {
    const result = await db.prepare(
      'INSERT INTO products (store_id, sku, name, description, category_id, price, is_featured, image_urls) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(storeId, product.sku, product.name, product.description ?? 'Descripción de prueba suficientemente larga.', product.category ? categoryIds[product.category] ?? null : null, product.price, product.featured ? 1 : 0, JSON.stringify(product.imageUrls ?? [`/api/assets/stores/${storeId}/products/${product.sku}.jpg`])).run()
    const productId = Number(result.meta.last_row_id)
    productIds[product.sku] = productId
    for (const [index, variant] of (product.variants ?? [{ size: 'Única', color: 'Negro', stock: 5 }]).entries()) {
      const variantResult = await db.prepare('INSERT INTO product_variants (product_id, sku, name, size, color, stock, sort_order, image_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(productId, `${product.sku}-${variant.size ?? index + 1}`, `${variant.color ?? ''} ${variant.size ?? ''}`.trim(), variant.size ?? null, variant.color ?? null, variant.stock, index, variant.imageUrl ?? null).run()
      productIds[`${product.sku}#${variant.size ?? index + 1}`] = Number(variantResult.meta.last_row_id)
    }
  }
  return productIds
}

export async function createStoreUser(db: D1Database, input: { email: string; password?: string; storeId: number; role: StoreRole; telegramUserId?: string; status?: string }): Promise<number> {
  const passwordHash = input.password ? await hashPassword(input.password) : null
  const result = await db.prepare(`INSERT INTO platform_users (email, password_hash, telegram_user_id, status, created_by) VALUES (?, ?, ?, ?, 'test')`)
    .bind(input.email, passwordHash, input.telegramUserId ?? null, input.status || 'active').run()
  const userId = Number(result.meta.last_row_id)
  await db.prepare(`INSERT INTO store_memberships (store_id, user_id, role, created_by) VALUES (?, ?, ?, 'test')`).bind(input.storeId, userId, input.role).run()
  return userId
}

export function superadminToken(): Promise<string> {
  return createAdminToken(PLATFORM_EMAIL, TEST_SECRET, { sa: true })
}

export function userToken(userId: number, email: string): Promise<string> {
  return createAdminToken(email, TEST_SECRET, { sub: String(userId) })
}

/** Stubs fetch for the Telegram Bot API and records every call. */
export function stubTelegram(handler?: (url: string, body: Record<string, unknown>) => Response | undefined) {
  const calls: Array<{ url: string; method: string; body: Record<string, any> }> = []
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    let body: Record<string, any> = {}
    try { body = init?.body ? JSON.parse(String(init.body)) : {} } catch { body = {} }
    calls.push({ url, method: url.split('/').pop()?.split('?')[0] || '', body })
    const custom = handler?.(url, body)
    if (custom) return custom
    return new Response(JSON.stringify({ ok: true, result: { message_id: calls.length } }))
  })
  vi.stubGlobal('fetch', fetcher)
  return {
    calls,
    fetcher,
    messages: () => calls.filter((call) => call.method === 'sendMessage' || call.method === 'sendPhoto').map((call) => String(call.body.text ?? call.body.caption ?? '')),
    lastMarkup: () => [...calls].reverse().find((call) => call.body.reply_markup)?.body.reply_markup as { inline_keyboard: Array<Array<{ text: string; callback_data?: string }>> } | undefined,
  }
}

let updateCounter = 1000
export function textUpdate(userId: number, text: string, firstName = 'Ana') {
  return { update_id: ++updateCounter, message: { message_id: updateCounter, from: { id: userId, first_name: firstName }, chat: { id: userId, type: 'private' as const }, date: 0, text } }
}

export function callbackUpdate(userId: number, data: string) {
  return { update_id: ++updateCounter, callback_query: { id: `cb-${updateCounter}`, from: { id: userId, first_name: 'Ana' }, data, message: { message_id: updateCounter, chat: { id: userId, type: 'private' as const }, date: 0 } } }
}

export function photoUpdate(userId: number, fileId: string, caption?: string) {
  return { update_id: ++updateCounter, message: { message_id: updateCounter, from: { id: userId, first_name: 'Ana' }, chat: { id: userId, type: 'private' as const }, date: 0, photo: [{ file_id: fileId }], ...(caption ? { caption } : {}) } }
}
