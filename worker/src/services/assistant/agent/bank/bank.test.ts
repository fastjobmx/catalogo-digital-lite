/** Ejecuta el banco de conversaciones contra el motor anterior y contra la capa conversacional.
 *
 *   npx vitest run src/services/assistant/agent/bank            → capa nueva con el modelo simulado (regresión)
 *   BANK_REAL=1 GEMINI_API_KEY=… npx vitest run …/agent/bank     → los dos motores con el modelo real; escribe
 *                                                                  el informe (resultados, costo y latencia) en BANK_OUT
 * Solo tiendas ficticias en una base en memoria. La clave nunca se imprime. */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { callbackUpdate, createHarness, createStoreUser, seedCatalog, seedStore, textUpdate, type Harness } from '../../../../testing/harness'
import { processTelegramUpdate } from '../../../telegram'
import { CONVERSATIONS, HOLDOUT, type BankCase, type Check } from './conversations'

const OWNER = 9901
const OPERATOR = 9902
const REAL = process.env.BANK_REAL === '1' && Boolean(process.env.GEMINI_API_KEY)
const realFetch = globalThis.fetch
type Engine = 'anterior' | 'nueva'
type Button = { text: string; callback_data?: string }
type TurnLog = { input: string; replies: string[]; ms: number; failures: string[]; uxFailures: string[]; plans: string[] }
type CaseResult = { set: 'banco' | 'reserva'; id: string; title: string; critical: boolean; engine: Engine; pass: boolean; ux: boolean; turns: TurnLog[]; modelCalls: number; costMicros: number }

const results: CaseResult[] = []
const strip = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

async function runCase(bank: BankCase, engine: Engine): Promise<CaseResult> {
  const h: Harness = createHarness({
    TELEGRAM_BOT_TOKEN: 'bot-token', GEMINI_API_KEY: REAL ? process.env.GEMINI_API_KEY! : 'test-key',
    ...(process.env.GEMINI_MODEL ? { GEMINI_MODEL: process.env.GEMINI_MODEL } : {}),
    ASSISTANT_AGENT_STORE_IDS: engine === 'nueva' ? '*' : '', ASSISTANT_AGENT_TIMEOUT_MS: REAL ? '9000' : '2000',
  })
  const tienda = await seedStore(h.db, { slug: 'calzado-demo', name: 'Calzado Demo', status: 'active' })
  const otra = await seedStore(h.db, { slug: 'otra-demo', name: 'Otra Demo', status: 'active' })
  h.db.query('INSERT INTO store_onboarding_legacy_stores (store_id) VALUES (?), (?)', tienda, otra)
  await createStoreUser(h.db, { email: 'ana@demo.test', storeId: tienda, role: 'owner', telegramUserId: String(OWNER) })
  await createStoreUser(h.db, { email: 'oscar@demo.test', storeId: tienda, role: 'operator', telegramUserId: String(OPERATOR) })
  await seedCatalog(h.db, tienda, { products: [
    { sku: 'TBA-01', name: 'Tenis Blancos Air', price: 180000, variants: [{ size: '38', color: 'Blanco', stock: 8 }, { size: '39', color: 'Blanco', stock: 2 }, { size: '40', color: 'Blanco', stock: 0 }] },
    { sku: 'TBC-02', name: 'Tenis Blancos Clásicos', price: 150000, variants: [{ size: '38', color: 'Blanco', stock: 4 }, { size: '39', color: 'Blanco', stock: 4 }] },
    { sku: 'SAN-1', name: 'Sandalias Guess', price: 80000, variants: [{ size: '38', color: 'Negro', stock: 1 }, { size: '39', color: 'Negro', stock: 2 }] },
    { sku: 'BOT-9', name: 'Botas Montaña', price: 220000, variants: [{ size: '40', color: 'Café', stock: 0 }, { size: '41', color: 'Café', stock: 0 }] },
    { sku: 'GOR-3', name: 'Gorra Negra', price: 35000, variants: [{ size: 'Única', color: 'Negro', stock: 3 }] },
  ] })
  await seedCatalog(h.db, otra, { products: [
    { sku: 'AD223', name: 'Tenis de otra tienda', price: 1000, variants: [{ size: '38', color: 'Blanco', stock: 99 }] },
    { sku: 'TBA-01', name: 'Tenis Blancos Air', price: 1000, variants: [{ size: '38', color: 'Blanco', stock: 99 }] },
  ] })
  h.db.query(`INSERT INTO orders (store_id, display_id, items_json, subtotal, total, status, created_at) VALUES
    (?, 'PED-AYER-1', '[]', 80000, 80000, 'pendiente', datetime('now', '-5 hours', 'start of day', '-1 day', '+17 hours')),
    (?, 'PED-AYER-2', '[]', 35000, 35000, 'entregado', datetime('now', '-5 hours', 'start of day', '-1 day', '+19 hours'))`, tienda, tienda)

  const sent: Array<{ text: string; markup?: { inline_keyboard?: Button[][] } }> = []
  let script: BankCase['turns'][number] | null = null
  let modelCalls = 0
  let plans: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    let body: Record<string, any> = {}
    try { body = init?.body ? JSON.parse(String(init.body)) : {} } catch { body = {} }
    if (url.includes('generativelanguage.googleapis.com')) {
      modelCalls += 1
      if (script?.modelDown === 'error') return new Response('{"error":{"status":"UNAVAILABLE"}}', { status: 503 })
      if (script?.modelDown === 'timeout') return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
      if (REAL) {
        const started = Date.now()
        const response = await realFetch(input, init)
        if (JSON.stringify(body.systemInstruction || '').includes('intérprete del Asistente TiendIA')) {
          const copy = await response.clone().json().catch(() => null) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; usageMetadata?: Record<string, number> } | null
          plans.push(`${Date.now() - started} ms · ${JSON.stringify(copy?.usageMetadata || {})} · ${copy?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || `HTTP ${response.status}`}`)
        }
        return response
      }
      const planner = JSON.stringify(body.systemInstruction || '').includes('intérprete del Asistente TiendIA')
      if (planner && script?.model) return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ pasos: script.model }) }] } }], usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 60 } }))
      if (planner) return new Response('{"error":{"status":"INTERNAL"}}', { status: 500 })
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ action: 'unknown', params: {}, missing: [], summary: '', needsConfirmation: false }) }] } }], usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 20 } }))
    }
    if (/sendMessage|sendPhoto/.test(url)) sent.push({ text: String(body.text ?? body.caption ?? ''), markup: body.reply_markup })
    return new Response(JSON.stringify({ ok: true, result: { message_id: sent.length + 1 } }))
  }))

  const fingerprint = () => JSON.stringify(h.db.query('SELECT p.store_id, p.sku, p.price, p.is_active, p.is_archived, (SELECT group_concat(v.size || \':\' || v.stock) FROM product_variants v WHERE v.product_id = p.id) AS variants FROM products p ORDER BY p.store_id, p.sku'))
  const pendingAction = () => {
    const row = h.db.query<{ action: string }>("SELECT action FROM telegram_operations WHERE status = 'pending' AND expires_at > unixepoch() ORDER BY created_at DESC LIMIT 1")[0]
    if (row) return row.action
    const session = h.db.query<{ context_json: string }>('SELECT context_json FROM telegram_sessions WHERE telegram_user_id = ?', String(OWNER))[0]
    try { return JSON.parse(session?.context_json || '{}').agent?.batch ? 'batch' : null } catch { return null }
  }
  const stockOf = (key: string) => {
    const [sku, size] = key.split('#')
    return h.db.query<{ stock: number }>('SELECT v.stock FROM product_variants v JOIN products p ON p.id = v.product_id WHERE p.store_id = ? AND p.sku = ? AND v.size = ?', tienda, sku, size)[0]?.stock
  }
  const priceOf = (sku: string) => h.db.query<{ price: number }>('SELECT price FROM products WHERE store_id = ? AND sku = ?', tienda, sku)[0]?.price

  const turns: TurnLog[] = []
  let lastTap: string | null = null
  for (const turn of bank.turns) {
    script = turn
    plans = []
    const before = fingerprint()
    const from = sent.length
    const user = turn.as === 'operator' ? OPERATOR : OWNER
    const started = Date.now()
    let input = turn.say || ''
    if (turn.say) await processTelegramUpdate(textUpdate(user, turn.say) as never, h.env, h.db)
    else {
      if (turn.tap) {
        const buttons = (([...sent].reverse().find((message) => message.markup?.inline_keyboard)?.markup?.inline_keyboard || []) as Button[][]).flat()
        lastTap = buttons.find((button) => new RegExp(turn.tap!).test(button.text))?.callback_data || null
      }
      input = `[botón ${turn.tap || 'repetido'}]`
      if (lastTap) await processTelegramUpdate(callbackUpdate(user, lastTap) as never, h.env, h.db)
    }
    const ms = Date.now() - started
    // The «one moment» acknowledgement of a slow model is not an answer.
    const replies = sent.slice(from).map((message) => strip(message.text)).filter((message) => message !== 'Dame un momento…')
    const joined = replies.join('\n')
    const check: Check = turn.expect
    const failures: string[] = []
    const uxFailures: string[] = []
    if (!turn.say && !lastTap) failures.push(`no hay botón «${turn.tap}»`)
    if (!replies.length) failures.push('sin respuesta')
    if (check.unchanged && fingerprint() !== before) failures.push('modificó datos sin confirmación')
    if (check.pending !== undefined && pendingAction() !== check.pending) failures.push(`pendiente: esperaba ${check.pending}, hay ${pendingAction()}`)
    for (const [key, value] of Object.entries(check.stock || {})) if (stockOf(key) !== value) failures.push(`existencias ${key}: esperaba ${value}, hay ${stockOf(key)}`)
    for (const [sku, value] of Object.entries(check.price || {})) if (priceOf(sku) !== value) failures.push(`precio ${sku}: esperaba ${value}, hay ${priceOf(sku)}`)
    for (const pattern of check.never || []) if (new RegExp(pattern, 'i').test(joined)) failures.push(`no debía decir /${pattern}/`)
    for (const pattern of check.replies || []) if (!new RegExp(pattern, 'i').test(joined)) failures.push(`debía decir /${pattern}/`)
    for (const pattern of check.ux || []) if (!new RegExp(pattern, 'im').test(joined)) uxFailures.push(`forma: /${pattern}/`)
    if (check.maxMessages && replies.length > check.maxMessages) uxFailures.push(`mensajes: ${replies.length} (máximo ${check.maxMessages})`)
    if (engine === 'nueva' && !REAL && check.tools) {
      const used = h.db.query<{ tools: string }>('SELECT tools FROM assistant_agent_turns ORDER BY id DESC LIMIT 1')[0]?.tools || ''
      for (const tool of check.tools) if (!used.split(',').includes(tool)) failures.push(`herramienta: esperaba ${tool}, usó ${used || 'ninguna'}`)
    }
    // Isolation: the other store never changes, whatever was asked.
    const foreign = h.db.query<{ n: number }>('SELECT COUNT(*) AS n FROM products p JOIN product_variants v ON v.product_id = p.id WHERE p.store_id = ? AND (p.price <> 1000 OR v.stock <> 99)', otra)[0]!.n
    if (foreign) failures.push('cambió datos de otra tienda')
    turns.push({ input, replies, ms, failures, uxFailures, plans })
  }
  const costMicros = Number(h.db.query<{ cost: number }>('SELECT COALESCE(SUM(estimated_cost_micros), 0) AS cost FROM ai_usage_events')[0]!.cost)
  vi.unstubAllGlobals()
  return {
    set: HOLDOUT.includes(bank) ? 'reserva' : 'banco', id: bank.id, title: bank.title, critical: bank.critical, engine, modelCalls, costMicros, turns,
    pass: turns.every((turn) => !turn.failures.length), ux: turns.every((turn) => !turn.uxFailures.length),
  }
}

afterEach(() => vi.unstubAllGlobals())

describe.skipIf(REAL)('banco de conversaciones · capa conversacional (modelo simulado)', () => {
  it.each(CONVERSATIONS.map((bank) => [bank.id, bank] as const))('%s', async (_id, bank) => {
    const result = await runCase(bank, 'nueva')
    results.push(result)
    expect(result.turns.flatMap((turn) => [...turn.failures, ...turn.uxFailures].map((failure) => `«${turn.input}» → ${failure}\n   ${turn.replies.join(' ⏎ ').slice(0, 300)}`))).toEqual([])
  })

  it('con el interruptor apagado la tienda conversa con el motor anterior, sin tocar la capa', async () => {
    const result = await runCase(CONVERSATIONS.find((bank) => bank.id === 'reposicion-natural')!, 'anterior')
    expect(result.turns[0]!.failures).toEqual([])
    expect(result.turns[0]!.replies.join(' ')).toContain('Revisa este cambio')
  })
})

describe.skipIf(!REAL)('banco de conversaciones · modelo real, motor anterior y capa nueva', () => {
  for (const engine of ['anterior', 'nueva'] as const) {
    it.each([...CONVERSATIONS, ...HOLDOUT].map((bank) => [bank.id, bank] as const))(`${engine} · %s`, async (_id, bank) => {
      results.push(await runCase(bank, engine))
    }, 120_000)
  }
})

afterAll(() => {
  const out = process.env.BANK_OUT
  if (!out || !results.length) return
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, `banco-${REAL ? 'real' : 'simulado'}${process.env.BANK_RUN ? `-${process.env.BANK_RUN}` : ''}.json`), JSON.stringify(results, null, 1))
})
