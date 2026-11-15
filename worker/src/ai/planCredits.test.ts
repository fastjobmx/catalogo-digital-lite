/** IA por plan, créditos artísticos y API propia. Todo con el modelo SIMULADO: ninguna prueba llama a Gemini. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPng } from '../../test/sqliteD1'
import { createHarness, createStoreUser, seedStore, userToken, type Harness } from '../testing/harness'
import { callGeminiJson } from './geminiClient'
import { editPhotoWithInstruction } from './imageStudio'
import { creditSummary, grantCredits, runWithCredits } from './credits'
import { creditLots, expireCreditLots, grantPlanCredits, walletSummary } from './creditWallet'
import { decryptApiKey, encryptApiKey } from './ownKey'
import { AiSpendBlockedError, runWithSpend, type SpendContext } from './spendGuard'
import { aiOverview } from './aiOverview'
import { noticeText, takeQuotaNotice } from './quotaNotices'

const MASTER = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => (i * 7 + 3) % 256)))
const OWN_KEY = 'AIzaSyPropiaDeLaTiendaA_1234567890abcdEF'
const PLATFORM_KEY = 'test-key'

let h: Harness
let emp: number // Emprendedor (plan nuevo)
let neg: number // Negocio (plan nuevo)
let legacy: number // contrato anterior
type Call = { key: string | null; url: string }
let calls: Call[] = []
let modelReply: (call: Call) => Response

const ok = () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 100 } }))
const imageOk = () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: btoa(String.fromCharCode(...createPng(8, 8))) } }] } }], usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 1290 } }))
const modelsList = (names: string[]) => new Response(JSON.stringify({ models: names.map((name) => ({ name: `models/${name}` })) }))

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const key = new Headers(init?.headers).get('x-goog-api-key')
    if (url.includes('/v1beta/models?')) {
      if (key === 'AIzaSyInvalidaInvalidaInvalida0000000000') return new Response('{"error":{"status":"INVALID_ARGUMENT","message":"API key not valid"}}', { status: 400 })
      if (key === 'AIzaSySinCuotaSinCuotaSinCuota000000000') return new Response('{"error":{"status":"RESOURCE_EXHAUSTED"}}', { status: 429 })
      if (key === 'AIzaSySoloTextoSoloTextoSoloTexto0000000') return modelsList(['gemini-3.8-flash'])
      return modelsList(['gemini-3.8-flash', 'gemini-3.1-flash-image'])
    }
    if (url.includes('generativelanguage.googleapis.com')) {
      const call = { key, url }
      calls.push(call)
      return modelReply(call)
    }
    throw new Error(`Unexpected fetch ${url}`)
  }))
}

const spend = (storeId: number, opKey: string, feature = 'interpretacion'): SpendContext => ({ db: h.db, env: h.env, scope: 'store', storeId, feature, opKey })
const ask = (storeId: number, opKey: string, feature = 'interpretacion', text = opKey) =>
  runWithSpend(spend(storeId, opKey, feature), () => callGeminiJson(h.env, fetch, { system: ['Responde JSON.'], parts: [{ text }], schema: { type: 'object' }, maxOutputTokens: 200 }))
const reason = async (promise: Promise<unknown>) => { try { await promise; return null } catch (error) { return error instanceof AiSpendBlockedError ? error.reason : `otro: ${(error as Error).message}` } }
const units = (storeId: number) => h.db.query<{ units: number }>(`SELECT COALESCE(SUM(units), 0) AS units FROM ai_spend_reservations WHERE store_id = ? AND billing_source = 'plan' AND status <> 'released'`, storeId)[0]!.units
const png = () => ({ mimeType: 'image/png', data: btoa(String.fromCharCode(...createPng(20, 20))) })

beforeEach(async () => {
  h = createHarness({ GEMINI_API_KEY: PLATFORM_KEY, GEMINI_MODEL: 'gemini-3.8-flash', GEMINI_IMAGE_MODEL: 'gemini-3.1-flash-image', AI_KEYS_MASTER_KEY: MASTER })
  emp = await seedStore(h.db, { slug: 'emp', name: 'Emprendedora', plan: 'emprendedor' })
  neg = await seedStore(h.db, { slug: 'neg', name: 'Negociante', plan: 'negocio' })
  legacy = await seedStore(h.db, { slug: 'antigua', name: 'Antigua', plan: 'profesional' })
  calls = []
  modelReply = () => ok()
  stubFetch()
})
afterEach(() => vi.unstubAllGlobals())

describe('cupo mensual de consultas (sin sesiones ni cupos diarios)', () => {
  it('100 consultas en un mismo día: todas pasan (no hay cupo diario ni por sesión)', async () => {
    // In real use they are spread over the day; here they run in seconds, so the anti-flood limit (60 per minute,
    // tested on its own) is lifted for this test.
    h.env.AI_STORE_BURST_PER_MINUTE = '1000'
    for (let i = 0; i < 100; i++) expect(await reason(ask(emp, `dia-${i}`))).toBeNull()
    expect(units(emp)).toBe(100)
    expect(h.db.query('SELECT COUNT(*) AS n FROM ai_sessions')).toEqual([{ n: 0 }])
  })

  it('las 300 consultas del plan Emprendedor se pueden usar; la 301 se pausa sin llamar al modelo y dice la fecha de renovación', async () => {
    h.env.AI_STORE_BURST_PER_MINUTE = '1000'
    for (let i = 0; i < 300; i++) await ask(emp, `mes-${i}`)
    const before = calls.length
    const error = await ask(emp, 'mes-300').then(() => null, (e) => e as AiSpendBlockedError)
    expect(error?.reason).toBe('monthly_units')
    expect(error?.userMessage).toMatch(/Usaste las 300 consultas de IA incluidas en tu plan este mes\. Se renuevan el \d+ de \w+/)
    expect(error?.userMessage).toContain('Mi API')
    expect(calls.length).toBe(before)
    expect(units(emp)).toBe(300)
  })

  it('avisos al 50, 75, 90 y 100 %: cada uno una sola vez en el ciclo', async () => {
    h.db.query('UPDATE stores SET ai_monthly_units_override = 20 WHERE id = ?', emp)
    const said: Array<[number, number]> = []
    for (let i = 1; i <= 20; i++) {
      await ask(emp, `aviso-${i}`)
      const notice = await takeQuotaNotice(h.db, emp, false)
      if (notice) said.push([i, notice.threshold])
    }
    expect(said).toEqual([[10, 50], [15, 75], [18, 90], [20, 100]])
    expect(await takeQuotaNotice(h.db, emp, false)).toBeNull()
    const texts = [50, 75, 90, 100].map((threshold) => noticeText(threshold as 50, { limit: 20, used: 15, remaining: 5, cycleEnd: '2026-12-01' }, false))
    expect(texts[1]).toContain('conectar tu propia API de Gemini')
    expect(texts[3]).toContain('siguen funcionando')
  })

  it('si la tarea pesa más de lo que queda (voz = 4 con 3 libres) lo dice así, no «usaste todas»', async () => {
    h.db.query('UPDATE stores SET ai_monthly_units_override = 3 WHERE id = ?', emp)
    const error = await ask(emp, 'voz-grande', 'voz').then(() => null, (e) => e as AiSpendBlockedError)
    expect(error?.reason).toBe('monthly_units')
    expect(error?.userMessage).toContain('Esta tarea necesita 4 consultas de IA y te quedan 3')
    expect(await reason(ask(emp, 'texto-cabe'))).toBeNull()
  })

  it('renovación mensual: el ciclo nuevo trae todo el cupo y los avisos vuelven a empezar', async () => {
    h.db.query('UPDATE stores SET ai_monthly_units_override = 2 WHERE id = ?', emp)
    await ask(emp, 'r-1'); await ask(emp, 'r-2')
    await takeQuotaNotice(h.db, emp, false)
    expect(await reason(ask(emp, 'r-3'))).toBe('monthly_units')
    // The previous cycle is over: its rows and notices belong to an older cycle key.
    h.db.query("UPDATE ai_spend_reservations SET cycle_key = '2000-01-01' WHERE store_id = ?", emp)
    h.db.query("UPDATE ai_quota_notices SET cycle_key = '2000-01-01' WHERE store_id = ?", emp)
    expect(await reason(ask(emp, 'r-4'))).toBeNull()
    expect((await takeQuotaNotice(h.db, emp, false))?.threshold).toBe(50)
  })

  it('pesos por complejidad: mensaje 1, pedidos 2, voz 4, organizar fotos 2 por foto; si el modelo falla se devuelven', async () => {
    await ask(emp, 'texto')
    await ask(emp, 'pedido', 'pedidos')
    await ask(emp, 'voz', 'voz')
    const photos = [1, 2, 3].map(() => ({ inlineData: png() }))
    await runWithSpend(spend(emp, 'lote', 'agrupar_fotos'), () => callGeminiJson(h.env, fetch, { system: ['x'], parts: [{ text: 'agrupa' }, ...photos], schema: { type: 'object' }, maxOutputTokens: 200 }))
    expect(units(emp)).toBe(1 + 2 + 4 + 6)
    modelReply = () => new Response('{"error":{"status":"UNAVAILABLE"}}', { status: 503 })
    await ask(emp, 'falla', 'voz').catch(() => undefined)
    expect(units(emp)).toBe(13)
  })

  it('un reintento de la misma operación no se cobra dos veces; tampoco la misma solicitud repetida en dos minutos', async () => {
    modelReply = (() => { let n = 0; return () => (++n === 1 ? new Response('{}', { status: 500 }) : ok()) })()
    await ask(emp, 'op-reintento').catch(() => undefined)
    await ask(emp, 'op-reintento')
    expect(units(emp)).toBe(1)
    modelReply = () => ok()
    await ask(emp, 'dup-1', 'interpretacion', 'el mismo mensaje')
    await ask(emp, 'dup-2', 'interpretacion', 'el mismo mensaje')
    expect(units(emp)).toBe(2)
    for (let i = 3; i <= 7; i++) await ask(emp, `dup-${i}`, 'interpretacion', 'el mismo mensaje').catch(() => undefined)
    expect(await reason(ask(emp, 'dup-8', 'interpretacion', 'el mismo mensaje'))).toBe('duplicate_request')
  })

  it('simultáneas: 50 consultas a la vez con 3 libres en el mes → exactamente 3', async () => {
    h.env.AI_STORE_CONCURRENCY = '100'
    h.db.query('UPDATE stores SET ai_monthly_units_override = 3 WHERE id = ?', neg)
    const results = await Promise.all(Array.from({ length: 50 }, (_, i) => reason(ask(neg, `c-${String(i).padStart(2, '0')}`))))
    expect(results.filter((value) => value === null)).toHaveLength(3)
    expect(results.filter((value) => value === 'monthly_units')).toHaveLength(47)
  })

  it('límites técnicos: tareas simultáneas por tienda y tamaño de archivos', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    modelReply = () => ok()
    const slow: typeof fetch = (async (...args: Parameters<typeof fetch>) => { await gate; return fetch(...args) }) as typeof fetch
    const pending = [0, 1, 2].map((i) => runWithSpend(spend(neg, `lento-${i}`), () => callGeminiJson(h.env, slow, { system: ['x'], parts: [{ text: `lento ${i}` }], schema: { type: 'object' }, maxOutputTokens: 200 })))
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(await reason(ask(neg, 'cuarta'))).toBe('concurrency')
    release()
    await Promise.all(pending)
    const big = { inlineData: { mimeType: 'image/jpeg', data: 'x'.repeat(8 * 1024 * 1024) } }
    expect(await reason(runWithSpend(spend(neg, 'grande', 'fotos_ia'), () => callGeminiJson(h.env, fetch, { system: ['x'], parts: [big], schema: { type: 'object' } })))).toBe('too_large')
  })

  it('freno anti-ráfaga (técnico, también con API propia): más de 60 tareas en un minuto se pausan un momento', async () => {
    for (let i = 0; i < 60; i++) await ask(neg, `rafaga-${i}`)
    const error = await ask(neg, 'rafaga-61').then(() => null, (e) => e as AiSpendBlockedError)
    expect(error?.reason).toBe('burst')
    expect(error?.userMessage).toContain('Espera un minuto')
  })

  it('el presupuesto interno no recorta el cupo: el dinero solo frena una anomalía (3 veces el presupuesto)', async () => {
    h.env.AI_FX_COP_PER_USD = '4000'
    // Platform ceilings out of the way: this test is about the store's own ceiling.
    h.db.query("INSERT INTO ai_spend_limits (scope, scope_ref, period, metric, limit_value) VALUES ('global', '*', 'day', 'micros', 100000000), ('global', '*', 'month', 'micros', 100000000)")
    const spent = (micros: number) => h.db.query(`INSERT INTO ai_spend_reservations (op_key, attempt, environment, scope, store_id, feature, model, kind, day_key, month_key, reserved_micros, actual_micros, status, mode, billing_source)
      VALUES (?, 1, 'test', 'store', ?, 'voz', 'gemini-3.8-flash', 'text', date('now'), strftime('%Y-%m', 'now'), ?, ?, 'settled', 'enforce', 'plan')`, `previo-${micros}`, emp, micros, micros)
    // 6.000 COP = US$ 1,50 spent: the allowance is still served.
    spent(1_500_000)
    expect(await reason(ask(emp, 'sigue-con-cupo'))).toBeNull()
    // 3 x 6.000 COP = US$ 4,50: anomaly guard.
    spent(3_000_000)
    expect(await reason(ask(emp, 'anomalia'))).toBe('store_month')
  })

  it('contratos anteriores: sin cupo de consultas; se registran para conocer su uso', async () => {
    for (let i = 0; i < 40; i++) await ask(legacy, `ant-${i}`)
    expect(units(legacy)).toBe(40)
    expect(await takeQuotaNotice(h.db, legacy, false)).toBeNull()
  })
})

describe('créditos artísticos', () => {
  it('el plan asigna sus créditos una vez por ciclo; vencen al terminar el ciclo', async () => {
    expect(await grantPlanCredits(h.db, emp)).toBe(true)
    expect(await grantPlanCredits(h.db, emp)).toBe(false)
    expect((await creditSummary(h.db, emp)).balance).toBe(30)
    expect(await grantPlanCredits(h.db, legacy)).toBe(false) // contrato anterior: sin créditos de plan
    h.db.query("UPDATE ai_credit_ledger SET lot_expires_at = datetime('now', '-1 minute') WHERE store_id = ? AND source = 'plan'", emp)
    expect(await expireCreditLots(h.db, emp)).toBe(30)
    expect(await expireCreditLots(h.db, emp)).toBe(0)
    expect((await creditSummary(h.db, emp)).balance).toBe(0)
  })

  it('imagen premium: 10 créditos en los planes nuevos, cotizados antes; los contratos anteriores conservan sus costos', async () => {
    const run = (storeId: number, key: string) => runWithCredits(h.db, h.env, { storeId, feature: 'foto_premium', key, actor: 'prueba' }, () => editPhotoWithInstruction(h.env, fetch, png(), 'Fondo blanco'))
    modelReply = () => imageOk()
    expect(await run(emp, 'premium-0001')).toMatchObject({ ok: true, charged: 10 })
    // The same request again (retry, double click, duplicate webhook): charged once.
    expect(await run(emp, 'premium-0001')).toMatchObject({ ok: false, reason: 'duplicate' })
    expect((await creditSummary(h.db, emp)).balance).toBe(20)
    // Contrato anterior: versión 1 (hoy foto_premium sin costo configurado en la base de pruebas → no cobra créditos).
    h.db.query("INSERT INTO ai_credit_costs (feature, credits, enabled, updated_by) VALUES ('foto_premium', 5, 1, 'prueba')")
    await grantCredits(h.db, legacy, { kind: 'recarga', amount: 50, reason: 'cortesía' }, 'cortesia-antigua', 'platform:prueba')
    expect(await run(legacy, 'premium-ant-01')).toMatchObject({ ok: true, charged: 5 })
  })

  it('si la imagen no se genera, los créditos vuelven', async () => {
    modelReply = () => new Response('{"error":{"status":"UNAVAILABLE"}}', { status: 503 })
    const result = await runWithCredits(h.db, h.env, { storeId: emp, feature: 'foto_premium', key: 'premium-falla1', actor: 'prueba' }, () => editPhotoWithInstruction(h.env, fetch, png(), 'Fondo blanco'))
    expect(result).toMatchObject({ ok: false, reason: 'error' })
    expect((await creditSummary(h.db, emp)).balance).toBe(30)
  })

  it('orden de consumo: plan → cortesía → compra; cada origen se ve por separado y la compra dura 12 meses', async () => {
    await grantPlanCredits(h.db, emp)
    await grantCredits(h.db, emp, { kind: 'recarga', amount: 15, reason: 'regalo' }, 'cortesia-emp-1', 'platform:prueba')
    await grantCredits(h.db, emp, { kind: 'recarga', amount: 100, reason: 'Paquete 100', source: 'compra', validDays: 365 }, 'compra-emp-01', 'platform:prueba')
    modelReply = () => imageOk()
    for (let i = 0; i < 4; i++) await runWithCredits(h.db, h.env, { storeId: emp, feature: 'foto_premium', key: `orden-${i}-xx`, actor: 'prueba' }, () => editPhotoWithInstruction(h.env, fetch, png(), `Fondo ${i}`))
    const wallet = await walletSummary(h.db, emp)
    expect(wallet.bySource).toEqual({ plan: 0, cortesia: 5, compra: 100, ajuste: 0 })
    expect(wallet.balance).toBe(105)
    const lots = await creditLots(h.db, emp)
    expect(lots.find((lot) => lot.source === 'compra')?.expiresAt).toBeTruthy()
  })
})

describe('API propia del comercio', () => {
  let ownerEmp: string
  let adminEmp: string
  let ownerNeg: string
  const api = (method: string, token: string, store = 'emp', body?: unknown) => h.request('/api/admin/ai/key', { method, token, store, ...(body ? { body } : {}) })
  const connect = (body: Record<string, unknown> = {}) => api('PUT', ownerEmp, 'emp', { apiKey: OWN_KEY, useAssistant: true, ...body })

  beforeEach(async () => {
    ownerEmp = await userToken(await createStoreUser(h.db, { email: 'duena@emp.test', storeId: emp, role: 'owner' }), 'duena@emp.test')
    adminEmp = await userToken(await createStoreUser(h.db, { email: 'admin@emp.test', storeId: emp, role: 'admin' }), 'admin@emp.test')
    ownerNeg = await userToken(await createStoreUser(h.db, { email: 'duena@neg.test', storeId: neg, role: 'owner' }), 'duena@neg.test')
  })

  it('cifra con datos asociados a la tienda: otra tienda no puede descifrar la misma fila', async () => {
    const sealed = await encryptApiKey(h.env, emp, OWN_KEY)
    expect(sealed.ciphertext).not.toContain(OWN_KEY.slice(4, 20))
    expect(await decryptApiKey(h.env, emp, { ...sealed, key_version: sealed.version })).toBe(OWN_KEY)
    await expect(decryptApiKey(h.env, neg, { ...sealed, key_version: sealed.version })).rejects.toThrow()
  })

  it('conecta solo si la clave valida; nunca la devuelve ni la registra; solo el propietario la gestiona', async () => {
    expect((await api('PUT', adminEmp, 'emp', { apiKey: OWN_KEY })).status).toBe(403)
    const invalid = await api('PUT', ownerEmp, 'emp', { apiKey: 'AIzaSyInvalidaInvalidaInvalida0000000000' })
    expect(invalid.status).toBe(409)
    expect(await invalid.json()).toMatchObject({ code: 'KEY_INVALIDA' })
    expect((await api('PUT', ownerEmp, 'emp', { apiKey: 'AIzaSySinCuotaSinCuotaSinCuota000000000' })).status).toBe(409)
    const connected = await connect()
    expect(connected.status).toBe(200)
    const body = await connected.json() as Record<string, unknown>
    expect(body).toMatchObject({ connected: true, status: 'activa', hint: 'AIza…cdEF', useAssistant: true, useStudio: false })
    const everything = JSON.stringify([body, await (await api('GET', adminEmp)).json(), h.db.query('SELECT * FROM store_ai_keys'), h.db.query('SELECT * FROM store_ai_key_events'), h.db.query('SELECT * FROM audit_log'), h.db.query('SELECT * FROM platform_events')])
    expect(everything).not.toContain(OWN_KEY)
    expect(everything).not.toContain(OWN_KEY.slice(4, -4))
    // Store isolation: the other store sees nothing and cannot remove it.
    expect(await (await api('GET', ownerNeg, 'neg')).json()).toMatchObject({ connected: false })
    expect((await api('DELETE', ownerNeg, 'neg')).status).toBe(404)
    expect(await (await api('GET', adminEmp)).json()).toMatchObject({ connected: true })
  })

  it('con API propia: usa SOLO esa clave, no descuenta consultas ni créditos de TiendIA', async () => {
    await connect({ useStudio: true })
    await ask(emp, 'propia-1')
    expect(calls.at(-1)?.key).toBe(OWN_KEY)
    expect(units(emp)).toBe(0)
    expect(h.db.query("SELECT billing_source FROM ai_spend_reservations WHERE op_key = 'propia-1'")).toEqual([{ billing_source: 'own_key' }])
    // Studio with own key: no credits.
    modelReply = () => imageOk()
    const run = await runWithCredits(h.db, h.env, { storeId: emp, feature: 'foto_premium', key: 'propia-foto1', actor: 'prueba' }, () => editPhotoWithInstruction(h.env, fetch, png(), 'Fondo blanco'))
    expect(run).toMatchObject({ ok: true, charged: 0 })
    expect(calls.at(-1)?.key).toBe(OWN_KEY)
    // Another store never uses it.
    modelReply = () => ok()
    await ask(neg, 'otra-tienda')
    expect(calls.at(-1)?.key).toBe(PLATFORM_KEY)
  })

  it('la API propia solo se usa en lo que el dueño eligió (asistente sí, Estudio no)', async () => {
    await connect({ useStudio: false })
    modelReply = () => imageOk()
    const run = await runWithCredits(h.db, h.env, { storeId: emp, feature: 'foto_premium', key: 'estudio-plat1', actor: 'prueba' }, () => editPhotoWithInstruction(h.env, fetch, png(), 'Fondo blanco'))
    expect(run).toMatchObject({ ok: true, charged: 10 })
    expect(calls.at(-1)?.key).toBe(PLATFORM_KEY)
  })

  it('si la API propia falla no se usa la clave de TiendIA (salvo permiso expreso, y nunca con créditos exonerados)', async () => {
    await connect({ useStudio: true })
    modelReply = (call) => call.key === OWN_KEY ? new Response('{"error":{"status":"RESOURCE_EXHAUSTED"}}', { status: 429 }) : ok()
    const error = await ask(emp, 'sin-cuota').then(() => null, (e) => e as AiSpendBlockedError)
    expect(error?.reason).toBe('own_key_failed')
    expect(error?.userMessage).toContain('sin cuota')
    expect(calls.filter((call) => call.key === PLATFORM_KEY)).toHaveLength(0)
    expect(await (await api('GET', adminEmp)).json()).toMatchObject({ status: 'sin_cuota', lastErrorCode: 'HTTP_429' })
    // With the owner's permission: falls back to the plan, which then counts queries.
    expect((await api('PATCH', ownerEmp, 'emp', { fallbackToPlatform: true })).status).toBe(200)
    modelReply = (call) => call.key === OWN_KEY ? new Response('{}', { status: 429 }) : ok()
    expect(await reason(ask(emp, 'con-respaldo'))).toBeNull()
    expect(calls.at(-1)?.key).toBe(PLATFORM_KEY)
    expect(units(emp)).toBe(1)
  })

  it('Estudio con API propia sin cuota para imágenes (caso de staging): falla con su propio código, sin créditos ni clave de TiendIA', async () => {
    await connect({ useStudio: true })
    modelReply = (call) => call.key === OWN_KEY ? new Response('{"error":{"status":"RESOURCE_EXHAUSTED"}}', { status: 429 }) : imageOk()
    const run = await runWithCredits(h.db, h.env, { storeId: emp, feature: 'foto_premium', key: 'estudio-sin-cuota-1', actor: 'prueba' }, () => editPhotoWithInstruction(h.env, fetch, png(), 'Fondo blanco'))
    expect(run).toMatchObject({ ok: false, reason: 'own_key_failed' })
    expect(run.ok ? '' : run.message).toContain('sin cuota')
    expect(calls.filter((call) => call.key === PLATFORM_KEY)).toHaveLength(0)
    expect((await creditSummary(h.db, emp)).balance).toBe(30)
    // A later call that works puts the key back to «activa».
    modelReply = () => ok()
    await ask(emp, 'texto-con-propia')
    expect(calls.at(-1)?.key).toBe(OWN_KEY)
    expect(await (await api('GET', adminEmp)).json()).toMatchObject({ status: 'activa', lastErrorCode: null })
  })

  it('API propia lenta (caso de staging): se corta a tiempo, avisa y no deja la tarea colgada ni bloqueando la tienda', async () => {
    await connect()
    h.env.AI_CALL_TIMEOUT_MS = '50'
    const hang: typeof fetch = ((_: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    })) as typeof fetch
    const slow = (opKey: string) => runWithSpend(spend(emp, opKey), () => callGeminiJson(h.env, hang, { system: ['x'], parts: [{ text: opKey }], schema: { type: 'object' }, maxOutputTokens: 200 }))
    for (const key of ['lenta-1', 'lenta-2', 'lenta-3', 'lenta-4']) {
      const error = await slow(key).then(() => null, (e) => e as AiSpendBlockedError)
      // Never «too many tasks»: a call that timed out is closed, so it does not occupy a slot.
      expect(error?.reason).toBe('own_key_slow')
    }
    expect(h.db.query(`SELECT COUNT(*) AS n FROM ai_spend_reservations WHERE status = 'reserved'`)).toEqual([{ n: 0 }])
    expect(units(emp)).toBe(0)
    // With the owner's permission the platform key answers instead.
    await api('PATCH', ownerEmp, 'emp', { fallbackToPlatform: true })
    const platform = (async (input: RequestInfo | URL, init?: RequestInit) => new Headers(init?.headers).get('x-goog-api-key') === OWN_KEY ? hang(input, init) : ok()) as typeof fetch
    await runWithSpend(spend(emp, 'lenta-respaldo'), () => callGeminiJson(h.env, platform, { system: ['x'], parts: [{ text: 'respaldo' }], schema: { type: 'object' }, maxOutputTokens: 200 }))
    expect(units(emp)).toBe(1)
  })

  it('API gratuita: Google la marca con free_tier; las imágenes dejan de enviarse a ella y los pedidos nunca van', async () => {
    await connect({ useStudio: true })
    const freeTier = JSON.stringify({ error: { status: 'RESOURCE_EXHAUSTED', details: [{ violations: [{ quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests', quotaValue: '0' }] }, { retryDelay: '37s' }] } })
    modelReply = (call) => call.key === OWN_KEY && /image/.test(call.url) ? new Response(freeTier, { status: 429 }) : /image/.test(call.url) ? imageOk() : ok()
    const first = await runWithCredits(h.db, h.env, { storeId: emp, feature: 'foto_premium', key: 'gratis-foto-1', actor: 'prueba' }, () => editPhotoWithInstruction(h.env, fetch, png(), 'Fondo blanco'))
    expect(first).toMatchObject({ ok: false, reason: 'own_key_failed' })
    const state = await (await api('GET', adminEmp)).json() as any
    expect(state).toMatchObject({ tier: 'gratuito', capabilities: { text: true, images: 'no_disponible', buyerData: false } })
    expect(state.lastErrorText).toContain('nivel gratuito')
    // Next image: not compatible with the key → it is not tried there; it is paid with the store's credits.
    const before = calls.filter((call) => call.key === OWN_KEY).length
    const second = await runWithCredits(h.db, h.env, { storeId: emp, feature: 'foto_premium', key: 'gratis-foto-2', actor: 'prueba' }, () => editPhotoWithInstruction(h.env, fetch, png(), 'Fondo blanco'))
    expect(second).toMatchObject({ ok: true, charged: 10 })
    expect(calls.filter((call) => call.key === OWN_KEY).length).toBe(before)
    // Text still goes to the free key (no queries); orders with buyers' data never do.
    await ask(emp, 'texto-gratis')
    expect(calls.at(-1)?.key).toBe(OWN_KEY)
    await ask(emp, 'pedido-privado', 'pedidos')
    expect(calls.at(-1)?.key).toBe(PLATFORM_KEY)
    expect(units(emp)).toBe(2)
  })

  it('API con facturación: una imagen generada confirma imágenes y facturación; entonces también procesa pedidos', async () => {
    await connect({ useStudio: true })
    modelReply = (call) => /image/.test(call.url) ? imageOk() : ok()
    const run = await runWithCredits(h.db, h.env, { storeId: emp, feature: 'foto_premium', key: 'pago-foto-1', actor: 'prueba' }, () => editPhotoWithInstruction(h.env, fetch, png(), 'Fondo blanco'))
    expect(run).toMatchObject({ ok: true, charged: 0 })
    expect(await (await api('GET', adminEmp)).json()).toMatchObject({ tier: 'facturacion', capabilities: { images: 'disponible', buyerData: true } })
    await ask(emp, 'pedido-con-pago', 'pedidos')
    expect(calls.at(-1)?.key).toBe(OWN_KEY)
    expect(units(emp)).toBe(0)
  })

  it('reemplazar y desconectar quedan en el historial; después vuelve el cupo del plan', async () => {
    await connect()
    expect((await api('PUT', ownerEmp, 'emp', { apiKey: 'AIzaSyOtraClaveOtraClaveOtraClave99999' })).status).toBe(200)
    expect(await (await api('GET', adminEmp)).json()).toMatchObject({ hint: 'AIza…9999' })
    expect((await api('DELETE', ownerEmp)).status).toBe(200)
    expect(h.db.query('SELECT action FROM store_ai_key_events WHERE store_id = ? ORDER BY id', emp).map((row: any) => row.action)).toEqual(['conectar', 'reemplazar', 'desconectar'])
    await ask(emp, 'despues')
    expect(calls.at(-1)?.key).toBe(PLATFORM_KEY)
    expect(units(emp)).toBe(1)
  })

  it('una clave sin acceso al modelo de imagen no se acepta para el Estudio', async () => {
    const response = await api('PUT', ownerEmp, 'emp', { apiKey: 'AIzaSySoloTextoSoloTextoSoloTexto0000000', useStudio: true })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'KEY_SIN_PERMISO' })
  })

  it('presupuesto global agotado: la tienda con API propia sigue; las de cupo se detienen', async () => {
    await connect()
    h.db.query("INSERT INTO ai_spend_limits (scope, scope_ref, period, metric, limit_value) VALUES ('global', '*', 'day', 'micros', 0)")
    expect(await reason(ask(emp, 'propia-sin-global'))).toBeNull()
    expect(await reason(ask(neg, 'plan-sin-global'))).toBe('global_day')
  })
})

describe('panel: Configuración → Inteligencia artificial', () => {
  it('resume el consumo mensual, créditos, API propia, historial y política sin datos sensibles', async () => {
    const admin = await userToken(await createStoreUser(h.db, { email: 'panel@emp.test', storeId: emp, role: 'admin' }), 'panel@emp.test')
    await ask(emp, 'panel-1')
    await ask(emp, 'panel-2', 'voz')
    const response = await h.request('/api/admin/ai/overview', { token: admin, store: 'emp' })
    expect(response.status).toBe(200)
    const body = await response.json() as Awaited<ReturnType<typeof aiOverview>>
    expect(body.plan).toMatchObject({ code: 'emprendedor', name: 'Emprendedor', metered: true })
    expect(body).not.toHaveProperty('session')
    expect(body.month).toMatchObject({ limit: 300, used: 5, available: 295, percent: 1, level: null, notice: null })
    expect(body.credits).toMatchObject({ balance: 30, monthlyFromPlan: 30, priceVersion: 2 })
    expect(body.credits.packs.map((pack: any) => [pack.credits, pack.priceCop])).toEqual([[100, 12000], [300, 30000], [700, 63000]])
    expect(body.history[0]).toMatchObject({ task: 'Nota de voz (hasta 2 minutos)', paidWith: 'Plan', units: 4 })
    expect(body.weights.find((weight: any) => weight.feature === 'voz')).toMatchObject({ units: 4 })
    expect(JSON.stringify(body)).not.toMatch(/panel-1|op_key|test-key|sesi[oó]n/)
  })
})
