import { beforeEach, describe, expect, it } from 'vitest'
import { createHarness, createStoreUser, seedStore, superadminToken, userToken, type Harness } from '../testing/harness'

let h: Harness
let admin: string

const json = async (response: Response) => response.json() as Promise<any>
const newStore = (body: Record<string, unknown> = {}, key = 'provision-key-0001') => h.request('/api/platform/stores', {
  method: 'POST', token: admin, headers: { 'Idempotency-Key': key },
  body: { name: 'Moda Urbana', businessType: 'Ropa y accesorios', template: 'premium', whatsapp: '+57 300 123 4567', ownerEmail: 'duena@modaurbana.test', planCode: 'profesional', ...body },
})

beforeEach(async () => {
  h = createHarness({ TELEGRAM_BOT_USERNAME: 'TiendasAsistenteBot' })
  admin = await superadminToken()
})

describe('automated store provisioning', () => {
  it('creates an isolated draft store with template, categories, owner, plan services and one-time access', async () => {
    const response = await newStore()
    expect(response.status).toBe(201)
    const result = await json(response)
    expect(result).toMatchObject({ status: 'completed', slug: 'moda-urbana', storeStatus: 'draft', publicUrl: 'https://tiendas.test/t/moda-urbana', adminUrl: 'https://tiendas.test/t/moda-urbana/admin' })
    expect(result.steps.map((step: any) => step.status)).toEqual(Array(result.steps.length).fill('ok'))
    expect(result.steps.at(-1)).toMatchObject({ key: 'verify', status: 'ok' })
    expect(result.activationUrl).toMatch(/^https:\/\/tiendas\.test\/t\/moda-urbana\/admin\/activar\?token=/)
    expect(result.telegramLinkCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{2}$/)
    expect(result.telegramDeepLink).toBe(`https://t.me/TiendasAsistenteBot?start=link_${result.telegramLinkCode.replaceAll('-', '')}`)
    const store = h.db.query<any>('SELECT id, status, plan_code, template, ai_monthly_budget_micros FROM stores WHERE slug = ?', 'moda-urbana')[0]
    expect(store).toMatchObject({ status: 'draft', plan_code: 'profesional', template: 'premium', ai_monthly_budget_micros: 3000000 })
    expect(h.db.query<{ name: string }>('SELECT name FROM categories WHERE store_id = ? ORDER BY sort_order', store.id).map((row) => row.name)).toEqual(['Ropa', 'Accesorios', 'Calzado', 'Ofertas'])
    const config = h.db.query<any>('SELECT whatsapp_phone, theme_config, primary_color FROM store_config WHERE id = ?', store.id)[0]
    expect(config.whatsapp_phone).toBe('+573001234567')
    const theme = JSON.parse(config.theme_config)
    expect(theme.hero).toMatchObject({ title: 'Moda Urbana', imageUrl: null })
    expect(theme.testimonials).toEqual([])
    expect(theme.style.typography.fontDisplay).toBe('Playfair Display')
    expect(h.db.query('SELECT role FROM store_memberships WHERE store_id = ?', store.id)).toEqual([{ role: 'owner' }])
    expect(h.db.query<{ service_code: string }>('SELECT service_code FROM store_services WHERE store_id = ? ORDER BY id', store.id).map((row) => row.service_code)).toEqual(['instalacion', 'asistente_ia'])
    // Secrets are never persisted in clear text.
    expect(JSON.stringify(h.db.query('SELECT result_json, input_json FROM provisioning_jobs'))).not.toContain(result.telegramLinkCode)
    expect(JSON.stringify(h.db.query('SELECT token_hash FROM user_access_tokens'))).not.toContain(result.telegramLinkCode)
  })

  it('is idempotent: retrying the same request returns the same store without duplicates or secrets', async () => {
    const first = await json(await newStore())
    const retry = await newStore()
    expect(retry.status).toBe(200)
    const replay = await json(retry)
    expect(replay).toMatchObject({ replayed: true, storeId: first.storeId, activationUrl: null, telegramLinkCode: null })
    expect(h.db.query("SELECT COUNT(*) AS n FROM stores WHERE slug LIKE 'moda-urbana%'")).toEqual([{ n: 1 }])
  })

  it('refuses a slug that is already taken and suggests a free one for repeated names', async () => {
    await newStore()
    const taken = await newStore({ slug: 'moda-urbana' }, 'provision-key-0002')
    expect(taken.status).toBe(422)
    expect(await json(taken)).toMatchObject({ status: 'failed', errorCode: 'SLUG_TAKEN' })
    const second = await json(await newStore({ ownerEmail: 'otra@modaurbana.test' }, 'provision-key-0003'))
    expect(second.slug).toBe('moda-urbana-2')
  })

  it('resumes an interrupted job with the same key instead of creating a second store', async () => {
    h.db.sqlite.exec(`CREATE TRIGGER break_categories BEFORE INSERT ON categories BEGIN SELECT RAISE(ABORT, 'disk hiccup'); END;`)
    const failed = await newStore({}, 'interrupted-key-01')
    expect(failed.status).toBe(500)
    expect(h.db.query("SELECT status FROM provisioning_jobs WHERE request_key = 'interrupted-key-01'")).toEqual([{ status: 'failed' }])
    expect(h.db.query("SELECT code FROM platform_events WHERE level = 'error' AND source = 'provisioning'")).toEqual([{ code: 'UNEXPECTED_ERROR' }])
    h.db.sqlite.exec('DROP TRIGGER break_categories')
    const resumed = await json(await newStore({}, 'interrupted-key-01'))
    expect(resumed.status).toBe('completed')
    expect(h.db.query("SELECT COUNT(*) AS n FROM stores WHERE slug = 'moda-urbana'")).toEqual([{ n: 1 }])
    expect(h.db.query("SELECT attempts FROM provisioning_jobs WHERE request_key = 'interrupted-key-01'")).toEqual([{ attempts: 2 }])
  })

  it('validates input and never lets a store use the platform administrator email', async () => {
    expect((await newStore({ name: '' })).status).toBe(400)
    expect((await newStore({ ownerEmail: 'platform@admin.test' }, 'reserved-mail-key')).status).toBe(400)
    expect((await h.request('/api/platform/stores', { method: 'POST', token: admin, body: { name: 'X' } })).status).toBe(400)
  })
})

describe('owner activation and first session', () => {
  it('activates the owner account once and opens a private preview of the draft store', async () => {
    const created = await json(await newStore())
    const token = new URL(created.activationUrl).searchParams.get('token')!
    expect(await json(await h.request(`/api/auth/activation?token=${encodeURIComponent(token)}`))).toMatchObject({ email: 'duena@modaurbana.test', store: { slug: 'moda-urbana' } })
    expect((await h.request('/api/auth/activate', { method: 'POST', body: { token, password: 'corta' } })).status).toBe(400)
    const activated = await json(await h.request('/api/auth/activate', { method: 'POST', body: { token, password: 'MiTienda2026segura' } }))
    expect(activated).toMatchObject({ email: 'duena@modaurbana.test', store: { slug: 'moda-urbana' } })
    expect((await h.request('/api/auth/activate', { method: 'POST', body: { token, password: 'MiTienda2026segura' } })).status).toBe(404)
    expect((await h.request('/api/store', { store: 'moda-urbana' })).status).toBe(404)
    expect(await json(await h.request('/api/store', { store: 'moda-urbana', token: activated.token }))).toMatchObject({ name: 'Moda Urbana', status: 'draft' })
    const login = await h.request('/api/admin/login', { method: 'POST', body: { email: 'duena@modaurbana.test', password: 'MiTienda2026segura' } })
    expect(login.status).toBe(200)
  })
})

describe('platform administration', () => {
  it('defaults Telegram bulk import off and lets only the superadmin toggle it with audit', async () => {
    const created = await json(await newStore())
    expect(h.db.query('SELECT telegram_bulk_import_enabled FROM stores WHERE slug = ?', created.slug)).toEqual([{ telegram_bulk_import_enabled: 0 }])
    const ownerId = await createStoreUser(h.db, { email: 'admin@modaurbana.test', storeId: created.storeId, role: 'owner' })
    const owner = await userToken(ownerId, 'admin@modaurbana.test')
    const path = `/api/platform/stores/${created.slug}/telegram-bulk-import`
    expect((await h.request(path, { method: 'PUT', token: owner, body: { enabled: true } })).status).toBe(403)
    expect((await h.request(path, { method: 'PUT', token: admin, body: { enabled: 'yes' } })).status).toBe(400)
    expect(await json(await h.request(path, { method: 'PUT', token: admin, body: { enabled: true } }))).toMatchObject({ storeId: created.storeId, slug: created.slug, enabled: true, changed: true })
    expect(h.db.query('SELECT telegram_bulk_import_enabled FROM stores WHERE id = ?', created.storeId)).toEqual([{ telegram_bulk_import_enabled: 1 }])
    expect(h.db.query("SELECT action, payload FROM audit_log WHERE action = 'store_feature_flag_changed'")).toEqual([
      { action: 'store_feature_flag_changed', payload: JSON.stringify({ feature: 'telegram_bulk_import_enabled', from: false, to: true }) },
    ])
    const list = await json(await h.request('/api/platform/stores', { token: admin }))
    expect(list.items.find((store: any) => store.slug === created.slug)).toMatchObject({ telegramBulkImportEnabled: 1 })
    expect(await json(await h.request(path, { method: 'PUT', token: admin, body: { enabled: false } }))).toMatchObject({ enabled: false, changed: true })
  })

  it('activates, suspends and reports stores; the primary store cannot be cancelled', async () => {
    await newStore()
    expect((await h.request('/api/platform/stores/moda-urbana/status', { method: 'POST', token: admin, body: { status: 'active' } })).status).toBe(200)
    expect((await h.request('/api/store', { store: 'moda-urbana' })).status).toBe(200)
    expect((await h.request('/api/platform/stores/moda-urbana/status', { method: 'POST', token: admin, body: { status: 'suspended', reason: 'Pago pendiente' } })).status).toBe(200)
    expect((await h.request('/api/store', { store: 'moda-urbana' })).status).toBe(404)
    const cancelPrimary = await h.request('/api/platform/stores/1/status', { method: 'POST', token: admin, body: { status: 'cancelled' } })
    expect(cancelPrimary.status).toBe(400)
    expect(h.db.query("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'store_status_changed'")).toEqual([{ n: 2 }])
    const list = await json(await h.request('/api/platform/stores', { token: admin }))
    expect(list.items.map((store: any) => store.slug)).toEqual(expect.arrayContaining(['moda-urbana']))
    const summary = await json(await h.request('/api/platform/summary', { token: admin }))
    expect(summary).toMatchObject({ stores: 2, suspended: 1 })
    const detail = await json(await h.request('/api/platform/stores/moda-urbana', { token: admin }))
    expect(detail.health.find((check: any) => check.key === 'isolation')).toMatchObject({ ok: true })
  })

  it('configures AI limits and plans per store', async () => {
    await newStore()
    await h.request('/api/platform/stores/moda-urbana/ai', { method: 'PUT', token: admin, body: { budgetUsd: 7.5, warnPercent: 70 } })
    expect(h.db.query("SELECT ai_monthly_budget_micros, ai_warn_percent FROM stores WHERE slug = 'moda-urbana'")).toEqual([{ ai_monthly_budget_micros: 7500000, ai_warn_percent: 70 }])
    await h.request('/api/platform/stores/moda-urbana/plan', { method: 'PUT', token: admin, body: { planCode: 'premium' } })
    expect(h.db.query("SELECT plan_code, ai_monthly_budget_micros FROM stores WHERE slug = 'moda-urbana'")).toEqual([{ plan_code: 'premium', ai_monthly_budget_micros: 8000000 }])
    expect((await h.request('/api/platform/stores/moda-urbana/ai', { method: 'PUT', token: admin, body: { budgetUsd: -1 } })).status).toBe(400)
  })

  it('assigns a new owner, keeps the previous one as administrator and regenerates access', async () => {
    await newStore()
    const assigned = await json(await h.request('/api/platform/stores/moda-urbana/owner', { method: 'POST', token: admin, body: { email: 'nuevo@modaurbana.test' } }))
    expect(assigned.activationUrl).toContain('activar?token=')
    const roles = h.db.query<{ email: string; role: string }>(`SELECT u.email, m.role FROM store_memberships m JOIN platform_users u ON u.id = m.user_id JOIN stores s ON s.id = m.store_id WHERE s.slug = 'moda-urbana' ORDER BY u.email`)
    expect(roles).toEqual([{ email: 'duena@modaurbana.test', role: 'admin' }, { email: 'nuevo@modaurbana.test', role: 'owner' }])
    const access = await json(await h.request('/api/platform/stores/moda-urbana/access', { method: 'POST', token: admin }))
    expect(access.telegramLinkCode).toMatch(/^[A-Z0-9]{4}-/)
  })

  it('is closed to store users', async () => {
    const store = await seedStore(h.db, { slug: 'otra', name: 'Otra' })
    const owner = await createStoreUser(h.db, { email: 'o@otra.test', storeId: store, role: 'owner' })
    const token = await userToken(owner, 'o@otra.test')
    for (const [method, path] of [['GET', '/api/platform/stores'], ['GET', '/api/platform/summary'], ['POST', '/api/platform/stores/otra/status']] as const) {
      expect((await h.request(path, { method, token, body: method === 'POST' ? { status: 'active' } : undefined })).status).toBe(403)
    }
  })
})
