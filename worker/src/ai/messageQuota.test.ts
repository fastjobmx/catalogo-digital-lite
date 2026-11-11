/** TiendIA phase 2: quota of AI messages per plan and billing cycle. Fictitious stores only; the Gemini API is a stub. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { applyMigrations, createTestDatabase, MIGRATIONS_DIR, SqliteD1 } from '../../test/sqliteD1.js'
import { callbackUpdate, createHarness, createStoreUser, seedCatalog, seedStore, stubTelegram, superadminToken, textUpdate, userToken, type Harness } from '../testing/harness'
import { processTelegramUpdate } from '../services/telegram'
import { completeMessage, cycleFor, getConsumption, releaseMessage, reserveMessage, resolveCycle, resolveLimit } from './messageQuota'

const OWNER = 8701
const OTHER = 8702
let h: Harness
let a: number
let b: number
let telegram: ReturnType<typeof stubTelegram>
let geminiCalls = 0
let geminiStatus = 200
let transcript = ''
let updateId = 7_000_000

const send = (update: unknown) => processTelegramUpdate(update as never, h.env, h.db)
const say = (text: string, user = OWNER) => send(textUpdate(user, text))
const last = () => telegram.messages().at(-1) || ''
const all = () => telegram.messages().join('\n')
const ledger = (store = a) => h.db.query<{ status: string; channel: string; feature: string; event_key: string; transcription_cost_micros: number; audio_seconds: number; calls: number; ai_cost_micros: number }>('SELECT * FROM ai_message_ledger WHERE store_id = ? ORDER BY id', store)
const consumed = (store = a) => ledger(store).filter((row) => row.status === 'consumed').length
const events = (code: string, store = a) => h.db.query<{ detail: string }>('SELECT detail FROM platform_events WHERE store_id = ? AND code = ?', store, code)
const voiceUpdate = () => ({ update_id: ++updateId, message: { message_id: updateId, from: { id: OWNER, first_name: 'Ana' }, chat: { id: OWNER, type: 'private' as const }, date: 0, voice: { file_id: 'voz-1', duration: 14, mime_type: 'audio/ogg' } } })
let n = 0
/** A message that no deterministic rule understands, so it needs the AI (each one is different: no loop alarm). */
const needsAi = (user = OWNER) => say(`organiza mi bodega con ideas distintas número ${++n} por favor`, user)
const setLimit = (store: number, limit: number | null) => h.db.query('UPDATE stores SET ai_monthly_messages_override = ? WHERE id = ?', limit, store)

function stub() {
  return stubTelegram((url) => {
    if (url.includes('generativelanguage.googleapis.com')) {
      geminiCalls++
      if (geminiStatus !== 200) return new Response('{}', { status: geminiStatus })
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ action: 'ask', params: {}, missing: [], summary: 'Claro, te ayudo con eso.', needsConfirmation: false, transcript, answer: 'Claro, te ayudo con eso.' }) }] } }], usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 60 } }))
    }
    if (url.includes('/getFile')) return new Response(JSON.stringify({ ok: true, result: { file_path: 'voice/nota.oga', file_size: 4 } }))
    if (url.includes('/file/bot')) return new Response(new Uint8Array([0x4f, 0x67, 0x67, 0x53]))
    return undefined
  })
}

beforeEach(async () => {
  h = createHarness({ TELEGRAM_BOT_TOKEN: 'bot-token', PUBLIC_STORE_BASE_URL: 'https://tiendas.test', GEMINI_API_KEY: 'test-key', AI_MESSAGE_QUOTA_MODE: 'shadow' })
  a = await seedStore(h.db, { slug: 'cuota-a', name: 'Cuota A', status: 'active' })
  b = await seedStore(h.db, { slug: 'cuota-b', name: 'Cuota B', status: 'active' })
  h.db.query('INSERT INTO store_onboarding_legacy_stores (store_id) VALUES (?), (?)', a, b)
  await createStoreUser(h.db, { email: 'a@cuota.test', storeId: a, role: 'owner', telegramUserId: String(OWNER) })
  await createStoreUser(h.db, { email: 'b@cuota.test', storeId: b, role: 'owner', telegramUserId: String(OTHER) })
  await seedCatalog(h.db, a, { products: [{ sku: 'SAN-1', name: 'Sandalias Guess', price: 80000, variants: [{ size: '38', color: 'Negro', stock: 1 }] }] })
  geminiCalls = 0; geminiStatus = 200; transcript = ''; n = 0
  telegram = stub()
})
afterEach(() => vi.unstubAllGlobals())

describe('billing cycle', () => {
  it('uses the anchor day of the cycle, in Bogota time', () => {
    expect(cycleFor(15, new Date('2026-11-20T12:00:00Z'), 'store')).toMatchObject({ key: '2026-11-15', end: '2026-12-15' })
    expect(cycleFor(15, new Date('2026-11-10T12:00:00Z'), 'store')).toMatchObject({ key: '2026-10-15', end: '2026-11-15' })
    expect(cycleFor(15, new Date('2026-01-10T12:00:00Z'), 'store')).toMatchObject({ key: '2025-12-15', end: '2026-01-15' })
    // 01:00 UTC on December 1st is still November 30th in Bogota.
    expect(cycleFor(1, new Date('2026-12-01T01:00:00Z'), 'calendar')).toMatchObject({ key: '2026-11-01', end: '2026-12-01' })
  })

  it('clamps day 31 in short months instead of skipping a cycle', () => {
    expect(cycleFor(31, new Date('2026-02-20T12:00:00Z'), 'service')).toMatchObject({ key: '2026-01-31', end: '2026-02-28' })
    expect(cycleFor(31, new Date('2026-03-05T12:00:00Z'), 'service')).toMatchObject({ key: '2026-02-28', end: '2026-03-31' })
  })

  it('prefers the real cycle: store anchor, then the start of the active monthly service, then the calendar month (provisional)', async () => {
    const now = new Date('2026-11-20T12:00:00Z')
    expect(await resolveCycle(h.db, a, now)).toMatchObject({ source: 'calendar', provisional: true, key: '2026-11-01' })
    h.db.query("INSERT INTO store_services (store_id, service_code, billing, status, starts_at) VALUES (?, 'asistente_ia', 'mensual', 'activo', '2026-03-12 15:00:00')", a)
    expect(await resolveCycle(h.db, a, now)).toMatchObject({ source: 'service', provisional: false, key: '2026-11-12', end: '2026-12-12' })
    h.db.query('UPDATE stores SET ai_cycle_anchor_day = 5 WHERE id = ?', a)
    expect(await resolveCycle(h.db, a, now)).toMatchObject({ source: 'store', key: '2026-11-05' })
    // A cancelled service or a one-time charge is not a billing cycle.
    h.db.query('UPDATE stores SET ai_cycle_anchor_day = NULL WHERE id = ?', a)
    h.db.query("UPDATE store_services SET status = 'cancelado'")
    expect(await resolveCycle(h.db, a, now)).toMatchObject({ source: 'calendar' })
  })
})

describe('plans and limits', () => {
  it('adds Emprendedor, Negocio and Mayorista INACTIVE and leaves the existing plans untouched', () => {
    const rows = h.db.query<Record<string, unknown>>('SELECT code, setup_price, monthly_price, annual_price, is_active, ai_monthly_messages, ai_usage_policy FROM plans ORDER BY sort_order')
    expect(rows.filter((row) => ['basico', 'profesional', 'premium', 'legacy'].includes(String(row.code))).map((row) => [row.code, row.is_active, row.ai_monthly_messages, row.ai_usage_policy, row.setup_price])).toEqual([
      ['basico', 1, null, 'none', 0], ['profesional', 1, null, 'none', 0], ['premium', 1, null, 'none', 0], ['legacy', 1, null, 'none', 0],
    ])
    expect(rows.filter((row) => !['basico', 'profesional', 'premium', 'legacy'].includes(String(row.code)))).toEqual([
      { code: 'emprendedor', setup_price: 149000, monthly_price: 59900, annual_price: 599000, is_active: 0, ai_monthly_messages: 500, ai_usage_policy: 'quota' },
      { code: 'negocio', setup_price: 199000, monthly_price: 99900, annual_price: 999000, is_active: 0, ai_monthly_messages: null, ai_usage_policy: 'monitored' },
      { code: 'mayorista', setup_price: 299000, monthly_price: 169900, annual_price: 1699000, is_active: 0, ai_monthly_messages: null, ai_usage_policy: 'monitored' },
    ])
    expect(h.db.query("SELECT code FROM plans WHERE code = 'promocional'")).toEqual([])
  })

  it('inactive plans are not offered by the platform and no store is migrated to them', async () => {
    const response = await h.request('/api/platform/plans', { token: await superadminToken() })
    expect(((await response.json()) as { items: Array<{ code: string }> }).items.map((plan) => plan.code)).toEqual(['basico', 'profesional', 'premium', 'legacy'])
    expect(h.db.query("SELECT COUNT(*) AS n FROM stores WHERE plan_code IN ('emprendedor', 'negocio', 'mayorista')")).toEqual([{ n: 0 }])
  })

  it('resolves the limit: store override (historical clients), then the plan, otherwise no numeric cap', async () => {
    h.db.query("UPDATE stores SET plan_code = 'emprendedor' WHERE id = ?", a)
    expect(await resolveLimit(h.db, a)).toMatchObject({ limit: 500, policy: 'quota', overridden: false })
    setLimit(a, 300)
    expect(await resolveLimit(h.db, a)).toMatchObject({ limit: 300, policy: 'quota', overridden: true })
    h.db.query("UPDATE stores SET plan_code = 'negocio', ai_monthly_messages_override = NULL WHERE id = ?", a)
    expect(await resolveLimit(h.db, a)).toMatchObject({ limit: null, policy: 'monitored' })
    expect(await resolveLimit(h.db, b)).toMatchObject({ limit: null, policy: 'none' })
  })
})

describe('what counts', () => {
  it('mode off (default) counts nothing and changes nothing', async () => {
    h.env.AI_MESSAGE_QUOTA_MODE = undefined
    await needsAi()
    expect(geminiCalls).toBeGreaterThan(0)
    expect(ledger()).toEqual([])
  })

  it('an AI interaction counts once however many model calls it needs, with its cost', async () => {
    await needsAi()
    // The commerce reader and the general interpreter both ran for this message: still ONE interaction.
    expect(geminiCalls).toBe(2)
    expect(ledger()).toHaveLength(1)
    expect(ledger()[0]).toMatchObject({ status: 'consumed', channel: 'telegram_text', calls: 2 })
    expect(ledger()[0]!.ai_cost_micros).toBeGreaterThan(0)
  })

  it('buttons, help, commands, deterministic inventory queries and confirmations do not count', async () => {
    await say('/ayuda')
    await say('/menu')
    await say('cuantas sandalias me quedan?')
    await say('llegaron 3 negras talla 38')
    const confirm = ((telegram.lastMarkup()?.inline_keyboard || []) as Array<Array<{ text: string; callback_data?: string }>>).flat().find((button) => /Confirmar/.test(button.text))
    await send(callbackUpdate(OWNER, confirm!.callback_data!))
    expect(h.db.query("SELECT v.stock FROM product_variants v JOIN products p ON p.id = v.product_id WHERE p.store_id = ?", a)).toEqual([{ stock: 4 }])
    expect(geminiCalls).toBe(0)
    expect(ledger()).toEqual([])
  })

  it('a failed AI call does not count and a retry of the same message can still be counted once', async () => {
    geminiStatus = 503
    await needsAi()
    expect(ledger().map((row) => row.status)).toEqual(['released'])
    expect(consumed()).toBe(0)
    geminiStatus = 200
    const retry = textUpdate(OWNER, 'organiza mi bodega con ideas distintas por favor')
    await send(retry)
    await send(retry)
    expect(consumed()).toBe(1)
  })

  it('the same Telegram event never counts twice, even if reserved and completed again', async () => {
    const ref = { storeId: a, eventKey: 'tg:900001', feature: 'interpretacion' }
    expect((await reserveMessage(h.db, h.env, ref)).state).toBe('counted')
    expect((await reserveMessage(h.db, h.env, ref)).state).toBe('duplicate')
    await completeMessage(h.db, h.env, ref, { costMicros: 500, promptTokens: 900 })
    expect((await reserveMessage(h.db, h.env, ref)).state).toBe('duplicate')
    await completeMessage(h.db, h.env, ref, { costMicros: 300, promptTokens: 700 })
    expect(consumed()).toBe(1)
    expect(ledger()[0]).toMatchObject({ calls: 2, ai_cost_micros: 800 })
  })

  it('a voice note is ONE interaction (one call) and its transcription cost is recorded apart', async () => {
    transcript = 'organiza mi bodega con ideas nuevas por favor'
    await send(voiceUpdate())
    expect(geminiCalls).toBe(1)
    expect(ledger()).toHaveLength(1)
    expect(ledger()[0]).toMatchObject({ channel: 'telegram_voice', feature: 'voz', status: 'consumed', audio_seconds: 14 })
    expect(ledger()[0]!.transcription_cost_micros).toBeGreaterThan(0)
    expect(ledger()[0]!.transcription_cost_micros).toBeLessThanOrEqual(ledger()[0]!.ai_cost_micros)
  })

  it('a voice note that cannot be understood still counts once only if the AI call succeeded, and never twice for retries', async () => {
    geminiStatus = 503
    await send(voiceUpdate())
    expect(consumed()).toBe(0)
    geminiStatus = 200
    transcript = ''
    const update = voiceUpdate()
    await send(update)
    await send(update)
    expect(consumed()).toBe(1)
  })
})

describe('limits and concurrency', () => {
  it('shadow counts past the limit and never blocks', async () => {
    setLimit(a, 2)
    for (let i = 0; i < 4; i++) await needsAi()
    expect(geminiCalls).toBe(8)
    expect(consumed()).toBe(4)
    expect(all()).not.toContain('Usaste los')
  })

  it('enforce blocks AI interpretation at the limit but keeps deterministic functions working', async () => {
    h.env.AI_MESSAGE_QUOTA_MODE = 'enforce'
    setLimit(a, 2)
    await needsAi(); await needsAi()
    expect(consumed()).toBe(2)
    await needsAi()
    expect(geminiCalls).toBe(4)
    expect(last()).toContain('Usaste los 2 mensajes con IA')
    expect(consumed()).toBe(2)
    // Help, queries, commands and pending confirmations are never blocked.
    await say('/ayuda')
    expect(last()).toBeTruthy()
    await say('cuantas sandalias me quedan?')
    expect(last()).toContain('Sandalias')
    await say('llegaron 3 negras talla 38')
    const buttons = ((telegram.lastMarkup()?.inline_keyboard || []) as Array<Array<{ text: string; callback_data?: string }>>).flat()
    await send(callbackUpdate(OWNER, buttons.find((button) => /Confirmar/.test(button.text))!.callback_data!))
    expect(h.db.query("SELECT v.stock FROM product_variants v JOIN products p ON p.id = v.product_id WHERE p.store_id = ?", a)).toEqual([{ stock: 4 }])
    await say('/consumo')
    expect(last()).toContain('2</b> de <b>2')
  })

  it('simultaneous reservations near the limit never exceed it', async () => {
    h.env.AI_MESSAGE_QUOTA_MODE = 'enforce'
    setLimit(a, 3)
    const results = await Promise.all(Array.from({ length: 12 }, (_, index) => reserveMessage(h.db, h.env, { storeId: a, eventKey: `tg:c${index}`, feature: 'interpretacion' })))
    expect(results.filter((result) => result.state === 'counted')).toHaveLength(3)
    expect(results.filter((result) => result.state === 'blocked')).toHaveLength(9)
    expect(ledger()).toHaveLength(3)
  })

  it('a released reservation frees its place, and an abandoned one expires', async () => {
    h.env.AI_MESSAGE_QUOTA_MODE = 'enforce'
    setLimit(a, 1)
    const first = { storeId: a, eventKey: 'tg:r1', feature: 'interpretacion' }
    const second = { storeId: a, eventKey: 'tg:r2', feature: 'interpretacion' }
    expect((await reserveMessage(h.db, h.env, first)).state).toBe('counted')
    expect((await reserveMessage(h.db, h.env, second)).state).toBe('blocked')
    await releaseMessage(h.db, h.env, first)
    expect((await reserveMessage(h.db, h.env, second)).state).toBe('counted')
    h.db.query("UPDATE ai_message_ledger SET created_at = datetime('now', '-30 minutes') WHERE event_key = 'tg:r2'")
    expect((await reserveMessage(h.db, h.env, { storeId: a, eventKey: 'tg:r3', feature: 'interpretacion' })).state).toBe('counted')
  })

  it('stores are counted apart: exhausting one never affects another', async () => {
    h.env.AI_MESSAGE_QUOTA_MODE = 'enforce'
    setLimit(a, 1)
    await needsAi(); await needsAi()
    expect(consumed(a)).toBe(1)
    await needsAi(OTHER)
    expect(consumed(b)).toBe(1)
    expect(geminiCalls).toBe(4)
  })

  it('a counter failure never takes the assistant down', async () => {
    h.db.query('DROP TABLE ai_message_ledger')
    await needsAi()
    expect(geminiCalls).toBe(2)
    expect(last()).toContain('Claro')
  })
})

describe('alerts', () => {
  it('warns at 80 % and at 100 % once per cycle, after the answer, and keeps working in shadow mode', async () => {
    setLimit(a, 5)
    for (let i = 0; i < 3; i++) await needsAi()
    expect(all()).not.toContain('80 %')
    await needsAi()
    expect(telegram.messages().at(-1)).toContain('4 de 5 mensajes con IA')
    expect(telegram.messages().at(-2)).toContain('Claro')
    await needsAi()
    expect(telegram.messages().at(-1)).toContain('Llegaste a 5 de 5')
    await needsAi(); await needsAi()
    expect(telegram.messages().filter((message) => message.includes('mensajes con IA de este ciclo'))).toHaveLength(2)
    expect(events('AI_QUOTA_80')).toHaveLength(1)
    expect(events('AI_QUOTA_100')).toHaveLength(1)
    expect(h.db.query('SELECT threshold FROM ai_message_alerts WHERE store_id = ? ORDER BY threshold', a)).toEqual([{ threshold: 80 }, { threshold: 100 }])
  })

  it('plans without a numeric cap are never warned', async () => {
    h.db.query("UPDATE stores SET plan_code = 'negocio' WHERE id = ?", a)
    for (let i = 0; i < 4; i++) await needsAi()
    expect(all()).not.toContain('mensajes con IA de este ciclo')
    expect(h.db.query('SELECT 1 FROM ai_message_alerts')).toEqual([])
  })
})

describe('observation of monitored plans (never blocks)', () => {
  it('flags unusual daily volume once, and a message repeated in a loop', async () => {
    h.env.AI_MONITOR_DAILY_MESSAGES = '3'
    h.env.AI_MONITOR_LOOP_REPEATS = '3'
    h.env.AI_MESSAGE_QUOTA_MODE = 'enforce'
    h.db.query("UPDATE stores SET plan_code = 'negocio' WHERE id = ?", a)
    for (let i = 0; i < 5; i++) await say('organiza mi bodega con la misma frase repetida')
    expect(consumed()).toBe(5)
    expect(events('AI_USAGE_ANOMALY')).toHaveLength(1)
    expect(events('AI_LOOP_SUSPECTED')).toHaveLength(1)
    expect(geminiCalls).toBeGreaterThanOrEqual(5)
  })

  it('the ledger never stores message contents', async () => {
    await say('organiza mi bodega secreto-ultra-privado por favor')
    const columns = JSON.stringify(h.db.query('SELECT * FROM ai_message_ledger'))
    expect(columns).not.toContain('secreto')
    expect(columns).not.toContain('bodega')
  })
})

describe('/consumo', () => {
  it('shows plan, used, available and cycle without calling the AI or counting', async () => {
    h.db.query("UPDATE stores SET plan_code = 'emprendedor' WHERE id = ?", a)
    await needsAi(); await needsAi()
    const before = geminiCalls
    await say('/consumo')
    expect(last()).toContain('Emprendedor')
    expect(last()).toContain('2</b> de <b>500')
    expect(last()).toContain('Disponibles: <b>498</b>')
    expect(last()).toContain('mes calendario')
    await say('¿cuántos mensajes me quedan?')
    expect(last()).toContain('Disponibles: <b>498</b>')
    expect(geminiCalls).toBe(before)
    expect(consumed()).toBe(2)
  })

  it('says so plainly when the counter is off, and reports a monitored plan without a cap', async () => {
    h.env.AI_MESSAGE_QUOTA_MODE = 'off'
    await say('/consumo')
    expect(last()).toContain('no llevo la cuenta')
    h.env.AI_MESSAGE_QUOTA_MODE = 'shadow'
    h.db.query("UPDATE stores SET plan_code = 'negocio' WHERE id = ?", a)
    await say('/consumo')
    expect(last()).toContain('uso conversacional ampliado')
    expect(last()).not.toMatch(/shadow|ledger|enforce/i)
  })

  it('reads only the store of the chat', async () => {
    await needsAi(OTHER); await needsAi(OTHER); await needsAi(OTHER)
    await say('/consumo')
    expect(last()).toContain('Mensajes con IA este ciclo: <b>0</b>')
  })
})

describe('administrative API', () => {
  it('only the superadministrator sees all stores; each store admin sees only its own consumption', async () => {
    await needsAi(); await needsAi(OTHER)
    expect((await h.request('/api/platform/ai-messages')).status).toBe(401)
    const platform = await (await h.request('/api/platform/ai-messages', { token: await superadminToken() })).json() as any
    expect(platform.mode).toBe('shadow')
    expect(platform.items.filter((item: any) => item.store.slug.startsWith('cuota-')).map((item: any) => [item.store.slug, item.used]).sort()).toEqual([['cuota-a', 1], ['cuota-b', 1]])
    const owner = await userToken(h.db.query<{ id: number }>("SELECT id FROM platform_users WHERE email = 'a@cuota.test'")[0]!.id, 'a@cuota.test')
    const own = await (await h.request('/api/admin/ai-messages', { token: owner, store: 'cuota-a' })).json() as any
    expect(own).toMatchObject({ used: 1, mode: 'shadow' })
    expect(JSON.stringify(own)).not.toContain('cuota-b')
    expect((await h.request('/api/admin/ai-messages', { token: owner, store: 'cuota-b' })).status).toBeGreaterThanOrEqual(401)
    expect((await h.request('/api/platform/ai-messages', { token: owner })).status).toBeGreaterThanOrEqual(401)
  })

  it('detail per store lists recent interactions without contents, alerts and signals', async () => {
    setLimit(a, 2)
    await needsAi(); await needsAi()
    const detail = await (await h.request('/api/platform/stores/cuota-a/ai-messages', { token: await superadminToken() })).json() as any
    expect(detail).toMatchObject({ used: 2, limit: 2, percent: 100, overridden: true })
    expect(detail.recent).toHaveLength(2)
    expect(detail.alerts.map((alert: any) => alert.threshold)).toEqual(expect.arrayContaining([80, 100]))
    expect(Object.keys(detail.recent[0])).not.toEqual(expect.arrayContaining(['text', 'message', 'content']))
    expect((await h.request('/api/platform/stores/no-existe/ai-messages', { token: await superadminToken() })).status).toBe(404)
  })

  it('the cycle anchor and the quota override are validated and audited, and touch nothing else', async () => {
    const token = await superadminToken()
    const put = (body: unknown) => h.request('/api/platform/stores/cuota-a/ai-messages', { method: 'PUT', token, body })
    expect((await put({ cycleAnchorDay: 31 })).status).toBe(400)
    expect((await put({ monthlyMessagesOverride: -1 })).status).toBe(400)
    expect((await put({})).status).toBe(400)
    const planBefore = h.db.query('SELECT plan_code, ai_monthly_budget_micros FROM stores WHERE id = ?', a)
    expect((await put({ cycleAnchorDay: 12, monthlyMessagesOverride: 300 })).status).toBe(200)
    expect(h.db.query('SELECT ai_cycle_anchor_day, ai_monthly_messages_override FROM stores WHERE id = ?', a)).toEqual([{ ai_cycle_anchor_day: 12, ai_monthly_messages_override: 300 }])
    expect(h.db.query('SELECT plan_code, ai_monthly_budget_micros FROM stores WHERE id = ?', a)).toEqual(planBefore)
    expect(h.db.query("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'store_ai_messages_changed' AND store_id = ?", a)).toEqual([{ n: 1 }])
    expect(h.db.query('SELECT ai_monthly_messages_override FROM stores WHERE id = ?', b)).toEqual([{ ai_monthly_messages_override: null }])
    expect((await getConsumption(h.db, a)).limit).toBe(300)
  })
})

describe('migration 0023', () => {
  it('rolls back cleanly on a database with data, leaving the existing plans and stores intact', () => {
    const db = createTestDatabase() as SqliteD1
    db.sqlite.exec("INSERT INTO stores (id, slug, name, status, plan_code) VALUES (50, 'vieja', 'Vieja', 'active', 'premium')")
    db.sqlite.exec("INSERT INTO ai_message_ledger (store_id, cycle_key, event_key) VALUES (50, '2026-11-01', 'tg:1')")
    db.sqlite.exec(readFileSync(join(MIGRATIONS_DIR, '..', 'rollback', '0023_ai_message_quota.down.sql'), 'utf8'))
    const tables = db.query<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'ai_message_%'")
    expect(tables).toEqual([])
    expect(db.query<{ code: string }>('SELECT code FROM plans ORDER BY sort_order').map((row) => row.code)).toEqual(['basico', 'profesional', 'premium', 'legacy'])
    expect(db.query<{ plan_code: string }>("SELECT plan_code FROM stores WHERE id = 50")).toEqual([{ plan_code: 'premium' }])
    expect(db.query("SELECT name FROM pragma_table_info('stores') WHERE name LIKE 'ai_%quota%' OR name IN ('ai_cycle_anchor_day', 'ai_monthly_messages_override')")).toEqual([])
    // The migration can be applied again after a rollback.
    db.sqlite.exec(readFileSync(join(MIGRATIONS_DIR, '0023_ai_message_quota.sql'), 'utf8'))
    expect(db.query("SELECT COUNT(*) AS n FROM plans WHERE is_active = 0")).toEqual([{ n: 3 }])
    db.close()
  })

  it('rollback keeps a new plan that a store already uses', () => {
    const db = applyMigrations(new SqliteD1()) as SqliteD1
    db.sqlite.exec("INSERT INTO stores (id, slug, name, status, plan_code) VALUES (51, 'usa-plan', 'Usa plan', 'active', 'emprendedor')")
    db.sqlite.exec('PRAGMA foreign_keys = OFF')
    db.sqlite.exec(readFileSync(join(MIGRATIONS_DIR, '..', 'rollback', '0023_ai_message_quota.down.sql'), 'utf8'))
    expect(db.query("SELECT code FROM plans WHERE code = 'emprendedor'")).toEqual([{ code: 'emprendedor' }])
    db.close()
  })
})
