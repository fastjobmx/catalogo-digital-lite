/** TiendIA phase 1: natural creation, ambiguity questions, the Corregir button, voice notes and feature flags,
 * end to end through the real Telegram handler (fictitious stores only). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { callbackUpdate, createHarness, createStoreUser, seedCatalog, seedStore, stubTelegram, textUpdate, type Harness } from '../../../testing/harness'
import { processTelegramUpdate } from '../../telegram'

type Button = { text: string; callback_data?: string }
const OWNER = 8501
let h: Harness
let tienda: number
let telegram: ReturnType<typeof stubTelegram>
let geminiCalls = 0
let transcript = ''
let updateId = 5_000_000

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
const variants = (sku: string) => h.db.query<{ size: string; stock: number }>('SELECT v.size, v.stock FROM product_variants v JOIN products p ON p.id = v.product_id WHERE p.store_id = ? AND p.sku = ? ORDER BY v.id', tienda, sku)
const draft = () => JSON.parse(pending().find((row) => row.action === 'create_product')!.params_json)
const voiceUpdate = () => ({ update_id: ++updateId, message: { message_id: updateId, from: { id: OWNER, first_name: 'Ana' }, chat: { id: OWNER, type: 'private' as const }, date: 0, voice: { file_id: 'voz-1', duration: 14, mime_type: 'audio/ogg' } } })

function stub() {
  return stubTelegram((url) => {
    if (url.includes('generativelanguage.googleapis.com')) {
      geminiCalls++
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ action: 'ask', params: {}, missing: [], summary: 'ok', needsConfirmation: false, transcript }) }] } }], usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 60 } }))
    }
    if (url.includes('/getFile')) return new Response(JSON.stringify({ ok: true, result: { file_path: 'voice/nota.oga', file_size: 4 } }))
    if (url.includes('/file/bot')) return new Response(new Uint8Array([0x4f, 0x67, 0x67, 0x53]))
    return undefined
  })
}

beforeEach(async () => {
  h = createHarness({ TELEGRAM_BOT_TOKEN: 'bot-token', PUBLIC_STORE_BASE_URL: 'https://tiendas.test', GEMINI_API_KEY: 'test-key' })
  tienda = await seedStore(h.db, { slug: 'moda-inteligente', name: 'Moda Inteligente', status: 'active' })
  const otra = await seedStore(h.db, { slug: 'otra-inteligente', name: 'Otra Inteligente', status: 'active' })
  h.db.query('INSERT INTO store_onboarding_legacy_stores (store_id) VALUES (?), (?)', tienda, otra)
  await createStoreUser(h.db, { email: 'duena@inteligente.test', storeId: tienda, role: 'owner', telegramUserId: String(OWNER) })
  await seedCatalog(h.db, tienda, { products: [
    { sku: 'NK203', name: 'Tenis Nike Blancos', price: 180000, variants: [{ size: '38', color: 'Blanco', stock: 2 }, { size: '39', color: 'Blanco', stock: 1 }] },
    { sku: 'SAN-1', name: 'Sandalias Guess', price: 80000, variants: [{ size: '38', color: 'Negro', stock: 1 }, { size: '39', color: 'Negro', stock: 2 }] },
  ] })
  // The same reference in another store must never interfere.
  await seedCatalog(h.db, otra, { products: [{ sku: 'AD223', name: 'Tenis ajenos', price: 1, variants: [{ size: '40', stock: 9 }] }] })
  geminiCalls = 0; transcript = ''
  telegram = stub()
})
afterEach(() => vi.unstubAllGlobals())

describe('creating a product from one sentence', () => {
  it('captures reference, sizes, units and price; saves nothing before the merchant confirms', async () => {
    h.env.GEMINI_API_KEY = ''
    await say('Agrega unos tenis Adidas blancos, referencia AD223, tallas 38, 39 y 40, cinco pares de cada una, precio 180 mil pesos')
    const text = all()
    expect(text).toContain('Nombre: <b>Tenis Adidas blancos</b>')
    expect(text).toContain('Referencia: <b>AD223</b>')
    expect(text).toContain('$180.000')
    expect(text).toContain('Talla 38: 5 u.')
    expect(text).toContain('Total: 15 u.')
    const created = draft()
    expect(created.fields).toMatchObject({ name: 'Tenis Adidas blancos', sku: 'AD223', price: 180000, brand: 'Adidas' })
    expect(created.variants).toEqual([{ size: '38', color: 'Blanco', stock: 5 }, { size: '39', color: 'Blanco', stock: 5 }, { size: '40', color: 'Blanco', stock: 5 }])
    expect(last()).toMatch(/fotograf/i)
    expect(h.db.query("SELECT COUNT(*) AS n FROM products WHERE store_id = ? AND sku = 'AD223'", tienda)).toEqual([{ n: 0 }])
  })

  it('a reference that already exists is a restock question, never a second product', async () => {
    await say('Agrega unos tenis Nike blancos, referencia NK203, tallas 38 y 39, tres pares de cada una, precio 180 mil')
    expect(last()).toContain('ya existe')
    expect(pending().some((row) => row.action === 'create_product')).toBe(false)
    await tap(/Sumar a Tenis Nike Blancos/)
    expect(last()).toContain('Blanco · talla 38: 2 → <b>5</b>')
    await tap(/Confirmar/)
    expect(variants('NK203').map((row) => row.stock)).toEqual([5, 4])
    expect(h.db.query("SELECT COUNT(*) AS n FROM products WHERE store_id = ? AND sku = 'NK203'", tienda)).toEqual([{ n: 1 }])
  })

  it('"180" is asked, never assumed: $180 or $180.000', async () => {
    await say('Créame unos tenis Puma negros talla 40, 3 unidades, precio 180')
    expect(all()).toContain('te pregunto enseguida')
    expect(last()).toContain('¿Qué precio')
    await say('180')
    expect(last()).toContain('¿Son 180 pesos o 180 mil pesos?')
    expect(draft().fields.price).toBeUndefined()
    await say('180 mil')
    expect(draft().fields.price).toBe(180000)
  })

  it('"agrega 3 negras talla 38" without an article is a restock of the product in focus', async () => {
    await say('cuantas sandalias me quedan?')
    await say('agrega 3 negras talla 38')
    expect(last()).toContain('Negro · talla 38: 1 → <b>4</b>')
    expect(pending().map((row) => row.action)).toEqual(['update_variant_stocks'])
  })
})

describe('price ambiguity on existing products', () => {
  it('asks which amount was meant and applies only the chosen one after confirming', async () => {
    await say('cuantas sandalias me quedan?')
    await say('ponle el precio en 85')
    expect(last()).toContain('¿cuánto es?')
    expect(buttons().map((button) => button.text)).toEqual(expect.arrayContaining(['$85 COP', '$85.000 COP']))
    expect(pending()).toEqual([])
    await tap(/85\.000/)
    expect(last()).toContain('$80.000 COP → <b>$85.000 COP</b>')
    await tap(/Confirmar/)
    expect(h.db.query("SELECT price FROM products WHERE store_id = ? AND sku = 'SAN-1'", tienda)).toEqual([{ price: 85000 }])
  })
})

describe('the Corregir button', () => {
  it('keeps the proposal pending, applies the correction and shows a new summary before saving', async () => {
    await say('me llegaron 9 camisetas')
    await say('cuantas sandalias me quedan?')
    await say('llegaron 3 negras talla 38 y 3 negras talla 39')
    expect(last()).toContain('talla 38: 1 → <b>4</b>')
    expect(buttons().map((button) => button.text)).toEqual(expect.arrayContaining(['✅ Confirmar', '✏️ Corregir', '✖ Cancelar']))
    const before = pending()[0]!
    await tap(/Corregir/)
    expect(last()).toContain('¿Qué dato corrijo?')
    expect(pending()[0]!.params_json).toBe(before.params_json)
    await say('corregí las tallas las 39 son 5 no 3')
    expect(last()).toContain('talla 39: 2 → <b>7</b>')
    expect(pending()).toHaveLength(1)
    await tap(/Confirmar/)
    expect(variants('SAN-1').map((row) => row.stock)).toEqual([4, 7])
    // Pressing the old button again changes nothing.
    await send(callbackUpdate(OWNER, `op:confirm:${(JSON.parse(JSON.stringify(before)) as { operation_id?: string }).operation_id || '00000000-0000-0000-0000-000000000000'}`))
    expect(variants('SAN-1').map((row) => row.stock)).toEqual([4, 7])
  })
})

describe('voice notes', () => {
  it('turns a voice note into a proposal that needs confirmation (one AI call for transcription and reading)', async () => {
    transcript = 'Me llegaron cinco pares de sandalias talla treinta y ocho negras'
    await send(voiceUpdate())
    expect(all()).toContain('🎙️ Entendí')
    expect(geminiCalls).toBe(1)
    expect(last()).toContain('talla 38: 1 → <b>6</b>')
    expect(buttons().map((button) => button.text)).toEqual(expect.arrayContaining(['✅ Confirmar', '✏️ Corregir', '✖ Cancelar']))
    expect(variants('SAN-1').map((row) => row.stock)).toEqual([1, 2])
    await tap(/Confirmar/)
    expect(variants('SAN-1').map((row) => row.stock)).toEqual([6, 2])
  })

  it('an unreadable audio produces no change', async () => {
    transcript = ''
    await send(voiceUpdate())
    expect(last()).toContain('No logré entender el audio')
    expect(pending()).toEqual([])
  })

  it('a too long note is refused before any download or AI call', async () => {
    const long = voiceUpdate()
    ;(long.message.voice as { duration: number }).duration = 400
    await send(long)
    expect(last()).toContain('muy larga')
    expect(geminiCalls).toBe(0)
  })

  it('can be switched off with a flag, without touching anything else', async () => {
    h.env.TELEGRAM_VOICE_ENABLED = 'false'
    transcript = 'llegaron cinco pares de sandalias talla 38'
    await send(voiceUpdate())
    expect(last()).toContain('desactivadas')
    expect(geminiCalls).toBe(0)
    await say('hola')
    expect(last()).toContain('Asistente TiendIA')
  })
})

describe('feature flag of the smart interpreter', () => {
  it('"false" returns to the previous behaviour: no commerce proposal is prepared', async () => {
    h.env.TELEGRAM_SMART_INTERPRETER_ENABLED = 'false'
    h.env.GEMINI_API_KEY = ''
    await say('cuantas sandalias me quedan?')
    await say('agrega 3 negras talla 38')
    // The previous behaviour opened a product draft for this sentence; the smart interpreter prepares no stock proposal.
    expect(pending().some((row) => row.action === 'update_variant_stocks')).toBe(false)
    expect(variants('SAN-1').map((row) => row.stock)).toEqual([1, 2])
  })
})
