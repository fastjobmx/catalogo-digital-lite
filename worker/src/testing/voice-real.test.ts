/** MANUAL test of voice notes against the REAL Gemini model, through the real Telegram handler.
 * Does not run in the normal suite: only with RUN_REAL_AI=1 (spends a few thousand tokens of the local key; never printed).
 *
 *   cd worker && RUN_REAL_AI=1 VOICE_DIR=<folder with nota1.ogg and nota2.ogg> DEV_VARS=<path to .dev.vars> npx vitest run src/testing/voice-real.test.ts
 *
 * Telegram is simulated and the database is an in-memory SQLite with a synthetic store: no real store, bot or inventory is touched.
 * Writes a summary (synthetic content only) to VOICE_DIR/resultado.json. */
import { describe, expect, it, vi } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { callbackUpdate, createHarness, createStoreUser, seedCatalog, seedStore } from './harness'
import { processTelegramUpdate } from '../services/telegram'

const enabled = process.env.RUN_REAL_AI === '1' && Boolean(process.env.VOICE_DIR) && Boolean(process.env.DEV_VARS)
const run = enabled ? describe : describe.skip

function devVar(name: string): string {
  const line = readFileSync(process.env.DEV_VARS!, 'utf8').split(/\r?\n/).find((row) => row.startsWith(`${name}=`))
  return (line || '').slice(name.length + 1).trim().replace(/^["']|["']$/g, '')
}

run('real voice notes (synthetic Spanish speech) through the Telegram handler', () => {
  it('interprets reference, sizes, quantities and a price in words, then a spoken correction', async () => {
    const dir = process.env.VOICE_DIR!
    const audio = [readFileSync(join(dir, 'nota1.ogg')), readFileSync(join(dir, 'nota2.ogg'))]
    const h = createHarness({ TELEGRAM_BOT_TOKEN: 'bot-token', PUBLIC_STORE_BASE_URL: 'https://tiendas.test', GEMINI_API_KEY: devVar('GEMINI_API_KEY'), AI_MESSAGE_QUOTA_MODE: 'shadow' })
    const store = await seedStore(h.db, { slug: 'voz-ficticia', name: 'Tienda Ficticia de Voz', status: 'active' })
    h.db.query('INSERT INTO store_onboarding_legacy_stores (store_id) VALUES (?)', store)
    await createStoreUser(h.db, { email: 'voz@ficticia.test', storeId: store, role: 'owner', telegramUserId: '9901' })
    await seedCatalog(h.db, store, { products: [{ sku: 'SAN-1', name: 'Sandalias Guess', price: 80000, variants: [{ size: '38', color: 'Negro', stock: 1 }] }] })

    const realFetch = globalThis.fetch
    const sent: string[] = []
    let downloads = 0
    const gemini: Array<{ status: number }> = []
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('generativelanguage.googleapis.com')) {
        const response = await realFetch(input, init)
        gemini.push({ status: response.status })
        return response
      }
      if (url.includes('/getFile')) return new Response(JSON.stringify({ ok: true, result: { file_path: 'voice/nota.oga', file_size: 4 } }))
      if (url.includes('/file/bot')) return new Response(new Uint8Array(audio[Math.min(downloads++, audio.length - 1)]!))
      let body: Record<string, unknown> = {}
      try { body = init?.body ? JSON.parse(String(init.body)) : {} } catch { body = {} }
      if (url.endsWith('/sendMessage')) sent.push(String(body.text ?? ''))
      return new Response(JSON.stringify({ ok: true, result: { message_id: sent.length } }))
    })

    let counter = 9_000_000
    const voice = (seconds: number) => ({ update_id: ++counter, message: { message_id: counter, from: { id: 9901, first_name: 'Ana' }, chat: { id: 9901, type: 'private' as const }, date: 0, voice: { file_id: `voz-${counter}`, duration: seconds, mime_type: 'audio/ogg' } } })
    const pending = () => h.db.query<{ action: string; params_json: string }>("SELECT action, params_json FROM telegram_operations WHERE status = 'pending'")
    const summary: Record<string, unknown> = {}

    try {
      await processTelegramUpdate(voice(12) as never, h.env, h.db)
      summary.firstNote = { heard: sent.find((text) => text.includes('Entendí')) || null, replies: sent.slice(), pending: pending().map((row) => ({ action: row.action, params: JSON.parse(row.params_json) })) }
      const before = sent.length
      await processTelegramUpdate(voice(4) as never, h.env, h.db)
      summary.correction = { replies: sent.slice(before), pending: pending().map((row) => ({ action: row.action, params: JSON.parse(row.params_json) })) }
      summary.counter = h.db.query('SELECT channel, feature, status, audio_seconds, calls, ai_cost_micros, transcription_cost_micros FROM ai_message_ledger')
      summary.geminiCalls = gemini
      summary.inventoryUntouched = h.db.query('SELECT v.stock FROM product_variants v JOIN products p ON p.id = v.product_id WHERE p.store_id = ?', store)
      summary.audioRetained = h.db.query("SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE '%audio%' OR name LIKE '%voice%'")
    } finally {
      vi.unstubAllGlobals()
      writeFileSync(join(dir, 'resultado.json'), JSON.stringify(summary, null, 2), 'utf8')
    }
    expect(gemini.length).toBeGreaterThan(0)
    expect(gemini.every((call) => call.status === 200)).toBe(true)
    void callbackUpdate
  }, 180_000)
})
