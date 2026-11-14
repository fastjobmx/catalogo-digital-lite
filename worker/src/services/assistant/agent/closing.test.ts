/** Cierre del paso 1: reintento de webhook, «deshaz eso» con inventario que cambió entretanto y fallo parcial
 * a propósito en un cambio múltiple. Capa conversacional encendida, sin IA, tienda ficticia. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHarness, createStoreUser, seedCatalog, seedStore, stubTelegram, textUpdate, type Harness } from '../../../testing/harness'
import { processTelegramUpdate } from '../../telegram'

const OWNER = 9911
let h: Harness
let tienda: number
let telegram: ReturnType<typeof stubTelegram>

const say = (text: string) => processTelegramUpdate(textUpdate(OWNER, text) as never, h.env, h.db)
const last = () => (telegram.messages().at(-1) || '').replace(/<[^>]+>/g, '')
const stock = (sku: string, size: string) => h.db.query<{ stock: number }>('SELECT v.stock FROM product_variants v JOIN products p ON p.id = v.product_id WHERE p.store_id = ? AND p.sku = ? AND v.size = ?', tienda, sku, size)[0]!.stock
const price = (sku: string) => h.db.query<{ price: number }>('SELECT price FROM products WHERE store_id = ? AND sku = ?', tienda, sku)[0]!.price
const setStock = (sku: string, size: string, value: number) => h.db.query('UPDATE product_variants SET stock = ? WHERE size = ? AND product_id = (SELECT id FROM products WHERE store_id = ? AND sku = ?)', value, size, tienda, sku)
const pending = () => h.db.query<{ action: string }>("SELECT action FROM telegram_operations WHERE status = 'pending'")
const applied = () => h.db.query<{ n: number }>("SELECT COUNT(*) AS n FROM telegram_operations WHERE status = 'applied'")[0]!.n

beforeEach(async () => {
  h = createHarness({ TELEGRAM_BOT_TOKEN: 'bot-token', TELEGRAM_WEBHOOK_SECRET: 'webhook-secret', GEMINI_API_KEY: '', ASSISTANT_AGENT_STORE_IDS: '*' })
  tienda = await seedStore(h.db, { slug: 'cierre-demo', name: 'Cierre Demo', status: 'active' })
  h.db.query('INSERT INTO store_onboarding_legacy_stores (store_id) VALUES (?)', tienda)
  await createStoreUser(h.db, { email: 'ana@cierre.test', storeId: tienda, role: 'owner', telegramUserId: String(OWNER) })
  await seedCatalog(h.db, tienda, { products: [
    { sku: 'SAN-1', name: 'Sandalias Guess', price: 80000, variants: [{ size: '38', color: 'Negro', stock: 1 }, { size: '39', color: 'Negro', stock: 2 }] },
    { sku: 'GOR-3', name: 'Gorra Negra', price: 35000, variants: [{ size: 'Única', color: 'Negro', stock: 3 }] },
  ] })
  telegram = stubTelegram()
})
afterEach(() => vi.unstubAllGlobals())

describe('mensaje duplicado por reintento del webhook', () => {
  const deliver = (update: unknown) => h.request('/api/telegram/webhook', { method: 'POST', body: update, headers: { 'X-Telegram-Bot-Api-Secret-Token': 'webhook-secret' } })

  it('la misma petición entregada tres veces prepara un solo cambio y responde una sola vez', async () => {
    const update = textUpdate(OWNER, 'agrega 5 a la 38 de las sandalias')
    for (let attempt = 0; attempt < 3; attempt += 1) expect((await deliver(update)).status).toBe(200)
    expect(pending()).toHaveLength(1)
    expect(telegram.messages().filter((message) => message.includes('¿Confirmas?'))).toHaveLength(1)
    expect(stock('SAN-1', '38')).toBe(1)
  })

  it('la misma confirmación entregada tres veces aplica el cambio una sola vez', async () => {
    await deliver(textUpdate(OWNER, 'agrega 5 a la 38 de las sandalias'))
    const confirm = textUpdate(OWNER, 'hágale')
    for (let attempt = 0; attempt < 3; attempt += 1) await deliver(confirm)
    expect(stock('SAN-1', '38')).toBe(6)
    expect(applied()).toBe(1)
    // A second, different «sí» finds nothing left to apply.
    await deliver(textUpdate(OWNER, 'sí'))
    expect(stock('SAN-1', '38')).toBe(6)
    expect(applied()).toBe(1)
  })
})

describe('«deshaz eso» cuando el inventario cambió entretanto', () => {
  it('revierte solo la diferencia: con una venta de 1 par, de 5 baja a 0 (no vuelve a 1, el valor anterior)', async () => {
    await say('agrega 5 a la 38 de las sandalias')
    await say('sí')
    setStock('SAN-1', '38', 5)
    await say('deshaz eso')
    expect(last()).toContain('revierto solo lo que ese cambio sumó o restó')
    expect(stock('SAN-1', '38')).toBe(5)
    await say('sí')
    expect(stock('SAN-1', '38')).toBe(0)
  })

  it('si revertir dejaría el inventario en negativo, se rechaza y no se toca nada', async () => {
    await say('agrega 5 a la 38 de las sandalias')
    await say('sí')
    setStock('SAN-1', '38', 2)
    await say('deshaz eso')
    expect(last()).toContain('No puedo deshacerlo')
    expect(last()).toContain('hoy tiene 2')
    expect(pending()).toEqual([])
    expect(stock('SAN-1', '38')).toBe(2)
  })

  it('sin cambios entretanto vuelve exactamente al valor anterior', async () => {
    await say('agrega 5 a la 38 de las sandalias')
    await say('sí')
    await say('deshaz eso')
    expect(last()).not.toContain('se movió')
    await say('sí')
    expect(stock('SAN-1', '38')).toBe(1)
  })

  it('un precio que alguien volvió a cambiar no se pisa', async () => {
    await say('ponle 90 mil a las sandalias')
    await say('sí')
    h.db.query("UPDATE products SET price = 95000 WHERE store_id = ? AND sku = 'SAN-1'", tienda)
    await say('deshaz eso')
    expect(last()).toContain('volvió a cambiar')
    expect(pending()).toEqual([])
    expect(price('SAN-1')).toBe(95000)
  })
})

describe('fallo parcial a propósito en un cambio múltiple', () => {
  /** Two changes summarised together (the model is not needed: the group is placed in the session as the layer does). */
  async function proposeGroup(): Promise<void> {
    vi.unstubAllGlobals()
    h.env.GEMINI_API_KEY = 'test-key'
    const sent: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('generativelanguage.googleapis.com')) {
        const pasos = [{ tool: 'cambiar_precio', producto: 'sandalias', modo: 'fijar', monto: 90000 }, { tool: 'ajustar_inventario', producto: 'gorra negra', modo: 'restar', lineas: [{ cantidad: 2 }] }]
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ pasos }) }] } }], usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 60 } }))
      }
      if (/sendMessage/.test(url)) sent.push(String(JSON.parse(String(init?.body || '{}')).text || ''))
      return new Response(JSON.stringify({ ok: true, result: { message_id: sent.length + 1 } }))
    }))
    telegram = { messages: () => sent } as never
    await say('ponle 90 mil a las sandalias y quítale 2 a la gorra negra')
    expect(last()).toContain('Son 2 cambios')
  }

  it('si el segundo ya no es posible, el primero se aplica y el informe dice exactamente cuál no', async () => {
    await proposeGroup()
    setStock('GOR-3', 'Única', 1) // Only one cap left: removing 2 is no longer possible.
    await say('sí')
    expect(price('SAN-1')).toBe(90000)
    expect(stock('GOR-3', 'Única')).toBe(1)
    expect(last()).toContain('Apliqué 1 de 2')
    expect(last()).toMatch(/1\) ✔/)
    expect(last()).toMatch(/2\) ✖ No se aplicó/)
    expect(pending()).toEqual([])
    expect(applied()).toBe(1)
  })

  it('si ninguno es posible, no se aplica nada y se dice', async () => {
    await proposeGroup()
    setStock('GOR-3', 'Única', 0)
    h.db.query("UPDATE products SET is_archived = 1 WHERE store_id = ? AND sku = 'SAN-1'", tienda)
    await say('sí')
    expect(last()).toContain('No pude aplicar los cambios')
    expect(applied()).toBe(0)
    expect(pending()).toEqual([])
  })

  it('un «sí» repetido después del grupo no vuelve a aplicar nada', async () => {
    await proposeGroup()
    await say('sí')
    expect(applied()).toBe(2)
    await say('sí')
    expect(applied()).toBe(2)
    expect(stock('GOR-3', 'Única')).toBe(1)
  })
})

describe('lecturas que dependían del modelo ahora son deterministas (modelo caído o sin IA)', () => {
  it('«deja la 39 de las sandalias en 10» es inventario, no un precio dudoso', async () => {
    await say('deja la 39 de las sandalias en 10')
    expect(pending().map((row) => row.action)).toEqual(['update_variant_stocks'])
    expect(last()).not.toMatch(/\$10/)
    expect(stock('SAN-1', '39')).toBe(2)
    await say('no, déjalo así')
    expect(pending()).toEqual([])
    expect(stock('SAN-1', '39')).toBe(2)
  })

  it('«deja las sandalias en 90» sigue preguntando si es $90 o $90.000', async () => {
    await say('deja las sandalias en 90')
    expect(pending()).toEqual([])
    expect(last()).toMatch(/90\.000/)
    expect(price('SAN-1')).toBe(80000)
  })

  it('«productos agotados» es una consulta del catálogo, no una orden ni una pregunta de vuelta', async () => {
    h.db.query('UPDATE product_variants SET stock = 0 WHERE product_id = (SELECT id FROM products WHERE sku = ?)', 'GOR-3')
    await say('productos agotados')
    expect(last()).toContain('Gorra Negra')
    expect(last()).not.toMatch(/¿De qué producto/)
    expect(pending()).toEqual([])
  })
})
