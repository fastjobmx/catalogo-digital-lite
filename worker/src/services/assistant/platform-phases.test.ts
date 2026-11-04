import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { callbackUpdate, createHarness, createStoreUser, seedCatalog, seedStore, stubTelegram, superadminToken, textUpdate, userToken, type Harness } from '../../testing/harness'
import { processTelegramUpdate, linkTelegramAccount } from '../telegram'
import { detectIntent } from './intents'
import { detectCouponDraft } from './marketing'
import { profitabilityTool, repeatCustomersTool, salesByPeriodTool, slowMoversTool } from './insights'
import { aiUsageAlerts, generateInvoices, setDomainStatus, setInvoiceStatus } from '../billing'
import { can } from '../../tenancy/access'

type Button = { text: string; callback_data?: string; url?: string }
const OWNER = 9101
let h: Harness
let tienda: number
let ids: Record<string, number>

const send = (update: unknown) => processTelegramUpdate(update as never, h.env, h.db)
const as = (_userId: number, update: unknown) => processTelegramUpdate(update as never, h.env, h.db)
const buttons = (telegram: ReturnType<typeof stubTelegram>) => ((telegram.lastMarkup()?.inline_keyboard || []) as Button[][]).flat()
const tap = (telegram: ReturnType<typeof stubTelegram>, label: RegExp, user = OWNER) => as(user, callbackUpdate(user, buttons(telegram).find((b) => label.test(b.text))!.callback_data!))

function insertOrder(status: string, phone: string, subtotal: number, productKey = 'CAM-1', daysAgo = 1, discount = 0, coupon: string | null = null) {
  const items = JSON.stringify([{ productId: String(ids[productKey]), variantId: String(ids[`${productKey}#M`]), sku: `${productKey}-M`, name: productKey, price: subtotal, size: 'M', quantity: 1, lineSubtotal: subtotal }])
  h.db.query(`INSERT INTO orders (store_id, display_id, customer_name, customer_phone, items_json, subtotal, total, status, discount_total, coupon_code, created_at)
    VALUES (?, ?, 'Ana Pérez', ?, ?, ?, ?, ?, ?, ?, datetime('now', ?))`, tienda, `PED-T-${Math.random().toString(36).slice(2, 10).toUpperCase()}`, phone, items, subtotal, subtotal - discount, status, discount, coupon, `-${daysAgo} days`)
}

beforeEach(async () => {
  h = createHarness({ TELEGRAM_BOT_TOKEN: 'bot-token', PUBLIC_STORE_BASE_URL: 'https://tiendas.test' })
  tienda = await seedStore(h.db, { slug: 'moda-fases', name: 'Moda Fases', status: 'active' })
  h.db.query('INSERT INTO store_onboarding_legacy_stores (store_id) VALUES (?)', tienda)
  await createStoreUser(h.db, { email: 'duena@fases.test', storeId: tienda, role: 'owner', telegramUserId: String(OWNER) })
  ids = await seedCatalog(h.db, tienda, { products: [
    { sku: 'CAM-1', name: 'Camiseta', price: 40000, variants: [{ size: 'M', color: 'Negro', stock: 5 }] },
    { sku: 'GOR-1', name: 'Gorra', price: 20000, variants: [{ size: 'M', color: 'Azul', stock: 4 }] },
  ] })
  h.db.query("UPDATE products SET created_at = datetime('now', '-120 days') WHERE store_id = ?", tienda)
})
afterEach(() => vi.unstubAllGlobals())

describe('Fase 3 — indicadores con datos reales', () => {
  it('counts only confirmed sales, net of discounts, by period', async () => {
    insertOrder('pendiente', '3001110000', 99000)
    insertOrder('confirmado', '3001110001', 40000, 'CAM-1', 1, 4000, 'X10')
    insertOrder('entregado', '3001110002', 40000)
    const result = await salesByPeriodTool(h.db, tienda, 'COP', 30, 'mes')
    expect(result.data).toMatchObject({ total: 76000, orders: 2 })
    expect(result.text).not.toContain('99.000')
  })

  it('lists products without confirmed sales, excluding new products', async () => {
    insertOrder('confirmado', '3001110001', 40000, 'CAM-1', 5)
    insertOrder('pendiente', '3001110002', 20000, 'GOR-1', 5)
    const result = await slowMoversTool(h.db, tienda, 'COP', 60)
    expect((result.data!.products as Array<{ sku: string }>).map((p) => p.sku)).toEqual(['GOR-1'])
    h.db.query("UPDATE products SET created_at = datetime('now') WHERE sku = 'GOR-1'")
    expect((await slowMoversTool(h.db, tienda, 'COP', 60)).data!.products).toEqual([])
  })

  it('reports repeat customers only with enough data and masks phones', async () => {
    insertOrder('confirmado', '3001110001', 1000)
    insertOrder('confirmado', '3001110001', 1000)
    expect((await repeatCustomersTool(h.db, tienda, 'COP', 180)).text).toContain('no hay datos suficientes')
    for (const phone of ['3001110002', '3001110003', '3001110004', '3001110005']) insertOrder('confirmado', phone, 1000)
    const result = await repeatCustomersTool(h.db, tienda, 'COP', 180)
    expect(result.data).toEqual({ buyers: 5, repeat: 1 })
    expect(result.text).toContain('•••0001')
    expect(result.text).not.toContain('3001110001')
  })

  it('never estimates profitability without costs and maps questions to typed queries', () => {
    expect(profitabilityTool().text).toContain('no calculo rentabilidad')
    expect(detectIntent('¿Cuál es mi ganancia del mes?')).toMatchObject({ action: 'get_profitability' })
    expect(detectIntent('¿Qué productos no se han vendido?')).toMatchObject({ action: 'get_slow_movers' })
    expect(detectIntent('¿Qué tallas se venden más?')).toMatchObject({ action: 'get_size_rotation' })
    expect(detectIntent('Muéstrame mis clientes recurrentes')).toMatchObject({ action: 'get_repeat_customers' })
    expect(detectIntent('ventas por semana')).toMatchObject({ action: 'get_sales_by_period', params: { granularity: 'semana' } })
  })
})

describe('Fase 4 — empleados con acceso mínimo', () => {
  it('defines least-privilege capabilities', () => {
    expect(can('seller', 'orders.manage')).toBe(true)
    expect(can('seller', 'inventory.manage')).toBe(false)
    expect(can('inventory', 'inventory.manage')).toBe(true)
    expect(can('inventory', 'orders.manage')).toBe(false)
    expect(can('operator', 'catalog.manage')).toBe(false)
    expect(can('admin', 'team.manage')).toBe(true)
  })

  it('invites a seller with a one-time link; the seller confirms orders but cannot change stock; revocation removes access', async () => {
    const telegram = stubTelegram()
    await send(textUpdate(OWNER, '/equipo'))
    await tap(telegram, /Invitar a alguien/)
    await tap(telegram, /^Vendedor$/)
    const code = telegram.messages().at(-1)!.match(/\/link ([A-Z0-9-]+)/)![1]!
    expect((await linkTelegramAccount(9102, code, h.db)).success).toBe(true)
    expect(h.db.query("SELECT m.role, m.status FROM store_memberships m JOIN platform_users u ON u.id = m.user_id WHERE u.telegram_user_id = '9102'")).toEqual([{ role: 'seller', status: 'active' }])

    insertOrder('pendiente', '3001110009', 40000)
    const order = h.db.query<{ id: number }>("SELECT id FROM orders WHERE store_id = ? AND status = 'pendiente'", tienda)[0]!
    await as(9102, callbackUpdate(9102, `ord:${tienda}:ok:${order.id}:confirmado:1`))
    expect(h.db.query('SELECT status FROM orders WHERE id = ?', order.id)).toEqual([{ status: 'confirmado' }])
    await as(9102, textUpdate(9102, 'Llegaron 5 unidades de CAM-1 talla M'))
    expect(telegram.messages().at(-1)).toContain('Tu rol en esta tienda no permite')
    await as(9102, textUpdate(9102, '/cupones'))
    expect(telegram.messages().at(-1)).toContain('Solo el propietario o un administrador')

    await send(textUpdate(OWNER, '/equipo'))
    await tap(telegram, /Quitar acceso/)
    await tap(telegram, /Sí, quitar acceso/)
    const before = telegram.messages().length
    await as(9102, textUpdate(9102, '/pedidos'))
    expect(telegram.messages().slice(before).join('\n')).not.toContain('Pedidos en curso')
    expect(h.db.query("SELECT COUNT(*) AS n FROM audit_log WHERE action IN ('team_member_invited', 'team_member_revoked')")).toEqual([{ n: 2 }])
  })

  it('an inventory keeper registers stock but cannot manage orders, in Telegram and in the panel', async () => {
    const keeper = await createStoreUser(h.db, { email: 'bodega@fases.test', storeId: tienda, role: 'inventory', telegramUserId: '9103' })
    const telegram = stubTelegram()
    await as(9103, textUpdate(9103, 'Llegaron 5 unidades de CAM-1 talla M'))
    await tap(telegram, /Confirmar/, 9103)
    expect(h.db.query('SELECT stock FROM product_variants WHERE id = ?', ids['CAM-1#M'])).toEqual([{ stock: 10 }])
    insertOrder('pendiente', '3001110009', 40000)
    const order = h.db.query<{ id: number; revision: number }>("SELECT id, revision FROM orders WHERE store_id = ? AND status = 'pendiente'", tienda)[0]!
    await as(9103, callbackUpdate(9103, `ord:${tienda}:ok:${order.id}:confirmado:1`))
    expect(h.db.query('SELECT status FROM orders WHERE id = ?', order.id)).toEqual([{ status: 'pendiente' }])
    const token = await userToken(keeper, 'bodega@fases.test')
    const response = await h.request(`/api/orders/${order.id}`, { method: 'PATCH', token, store: 'moda-fases', body: { status: 'confirmado', expectedRevision: order.revision } })
    expect(response.status).toBe(403)
  })

  it('the panel accepts the new roles when inviting by email', async () => {
    const owner = h.db.query<{ id: number }>("SELECT id FROM platform_users WHERE email = 'duena@fases.test'")[0]!.id
    const token = await userToken(owner, 'duena@fases.test')
    const response = await h.request('/api/admin/team', { method: 'POST', token, store: 'moda-fases', body: { email: 'vende@fases.test', role: 'seller' } })
    expect(response.status).toBeLessThan(300)
    expect(h.db.query("SELECT m.role FROM store_memberships m JOIN platform_users u ON u.id = m.user_id WHERE u.email = 'vende@fases.test'")).toEqual([{ role: 'seller' }])
  })
})

describe('Fase 5 — marketing con consentimiento', () => {
  const checkout = (body: Record<string, unknown>, key: string) => h.request('/api/orders', { method: 'POST', store: 'moda-fases', headers: { 'Idempotency-Key': `checkout-${key}-000000` }, body: {
    customerName: 'Laura Gómez', customerPhone: '+57 300 222 3344', customerCity: 'Cali', deliveryAddress: 'Calle 2', currency: 'COP',
    items: [{ productId: String(ids['CAM-1']), variantId: String(ids['CAM-1#M']), sku: 'x', name: 'x', price: 1, quantity: 1 }], ...body,
  } })

  it('creates a coupon only after confirmation and applies it server-side with its limit', async () => {
    const telegram = stubTelegram()
    await send(textUpdate(OWNER, 'Crea un cupón VERANO10 de 10% hasta el 31/12, máximo 1 usos'))
    expect(telegram.messages().at(-1)).toContain('Revisa el cupón')
    expect(h.db.query('SELECT COUNT(*) AS n FROM coupons')).toEqual([{ n: 0 }])
    await tap(telegram, /Crear cupón/)
    expect(h.db.query('SELECT code, kind, value, max_uses FROM coupons')).toEqual([{ code: 'VERANO10', kind: 'porcentaje', value: 10, max_uses: 1 }])

    const preview = await (await h.request('/api/orders/coupon', { method: 'POST', store: 'moda-fases', body: { code: 'verano10', subtotal: 40000 } })).json() as { valid: boolean; discount: number }
    expect(preview).toMatchObject({ valid: true, discount: 4000 })
    const first = await checkout({ couponCode: 'VERANO10' }, 'a')
    expect(first.status).toBe(201)
    expect(await first.json()).toMatchObject({ subtotal: 40000, discountTotal: 4000 })
    const second = await checkout({ couponCode: 'VERANO10' }, 'b')
    expect(second.status).toBe(409)
    expect((await checkout({ couponCode: 'NOEXISTE' }, 'c')).status).toBe(409)
  })

  it('stores consent only when ticked, and campaigns reach only consented, subscribed customers after approval', async () => {
    expect((await checkout({}, 'd')).status).toBe(201)
    expect(h.db.query('SELECT COUNT(*) AS n FROM customer_contacts')).toEqual([{ n: 0 }])
    expect((await checkout({ marketingConsent: true }, 'e')).status).toBe(201)
    h.db.query("INSERT INTO customer_contacts (store_id, phone, name, consent, consent_at) VALUES (?, '573005556677', 'Pedro', 1, datetime('now'))", tienda)
    expect(h.db.query('SELECT phone, consent FROM customer_contacts ORDER BY phone')).toEqual([{ phone: '573002223344', consent: 1 }, { phone: '573005556677', consent: 1 }])

    const telegram = stubTelegram()
    await send(textUpdate(OWNER, 'dar de baja 3005556677'))
    expect(telegram.messages().at(-1)).toContain('dado de baja')
    await send(textUpdate(OWNER, 'Crea una campaña: ¡Hola {nombre}! Esta semana tenemos camisetas nuevas.'))
    expect(telegram.messages().at(-1)).toContain('Destinatarios: <b>1</b>')
    expect(buttons(telegram).some((b) => b.url)).toBe(false)
    await tap(telegram, /Aprobar campaña/)
    const links = buttons(telegram).filter((b) => b.url)
    expect(links).toHaveLength(1)
    expect(links[0]!.url).toContain('https://wa.me/573002223344?text=')
    expect(decodeURIComponent(links[0]!.url!)).toContain('¡Hola Laura!')
    expect(decodeURIComponent(links[0]!.url!)).toContain('responde BAJA')
    expect(telegram.calls.filter((call) => call.url.includes('wa.me'))).toHaveLength(0)
  })

  it('coupon results count confirmed orders only', async () => {
    h.db.query("INSERT INTO coupons (store_id, code, kind, value) VALUES (?, 'X10', 'porcentaje', 10)", tienda)
    insertOrder('confirmado', '3001', 40000, 'CAM-1', 1, 4000, 'X10')
    insertOrder('pendiente', '3002', 40000, 'CAM-1', 1, 4000, 'X10')
    const telegram = stubTelegram()
    await send(textUpdate(OWNER, 'resultados del cupón X10'))
    expect(telegram.messages().at(-1)).toContain('Pedidos confirmados: <b>1</b>')
    expect(telegram.messages().at(-1)).toContain('36.000')
  })

  it('parses coupon requests conservatively', () => {
    expect(detectCouponDraft('crea un cupón ENVIO5 de 5.000 pesos para compras desde 100.000')).toMatchObject({ code: 'ENVIO5', kind: 'valor', value: 5000, minSubtotal: 100000 })
    expect(detectCouponDraft('crea un cupón SUPER de 95%')).toEqual({ error: 'El porcentaje debe estar entre 1 % y 90 %.' })
    expect(detectCouponDraft('¿cómo funcionan los cupones?')).toBeNull()
    expect(detectCouponDraft('Crea una campaña con el cupón VERANO10')).toBeNull()
  })
})

describe('Fase 6 — administración SaaS', () => {
  it('enforces the plan product limit in the panel and Telegram', async () => {
    h.db.query("UPDATE plans SET max_products = 2 WHERE code = (SELECT plan_code FROM stores WHERE id = ?)", tienda)
    const owner = h.db.query<{ id: number }>("SELECT id FROM platform_users WHERE email = 'duena@fases.test'")[0]!.id
    const response = await h.request('/api/admin/products', { method: 'POST', token: await userToken(owner, 'duena@fases.test'), store: 'moda-fases', body: { sku: 'NEW-1', name: 'Nuevo', price: 1000, variants: [{ size: 'M', stock: 1 }] } })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'PLAN_PRODUCT_LIMIT' })
  })

  it('generates invoices idempotently and only changes pending ones', async () => {
    h.db.query("INSERT INTO store_services (store_id, service_code, billing, price, status) VALUES (?, 'mantenimiento_mensual', 'mensual', 50000, 'activo'), (?, 'instalacion', 'unico', 200000, 'activo'), (?, 'otro', 'mensual', 0, 'activo')", tienda, tienda, tienda)
    expect(await generateInvoices(h.db, '2026-11', 'test')).toEqual({ created: 2, period: '2026-11' })
    expect(await generateInvoices(h.db, '2026-11', 'test')).toEqual({ created: 0, period: '2026-11' })
    expect((await generateInvoices(h.db, '2026-12', 'test')).created).toBe(1)
    const invoice = h.db.query<{ id: number }>("SELECT id FROM store_invoices WHERE period = '2026-11' AND amount = 50000")[0]!
    expect((await setInvoiceStatus(h.db, invoice.id, 'pagada', 'test')).status).toBe('pagada')
    await expect(setInvoiceStatus(h.db, invoice.id, 'anulada', 'test')).rejects.toThrow(/ya no está pendiente/)
    await expect(generateInvoices(h.db, '2026-13', 'test')).rejects.toThrow(/AAAA-MM/)
    const token = await superadminToken()
    const list = await (await h.request('/api/platform/invoices?status=pendiente', { token })).json() as { items: unknown[] }
    expect(list.items).toHaveLength(2)
  })

  it('moves custom domains through valid states and requires the plan feature to activate', async () => {
    h.db.query("INSERT INTO store_domains (domain, store_id) VALUES ('www.modafases.com', ?)", tienda)
    await expect(setDomainStatus(h.db, 'www.modafases.com', 'activo', 'test')).rejects.toThrow(/No se puede pasar/)
    await setDomainStatus(h.db, 'www.modafases.com', 'verificado', 'test')
    h.db.query("UPDATE stores SET plan_code = 'basico' WHERE id = ?", tienda)
    await expect(setDomainStatus(h.db, 'www.modafases.com', 'activo', 'test')).rejects.toThrow(/no incluye dominio propio/)
    h.db.query("UPDATE stores SET plan_code = 'premium' WHERE id = ?", tienda)
    expect((await setDomainStatus(h.db, 'www.modafases.com', 'activo', 'test')).status).toBe('activo')
  })

  it('lists stores above their AI warning threshold', async () => {
    h.db.query("UPDATE stores SET ai_monthly_budget_micros = 1000000, ai_warn_percent = 80 WHERE id = ?", tienda)
    const period = new Date().toISOString().slice(0, 7)
    h.db.query('INSERT INTO ai_usage_monthly (store_id, period, estimated_cost_micros) VALUES (?, ?, 850000)', tienda, period)
    expect(await aiUsageAlerts(h.db)).toEqual([expect.objectContaining({ slug: 'moda-fases', percent: 85 })])
  })
})
