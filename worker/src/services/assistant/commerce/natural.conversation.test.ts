/** TiendIA: referencias escritas sin la palabra «referencia» y expresiones colombianas, por el manejador real
 * de Telegram (el mismo motor que usa WhatsApp). Producto nuevo vs. reposición, referencias ambiguas, productos
 * existentes, y nada guardado antes de confirmar. Solo tiendas ficticias; sin IA. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { callbackUpdate, createHarness, createStoreUser, seedCatalog, seedStore, stubTelegram, textUpdate, type Harness } from '../../../testing/harness'
import { processTelegramUpdate } from '../../telegram'
import { parseMoney } from './language'
import { parseCommerce, parseNewProduct, referencesIn } from './parse'

type Button = { text: string; callback_data?: string }
const OWNER = 8801
let h: Harness
let tienda: number
let otra: number
let telegram: ReturnType<typeof stubTelegram>

const send = (update: unknown) => processTelegramUpdate(update as never, h.env, h.db)
const say = (text: string) => send(textUpdate(OWNER, text))
const buttons = () => ((telegram.lastMarkup()?.inline_keyboard || []) as Button[][]).flat()
const tap = (label: RegExp) => {
  const button = buttons().find((item) => label.test(item.text))
  if (!button?.callback_data) throw new Error(`No hay botón ${label}: ${buttons().map((item) => item.text).join(' | ')}`)
  return send(callbackUpdate(OWNER, button.callback_data))
}
const last = () => telegram.messages().at(-1) || ''
const all = () => telegram.messages().join('\n')
const pending = () => h.db.query<{ action: string; params_json: string }>("SELECT action, params_json FROM telegram_operations WHERE status = 'pending'")
const draft = () => JSON.parse(pending()[0]!.params_json) as { fields: { name?: string; sku?: string; price?: number }; variants: Array<{ size: string; color: string; stock: number }> }
const stocks = (store: number, sku: string) => h.db.query<{ stock: number }>('SELECT v.stock FROM product_variants v JOIN products p ON p.id = v.product_id WHERE p.store_id = ? AND p.sku = ? ORDER BY v.id', store, sku).map((row) => row.stock)
const skus = (store: number) => h.db.query<{ sku: string }>('SELECT sku FROM products WHERE store_id = ? ORDER BY sku', store).map((row) => row.sku)
const price = (store: number, sku: string) => h.db.query<{ price: number }>('SELECT price FROM products WHERE store_id = ? AND sku = ?', store, sku)[0]?.price
const applied = () => h.db.query<{ n: number }>("SELECT COUNT(*) AS n FROM telegram_operations WHERE status = 'applied'")[0]!.n

beforeEach(async () => {
  h = createHarness({ TELEGRAM_BOT_TOKEN: 'bot-token', GEMINI_API_KEY: '' })
  tienda = await seedStore(h.db, { slug: 'tenis-natural', name: 'Tenis Natural', status: 'active' })
  otra = await seedStore(h.db, { slug: 'otra-natural', name: 'Otra Natural', status: 'active' })
  h.db.query('INSERT INTO store_onboarding_legacy_stores (store_id) VALUES (?), (?)', tienda, otra)
  await createStoreUser(h.db, { email: 'duena@natural.test', storeId: tienda, role: 'owner', telegramUserId: String(OWNER) })
  await seedCatalog(h.db, tienda, { products: [
    { sku: 'SAN-1', name: 'Sandalias Guess', price: 80000, variants: [{ size: '38', color: 'Negro', stock: 1 }, { size: '39', color: 'Negro', stock: 2 }] },
  ] })
  // The same reference exists in another store: it must not count as existing here.
  await seedCatalog(h.db, otra, { products: [{ sku: 'AD223', name: 'Tenis de otra tienda', price: 1, variants: [{ size: '38', color: 'Blanco', stock: 99 }] }] })
  telegram = stubTelegram()
})
afterEach(() => vi.unstubAllGlobals())

describe('producto nuevo con la referencia escrita con naturalidad', () => {
  it('«Agrega tenis blancos AD223, tallas 38, 39 y 40, cinco de cada una» prepara el borrador y no guarda nada', async () => {
    await say('Agrega tenis blancos AD223, tallas 38, 39 y 40, cinco de cada una')
    expect(pending().map((row) => row.action)).toEqual(['create_product'])
    expect(draft().fields).toMatchObject({ name: 'Tenis blancos', sku: 'AD223' })
    expect(draft().fields.price).toBeUndefined()
    expect(draft().variants).toEqual([{ size: '38', color: 'Blanco', stock: 5 }, { size: '39', color: 'Blanco', stock: 5 }, { size: '40', color: 'Blanco', stock: 5 }])
    expect(all()).toContain('Referencia: <b>AD223</b>')
    expect(skus(tienda)).toEqual(['SAN-1'])
    expect(stocks(otra, 'AD223')).toEqual([99])
    await say('cancelar')
    expect(pending()).toEqual([])
    expect(skus(tienda)).toEqual(['SAN-1'])
  })

  it('entiende precio, pares y minúsculas en la misma frase', async () => {
    await say('agrega tenis blancos ad223 tallas 38 39 y 40 cinco pares de cada talla a ciento ochenta mil')
    expect(draft().fields).toMatchObject({ name: 'Tenis blancos', sku: 'AD223', price: 180000 })
    expect(draft().variants.map((variant) => `${variant.size}:${variant.stock}`)).toEqual(['38:5', '39:5', '40:5'])
  })

  it('cantidades distintas por talla y «180 mil»', async () => {
    await say('Agrega tenis blancos AD223, talla 38 cinco pares, talla 39 tres pares, a 180 mil')
    expect(draft().fields).toMatchObject({ sku: 'AD223', price: 180000 })
    expect(draft().variants.map((variant) => `${variant.size}:${variant.stock}`)).toEqual(['38:5', '39:3'])
  })

  it('con «créame» también reconoce la referencia sin la palabra', async () => {
    await say('Créame unos tenis rojos PM100 talla 40 a 150 mil')
    expect(draft().fields).toMatchObject({ name: 'Tenis rojos', sku: 'PM100', price: 150000 })
  })

  it('la palabra «referencia» sigue funcionando igual', async () => {
    await say('Agrega unos tenis blancos, referencia AD223, tallas 38 y 39, cinco pares de cada una, a 180 mil')
    expect(draft().fields).toMatchObject({ name: 'Tenis blancos', sku: 'AD223', price: 180000 })
  })

  it('un rol sin permiso de catálogo no publica el producto', async () => {
    h.db.query("UPDATE store_memberships SET role = 'seller' WHERE store_id = ?", tienda)
    await say('Agrega tenis blancos AD223, tallas 38, 39 y 40, cinco de cada una, a 180 mil')
    expect(skus(tienda)).toEqual(['SAN-1'])
    expect(applied()).toBe(0)
  })
})

describe('la referencia ya existe: no se duplica', () => {
  it('sin precio es una reposición: propone sumar, con Confirmar / Corregir / Cancelar', async () => {
    await say('Agrega sandalias SAN-1, tallas 38 y 39, cinco de cada una')
    expect(pending().map((row) => row.action)).toEqual(['update_variant_stocks'])
    expect(last()).toContain('talla 38: 1 → <b>6</b>')
    expect(buttons().map((button) => button.text)).toEqual(expect.arrayContaining(['✅ Confirmar', '✏️ Corregir', '✖ Cancelar']))
    expect(stocks(tienda, 'SAN-1')).toEqual([1, 2])
    await tap(/Confirmar/)
    expect(stocks(tienda, 'SAN-1')).toEqual([6, 7])
    expect(skus(tienda)).toEqual(['SAN-1'])
  })

  it('una confirmación repetida suma una sola vez', async () => {
    await say('Agrega sandalias SAN-1, tallas 38 y 39, cinco de cada una')
    const confirm = buttons().find((button) => /Confirmar/.test(button.text))!.callback_data!
    await send(callbackUpdate(OWNER, confirm))
    await send(callbackUpdate(OWNER, confirm))
    expect(stocks(tienda, 'SAN-1')).toEqual([6, 7])
    expect(applied()).toBe(1)
  })

  it('con un precio distinto es ambiguo: pregunta antes y nunca cambia el precio por su cuenta', async () => {
    await say('Agrega sandalias negras SAN-1, tallas 38 y 39, cinco de cada una, a 95 mil')
    expect(pending()).toEqual([])
    expect(last()).toContain('La referencia <b>SAN-1</b> ya existe')
    expect(last()).toContain('Hoy cuesta')
    expect(buttons().map((button) => button.text)).toEqual(['➕ Sumar a Sandalias Guess', '✖ Cancelar'])
    await tap(/Sumar/)
    expect(pending().map((row) => row.action)).toEqual(['update_variant_stocks'])
    await tap(/Confirmar/)
    expect(stocks(tienda, 'SAN-1')).toEqual([6, 7])
    expect(price(tienda, 'SAN-1')).toBe(80000)
    expect(skus(tienda)).toEqual(['SAN-1'])
  })

  it('si cancela la pregunta, no cambia nada', async () => {
    await say('Agrega sandalias negras SAN-1, tallas 38 y 39, cinco de cada una, a 95 mil')
    await tap(/Cancelar/)
    expect(stocks(tienda, 'SAN-1')).toEqual([1, 2])
    expect(pending()).toEqual([])
  })
})

describe('intención ambigua: pregunta antes de continuar', () => {
  it('una llegada con una referencia desconocida pregunta si es un producto nuevo', async () => {
    await say('me llegaron 10 camisetas polo PL200 talla M')
    expect(pending()).toEqual([])
    expect(last()).toContain('No encontré la referencia <b>PL200</b>')
    expect(buttons().map((button) => button.text)).toEqual(['➕ Producto nuevo', '✖ Cancelar'])
    await tap(/Producto nuevo/)
    expect(draft().fields).toMatchObject({ name: 'Camisetas polo', sku: 'PL200' })
    expect(draft().variants).toEqual([expect.objectContaining({ size: 'M', stock: 10 })])
    expect(skus(tienda)).toEqual(['SAN-1'])
  })

  it('la respuesta «es nuevo» también abre el borrador, y «no» lo descarta', async () => {
    await say('me llegaron 10 camisetas polo PL200 talla M')
    await say('es nuevo')
    expect(pending().map((row) => row.action)).toEqual(['create_product'])
    await say('cancelar')
    await say('me llegaron 10 camisetas polo PL200 talla M')
    await say('no')
    expect(pending()).toEqual([])
    expect(skus(tienda)).toEqual(['SAN-1'])
  })

  it('dos referencias desconocidas en un mensaje no se mezclan en un producto', async () => {
    await say('Agrega tenis AD223 y AD224 talla 38, cinco de cada una')
    expect(pending()).toEqual([])
    expect(last()).toContain('varias referencias')
    expect(last()).toContain('AD223, AD224')
  })

  it('el botón de una pregunta vencida no crea nada', async () => {
    await say('me llegaron 10 camisetas polo PL200 talla M')
    const create = buttons().find((button) => /Producto nuevo/.test(button.text))!.callback_data!
    await say('cuantas sandalias me quedan?')
    await send(callbackUpdate(OWNER, create))
    expect(pending()).toEqual([])
    expect(last()).toContain('ya venció')
  })

  it('una reposición mal escrita sin referencia ni precio conserva la respuesta de siempre', async () => {
    await say('agrega 2 pantalones talla 32')
    expect(last()).toContain('No encontré el producto pantalones')
    expect(pending()).toEqual([])
  })

  it('una referencia existente con cantidades sueltas sigue siendo reposición directa', async () => {
    await say('llegaron 3 negras talla 38 de SAN-1')
    expect(pending()).toHaveLength(1)
    expect(pending()[0]!.action).toMatch(/^update_(?:variant_)?stocks?$/)
    expect(skus(tienda)).toEqual(['SAN-1'])
    expect(stocks(tienda, 'SAN-1')).toEqual([1, 2])
  })
})

describe('expresiones colombianas', () => {
  it('precios hablados y escritos', () => {
    const cases: Array<[string, number | null]> = [
      ['180 mil', 180000], ['180mil', 180000], ['180k', 180000], ['180 lucas', 180000], ['$180.000', 180000], ['180 mil pesos', 180000],
      ['ciento ochenta mil', 180000], ['ochenta y cinco mil', 85000], ['dos mil quinientos', 2500], ['ciento ochenta mil quinientos', 180500],
      ['un millón', 1000000], ['millón y medio', 1500000], ['medio millón', 500000], ['dos palos', 2000000], ['1.5 millones', 1500000],
      // A bare number is never taken as a price, and units after a price are not added to it.
      ['ciento ochenta', null], ['80 mil cinco pares', 80000],
    ]
    for (const [text, amount] of cases) expect([text, parseMoney(text)]).toEqual([text, amount])
  })

  it('«180» a secas se pregunta, nunca se asume', async () => {
    await say('las sandalias valen 180')
    expect(pending()).toEqual([])
    expect(buttons().map((button) => button.text).join(' ')).toMatch(/180\.000/)
    expect(price(tienda, 'SAN-1')).toBe(80000)
  })

  it('«súmale tres unidades» pregunta la talla; «súmale tres a la 38» la toma', async () => {
    await say('cuantas sandalias me quedan?')
    await say('súmale tres unidades')
    expect(last()).toContain('¿De qué talla son esas 3 unidades?')
    expect(pending()).toEqual([])
    await say('cancelar')
    await say('súmale tres unidades a la 38')
    expect(last()).toContain('talla 38: 1 → <b>4</b> (+3)')
    await tap(/Confirmar/)
    expect(stocks(tienda, 'SAN-1')).toEqual([4, 2])
  })

  it('«cinco pares de cada talla» suma a todas las tallas del producto', async () => {
    await say('cuantas sandalias me quedan?')
    await say('llegaron cinco pares de cada talla')
    expect(last()).toContain('talla 38: 1 → <b>6</b> (+5)')
    expect(last()).toContain('talla 39: 2 → <b>7</b> (+5)')
    expect(stocks(tienda, 'SAN-1')).toEqual([1, 2])
    await tap(/Confirmar/)
    expect(stocks(tienda, 'SAN-1')).toEqual([6, 7])
  })

  it('«quítale dos a la 39» descuenta y nunca deja inventario negativo', async () => {
    await say('cuantas sandalias me quedan?')
    await say('quítale dos a la 39')
    expect(last()).toContain('talla 39: 2 → <b>0</b>')
    await say('cancelar')
    await say('quítale cinco a la 39')
    expect(last()).toContain('nunca queda negativo')
    expect(stocks(tienda, 'SAN-1')).toEqual([1, 2])
  })

  it('docenas, y un precio dentro de una entrada no se confunde con una talla', () => {
    expect(parseCommerce('llegaron dos docenas talla 38 de sandalias')).toMatchObject({ kind: 'stock', mode: 'add', product: 'sandalias', lines: [{ quantity: 24, size: '38' }] })
    expect(parseCommerce('llegó media docena de sandalias')).toMatchObject({ kind: 'stock', lines: [{ quantity: 6 }] })
    expect(parseCommerce('llegaron 3 sandalias a 45 mil')).not.toMatchObject({ lines: [{ size: '45' }] })
  })

  it('una talla o un precio nunca se toman por referencia', () => {
    expect(referencesIn('tenis blancos AD223 talla 2xl a 80mil o 180k')).toEqual(['AD223'])
    expect(referencesIn('sandalias SAN-1 y pm100')).toEqual(['SAN-1', 'PM100'])
    expect(parseNewProduct('agrega 3 negras talla 38')).toBeNull()
  })
})

describe('seguridad: nombres que parecen referencias y «de cada talla»', () => {
  it('«Jordan1» no se toma por referencia: se pregunta, y cada respuesta deja el borrador correcto', async () => {
    expect(referencesIn('tenis Jordan1 Max90 iphone15 ad2')).toEqual([])
    expect(referencesIn('tenis AD223 pm100 SAN-1 ref-7')).toEqual(['AD223', 'PM100', 'SAN-1', 'REF-7'])
    await say('Agrega tenis Jordan1 talla 40, cinco pares, a 300 mil')
    expect(pending()).toEqual([])
    expect(last()).toContain('¿<b>Jordan1</b> es la referencia (código) o es parte del nombre?')
    expect(buttons().map((button) => button.text)).toEqual(['🔖 Es la referencia', '🏷 Es el nombre', '✖ Cancelar'])
    await tap(/Es el nombre/)
    expect(draft().fields.sku).toBeUndefined()
    expect(draft().fields.name).toMatch(/Jordan1/i)
    expect(draft().fields.price).toBe(300000)
    await say('cancelar')
    await say('Agrega tenis Jordan1 talla 40, cinco pares, a 300 mil')
    await tap(/Es la referencia/)
    expect(draft().fields).toMatchObject({ sku: 'JORDAN1', price: 300000 })
    expect(draft().fields.name).not.toMatch(/Jordan1/i)
    expect(skus(tienda)).toEqual(['SAN-1'])
  })

  it('la pregunta de referencia se puede responder con palabras o cancelar, y vencida no crea nada', async () => {
    await say('Créame unos tenis Jordan1 talla 40 a 300 mil')
    await say('es parte del nombre')
    expect(pending().map((row) => row.action)).toEqual(['create_product'])
    await say('cancelar')
    await say('Créame unos tenis Jordan1 talla 40 a 300 mil')
    const reference = buttons().find((button) => /Es la referencia/.test(button.text))!.callback_data!
    await tap(/Cancelar/)
    await send(callbackUpdate(OWNER, reference))
    expect(pending()).toEqual([])
    expect(last()).toContain('ya venció')
  })

  it('un producto existente cuyo nombre termina en número se repone sin preguntar por la referencia', async () => {
    await seedCatalog(h.db, tienda, { products: [{ sku: 'TJ-01', name: 'Tenis Jordan1', price: 300000, variants: [{ size: '40', color: 'Rojo', stock: 2 }] }] })
    await say('llegaron 3 tenis Jordan1 talla 40')
    expect(pending()).toHaveLength(1)
    expect(last()).toContain('2 → <b>5</b>')
    expect(skus(tienda)).toEqual(['SAN-1', 'TJ-01'])
  })

  it('«de cada talla» con varios colores pregunta el color y solo toca las variantes de ese color', async () => {
    const ids = await seedCatalog(h.db, tienda, { products: [{ sku: 'CAM-1', name: 'Camiseta básica', price: 40000, variants: [{ size: 'M', color: 'Negro', stock: 1 }, { size: 'L', color: 'Negro', stock: 1 }] }] })
    for (const size of ['M', 'L']) h.db.query("INSERT INTO product_variants (product_id, sku, name, size, color, stock, sort_order) VALUES (?, ?, ?, ?, 'Blanco', 7, 9)", ids['CAM-1'], `CAM-1-B${size}`, `Blanco ${size}`, size)
    await say('llegaron cinco de cada talla de la camiseta básica')
    expect(pending()).toEqual([])
    expect(last()).toContain('¿De qué color')
    await say('negras')
    // The preview names every size that will change, before anything is saved.
    expect(last()).toContain('Negro · talla M: 1 → <b>6</b> (+5)')
    expect(last()).toContain('Negro · talla L: 1 → <b>6</b> (+5)')
    expect(last()).not.toContain('Blanco')
    expect(stocks(tienda, 'CAM-1')).toEqual([1, 1, 7, 7])
    await tap(/Confirmar/)
    expect(stocks(tienda, 'CAM-1')).toEqual([6, 6, 7, 7])
  })

  it('«de cada talla» no toca variantes inactivas ni otros productos, y nombrar el color evita la pregunta', async () => {
    const ids = await seedCatalog(h.db, tienda, { products: [{ sku: 'CAM-2', name: 'Buzo térmico', price: 90000, variants: [
      { size: 'S', color: 'Gris', stock: 0 }, { size: 'M', color: 'Gris', stock: 2 }, { size: 'XL', color: 'Gris', stock: 9 },
    ] }] })
    h.db.query('UPDATE product_variants SET is_active = 0 WHERE id = ?', ids['CAM-2#XL'])
    await say('llegaron tres grises de cada talla del buzo térmico')
    expect(last()).toContain('talla S: 0 → <b>3</b>')
    expect(last()).toContain('talla M: 2 → <b>5</b>')
    expect(last()).not.toContain('XL')
    await tap(/Confirmar/)
    expect(stocks(tienda, 'CAM-2')).toEqual([3, 5, 9])
    expect(stocks(tienda, 'SAN-1')).toEqual([1, 2])
  })

  it('«de cada talla» sin confirmar no cambia nada, y Corregir ajusta la cantidad antes de aplicar', async () => {
    await say('cuantas sandalias me quedan?')
    await say('llegaron cinco pares de cada talla')
    expect(stocks(tienda, 'SAN-1')).toEqual([1, 2])
    await tap(/Cancelar/)
    expect(stocks(tienda, 'SAN-1')).toEqual([1, 2])
    expect(applied()).toBe(0)
  })
})
