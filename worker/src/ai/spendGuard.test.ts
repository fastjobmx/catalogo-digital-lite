/** Blindaje económico de la IA: tarifas oficiales, reservas de presupuesto y continuidad operativa.
 * Todo con el modelo SIMULADO: ninguna prueba de este archivo llama a Gemini ni gasta créditos. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPng } from '../../test/sqliteD1'
import { createHarness, createStoreUser, seedCatalog, seedStore, stubTelegram, superadminToken, textUpdate, userToken, type Harness } from '../testing/harness'
import { processTelegramUpdate } from '../services/telegram'
import { callGeminiJson } from './geminiClient'
import { editPhotoWithInstruction } from './imageStudio'
import { costOf, estimateRequestMicros, rateFor } from './pricing'
import { creditSummary, runWithCredits } from './credits'
import { AiSpendBlockedError, environmentOf, expireStaleReservations, guardMode, reserveSpend, runWithSpend, spendSummary, type SpendContext } from './spendGuard'
import { budgetedRealFetch, realTestKey } from '../testing/realAiBudget'

let h: Harness
let a: number
let b: number
let calls = 0

type Row = { id: number; op_key: string; attempt: number; status: string; reserved_micros: number; actual_micros: number | null; outcome: string | null; kind: string; store_id: number | null; mode: string; image_tokens: number }
const rows = (where = '1 = 1', ...binds: unknown[]) => h.db.query<Row>(`SELECT * FROM ai_spend_reservations WHERE ${where} ORDER BY id`, ...binds)
const events = (code: string) => h.db.query<{ detail: string; store_id: number | null }>('SELECT detail, store_id FROM platform_events WHERE code = ? ORDER BY id', code)
const setLimit = (scope: string, ref: string | number, period: 'day' | 'month', metric: 'micros' | 'images', value: number) =>
  h.db.query('INSERT OR REPLACE INTO ai_spend_limits (scope, scope_ref, period, metric, limit_value) VALUES (?, ?, ?, ?, ?)', scope, String(ref), period, metric, value)
const committed = () => h.db.query<{ v: number }>(`SELECT COALESCE(SUM(CASE WHEN status = 'reserved' THEN reserved_micros ELSE COALESCE(actual_micros, 0) END), 0) AS v FROM ai_spend_reservations`)[0]!.v

/** Text model stub: 10 input + 100 output tokens per call (US$ 0,0003825 at the 2026 price). */
function textModel(outcome: (call: number) => 'ok' | 'error' | 'network' | 'truncated' = () => 'ok', delayMs = 0): typeof fetch {
  return (async () => {
    const call = ++calls
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs))
    const result = outcome(call)
    if (result === 'network') throw new TypeError('fetch failed')
    if (result === 'error') return new Response(JSON.stringify({ error: { status: 'UNAVAILABLE' } }), { status: 503 })
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: result === 'truncated' ? '{"ok":' : '{"ok":true}' }] }, finishReason: result === 'truncated' ? 'MAX_TOKENS' : 'STOP' }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 100 },
    }))
  }) as typeof fetch
}

const ctx = (opKey: string, storeId: number | null = a, scope: SpendContext['scope'] = 'store'): SpendContext => ({ db: h.db, env: h.env, scope, storeId, feature: 'prueba', opKey })
const ask = (fetcher: typeof fetch, opKey: string, storeId: number | null = a, scope: SpendContext['scope'] = 'store') =>
  runWithSpend(ctx(opKey, storeId, scope), () => callGeminiJson(h.env, fetcher, { system: ['Responde JSON.'], parts: [{ text: `hola ${opKey}` }], schema: { type: 'object' }, maxOutputTokens: 200 }))
const blockedReason = async (promise: Promise<unknown>) => {
  try { await promise; return null } catch (error) { return error instanceof AiSpendBlockedError ? error.reason : `otro: ${(error as Error).message}` }
}

beforeEach(async () => {
  h = createHarness({ GEMINI_API_KEY: 'test-key', GEMINI_MODEL: 'gemini-3.8-flash', GEMINI_IMAGE_MODEL: 'gemini-3.1-flash-image' })
  // Planes anteriores (sin cupo de consultas): estas pruebas miden el gasto en dinero. Las consultas tienen las suyas.
  a = await seedStore(h.db, { slug: 'gasto-a', name: 'Gasto A', plan: 'profesional' })
  b = await seedStore(h.db, { slug: 'gasto-b', name: 'Gasto B', plan: 'premium' })
  // Límites técnicos holgados: aquí se prueban los de dinero (los técnicos tienen sus propias pruebas).
  h.env.AI_STORE_CONCURRENCY = '100'
  h.env.AI_STORE_BURST_PER_MINUTE = '1000'
  calls = 0
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('tarifas oficiales centralizadas', () => {
  it('gemini-3.8-flash: precio introductorio en 2026 y precio estándar desde el 1 de enero de 2027', () => {
    const usage = { promptTokens: 1_000_000, outputTokens: 1_000_000 }
    expect(costOf({}, 'gemini-3.8-flash', usage, new Date('2026-12-31T23:59:00Z')).totalMicros).toBe(750_000 + 3_750_000)
    expect(costOf({}, 'gemini-3.8-flash', usage, new Date('2027-01-01T00:00:00Z')).totalMicros).toBe(1_500_000 + 7_500_000)
  })

  it('separa entrada, salida, razonamiento, caché, audio, imagen y modalidad de procesamiento', () => {
    const at = new Date('2026-11-13T12:00:00Z')
    // Razonamiento = salida.
    expect(costOf({}, 'gemini-3.8-flash', { promptTokens: 0, outputTokens: 100, thoughtsTokens: 900 }, at).outputMicros).toBe(3_750)
    // Caché al 10 %.
    const cached = costOf({}, 'gemini-3.8-flash', { promptTokens: 10_000, cachedTokens: 8_000, outputTokens: 0 }, at)
    expect([cached.inputMicros, cached.cachedMicros]).toEqual([1_500, 600])
    // Audio con precio propio en Flash-Lite.
    expect(costOf({}, 'gemini-3.1-flash-lite', { promptTokens: 1_000_000, audioInputTokens: 1_000_000, outputTokens: 0 }, at).inputMicros).toBe(500_000)
    // Imágenes generadas a US$ 60 por millón de tokens de imagen (1.290 tokens ≈ US$ 0,077).
    const image = costOf({}, 'gemini-3.1-flash-image', { promptTokens: 300, outputTokens: 1_290 }, at)
    expect([image.inputMicros, image.imageMicros, image.totalMicros]).toEqual([150, 77_400, 77_550])
    // Batch a mitad de precio.
    expect(costOf({}, 'gemini-3.8-flash', { promptTokens: 1_000_000, outputTokens: 0 }, at, 'batch').totalMicros).toBe(375_000)
    expect(rateFor({}, 'gemini-3.8-flash', at, 'priority').rate.input).toBe(1_350_000)
  })

  it('un modelo fuera de la tabla se cobra con la tarifa más cara conocida; las correcciones son explícitas y auditables', () => {
    expect(costOf({}, 'modelo-nuevo', { promptTokens: 100_000, outputTokens: 0 })).toMatchObject({ totalMicros: 200_000, rateSource: 'unknown_model' })
    // Above 200k prompt tokens the long-context rate applies (US$ 4 / M).
    expect(costOf({}, 'modelo-nuevo', { promptTokens: 1_000_000, outputTokens: 0 }).totalMicros).toBe(4_000_000)
    const env = { AI_PRICING_OVERRIDES: '{"modelo-nuevo":{"input":100000,"output":400000}}' } as never
    expect(costOf(env, 'modelo-nuevo', { promptTokens: 1_000_000, outputTokens: 0 })).toMatchObject({ totalMicros: 100_000, rateSource: 'override', pricingVersion: '2026-11-13' })
  })

  it('la reserva previa nunca es menor que el costo real de una imagen ni de una respuesta típica', () => {
    const photo = { contents: [{ parts: [{ text: 'Fondo blanco' }, { inlineData: { mimeType: 'image/jpeg', data: 'x'.repeat(400_000) } }] }] }
    expect(estimateRequestMicros({}, 'gemini-3.1-flash-image', photo, 'image')).toBeGreaterThanOrEqual(costOf({}, 'gemini-3.1-flash-image', { promptTokens: 1_300, outputTokens: 2_520 }).totalMicros)
    const text = { systemInstruction: { parts: [{ text: 'x'.repeat(3_500) }] }, contents: [{ parts: [{ text: 'súbele 5 mil a la gorra' }] }], generationConfig: { maxOutputTokens: 1024 } }
    expect(estimateRequestMicros({}, 'gemini-3.8-flash', text, 'text')).toBeGreaterThan(costOf({}, 'gemini-3.8-flash', { promptTokens: 1_172, outputTokens: 63 }).totalMicros)
  })
})

describe('control centralizado antes de cada llamada pagada', () => {
  it('modo por entorno: producción observa hasta autorizar; staging y pruebas bloquean; staging puede declarar su entorno de presupuesto', () => {
    expect(guardMode({ ENVIRONMENT: 'production' })).toBe('shadow')
    expect(guardMode({ ENVIRONMENT: 'production', AI_SPEND_GUARD_MODE: 'enforce' } as never)).toBe('enforce')
    expect(guardMode({ ENVIRONMENT: 'staging' })).toBe('enforce')
    expect(guardMode({ ENVIRONMENT: 'test' })).toBe('enforce')
    expect(environmentOf({ ENVIRONMENT: 'production', AI_BUDGET_ENVIRONMENT: 'staging' } as never)).toBe('staging')
  })

  it('reserva el máximo antes de llamar y concilia con el costo real después', async () => {
    const result = await ask(textModel(), 'op-1')
    expect(result.data).toEqual({ ok: true })
    const [row] = rows()
    expect(row).toMatchObject({ status: 'settled', outcome: 'ok', actual_micros: Math.ceil(10 * 0.75 + 100 * 3.75), store_id: a, mode: 'enforce' })
    expect(row!.reserved_micros).toBeGreaterThan(row!.actual_micros!)
  })

  it('1 · límite alcanzado: bloquea la llamada SIN enviarla y nunca supera el límite de la tienda', async () => {
    setLimit('store', a, 'month', 'micros', 2_000)
    let reason: string | null = null
    let sent = 0
    for (let i = 0; i < 10 && !reason; i++) {
      const before = calls
      reason = await blockedReason(ask(textModel(), `op-${i}`))
      if (reason) expect(calls).toBe(before) // blocked before reaching the model
      else sent++
    }
    expect(reason).toBe('store_month')
    expect(sent).toBeGreaterThan(0)
    expect(committed()).toBeLessThanOrEqual(2_000)
    expect(events('AI_SPEND_100').some((event) => event.detail.includes('store_month'))).toBe(true)
  })

  it('2 · reintentos y entregas duplicadas: como máximo 3 intentos pagados por operación', async () => {
    const model = textModel((call) => (call < 3 ? 'error' : 'ok'))
    for (let i = 0; i < 3; i++) await ask(model, 'tg:42:interpretacion').catch(() => undefined)
    expect(await blockedReason(ask(model, 'tg:42:interpretacion'))).toBe('attempts')
    expect(calls).toBe(3)
    expect(rows().map((row) => [row.attempt, row.status])).toEqual([[1, 'released'], [2, 'released'], [3, 'settled']])
  })

  it('3 · solicitudes simultáneas: ninguna combinación evade el límite global', async () => {
    await ask(textModel(), 'simultanea-xx')
    const reserved = rows()[0]!.reserved_micros
    setLimit('global', '*', 'day', 'micros', committed() + 5 * reserved)
    const model = textModel(() => 'ok', 20) // slow model: every reservation is still open when the others arrive
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => blockedReason(ask(model, `simultanea-${String(i).padStart(2, '0')}`))))
    expect(results.filter((reason) => reason === null)).toHaveLength(5)
    expect(results.filter((reason) => reason === 'global_day')).toHaveLength(15)
    expect(calls).toBe(1 + 5)
  })

  it('3b · reservas simultáneas directas: exactamente las que caben', async () => {
    setLimit('global', '*', 'day', 'micros', 5_000)
    const outcomes = await Promise.all(Array.from({ length: 30 }, (_, i) => reserveSpend(ctx(`directa-${i}`), { model: 'gemini-3.8-flash', kind: 'text', amountMicros: 1_000 }).then(() => 'ok', (error) => (error as AiSpendBlockedError).reason)))
    expect(outcomes.filter((outcome) => outcome === 'ok')).toHaveLength(5)
    expect(committed()).toBe(5_000)
  })

  it('5 · fallo del modelo: un error HTTP libera la reserva; un corte de red la conserva; una respuesta cortada se cobra', async () => {
    await ask(textModel(() => 'error'), 'falla-http').catch(() => undefined)
    await ask(textModel(() => 'network'), 'falla-red').catch(() => undefined)
    await ask(textModel(() => 'truncated'), 'cortada').catch(() => undefined)
    const [http, network, truncated] = rows()
    expect(http).toMatchObject({ status: 'released', actual_micros: 0, outcome: 'http_error' })
    expect(network).toMatchObject({ status: 'settled', outcome: 'network_error' })
    expect(network!.actual_micros).toBe(network!.reserved_micros)
    expect(truncated).toMatchObject({ status: 'settled', outcome: 'truncated', actual_micros: 383 })
  })

  it('6 · consumo entre tiendas: una tienda agotada no frena a las demás; el límite global sí cuenta a todas', async () => {
    setLimit('store', a, 'day', 'micros', 0)
    expect(await blockedReason(ask(textModel(), 'a-1', a))).toBe('store_day')
    expect(await blockedReason(ask(textModel(), 'b-1', b))).toBeNull()
    setLimit('global', '*', 'month', 'micros', committed())
    expect(await blockedReason(ask(textModel(), 'b-2', b))).toBe('global_month')
    expect(await blockedReason(ask(textModel(), 'plataforma', null, 'platform'))).toBe('global_month')
  })

  it('8 · presupuesto global agotado: se detienen tiendas, bot maestro y pruebas gratuitas', async () => {
    setLimit('global', '*', 'day', 'micros', 0)
    expect(await blockedReason(ask(textModel(), 'tienda', a))).toBe('global_day')
    expect(await blockedReason(ask(textModel(), 'maestro', null, 'platform'))).toBe('global_day')
    expect(await blockedReason(ask(textModel(), 'prueba', null, 'trial'))).toBe('global_day')
    expect(calls).toBe(0)
    const error = await ask(textModel(), 'mensaje').then(() => null, (e) => e as AiSpendBlockedError)
    expect(error?.userMessage).toContain('El catálogo, los pedidos, los botones y los comandos siguen funcionando')
  })

  it('alertas al 50, 80 y 100 %: una sola vez por alcance y periodo', async () => {
    await ask(textModel(), 'base')
    const cost = rows()[0]!.actual_micros!
    setLimit('global', '*', 'day', 'micros', cost * 10)
    for (let i = 0; i < 12; i++) await ask(textModel(), `alerta-${i}`).catch(() => undefined)
    const global = (code: string) => events(code).filter((event) => event.detail.includes('plataforma hoy')).length
    expect([global('AI_SPEND_50'), global('AI_SPEND_80'), global('AI_SPEND_100')]).toEqual([1, 1, 1])
  })

  it('modo observación: registra, concilia y alerta, pero nunca bloquea', async () => {
    h.env.AI_SPEND_GUARD_MODE = 'shadow'
    setLimit('store', a, 'month', 'micros', 0)
    expect(await blockedReason(ask(textModel(), 'sombra'))).toBeNull()
    expect(rows()[0]).toMatchObject({ mode: 'shadow', status: 'settled' })
    expect(events('AI_SPEND_100').some((event) => event.detail.includes('se habría bloqueado por store_month'))).toBe(true)
  })

  it('una llamada pagada sin contexto de gasto se niega en staging y producción con el control activo', async () => {
    const staging = { ...h.env, ENVIRONMENT: 'staging' }
    await expect(callGeminiJson(staging, textModel(), { system: ['x'], parts: [{ text: 'x' }], schema: { type: 'object' } })).rejects.toMatchObject({ reason: 'unguarded' })
    expect(calls).toBe(0)
  })

  it('reservas abandonadas (Worker caído) se cierran por lo reservado', async () => {
    await reserveSpend(ctx('caido'), { model: 'gemini-3.8-flash', kind: 'text', amountMicros: 4_000 })
    h.db.query("UPDATE ai_spend_reservations SET created_at = datetime('now', '-30 minutes')")
    expect(await expireStaleReservations(h.db)).toBe(1)
    expect(rows()[0]).toMatchObject({ status: 'expired', actual_micros: 4_000 })
    expect((await spendSummary(h.db, h.env)).month.spent).toBe(4_000)
  })
})

describe('7 · imágenes premium', () => {
  const png = () => ({ mimeType: 'image/png', data: btoa(String.fromCharCode(...createPng(20, 20))) })
  const imageModel: typeof fetch = (async () => {
    calls++
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: btoa(String.fromCharCode(...createPng(8, 8))) } }] } }],
      usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 1290, candidatesTokensDetails: [{ modality: 'IMAGE', tokenCount: 1290 }] },
    }))
  }) as typeof fetch

  it('se cobran a la tarifa de imagen y tienen su propio cupo mensual por tienda', async () => {
    setLimit('store', a, 'month', 'images', 2)
    const edit = (key: string) => runWithSpend(ctx(key), () => editPhotoWithInstruction(h.env, imageModel, png(), 'Fondo blanco'))
    await edit('foto-1')
    await edit('foto-2')
    expect(await blockedReason(edit('foto-3'))).toBe('images_month')
    expect(calls).toBe(2)
    expect(rows().map((row) => [row.kind, row.actual_micros, row.image_tokens])).toEqual([['image', 77_550, 1290], ['image', 77_550, 1290]])
  })
})

describe('4 · trabajos en cola y continuidad operativa', () => {
  let admin: string
  let owner: string
  let ids: Record<string, number>
  const json = async (response: Response) => response.json() as Promise<any>
  const A = (path: string, init: Parameters<Harness['request']>[1] = {}) => h.request(`/api/creative${path}`, { store: 'gasto-a', token: owner, ...init })

  beforeEach(async () => {
    h.env.GEMINI_IMAGE_MODEL = 'gemini-3.1-flash-image'
    admin = await superadminToken()
    owner = await userToken(await createStoreUser(h.db, { email: 'gasto@tiendas.test', storeId: a, role: 'owner' }), 'gasto@tiendas.test')
    ids = await seedCatalog(h.db, a, { products: [{ sku: 'F1', name: 'Uno', price: 1000 }, { sku: 'F2', name: 'Dos', price: 1000 }, { sku: 'F3', name: 'Tres', price: 1000 }] })
    for (const [index, sku] of ['F1', 'F2', 'F3'].entries()) await h.assets.put(`stores/${a}/products/${sku}.jpg`, createPng(30 + index, 30), { httpMetadata: { contentType: 'image/png' } })
    await h.request('/api/platform/credits/costs/foto_packshot', { method: 'PUT', token: admin, body: { credits: 2, enabled: true } })
    await h.request('/api/platform/stores/gasto-a/credits', { method: 'POST', token: admin, headers: { 'Idempotency-Key': 'recarga-gasto-a' }, body: { kind: 'recarga', amount: 20, reason: 'Prueba' } })
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls++
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: btoa(String.fromCharCode(...createPng(64, 64))) } }] } }], usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 1290 } }))
    }))
  })

  it('al agotarse el cupo, el trabajo no se cobra, el original se conserva y se puede retomar al ampliar el límite', async () => {
    setLimit('store', a, 'month', 'images', 2)
    const created = await json(await A('/photo/batches', { method: 'POST', headers: { 'Idempotency-Key': 'lote-gasto-0001' }, body: { operation: 'fondo_blanco', items: [{ productId: ids.F1 }, { productId: ids.F2 }, { productId: ids.F3 }], confirmCredits: 6 } }))
    const results = []
    for (const job of created.jobs) results.push(await json(await A(`/jobs/${job.id}/run`, { method: 'POST' })))
    expect(results.map((job) => job.status)).toEqual(['completado', 'completado', 'fallido'])
    expect(results[2].errorCode).toBe('BUDGET_EXHAUSTED')
    expect(calls).toBe(2)
    expect(await creditSummary(h.db, a)).toMatchObject({ consumed: 4, reserved: 0, balance: 16 }) // the third photo cost nothing
    const originals = h.db.query<{ n: number }>("SELECT COUNT(*) AS n FROM creative_assets WHERE store_id = ? AND role = 'original'", a)[0]!.n
    expect(originals).toBe(3)

    setLimit('store', a, 'month', 'images', 3)
    expect((await json(await A(`/jobs/${results[2].id}/retry`, { method: 'POST' }))).status).toBe('pendiente')
    expect((await json(await A(`/jobs/${results[2].id}/run`, { method: 'POST' }))).status).toBe('completado')
    expect(await creditSummary(h.db, a)).toMatchObject({ consumed: 6, balance: 14 })
  })

  it('créditos: si el límite de gasto bloquea, la reserva de créditos se libera y no se cobra nada', async () => {
    setLimit('global', '*', 'day', 'micros', 0)
    const run = await runWithCredits(h.db, h.env, { storeId: a, feature: 'foto_packshot', key: 'creditos-bloqueados', actor: 'prueba' }, () => editPhotoWithInstruction(h.env, fetch, png(), 'Fondo blanco'))
    expect(run).toMatchObject({ ok: false, reason: 'platform_cap' })
    expect(await creditSummary(h.db, a)).toMatchObject({ balance: 20, reserved: 0, consumed: 0 })
    expect(calls).toBe(0)
  })
  const png = () => ({ mimeType: 'image/png', data: btoa(String.fromCharCode(...createPng(20, 20))) })
})

describe('asistente de Telegram sin presupuesto de IA', () => {
  const OWNER = 9301
  let telegram: ReturnType<typeof stubTelegram>
  beforeEach(async () => {
    h.env.TELEGRAM_BOT_TOKEN = 'bot-token'
    h.env.PUBLIC_STORE_BASE_URL = 'https://tiendas.test'
    h.db.query('INSERT INTO store_onboarding_legacy_stores (store_id) VALUES (?)', a)
    await createStoreUser(h.db, { email: 'tg@gasto.test', storeId: a, role: 'owner', telegramUserId: String(OWNER) })
    await seedCatalog(h.db, a, { products: [{ sku: 'SAN-1', name: 'Sandalias Guess', price: 80000, variants: [{ size: '38', color: 'Negro', stock: 3 }] }] })
    telegram = stubTelegram((url) => {
      if (!url.includes('generativelanguage.googleapis.com')) return undefined
      calls++
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ action: 'ask', params: {}, missing: [], summary: 'Claro.', needsConfirmation: false }) }] } }], usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 60 } }))
    })
  })

  it('la IA informa el límite; el catálogo y los comandos deterministas siguen respondiendo', async () => {
    setLimit('store', a, 'month', 'micros', 0)
    await processTelegramUpdate(textUpdate(OWNER, 'organiza mi bodega con ideas distintas por favor') as never, h.env, h.db)
    expect(calls).toBe(0)
    expect(telegram.messages().at(-1)).toContain('alcanzó el límite de IA de este mes')
    await processTelegramUpdate(textUpdate(OWNER, 'cuántos quedan de las sandalias') as never, h.env, h.db)
    expect(telegram.messages().at(-1)).toContain('Sandalias Guess')
    expect(calls).toBe(0)
    expect(h.db.query('SELECT blocked_requests FROM ai_usage_monthly WHERE store_id = ?', a)).toEqual([{ blocked_requests: 1 }])
  })
})

describe('presupuesto independiente para pruebas con IA real (sin gastar: modelo simulado)', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ai-ledger-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); delete process.env.AI_TEST_DAILY_MICROS })

  it('registra cada llamada en un libro persistente y no envía la que superaría el tope diario', async () => {
    process.env.AI_TEST_DAILY_MICROS = '1000'
    const ledger = join(dir, 'ledger.jsonl')
    const model = textModel()
    const first = budgetedRealFetch(model, 'banco-1', { ledger })
    const body = JSON.stringify({ contents: [{ parts: [{ text: 'hola' }] }], generationConfig: { maxOutputTokens: 100 } })
    expect((await first('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent', { method: 'POST', body })).status).toBe(200)
    // A second run (another process) shares the same ledger and the same daily limit.
    const second = budgetedRealFetch(model, 'banco-2', { ledger })
    expect((await second('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent', { method: 'POST', body })).status).toBe(200)
    expect((await second('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent', { method: 'POST', body })).status).toBe(429)
    expect(calls).toBe(2)
    const lines = readFileSync(ledger, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
    expect(lines.map((line) => [line.label, line.micros])).toEqual([['banco-1', 383], ['banco-2', 383]])
    expect(JSON.stringify(lines)).not.toContain('key')
  })

  it('no usa la clave compartida de producción salvo autorización expresa', () => {
    const saved = { ...process.env }
    try {
      delete process.env.GEMINI_TEST_API_KEY
      process.env.GEMINI_API_KEY = 'compartida'
      expect(() => realTestKey()).toThrow(/GEMINI_TEST_API_KEY/)
      process.env.AI_TEST_ALLOW_SHARED_KEY = '1'
      expect(realTestKey()).toBe('compartida')
      process.env.GEMINI_TEST_API_KEY = 'propia'
      expect(realTestKey()).toBe('propia')
    } finally {
      process.env = saved
    }
  })
})
