import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHarness, createStoreUser, seedCatalog, seedStore, superadminToken, userToken, type Harness } from '../testing/harness'
import { processTrialLifecycle, TRIAL_DAYS, TRIAL_PRODUCTS } from '../services/freeTrial'
import { generateInvoices } from '../services/billing'

type Sent = { to: string; subject: string; html: string; text: string; replyTo: string | null; idempotencyKey: string | null }

let h: Harness
let sent: Sent[]
let admin: string
let otherStore: number
let otherOwner: string
let providerDown = false

const json = async (response: Response) => response.json() as Promise<any>
const ip = (n: number) => ({ 'CF-Connecting-IP': `198.51.100.${n}` })
const linkIn = (text: string) => text.match(/https:\/\/[^\s"<]+\/admin\/activar\?token=[^\s"<&]+/)?.[0] ?? null
const tokenOf = (link: string) => decodeURIComponent(new URL(link).searchParams.get('token') || '')
const signup = (body: Record<string, unknown>, n = 1) => h.request('/api/signup', { method: 'POST', body: { acceptTerms: true, ...body }, headers: ip(n) })
const q = <T = any>(sql: string, ...params: unknown[]) => h.db.query<T>(sql, ...params)

async function createTrial(email = 'ana@flores.co', name = 'Flores de Ana', n = 1) {
  const response = await signup({ businessName: name, email, ownerName: 'Ana Pérez', whatsapp: '+57 300 111 2233' }, n)
  expect(response.status).toBe(202)
  const store = q<{ id: number; slug: string }>(`SELECT s.id, s.slug FROM stores s JOIN store_memberships m ON m.store_id = s.id JOIN platform_users u ON u.id = m.user_id WHERE u.email = ?`, email)[0]!
  const mail = [...sent].reverse().find((item) => item.to === email && /Confirma tu correo/.test(item.subject))!
  return { store, link: linkIn(mail.text)! }
}

async function activate(link: string, password = 'ClaveSegura123') {
  const response = await h.request('/api/auth/activate', { method: 'POST', body: { token: tokenOf(link), password } })
  return { response, body: await json(response) }
}

async function readyTrial(email = 'ana@flores.co', name = 'Flores de Ana', n = 1) {
  const { store, link } = await createTrial(email, name, n)
  const { body } = await activate(link)
  return { store, token: body.token as string }
}

const product = (index: number) => ({ sku: `P-${index}`, name: `Producto ${index}`, price: 10000 + index, imageUrls: [], variants: [{ size: 'M', color: 'Rojo', stock: 5 }] })
const createProduct = (token: string, slug: string, index: number) => h.request('/api/admin/products', { method: 'POST', token, store: slug, body: product(index) })

beforeEach(async () => {
  h = createHarness({ EMAIL_PROVIDER: 'resend', EMAIL_FROM: 'TiendIA Exprés <notificaciones@tiendas.test>', RESEND_API_KEY: 'test-key', EMAIL_REPLY_TO: 'soporte@tiendas.test', EMAIL_REPLY_TO_SALES: 'ventas@tiendas.test' })
  admin = await superadminToken()
  otherStore = await seedStore(h.db, { slug: 'otra-tienda', name: 'Otra tienda' })
  otherOwner = await userToken(await createStoreUser(h.db, { email: 'dueno@otra.co', password: 'ClaveSegura123', storeId: otherStore, role: 'owner' }), 'dueno@otra.co')
  sent = []
  providerDown = false
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).startsWith('https://api.resend.com/emails')) {
      if (providerDown) return new Response('{"message":"down"}', { status: 503 })
      const body = JSON.parse(String(init?.body))
      sent.push({ to: body.to[0], subject: body.subject, html: body.html, text: body.text, replyTo: body.reply_to ?? null, idempotencyKey: new Headers(init?.headers).get('Idempotency-Key') })
      return new Response(JSON.stringify({ id: `msg_${sent.length}` }))
    }
    return new Response('{}', { status: 404 })
  }))
})
afterEach(() => vi.unstubAllGlobals())

describe('1-3 · sign-up, email verification and access to the normal panel', () => {
  it('creates a normal store in draft with a pending trial, and emails a one-time link (no password in the email)', async () => {
    const { store, link } = await createTrial()
    expect(link).toMatch(new RegExp(`^https://tiendas\\.test/t/${store.slug}/admin/activar\\?token=`))
    const row = q(`SELECT s.status, s.plan_code AS plan, s.ai_enabled AS ai, s.ai_monthly_budget_micros AS budget, s.trial_ends_at AS ends, t.status AS trial, t.product_limit AS lim FROM stores s JOIN store_trials t ON t.store_id = s.id WHERE s.id = ?`, store.id)[0]
    expect(row).toEqual({ status: 'draft', plan: 'prueba', ai: 0, budget: 0, ends: null, trial: 'pendiente', lim: TRIAL_PRODUCTS })
    expect(q(`SELECT COUNT(*) AS n FROM store_services WHERE store_id = ?`, store.id)).toEqual([{ n: 0 }])
    expect(q(`SELECT status, password_hash FROM platform_users WHERE email = 'ana@flores.co'`)).toEqual([{ status: 'invited', password_hash: null }])
    expect(sent).toHaveLength(1)
    expect(sent[0]!.subject).toBe('Confirma tu correo y entra a Flores de Ana | TiendIA Exprés')
    expect(sent[0]!.html).toContain('TiendIA Exprés')
    expect(sent[0]!.text).toContain('Sin tarjeta de crédito')
    // The link is never stored in clear and the public cannot see the store before the email is confirmed.
    expect(JSON.stringify(q('SELECT * FROM email_messages'))).not.toContain(tokenOf(link))
    expect(JSON.stringify(q('SELECT * FROM audit_log'))).not.toContain(tokenOf(link))
    expect((await h.request('/api/store', { store: store.slug })).status).toBe(404)
  })

  it('confirming the email sets the password, verifies the address, starts the trial days, publishes the store and opens the same panel', async () => {
    const { store, link } = await createTrial()
    const { response, body } = await activate(link)
    expect(response.status).toBe(200)
    expect(body.store.slug).toBe(store.slug)
    const row = q(`SELECT s.status, s.trial_ends_at AS ends, t.status AS trial, t.expires_at AS expires, u.email_verified_at IS NOT NULL AS verified
      FROM stores s JOIN store_trials t ON t.store_id = s.id JOIN store_memberships m ON m.store_id = s.id JOIN platform_users u ON u.id = m.user_id WHERE s.id = ?`, store.id)[0]
    expect(row).toMatchObject({ status: 'active', trial: 'activa', verified: 1 })
    expect(row.ends).toBe(row.expires)
    const days = (Date.parse(`${row.expires.replace(' ', 'T')}Z`) - Date.now()) / 86_400_000
    expect(days).toBeGreaterThan(TRIAL_DAYS - 0.1)
    expect(days).toBeLessThanOrEqual(TRIAL_DAYS)
    expect(sent.map((item) => item.subject)).toContain(`Tu prueba gratis de ${TRIAL_DAYS} días empezó | TiendIA Exprés`)
    // Same panel endpoints as paying merchants.
    const session = await json(await h.request('/api/admin/session', { token: body.token, store: store.slug }))
    expect(session).toMatchObject({ role: 'owner', store: { id: store.id, slug: store.slug, planCode: 'prueba' } })
    const status = await json(await h.request('/api/admin/trial', { token: body.token, store: store.slug }))
    expect(status.trial).toMatchObject({ status: 'activa', daysLeft: TRIAL_DAYS, productLimit: TRIAL_PRODUCTS, productCount: 0, emailVerified: true })
    expect(status.plans.map((plan: any) => [plan.code, plan.amounts])).toEqual([
      ['emprendedor', { mensual: 208900, anual: 599000 }], ['negocio', { mensual: 298900, anual: 999000 }], ['mayorista', { mensual: 468900, anual: 1699000 }],
    ])
    expect(status.trial.messages.map((m: any) => m.purpose)).toEqual(['trial_welcome', 'trial_signup'])
    expect((await h.request('/api/store', { store: store.slug })).status).toBe(200)
    // The link works once.
    expect((await activate(link)).response.status).toBe(404)
  })

  it('never reveals existing accounts, never duplicates a store and rejects bots, throwaway inboxes and floods', async () => {
    await createTrial()
    const again = await signup({ businessName: 'Otra tienda de Ana', email: 'ANA@flores.co' }, 2)
    expect(again.status).toBe(202)
    expect(await json(again)).toEqual({ ok: true })
    expect(q(`SELECT COUNT(*) AS n FROM store_trials`)).toEqual([{ n: 1 }])
    // Existing paying account: a notice without any link that grants access, and no new store.
    const existing = await signup({ businessName: 'Tienda nueva', email: 'dueno@otra.co' }, 3)
    expect(await json(existing)).toEqual({ ok: true })
    expect(sent.at(-1)!.subject).toBe('Ya tienes una cuenta en TiendIA Exprés')
    expect(sent.at(-1)!.text).not.toMatch(/token=/)
    expect(q(`SELECT COUNT(*) AS n FROM stores`)).toEqual([{ n: 3 }])
    // Honeypot: same answer, nothing created.
    const bot = await signup({ businessName: 'Bot', email: 'bot@ejemplo.co', website: 'https://spam.example' }, 4)
    expect(await json(bot)).toEqual({ ok: true })
    expect(q(`SELECT COUNT(*) AS n FROM platform_users WHERE email = 'bot@ejemplo.co'`)).toEqual([{ n: 0 }])
    expect((await signup({ businessName: 'Temporal', email: 'x@mailinator.com' }, 5)).status).toBe(400)
    expect((await signup({ businessName: 'Sin términos', email: 'a@b.co', acceptTerms: false }, 5)).status).toBe(400)
    for (let i = 0; i < 3; i++) await signup({ businessName: `Flood ${i}`, email: `flood${i}@ejemplo.co` }, 9)
    expect((await signup({ businessName: 'Flood 4', email: 'flood4@ejemplo.co' }, 9)).status).toBe(429)
  })

  it('keeps the store when the email fails and lets the person ask for the link again, safely', async () => {
    providerDown = true
    const response = await signup({ businessName: 'Correo caído', email: 'caido@ejemplo.co' }, 11)
    expect(response.status).toBe(202)
    expect(q(`SELECT status FROM email_messages WHERE purpose = 'trial_signup'`)).toEqual([{ status: 'fallido' }])
    expect(q(`SELECT t.status FROM store_trials t`)).toEqual([{ status: 'pendiente' }])
    expect(q(`SELECT code FROM platform_events WHERE code = 'TRIAL_SIGNUP_EMAIL_NOT_SENT'`)).toHaveLength(1)
    providerDown = false
    // Cooldown: a resend right after a failed attempt waits two minutes.
    h.db.sqlite.exec(`UPDATE email_messages SET created_at = datetime('now', '-5 minutes')`)
    expect(await json(await h.request('/api/signup/resend', { method: 'POST', body: { email: 'caido@ejemplo.co' }, headers: ip(12) }))).toEqual({ ok: true })
    expect(sent).toHaveLength(1)
    const first = linkIn(sent[0]!.text)!
    expect(await json(await h.request('/api/signup/resend', { method: 'POST', body: { email: 'caido@ejemplo.co' }, headers: ip(12) }))).toEqual({ ok: true })
    expect(sent).toHaveLength(1)
    h.db.sqlite.exec(`UPDATE email_messages SET created_at = datetime('now', '-5 minutes')`)
    await h.request('/api/signup/resend', { method: 'POST', body: { email: 'caido@ejemplo.co' }, headers: ip(12) })
    expect(sent).toHaveLength(2)
    // Only the newest link works; unknown addresses get the same answer.
    expect((await activate(first)).response.status).toBe(404)
    expect((await activate(linkIn(sent[1]!.text)!)).response.status).toBe(200)
    expect(await json(await h.request('/api/signup/resend', { method: 'POST', body: { email: 'nadie@ejemplo.co' }, headers: ip(12) }))).toEqual({ ok: true })
    expect(q(`SELECT COUNT(*) AS n FROM stores WHERE plan_code = 'prueba'`)).toEqual([{ n: 1 }])
  })
})

describe('4-8 · products, configuration and orders during the trial', () => {
  it('allows the trial products, rejects the next one in the backend, and lets the merchant edit, archive and restore within the limit', async () => {
    const { store, token } = await readyTrial()
    for (let i = 1; i <= TRIAL_PRODUCTS; i++) expect((await createProduct(token, store.slug, i)).status).toBe(201)
    const eighth = await createProduct(token, store.slug, 100)
    expect(eighth.status).toBe(409)
    expect(await json(eighth)).toMatchObject({ code: 'TRIAL_PRODUCT_LIMIT', limit: TRIAL_PRODUCTS, count: TRIAL_PRODUCTS })
    const ids = q<{ id: number }>(`SELECT id FROM products WHERE store_id = ? ORDER BY id`, store.id).map((row) => row.id)
    expect((await h.request(`/api/admin/products/${ids[0]}`, { method: 'PUT', token, store: store.slug, body: { name: 'Ramo editado', price: 55000 } })).status).toBe(200)
    expect((await h.request(`/api/admin/products/${ids[1]}`, { method: 'DELETE', token, store: store.slug })).status).toBe(200)
    expect((await createProduct(token, store.slug, 101)).status).toBe(201)
    const restore = await h.request(`/api/admin/products/${ids[1]}/restore`, { method: 'POST', token, store: store.slug })
    expect(restore.status).toBe(409)
    expect(q(`SELECT COUNT(*) AS n FROM products WHERE store_id = ? AND is_archived = 0`, store.id)).toEqual([{ n: TRIAL_PRODUCTS }])
    // The browser cannot change the limit: it lives in the backend.
    expect((await h.request('/api/admin/store', { method: 'PUT', token, store: store.slug, body: { product_limit: 50, plan_code: 'mayorista' } })).status).toBeLessThan(500)
    expect(q(`SELECT plan_code FROM stores WHERE id = ?`, store.id)).toEqual([{ plan_code: 'prueba' }])
    expect((await createProduct(token, store.slug, 102)).status).toBe(409)
  })

  it('a parallel burst at the last slot creates at most one product', async () => {
    const { store, token } = await readyTrial()
    for (let i = 1; i <= TRIAL_PRODUCTS - 1; i++) await createProduct(token, store.slug, i)
    const results = await Promise.all([createProduct(token, store.slug, 50), createProduct(token, store.slug, 51), createProduct(token, store.slug, 52)])
    expect(results.filter((response) => response.status === 201)).toHaveLength(1)
    expect(q(`SELECT COUNT(*) AS n FROM products WHERE store_id = ?`, store.id)).toEqual([{ n: TRIAL_PRODUCTS }])
  })

  it('configures the store, takes real orders and keeps premium AI and credits off', async () => {
    const { store, token } = await readyTrial()
    expect((await h.request('/api/admin/store', { method: 'PUT', token, store: store.slug, body: { name: 'Flores de Ana Premium', primary_color: '#A414CF' } })).status).toBe(200)
    expect(q(`SELECT name, primary_color FROM store_config WHERE id = ?`, store.id)).toEqual([{ name: 'Flores de Ana Premium', primary_color: '#A414CF' }])
    expect((await h.request('/api/admin/categories', { method: 'POST', token, store: store.slug, body: { name: 'Ramos', slug: 'ramos' } })).status).toBe(201)
    await createProduct(token, store.slug, 1)
    const productRow = q<{ id: number; variant: number }>(`SELECT p.id, v.id AS variant FROM products p JOIN product_variants v ON v.product_id = p.id WHERE p.store_id = ?`, store.id)[0]!
    const order = await h.request('/api/orders', { method: 'POST', store: store.slug, headers: { 'Idempotency-Key': 'trial-order-0000000001' }, body: { customerName: 'Cliente', items: [{ productId: productRow.id, variantId: productRow.variant, sku: 'X', name: 'X', price: 1, quantity: 1 }] } })
    expect(order.status).toBe(201)
    const orders = await json(await h.request('/api/orders', { token, store: store.slug }))
    expect(JSON.stringify(orders)).toContain('Producto 1')
    expect((await h.request('/api/admin/credits/requests', { method: 'POST', token, store: store.slug, body: { credits: 100, note: 'quiero' } })).status).toBe(403)
    expect(q(`SELECT ai_enabled, ai_monthly_budget_micros FROM stores WHERE id = ?`, store.id)).toEqual([{ ai_enabled: 0, ai_monthly_budget_micros: 0 }])
  })
})

describe('9 · expiry and notices', () => {
  it('notices at 3 days and 1 day, once each; at the end keeps the data, hides the store and blocks new orders and products', async () => {
    const { store, token } = await readyTrial()
    await createProduct(token, store.slug, 1)
    const productRow = q<{ id: number; variant: number }>(`SELECT p.id, v.id AS variant FROM products p JOIN product_variants v ON v.product_id = p.id WHERE p.store_id = ?`, store.id)[0]!
    const setEnd = (modifier: string) => h.db.sqlite.exec(`UPDATE store_trials SET expires_at = datetime('now', '${modifier}') WHERE store_id = ${store.id}; UPDATE stores SET trial_ends_at = (SELECT expires_at FROM store_trials WHERE store_id = ${store.id}) WHERE id = ${store.id}`)
    setEnd('+60 hours')
    await processTrialLifecycle(h.db, h.env)
    await processTrialLifecycle(h.db, h.env)
    const expiring = sent.filter((item) => /Tu prueba termina/.test(item.subject))
    expect(expiring).toHaveLength(1)
    expect(expiring[0]!.subject).toContain('3 día(s)')
    expect(expiring[0]!.replyTo).toBe('ventas@tiendas.test')
    expect(expiring[0]!.text).toContain(`/t/${store.slug}/admin/activar-tienda`)
    setEnd('+20 hours')
    await processTrialLifecycle(h.db, h.env)
    await processTrialLifecycle(h.db, h.env)
    expect(sent.filter((item) => /Tu prueba termina en 1 día/.test(item.subject))).toHaveLength(1)
    setEnd('-1 minutes')
    // Even before the scheduler runs, the backend already treats it as ended.
    expect((await h.request('/api/store', { store: store.slug })).status).toBe(404)
    await processTrialLifecycle(h.db, h.env)
    await processTrialLifecycle(h.db, h.env)
    expect(sent.filter((item) => /Tu prueba terminó/.test(item.subject))).toHaveLength(1)
    expect(q(`SELECT status FROM store_trials WHERE store_id = ?`, store.id)).toEqual([{ status: 'vencida' }])
    const publicStore = await h.request('/api/store', { store: store.slug })
    expect(publicStore.status).toBe(404)
    expect(await json(publicStore)).toMatchObject({ code: 'TRIAL_EXPIRED' })
    const order = await h.request('/api/orders', { method: 'POST', store: store.slug, token, headers: { 'Idempotency-Key': 'trial-order-expired-000001' }, body: { items: [{ productId: productRow.id, variantId: productRow.variant, sku: 'X', name: 'X', price: 1, quantity: 1 }] } })
    expect(order.status).toBe(409)
    expect(await json(order)).toMatchObject({ code: 'TRIAL_EXPIRED' })
    expect(await json(await createProduct(token, store.slug, 2))).toMatchObject({ code: 'TRIAL_EXPIRED' })
    // The merchant can still read everything and contract a plan.
    expect((await h.request('/api/admin/stats', { token, store: store.slug })).status).toBe(200)
    expect((await h.request('/api/products', { token, store: store.slug })).status).toBe(200)
    const status = await json(await h.request('/api/admin/trial', { token, store: store.slug }))
    expect(status.trial).toMatchObject({ status: 'vencida', daysLeft: 0, productCount: 1 })
    expect(status.plans).toHaveLength(3)
    expect(q(`SELECT COUNT(*) AS n FROM products WHERE store_id = ?`, store.id)).toEqual([{ n: 1 }])
  })

  it('only the superadmin extends a trial, with a reason, a cap and an audit entry; it reopens an ended trial', async () => {
    const { store, token } = await readyTrial()
    h.db.sqlite.exec(`UPDATE store_trials SET expires_at = datetime('now', '-1 hours') WHERE store_id = ${store.id}; UPDATE stores SET trial_ends_at = datetime('now', '-1 hours') WHERE id = ${store.id}`)
    await processTrialLifecycle(h.db, h.env)
    expect((await h.request(`/api/platform/trial-stores/${store.slug}/extend`, { method: 'POST', token, body: { days: 5, reason: 'pidió más tiempo' } })).status).toBe(403)
    expect((await h.request(`/api/platform/trial-stores/${store.slug}/extend`, { method: 'POST', token: admin, body: { days: 5 } })).status).toBe(400)
    const extended = await json(await h.request(`/api/platform/trial-stores/${store.slug}/extend`, { method: 'POST', token: admin, body: { days: 5, reason: 'Pidió más tiempo por WhatsApp' } }))
    expect(extended.extendedDays).toBe(5)
    expect(q(`SELECT status FROM store_trials WHERE store_id = ?`, store.id)).toEqual([{ status: 'activa' }])
    expect((await h.request('/api/store', { store: store.slug })).status).toBe(200)
    expect(q(`SELECT performed_by FROM audit_log WHERE action = 'trial_extended'`)[0].performed_by).toBe('platform:platform@admin.test')
    expect((await h.request(`/api/platform/trial-stores/${store.slug}/extend`, { method: 'POST', token: admin, body: { days: 14, reason: 'otra vez' } })).status).toBe(200)
    expect((await h.request(`/api/platform/trial-stores/${store.slug}/extend`, { method: 'POST', token: admin, body: { days: 14, reason: 'y otra vez' } })).status).toBe(409)
  })
})

describe('10-11 · access recovery', () => {
  it('a confirmed owner recovers the account by email', async () => {
    await readyTrial()
    const before = sent.length
    expect((await h.request('/api/auth/password-reset/request', { method: 'POST', body: { email: 'ana@flores.co' }, headers: ip(30) })).status).toBe(200)
    expect(sent.length).toBe(before + 1)
    expect(sent.at(-1)!.subject).toBe('Restablece tu contraseña | TiendIA Exprés')
  })
})

describe('12-19 · from trial to plan: same store, nothing lost', () => {
  async function trialWithData() {
    const { store, token } = await readyTrial()
    await h.request('/api/admin/categories', { method: 'POST', token, store: store.slug, body: { name: 'Ramos', slug: 'ramos' } })
    for (let i = 1; i <= TRIAL_PRODUCTS; i++) {
      await h.request('/api/admin/products', { method: 'POST', token, store: store.slug, body: { ...product(i), imageUrls: [`/api/assets/stores/${store.id}/products/foto-${i}.jpg`], variants: [{ size: 'S', stock: 3 }, { size: 'M', stock: 4 }] } })
    }
    await h.request('/api/admin/store', { method: 'PUT', token, store: store.slug, body: { primary_color: '#A414CF', logo_url: `/api/assets/stores/${store.id}/logo.png` } })
    const productRow = q<{ id: number; variant: number }>(`SELECT p.id, v.id AS variant FROM products p JOIN product_variants v ON v.product_id = p.id WHERE p.store_id = ? LIMIT 1`, store.id)[0]!
    await h.request('/api/orders', { method: 'POST', store: store.slug, headers: { 'Idempotency-Key': 'trial-order-keep-00000001' }, body: { customerName: 'Cliente fiel', items: [{ productId: productRow.id, variantId: productRow.variant, sku: 'X', name: 'X', price: 1, quantity: 2 }] } })
    return { store, token }
  }
  const snapshot = (storeId: number) => ({
    store: q(`SELECT id, slug, name, created_at FROM stores WHERE id = ?`, storeId),
    owner: q(`SELECT user_id, role, status FROM store_memberships WHERE store_id = ?`, storeId),
    products: q(`SELECT id, sku, name, price, image_urls, category_id, is_archived, created_at FROM products WHERE store_id = ? ORDER BY id`, storeId),
    variants: q(`SELECT v.id, v.sku, v.size, v.stock FROM product_variants v JOIN products p ON p.id = v.product_id WHERE p.store_id = ? ORDER BY v.id`, storeId),
    categories: q(`SELECT id, slug, name FROM categories WHERE store_id = ? ORDER BY id`, storeId),
    orders: q(`SELECT id, display_id, items_json, subtotal, status FROM orders WHERE store_id = ? ORDER BY id`, storeId),
    config: q(`SELECT * FROM store_config WHERE id = ?`, storeId),
    audit: q<{ n: number }>(`SELECT COUNT(*) AS n FROM audit_log WHERE store_id = ?`, storeId)[0]!.n,
  })

  it('requests a plan (pending invoice, no rights yet), then the verified payment converts the SAME store keeping everything', async () => {
    const { store, token } = await trialWithData()
    const before = snapshot(store.id)
    expect(before.products).toHaveLength(TRIAL_PRODUCTS)
    expect(before.orders).toHaveLength(1)
    const request = await h.request('/api/admin/trial/plan-request', { method: 'POST', token, store: store.slug, body: { planCode: 'emprendedor', cycle: 'mensual' } })
    expect(request.status).toBe(201)
    const { request: created } = await json(request)
    expect(created).toMatchObject({ planCode: 'emprendedor', cycle: 'mensual', amount: 208900, status: 'pendiente_pago' })
    expect(created.code).toMatch(/^ACT-[A-Z2-9]{6}$/)
    const mail = sent.find((item) => /Recibimos tu solicitud/.test(item.subject))!
    expect(mail.text).toContain('$208.900 COP')
    expect(mail.replyTo).toBe('ventas@tiendas.test')
    expect(q(`SELECT status, amount FROM store_invoices WHERE store_id = ?`, store.id)).toEqual([{ status: 'pendiente', amount: 208900 }])
    // Asking again (double click) does not duplicate; the plan is not enabled by the merchant's claim.
    expect((await h.request('/api/admin/trial/plan-request', { method: 'POST', token, store: store.slug, body: { planCode: 'emprendedor', cycle: 'mensual' } })).status).toBe(200)
    expect(q(`SELECT COUNT(*) AS n FROM store_plan_requests`)).toEqual([{ n: 1 }])
    expect(q(`SELECT plan_code FROM stores WHERE id = ?`, store.id)).toEqual([{ plan_code: 'prueba' }])
    expect((await createProduct(token, store.slug, 300)).status).toBe(409)
    // Only the platform verifies payments, with an explicit confirmation and a reference.
    const id = q<{ id: number }>(`SELECT id FROM store_plan_requests`)[0]!.id
    expect((await h.request(`/api/platform/plan-requests/${id}/activate`, { method: 'POST', token, body: { confirm: true, paymentReference: 'yo pagué' } })).status).toBe(403)
    expect((await h.request(`/api/platform/plan-requests/${id}/activate`, { method: 'POST', token: admin, body: { paymentReference: 'TRF-123' } })).status).toBe(400)
    expect((await h.request(`/api/platform/plan-requests/${id}/activate`, { method: 'POST', token: admin, body: { confirm: true, paymentReference: '' } })).status).toBe(400)
    const activated = await json(await h.request(`/api/platform/plan-requests/${id}/activate`, { method: 'POST', token: admin, body: { confirm: true, paymentReference: 'Transferencia Bancolombia 0042' } }))
    expect(activated).toMatchObject({ status: 'activada', replayed: false, storeId: store.id, planCode: 'emprendedor' })
    // Same id, slug, owner, catalogue, photos, variants, categories, orders, settings; audit only grows.
    const after = snapshot(store.id)
    expect({ ...after, audit: 0 }).toEqual({ ...before, audit: 0 })
    expect(after.audit).toBeGreaterThan(before.audit)
    expect(q(`SELECT COUNT(*) AS n FROM stores`)).toEqual([{ n: 3 }])
    expect(q(`SELECT s.status, s.plan_code AS plan, s.trial_ends_at AS ends, s.ai_enabled AS ai, t.status AS trial, t.converted_plan_code AS converted
      FROM stores s JOIN store_trials t ON t.store_id = s.id WHERE s.id = ?`, store.id)).toEqual([{ status: 'active', plan: 'emprendedor', ends: null, ai: 1, trial: 'convertida', converted: 'emprendedor' }])
    expect(q(`SELECT status FROM store_invoices WHERE store_id = ?`, store.id)).toEqual([{ status: 'pagada' }])
    expect(sent.filter((item) => /Pago confirmado/.test(item.subject))).toHaveLength(1)
    // New capabilities: the trial limit is gone (Emprendedor allows 150 products).
    expect((await createProduct(token, store.slug, 301)).status).toBe(201)
    const status = await json(await h.request('/api/admin/trial', { token, store: store.slug }))
    expect(status.trial.status).toBe('convertida')
    expect(status.plans).toEqual([])
    // Retries and parallel clicks change nothing twice.
    const replays = await Promise.all([1, 2, 3].map(() => h.request(`/api/platform/plan-requests/${id}/activate`, { method: 'POST', token: admin, body: { confirm: true, paymentReference: 'otra vez' } }).then(json)))
    expect(replays.every((result) => result.replayed === true)).toBe(true)
    expect(q(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'plan_activated'`)).toEqual([{ n: 1 }])
    expect(sent.filter((item) => /Pago confirmado/.test(item.subject))).toHaveLength(1)
    // The invoice generator does not bill the month that was just paid.
    const period = new Date().toISOString().slice(0, 7)
    await generateInvoices(h.db, period, 'test')
    expect(q(`SELECT COUNT(*) AS n FROM store_invoices WHERE store_id = ?`, store.id)).toEqual([{ n: 1 }])
  })

  it('the existing manual step "invoice paid" (panel or master bot) activates the plan through the same transaction', async () => {
    const { store, token } = await trialWithData()
    await h.request('/api/admin/trial/plan-request', { method: 'POST', token, store: store.slug, body: { planCode: 'negocio', cycle: 'anual' } })
    const invoice = q<{ id: number; amount: number }>(`SELECT id, amount FROM store_invoices WHERE store_id = ?`, store.id)[0]!
    expect(invoice.amount).toBe(999000)
    const paid = await json(await h.request(`/api/platform/invoices/${invoice.id}/status`, { method: 'POST', token: admin, body: { status: 'pagada' } }))
    expect(paid.status).toBe('pagada')
    expect(q(`SELECT plan_code, trial_ends_at FROM stores WHERE id = ?`, store.id)).toEqual([{ plan_code: 'negocio', trial_ends_at: null }])
    expect(q(`SELECT status, payment_reference FROM store_plan_requests`)).toEqual([{ status: 'activada', payment_reference: `Factura #${invoice.id} marcada como pagada` }])
    // Annual payment: no monthly plan invoices during the paid year.
    const next = new Date()
    next.setUTCMonth(next.getUTCMonth() + 2)
    await generateInvoices(h.db, next.toISOString().slice(0, 7), 'test')
    expect(q(`SELECT COUNT(*) AS n FROM store_invoices WHERE store_id = ?`, store.id)).toEqual([{ n: 1 }])
  })

  it('changing the plan replaces the pending request (old invoice voided); a voided invoice cancels it and the trial stays', async () => {
    const { store, token } = await readyTrial()
    await h.request('/api/admin/trial/plan-request', { method: 'POST', token, store: store.slug, body: { planCode: 'emprendedor', cycle: 'mensual' } })
    await h.request('/api/admin/trial/plan-request', { method: 'POST', token, store: store.slug, body: { planCode: 'mayorista', cycle: 'mensual' } })
    expect(q(`SELECT plan_code, status FROM store_plan_requests ORDER BY id`)).toEqual([{ plan_code: 'emprendedor', status: 'cancelada' }, { plan_code: 'mayorista', status: 'pendiente_pago' }])
    expect(q(`SELECT status FROM store_invoices WHERE store_id = ? ORDER BY id`, store.id)).toEqual([{ status: 'anulada' }, { status: 'pendiente' }])
    const open = q<{ invoice_id: number }>(`SELECT invoice_id FROM store_plan_requests WHERE status = 'pendiente_pago'`)[0]!
    await h.request(`/api/platform/invoices/${open.invoice_id}/status`, { method: 'POST', token: admin, body: { status: 'anulada' } })
    expect(q(`SELECT status FROM store_plan_requests ORDER BY id`)).toEqual([{ status: 'cancelada' }, { status: 'cancelada' }])
    expect(q(`SELECT plan_code FROM stores WHERE id = ?`, store.id)).toEqual([{ plan_code: 'prueba' }])
  })

  it('isolation: nobody reaches another store by changing the store selector, and only owners contract', async () => {
    const { store, token } = await readyTrial()
    expect((await h.request('/api/admin/trial', { token: otherOwner, store: store.slug })).status).toBe(403)
    expect((await h.request('/api/admin/trial/plan-request', { method: 'POST', token: otherOwner, store: store.slug, body: { planCode: 'emprendedor', cycle: 'mensual' } })).status).toBe(403)
    expect((await h.request('/api/admin/trial', { token, store: 'otra-tienda' })).status).toBe(403)
    expect((await createProduct(token, 'otra-tienda', 1)).status).toBe(403)
    // A paying store has no trial and cannot use the trial contract.
    const paid = await json(await h.request('/api/admin/trial', { token: otherOwner, store: 'otra-tienda' }))
    expect(paid).toEqual({ trial: null })
    expect((await h.request('/api/admin/trial/plan-request', { method: 'POST', token: otherOwner, store: 'otra-tienda', body: { planCode: 'emprendedor', cycle: 'mensual' } })).status).toBe(409)
    // An admin (not owner) of the trial store cannot contract.
    const helper = await createStoreUser(h.db, { email: 'ayudante@flores.co', password: 'ClaveSegura123', storeId: store.id, role: 'admin' })
    expect((await h.request('/api/admin/trial/plan-request', { method: 'POST', token: await userToken(helper, 'ayudante@flores.co'), store: store.slug, body: { planCode: 'emprendedor', cycle: 'mensual' } })).status).toBe(403)
  })

  it('existing paying stores keep working exactly as before (no trial row, plan limits unchanged)', async () => {
    await seedCatalog(h.db, otherStore, { products: [{ sku: 'A', name: 'A', price: 1000 }] })
    expect((await createProduct(otherOwner, 'otra-tienda', 1)).status).toBe(201)
    expect((await h.request('/api/store', { store: 'otra-tienda' })).status).toBe(200)
    expect(q(`SELECT trial_ends_at, plan_code FROM stores WHERE id = ?`, otherStore)).toEqual([{ trial_ends_at: null, plan_code: 'profesional' }])
  })
})

describe('superadmin views and email delivery truth', () => {
  it('lists trial stores, conversions, email status and incidents; a store user cannot see them', async () => {
    const { store, token } = await readyTrial()
    await h.request('/api/admin/trial/plan-request', { method: 'POST', token, store: store.slug, body: { planCode: 'emprendedor', cycle: 'mensual' } })
    const list = await json(await h.request('/api/platform/trial-stores', { token: admin }))
    expect(list.items[0]).toMatchObject({ slug: store.slug, status: 'activa', ownerEmail: 'ana@flores.co', ownerVerified: true, openRequest: { planCode: 'emprendedor' } })
    expect((await json(await h.request('/api/platform/trial-stores?status=por_vencer', { token: admin }))).items).toHaveLength(0)
    const summary = await json(await h.request('/api/platform/trial-stores/summary', { token: admin }))
    expect(summary).toMatchObject({ total: 1, active: 1, converted: 0, pendingPayments: { count: 1, amount: 208900 } })
    const emails = await json(await h.request(`/api/platform/trial-stores/${store.slug}/emails`, { token: admin }))
    // "enviado" means accepted by the provider; delivery stays unknown until the provider confirms it.
    expect(emails.items.every((item: any) => item.status === 'enviado' && item.deliveryStatus === null)).toBe(true)
    expect((await h.request('/api/platform/trial-stores', { token })).status).toBe(403)
    h.db.sqlite.exec(`UPDATE store_plan_requests SET created_at = datetime('now', '-3 days')`)
    const incidents = await json(await h.request('/api/platform/trial-stores/incidents', { token: admin }))
    expect(incidents.items.map((item: any) => item.kind)).toContain('pago_sin_verificar')
  })
})

describe('email templates of the trial and the contract', () => {
  it('every system template is valid, responsive, uses one brand and never carries a password', async () => {
    const { DEFAULT_TEMPLATES, SYSTEM_TEMPLATE_KEYS, validateTemplate, renderTemplate, SAMPLE_VALUES } = await import('../email/templates')
    for (const key of SYSTEM_TEMPLATE_KEYS) {
      const template = DEFAULT_TEMPLATES[key]
      expect(() => validateTemplate(template, key), key).not.toThrow()
      expect(template.html, key).toContain('name="viewport"')
      expect(template.html, key).toContain('max-width:560px')
      expect(template.html + template.subject, key).not.toContain('Tienda IA Express')
      expect(template.html, key).toContain('soporte@tiendiaexpres.com')
      const rendered = renderTemplate(template, SAMPLE_VALUES)
      expect(rendered.html + rendered.text, key).not.toMatch(/\{\{|contraseña:\s*\S/i)
    }
    expect(Object.keys(DEFAULT_TEMPLATES)).toEqual([...SYSTEM_TEMPLATE_KEYS])
  })
})

describe('purging a trial store (found in staging)', () => {
  it('removes the trial, its plan request, invoice and data, and leaves other stores alone', async () => {
    const { store, token } = await readyTrial('borrar@flores.co', 'Tienda para borrar', 31)
    await createProduct(token, store.slug, 1)
    expect((await h.request('/api/admin/trial/plan-request', { method: 'POST', token, store: store.slug, body: { planCode: 'emprendedor', cycle: 'mensual' } })).status).toBe(201)
    expect(q('SELECT COUNT(*) AS n FROM store_plan_requests WHERE store_id = ?', store.id)).toEqual([{ n: 1 }])
    expect((await h.request(`/api/platform/stores/${store.slug}/status`, { method: 'POST', token: admin, body: { status: 'suspended' } })).status).toBe(200)
    const purge = await h.request(`/api/platform/stores/${store.slug}`, { method: 'DELETE', token: admin, body: { confirm: store.slug } })
    expect(purge.status).toBe(200)
    for (const table of ['store_trials', 'store_plan_requests', 'store_invoices', 'products']) expect(q(`SELECT COUNT(*) AS n FROM ${table} WHERE store_id = ?`, store.id)).toEqual([{ n: 0 }])
    expect(q('SELECT COUNT(*) AS n FROM stores WHERE id = ?', otherStore)).toEqual([{ n: 1 }])
  })
})
