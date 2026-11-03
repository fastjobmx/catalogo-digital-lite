import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { callbackUpdate, createHarness, seedStore, stubTelegram, textUpdate, type Harness } from '../../testing/harness'
import { detectMasterIntent } from './bot'

const ADMIN = 9001
const SECRET = 'master-webhook-secret'
let h: Harness

beforeEach(() => {
  h = createHarness({ MASTER_BOT_TOKEN: 'master-token', MASTER_WEBHOOK_SECRET: SECRET, MASTER_ADMIN_TELEGRAM_IDS: `${ADMIN}, 9002`, TELEGRAM_BOT_USERNAME: 'TiendasAsistenteBot' })
})
afterEach(() => vi.unstubAllGlobals())

const deliver = (update: unknown, secret = SECRET) => h.request('/api/master/webhook', { method: 'POST', body: update, headers: secret ? { 'X-Telegram-Bot-Api-Secret-Token': secret } : {} })
const say = (text: string) => deliver(textUpdate(ADMIN, text))
const tap = (data: string) => deliver(callbackUpdate(ADMIN, data))
const button = (telegram: ReturnType<typeof stubTelegram>, label: RegExp) => (telegram.lastMarkup()?.inline_keyboard || []).flat().find((item) => label.test(item.text))?.callback_data

describe('master bot access', () => {
  it('requires its own webhook secret and ignores non-admin users without replying', async () => {
    const telegram = stubTelegram()
    expect((await deliver(textUpdate(ADMIN, '/start'), 'wrong')).status).toBe(403)
    expect(await (await deliver(textUpdate(1234, '/tiendas'))).json()).toMatchObject({ rejected: true })
    expect(telegram.messages()).toHaveLength(0)
    await say('/start')
    expect(telegram.messages()[0]).toContain('centro de control')
  })

  it('deduplicates updates in its own ledger, independent from the store assistant', async () => {
    const telegram = stubTelegram()
    const update = textUpdate(ADMIN, '/resumen')
    h.db.query('INSERT INTO processed_updates (update_id) VALUES (?)', update.update_id)
    await deliver(update)
    expect(await (await deliver(update)).json()).toMatchObject({ duplicate: true })
    expect(telegram.messages()).toHaveLength(1)
  })
})

describe('/crear_tienda guided flow', () => {
  it('creates, verifies and delivers a store from a short conversation, without duplicates on a double tap', async () => {
    const telegram = stubTelegram()
    await say('/crear_tienda')
    expect(telegram.messages().at(-1)).toContain('¿Cómo se llamará?')
    await say('Moda Urbana')
    expect(telegram.messages().at(-1)).toContain('¿Qué tipo de productos venderá?')
    await say('Ropa y accesorios')
    expect(telegram.messages().at(-1)).toContain('estilo visual')
    expect((telegram.lastMarkup()?.inline_keyboard || []).flat().map((item) => item.text)).toEqual(expect.arrayContaining(['⚪ Minimalista', '🔷 Moderno', '✨ Premium', '🎨 Personalizado']))
    await tap('mt:wz:style:personalizado')
    expect(telegram.messages().at(-1)).toContain('color principal')
    await say('azul oscuro')
    await say('+57 300 123 4567')
    await say('duena@modaurbana.test')
    expect(telegram.messages().at(-1)).toContain('plan')
    await tap('mt:wz:plan:profesional')
    const summary = telegram.messages().at(-1)!
    expect(summary).toContain('Resumen de la nueva tienda')
    expect(summary).toContain('moda-urbana')
    expect(summary).toContain('#153D70')
    expect((telegram.lastMarkup()?.inline_keyboard || []).flat().map((item) => item.text)).toEqual(['✅ Crear tienda', '✏️ Modificar datos', '✖ Cancelar'])
    expect(h.db.query("SELECT COUNT(*) AS n FROM stores WHERE slug = 'moda-urbana'")).toEqual([{ n: 0 }])

    await tap('mt:wz:create')
    const delivered = telegram.messages().at(-1)!
    expect(delivered).toContain('Tienda creada y verificada')
    expect(delivered).toContain('https://tiendas.test/t/moda-urbana')
    expect(delivered).toContain('/admin/activar?token=')
    expect(delivered).toContain('https://t.me/TiendasAsistenteBot?start=link_')
    expect(delivered).toContain('✅ Verificar funcionamiento')
    const store = h.db.query<any>("SELECT id, status, template FROM stores WHERE slug = 'moda-urbana'")[0]
    expect(store).toMatchObject({ status: 'draft', template: 'personalizado' })
    expect(h.db.query('SELECT primary_color FROM store_config WHERE id = ?', store.id)).toEqual([{ primary_color: '#153D70' }])

    // A delayed second tap on the same summary does not create a second store.
    await h.db.prepare(`INSERT INTO platform_conversations (chat_id, flow, step, data_json, expires_at) VALUES (?, 'create_store', 'summary', ?, unixepoch() + 600)`)
      .bind(String(ADMIN), JSON.stringify({ name: 'Moda Urbana', slug: 'moda-urbana', businessType: 'Ropa y accesorios', template: 'personalizado', primaryColor: '#153D70', whatsapp: '+573001234567', ownerEmail: 'duena@modaurbana.test', planCode: 'profesional', editing: true })).run()
    await tap('mt:wz:create')
    expect(telegram.messages().at(-1)).toContain('no se duplicó')
    expect(h.db.query("SELECT COUNT(*) AS n FROM stores WHERE slug LIKE 'moda-urbana%'")).toEqual([{ n: 1 }])
  })

  it('lets the operator edit a field from the summary and cancel at any time', async () => {
    const telegram = stubTelegram()
    await say('crea una tienda llamada Pixel Accesorios')
    expect(telegram.messages().at(-1)).toContain('Pixel Accesorios')
    await say('Accesorios para celulares')
    await tap('mt:wz:style:moderno')
    await tap('mt:wz:skipwa')
    await say('8811223344')
    await tap('mt:wz:plan:basico')
    await tap('mt:wz:field:slug')
    await say('pixel')
    expect(telegram.messages().at(-1)).toContain('<code>pixel</code>')
    await tap('mt:wz:cancel')
    expect(telegram.messages().at(-1)).toContain('No se creó ninguna tienda')
    expect(h.db.query("SELECT COUNT(*) AS n FROM stores WHERE slug = 'pixel'")).toEqual([{ n: 0 }])
  })
})

describe('store administration from the master bot', () => {
  it('suspends a store from natural language only after confirmation, and audits it', async () => {
    const telegram = stubTelegram()
    await seedStore(h.db, { slug: 'moda-urbana', name: 'Moda Urbana' })
    await say('suspende moda-urbana por falta de pago')
    expect(telegram.messages().at(-1)).toContain('Confirma esta operación')
    expect(h.db.query("SELECT status FROM stores WHERE slug = 'moda-urbana'")).toEqual([{ status: 'active' }])
    await tap(button(telegram, /Confirmar/)!)
    expect(h.db.query("SELECT status, suspended_reason FROM stores WHERE slug = 'moda-urbana'")).toEqual([{ status: 'suspended', suspended_reason: 'falta de pago' }])
    expect(h.db.query("SELECT performed_by FROM audit_log WHERE action = 'store_status_changed'")).toEqual([{ performed_by: `master:${ADMIN}` }])
  })

  it('sets AI limits and plans with confirmation and lists stores with their status', async () => {
    const telegram = stubTelegram()
    await seedStore(h.db, { slug: 'moda-urbana', name: 'Moda Urbana' })
    await say('/limite_ia moda-urbana 5')
    await tap(button(telegram, /Confirmar/)!)
    expect(h.db.query("SELECT ai_monthly_budget_micros, ai_enabled FROM stores WHERE slug = 'moda-urbana'")).toEqual([{ ai_monthly_budget_micros: 5000000, ai_enabled: 1 }])
    await say('/plan moda-urbana premium')
    await tap(button(telegram, /Confirmar/)!)
    expect(h.db.query("SELECT plan_code FROM stores WHERE slug = 'moda-urbana'")).toEqual([{ plan_code: 'premium' }])
    await say('/tiendas')
    expect(telegram.messages().at(-1)).toContain('Moda Urbana')
    await say('/tienda moda-urbana')
    expect(telegram.messages().at(-1)).toContain('Salud')
    await say('/resumen')
    expect(telegram.messages().at(-1)).toContain('Resumen de la plataforma')
  })

  it('refuses invalid transitions with a clear message and leaves the store unchanged', async () => {
    const telegram = stubTelegram()
    await say('/suspender 1')
    expect(telegram.messages().at(-1)).toMatch(/Confirma|No encontré/)
    await say('/plan no-existe premium')
    expect(telegram.messages().at(-1)).toContain('No encontré la tienda')
  })
})

describe('master natural language', () => {
  it('understands common administrative requests deterministically', () => {
    expect(detectMasterIntent('Crea una tienda llamada Moda Urbana')).toEqual({ action: 'create_store', name: 'Moda Urbana' })
    expect(detectMasterIntent('suspende la tienda moda-urbana por falta de pago')).toEqual({ action: 'suspend_store', store: 'moda-urbana', reason: 'falta de pago' })
    expect(detectMasterIntent('activa moda-urbana')).toEqual({ action: 'activate_store', store: 'moda-urbana' })
    expect(detectMasterIntent('sube el límite de IA de moda-urbana a 5 dólares')).toEqual({ action: 'set_ai_budget', store: 'moda-urbana', budgetUsd: 5 })
    expect(detectMasterIntent('cambia el plan de moda-urbana a premium')).toEqual({ action: 'set_plan', store: 'moda-urbana', plan: 'premium' })
    expect(detectMasterIntent('muéstrame las tiendas activas')).toEqual({ action: 'list_stores', status: 'activas' })
    expect(detectMasterIntent('¿cuántas tiendas tengo?')).toEqual({ action: 'summary' })
  })
})
