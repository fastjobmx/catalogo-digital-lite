import { beforeEach, describe, expect, it } from 'vitest'
import { createPng } from '../../test/sqliteD1'
import { createHarness, seedCatalog, seedStore, superadminToken, type Harness } from '../testing/harness'
import { cleanupExpiredTrials } from '../services/trials'

let h: Harness
let admin: string
const json = async (response: Response) => response.json() as Promise<any>
const IP = '203.0.113.7'
const create = (body: Record<string, unknown> = { businessName: 'Dulce Hogar' }, ip = IP) =>
  h.request('/api/trial', { method: 'POST', body, headers: { 'CF-Connecting-IP': ip } })
const photo = (id: string, token: string, bytes: Uint8Array = createPng(40, 40), type = 'image/png') => {
  const form = new FormData()
  form.append('file', new File([bytes], 'foto.png', { type }))
  return h.request(`/api/trial/${id}/photos`, { method: 'POST', body: form, headers: { 'X-Trial-Token': token, 'CF-Connecting-IP': IP } })
}
const save = (id: string, token: string, body: Record<string, unknown>) => h.request(`/api/trial/${id}`, { method: 'PUT', body, headers: { 'X-Trial-Token': token, 'CF-Connecting-IP': IP } })
const get = (id: string, token?: string) => h.request(`/api/trial/${id}`, { headers: token ? { 'X-Trial-Token': token } : {} })
const activate = (id: string, token: string, body: Record<string, unknown> = {}) => h.request(`/api/trial/${id}/activation`, {
  method: 'POST', headers: { 'X-Trial-Token': token },
  body: { planChoice: 'ia', name: 'Ana Ruiz', email: 'ana@dulcehogar.test', phone: '+57 300 111 2233', consent: true, ...body },
})
/** Makes every stored photo older than the orphan grace period, as if uploaded a while ago. */
const age = () => { for (const record of h.assets.objects.values()) (record as unknown as { uploaded: Date }).uploaded = new Date(Date.now() - 3_600_000) }
const expire = (id: string, retainHours = 72) => h.db.sqlite.exec(`UPDATE trial_sessions SET expires_at = datetime('now', '-1 minute'), retain_until = datetime('now', '+${retainHours} hours') WHERE id = '${id}'`)

/** A trial with `count` products, each with its own photo, plus a logo. */
async function trialWithProducts(count = 5) {
  const trial = await json(await create())
  const products = []
  for (let i = 0; i < count; i++) {
    const { url } = await json(await photo(trial.id, trial.editToken))
    products.push({ id: `p${i + 1}`, name: `Producto ${i + 1}`, price: 10000 * (i + 1), description: `Descripción ${i + 1}`, imageUrl: url })
  }
  const logo = (await json(await photo(trial.id, trial.editToken))).url
  const saved = await save(trial.id, trial.editToken, { products, logoUrl: logo, colors: { primary: '#123456', accent: '#ABCDEF' } })
  expect(saved.status).toBe(200)
  return { trial, products, logo }
}

beforeEach(async () => {
  h = createHarness()
  admin = await superadminToken()
})

describe('mini-store trial without sign-up', () => {
  it('1 · creates a temporary, unpublished store without account data, users or stores', async () => {
    const storesBefore = h.db.query('SELECT COUNT(*) AS n FROM stores')
    const response = await create()
    expect(response.status).toBe(201)
    expect(response.headers.get('x-robots-tag')).toContain('noindex')
    const trial = await json(response)
    expect(trial).toMatchObject({ businessName: 'Dulce Hogar', template: 'clasica', state: 'activa', temporary: true, published: false, products: [], logoUrl: null, owner: true })
    expect(trial.limits).toMatchObject({ maxProducts: 7, maxPhotoMb: 3, templates: ['clasica', 'boutique', 'stories'] })
    expect(trial.editToken).toMatch(/^[\w-]{40,}$/)
    expect(h.db.query('SELECT COUNT(*) AS n FROM stores')).toEqual(storesBefore)
    expect(h.db.query('SELECT COUNT(*) AS n FROM platform_users')).toEqual([{ n: 0 }])
    const row = h.db.query<any>('SELECT ip_hash, edit_token_hash FROM trial_sessions')[0]
    expect(row.ip_hash).not.toContain(IP)
    expect(row.edit_token_hash).not.toBe(trial.editToken)
  })

  it('2–3 · keeps up to 7 products with one photo each and refuses an eighth', async () => {
    const { trial, products } = await trialWithProducts(7)
    const view = await json(await get(trial.id))
    expect(view.products).toHaveLength(7)
    expect(view.products[6]).toMatchObject({ name: 'Producto 7', price: 70000, imageUrl: products[6]!.imageUrl })
    const sixth = await save(trial.id, trial.editToken, { products: [...products, { name: 'Producto 8', price: 1 }] })
    expect(sixth.status).toBe(400)
    expect((await json(sixth)).code).toBe('TOO_MANY_PRODUCTS')
    expect((await json(await get(trial.id))).products).toHaveLength(7)
  })

  it('4 · switches template without losing products, logo or colours', async () => {
    const { trial } = await trialWithProducts(3)
    for (const template of ['boutique', 'stories', 'clasica']) {
      const view = await json(await save(trial.id, trial.editToken, { template }))
      expect(view).toMatchObject({ template, colors: { primary: '#123456', accent: '#abcdef' } })
      expect(view.products).toHaveLength(3)
      expect(view.logoUrl).toMatch(/assets/)
    }
    expect((await save(trial.id, trial.editToken, { template: 'premium' })).status).toBe(400)
  })

  it('5 · edits names, photos and prices and deletes replaced photos', async () => {
    const { trial, products } = await trialWithProducts(2)
    const { url: newPhoto } = await json(await photo(trial.id, trial.editToken))
    const edited = [{ ...products[0], name: 'Lámpara cálida', price: 85000, imageUrl: newPhoto }, products[1]]
    // A replaced photo uploaded moments ago is kept for a while (a queued save must not delete new photos)...
    await save(trial.id, trial.editToken, { products: edited })
    expect((await h.request(products[0]!.imageUrl)).status).toBe(200)
    // ...and deleted on a later save once it is older than the grace period.
    age()
    const view = await json(await save(trial.id, trial.editToken, { products: edited }))
    expect(view.products[0]).toMatchObject({ name: 'Lámpara cálida', price: 85000, imageUrl: newPhoto })
    const oldFile = products[0]!.imageUrl.split('/').pop()
    expect([...h.assets.objects.keys()].some((key) => key.endsWith(oldFile))).toBe(false)
    expect((await h.request(newPhoto)).status).toBe(200)
    // A photo uploaded before typing the product name survives the autosave (sent in `keep`).
    const { url: early } = await json(await photo(trial.id, trial.editToken))
    expect((await save(trial.id, trial.editToken, { products: edited, keep: [early, 'https://evil.example/x.png'] })).status).toBe(200)
    expect((await h.request(early)).status).toBe(200)
    const named = await json(await save(trial.id, trial.editToken, { products: [...edited, { id: 'p3', name: 'Nombre escrito después', price: 5000, imageUrl: early }] }))
    expect(named.products[2].imageUrl).toBe(early)
    expect((await h.request(early)).status).toBe(200)
    // A save prepared before an upload finished does not delete the new photo.
    const { url: fresh } = await json(await photo(trial.id, trial.editToken))
    await save(trial.id, trial.editToken, { products: edited })
    expect((await h.request(fresh)).status).toBe(200)
    // Without `keep`, an old unused photo is deleted.
    const { url: orphan } = await json(await photo(trial.id, trial.editToken))
    age()
    await save(trial.id, trial.editToken, { products: edited })
    expect((await h.request(orphan)).status).toBe(404)
    // Delete a product.
    expect((await json(await save(trial.id, trial.editToken, { products: [edited[0]] }))).products).toHaveLength(1)
  })

  it('6–8 · the shared link is read-only; only the device with the token can edit', async () => {
    const { trial } = await trialWithProducts(2)
    const shared = await json(await get(trial.id))
    expect(shared).toMatchObject({ owner: false, state: 'activa' })
    expect(shared.products).toHaveLength(2)
    expect(JSON.stringify(shared)).not.toContain(trial.editToken)
    expect((await save(trial.id, 'token-falso', { products: [] })).status).toBe(401)
    expect((await photo(trial.id, 'token-falso')).status).toBe(401)
    expect((await activate(trial.id, 'token-falso')).status).toBe(401)
    expect((await h.request(`/api/trial/${trial.id}`, { method: 'DELETE' })).status).toBe(401)
    // The authorised device (same token) keeps editing.
    expect((await json(await get(trial.id, trial.editToken))).owner).toBe(true)
    expect((await save(trial.id, trial.editToken, { businessName: 'Dulce Hogar Deco' })).status).toBe(200)
  })

  it('9 · reports the expiry and the deletion date from the configured duration', async () => {
    const trial = await json(await create())
    const hours = (Date.parse(trial.expiresAt) - Date.now()) / 3_600_000
    expect(hours).toBeGreaterThan(167.9)
    expect(hours).toBeLessThanOrEqual(168)
    expect((Date.parse(trial.deleteAfter) - Date.parse(trial.expiresAt)) / 3_600_000).toBeCloseTo(72, 1)
    const settings = await h.request('/api/platform/trials/settings', { method: 'PUT', token: admin, body: { durationHours: 24, maxProducts: 3, templates: ['clasica', 'stories'] } })
    expect(settings.status).toBe(200)
    const next = await json(await create({ businessName: 'Otra', template: 'boutique' }))
    expect((Date.parse(next.expiresAt) - Date.now()) / 3_600_000).toBeLessThanOrEqual(24)
    expect(next).toMatchObject({ template: 'clasica', limits: { maxProducts: 3, templates: ['clasica', 'stories'] } })
    expect((await h.request('/api/platform/trials/settings', { method: 'PUT', token: admin, body: { maxProducts: 99 } })).status).toBe(400)
    expect((await h.request('/api/platform/trials/settings', { method: 'PUT', body: { maxProducts: 2 } })).status).toBe(401)
    expect(await json(await h.request('/api/trial/config'))).toMatchObject({ enabled: true, maxProducts: 3, durationHours: 24 })
  })

  it('refuses fake images, foreign photo links, oversized photos and endless uploads', async () => {
    const trial = await json(await create())
    expect((await photo(trial.id, trial.editToken, new TextEncoder().encode('<script>alert(1)</script>'), 'image/png')).status).toBe(400)
    const other = await json(await create({ businessName: 'Otra prueba' }, '198.51.100.1'))
    const foreign = (await json(await photo(other.id, other.editToken))).url
    expect((await save(trial.id, trial.editToken, { products: [{ name: 'X', imageUrl: foreign }] })).status).toBe(400)
    expect((await save(trial.id, trial.editToken, { products: [{ name: 'X', imageUrl: 'https://evil.example/x.png' }] })).status).toBe(400)
    expect((await save(trial.id, trial.editToken, { logoUrl: foreign })).status).toBe(400)
    const big = new Uint8Array(3 * 1024 * 1024 + 10)
    big.set(createPng(4, 4))
    expect((await photo(trial.id, trial.editToken, big)).status).toBe(413)
    for (let i = 0; i < 32; i++) expect((await photo(trial.id, trial.editToken)).status).toBe(201)
    expect((await photo(trial.id, trial.editToken)).status).toBe(409)
    expect((await h.request(`/api/assets/trials/${trial.id}/x.png`)).status).toBe(404)
  })

  it('limits trials per IP and hour', async () => {
    for (let i = 0; i < 5; i++) expect((await create({ businessName: `Prueba ${i}` })).status).toBe(201)
    expect((await create({ businessName: 'Una más' })).status).toBe(429)
    expect((await create({ businessName: 'Desde otra red' }, '192.0.2.44')).status).toBe(201)
  })

  it('12 · an expired trial blocks edits, hides its catalogue publicly and is erased after the retention', async () => {
    const { trial } = await trialWithProducts(2)
    expire(trial.id)
    expect((await save(trial.id, trial.editToken, { businessName: 'Cambio' })).status).toBe(409)
    expect((await photo(trial.id, trial.editToken)).status).toBe(409)
    const shared = await json(await get(trial.id))
    expect(shared).toMatchObject({ state: 'vencida', products: [], logoUrl: null })
    expect(shared.deleteAfter).toBeTruthy()
    const owner = await json(await get(trial.id, trial.editToken))
    expect(owner).toMatchObject({ state: 'vencida', owner: true })
    expect(owner.products).toHaveLength(2) // still recoverable for its creator
    expect(await cleanupExpiredTrials(h.db, h.env.ASSETS)).toBe(0)
    h.db.sqlite.exec(`UPDATE trial_sessions SET retain_until = datetime('now', '-1 minute') WHERE id = '${trial.id}'`)
    expect(await cleanupExpiredTrials(h.db, h.env.ASSETS)).toBe(1)
    expect((await get(trial.id, trial.editToken)).status).toBe(410)
    expect([...h.assets.objects.keys()].some((key) => key.startsWith('trials/'))).toBe(false)
    expect(h.db.query<any>('SELECT status, content_json FROM trial_sessions WHERE id = ?', trial.id)[0]).toEqual({ status: 'eliminada', content_json: '{}' })
  })

  it('can be deleted by its creator and switched off by the platform', async () => {
    const trial = await json(await create())
    expect((await h.request(`/api/trial/${trial.id}`, { method: 'DELETE', headers: { 'X-Trial-Token': trial.editToken } })).status).toBe(200)
    expect((await get(trial.id)).status).toBe(410)
    h.env.TRIALS_ENABLED = 'false'
    expect((await create()).status).toBe(503)
  })
})

describe('real orders by WhatsApp', () => {
  const order = (id: string, body: Record<string, unknown>, ip = '198.51.100.20') => h.request(`/api/trial/${id}/orders`, { method: 'POST', body, headers: { 'CF-Connecting-IP': ip } })

  it('opens orders only with the merchant WhatsApp, computes totals on the server and lists them to the owner', async () => {
    const { trial, products } = await trialWithProducts(2)
    expect((await json(await get(trial.id))).ordersOpen).toBe(false)
    expect((await order(trial.id, { items: [{ productId: products[0]!.id, quantity: 1 }] })).status).toBe(409)
    expect((await save(trial.id, trial.editToken, { whatsapp: '300 123' })).status).toBe(400)
    const saved = await json(await save(trial.id, trial.editToken, { whatsapp: '+57 300 123 4567' }))
    expect(saved).toMatchObject({ whatsapp: '+573001234567', ordersOpen: true })
    const shared = await json(await get(trial.id))
    expect(shared).toMatchObject({ ordersOpen: true, whatsapp: null })

    const placed = await order(trial.id, { items: [{ productId: products[0]!.id, quantity: 2, price: 1 }, { productId: products[1]!.id, quantity: 1 }], customerName: 'Laura', note: 'Entrega en la tarde' })
    expect(placed.status).toBe(201)
    const result = await json(placed)
    expect(result.total).toBe(2 * 10000 + 20000) // the browser price is ignored
    expect(result.code).toMatch(/^PRB-[A-Z2-9]{6}$/)
    expect(result.whatsappUrl).toMatch(/^https:\/\/wa\.me\/573001234567\?text=/)
    const text = decodeURIComponent(result.whatsappUrl.split('text=')[1])
    expect(text).toContain('2 × Producto 1')
    expect(text).toContain('Total: $ 40.000')
    expect(text).toContain(result.code)
    expect(text).toContain('Laura')

    expect((await order(trial.id, { items: [{ productId: 'no-existe', quantity: 1 }] })).status).toBe(400)
    expect((await order(trial.id, { items: [{ productId: products[0]!.id, quantity: 0 }] })).status).toBe(400)
    expect((await order(trial.id, { items: [] })).status).toBe(400)

    expect((await h.request(`/api/trial/${trial.id}/orders`)).status).toBe(401)
    const listed = await json(await h.request(`/api/trial/${trial.id}/orders`, { headers: { 'X-Trial-Token': trial.editToken } }))
    expect(listed.items).toHaveLength(1)
    expect(listed.items[0]).toMatchObject({ code: result.code, total: 40000, customerName: 'Laura' })
    // No inventory or real store is touched.
    expect(h.db.query('SELECT COUNT(*) AS n FROM orders')).toEqual([{ n: 0 }])
    const metrics = await json(await h.request('/api/platform/trials/summary', { token: admin }))
    expect(metrics.orders).toEqual({ count: 1, trialsWithOrders: 1, amount: 40000 })
  })

  it('closes orders when the trial expires or the platform turns them off, and limits abuse', async () => {
    const { trial, products } = await trialWithProducts(1)
    await save(trial.id, trial.editToken, { whatsapp: '+573001234567' })
    const item = { items: [{ productId: products[0]!.id, quantity: 1 }] }
    for (let i = 0; i < 20; i++) expect((await order(trial.id, item)).status).toBe(201)
    expect((await order(trial.id, item)).status).toBe(429)
    expect((await order(trial.id, item, '198.51.100.21')).status).toBe(201)
    await h.request('/api/platform/trials/settings', { method: 'PUT', token: admin, body: { ordersEnabled: false } })
    expect((await json(await get(trial.id))).ordersOpen).toBe(false)
    expect((await order(trial.id, item, '198.51.100.22')).status).toBe(409)
    await h.request('/api/platform/trials/settings', { method: 'PUT', token: admin, body: { ordersEnabled: true } })
    expire(trial.id, 0)
    expect((await order(trial.id, item, '198.51.100.23')).status).toBe(409)
    await cleanupExpiredTrials(h.db, h.env.ASSETS)
    expect(h.db.query('SELECT COUNT(*) AS n FROM trial_orders')).toEqual([{ n: 0 }])
  })
})

describe('activation request and conversion to a store', () => {
  it('10–11 · contracts before expiry and becomes a draft store with the same name, design, logo, photos and products', async () => {
    const { trial } = await trialWithProducts(5)
    await save(trial.id, trial.editToken, { template: 'boutique' })
    expect((await activate(trial.id, trial.editToken, { consent: false })).status).toBe(400)
    expect((await activate(trial.id, trial.editToken, { email: 'no-es-correo' })).status).toBe(400)
    const requested = await activate(trial.id, trial.editToken)
    expect(requested.status).toBe(201)
    const { request } = await json(requested)
    expect(request).toMatchObject({ status: 'pendiente', planChoice: 'ia', planLabel: 'Catálogo IA' })
    expect(request.code).toMatch(/^TIE-[A-Z2-9]{6}$/)
    expect(JSON.stringify(request)).not.toContain('ana@')
    expect((await json(await h.request(`/api/trial/${trial.id}/activation`, { headers: { 'X-Trial-Token': trial.editToken } }))).request.code).toBe(request.code)
    // Pending requests keep the trial at least 14 days.
    const retain = h.db.query<any>('SELECT retain_until FROM trial_sessions WHERE id = ?', trial.id)[0].retain_until
    expect(Date.parse(`${retain.replace(' ', 'T')}Z`) - Date.now()).toBeGreaterThan(13 * 86_400_000)

    const list = await json(await h.request('/api/platform/trials/requests', { token: admin }))
    expect(list.items).toHaveLength(1)
    expect(list.items[0]).toMatchObject({ code: request.code, contact: { email: 'ana@dulcehogar.test', phone: '+573001112233' }, suggestedPlanCode: 'profesional', trial: { productCount: 5, template: 'boutique' } })
    expect((await h.request('/api/platform/trials/requests', {})).status).toBe(401)

    const converted = await h.request(`/api/platform/trials/requests/${list.items[0].id}/convert`, { method: 'POST', token: admin, body: {} })
    expect(converted.status).toBe(200)
    const result = await json(converted)
    expect(result).toMatchObject({ storeStatus: 'draft', imported: 5, skipped: [], planCode: 'profesional', delivery: 'manual' })
    expect(result.activationUrl).toMatch(/\/activar\?token=/)
    const store = h.db.query<any>('SELECT id, name, status, template, plan_code FROM stores WHERE id = ?', result.storeId)[0]
    expect(store).toMatchObject({ name: 'Dulce Hogar', status: 'draft', template: 'boutique', plan_code: 'profesional' })
    const config = h.db.query<any>('SELECT primary_color, logo_url, whatsapp_phone FROM store_config WHERE id = ?', store.id)[0]
    expect(config.logo_url).toMatch(new RegExp(`^/api/assets/stores/${store.id}/store/logo-`))
    expect(config.whatsapp_phone).toBe('+573001112233')
    const products = h.db.query<any>('SELECT sku, name, price, description, image_urls FROM products WHERE store_id = ? ORDER BY sku', store.id)
    expect(products.map((p) => p.sku)).toEqual(['PRUEBA-1', 'PRUEBA-2', 'PRUEBA-3', 'PRUEBA-4', 'PRUEBA-5'])
    expect(products[0]).toMatchObject({ name: 'Producto 1', price: 10000, description: 'Descripción 1' })
    const image = JSON.parse(products[0].image_urls)[0]
    expect(image).toMatch(new RegExp(`^/api/assets/stores/${store.id}/products/trial-`))
    expect(h.assets.objects.has(image.replace('/api/assets/', ''))).toBe(true)
    // The owner is a regular platform user (existing accounts system), linked only to the new store.
    expect(h.db.query<any>(`SELECT u.email, m.role FROM store_memberships m JOIN platform_users u ON u.id = m.user_id WHERE m.store_id = ?`, store.id)).toEqual([{ email: 'ana@dulcehogar.test', role: 'owner' }])
    // The trial is closed and its temporary files deleted.
    expect([...h.assets.objects.keys()].some((key) => key.startsWith(`trials/${trial.id}/`))).toBe(false)
    expect(await json(await get(trial.id, trial.editToken))).toMatchObject({ state: 'convertida', products: [] })
    expect((await save(trial.id, trial.editToken, { businessName: 'X' })).status).toBe(409)
    expect((await activate(trial.id, trial.editToken)).status).toBe(409)
    // No raw link or token stored.
    expect(h.db.query<any>('SELECT result_json FROM trial_conversions')[0].result_json).not.toContain('token=')
  })

  it('13 · converting twice never duplicates the store or the products', async () => {
    const { trial } = await trialWithProducts(3)
    await activate(trial.id, trial.editToken)
    const id = h.db.query<any>('SELECT id FROM trial_conversions')[0].id
    const first = await json(await h.request(`/api/platform/trials/requests/${id}/convert`, { method: 'POST', token: admin, body: {} }))
    const second = await json(await h.request(`/api/platform/trials/requests/${id}/convert`, { method: 'POST', token: admin, body: {} }))
    expect(second).toMatchObject({ storeId: first.storeId, replayed: true, activationUrl: null })
    expect(h.db.query('SELECT COUNT(*) AS n FROM stores WHERE name = ?', 'Dulce Hogar')).toEqual([{ n: 1 }])
    expect(h.db.query('SELECT COUNT(*) AS n FROM products WHERE store_id = ?', first.storeId)).toEqual([{ n: 3 }])
    // A retry after a partial failure (request still pending) resumes the same store without duplicates.
    h.db.sqlite.exec(`UPDATE trial_conversions SET status = 'pendiente', result_json = NULL; UPDATE trial_sessions SET status = 'activa'`)
    h.db.sqlite.exec(`UPDATE trial_sessions SET content_json = '${JSON.stringify({ logoUrl: null, colors: { primary: '#123456', accent: '#abcdef' }, products: [{ id: 'p1', name: 'Producto 1', price: 10000, description: '', imageUrl: null }] })}'`)
    const retry = await json(await h.request(`/api/platform/trials/requests/${id}/convert`, { method: 'POST', token: admin, body: {} }))
    expect(retry.storeId).toBe(first.storeId)
    expect(h.db.query('SELECT COUNT(*) AS n FROM stores WHERE name = ?', 'Dulce Hogar')).toEqual([{ n: 1 }])
    expect(h.db.query('SELECT COUNT(*) AS n FROM products WHERE store_id = ?', first.storeId)).toEqual([{ n: 3 }])
  })

  it('an expired trial can still be activated by its creator until it is deleted', async () => {
    const { trial } = await trialWithProducts(1)
    expire(trial.id)
    expect((await activate(trial.id, trial.editToken)).status).toBe(201)
    h.db.sqlite.exec(`UPDATE trial_sessions SET retain_until = datetime('now', '-1 minute')`)
    await cleanupExpiredTrials(h.db, h.env.ASSETS)
    const id = h.db.query<any>('SELECT id FROM trial_conversions')[0].id
    const refused = await h.request(`/api/platform/trials/requests/${id}/convert`, { method: 'POST', token: admin, body: {} })
    expect(refused.status).toBe(409)
    expect((await json(refused)).code).toBe('TRIAL_GONE')
  })

  it('reports real metrics and lets the platform discard a request', async () => {
    const a = await trialWithProducts(2)
    await create({ businessName: 'Sin productos', template: 'stories' }, '198.51.100.9')
    await activate(a.trial.id, a.trial.editToken)
    const metrics = await json(await h.request('/api/platform/trials/summary', { token: admin }))
    expect(metrics).toMatchObject({ created: 2, active: 2, expired: 0, converted: 0, withoutProducts: 1, requests: { pending: 1, total: 1 } })
    expect(metrics.templates).toEqual(expect.arrayContaining([{ template: 'clasica', count: 1 }, { template: 'stories', count: 1 }]))
    const id = h.db.query<any>('SELECT id FROM trial_conversions')[0].id
    expect((await h.request(`/api/platform/trials/requests/${id}/discard`, { method: 'POST', token: admin })).status).toBe(200)
    expect((await h.request(`/api/platform/trials/requests/${id}/discard`, { method: 'POST', token: admin })).status).toBe(409)
    expect((await h.request(`/api/platform/trials/requests/${id}/convert`, { method: 'POST', token: admin, body: {} })).status).toBe(409)
  })

  it('14 · leaves existing stores, products and orders untouched', async () => {
    const storeId = await seedStore(h.db, { slug: 'luz-magica', name: 'Luz Mágica' })
    await seedCatalog(h.db, storeId, { products: [{ sku: 'LM-1', name: 'Lámpara', price: 50000, variants: [{ stock: 4 }] }] })
    const before = JSON.stringify(h.db.query('SELECT id, slug, name, status, plan_code FROM stores ORDER BY id')) + JSON.stringify(h.db.query('SELECT id, store_id, sku, name, price, image_urls FROM products ORDER BY id')) + JSON.stringify(h.db.query('SELECT * FROM product_variants ORDER BY id'))
    const { trial } = await trialWithProducts(2)
    await save(trial.id, trial.editToken, { template: 'stories' })
    await activate(trial.id, trial.editToken)
    expire(trial.id)
    await cleanupExpiredTrials(h.db, h.env.ASSETS)
    const after = JSON.stringify(h.db.query('SELECT id, slug, name, status, plan_code FROM stores ORDER BY id')) + JSON.stringify(h.db.query('SELECT id, store_id, sku, name, price, image_urls FROM products ORDER BY id')) + JSON.stringify(h.db.query('SELECT * FROM product_variants ORDER BY id'))
    expect(after).toBe(before)
    expect(h.db.query('SELECT COUNT(*) AS n FROM orders')).toEqual([{ n: 0 }])
  })
})
