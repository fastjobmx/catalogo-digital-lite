/**
 * End-to-end delivery of a new store created from the master bot: owner
 * activation and panel, private preview, publication, separate catalog, the
 * shared AI assistant limited to the owner's store, an untouched primary store,
 * and the cleanup of exactly that store afterwards.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { callbackUpdate, createHarness, seedCatalog, superadminToken, stubTelegram, textUpdate, type Harness } from '../../testing/harness'

const ADMIN = 9001
const OWNER_TG = 7001
const PRIMARY_OWNER_TG = 5005
const MASTER_SECRET = 'master-webhook-secret'
const ASSISTANT_SECRET = 'assistant-webhook-secret'
const PASSWORD = 'Tienda-Segura-2026'
const STORE_TABLES = ['products', 'categories', 'orders', 'store_memberships', 'user_access_tokens', 'store_services', 'store_domains', 'provisioning_jobs', 'audit_log', 'platform_events', 'telegram_operations', 'assistant_messages', 'ai_usage_events', 'ai_usage_monthly']
let h: Harness

beforeEach(async () => {
  h = createHarness({
    MASTER_BOT_TOKEN: 'master-token', MASTER_WEBHOOK_SECRET: MASTER_SECRET, MASTER_ADMIN_TELEGRAM_IDS: String(ADMIN),
    TELEGRAM_BOT_TOKEN: 'assistant-token', TELEGRAM_WEBHOOK_SECRET: ASSISTANT_SECRET, TELEGRAM_OWNER_ID: String(PRIMARY_OWNER_TG),
    TELEGRAM_BOT_USERNAME: 'TiendasAsistenteBot',
  })
  await seedCatalog(h.db, 1, { categories: [{ name: 'Tenis', slug: 'tenis' }], products: [{ sku: 'SH-001', name: 'Tenis Clásicos', price: 189000, category: 'tenis' }] })
})
afterEach(() => vi.unstubAllGlobals())

const master = (update: unknown) => h.request('/api/master/webhook', { method: 'POST', body: update, headers: { 'X-Telegram-Bot-Api-Secret-Token': MASTER_SECRET } })
const assistant = (update: unknown) => h.request('/api/telegram/webhook', { method: 'POST', body: update, headers: { 'X-Telegram-Bot-Api-Secret-Token': ASSISTANT_SECRET } })
const primarySnapshot = () => JSON.stringify([
  h.db.query('SELECT * FROM stores WHERE id = 1'),
  h.db.query('SELECT * FROM store_config WHERE id = 1'),
  h.db.query('SELECT * FROM products WHERE store_id = 1 ORDER BY id'),
  h.db.query('SELECT v.* FROM product_variants v JOIN products p ON p.id = v.product_id WHERE p.store_id = 1 ORDER BY v.id'),
  h.db.query('SELECT * FROM categories WHERE store_id = 1 ORDER BY id'),
])

async function createStoreFromBot(telegram: ReturnType<typeof stubTelegram>) {
  for (const step of ['/crear_tienda', 'Moda Urbana', 'Ropa y accesorios', 'Laura Ríos duena@modaurbana.test']) await master(textUpdate(ADMIN, step))
  for (const data of ['mt:wz:skipwa', 'mt:wz:style:moderno', 'mt:wz:skipcolor', 'mt:wz:skiplogo', 'mt:wz:plan:profesional', 'mt:wz:create']) await master(callbackUpdate(ADMIN, data))
  const delivered = telegram.messages().at(-1)!
  return {
    delivered,
    activationToken: decodeURIComponent(delivered.match(/activar\?token=([^\s<&]+)/)![1]!),
    linkCode: delivered.match(/start=link_([A-Za-z0-9]+)/)![1]!,
    storeId: h.db.query<{ id: number }>("SELECT id FROM stores WHERE slug = 'moda-urbana'")[0]!.id,
  }
}

describe('new store delivered from the master bot', () => {
  it('works for its owner, the public and the AI assistant, isolated from the primary store, and can be removed cleanly', async () => {
    const telegram = stubTelegram()
    const before = primarySnapshot()
    const { delivered, activationToken, linkCode, storeId } = await createStoreFromBot(telegram)
    expect(delivered).toContain('¡Tienda creada!')

    // Draft: private until activated; buyers get the same answer as a missing store.
    expect((await h.request('/api/store', { store: 'moda-urbana' })).status).toBe(404)

    // Owner activation (one-time link) opens a session for this store only.
    expect(await (await h.request(`/api/auth/activation?token=${encodeURIComponent(activationToken)}`)).json()).toMatchObject({ email: 'duena@modaurbana.test', store: { slug: 'moda-urbana', name: 'Moda Urbana' } })
    const activation = await h.request('/api/auth/activate', { method: 'POST', body: { token: activationToken, password: PASSWORD } })
    expect(activation.status).toBe(200)
    const ownerToken = (await activation.json() as { token: string }).token
    expect((await h.request('/api/auth/activate', { method: 'POST', body: { token: activationToken, password: PASSWORD } })).status).toBe(404)
    const login = await h.request('/api/admin/login', { method: 'POST', body: { email: 'duena@modaurbana.test', password: PASSWORD } })
    expect(login.status).toBe(200)

    expect(await (await h.request('/api/admin/session', { token: ownerToken, store: 'moda-urbana' })).json()).toMatchObject({ role: 'owner' })
    expect((await h.request('/api/admin/session', { token: ownerToken })).status).toBe(403)
    expect((await h.request('/api/admin/store', { method: 'PUT', token: ownerToken, body: { description: 'Intento sobre otra tienda' } })).status).toBe(403)

    // Private preview and customization of its own store.
    expect((await h.request('/api/store', { token: ownerToken, store: 'moda-urbana' })).headers.get('X-Store-Preview')).toBe('draft')
    expect((await h.request('/api/admin/store', { method: 'PUT', token: ownerToken, store: 'moda-urbana', body: { description: 'Moda urbana para todos', primaryColor: '#0F766E' } })).status).toBe(200)
    expect(h.db.query('SELECT description, primary_color FROM store_config WHERE id = ?', storeId)).toEqual([{ description: 'Moda urbana para todos', primary_color: '#0F766E' }])

    // Publication from the master bot, with confirmation.
    await master(callbackUpdate(ADMIN, 'mt:activate:moda-urbana'))
    const confirm = (telegram.lastMarkup()?.inline_keyboard || []).flat().find((item) => /Confirmar/.test(item.text))!.callback_data!
    await master(callbackUpdate(ADMIN, confirm))
    const publicStore = await (await h.request('/api/store', { store: 'moda-urbana' })).json() as Record<string, unknown>
    expect(publicStore).toMatchObject({ name: 'Moda Urbana', slug: 'moda-urbana', status: 'active' })

    // Separate catalog: starter categories only, none of the primary store's products.
    expect(await (await h.request('/api/products', { store: 'moda-urbana' })).json()).toEqual([])
    const categories = await (await h.request('/api/categories', { store: 'moda-urbana' })).json() as Array<{ name: string }>
    expect(categories.map((category) => category.name)).toEqual(['Ropa', 'Accesorios', 'Calzado', 'Ofertas'])
    expect(JSON.stringify(await (await h.request('/api/products')).json())).toContain('SH-001')

    // Listed in the master bot.
    await master(textUpdate(ADMIN, '/tiendas'))
    expect(telegram.messages().at(-1)).toContain('Moda Urbana')

    // Shared AI assistant: one-tap link, then only this store is reachable.
    await assistant(textUpdate(OWNER_TG, `/start link_${linkCode}`))
    expect(telegram.messages().at(-1)).toContain('quedó vinculado a <b>Moda Urbana</b>')
    await assistant(callbackUpdate(OWNER_TG, 's:select:1'))
    await assistant(textUpdate(OWNER_TG, 'hola'))
    const ownerMessages = telegram.calls.filter((call) => call.method === 'sendMessage' && String(call.body.chat_id) === String(OWNER_TG)).map((call) => String(call.body.text))
    expect(ownerMessages.at(-1)).toContain('Moda Urbana')
    expect(ownerMessages.join('\n')).not.toContain('SH-001')
    expect(h.db.query('SELECT active_store_id FROM telegram_sessions WHERE telegram_user_id = ?', String(OWNER_TG))).toEqual([{ active_store_id: storeId }])
    // The primary store's owner keeps their own store in the assistant.
    await assistant(textUpdate(PRIMARY_OWNER_TG, 'hola'))
    const primaryChat = telegram.calls.filter((call) => call.method === 'sendMessage' && String(call.body.chat_id) === String(PRIMARY_OWNER_TG)).map((call) => String(call.body.text))
    expect(primaryChat.length).toBeGreaterThan(0)
    expect(primaryChat.join('\n')).not.toContain('Moda Urbana')

    expect(primarySnapshot()).toBe(before)

    // Cleanup of exactly this store: refused while active, for the primary store and without the typed address.
    const sa = await superadminToken()
    const purge = (slug: string, confirmSlug: string) => h.request(`/api/platform/stores/${slug}`, { method: 'DELETE', token: sa, body: { confirm: confirmSlug } })
    expect((await purge('moda-urbana', 'moda-urbana')).status).toBe(409)
    expect((await h.request('/api/platform/stores/moda-urbana/status', { method: 'POST', token: sa, body: { status: 'suspended', reason: 'fin de la prueba' } })).status).toBe(200)
    expect((await purge('moda-urbana', 'otra')).status).toBe(400)
    const primarySlug = h.db.query<{ slug: string }>('SELECT slug FROM stores WHERE id = 1')[0]!.slug
    expect(await (await purge(primarySlug, primarySlug)).json()).toMatchObject({ code: 'PRIMARY_STORE' })
    const assetKey = `stores/${storeId}/store/test.png`
    await h.assets.put(assetKey, new Uint8Array([1, 2, 3]))
    const removed = await purge('moda-urbana', 'moda-urbana')
    expect(removed.status).toBe(200)
    expect(await removed.json()).toMatchObject({ slug: 'moda-urbana', products: 0, categories: 4, usersRemoved: 1, assetsRemoved: 1 })

    expect(h.db.query("SELECT COUNT(*) AS n FROM stores WHERE slug = 'moda-urbana'")).toEqual([{ n: 0 }])
    expect(h.db.query('SELECT COUNT(*) AS n FROM store_config WHERE id = ?', storeId)).toEqual([{ n: 0 }])
    for (const table of STORE_TABLES) expect(h.db.query(`SELECT COUNT(*) AS n FROM ${table} WHERE store_id = ?`, storeId)).toEqual([{ n: 0 }])
    expect(h.db.query("SELECT COUNT(*) AS n FROM platform_users WHERE email = 'duena@modaurbana.test'")).toEqual([{ n: 0 }])
    expect(await h.assets.get(assetKey)).toBeNull()
    expect(h.db.query("SELECT performed_by FROM audit_log WHERE action = 'store_purged'")).toHaveLength(1)
    expect(primarySnapshot()).toBe(before)
    // The former owner no longer reaches any store through the assistant.
    expect(await (await assistant(textUpdate(OWNER_TG, 'hola'))).json()).toMatchObject({ rejected: true })
  })
})
