import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { callbackUpdate, createHarness, createStoreUser, seedCatalog, seedStore, stubTelegram, textUpdate, type Harness } from '../../testing/harness'
import { processTelegramUpdate } from '../telegram'
import { detectOrderIntent } from './orders'
import { detectMovementsQuery, detectStockMovement } from './inventory'
import { salesSummaryTool } from './tools'

type Button = { text: string; callback_data?: string; url?: string }
const OWNER = 8101
let h: Harness
let tienda: number
let otra: number
let ids: Record<string, number>

const send = (update: unknown) => processTelegramUpdate(update as never, h.env, h.db)
const buttons = (telegram: ReturnType<typeof stubTelegram>) => ((telegram.lastMarkup()?.inline_keyboard || []) as Button[][]).flat()
const tap = (telegram: ReturnType<typeof stubTelegram>, label: RegExp) => send(callbackUpdate(OWNER, buttons(telegram).find((b) => label.test(b.text))!.callback_data!))
const stock = (key: string) => h.db.query<{ stock: number }>('SELECT stock FROM product_variants WHERE id = ?', ids[key])[0]!.stock
const order = (displayId: string) => h.db.query<Record<string, any>>('SELECT * FROM orders WHERE display_id = ?', displayId)[0]!

async function placeOrder(quantity = 2, key = `k-${Math.random().toString(36).slice(2, 12)}`): Promise<string> {
  const response = await h.request('/api/orders', { method: 'POST', store: 'moda-pedidos', headers: { 'Idempotency-Key': `checkout-${key}` }, body: {
    customerName: 'Cliente Prueba', customerCity: 'Medellín', deliveryAddress: 'Calle 1', paymentMethod: 'Transferencia', currency: 'COP',
    items: [{ productId: String(ids['CAM-1']), variantId: String(ids['CAM-1#M']), sku: 'x', name: 'x', price: 1, quantity }],
  } })
  expect(response.status).toBe(201)
  // The Telegram notice is sent in the background: let it finish before reading the chat.
  await new Promise((resolve) => setTimeout(resolve, 30))
  return (await response.json() as { displayId: string }).displayId
}

beforeEach(async () => {
  h = createHarness({ TELEGRAM_BOT_TOKEN: 'bot-token', PUBLIC_STORE_BASE_URL: 'https://tiendas.test' })
  tienda = await seedStore(h.db, { slug: 'moda-pedidos', name: 'Moda Pedidos', status: 'active' })
  otra = await seedStore(h.db, { slug: 'otra-pedidos', name: 'Otra Pedidos', status: 'active' })
  h.db.query('INSERT INTO store_onboarding_legacy_stores (store_id) VALUES (?), (?)', tienda, otra)
  await createStoreUser(h.db, { email: 'duena@pedidos.test', storeId: tienda, role: 'owner', telegramUserId: String(OWNER) })
  ids = await seedCatalog(h.db, tienda, { products: [{ sku: 'CAM-1', name: 'Camiseta Básica', price: 40000, variants: [{ size: 'M', color: 'Negro', stock: 5 }, { size: 'L', color: 'Negro', stock: 2 }] }] })
  await seedCatalog(h.db, otra, { products: [{ sku: 'CAM-1', name: 'Camiseta de la otra tienda', price: 1, variants: [{ size: 'M', stock: 9 }] }] })
})
afterEach(() => vi.unstubAllGlobals())

describe('orders from Telegram', () => {
  it('notifies the store team of a new order without calling it a sale', async () => {
    const telegram = stubTelegram()
    const displayId = await placeOrder()
    await vi.waitFor(() => expect(telegram.calls.some((call) => call.method === 'sendMessage' && call.body.chat_id === OWNER)).toBe(true))
    const notice = telegram.calls.find((call) => call.method === 'sendMessage' && call.body.chat_id === OWNER)!
    expect(String(notice.body.text)).toContain('Nuevo pedido en Moda Pedidos')
    expect(String(notice.body.text)).toContain('todavía no es una venta')
    expect(String(notice.body.text)).not.toContain('Cliente Prueba')
    expect(JSON.stringify(notice.body.reply_markup)).toContain(`ord:${tienda}:view:${order(displayId).id}`)
    const summary = await salesSummaryTool(h.db, tienda, 'COP', 30)
    expect(summary.data).toEqual({ confirmedOrders: 0, confirmedAmount: 0 })
    expect(summary.text).toContain('Recibido (sin confirmar)')
  })

  it('confirms, prepares, dispatches with tracking and delivers, reserving stock once', async () => {
    const telegram = stubTelegram()
    const displayId = await placeOrder(2)
    const short = displayId.split('-').pop()!
    await send(textUpdate(OWNER, '/pedidos'))
    expect(telegram.messages().at(-1)).toContain(short)
    await send(textUpdate(OWNER, `confirma el pedido ${short}`))
    expect(telegram.messages().at(-1)).toContain('Recibido” a “<b>Confirmado')
    expect(stock('CAM-1#M')).toBe(5)
    await tap(telegram, /Sí, cambiar/)
    expect(order(displayId).status).toBe('confirmado')
    expect(stock('CAM-1#M')).toBe(3)
    expect(telegram.messages().at(-1)).toContain('Existencias bajas')
    expect(h.db.query("SELECT kind, quantity, reference FROM inventory_movements WHERE variant_id = ?", ids['CAM-1#M'])).toEqual([{ kind: 'pedido', quantity: -2, reference: `order:${order(displayId).id}` }])

    await send(textUpdate(OWNER, `pedido ${short} en preparación`))
    await tap(telegram, /Sí, cambiar/)
    await send(textUpdate(OWNER, `despacha el pedido ${short}`))
    await send(textUpdate(OWNER, 'Servientrega 123456789'))
    expect(telegram.messages().at(-1)).toContain('no hay seguimiento automático')
    await tap(telegram, /Despachar con esta guía/)
    expect(order(displayId)).toMatchObject({ status: 'enviado', carrier: 'Servientrega', tracking_number: '123456789' })
    expect(order(displayId).shipped_at).toBeTruthy()
    await send(textUpdate(OWNER, `el pedido ${short} fue entregado`))
    await tap(telegram, /Sí, cambiar/)
    expect(order(displayId).status).toBe('entregado')
    expect(stock('CAM-1#M')).toBe(3)
    expect(h.db.query<{ n: number }>("SELECT COUNT(*) AS n FROM order_events WHERE order_id = ? AND event_type = 'status'", order(displayId).id)[0]!.n).toBe(4)
    expect((await salesSummaryTool(h.db, tienda, 'COP', 30)).data).toEqual({ confirmedOrders: 1, confirmedAmount: 80000 })
  })

  it('rejects invalid transitions, stale buttons and confirmations without stock', async () => {
    const telegram = stubTelegram()
    const displayId = await placeOrder(2)
    const row = order(displayId)
    await send(callbackUpdate(OWNER, `ord:${tienda}:ok:${row.id}:enviado:${row.revision}`))
    expect(telegram.messages().join('\n')).toContain('ya no es válido')
    await send(callbackUpdate(OWNER, `ord:${tienda}:ok:${row.id}:confirmado:${row.revision + 5}`))
    expect(telegram.messages().join('\n')).toContain('Otra persona actualizó este pedido')
    h.db.query('UPDATE product_variants SET stock = 1 WHERE id = ?', ids['CAM-1#M'])
    await send(callbackUpdate(OWNER, `ord:${tienda}:ok:${row.id}:confirmado:${row.revision}`))
    expect(telegram.messages().join('\n')).toContain('No hay existencias suficientes')
    expect(order(displayId).status).toBe('pendiente')
    expect(stock('CAM-1#M')).toBe(1)
  })

  it('cancelling a confirmed order returns the stock and records it', async () => {
    const telegram = stubTelegram()
    const displayId = await placeOrder(2)
    const row = order(displayId)
    await send(callbackUpdate(OWNER, `ord:${tienda}:ok:${row.id}:confirmado:${row.revision}`))
    await send(callbackUpdate(OWNER, `ord:${tienda}:ok:${row.id}:cancelado:${row.revision + 1}`))
    expect(order(displayId).status).toBe('cancelado')
    expect(stock('CAM-1#M')).toBe(5)
    expect(h.db.query('SELECT kind, quantity FROM inventory_movements WHERE variant_id = ? ORDER BY id', ids['CAM-1#M'])).toEqual([{ kind: 'pedido', quantity: -2 }, { kind: 'devolucion_pedido', quantity: 2 }])
    expect(telegram.messages().join('\n')).toContain('quedó como <b>Cancelado</b>')
  })

  it('marks a payment as verified only after confirmation', async () => {
    const telegram = stubTelegram()
    const displayId = await placeOrder(1)
    await send(textUpdate(OWNER, `el pedido ${displayId.split('-').pop()} ya pagó`))
    expect(order(displayId).payment_status).toBe('pendiente')
    await tap(telegram, /Sí, pago verificado/)
    expect(order(displayId).payment_status).toBe('verificado')
  })

  it('never shows or changes an order of another store', async () => {
    const telegram = stubTelegram()
    const foreign = h.db.query<{ id: number }>("INSERT INTO orders (store_id, display_id, items_json, subtotal, total) VALUES (?, 'PED-20261104-FFFF9999', '[]', 1000, 1000) RETURNING id", otra)[0]!.id
    await send(textUpdate(OWNER, 'ver pedido FFFF9999'))
    expect(telegram.messages().at(-1)).toContain('No encontré el pedido')
    await send(callbackUpdate(OWNER, `ord:${otra}:ok:${foreign}:confirmado:1`))
    expect(telegram.messages().at(-1)).toContain('otra tienda')
    expect(h.db.query('SELECT status FROM orders WHERE id = ?', foreign)).toEqual([{ status: 'pendiente' }])
  })

  it('lets an operator manage orders but not other roles outside the store', async () => {
    await createStoreUser(h.db, { email: 'op@pedidos.test', storeId: tienda, role: 'operator', telegramUserId: '8102' })
    const telegram = stubTelegram()
    const displayId = await placeOrder(1)
    const row = order(displayId)
    await processTelegramUpdate(callbackUpdate(8102, `ord:${tienda}:ok:${row.id}:confirmado:${row.revision}`) as never, h.env, h.db)
    expect(order(displayId).status).toBe('confirmado')
    await processTelegramUpdate(callbackUpdate(8199, `ord:${tienda}:ok:${row.id}:cancelado:${row.revision + 1}`) as never, h.env, h.db)
    expect(order(displayId).status).toBe('confirmado')
    expect(telegram.messages().length).toBeGreaterThan(0)
  })
})

describe('inventory movements', () => {
  it('registers an entry with reason after confirmation', async () => {
    const telegram = stubTelegram()
    await send(textUpdate(OWNER, 'Llegaron 10 unidades de CAM-1 talla M por compra al proveedor'))
    expect(telegram.messages().at(-1)).toContain('Entrada de 10 u.')
    expect(stock('CAM-1#M')).toBe(5)
    await tap(telegram, /Confirmar/)
    expect(stock('CAM-1#M')).toBe(15)
    expect(h.db.query('SELECT kind, quantity, stock_before, stock_after, reason FROM inventory_movements WHERE variant_id = ?', ids['CAM-1#M']))
      .toEqual([{ kind: 'entrada', quantity: 10, stock_before: 5, stock_after: 15, reason: 'compra al proveedor' }])
    expect(stock('CAM-1#M')).toBe(15)
    expect(h.db.query('SELECT stock FROM product_variants v JOIN products p ON p.id = v.product_id WHERE p.store_id = ?', otra)).toEqual([{ stock: 9 }])
  })

  it('registers an exit, warns about low stock and refuses to go negative', async () => {
    const telegram = stubTelegram()
    await send(textUpdate(OWNER, 'Salida de 3 unidades de CAM-1 talla L'))
    expect(telegram.messages().at(-1)).toContain('Solo hay 2 unidad(es)')
    expect(h.db.query("SELECT COUNT(*) AS n FROM telegram_operations WHERE status = 'pending'")).toEqual([{ n: 0 }])
    await send(textUpdate(OWNER, 'Se dañaron 2 unidades de CAM-1 talla L'))
    await tap(telegram, /Confirmar/)
    expect(stock('CAM-1#L')).toBe(0)
    expect(telegram.messages().at(-1)).toContain('Existencias bajas')
    expect(h.db.query('SELECT kind, reason FROM inventory_movements WHERE variant_id = ?', ids['CAM-1#L'])).toEqual([{ kind: 'salida', reason: 'Producto dañado' }])
    expect(() => h.db.query('UPDATE product_variants SET stock = -1 WHERE id = ?', ids['CAM-1#L'])).toThrow(/negative stock/)
  })

  it('shows the movements of the active store only', async () => {
    const telegram = stubTelegram()
    h.db.query('UPDATE product_variants SET stock = 4 WHERE id = ?', ids['CAM-1#M'])
    h.db.query('UPDATE product_variants SET stock = 1 WHERE product_id = (SELECT id FROM products WHERE store_id = ? AND sku = ?)', otra, 'CAM-1')
    await send(textUpdate(OWNER, 'Muéstrame los movimientos de inventario de CAM-1'))
    const reply = telegram.messages().at(-1)!
    expect(reply).toContain('Movimientos de inventario')
    expect(reply).toContain('-1 → 4')
    expect(reply).not.toContain('→ 1 u.')
  })

  it('parses movements and order references conservatively', () => {
    expect(detectStockMovement('llegaron 10 unidades de CAM-1 talla m')).toMatchObject({ direction: 'entrada', quantity: 10, sku: 'CAM-1', size: 'M' })
    expect(detectStockMovement('salida de dos pares de ABC123 talla 38 por muestra comercial')).toMatchObject({ direction: 'salida', quantity: 2, sku: 'ABC123', size: '38', reason: 'muestra comercial' })
    expect(detectStockMovement('¿cuánto stock tengo de CAM-1?')).toBeNull()
    expect(detectStockMovement('llegaron unidades nuevas')).toBeNull()
    expect(detectMovementsQuery('historial de inventario')).toEqual({})
    expect(detectOrderIntent('¿cuántos pedidos pendientes tengo?')).toBeNull()
    expect(detectOrderIntent('cancela el pedido AB12CD34')).toEqual({ reference: 'AB12CD34', to: 'cancelado' })
  })
})
