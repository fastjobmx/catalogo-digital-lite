/** Ejecuta el banco multimodal contra el flujo anterior y contra la capa nueva, por la ruta real del webhook.
 *
 *   npx vitest run src/services/assistant/agent/bank/media.bank.test.ts            → capa nueva, modelo simulado
 *   MEDIA_BANK_REPORT=1 MEDIA_BANK_OUT=<carpeta> npx vitest run …/media.bank.test.ts → los dos flujos + informe
 *   …con BANK_REAL=1 GEMINI_API_KEY=…                                               → visión y planificador reales
 *                                                                                     sobre una foto real de producto
 * La transcripción de las notas de voz siempre se simula (no hay audios grabados). La clave nunca se imprime. */
import { budgetedRealFetch, realTestKey, realTestKeyAvailable } from '../../../../testing/realAiBudget'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { createHarness, createStoreUser, seedCatalog, seedStore, type Harness } from '../../../../testing/harness'
import { MEDIA_CONVERSATIONS, type MediaCase } from './media.conversations'

const OWNER = 9931
const OPERATOR = 9932
const OTHER = 9933
const SECRET = 'webhook-secret'
// Modelo real solo con la clave de pruebas (o la compartida con permiso expreso) y bajo el presupuesto de pruebas.
const REAL = process.env.BANK_REAL === '1' && realTestKeyAvailable()
const REPORT = process.env.MEDIA_BANK_REPORT === '1' || REAL
const realFetch = REAL ? budgetedRealFetch(globalThis.fetch, 'banco-multimodal') : globalThis.fetch
const here = dirname(fileURLToPath(import.meta.url))
const SEED_PHOTO = join(here, '..', '..', '..', '..', '..', '..', 'frontend', 'public', 'seed-images', 'sneakerhub', 'KINETIK-05.jpg')

type Flow = 'anterior' | 'nueva'
type Button = { text: string; callback_data?: string }
type TurnLog = { input: string; replies: string[]; ms: number; failures: string[]; uxFailures: string[] }
type CaseResult = { id: string; title: string; critical: boolean; engine: Flow; pass: boolean; ux: boolean; turns: TurnLog[]; modelCalls: number; costMicros: number; firstAckMs: number | null }

const results: CaseResult[] = []
const strip = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
let counter = 880_000

async function runCase(bank: MediaCase, flow: Flow): Promise<CaseResult> {
  const on = flow === 'nueva' ? '*' : ''
  const h: Harness = createHarness({
    TELEGRAM_BOT_TOKEN: 'bot-token', TELEGRAM_WEBHOOK_SECRET: SECRET, GEMINI_API_KEY: REAL ? realTestKey() : 'test-key',
    ...(process.env.GEMINI_MODEL ? { GEMINI_MODEL: process.env.GEMINI_MODEL } : {}),
    ASSISTANT_AGENT_STORE_IDS: on, ASSISTANT_MEDIA_STORE_IDS: on, ASSISTANT_AGENT_TIMEOUT_MS: REAL ? '9000' : '2000', ...(REAL ? {} : { ASSISTANT_MEDIA_PROGRESS_MS: '150' }),
  })
  const tienda = await seedStore(h.db, { slug: 'calzado-demo', name: 'Calzado Demo', status: 'active' })
  const otra = await seedStore(h.db, { slug: 'otra-demo', name: 'Otra Demo', status: 'active' })
  h.db.query('INSERT INTO store_onboarding_legacy_stores (store_id) VALUES (?), (?)', tienda, otra)
  h.db.query('UPDATE stores SET ai_monthly_budget_micros = 50000000 WHERE id IN (?, ?)', tienda, otra)
  await createStoreUser(h.db, { email: 'ana@demo.test', storeId: tienda, role: 'owner', telegramUserId: String(OWNER) })
  await createStoreUser(h.db, { email: 'oscar@demo.test', storeId: tienda, role: 'operator', telegramUserId: String(OPERATOR) })
  await createStoreUser(h.db, { email: 'berta@otra.test', storeId: otra, role: 'owner', telegramUserId: String(OTHER) })
  await seedCatalog(h.db, tienda, { categories: [{ name: 'Calzado', slug: 'calzado' }, { name: 'Accesorios', slug: 'accesorios' }], products: [
    { sku: 'TBA-01', name: 'Tenis Blancos Air', price: 180000, category: 'calzado', variants: [{ size: '38', color: 'Blanco', stock: 8 }, { size: '39', color: 'Blanco', stock: 2 }, { size: '40', color: 'Blanco', stock: 0 }] },
    { sku: 'TBC-02', name: 'Tenis Blancos Clásicos', price: 150000, category: 'calzado', variants: [{ size: '38', color: 'Blanco', stock: 4 }, { size: '39', color: 'Blanco', stock: 4 }] },
    { sku: 'SAN-1', name: 'Sandalias Guess', price: 80000, category: 'calzado', variants: [{ size: '38', color: 'Negro', stock: 1 }, { size: '39', color: 'Negro', stock: 2 }] },
    { sku: 'BOT-9', name: 'Botas Montaña', price: 220000, category: 'calzado', variants: [{ size: '40', color: 'Café', stock: 0 }, { size: '41', color: 'Café', stock: 0 }] },
    { sku: 'GOR-3', name: 'Gorra Negra', price: 35000, category: 'accesorios', variants: [{ size: 'Única', color: 'Negro', stock: 3 }] },
  ] })
  await seedCatalog(h.db, otra, { products: [{ sku: 'AD223', name: 'Tenis de otra tienda', price: 1000, variants: [{ size: '38', color: 'Blanco', stock: 99 }] }] })

  const photoBytes = REAL && existsSync(SEED_PHOTO) ? new Uint8Array(readFileSync(SEED_PHOTO)) : await makePng(640, 480)
  const photoPath = REAL && existsSync(SEED_PHOTO) ? 'jpg' : 'png'
  const files = new Map<string, { path: string; bytes: Uint8Array }>()
  const sent: Array<{ text: string; markup?: { inline_keyboard?: Button[][] } }> = []
  let transcript = ''
  let modelDown = false
  let channelDown = false
  let vision: { name: string; description: string } | null = null
  let slowVisionMs = 0
  let modelCalls = 0
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    let body: Record<string, any> = {}
    try { body = init?.body ? JSON.parse(String(init.body)) : {} } catch { body = {} }
    const answer = (payload: unknown) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }], usageMetadata: { promptTokenCount: 700, candidatesTokenCount: 60 } }))
    if (url.includes('generativelanguage.googleapis.com')) {
      modelCalls += 1
      const parts = (body.contents?.[0]?.parts || []) as Array<{ inlineData?: { mimeType: string } }>
      // Voice: the transcription is the scripted text (what a correct transcription would return).
      if (parts.some((part) => part.inlineData?.mimeType?.startsWith('audio/'))) return answer({ action: 'ask', params: {}, missing: [], summary: 'ok', needsConfirmation: false, transcript })
      if (modelDown) return new Response('{"error":{"status":"UNAVAILABLE"}}', { status: 503 })
      if (REAL) return realFetch(input, init)
      if (slowVisionMs && parts.some((part) => part.inlineData?.mimeType?.startsWith('image/'))) await new Promise((resolve) => setTimeout(resolve, slowVisionMs))
      if (parts.some((part) => part.inlineData?.mimeType?.startsWith('image/'))) return answer({ name: vision?.name || 'Tenis deportivos', description: vision?.description || 'Tenis deportivos cómodos para uso diario, con suela de goma.', category: 'Calzado', colors: ['Rojo'], features: [], visibleBrand: '', confidence: 'media', isProductPhoto: true })
      if (parts.some((part) => part.inlineData?.mimeType === 'application/pdf')) return answer({ answer: 'Documento de un proveedor.' })
      if (JSON.stringify(body.systemInstruction || '').includes('intérprete del Asistente TiendIA')) return new Response('{"error":{"status":"INTERNAL"}}', { status: 500 })
      return answer({ action: 'unknown', params: {}, missing: [], summary: '', needsConfirmation: false })
    }
    if (url.includes('/getFile')) {
      const id = String(body.file_id || new URL(url).searchParams.get('file_id') || '')
      const file = files.get(id) || { path: `photos/${id}.${photoPath}`, bytes: photoBytes }
      files.set(id, file)
      return new Response(JSON.stringify({ ok: true, result: { file_path: file.path, file_size: file.bytes.byteLength } }))
    }
    if (url.includes('/file/bot')) {
      const file = [...files.values()].find((item) => url.endsWith(item.path))
      return file ? new Response(file.bytes, { headers: { 'content-length': String(file.bytes.byteLength) } }) : new Response('', { status: 404 })
    }
    if (/sendMessage|sendPhoto/.test(url) && channelDown) return new Response(JSON.stringify({ ok: false, error_code: 502, description: 'Bad Gateway' }), { status: 502 })
    if (/sendMessage|sendPhoto/.test(url)) sent.push({ text: String(body.text ?? body.caption ?? ''), markup: body.reply_markup })
    return new Response(JSON.stringify({ ok: true, result: { message_id: sent.length + 1 } }))
  }))

  const deliver = (update: unknown) => h.request('/api/telegram/webhook', { method: 'POST', body: update, headers: { 'X-Telegram-Bot-Api-Secret-Token': SECRET } })
  const base = (user: number) => { counter += 1; return { update_id: counter, message: { message_id: counter, from: { id: user, first_name: 'Ana' }, chat: { id: user, type: 'private' as const }, date: 0 } } }
  const fingerprint = () => JSON.stringify(h.db.query('SELECT p.store_id, p.sku, p.price, p.is_active, p.is_archived, (SELECT group_concat(v.size || \':\' || v.stock) FROM product_variants v WHERE v.product_id = p.id) AS variants FROM products p ORDER BY p.store_id, p.sku'))
  const pendingRow = () => h.db.query<{ action: string; params_json: string }>("SELECT action, params_json FROM telegram_operations WHERE status = 'pending' AND expires_at > unixepoch() ORDER BY created_at DESC LIMIT 1")[0]
  const waiting = () => h.db.query<{ n: number }>("SELECT COUNT(*) AS n FROM assistant_media_items WHERE status = 'open' AND user_key = ?", String(OWNER))[0]!.n

  const turns: TurnLog[] = []
  let firstAckMs: number | null = null
  for (const turn of bank.turns) {
    const user = turn.as === 'operator' ? OPERATOR : turn.as === 'other' ? OTHER : OWNER
    const before = fingerprint()
    const from = sent.length
    modelDown = Boolean(turn.modelDown)
    channelDown = Boolean(turn.channelDown)
    vision = turn.vision || null
    slowVisionMs = turn.slowVisionMs || 0
    const started = Date.now()
    let input = ''
    if (turn.photos) {
      input = `[${turn.photos} foto${turn.photos === 1 ? '' : 's'}${turn.caption ? ` · pie: ${turn.caption}` : ''}]`
      for (let index = 0; index < turn.photos; index += 1) {
        const update = base(user)
        const id = turn.ids?.[index] || `foto-${update.update_id}`
        await deliver({ ...update, message: { ...update.message, photo: [{ file_id: id }], ...(turn.caption && index === 0 ? { caption: turn.caption } : {}) } })
        if (index === 0 && firstAckMs === null) firstAckMs = Date.now() - started
      }
    } else if (turn.voice) {
      input = `[nota de voz] ${turn.voice}`
      transcript = turn.voice
      const update = base(user)
      files.set(`voz-${update.update_id}`, { path: `voice/voz-${update.update_id}.oga`, bytes: oggPage(48_000 * 6) })
      await deliver({ ...update, message: { ...update.message, voice: { file_id: `voz-${update.update_id}`, duration: 6, mime_type: 'audio/ogg' } } })
    } else if (turn.doc) {
      input = `[archivo ${turn.doc.name}]`
      const update = base(user)
      const bytes = new TextEncoder().encode(turn.doc.content)
      files.set(`doc-${update.update_id}`, { path: `documents/${turn.doc.name}`, bytes })
      await deliver({ ...update, message: { ...update.message, document: { file_id: `doc-${update.update_id}`, file_name: turn.doc.name, mime_type: turn.doc.mime, file_size: bytes.byteLength } } })
    } else if (turn.tap) {
      input = `[botón ${turn.tap}]`
      const buttons = (([...sent].reverse().find((message) => message.markup?.inline_keyboard)?.markup?.inline_keyboard || []) as Button[][]).flat()
      const data = buttons.find((button) => new RegExp(turn.tap!).test(button.text))?.callback_data
      counter += 1
      if (data) await deliver({ update_id: counter, callback_query: { id: `cb-${counter}`, from: { id: user, first_name: 'Ana' }, data, message: { message_id: counter, chat: { id: user, type: 'private' }, date: 0 } } })
    } else {
      input = turn.say || ''
      const update = { ...base(user), }
      const message = { ...update, message: { ...update.message, text: turn.say } }
      await deliver(message)
      if (turn.resend) { await deliver(message); await deliver(message) }
    }
    const ms = Date.now() - started
    const replies = sent.slice(from).map((message) => strip(message.text)).filter((message) => message !== 'Dame un momento…')
    const joined = replies.join('\n')
    const check = turn.expect
    const failures: string[] = []
    const uxFailures: string[] = []
    const row = pendingRow()
    if (!replies.length && !(turn.photos && flow === 'nueva') && !turn.channelDown) failures.push('sin respuesta')
    if (check.unchanged && fingerprint() !== before) failures.push('modificó el catálogo sin confirmación')
    if (check.pending !== undefined && (row?.action ?? null) !== check.pending) failures.push(`pendiente: esperaba ${check.pending}, hay ${row?.action ?? null}`)
    if (check.draft) {
      const draft = row?.action === 'create_product' ? JSON.parse(row.params_json) as { fields: { name?: string; price?: number }; variants: Array<{ size?: string; stock?: number }>; images: unknown[] } : null
      if (!draft) failures.push('no hay borrador')
      else {
        if (check.draft.images !== undefined && draft.images.length !== check.draft.images) failures.push(`fotos del borrador: esperaba ${check.draft.images}, hay ${draft.images.length}`)
        if (check.draft.price !== undefined && (draft.fields.price ?? null) !== check.draft.price) failures.push(`precio del borrador: esperaba ${check.draft.price}, hay ${draft.fields.price ?? null}`)
        const variants = draft.variants.map((variant) => `${variant.size}:${variant.stock}`).join(',')
        if (check.draft.variants !== undefined && variants !== check.draft.variants) failures.push(`tallas del borrador: esperaba ${check.draft.variants}, hay ${variants}`)
        if (check.draft.name && !new RegExp(check.draft.name, 'i').test(draft.fields.name || '')) failures.push(`nombre del borrador: esperaba /${check.draft.name}/, hay «${draft.fields.name || ''}»`)
      }
    }
    if (check.waiting !== undefined && waiting() !== check.waiting && flow === 'nueva') failures.push(`fotos en espera: esperaba ${check.waiting}, hay ${waiting()}`)
    for (const pattern of check.never || []) if (new RegExp(pattern, 'i').test(joined)) failures.push(`no debía decir /${pattern}/`)
    for (const pattern of check.replies || []) if (!new RegExp(pattern, 'i').test(joined)) failures.push(`debía decir /${pattern}/`)
    for (const pattern of check.ux || []) if (!new RegExp(pattern, 'im').test(joined)) uxFailures.push(`forma: /${pattern}/`)
    if (check.maxMessages && replies.length > check.maxMessages) uxFailures.push(`mensajes: ${replies.length} (máximo ${check.maxMessages})`)
    // Isolation and safety, whatever was asked: the other store never changes and nothing is published by itself.
    if (h.db.query<{ n: number }>('SELECT COUNT(*) AS n FROM products p JOIN product_variants v ON v.product_id = p.id WHERE p.store_id = ? AND (p.price <> 1000 OR v.stock <> 99)', otra)[0]!.n) failures.push('cambió datos de otra tienda')
    if (h.db.query<{ n: number }>('SELECT COUNT(*) AS n FROM products WHERE store_id = ?', tienda)[0]!.n !== 5) failures.push('publicó un producto sin confirmación')
    turns.push({ input, replies, ms, failures, uxFailures })
  }
  const costMicros = Number(h.db.query<{ cost: number }>('SELECT COALESCE(SUM(estimated_cost_micros), 0) AS cost FROM ai_usage_events')[0]!.cost)
  vi.unstubAllGlobals()
  return { id: bank.id, title: bank.title, critical: bank.critical, engine: flow, modelCalls, costMicros, turns, firstAckMs, pass: turns.every((turn) => !turn.failures.length), ux: turns.every((turn) => !turn.uxFailures.length) }
}

afterEach(() => vi.unstubAllGlobals())

describe.skipIf(REPORT)('banco multimodal · capa nueva (modelo simulado)', () => {
  it.each(MEDIA_CONVERSATIONS.map((bank) => [bank.id, bank] as const))('%s', async (_id, bank) => {
    const result = await runCase(bank, 'nueva')
    expect(result.turns.flatMap((turn) => [...turn.failures, ...turn.uxFailures].map((failure) => `«${turn.input}» → ${failure}\n   ${turn.replies.join(' ⏎ ').slice(0, 400)}`))).toEqual([])
  })

  it('con los interruptores apagados, una foto recibe la pregunta de siempre y no se guarda nada en espera', async () => {
    const result = await runCase({ id: 'apagado', title: 'apagado', critical: true, turns: [{ photos: 1, expect: { unchanged: true, pending: null, replies: ['¿Qué hago con ella\\?'] } }] }, 'anterior')
    expect(result.turns[0]!.failures).toEqual([])
  })
})

describe.skipIf(!REPORT)('banco multimodal · flujo anterior y capa nueva (informe)', () => {
  for (const flow of ['anterior', 'nueva'] as const) {
    it.each(MEDIA_CONVERSATIONS.map((bank) => [bank.id, bank] as const))(`${flow} · %s`, async (_id, bank) => {
      results.push(await runCase(bank, flow))
    }, 180_000)
  }
})

afterAll(() => {
  const out = process.env.MEDIA_BANK_OUT
  if (!out || !results.length) return
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, `multimodal-${REAL ? 'real' : 'simulado'}${process.env.BANK_RUN ? `-${process.env.BANK_RUN}` : ''}.json`), JSON.stringify(results, null, 1))
})

function oggPage(granule: number): Uint8Array {
  const page = new Uint8Array(64)
  page.set([0x4f, 0x67, 0x67, 0x53])
  let rest = granule
  for (let i = 0; i < 8; i++) { page[6 + i] = rest % 256; rest = Math.floor(rest / 256) }
  return page
}
async function makePng(width: number, height: number): Promise<Uint8Array> {
  const raw = new Uint8Array(height * (width * 4 + 1))
  const compressed = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer())
  const chunk = (name: string, body: Uint8Array) => { const type = new TextEncoder().encode(name); return concat(u32(body.length), type, body, u32(crc32(concat(type, body)))) }
  return concat(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', concat(u32(width), u32(height), new Uint8Array([8, 6, 0, 0, 0]))), chunk('IDAT', compressed), chunk('IEND', new Uint8Array()))
}
function u32(value: number): Uint8Array { return new Uint8Array([value >>> 24, value >>> 16, value >>> 8, value]) }
function concat(...items: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(items.reduce((total, item) => total + item.length, 0))
  let offset = 0
  for (const item of items) { result.set(item, offset); offset += item.length }
  return result
}
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0) }
  return (crc ^ 0xffffffff) >>> 0
}
