/** Shipping guide by photo in Telegram: the 18 required scenarios plus the order-status conversations. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPng } from '../../../test/sqliteD1'
import { callbackUpdate, createHarness, createStoreUser, photoUpdate, seedCatalog, seedStore, stubTelegram, textUpdate, type Harness } from '../../testing/harness'
import { processTelegramUpdate } from '../telegram'
import { grantCredits } from '../../ai/credits'
import { parseGuideText } from './shippingGuide'

type Button = { text: string; callback_data?: string }
const OWNER = 8401
const INVENTORY = 8402
let h: Harness
let store: number
let other: number
let product: number
let variant: number
let telegram: ReturnType<typeof stubTelegram>
let gemini: unknown = null
let geminiCalls = 0
let png = createPng(640, 480)

const send = (update: unknown) => processTelegramUpdate(update as never, h.env, h.db)
const say = (text: string, user = OWNER) => send(textUpdate(user, text))
const photo = (caption?: string, user = OWNER, fileId = 'guide-file-1') => send(photoUpdate(user, fileId, caption))
const buttons = () => ((telegram.lastMarkup()?.inline_keyboard || []) as Button[][]).flat()
const tap = (label: RegExp, user = OWNER) => {
  const button = buttons().find((item) => label.test(item.text))
  if (!button?.callback_data) throw new Error(`No hay botón ${label}: ${buttons().map((item) => item.text).join(' | ')}`)
  return send(callbackUpdate(user, button.callback_data))
}
const last = () => telegram.messages().at(-1) || ''
const order = (id: number) => h.db.query<Record<string, any>>('SELECT * FROM orders WHERE id = ?', id)[0]!
const documents = (id: number) => h.db.query<Record<string, any>>('SELECT * FROM order_documents WHERE order_id = ?', id)
const credits = () => Number(h.db.query<{ n: number }>('SELECT COALESCE(SUM(amount), 0) AS n FROM ai_credit_ledger WHERE store_id = ?', store)[0]!.n)

function stub() {
  return stubTelegram((url) => {
    if (url.includes('generativelanguage.googleapis.com')) {
      geminiCalls++
      if (gemini === 'error') return new Response('{}', { status: 500 })
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(gemini) }] } }], usageMetadata: { promptTokenCount: 800, candidatesTokenCount: 100 } }))
    }
    if (url.includes('/getFile')) return new Response(JSON.stringify({ ok: true, result: { file_path: 'photos/guia.png', file_size: png.byteLength } }))
    if (url.includes('/file/bot')) return new Response(png, { headers: { 'content-length': String(png.byteLength) } })
    return undefined
  })
}

async function newOrder(name = 'Laura Gómez', city = 'Medellín', storeSlug = 'moda-guias', productId = product, variantId = variant): Promise<number> {
  const response = await h.request('/api/orders', { method: 'POST', store: storeSlug, headers: { 'Idempotency-Key': `checkout-${crypto.randomUUID()}` }, body: {
    customerName: name, customerPhone: '+573001112233', customerCity: city, deliveryAddress: 'Calle 1', paymentMethod: 'Transferencia', currency: 'COP',
    items: [{ productId: String(productId), variantId: String(variantId), sku: 'x', name: 'x', price: 1, quantity: 1 }],
  } })
  expect(response.status).toBe(201)
  return (await response.json() as { id: number }).id
}
const setStatus = (id: number, status: string) => h.db.query(`UPDATE orders SET status = ?, revision = revision + 1 WHERE id = ?`, status, id)
const clear = { legible: true, carrier: 'Servientrega', trackingNumber: '700012345678', trackingLabelled: true, shipDate: '2026-11-04', destinationCity: 'Medellín', recipientName: 'Laura Gómez', dispatched: 'si' }

beforeEach(async () => {
  h = createHarness({ TELEGRAM_BOT_TOKEN: 'bot-token', TELEGRAM_WEBHOOK_SECRET: 'secreto', PUBLIC_STORE_BASE_URL: 'https://tiendas.test', GEMINI_API_KEY: 'test-key' })
  store = await seedStore(h.db, { slug: 'moda-guias', name: 'Moda Guías', status: 'active' })
  other = await seedStore(h.db, { slug: 'otra-guias', name: 'Otra Guías', status: 'active' })
  h.db.query('INSERT INTO store_onboarding_legacy_stores (store_id) VALUES (?), (?)', store, other)
  await createStoreUser(h.db, { email: 'duena@guias.test', storeId: store, role: 'owner', telegramUserId: String(OWNER) })
  await createStoreUser(h.db, { email: 'bodega@guias.test', storeId: store, role: 'inventory', telegramUserId: String(INVENTORY) })
  const ids = await seedCatalog(h.db, store, { products: [{ sku: 'CAM-1', name: 'Camiseta', price: 50000, variants: [{ size: 'M', color: 'Negro', stock: 50 }] }] })
  product = ids['CAM-1']!; variant = ids['CAM-1#M']!
  h.db.query("INSERT INTO ai_credit_costs (feature, credits, enabled, updated_by) VALUES ('leer_guia_envio', 2, 1, 'test')")
  await grantCredits(h.db, store, { kind: 'recarga', amount: 10, reason: 'Prueba' }, 'grant-guias-0001', 'test')
  gemini = clear; geminiCalls = 0; png = createPng(640, 480)
  telegram = stub()
})
afterEach(() => vi.unstubAllGlobals())

describe('shipping guide by photo', () => {
  it('1, 12 · clear photo of a known order: asks before using AI, shows the card, confirms and saves everything', async () => {
    const id = await newOrder()
    setStatus(id, 'preparando')
    await photo(`Esta es la guía del pedido ${id}`)
    expect(last()).toContain('¿Cómo la registro?')
    expect(last()).toContain('cuesta 2 crédito(s)')
    expect(geminiCalls).toBe(0)
    await tap(/Leer la guía con IA/)
    expect(geminiCalls).toBe(1)
    expect(credits()).toBe(8)
    const card = last()
    expect(card).toContain('Encontré estos datos de envío')
    expect(card).toContain('Servientrega')
    expect(card).toContain('700012345678')
    expect(card).toContain('2026-11-04')
    expect(card).toContain('Entregado a transportadora')
    expect(card).toContain('coincide con el pedido')
    expect(card).not.toContain('Calle 1')
    expect(order(id).status).toBe('preparando')
    await tap(/Confirmar y actualizar/)
    expect(order(id)).toMatchObject({ status: 'enviado', shipping_status: 'en_transportadora', carrier: 'Servientrega', tracking_number: '700012345678', payment_status: 'pendiente' })
    expect(order(id).shipped_at).toContain('2026-11-04')
    const docs = documents(id)
    expect(docs).toHaveLength(1)
    expect(docs[0]!.r2_key).toMatch(new RegExp(`^order-docs/${store}/${id}/`))
    expect(docs[0]!.telegram_file_id).toBe('guide-file-1')
    expect([...h.assets.objects.keys()].some((key) => key.startsWith('telegram-drafts/guides/'))).toBe(false)
    expect(h.db.query<{ event_type: string }>('SELECT event_type FROM order_events WHERE order_id = ? ORDER BY id', id).map((event) => event.event_type)).toEqual(expect.arrayContaining(['shipping_document', 'status', 'carrier', 'tracking_number', 'shipped_at']))
    expect(last()).toContain('no le envié mensajes automáticos')
  })

  it('2 · blurry photo: asks for a sharper photo or the typed data; nothing is invented', async () => {
    const id = await newOrder(); setStatus(id, 'confirmado')
    gemini = { legible: false }
    await photo(`guía del pedido ${id}`)
    await tap(/Leer la guía con IA/)
    expect(last()).toContain('no se lee con claridad')
    await say('Coordinadora 12345678')
    expect(last()).toContain('Coordinadora')
    expect(last()).toContain('12345678')
  })

  it('3, 6 · partially visible or ambiguous number: offers the candidates, never picks one', async () => {
    const id = await newOrder(); setStatus(id, 'confirmado')
    gemini = { legible: true, carrier: 'Envía', trackingNumber: '0123456789', trackingLabelled: false, trackingCandidates: ['0123456789', '98765432'] }
    await photo(`registra esta guía del pedido ${id}`)
    await tap(/Leer la guía con IA/)
    expect(last()).toContain('no pude identificar el número de guía')
    expect(buttons().map((button) => button.text)).toEqual(expect.arrayContaining(['Usar 0123456789', 'Usar 98765432']))
    await tap(/Usar 98765432/)
    expect(last()).toContain('98765432')
    expect(last()).toContain('Encontré estos datos')
  })

  it('4, 5 · without an order reference: options among orders of the same recipient, never linked automatically', async () => {
    const a = await newOrder('Laura Gómez', 'Medellín'), b = await newOrder('Laura Gómez', 'Medellín')
    await newOrder('Pedro Ruiz', 'Cali')
    setStatus(a, 'confirmado'); setStatus(b, 'preparando')
    await photo('Ya envié este pedido')
    await tap(/Leer la guía con IA/)
    expect(last()).toContain('podrían ser')
    expect(buttons().filter((button) => /^🧾/.test(button.text))).toHaveLength(2)
    expect(h.db.query("SELECT COUNT(*) AS n FROM telegram_operations WHERE action = 'register_shipment'")).toEqual([{ n: 0 }])
    await tap(new RegExp(order(b).display_id.split('-').pop()!))
    expect(last()).toContain('Encontré estos datos')
  })

  it('7 · unidentified carrier: asks for it', async () => {
    const id = await newOrder(); setStatus(id, 'preparando')
    gemini = { legible: true, trackingNumber: '700099', trackingLabelled: true }
    await photo(`guía del pedido ${id}`)
    await tap(/Leer la guía con IA/)
    expect(last()).toContain('no pude identificar la transportadora')
    await say('es Interrapidísimo 700099887')
    expect(last()).toContain('Interrapidísimo')
  })

  it('8, 14 · guide already registered and Telegram retries never duplicate events or changes', async () => {
    const id = await newOrder(); setStatus(id, 'preparando')
    await photo(`guía del pedido ${id}`)
    await tap(/Leer la guía con IA/)
    const confirm = buttons().find((button) => /Confirmar y actualizar/.test(button.text))!.callback_data!
    const update = callbackUpdate(OWNER, confirm)
    const deliver = () => h.request('/api/telegram/webhook', { method: 'POST', body: update, headers: { 'X-Telegram-Bot-Api-Secret-Token': 'secreto' } })
    await deliver()
    expect(await (await deliver()).json()).toMatchObject({ duplicate: true })
    await send(callbackUpdate(OWNER, confirm))
    expect(last()).toContain('ya se procesó')
    const events = h.db.query<{ n: number }>("SELECT COUNT(*) AS n FROM order_events WHERE order_id = ? AND event_type = 'status'", id)[0]!.n
    await photo(`guía del pedido ${id}`)
    expect(last()).toContain('ya está registrada')
    expect(h.db.query<{ n: number }>("SELECT COUNT(*) AS n FROM order_events WHERE order_id = ? AND event_type = 'status'", id)[0]!.n).toBe(events)
    expect(documents(id)).toHaveLength(1)
    // Same data typed again for the shipped order: no change.
    await say(`registra la guía del pedido ${id} Servientrega 700012345678`)
    expect(last()).toContain('ya está registrada')
  })

  it('9 · an order of another store is never found', async () => {
    const otherIds = await seedCatalog(h.db, other, { products: [{ sku: 'X-1', name: 'X', price: 1, variants: [{ size: 'M', stock: 9 }] }] })
    const foreign = await newOrder('Ana', 'Bogotá', 'otra-guias', otherIds['X-1']!, otherIds['X-1#M']!)
    await photo(`guía del pedido ${foreign} Servientrega 700012345678`)
    expect(last()).toContain('¿A qué pedido corresponde')
    await say(`pedido ${foreign}`)
    expect(last()).toContain('No encontré ese pedido')
    expect(order(foreign).status).toBe('pendiente')
  })

  it('10 · a role without order rights cannot register guides', async () => {
    await photo('registra esta guía', INVENTORY)
    expect(last()).toContain('no permite actualizar pedidos')
    expect(geminiCalls).toBe(0)
  })

  it('11 · natural correction of the extracted data before saving', async () => {
    const id = await newOrder(); setStatus(id, 'preparando')
    await photo(`guía del pedido ${id}`)
    await tap(/Leer la guía con IA/)
    await say('No es Servientrega, es Coordinadora')
    expect(last()).toContain('Coordinadora')
    expect(last()).not.toContain('Transportadora: <b>Servientrega')
    await say('el envío costó 12 mil')
    expect(last()).toContain('$12.000')
    await tap(/Confirmar y actualizar/)
    expect(order(id)).toMatchObject({ carrier: 'Coordinadora', shipping_cost: 12000, status: 'enviado' })
    expect(credits()).toBe(8)
  })

  it('13 · an already delivered order keeps its status; only the guide data are saved', async () => {
    const id = await newOrder(); setStatus(id, 'entregado')
    await photo(`guía del pedido ${id} Servientrega 700012345678`)
    expect(last()).toContain('se mantiene «Entregado»')
    await tap(/Confirmar y actualizar/)
    expect(order(id)).toMatchObject({ status: 'entregado', tracking_number: '700012345678' })
  })

  it('a label that was not dispatched yet asks before changing the status', async () => {
    const id = await newOrder(); setStatus(id, 'preparando')
    gemini = { ...clear, dispatched: 'no' }
    await photo(`guía del pedido ${id}`)
    await tap(/Leer la guía con IA/)
    expect(last()).toContain('¿Ya entregaste el paquete')
    await tap(/Aún no/)
    expect(last()).toContain('se mantiene «En preparación»')
  })

  it('15 · storage error: nothing changes', async () => {
    const id = await newOrder(); setStatus(id, 'preparando')
    await photo(`guía del pedido ${id} Servientrega 700012345678`)
    const original = h.assets.put.bind(h.assets)
    h.assets.put = (async (key: string, ...rest: unknown[]) => { if (key.startsWith('order-docs/')) throw new Error('R2 down'); return (original as any)(key, ...rest) }) as never
    await tap(/Confirmar y actualizar/)
    expect(last()).toContain('el pedido no cambió')
    expect(order(id).status).toBe('preparando')
    expect(documents(id)).toHaveLength(0)
  })

  it('16 · AI error: no credits are charged and manual entry is offered', async () => {
    const id = await newOrder(); setStatus(id, 'preparando')
    gemini = 'error'
    await photo(`guía del pedido ${id}`)
    await tap(/Leer la guía con IA/)
    expect(last()).toContain('no se descontaron créditos')
    expect(credits()).toBe(10)
    await say('TCC 55667788')
    expect(last()).toContain('Encontré estos datos')
  })

  it('17 · not enough credits: no AI call, manual entry still works', async () => {
    const id = await newOrder(); setStatus(id, 'preparando')
    h.db.query("UPDATE ai_credit_costs SET credits = 50 WHERE feature = 'leer_guia_envio'")
    await photo(`guía del pedido ${id}`)
    await tap(/Leer la guía con IA/)
    expect(last()).toContain('créditos')
    expect(geminiCalls).toBe(0)
    await say('Deprisa 99887766')
    await tap(/Confirmar y actualizar/)
    expect(order(id)).toMatchObject({ status: 'enviado', carrier: 'Deprisa', tracking_number: '99887766' })
  })

  it('18 · manual registration without AI', async () => {
    h.env.GEMINI_API_KEY = ''
    const id = await newOrder(); setStatus(id, 'confirmado')
    await photo(`ya despaché el pedido ${id}`)
    expect(buttons().some((button) => /IA/.test(button.text))).toBe(false)
    await tap(/Escribir los datos/)
    await say('Servientrega 700012345678 costo 9 mil')
    await tap(/Confirmar y actualizar/)
    expect(order(id)).toMatchObject({ status: 'enviado', carrier: 'Servientrega', tracking_number: '700012345678', shipping_cost: 9000 })
    expect(geminiCalls).toBe(0)
  })
})

describe('order states from Telegram', () => {
  it('11 · natural requests: hand to carrier, delivered, pending to ship, in transit, show the guide', async () => {
    const a = await newOrder(), b = await newOrder()
    setStatus(a, 'preparando'); setStatus(b, 'confirmado')
    await say('¿Qué pedidos tengo pendientes de enviar?')
    expect(last()).toContain('pendientes de enviar')
    expect(last()).toContain(order(a).display_id.split('-').pop())
    await say(`Marca el pedido ${a} como entregado a transportadora`)
    expect(last()).toContain('Entregado a transportadora')
    await say('Servientrega 700012345678')
    await tap(/Despachar con esta guía/)
    expect(order(a)).toMatchObject({ status: 'enviado', carrier: 'Servientrega' })
    h.db.query("UPDATE orders SET shipping_status = 'en_transito' WHERE id = ?", a)
    await say('Muéstrame los pedidos que están en tránsito')
    expect(last()).toContain('en tránsito')
    expect(last()).toContain('700012345678')
    await say(`¿Qué número de guía tiene el pedido ${a}?`)
    expect(last()).toContain('700012345678')
    await say(`El pedido ${a} ya fue entregado`)
    expect(last()).toContain('¿Cómo se entregó')
    await tap(/Transportadora/)
    await tap(/Sí, marcar entregado/)
    expect(order(a)).toMatchObject({ status: 'entregado', payment_status: 'pendiente' })
    await say(`muéstrame la guía del pedido ${a}`)
    expect(last()).toContain('sin foto de guía'.replace('sin foto de guía', 'no tiene foto de guía'))
  })

  it('reads guide data only when it is explicit', () => {
    expect(parseGuideText('Servientrega 700012345678 costo 12 mil')).toMatchObject({ carrier: 'Servientrega', trackingNumber: '700012345678', shippingCost: 12000 })
    expect(parseGuideText('le mandé 3 camisetas a 12345678')).toEqual({})
    expect(parseGuideText('guía: AB-123456 de Coordinadora')).toMatchObject({ carrier: 'Coordinadora', trackingNumber: 'AB-123456' })
  })
})
