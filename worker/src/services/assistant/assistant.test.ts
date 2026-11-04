import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPng } from '../../../test/sqliteD1'
import { callbackUpdate, createHarness, createStoreUser, photoUpdate, seedCatalog, seedStore, stubTelegram, textUpdate, type Harness } from '../../testing/harness'
import { processTelegramUpdate } from '../telegram'
import { detectIntent } from './intents'
import { parseCatalogCsv } from './documents'

const OWNER = 5001
let h: Harness
let moda: number
let otra: number

function geminiResponse(payload: unknown, usage = { promptTokenCount: 1000, candidatesTokenCount: 200 }) {
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }], usageMetadata: usage }))
}

/** Telegram + Gemini + file download stub. */
function stubServices(options: { gemini?: (body: Record<string, any>) => unknown; png?: Uint8Array } = {}) {
  const png = options.png ?? createPng(640, 480)
  return stubTelegram((url, body) => {
    if (url.includes('generativelanguage.googleapis.com')) return options.gemini ? geminiResponse(options.gemini(body)) : new Response('{}', { status: 500 })
    if (url.includes('/getFile')) return new Response(JSON.stringify({ ok: true, result: { file_path: 'photos/file_1.png', file_size: png.byteLength } }))
    if (url.includes('/file/bot')) return new Response(png, { headers: { 'content-length': String(png.byteLength) } })
    return undefined
  })
}

const send = (update: unknown) => processTelegramUpdate(update as never, h.env, h.db)
const buttons = (telegram: ReturnType<typeof stubTelegram>) => (telegram.lastMarkup()?.inline_keyboard || []).flat()
const callbackFor = (telegram: ReturnType<typeof stubTelegram>, label: RegExp) => buttons(telegram).find((button) => label.test(button.text))?.callback_data

beforeEach(async () => {
  h = createHarness({ TELEGRAM_BOT_TOKEN: 'bot-token' })
  moda = await seedStore(h.db, { slug: 'moda-urbana', name: 'Moda Urbana' })
  otra = await seedStore(h.db, { slug: 'otra-tienda', name: 'Otra Tienda' })
  await createStoreUser(h.db, { email: 'duena@moda.test', storeId: moda, role: 'owner', telegramUserId: String(OWNER) })
  await seedCatalog(h.db, moda, {
    categories: [{ name: 'Calzado', slug: 'calzado' }, { name: 'Accesorios', slug: 'accesorios' }],
    products: [
      { sku: 'ABC123', name: 'Tenis Urbanos', price: 150000, category: 'calzado', variants: [{ size: '38', color: 'Negro', stock: 2 }, { size: '39', color: 'Negro', stock: 1 }] },
      { sku: 'GORRA-01', name: 'Gorra Clásica', price: 40000, category: 'accesorios', description: '', variants: [{ size: 'Única', color: 'Azul', stock: 0 }] },
      { sku: 'BOLSO-02', name: 'Bolso Tote', price: 90000, category: 'accesorios', variants: [{ size: 'Única', color: 'Beige', stock: 12 }] },
    ],
  })
  await seedCatalog(h.db, otra, { products: [{ sku: 'ABC123', name: 'Producto de otra tienda', price: 1, variants: [{ size: 'Única', stock: 0 }] }] })
})
afterEach(() => vi.unstubAllGlobals())

describe('friendly conversation', () => {
  it('greets the owner by name with the main menu buttons', async () => {
    const telegram = stubServices()
    await send(textUpdate(OWNER, 'Hola', 'Laura'))
    expect(telegram.messages()[0]).toContain('Laura')
    expect(telegram.messages()[0]).toContain('Moda Urbana')
    expect(buttons(telegram).map((button) => button.text)).toEqual(expect.arrayContaining(['➕ Agregar producto', '📦 Ver inventario', '🛒 Consultar pedidos', '⚙️ Configurar mi tienda', '✨ Preguntar a la IA']))
  })

  it('does not retain passwords or access tokens in conversation memory', async () => {
    stubServices()
    await send(textUpdate(OWNER, 'Mi contraseña es Secreto123, el token abcdef-123456789 y el código de acceso QWER-1234.'))
    const row = h.db.query<{ content: string }>('SELECT content FROM assistant_messages WHERE role = ? ORDER BY id DESC LIMIT 1', 'user')[0]
    expect(row?.content).not.toContain('Secreto123')
    expect(row?.content).not.toContain('abcdef-123456789')
    expect(row?.content).not.toContain('QWER-1234')
    expect(row?.content).toContain('[oculto]')
  })

  it('offers the menu instead of a technical error when it does not understand and AI is off', async () => {
    const telegram = stubServices()
    await send(textUpdate(OWNER, 'blablabla qwerty'))
    expect(telegram.messages()[0]).toContain('No estoy seguro')
    expect(telegram.messages()[0]).not.toMatch(/error|exception|sqlite/i)
  })

  it('answers low stock with Spanish number words, only from its own store', async () => {
    const telegram = stubServices()
    await send(textUpdate(OWNER, 'Muéstrame los productos que tienen menos de cinco unidades'))
    const reply = telegram.messages()[0]!
    expect(reply).toContain('Tenis Urbanos')
    expect(reply).toContain('Gorra Clásica')
    expect(reply).not.toContain('Bolso Tote')
    expect(reply).not.toContain('otra tienda')
  })

  it('is honest when there are no confirmed sales to rank', async () => {
    const telegram = stubServices()
    await send(textUpdate(OWNER, '¿Cuáles son los productos más vendidos este mes?'))
    expect(telegram.messages()[0]).toContain('no puedo decir cuáles son los más vendidos')
  })

  it('lists products without description and gives deterministic advice without AI', async () => {
    const telegram = stubServices()
    await send(textUpdate(OWNER, 'Revisa qué productos todavía no tienen descripción'))
    expect(telegram.messages()[0]).toContain('Gorra Clásica')
    await send(textUpdate(OWNER, 'Explícame cómo mejorar mi catálogo'))
    expect(telegram.messages()[1]).toContain('Ideas para tu catálogo')
  })
})

describe('confirmed changes', () => {
  it('previews a price change, applies it once after confirmation and audits it in the right store', async () => {
    const telegram = stubServices()
    await send(textUpdate(OWNER, 'Cambia el precio de ABC123 a 180.000 pesos'))
    expect(telegram.messages()[0]).toContain('Revisa este cambio')
    expect(telegram.messages()[0]).toContain('180.000')
    expect(h.db.query("SELECT price FROM products WHERE store_id = ? AND sku = 'ABC123'", moda)).toEqual([{ price: 150000 }])
    const confirm = callbackFor(telegram, /Confirmar/)!
    await send(callbackUpdate(OWNER, confirm))
    await send(callbackUpdate(OWNER, confirm))
    expect(h.db.query("SELECT price FROM products WHERE store_id = ? AND sku = 'ABC123'", moda)).toEqual([{ price: 180000 }])
    expect(h.db.query("SELECT price FROM products WHERE store_id = ? AND sku = 'ABC123'", otra)).toEqual([{ price: 1 }])
    expect(h.db.query("SELECT store_id FROM audit_log WHERE action = 'update_price'")).toEqual([{ store_id: moda }])
    expect(telegram.messages().at(-1)).toContain('se procesó')
  })

  it('resolves "este producto" from the last product mentioned', async () => {
    const telegram = stubServices()
    await send(textUpdate(OWNER, 'Muéstrame los productos que tienen menos de dos unidades'))
    await send(textUpdate(OWNER, 'Cambia el precio de este producto a 45 mil'))
    expect(telegram.messages().at(-1)).toContain('Gorra Clásica')
    expect(telegram.messages().at(-1)).toContain('45.000')
  })

  it('hides only the out-of-stock products of the store after confirmation', async () => {
    const telegram = stubServices()
    await send(textUpdate(OWNER, 'Oculta todos los productos agotados'))
    expect(telegram.messages()[0]).toContain('GORRA-01')
    await send(textUpdate(OWNER, 'sí'))
    expect(h.db.query('SELECT sku, is_active FROM products WHERE store_id = ? ORDER BY sku', moda)).toEqual([
      { sku: 'ABC123', is_active: 1 }, { sku: 'BOLSO-02', is_active: 1 }, { sku: 'GORRA-01', is_active: 0 },
    ])
    expect(h.db.query('SELECT is_active FROM products WHERE store_id = ?', otra)).toEqual([{ is_active: 1 }])
  })

  it('cancels a store change without modifying it', async () => {
    const telegram = stubServices()
    await send(textUpdate(OWNER, 'Cambia el color principal de mi tienda a azul oscuro'))
    expect(telegram.messages()[0]).toContain('#153D70')
    await send(textUpdate(OWNER, 'no'))
    expect(h.db.query('SELECT primary_color FROM store_config WHERE id = ?', moda)).toEqual([{ primary_color: '#0057FF' }])
  })

  it('refuses a stale confirmation when the product changed meanwhile', async () => {
    const telegram = stubServices()
    await send(textUpdate(OWNER, 'Cambia el precio de ABC123 a 170000'))
    h.db.query("UPDATE products SET price = 155000 WHERE store_id = ? AND sku = 'ABC123'", moda)
    await send(callbackUpdate(OWNER, callbackFor(telegram, /Confirmar/)!))
    expect(telegram.messages().at(-1)).toContain('Algo cambió')
    expect(h.db.query("SELECT price FROM products WHERE store_id = ? AND sku = 'ABC123'", moda)).toEqual([{ price: 155000 }])
  })

  it('lets an operator adjust stock but not prices', async () => {
    const telegram = stubServices()
    await createStoreUser(h.db, { email: 'op@moda.test', storeId: moda, role: 'operator', telegramUserId: '6001' })
    await send(textUpdate(6001, 'Cambia el precio de ABC123 a 1000'))
    expect(telegram.messages().at(-1)).toContain('Tu rol')
    await send(textUpdate(6001, 'Actualiza el stock de ABC123 talla 38 a 7 unidades'))
    await send(textUpdate(6001, 'confirmar'))
    expect(h.db.query("SELECT stock FROM product_variants WHERE sku = 'ABC123-38'")).toEqual([{ stock: 7 }])
  })
})

describe('multiple stores and isolation', () => {
  it('asks which store to use, then works only inside the selected store', async () => {
    const telegram = stubServices()
    const userId = h.db.query<{ id: number }>("SELECT id FROM platform_users WHERE email = 'duena@moda.test'")[0]!.id
    h.db.query("INSERT INTO store_memberships (store_id, user_id, role) VALUES (?, ?, 'owner')", otra, userId)
    await send(textUpdate(OWNER, 'Muéstrame el inventario'))
    expect(telegram.messages()[0]).toContain('varias tiendas')
    await send(callbackUpdate(OWNER, `s:select:${otra}`))
    await send(textUpdate(OWNER, '/inventario'))
    expect(telegram.messages().at(-1)).toContain('Producto de otra tienda')
    expect(telegram.messages().at(-1)).not.toContain('Tenis Urbanos')
  })

  it('stops serving a suspended store', async () => {
    const telegram = stubServices()
    h.db.query("UPDATE stores SET status = 'suspended' WHERE id = ?", moda)
    await send(textUpdate(OWNER, 'hola'))
    expect(telegram.messages()[0]).toContain('suspendida')
  })
})

describe('photos, documents and AI', () => {
  it('creates a product from photos with Gemini suggestions, price, stock and a suggested SKU', async () => {
    h.env.GEMINI_API_KEY = 'test-key'
    const telegram = stubServices({
      gemini: () => ({ name: 'Zapatos deportivos negros', description: 'Zapatos deportivos negros con suela blanca y cordones, ideales para el día a día.', category: 'Calzado', colors: ['Negro'], features: ['suela blanca'], visibleBrand: 'Nike', confidence: 'alta', isProductPhoto: true }),
    })
    await send(textUpdate(OWNER, 'Quiero agregar unos zapatos Nike negros'))
    expect(telegram.messages().join('\n')).toContain('fotografías')
    await send(photoUpdate(OWNER, 'photo-1'))
    await send(photoUpdate(OWNER, 'photo-2'))
    expect(telegram.messages().at(-1)).toContain('2 fotos')
    await send(callbackUpdate(OWNER, callbackFor(telegram, /Listo con fotos/)!))
    const afterVision = telegram.messages().join('\n')
    expect(afterVision).toContain('Te preparé esta propuesta')
    expect(afterVision).toContain('Zapatos deportivos negros')
    expect(afterVision).toContain('Nike')
    expect(telegram.messages().at(-1)).toContain('precio')
    await send(textUpdate(OWNER, '180.000 pesos'))
    expect(telegram.messages().at(-1)).toContain('unidades')
    await send(textUpdate(OWNER, '10'))
    expect(telegram.messages().at(-1)).toContain('SKU')
    await send(callbackUpdate(OWNER, callbackFor(telegram, /^Usar /)!))
    expect(telegram.messages().at(-1)).toContain('Vista previa del producto')
    expect(telegram.messages().at(-1)).toContain('✨')
    expect(h.db.query('SELECT COUNT(*) AS n FROM products WHERE store_id = ?', moda)).toEqual([{ n: 3 }])
    await send(callbackUpdate(OWNER, callbackFor(telegram, /Guardar producto/)!))
    const created = h.db.query<{ name: string; price: number; image_urls: string; brand: string | null }>("SELECT name, price, image_urls, brand FROM products WHERE store_id = ? AND name = 'Zapatos deportivos negros'", moda)
    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({ price: 180000, brand: null })
    expect(JSON.parse(created[0]!.image_urls)).toHaveLength(2)
    expect(JSON.parse(created[0]!.image_urls)[0]).toContain(`/api/assets/stores/${moda}/products/telegram/`)
    expect(telegram.messages().at(-1)).toContain('Producto publicado')
    expect(h.db.query("SELECT COUNT(*) AS n FROM ai_usage_events WHERE store_id = ? AND feature = 'fotos_ia' AND status = 'ok'", moda)).toEqual([{ n: 1 }])
    const gemini = telegram.calls.find((call) => call.url.includes('generativelanguage'))!
    expect(JSON.stringify(gemini.body.systemInstruction)).toContain('Nunca propongas precio')
  })

  it('blocks AI when the monthly budget is exhausted and records the blocked request', async () => {
    h.env.GEMINI_API_KEY = 'test-key'
    const telegram = stubServices({ gemini: () => ({ action: 'get_inventory', params: {}, missing: [], summary: 'inventario' }) })
    h.db.query('UPDATE stores SET ai_monthly_budget_micros = 1000 WHERE id = ?', moda)
    h.db.query("INSERT INTO ai_usage_monthly (store_id, period, requests, estimated_cost_micros) VALUES (?, strftime('%Y-%m', 'now'), 3, 5000)", moda)
    await send(textUpdate(OWNER, 'organízame algo raro que no entiendes'))
    expect(telegram.messages()[0]).toContain('límite mensual de IA')
    expect(telegram.calls.some((call) => call.url.includes('generativelanguage'))).toBe(false)
    expect(h.db.query('SELECT blocked_requests FROM ai_usage_monthly WHERE store_id = ?', moda)).toEqual([{ blocked_requests: 1 }])
  })

  it('records token usage, estimates cost and warns once near the budget', async () => {
    h.env.GEMINI_API_KEY = 'test-key'
    const telegram = stubServices({ gemini: () => ({ action: 'get_out_of_stock', params: {}, missing: [], summary: 'agotados' }) })
    h.db.query('UPDATE stores SET ai_monthly_budget_micros = 1000 WHERE id = ?', moda)
    await send(textUpdate(OWNER, 'dime qué cosas ya no tengo para vender'))
    const usage = h.db.query<{ requests: number; estimated_cost_micros: number; warned_at: string | null }>('SELECT requests, estimated_cost_micros, warned_at FROM ai_usage_monthly WHERE store_id = ?', moda)[0]!
    expect(usage.requests).toBe(1)
    expect(usage.estimated_cost_micros).toBe(800)
    expect(usage.warned_at).not.toBeNull()
    expect(telegram.messages().join('\n')).toContain('presupuesto mensual de IA')
    expect(telegram.messages().join('\n')).toContain('GORRA-01')
  })

  it('imports a CSV of prices and stock after preview and confirmation, skipping unknown rows', async () => {
    const csv = new TextEncoder().encode('sku;precio;stock;talla\nABC123;160.000;4;38\nBOLSO-02;95000;;\nNOEXISTE;10;1;\n')
    const telegram = stubTelegram((url) => {
      if (url.includes('/getFile')) return new Response(JSON.stringify({ ok: true, result: { file_path: 'documents/lista.csv', file_size: csv.byteLength } }))
      if (url.includes('/file/bot')) return new Response(csv)
      return undefined
    })
    await send({ update_id: 777001, message: { message_id: 1, from: { id: OWNER, first_name: 'Ana' }, chat: { id: OWNER, type: 'private' }, date: 0, document: { file_id: 'doc-1', file_name: 'lista.csv', mime_type: 'text/csv', file_size: csv.byteLength } } })
    const replies = telegram.messages().join('\n')
    expect(replies).toContain('NOEXISTE')
    expect(replies).toContain('Actualizar 2 precio(s) y 1 existencia(s)')
    await send(textUpdate(OWNER, 'confirmar'))
    expect(h.db.query("SELECT sku, price FROM products WHERE store_id = ? AND sku IN ('ABC123', 'BOLSO-02') ORDER BY sku", moda)).toEqual([{ sku: 'ABC123', price: 160000 }, { sku: 'BOLSO-02', price: 95000 }])
    expect(h.db.query("SELECT stock FROM product_variants WHERE sku = 'ABC123-38'")).toEqual([{ stock: 4 }])
    expect(h.db.query("SELECT price FROM products WHERE store_id = ?", otra)).toEqual([{ price: 1 }])
  })

  it('changes the banner from a photo only after showing a preview and confirming', async () => {
    const telegram = stubServices({ png: createPng(1600, 900) })
    await send(textUpdate(OWNER, 'Cambia el banner principal por esta imagen'))
    expect(telegram.messages()[0]).toContain('Envíame la foto')
    await send(photoUpdate(OWNER, 'banner-photo'))
    const preview = telegram.calls.find((call) => call.method === 'sendPhoto')!
    expect(preview.body.photo).toBe('banner-photo')
    expect(String(preview.body.caption)).toContain('Revisa este cambio')
    expect(h.db.query('SELECT cover_image_url FROM store_config WHERE id = ?', moda)).toEqual([{ cover_image_url: null }])
    await send(callbackUpdate(OWNER, callbackFor(telegram, /Confirmar/)!))
    const row = h.db.query<{ cover_image_url: string; theme_config: string }>('SELECT cover_image_url, theme_config FROM store_config WHERE id = ?', moda)[0]!
    expect(row.cover_image_url).toMatch(new RegExp(`^/api/assets/stores/${moda}/store/banner-`))
    expect(JSON.parse(row.theme_config).hero.imageUrl).toBe(row.cover_image_url)
    expect(h.assets.objects.has(row.cover_image_url.replace('/api/assets/', ''))).toBe(true)
  })

  it('never shows technical details when something fails', async () => {
    const telegram = stubServices()
    h.db.sqlite.exec(`CREATE TRIGGER broken BEFORE UPDATE ON products BEGIN SELECT RAISE(ABORT, 'SQLITE internal detail'); END;`)
    await send(textUpdate(OWNER, 'Cambia el precio de ABC123 a 170000'))
    await send(textUpdate(OWNER, 'sí'))
    expect(telegram.messages().at(-1)).toContain('No pude guardar el cambio')
    expect(telegram.messages().join('\n')).not.toContain('SQLITE')
    expect(h.db.query("SELECT code FROM platform_events WHERE source = 'assistant'")).toEqual([{ code: 'OPERATION_FAILED' }])
  })
})

describe('deterministic Spanish intents', () => {
  it('maps frequent requests without AI', () => {
    expect(detectIntent('hola')).toEqual({ kind: 'greeting' })
    expect(detectIntent('Muéstrame los productos que tienen menos de cinco unidades')).toMatchObject({ action: 'get_low_stock', params: { threshold: 5 } })
    expect(detectIntent('Oculta todos los productos agotados')).toMatchObject({ action: 'hide_out_of_stock' })
    expect(detectIntent('Cambia el precio de este producto a 180.000 pesos', ['ABC123'])).toMatchObject({ action: 'update_price', params: { sku: 'ABC123', price: 180000 } })
    expect(detectIntent('Agrega estas fotografías al producto con SKU ABC123')).toEqual({ kind: 'attach_photos', sku: 'ABC123' })
    expect(detectIntent('Escribe una descripción más atractiva para estos zapatos', ['ABC123'])).toMatchObject({ action: 'write_description', params: { sku: 'ABC123', tone: 'atractiva' } })
    expect(detectIntent('Pon ABC123, GORRA-01 como destacados')).toMatchObject({ action: 'set_featured_products', params: { skus: ['ABC123', 'GORRA-01'] } })
    expect(detectIntent('Organiza ABC123 y BOLSO-02 en una nueva categoría Temporada')).toMatchObject({ action: 'move_products_to_category', params: { skus: ['ABC123', 'BOLSO-02'], categoryName: 'Temporada' } })
    expect(detectIntent('Quiero cambiar la imagen principal de mi tienda')).toEqual({ kind: 'change_store_image', target: 'banner' })
    expect(detectIntent('Quiero vender más')).toBeNull()
  })

  it('rejects CSV formula injection and requires known headers', () => {
    const plan = parseCatalogCsv('sku,precio\nABC123,=HYPERLINK("x")\nXYZ-1,100\n')
    expect('error' in plan).toBe(false)
    expect((plan as { errors: Array<{ reason: string }> }).errors[0]?.reason).toContain('fórmula')
    expect(parseCatalogCsv('nombre,valor\nA,1')).toMatchObject({ error: expect.stringContaining('columnas') })
  })
})

describe('production regressions (2026-11-03)', () => {
  it('accepts the exact stock replies that were rejected in production', async () => {
    const telegram = stubServices()
    await send(textUpdate(OWNER, 'Quiero agregar unos tenis'))
    await send(photoUpdate(OWNER, 'photo-1'))
    await send(callbackUpdate(OWNER, callbackFor(telegram, /Listo con fotos/)!))
    await send(textUpdate(OWNER, 'Tenis Urbanos Negros'))
    await send(textUpdate(OWNER, 'Tenis cómodos para todos los días.'))
    await send(callbackUpdate(OWNER, callbackFor(telegram, /^Calzado$/)!))
    await send(textUpdate(OWNER, '209.000.'))
    expect(telegram.messages().at(-1)).toContain('unidades')
    await send(textUpdate(OWNER, 'negro talla 38:22, negro talla 39:21, negro talla 40:32, negro talla 41:23.'))
    expect(telegram.messages().at(-1)).not.toContain('Usa el formato')
    expect(telegram.messages().at(-1)).toContain('SKU')
    const draft = JSON.parse(h.db.query<{ params_json: string }>("SELECT params_json FROM telegram_operations WHERE action = 'create_product' AND status = 'pending'")[0]!.params_json)
    expect(draft.fields.price).toBe(209000)
    expect(draft.variants).toEqual([
      { size: '38', color: 'Negro', stock: 22 }, { size: '39', color: 'Negro', stock: 21 },
      { size: '40', color: 'Negro', stock: 32 }, { size: '41', color: 'Negro', stock: 23 },
    ])
  })

  it('reports a truncated vision answer as a warning and still continues the product', async () => {
    h.env.GEMINI_API_KEY = 'test-key'
    let request: Record<string, any> = {}
    const telegram = stubTelegram((url, body) => {
      if (url.includes('generativelanguage.googleapis.com')) {
        request = body
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"name":"Tenis negros","descr' }] }, finishReason: 'MAX_TOKENS' }], usageMetadata: { promptTokenCount: 3506, candidatesTokenCount: 585 } }))
      }
      const png = createPng(640, 480)
      if (url.includes('/getFile')) return new Response(JSON.stringify({ ok: true, result: { file_path: 'photos/file_1.png', file_size: png.byteLength } }))
      if (url.includes('/file/bot')) return new Response(png, { headers: { 'content-length': String(png.byteLength) } })
      return undefined
    })
    await send(textUpdate(OWNER, 'Quiero agregar unos tenis'))
    await send(photoUpdate(OWNER, 'photo-1'))
    await send(callbackUpdate(OWNER, callbackFor(telegram, /Listo con fotos/)!))
    expect(request.generationConfig.maxOutputTokens).toBe(2048)
    expect(telegram.messages().join('\n')).toContain('te pido los datos uno por uno')
    expect(telegram.messages().at(-1)).toContain('nombre comercial')
    expect(h.db.query("SELECT level, code, detail FROM platform_events WHERE source = 'gemini'")).toEqual([{ level: 'warning', code: 'GEMINI_TRUNCATED', detail: 'fotos_ia' }])
  })
})
