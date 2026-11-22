import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import worker from '../index'
import { createHarness, createStoreUser, seedCatalog, seedStore, userToken, type Harness } from '../testing/harness'
import { integritySignature, webhookSignature } from '../services/bold'

const MASTER = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => (i * 11 + 5) % 256)))
const IDENTITY = 'test_identity_KEY_1234567890abcd'
const SECRET = 'test_secret_KEY_abcdef123456'
const ORIGIN = 'https://tiendas.test'

let h: Harness
let token: string
let ids: Record<string, number>

beforeEach(async () => {
  h = createHarness({ AI_KEYS_MASTER_KEY: MASTER })
  const storeId = await seedStore(h.db, { slug: 'muy-parcero', name: 'MUY PARCERO' })
  ids = await seedCatalog(h.db, storeId, { products: [{ sku: 'GORRA', name: 'Gorra parcera', price: 45000, variants: [{ size: 'U', stock: 4 }] }] })
  const owner = await createStoreUser(h.db, { email: 'owner@parcero.test', password: 'clave-segura-123', storeId, role: 'owner' })
  token = await userToken(owner, 'owner@parcero.test')
})
afterEach(() => vi.unstubAllGlobals())

const configure = (body: Record<string, unknown> = {}) => h.request('/api/admin/payments/bold', { method: 'PUT', token, store: 'muy-parcero', body: { identityKey: IDENTITY, secretKey: SECRET, mode: 'test', enabled: true, shippingFee: 12000, ...body } })
const item = { productId: String(0), variantId: String(0), sku: 'x', name: 'x', price: 1, quantity: 2 }
const orderBody = (extra: Record<string, unknown> = {}) => ({ customerName: 'Ana', customerPhone: '+57 300 111 2233', customerCity: 'Medellín', deliveryAddress: 'Calle 10', items: [{ ...item, productId: String(ids.GORRA), variantId: String(ids['GORRA#U']) }], payOnline: 'bold', ...extra })
const KEY = 'bold-checkout-key-0001'
const placeOrder = (extra: Record<string, unknown> = {}, key = KEY) => h.request('/api/orders', { method: 'POST', store: 'muy-parcero', headers: { 'Idempotency-Key': key }, body: orderBody(extra) })
const checkout = (displayId: string, key = KEY) => h.request('/api/payments/bold/checkout', { method: 'POST', store: 'muy-parcero', headers: { Origin: ORIGIN }, body: { displayId, checkoutKey: key, returnUrl: `${ORIGIN}/t/muy-parcero?x=1` } })
const sendWebhook = async (payload: unknown, signature?: string) => {
  const raw = JSON.stringify(payload)
  return worker.fetch(new Request('https://api.test/api/payments/bold/webhook', { method: 'POST', body: raw, headers: { 'Content-Type': 'application/json', 'x-bold-signature': signature ?? await webhookSignature(raw, SECRET) } }), h.env, { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext)
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
