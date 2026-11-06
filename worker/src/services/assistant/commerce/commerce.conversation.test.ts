/** TiendIA phases 1–3: natural commerce messages end to end through the real Telegram handler. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { callbackUpdate, createHarness, createStoreUser, seedCatalog, seedStore, stubTelegram, textUpdate, type Harness } from '../../../testing/harness'
import { processTelegramUpdate } from '../../telegram'
import { parseCommerce } from './parse'
import { parseMoney } from './language'

type Button = { text: string; callback_data?: string; url?: string }
const OWNER = 8301
const SELLER = 8302
let h: Harness
let tienda: number
let otra: number
let telegram: ReturnType<typeof stubTelegram>

const send = (update: unknown) => processTelegramUpdate(update as never, h.env, h.db)
const say = (text: string, user = OWNER) => send(textUpdate(user, text))
const buttons = () => ((telegram.lastMarkup()?.inline_keyboard || []) as Button[][]).flat()
const tap = (label: RegExp, user = OWNER) => {
  const button = buttons().find((item) => label.test(item.text))
  if (!button?.callback_data) throw new Error(`No hay botón ${label}: ${buttons().map((item) => item.text).join(' | ')}`)
  return send(callbackUpdate(user, button.callback_data))
}
const last = () => telegram.messages().at(-1) || ''
const all = () => telegram.messages().join('\n')
const variants = (sku: string) => h.db.query<{ size: string; color: string; stock: number }>(
  'SELECT v.size, v.color, v.stock FROM product_variants v JOIN products p ON p.id = v.product_id WHERE p.store_id = ? AND p.sku = ? ORDER BY v.id', tienda, sku)
const pending = () => h.db.query<{ action: string }>("SELECT action FROM telegram_operations WHERE status = 'pending'")

function gemini(payload: unknown) {
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 } }))
}

beforeEach(async () => {
  h = createHarness({ TELEGRAM_BOT_TOKEN: 'bot-token', TELEGRAM_WEBHOOK_SECRET: 'webhook-secret', PUBLIC_STORE_BASE_URL: 'https://tiendas.test' })
  tienda = await seedStore(h.db, { slug: 'moda-tiendia', name: 'Moda TiendIA', status: 'active' })
  otra = await seedStore(h.db, { slug: 'otra-tiendia', name: 'Otra TiendIA', status: 'active' })
  h.db.query('INSERT INTO store_onboarding_legacy_stores (store_id) VALUES (?), (?)', tienda, otra)
  await createStoreUser(h.db, { email: 'duena@tiendia.test', storeId: tienda, role: 'owner', telegramUserId: String(OWNER) })
  await createStoreUser(h.db, { email: 'vende@tiendia.test', storeId: tienda, role: 'seller', telegramUserId: String(SELLER) })
  await seedCatalog(h.db, tienda, { products: [
    { sku: 'CAM-1', name: 'Camiseta Básica', price: 40000, variants: [{ size: 'M', color: 'Negro', stock: 5 }, { size: 'L', color: 'Negro', stock: 2 }, { size: 'XL', color: 'Negro', stock: 0 }] },
    { sku: 'SAN-1', name: 'Sandalias Guess', price: 80000, imageUrls: ['/api/assets/stores/1/products/a.jpg', '/api/assets/stores/1/products/b.jpg'], variants: [{ size: '38', color: 'Negro', stock: 1 }, { size: '39', color: 'Blanco', stock: 2 }, { size: '37', color: 'Blanco', stock: 4 }] },
    { sku: 'GOR-1', name: 'Gorra Clásica', price: 30000, variants: [{ size: 'Única', color: 'Azul', stock: 3 }] },
  ] })
  await seedCatalog(h.db, otra, { products: [{ sku: 'SAN-1', name: 'Sandalias Guess', price: 1, variants: [{ size: '38', color: 'Negro', stock: 9 }] }] })
  telegram = stubTelegram()
})
afterEach(() => vi.unstubAllGlobals())

describe('language: quantities, prices, sizes and typos', () => {
  it('reads prices as merchants write them', () => {
    expect(parseMoney('80mil')).toBe(80000)
    expect(parseMoney('80 k')).toBe(80000)
    expect(parseMoney('$80.000')).toBe(80000)
    expect(parseMoney('ochenta mil')).toBe(80000)
    expect(parseMoney('1,5 millones')).toBe(1500000)
    expect(parseMoney('talla 38')).toBeNull()
  })

  it('extracts structured intents without inventing data', () => {
    expect(parseCommerce('me llegaron 10 camisetas 4 m 3 l 3 xl')).toMatchObject({ kind: 'stock', mode: 'add', product: 'camisetas', total: 10, lines: [{ quantity: 4, size: 'M' }, { quantity: 3, size: 'L' }, { quantity: 3, size: 'XL' }] })
    expect(parseCommerce('agrega 3 negras talla 38')).toMatchObject({ kind: 'stock', mode: 'add', lines: [{ quantity: 3, size: '38', color: 'Negro' }] })
    expect(parseCommerce('llegaron tres pares de sandalias negras talla 38')).toMatchObject({ kind: 'stock', mode: 'add', lines: [{ quantity: 3, size: '38', color: 'Negro' }] })
    expect(parseCommerce('ponle el precio en 80mil')).toMatchObject({ kind: 'price', mode: 'set', amount: 80000, product: null })
    expect(parseCommerce('subile 10 mil a las sandalias')).toMatchObject({ kind: 'price', mode: 'increase', amount: 10000, product: 'sandalias' })
    expect(parseCommerce('las blancas ya no quedan')).toMatchObject({ kind: 'sold_out', color: 'Blanco', product: null })
    expect(parseCommerce('corregi las tallas las m son 5 no 3')).toMatchObject({ kind: 'correction', field: 'quantity', size: 'M', from: '3', to: '5' })
    expect(parseCommerce('la talla es 39 no 38')).toMatchObject({ kind: 'correction', field: 'size', from: '38', to: '39' })
    expect(parseCommerce('quita esa foto y deja la otra')).toMatchObject({ kind: 'remove_photo', product: null })
    expect(parseCommerce('pon 5')).toMatchObject({ kind: 'stock', mode: 'ask' })
    expect(parseCommerce('Créame unas sandalias negras Guess talla 38 y 39 a 80 mil')).toEqual({ kind: 'create_product', name: 'Sandalias Guess negras', brand: 'Guess', color: 'Negro', sizes: ['38', '39'], price: 80000 })
    expect(parseCommerce('Muéstrame los productos que tienen menos de cinco unidades')).toBeNull()
    expect(parseCommerce('hola')).toBeNull()
  })
})

describe('phase 1 · conversational assistant', () => {
  it('introduces itself as an AI assistant and keeps the fallback commands', async () => {
    await say('/start')
    expect(last()).toContain('Asistente TiendIA')
    expect(last()).toContain('inteligencia artificial')
    for (const command of ['/ayuda', '/productos', '/inventario', '/pedidos', '/resumen', '/cancelar']) {
      const before = telegram.messages().length
      await say(command)
      expect(telegram.messages().length).toBeGreaterThan(before)
      expect(last()).not.toContain('No conozco ese comando')
    }
    await say('/resumen')
    expect(last()).toContain('Resumen de Moda TiendIA')
    expect(last()).toContain('Productos visibles: 3')
  })

  it('ignores a Telegram retry of the same update (webhook idempotency)', async () => {
    await say('agrega 3 negras talla 38')
    const confirm = buttons().find((button) => /Confirmar/.test(button.text))!.callback_data!
    const update = callbackUpdate(OWNER, confirm)
    const deliver = () => h.request('/api/telegram/webhook', { method: 'POST', body: update, headers: { 'X-Telegram-Bot-Api-Secret-Token': 'webhook-secret' } })
    expect((await deliver()).status).toBe(200)
    expect(await (await deliver()).json()).toMatchObject({ duplicate: true })
    expect(variants('SAN-1')[0]).toMatchObject({ size: '38', color: 'Negro', stock: 4 })
    expect((await h.request('/api/telegram/webhook', { method: 'POST', body: textUpdate(OWNER, 'hola'), headers: { 'X-Telegram-Bot-Api-Secret-Token': 'otro' } })).status).toBe(403)
  })
})

describe('phase 2 · commercial understanding and validation', () => {
  it('asks for the missing units instead of inventing them, then applies once after confirmation', async () => {
    await say('Me llegaron 10 camisetas, 4 M y 3 L')
    expect(last()).toContain('Identifiqué 7 unidades distribuidas. Faltan 3 para completar las 10 que mencionaste. ¿Qué talla corresponde a esas 3 unidades?')
    expect(pending()).toEqual([])
    await say('xl')
    expect(last()).toContain('Camiseta Básica')
    expect(last()).toContain('talla M: 5 → <b>9</b>')
    expect(last()).toContain('talla XL: 0 → <b>3</b>')
    await tap(/Confirmar/)
    await send(callbackUpdate(OWNER, `op:confirm:${h.db.query<{ operation_id: string }>("SELECT operation_id FROM telegram_operations WHERE action = 'update_variant_stocks'")[0]!.operation_id}`))
    expect(variants('CAM-1').map((variant) => variant.stock)).toEqual([9, 5, 3])
    expect(last()).toContain('se procesó')
    const movements = h.db.query<{ kind: string; quantity: number; reason: string }>('SELECT kind, quantity, reason FROM inventory_movements WHERE store_id = ? ORDER BY id', tienda)
    expect(movements).toEqual([
      { kind: 'entrada', quantity: 4, reason: 'Entrada de mercancía' }, { kind: 'entrada', quantity: 3, reason: 'Entrada de mercancía' }, { kind: 'entrada', quantity: 3, reason: 'Entrada de mercancía' },
    ])
    expect(JSON.stringify(telegram.lastMarkup())).toContain('https://tiendas.test/t/moda-tiendia/producto/CAM-1')
  })

  it('corrects a pending proposal in natural language without restarting', async () => {
    await say('me llegaron 9 camisetas 3 m 3 l 3 xl')
    expect(last()).toContain('talla M: 5 → <b>8</b>')
    await say('corregi las tallas las m son 5 no 3')
    expect(all()).toContain('corrijo la propuesta')
    expect(last()).toContain('talla M: 5 → <b>10</b>')
    expect(pending()).toEqual([{ action: 'update_variant_stocks' }])
    await tap(/Confirmar/)
    expect(variants('CAM-1').map((variant) => variant.stock)).toEqual([10, 5, 3])
  })

  it('"la talla es 39 no 38" fixes the size; a size that does not exist in that colour is shown as a new variant', async () => {
    await say('agrega 3 negras talla 38')
    expect(last()).toContain('Sandalias Guess')
    expect(last()).toContain('Negro · talla 38: 1 → <b>4</b>')
    await say('la talla es 39 no 38')
    expect(last()).toContain('Negro · talla 39: <b>nueva variante</b> con 3 u.')
    await tap(/Confirmar/)
    expect(variants('SAN-1')).toEqual([{ size: '38', color: 'Negro', stock: 1 }, { size: '39', color: 'Blanco', stock: 2 }, { size: '37', color: 'Blanco', stock: 4 }, { size: '39', color: 'Negro', stock: 3 }])
    expect(h.db.query("SELECT sku, kind, quantity FROM inventory_movements WHERE sku LIKE 'SAN-1-NEG%'")).toEqual([{ sku: 'SAN-1-NEG-39', kind: 'entrada', quantity: 3 }])
  })

  it('"las blancas ya no quedan" and "ponle el precio en 80mil" use the product in focus', async () => {
    await say('cuantas sandalias me quedan?')
    expect(last()).toContain('Total: <b>7</b>')
    await say('las blancas ya no quedan')
    expect(last()).toContain('Blanco · talla 39: 2 → <b>0</b>')
    expect(last()).toContain('Blanco · talla 37: 4 → <b>0</b>')
    await tap(/Confirmar/)
    await say('ponle el precio en 90mil')
    expect(last()).toContain('$80.000')
    expect(last()).toContain('$90.000')
    await tap(/Confirmar/)
    expect(h.db.query("SELECT price FROM products WHERE store_id = ? AND sku = 'SAN-1'", tienda)).toEqual([{ price: 90000 }])
    expect(variants('SAN-1').map((variant) => variant.stock)).toEqual([1, 0, 0])
    expect(h.db.query("SELECT price FROM products WHERE store_id = ? AND sku = 'SAN-1'", otra)).toEqual([{ price: 1 }])
  })

  it('"subile 10 mil a las sandalias" computes the new price from the real one', async () => {
    await say('subile 10 mil a las sandalias')
    expect(last()).toContain('Subir $10.000')
    expect(last()).toContain('$90.000')
    await say('cancelar')
    expect(h.db.query("SELECT price FROM products WHERE store_id = ? AND sku = 'SAN-1'", tienda)).toEqual([{ price: 80000 }])
  })

  it('"pon 5" asks whether to add or set', async () => {
    await say('cuantas camisetas me quedan?')
    await say('pon 5')
    expect(last()).toContain('sumar 5 unidades')
    await tap(/Dejar en 5/)
    expect(last()).toContain('talla')
    // Three sizes: it asks which one instead of choosing.
    expect(last()).toContain('¿De qué talla son esas 5 unidades?')
    await say('l')
    expect(last()).toContain('talla L: 2 → <b>5</b>')
    await say('pon 5')
    await tap(/Sumar 5/)
    expect(last()).toContain('talla')
  })

  it('shows options for ambiguous products and never picks one by itself', async () => {
    await seedCatalog(h.db, tienda, { products: [{ sku: 'CAM-2', name: 'Camiseta Oversize', price: 55000, variants: [{ size: 'M', color: 'Negro', stock: 1 }] }] })
    await say('agrega 2 camisetas negras talla m')
    expect(last()).toContain('Encontré varios productos')
    expect(pending()).toEqual([])
    await tap(/Camiseta Oversize/)
    expect(last()).toContain('Camiseta Oversize')
    expect(last()).toContain('talla M: 1 → <b>3</b>')
  })

  it('tolerates typos and refuses impossible changes', async () => {
    await say('agrega 2 camizetas negras talla m')
    expect(last()).toContain('Camiseta Básica')
    await say('cancelar')
    await say('vendí 9 camisetas talla l')
    expect(last()).toContain('Solo hay 2 unidades')
    await say('vendí 2 camisetas talla xxs')
    expect(last()).toContain('no tiene')
    await say('agrega 2 pantalones talla 32')
    expect(last()).toContain('No encontré el producto pantalones')
    expect(pending()).toEqual([])
  })

  it('does not apply a proposal when the stock changed meanwhile (concurrency)', async () => {
    await say('agrega 3 negras talla 38')
    h.db.query("UPDATE product_variants SET stock = 7 WHERE sku = (SELECT v.sku FROM product_variants v JOIN products p ON p.id = v.product_id WHERE p.store_id = ? AND p.sku = 'SAN-1' ORDER BY v.id LIMIT 1)", tienda)
    await tap(/Confirmar/)
    expect(last()).toContain('Algo cambió')
    expect(variants('SAN-1')[0]!.stock).toBe(7)
  })

  it('network failures: Telegram down after confirming applies once; AI down falls back to the rules', async () => {
    await say('agrega 3 negras talla 38')
    const confirm = buttons().find((button) => /Confirmar/.test(button.text))!.callback_data!
    vi.unstubAllGlobals()
    telegram = stubTelegram((url) => url.includes('/sendMessage') ? new Response('{"ok":false}', { status: 502 }) : undefined)
    await send(callbackUpdate(OWNER, confirm)).catch(() => undefined)
    await send(callbackUpdate(OWNER, confirm)).catch(() => undefined)
    expect(variants('SAN-1')[0]!.stock).toBe(4)
    vi.unstubAllGlobals()
    h.env.GEMINI_API_KEY = 'test-key'
    telegram = stubTelegram((url) => url.includes('generativelanguage') ? new Response('{}', { status: 503 }) : undefined)
    await say('me llegaron 2 gorras azules')
    expect(last()).toContain('Gorra Clásica')
    expect(last()).toContain('3 → <b>5</b>')
  })

  it('a role without inventory rights cannot change stock', async () => {
    await say('agrega 3 negras talla 38', SELLER)
    expect(last()).toContain('no permite')
    expect(pending()).toEqual([])
  })

  it('uses the AI only to read messages the rules do not understand, then validates the result', async () => {
    h.env.GEMINI_API_KEY = 'test-key'
    vi.unstubAllGlobals()
    telegram = stubTelegram((url) => url.includes('generativelanguage') ? gemini({ kind: 'stock', mode: 'set', product: 'sandalias', lines: [{ quantity: 6, size: '37', color: 'blanco' }] }) : undefined)
    await say('las del 37 en blanco ya van en seis')
    expect(last()).toContain('Blanco · talla 37: 4 → <b>6</b>')
    // A malformed AI answer never becomes a change.
    vi.unstubAllGlobals()
    telegram = stubTelegram((url) => url.includes('generativelanguage') ? gemini({ kind: 'stock', mode: 'set', product: 'sandalias', lines: [{ quantity: -4 }] }) : undefined)
    await say('cancelar')
    await say('las del 39 en blanco ya van en seis')
    expect(pending()).toEqual([])
  })
})

describe('phase 3 · products, photos and orders from Telegram', () => {
  it('creates a product asking only for the missing data', async () => {
    await say('Créame unas sandalias negras Guess talla 38 y 39 a 80 mil')
    const text = all()
    expect(text).toContain('Nombre: <b>Sandalias Guess negras</b>')
    expect(text).toContain('Variantes: 38, 39 · Negro')
    expect(text).toContain('Inventario: pendiente de definir')
    expect(text).toContain('Ya tienes')
    expect(last()).toContain('¿Cuántas unidades tienes por talla (38, 39)?')
    await say('2 y 3')
    const draft = JSON.parse(h.db.query<{ params_json: string }>("SELECT params_json FROM telegram_operations WHERE action = 'create_product' AND status = 'pending'")[0]!.params_json)
    expect(draft.variants).toEqual([{ size: '38', color: 'Negro', stock: 2 }, { size: '39', color: 'Negro', stock: 3 }])
    expect(draft.fields).toMatchObject({ name: 'Sandalias Guess negras', price: 80000, brand: 'Guess' })
    expect(last()).toContain('fotografías')
  })

  it('lets the owner leave an open draft to do something else', async () => {
    await say('Créame una gorra roja a 25 mil')
    await say('agrega 3 negras talla 38')
    expect(last()).toContain('a medio crear')
    await tap(/Sí, hacer esto/)
    expect(h.db.query("SELECT status FROM telegram_operations WHERE action = 'create_product'")).toEqual([{ status: 'cancelled' }])
    expect(last()).toContain('Negro · talla 38: 1 → <b>4</b>')
  })

  it('removes a photo only after choosing it and confirming', async () => {
    await say('cuantas sandalias me quedan?')
    await say('quita esa foto y deja la otra')
    expect(last()).toContain('tiene 2 fotos')
    await tap(/Quitar la foto 2/)
    expect(last()).toContain('Se quita la foto 2')
    await tap(/Confirmar/)
    expect(JSON.parse(h.db.query<{ image_urls: string }>("SELECT image_urls FROM products WHERE store_id = ? AND sku = 'SAN-1'", tienda)[0]!.image_urls)).toEqual(['/api/assets/stores/1/products/a.jpg'])
  })

  it('renames, hides and links products by name; buttons never act on another store', async () => {
    await say('cambiale el nombre a la gorra por Gorra Clásica Azul')
    expect(last()).toContain('Gorra Clásica Azul')
    await tap(/Confirmar/)
    await say('desactiva la gorra')
    await tap(/Confirmar/)
    expect(h.db.query("SELECT name, is_active FROM products WHERE store_id = ? AND sku = 'GOR-1'", tienda)).toEqual([{ name: 'Gorra Clásica Azul', is_active: 0 }])
    await say('pasame el link de la gorra')
    expect(last()).toContain('https://tiendas.test/t/moda-tiendia/producto/GOR-1')
    expect(last()).toContain('Está oculto')
    await send(callbackUpdate(OWNER, `cm:${otra}:pick:1`))
    expect(last()).toContain('otra tienda')
  })

  it('keeps the order tools working in natural language', async () => {
    await say('pedidos pendientes')
    expect(last()).not.toContain('No estoy seguro')
    await say('/pedidos')
    expect(last()).not.toContain('No conozco')
  })
})
