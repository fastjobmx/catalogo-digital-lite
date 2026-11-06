/** Order tracking: statuses, independent shipping and payment, carrier and delivery data, history,
 * reversions with reason, private guide documents and current-status counters. */
import { beforeEach, describe, expect, it } from 'vitest'
import { createPng } from '../../test/sqliteD1'
import { createHarness, createStoreUser, seedCatalog, seedStore, userToken, type Harness } from '../testing/harness'
import { customerNotice } from '../services/orders'

let h: Harness
let store: number
let other: number
let owner: string
let operator: string
let otherOwner: string
let variant: number
let product: number
const SLUG = 'moda-envios'
const json = async (response: Response) => response.json() as Promise<any>

async function newOrder(key = crypto.randomUUID()): Promise<{ id: number; displayId: string }> {
  const response = await h.request('/api/orders', { method: 'POST', store: SLUG, headers: { 'Idempotency-Key': `checkout-${key}` }, body: {
    customerName: 'Laura Gómez', customerPhone: '+573001112233', customerCity: 'Medellín', deliveryAddress: 'Calle 1', paymentMethod: 'Transferencia', currency: 'COP',
    items: [{ productId: String(product), variantId: String(variant), sku: 'x', name: 'x', price: 1, quantity: 1 }],
  } })
  expect(response.status).toBe(201)
  return response.json() as Promise<{ id: number; displayId: string }>
}
const detail = async (id: number, token = owner) => json(await h.request(`/api/orders/${id}`, { token, store: SLUG }))
const patch = async (id: number, body: Record<string, unknown>, token = owner) => {
  const revision = body.expectedRevision ?? (await detail(id, owner)).revision
  return h.request(`/api/orders/${id}`, { method: 'PATCH', token, store: SLUG, body: { ...body, expectedRevision: revision } })
}

beforeEach(async () => {
  h = createHarness()
  store = await seedStore(h.db, { slug: SLUG, name: 'Moda Envíos', status: 'active' })
  other = await seedStore(h.db, { slug: 'otra-envios', name: 'Otra Envíos', status: 'active' })
  const ids = await seedCatalog(h.db, store, { products: [{ sku: 'CAM-1', name: 'Camiseta', price: 50000, variants: [{ size: 'M', color: 'Negro', stock: 10 }] }] })
  variant = ids['CAM-1#M']!
  product = ids['CAM-1']!
  owner = await userToken(await createStoreUser(h.db, { email: 'duena@envios.test', password: 'ClaveSegura123', storeId: store, role: 'owner' }), 'duena@envios.test')
  operator = await userToken(await createStoreUser(h.db, { email: 'operador@envios.test', password: 'ClaveSegura123', storeId: store, role: 'operator' }), 'operador@envios.test')
  otherOwner = await userToken(await createStoreUser(h.db, { email: 'otro@envios.test', password: 'ClaveSegura123', storeId: other, role: 'owner' }), 'otro@envios.test')
})

describe('order status, shipping and payment', () => {
  it('1–7, 9 · full lifecycle with carrier data and delivery, payment untouched, real history', async () => {
    const order = await newOrder()
    expect((await detail(order.id)).effectiveShippingStatus).toBe('por_cotizar')
    expect((await patch(order.id, { status: 'confirmado' })).status).toBe(200)
    expect((await patch(order.id, { status: 'preparando' })).status).toBe(200)
    // Handed to the carrier needs the carrier; the guide number is never invented.
    expect(await json(await patch(order.id, { status: 'enviado' }))).toMatchObject({ code: 'CARRIER_REQUIRED' })
    expect(await json(await patch(order.id, { status: 'enviado', carrier: 'Servientrega', trackingUrl: 'http://inseguro.test' }))).toMatchObject({ code: 'INVALID_DATA' })
    const shipped = await patch(order.id, { status: 'enviado', carrier: 'Servientrega', trackingNumber: '700012345678', shippedAt: '2026-11-04', shippingCost: 12000, trackingUrl: 'https://www.servientrega.com/rastreo', shippingNotes: 'Caja mediana' })
    expect(shipped.status).toBe(200)
    let view = await detail(order.id)
    expect(view).toMatchObject({ status: 'enviado', shippingStatus: 'en_transportadora', carrier: 'Servientrega', trackingNumber: '700012345678', shippingCost: 12000, paymentStatus: 'pendiente', total: 62000 })
    expect(view.shippedAt).toContain('2026-11-04')
    expect(view.customerNotice).toContain('entregado a la transportadora Servientrega')
    expect(view.customerNotice).not.toMatch(/fue entregado\.|recibi/)
    // In transit is a shipping state of a handed-over order; contradictions are rejected.
    expect((await patch(order.id, { shippingStatus: 'en_transito' })).status).toBe(200)
    expect(await json(await patch(order.id, { shippingStatus: 'entregado_cliente' }))).toMatchObject({ code: 'SHIPPING_CONFLICT' })
    expect(await json(await patch(order.id, { status: 'entregado' }))).toMatchObject({ code: 'DELIVERY_METHOD_REQUIRED' })
    expect((await patch(order.id, { status: 'entregado', delivery: { method: 'transportadora', deliveredAt: '2026-11-05', receiver: 'Portería', reference: 'Firma 123' } })).status).toBe(200)
    view = await detail(order.id)
    expect(view).toMatchObject({ status: 'entregado', shippingStatus: 'entregado_cliente', paymentStatus: 'pendiente', delivery: { method: 'transportadora', receiver: 'Portería', reference: 'Firma 123' } })
    // History: every change with id, author and time; the creation event is real (no invented past).
    const statusEvents = view.events.filter((event: any) => event.eventType === 'status').map((event: any) => `${event.fromValue}→${event.toValue}`).reverse()
    expect(statusEvents).toEqual(['pendiente→confirmado', 'confirmado→preparando', 'preparando→enviado', 'enviado→entregado'])
    expect(view.events.every((event: any) => event.id && event.performedBy && event.createdAt)).toBe(true)
    expect(view.events.some((event: any) => event.eventType === 'created')).toBe(true)
  })

  it('8 · registers a local delivery without a carrier', async () => {
    const order = await newOrder()
    await patch(order.id, { status: 'confirmado' })
    await patch(order.id, { shippingStatus: 'no_aplica' })
    expect((await patch(order.id, { status: 'entregado', delivery: { method: 'retiro_en_tienda', receiver: 'La clienta' } })).status).toBe(200)
    expect(await detail(order.id)).toMatchObject({ status: 'entregado', carrier: null, shippingStatus: 'no_aplica', delivery: { method: 'retiro_en_tienda' } })
  })

  it('going back needs owner or admin and a recorded reason', async () => {
    const order = await newOrder()
    await patch(order.id, { status: 'confirmado' })
    await patch(order.id, { status: 'preparando' })
    await patch(order.id, { status: 'enviado', carrier: 'TCC' })
    expect((await patch(order.id, { status: 'preparando', reason: 'La transportadora lo devolvió' }, operator)).status).toBe(403)
    expect(await json(await patch(order.id, { status: 'preparando' }))).toMatchObject({ code: 'REASON_REQUIRED' })
    expect((await patch(order.id, { status: 'preparando', reason: 'La transportadora lo devolvió' })).status).toBe(200)
    const view = await detail(order.id)
    expect(view.status).toBe('preparando')
    expect(view.events.find((event: any) => event.eventType === 'status_revert')).toMatchObject({ eventType: 'status_revert', fromValue: 'enviado', toValue: 'preparando', note: 'La transportadora lo devolvió' })
    expect((await patch(order.id, { status: 'pendiente', reason: 'x' })).status).toBe(409)
    expect(h.db.query<{ stock: number }>('SELECT stock FROM product_variants WHERE id = ?', variant)[0]!.stock).toBe(9)
  })

  it('10 · counts each order once by its current status', async () => {
    const a = await newOrder(), b = await newOrder(), c = await newOrder(), d = await newOrder()
    await newOrder()
    for (const order of [a, b, c, d]) await patch(order.id, { status: 'confirmado' })
    await patch(b.id, { status: 'preparando' })
    await patch(c.id, { status: 'enviado', carrier: 'Coordinadora' })
    await patch(d.id, { status: 'enviado', carrier: 'Coordinadora' })
    await patch(d.id, { shippingStatus: 'en_transito' })
    const stats = await json(await h.request('/api/orders/stats', { token: owner, store: SLUG }))
    expect(stats).toEqual({ pendiente: 1, confirmado: 1, preparando: 1, entregado_transportadora: 1, en_transito: 1, incidencia: 0, entregado: 0, cancelado: 0, total: 5 })
    const transit = await json(await h.request('/api/orders?shipping=en_transito', { token: owner, store: SLUG }))
    expect(transit.items.map((item: any) => item.id)).toEqual([d.id])
  })

  it('12 · existing orders keep their data and show a derived shipping state', async () => {
    const order = await newOrder()
    h.db.query("UPDATE orders SET status = 'enviado', carrier = 'Envía', tracking_number = 'ABC123456', shipping_status = NULL WHERE id = ?", order.id)
    const view = await detail(order.id)
    expect(view).toMatchObject({ status: 'enviado', carrier: 'Envía', trackingNumber: 'ABC123456', shippingStatus: null, effectiveShippingStatus: 'en_transportadora' })
    expect(view.events.map((event: any) => event.eventType)).toEqual(['created'])
    expect(customerNotice({ display_id: 'PED-1', status: 'entregado' }, 'Tienda')).toContain('entregado')
  })
})

describe('private shipping-guide documents', () => {
  it('stores, lists and serves the guide only to the same store; never through the public asset route', async () => {
    const order = await newOrder()
    const form = () => { const data = new FormData(); data.append('file', new File([createPng(400, 300)], 'guia.png', { type: 'image/png' })); return data }
    const upload = await h.request(`/api/orders/${order.id}/documents`, { method: 'POST', token: owner, store: SLUG, body: form() })
    expect(upload.status).toBe(201)
    const { id } = await json(upload)
    expect((await json(await h.request(`/api/orders/${order.id}/documents`, { method: 'POST', token: owner, store: SLUG, body: form() }))).duplicate).toBe(true)
    const view = await detail(order.id)
    expect(view.documents).toHaveLength(1)
    const file = await h.request(`/api/orders/${order.id}/documents/${id}`, { token: owner, store: SLUG })
    expect(file.status).toBe(200)
    expect(file.headers.get('cache-control')).toContain('no-store')
    expect((await h.request(`/api/orders/${order.id}/documents/${id}`, { store: SLUG })).status).toBe(401)
    expect((await h.request(`/api/orders/${order.id}/documents/${id}`, { token: otherOwner, store: 'otra-envios' })).status).toBe(404)
    const key = h.db.query<{ r2_key: string }>('SELECT r2_key FROM order_documents WHERE id = ?', id)[0]!.r2_key
    expect(key.startsWith(`order-docs/${store}/${order.id}/`)).toBe(true)
    expect((await h.request(`/api/assets/${key}`)).status).toBe(404)
    const fake = new FormData(); fake.append('file', new File([new TextEncoder().encode('<script>')], 'x.png', { type: 'image/png' }))
    expect((await h.request(`/api/orders/${order.id}/documents`, { method: 'POST', token: owner, store: SLUG, body: fake })).status).toBe(400)
  })
})
