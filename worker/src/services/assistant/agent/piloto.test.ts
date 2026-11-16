/** Fallos que destapó la prueba real en staging del 2026-11-13/15 (docs/PILOTO_PRUEBA_REAL_STAGING.md):
 * clave pegada en el chat, «ponle como nombre X», pregunta general leída como producto y contexto tras una
 * ambigüedad cancelada. Capas de texto y multimedia encendidas; tienda ficticia; sin IA salvo donde se indica. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPng } from '../../../../test/sqliteD1'
import { createHarness, createStoreUser, photoUpdate, seedCatalog, seedStore, textUpdate, type Harness } from '../../../testing/harness'
import { processTelegramUpdate } from '../../telegram'
import { looksLikeSecret, redactSecrets } from '../context'
import { nameIn } from './media'

const OWNER = 9951
// Made-up strings with the shape of real credentials (none of them is or was a working key).
const FAKE_GOOGLE = `AIza${'Sy0FAKEfake0FAKEfake0FAKEfake0FAKEfa'}`
const FAKE_OPENAI = `sk-${'proj0FAKEfake0FAKEfake0FAKE'}`
let h: Harness
let tienda: number
let sent: string[]
let modelCalls: number
let plan: Array<Record<string, unknown>> | null

const say = (text: string) => processTelegramUpdate(textUpdate(OWNER, text) as never, h.env, h.db)
const last = () => (sent.at(-1) || '').replace(/<[^>]+>/g, '')
const draft = () => {
  const row = h.db.query<{ params_json: string }>("SELECT params_json FROM telegram_operations WHERE action = 'create_product' AND status = 'pending'")[0]
  return row ? JSON.parse(row.params_json) as { fields: { name?: string; price?: number }; images: unknown[]; variants: Array<{ size?: string; stock?: number }> } : null
}
const stored = () => h.db.query<{ content: string }>('SELECT content FROM assistant_messages').map((row) => row.content).join('\n')

beforeEach(async () => {
  h = createHarness({ TELEGRAM_BOT_TOKEN: 'bot-token', GEMINI_API_KEY: 'test-key', ASSISTANT_AGENT_STORE_IDS: '*', ASSISTANT_MEDIA_STORE_IDS: '*', ASSISTANT_AGENT_TIMEOUT_MS: '2000' })
  tienda = await seedStore(h.db, { slug: 'piloto-demo', name: 'Piloto Demo', status: 'active' })
  h.db.query('INSERT INTO store_onboarding_legacy_stores (store_id) VALUES (?)', tienda)
  h.db.query('UPDATE stores SET ai_monthly_budget_micros = 50000000 WHERE id = ?', tienda)
  await createStoreUser(h.db, { email: 'ana@piloto.test', storeId: tienda, role: 'owner', telegramUserId: String(OWNER) })
  await seedCatalog(h.db, tienda, { categories: [{ name: 'Calzado', slug: 'calzado' }], products: [
    { sku: 'TEST-TRN-001', name: 'Tenis de prueba', price: 185000, category: 'calzado', variants: [{ size: '38', color: 'Negro', stock: 11 }, { size: '39', color: 'Negro', stock: 13 }] },
    { sku: 'TEN-ROJ-4195', name: 'Tenis rojos de prueba', price: 180000, category: 'calzado', variants: [{ size: '38', color: 'Rojo', stock: 2 }] },
    { sku: 'DEMO-FOTO-2026', name: 'Zapatillas KINETIK Premium', price: 255000, category: 'calzado', variants: [{ size: '38', color: 'Negro', stock: 2 }, { size: '39', color: 'Negro', stock: 2 }] },
  ] })
  sent = []
  modelCalls = 0
  plan = null
  const png = createPng(640, 480)
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('generativelanguage.googleapis.com')) {
      modelCalls += 1
      if (plan) return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ pasos: plan }) }] } }], usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 40 } }))
      return new Response('{"error":{"status":"UNAVAILABLE"}}', { status: 503 })
    }
    if (url.includes('/getFile')) return new Response(JSON.stringify({ ok: true, result: { file_path: 'photos/file.png', file_size: png.byteLength } }))
    if (url.includes('/file/bot')) return new Response(png, { headers: { 'content-length': String(png.byteLength) } })
    if (/sendMessage|sendPhoto/.test(url)) { const body = JSON.parse(String(init?.body || '{}')); sent.push(String(body.text ?? body.caption ?? '')) }
    return new Response(JSON.stringify({ ok: true, result: { message_id: sent.length + 1 } }))
  }))
})
afterEach(() => vi.unstubAllGlobals())

describe('una clave pegada en el chat', () => {
  it('no se guarda, no llega a la IA y el comerciante recibe la advertencia', async () => {
    await say(FAKE_GOOGLE)
    expect(last()).toContain('parece una clave')
    expect(last()).not.toContain(FAKE_GOOGLE)
    expect(stored()).not.toContain('AIza')
    expect(modelCalls).toBe(0)
    expect(h.db.query('SELECT operation_id FROM telegram_operations')).toEqual([])
  })

  it('dentro de una frase se oculta antes de guardar el mensaje', () => {
    expect(redactSecrets(`mi clave de google es ${FAKE_GOOGLE} y la otra ${FAKE_OPENAI}`)).toBe('mi clave de google es [clave oculta] y la otra [clave oculta]')
    expect(looksLikeSecret(`conecta ${FAKE_OPENAI}`)).toBe(true)
  })

  it('no confunde mensajes normales, códigos de producto ni pedidos con una clave', () => {
    for (const text of ['cuántos quedan de los tenis de prueba', 'agrega 5 a la 38 del TEST-TRN-001', 'pedido PED-20261113-D8F63F34', 'súbele 5 mil a las kinetik', 'VINCULAR PBT9-32YF-UX']) {
      expect(looksLikeSecret(text), text).toBe(false)
    }
  })
})

describe('«ponle como nombre X»', () => {
  it('lee el nombre dictado en sus formas habituales', () => {
    expect(nameIn('Es uno nuevo, ponle como nombre Adidas violeta.')).toBe('Adidas violeta')
    expect(nameIn('que se llame Tenis Gold Track')).toBe('Tenis Gold Track')
    expect(nameIn('el nombre es botas cafés, a 200 mil')).toBe('Botas cafés')
    expect(nameIn('cámbiale el nombre a Sandalias playa')).toBe('Sandalias playa')
    expect(nameIn('cambia el precio a 170 mil')).toBeNull()
    expect(nameIn('es uno nuevo')).toBeNull()
  })

  it('la respuesta «es uno nuevo, ponle como nombre…» crea el borrador con ese nombre', async () => {
    // As in the real test: only «Tenis de prueba» existed when the photos arrived.
    h.db.query("DELETE FROM product_variants WHERE product_id IN (SELECT id FROM products WHERE sku = 'TEN-ROJ-4195')")
    h.db.query("DELETE FROM products WHERE sku = 'TEN-ROJ-4195'")
    for (const id of ['f1', 'f2', 'f3']) await processTelegramUpdate(photoUpdate(OWNER, id) as never, h.env, h.db)
    await say('Estos son tenis rojos de prueba, del 38 al 40, dos de cada talla, a 180 mil')
    expect(last()).toContain('¿Es el mismo producto o uno nuevo?')
    expect(draft()).toBeNull()
    await say('Es uno nuevo, ponle como nombre Adidas violeta.')
    expect(draft()).toMatchObject({ fields: { name: 'Adidas violeta', price: 180000 } })
    expect(draft()!.images).toHaveLength(3)
    expect(draft()!.variants.map((variant) => `${variant.size}:${variant.stock}`)).toEqual(['38:2', '39:2', '40:2'])
    expect(sent.join('\n')).toContain('Adidas violeta')
    expect(h.db.query('SELECT sku FROM products WHERE store_id = ?', tienda)).toHaveLength(2)
  })

  it('con el borrador abierto, cambia el nombre sin publicar nada', async () => {
    await processTelegramUpdate(photoUpdate(OWNER, 'g1') as never, h.env, h.db)
    await say('son botas de montaña, talla 40, tres unidades, a 220 mil')
    expect(draft()?.fields.name).toMatch(/botas/i)
    await say('ponle como nombre Botas Andes')
    expect(draft()?.fields.name).toBe('Botas Andes')
    expect(sent.join('\n')).toContain('Botas Andes')
    expect(h.db.query('SELECT sku FROM products WHERE store_id = ?', tienda)).toHaveLength(3)
  })
})

describe('preguntas generales y contexto', () => {
  it('«cuantas unidadfes tengo en total?» responde el total de la tienda, no busca un producto «unidadfes»', async () => {
    await say('cuantas unidadfes tengo en total?')
    expect(last()).not.toContain('No encontré')
    expect(last()).toContain('3 productos')
    expect(last()).toContain('30 unidades en total')
    expect(modelCalls).toBe(0)
  })

  it('«cuántos productos tengo» y «cuánto inventario hay en la tienda» también', async () => {
    await say('cuántos productos tengo?')
    expect(last()).toContain('3 productos')
    await say('cuánto inventario hay en la tienda')
    expect(last()).toContain('30 unidades en total')
  })

  it('tras una pregunta «¿cuál?» cancelada, «¿y cuántos quedan?» pregunta entre los mismos candidatos', async () => {
    await say('cuántos quedan de las kinetik')
    expect(last()).toContain('Zapatillas KINETIK Premium')
    await say('bájale 10 mil a los tenis de prueba')
    expect(last()).toContain('Tengo dos')
    await say('no, déjalo así')
    // What the model returned in the real test for this follow-up: a product query without a product.
    plan = [{ tool: 'ver_producto' }]
    await say('y cuántos quedan?')
    expect(last()).toContain('¿De cuál?')
    expect(last()).toContain('Tenis de prueba')
    expect(last()).toContain('Tenis rojos de prueba')
    expect(last()).not.toContain('KINETIK')
    plan = null
    await say('la 1')
    expect(last()).toContain('Tenis de prueba')
    expect(last()).toMatch(/38: 11/)
    expect(h.db.query("SELECT price FROM products WHERE store_id = ? AND sku = 'TEST-TRN-001'", tienda)).toEqual([{ price: 185000 }])
  })
})
