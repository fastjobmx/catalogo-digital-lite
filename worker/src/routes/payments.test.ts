import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import worker from '../index'
import { createHarness, createStoreUser, seedCatalog, seedStore, userToken, type Harness } from '../testing/harness'
import { integritySignature, reconcileBoldPayments, webhookSignature } from '../services/bold'

const MASTER = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => (i * 11 + 5) % 256)))
const IDENTITY = 'test_identity_KEY_1234567890abcd'
const SECRET = 'test_secret_KEY_abcdef123456'
const ORIGIN = 'https://tiendas.test'

let h: Harness
let token: string
let ids: Record<string, number>
let ownerId: number
let storeId: number

beforeEach(async () => {
  h = createHarness({ AI_KEYS_MASTER_KEY: MASTER })
  storeId = await seedStore(h.db, { slug: 'muy-parcero', name: 'MUY PARCERO' })
  ids = await seedCatalog(h.db, storeId, { products: [{ sku: 'GORRA', name: 'Gorra parcera', price: 45000, variants: [{ size: 'U', stock: 4 }] }] })
  ownerId = await createStoreUser(h.db, { email: 'owner@parcero.test', password: 'clave-segura-123', storeId, role: 'owner' })
  token = await userToken(ownerId, 'owner@parcero.test')
})
afterEach(() => vi.unstubAllGlobals())

const configure = (body: Record<string, unknown> = {}) => h.request('/api/admin/payments/bold', { method: 'PUT', token, store: 'muy-parcero', body: { identityKey: IDENTITY, secretKey: SECRET, mode: 'test', enabled: true, shippingFee: 12000, ...body } })
const item = { productId: String(0), variantId: String(0), sku: 'x', name: 'x', price: 1, quantity: 2 }
const orderBody = (extra: Record<string, unknown> = {}) => ({ customerName: 'Ana', customerPhone: '+57 300 111 2233', customerCity: 'Medellín', deliveryAddress: 'Calle 10', customerEmail: 'ana@cliente.test', items: [{ ...item, productId: String(ids.GORRA), variantId: String(ids['GORRA#U']) }], payOnline: 'bold', ...extra })
const KEY = 'bold-checkout-key-0001'
const placeOrder = (extra: Record<string, unknown> = {}, key = KEY) => h.request('/api/orders', { method: 'POST', store: 'muy-parcero', headers: { 'Idempotency-Key': key }, body: orderBody(extra) })
const checkout = (displayId: string, key = KEY) => h.request('/api/payments/bold/checkout', { method: 'POST', store: 'muy-parcero', headers: { Origin: ORIGIN }, body: { displayId, checkoutKey: key, returnUrl: `${ORIGIN}/t/muy-parcero?x=1` } })
const sendWebhook = async (payload: unknown, signature?: string) => {
  const raw = JSON.stringify(payload)
  // Background work (team and buyer notices) is awaited so each test sees its effects.
  const tasks: Promise<unknown>[] = []
  const response = await worker.fetch(new Request('https://api.test/api/payments/bold/webhook', { method: 'POST', body: raw, headers: { 'Content-Type': 'application/json', 'x-bold-signature': signature ?? await webhookSignature(raw, SECRET) } }), h.env, { waitUntil(task: Promise<unknown>) { tasks.push(task) }, passThroughOnException() {}, props: {} } as unknown as ExecutionContext)
  await Promise.all(tasks)
  return response
}
const saleEvent = (reference: string, total: number, type = 'SALE_APPROVED', id = 'evt-1') => ({ id, type, subject: 'pay-1', data: { payment_id: 'pay-1', payment_method: 'CARD_WEB', metadata: { reference }, amount: { total, currency: 'COP' } } })
const paymentStatus = (displayId: string) => h.db.query<{ payment_status: string }>('SELECT payment_status FROM orders WHERE display_id = ?', displayId)[0]?.payment_status

async function paidFlow() {
  await configure()
  const order = await (await placeOrder()).json() as { displayId: string; total: number }
  const button = await (await checkout(order.displayId)).json() as { reference: string; amount: number; signature: string; apiKey: string; redirectionUrl: string; currency: string }
  return { order, button }
}

describe('Bold settings', () => {
  it('keeps the secret encrypted and returns only a hint', async () => {
    const response = await configure()
    expect(response.status).toBe(200)
    const view = await response.json() as Record<string, unknown>
    expect(view).toMatchObject({ configured: true, enabled: true, mode: 'test', identityKey: IDENTITY, shippingFee: 12000 })
    expect(JSON.stringify(view)).not.toContain(SECRET)
    const row = h.db.query<{ secret_ciphertext: string }>('SELECT secret_ciphertext FROM store_payment_gateways')[0]
    expect(row!.secret_ciphertext).not.toContain(SECRET)
  })

  it('only the owner can change keys', async () => {
    const storeId = h.db.query<{ id: number }>("SELECT id FROM stores WHERE slug = 'muy-parcero'")[0]!.id
    const op = await createStoreUser(h.db, { email: 'op@parcero.test', password: 'clave-segura-123', storeId, role: 'admin' })
    const response = await h.request('/api/admin/payments/bold', { method: 'PUT', token: await userToken(op, 'op@parcero.test'), store: 'muy-parcero', body: { identityKey: IDENTITY, secretKey: SECRET } })
    expect(response.status).toBe(403)
  })

  it('publishes only mode and fixed shipping to the storefront', async () => {
    await configure()
    const store = await (await h.request('/api/store', { store: 'muy-parcero' })).json() as Record<string, unknown>
    expect(store.onlinePayment).toEqual({ bold: { mode: 'test', shippingFee: 12000 } })
  })
})

describe('Bold checkout', () => {
  it('asks for the buyer email to send the payment receipt', async () => {
    await configure()
    const response = await placeOrder({ customerEmail: undefined })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'EMAIL_REQUIRED' })
  })

  it('rejects online orders while Bold is off', async () => {
    expect((await placeOrder()).status).toBe(409)
  })

  it('charges products plus the fixed shipping with a server-side signature', async () => {
    const { order, button } = await paidFlow()
    expect(order.total).toBe(45000 * 2 + 12000)
    expect(button.amount).toBe(102000)
    expect(button.apiKey).toBe(IDENTITY)
    expect(button.signature).toBe(await integritySignature(button.reference, 102000, 'COP', SECRET))
    expect(button.reference.startsWith(order.displayId)).toBe(true)
    expect(button.redirectionUrl).toBe(`${ORIGIN}/t/muy-parcero?x=1`)
  })

  it('refuses another browser and foreign return URLs', async () => {
    await configure()
    const order = await (await placeOrder()).json() as { displayId: string }
    expect((await checkout(order.displayId, 'another-checkout-key-01')).status).toBe(404)
    const foreign = await h.request('/api/payments/bold/checkout', { method: 'POST', store: 'muy-parcero', headers: { Origin: ORIGIN }, body: { displayId: order.displayId, checkoutKey: KEY, returnUrl: 'https://evil.test/' } })
    expect(foreign.status).toBe(400)
  })
})

describe('Bold results', () => {
  it('marks the order paid from a signed webhook, once', async () => {
    const { order, button } = await paidFlow()
    expect((await sendWebhook(saleEvent(button.reference, 102000))).status).toBe(200)
    expect(paymentStatus(order.displayId)).toBe('verificado')
    const again = await (await sendWebhook(saleEvent(button.reference, 102000))).json() as { result: string }
    expect(again.result).toBe('duplicado')
    const events = h.db.query<{ n: number }>("SELECT COUNT(*) n FROM order_events WHERE event_type = 'pago_en_linea'")[0]!.n
    expect(events).toBe(1)
  })

  it('ignores a forged signature', async () => {
    const { order, button } = await paidFlow()
    expect((await sendWebhook(saleEvent(button.reference, 102000), 'f'.repeat(64))).status).toBe(401)
    expect(paymentStatus(order.displayId)).toBe('pendiente')
  })

  it('does not mark paid when Bold approved a different amount', async () => {
    const { order, button } = await paidFlow()
    await sendWebhook(saleEvent(button.reference, 1000))
    expect(paymentStatus(order.displayId)).toBe('pendiente')
    expect(h.db.query<{ status: string }>('SELECT status FROM payment_attempts')[0]!.status).toBe('monto_distinto')
  })

  it('a void after approval marks the order refunded', async () => {
    const { order, button } = await paidFlow()
    await sendWebhook(saleEvent(button.reference, 102000))
    await sendWebhook(saleEvent(button.reference, 102000, 'VOID_APPROVED', 'evt-2'))
    expect(paymentStatus(order.displayId)).toBe('reembolsado')
  })

  it('on return, asks Bold and trusts its answer, not the redirect', async () => {
    const { order, button } = await paidFlow()
    const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe(`https://payments.api.bold.co/v2/payment-voucher/${button.reference}`)
      expect(new Headers(init?.headers).get('Authorization')).toBe(`x-api-key ${IDENTITY}`)
      return new Response(JSON.stringify({ payment_status: 'APPROVED', total: 102000, transaction_id: 'TX1', payment_method: 'PSE' }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetcher)
    const response = await h.request('/api/payments/bold/status', { method: 'POST', store: 'muy-parcero', body: { reference: button.reference, checkoutKey: KEY } })
    expect(await response.json()).toMatchObject({ displayId: order.displayId, attemptStatus: 'aprobado', paymentStatus: 'verificado' })
  })
})

describe('Bold notices', () => {
  const NOTICE_ENV = {
    TELEGRAM_BOT_TOKEN: '123:test-token', EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_test', EMAIL_FROM: 'TiendIA <no-reply@tiendas.test>',
    WAHA_ENABLED: 'true', WAHA_API_URL: 'https://waha.test', WAHA_API_KEY: 'waha-key', WAHA_GATEWAY_TOKEN: 'gateway', WAHA_WEBHOOK_HMAC_KEY: 'hmac', WAHA_SESSION: 'tiendia',
  }
  type Call = { url: string; body: Record<string, any> }
  let calls: Call[]
  let boldAnswer: Record<string, unknown> = { payment_status: 'NO_TRANSACTION_FOUND' }

  beforeEach(async () => {
    Object.assign(h.env, NOTICE_ENV)
    await h.db.prepare("UPDATE platform_users SET telegram_user_id = '555001' WHERE id = ?").bind(ownerId).run()
    await h.db.prepare('INSERT INTO whatsapp_identities (user_id, phone, linked_store_id) VALUES (?, ?, ?)').bind(ownerId, '573001234567', storeId).run()
    await h.db.prepare("UPDATE store_config SET logo_url = '/api/assets/stores/1/logo.png', button_color = '#c8ff33', theme_config = ? WHERE id = ?")
      .bind(JSON.stringify({ style: { palette: { background: '#101614', text: '#f5f4ea', button: '#c8ff33', buttonText: '#101614' } } }), storeId).run()
    calls = []
    vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const target = String(url)
      calls.push({ url: target, body: JSON.parse(String(init?.body || '{}')) })
      if (target.includes('api.telegram.org')) return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 })
      if (target.includes('api.resend.com')) return new Response(JSON.stringify({ id: 'email-1' }), { status: 200 })
      if (target.includes('payments.api.bold.co')) return new Response(JSON.stringify(boldAnswer), { status: 200 })
      return new Response(JSON.stringify({ id: 'wa-1' }), { status: 200 })
    }))
  })

  const telegram = () => calls.filter((call) => call.url.includes('api.telegram.org'))
  const whatsapp = () => calls.filter((call) => call.url.endsWith('/api/sendText'))
  const emails = () => calls.filter((call) => call.url.includes('api.resend.com'))

  it('an approved payment reaches the team on Telegram and WhatsApp and the buyer by email, once', async () => {
    const { order, button } = await paidFlow()
    calls = []
    await sendWebhook(saleEvent(button.reference, 102000))
    expect(telegram()).toHaveLength(1)
    expect(telegram()[0]!.body).toMatchObject({ chat_id: 555001 })
    expect(telegram()[0]!.body.text).toContain('NUEVO PAGO CONFIRMADO')
    expect(telegram()[0]!.body.text).toContain(order.displayId)
    expect(whatsapp()).toHaveLength(1)
    expect(whatsapp()[0]!.body).toMatchObject({ chatId: '573001234567@c.us', session: 'tiendia' })
    expect(whatsapp()[0]!.body.text).toContain('NUEVO PAGO CONFIRMADO')
    // Everything needed to dispatch, in blocks: buyer, address, products, payment and the next step.
    const orderId = h.db.query<{ id: number; revision: number }>('SELECT id, revision FROM orders WHERE display_id = ?', order.displayId)[0]!
    const notice = String(telegram()[0]!.body.text)
    for (const part of ['DATOS DEL CLIENTE', 'Nombre: Ana', 'WhatsApp: +57 300 111 2233 · https://wa.me/573001112233', 'Dirección: Calle 10', 'Ciudad: Medellín',
      'Correo: ana@cliente.test', '2× Gorra parcera (Talla U)', 'Envío: $', '(fijo)', 'TOTAL PAGADO', 'Pago verificado', 'modo de pruebas', 'Medio: card web',
      'Transacción: pay-1', 'ACCIÓN REQUERIDA', 'CONFIRMADO', 'Panel: https://tiendas.test/t/muy-parcero/admin/orders']) expect(notice).toContain(part)
    expect(JSON.stringify(telegram()[0]!.body.reply_markup)).toContain(`ord:${storeId}:ask:${orderId.id}:preparando:${orderId.revision}`)
    expect(JSON.stringify(telegram()[0]!.body.reply_markup)).toContain(`ord:${storeId}:ask:${orderId.id}:cancelado:${orderId.revision}`)
    expect(JSON.stringify(telegram()[0]!.body.reply_markup)).toContain('https://tiendas.test/t/muy-parcero/admin/orders')
    // WhatsApp (WAHA): bold with asterisks, numbered options and the menu kept for a day so "1" works later.
    const waText = String(whatsapp()[0]!.body.text)
    expect(waText).toContain('*DATOS DEL CLIENTE*')
    expect(waText).toContain('1. 📦 Pasar a preparación')
    expect(waText).toContain('Responde con el número de la opción.')
    const menu = JSON.parse(h.db.query<{ menu_json: string }>('SELECT menu_json FROM whatsapp_identities')[0]!.menu_json)
    expect(menu).toMatchObject({ ttl: 86_400_000, ids: [`ord:${storeId}:ask:${orderId.id}:preparando:${orderId.revision}`, `ord:${storeId}:ask:${orderId.id}:cancelado:${orderId.revision}`, `ord:${storeId}:view:${orderId.id}`, `ord:${storeId}:list:all`] })
    expect(emails()).toHaveLength(1)
    expect(emails()[0]!.body.to).toEqual(['ana@cliente.test'])
    expect(emails()[0]!.body.subject).toContain(order.displayId)
    expect(emails()[0]!.body.html).toContain('$102.000')
    expect(emails()[0]!.body.text).toContain('Gorra parcera')
    expect(emails()[0]!.body.reply_to).toBeUndefined()
    // The receipt carries the store's identity: name as sender, its logo, color and WhatsApp.
    expect(emails()[0]!.body.from).toBe('"MUY PARCERO" <no-reply@tiendas.test>')
    expect(emails()[0]!.body.html).toContain('src="https://tiendas.test/api/assets/stores/1/logo.png"')
    expect(emails()[0]!.body.html).toContain('background:#C8FF33')
    expect(emails()[0]!.body.html).toContain('color:#101614;text-decoration:none;">Escríbenos por WhatsApp')
    expect(emails()[0]!.body.html).toContain('background:#101614;">') // header on the store's own background
    expect(emails()[0]!.body.html).toContain('color:#F5F4EA;letter-spacing:0.3px;"></div>') // the logo already shows the name
    expect(emails()[0]!.body.html).toContain('https://wa.me/573001112233?text=')
    expect(emails()[0]!.body.html).toContain('+57 300 111 2233')
    expect(emails()[0]!.body.html).not.toContain('logo-720.png')
    expect(h.db.query<{ template_key: string; status: string }>('SELECT template_key, status FROM email_messages')).toEqual([{ template_key: 'order_paid', status: 'enviado' }])

    calls = []
    await sendWebhook(saleEvent(button.reference, 102000, 'SALE_APPROVED', 'evt-repeat'))
    await h.request('/api/payments/bold/status', { method: 'POST', store: 'muy-parcero', body: { reference: button.reference, checkoutKey: KEY } })
    expect(calls).toEqual([])
  })

  it('the receipt asks for WhatsApp instead of replies; a store without logo gets no broken image', async () => {
    await h.db.prepare("UPDATE store_config SET logo_url = NULL, email = 'ventas@parcero.test', button_color = '#26372d', theme_config = '{}' WHERE id = ?").bind(storeId).run()
    const { button } = await paidFlow()
    calls = []
    await sendWebhook(saleEvent(button.reference, 102000))
    expect(emails()[0]!.body.reply_to).toBeUndefined()
    expect(emails()[0]!.body.html).toContain('No respondas a este correo')
    expect(emails()[0]!.body.text).toContain('escríbenos por WhatsApp al +57 300 111 2233')
    expect(emails()[0]!.body.html).not.toContain('<img')
    expect(emails()[0]!.body.html).toContain('letter-spacing:0.3px;">MUY PARCERO</div>')
    expect(emails()[0]!.body.html).toContain('color:#FFFFFF;text-decoration:none;">Escríbenos por WhatsApp')
  })

  it('a void warns the team without emailing the buyer again', async () => {
    const { button } = await paidFlow()
    await sendWebhook(saleEvent(button.reference, 102000))
    calls = []
    await sendWebhook(saleEvent(button.reference, 102000, 'VOID_APPROVED', 'evt-2'))
    expect(telegram()[0]!.body.text).toContain('PAGO ANULADO')
    expect(whatsapp()).toHaveLength(1)
    expect(emails()).toHaveLength(0)
  })

  it('a different amount warns the team only', async () => {
    const { button } = await paidFlow()
    calls = []
    await sendWebhook(saleEvent(button.reference, 1000))
    expect(telegram()[0]!.body.text).toContain('MONTO DISTINTO')
    expect(emails()).toHaveLength(0)
  })

  const orderRow = (displayId: string) => h.db.query<{ status: string; payment_status: string }>('SELECT status, payment_status FROM orders WHERE display_id = ?', displayId)[0]!
  const stock = () => h.db.query<{ stock: number }>('SELECT stock FROM product_variants WHERE id = ?', ids['GORRA#U'])[0]!.stock

  it('an approved payment confirms the order and sets its stock aside', async () => {
    const { order, button } = await paidFlow()
    expect(stock()).toBe(4)
    calls = []
    await sendWebhook(saleEvent(button.reference, 102000))
    expect(orderRow(order.displayId)).toEqual({ status: 'confirmado', payment_status: 'verificado' })
    expect(stock()).toBe(2)
    expect(telegram()[0]!.body.text).toContain('apartadas del inventario')
  })

  it('without stock left the order stays paid but unconfirmed, the team is warned and the buyer gets no receipt', async () => {
    const { order, button } = await paidFlow()
    await h.db.prepare('UPDATE product_variants SET stock = 1 WHERE id = ?').bind(ids['GORRA#U']).run()
    calls = []
    await sendWebhook(saleEvent(button.reference, 102000))
    expect(orderRow(order.displayId)).toEqual({ status: 'pendiente', payment_status: 'verificado' })
    expect(stock()).toBe(1)
    expect(telegram()[0]!.body.text).toContain('SIN EXISTENCIAS')
    expect(emails()).toHaveLength(0)
  })

  it('a second payment of the same order is flagged as a duplicate to refund', async () => {
    const { order, button } = await paidFlow()
    const second = await (await checkout(order.displayId)).json() as { reference: string }
    await sendWebhook(saleEvent(button.reference, 102000))
    calls = []
    await sendWebhook(saleEvent(second.reference, 102000, 'SALE_APPROVED', 'evt-second'))
    expect(telegram()[0]!.body.text).toContain('PAGO DUPLICADO')
    expect(whatsapp()[0]!.body.text).toContain('PAGO DUPLICADO')
    expect(emails()).toHaveLength(0)
    expect(stock()).toBe(2)
  })

  it('the cron confirms open payments with Bold when the webhook never came', async () => {
    const { order } = await paidFlow()
    await h.db.prepare("UPDATE payment_attempts SET created_at = datetime('now', '-10 minutes')").run()
    boldAnswer = { payment_status: 'APPROVED', total: 102000, transaction_id: 'TX-CRON', payment_method: 'PSE', payer_email: 'ana@cliente.test' }
    calls = []
    expect(await reconcileBoldPayments(h.env, h.db)).toEqual({ checked: 1, changed: 1 })
    expect(orderRow(order.displayId)).toEqual({ status: 'confirmado', payment_status: 'verificado' })
    expect(telegram()).toHaveLength(1)
    expect(emails()).toHaveLength(1)
    calls = []
    expect(await reconcileBoldPayments(h.env, h.db)).toEqual({ checked: 0, changed: 0 })
    expect(calls).toEqual([])
  })

  it('the cron leaves fresh and old attempts alone', async () => {
    await paidFlow()
    expect((await reconcileBoldPayments(h.env, h.db)).checked).toBe(0)
    await h.db.prepare("UPDATE payment_attempts SET created_at = datetime('now', '-4 days')").run()
    expect((await reconcileBoldPayments(h.env, h.db)).checked).toBe(0)
  })
})
