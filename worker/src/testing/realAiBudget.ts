/** Budget for tests that call the REAL Gemini API from this computer (manual tests and banks).
 *
 * Those runs use an in-memory database, so the platform spend guard cannot see them: on 2026-11-13 they were the
 * main source of spend. This module is their guard:
 *  - Key isolation: uses GEMINI_TEST_API_KEY (a separate Google project with its own small balance). The shared
 *    GEMINI_API_KEY is refused unless AI_TEST_ALLOW_SHARED_KEY=1 is set on purpose.
 *  - Persistent ledger: one JSON line per paid call in AI_TEST_LEDGER (default <repo>/.tmp/ai-test-ledger.jsonl),
 *    shared by every run and every vitest worker, so limits hold across runs. No keys or contents are written.
 *  - Limits (USD micros): AI_TEST_DAILY_MICROS (default 1.000.000 = US$1), AI_TEST_MONTHLY_MICROS (default 10.000.000)
 *    and AI_TEST_RUN_MICROS per process (default 500.000). A call that would cross one is NOT sent: it answers 429.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { costOf, estimateRequestMicros, usageFromMetadata } from '../ai/pricing'

const here = dirname(fileURLToPath(import.meta.url))
export const DEFAULT_TEST_LEDGER = join(here, '..', '..', '..', '.tmp', 'ai-test-ledger.jsonl')

type Entry = { at: string; label: string; model: string; micros: number; prompt: number; output: number; status: number }

const limit = (name: string, fallback: number) => {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value >= 0 && process.env[name] !== '' && process.env[name] !== undefined ? value : fallback
}

function readDevVar(path: string | undefined, name: string): string {
  if (!path || !existsSync(path)) return ''
  const line = readFileSync(path, 'utf8').split(/\r?\n/).find((row) => row.startsWith(`${name}=`))
  return line ? line.slice(name.length + 1).trim().replace(/^"|"$/g, '') : ''
}

/** The key for real tests. Never printed. Throws when only the shared key exists and sharing was not allowed. */
export function realTestKey(devVarsPath?: string): string {
  const own = process.env.GEMINI_TEST_API_KEY || readDevVar(devVarsPath, 'GEMINI_TEST_API_KEY')
  if (own) return own
  const shared = process.env.GEMINI_API_KEY || readDevVar(devVarsPath, 'GEMINI_API_KEY')
  if (shared && process.env.AI_TEST_ALLOW_SHARED_KEY === '1') return shared
  throw new Error('Pruebas con IA real: falta GEMINI_TEST_API_KEY (clave de un proyecto de pruebas con saldo propio). Usar la clave compartida exige AI_TEST_ALLOW_SHARED_KEY=1.')
}

export function readTestLedger(path = process.env.AI_TEST_LEDGER || DEFAULT_TEST_LEDGER): Entry[] {
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => { try { return JSON.parse(line) as Entry } catch { return null } }).filter((entry): entry is Entry => Boolean(entry))
}

export type TestSpend = { today: number; month: number; run: number; calls: number; refused: number }

/** Wraps the real fetch: Gemini calls are checked against the test budget before being sent and logged after. */
export function budgetedRealFetch(realFetch: typeof fetch, label: string, options: { ledger?: string; now?: () => Date } = {}): typeof fetch & { spend: () => TestSpend } {
  const ledger = options.ledger || process.env.AI_TEST_LEDGER || DEFAULT_TEST_LEDGER
  const now = options.now || (() => new Date())
  const daily = limit('AI_TEST_DAILY_MICROS', 1_000_000)
  const monthly = limit('AI_TEST_MONTHLY_MICROS', 10_000_000)
  const perRun = limit('AI_TEST_RUN_MICROS', 500_000)
  let run = 0
  let calls = 0
  let refused = 0
  const totals = () => {
    const day = now().toISOString().slice(0, 10)
    const month = day.slice(0, 7)
    let today = 0
    let thisMonth = 0
    for (const entry of readTestLedger(ledger)) {
      if (entry.at.startsWith(month)) thisMonth += entry.micros
      if (entry.at.startsWith(day)) today += entry.micros
    }
    return { today, month: thisMonth }
  }
  const wrapped = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (!url.includes('generativelanguage.googleapis.com')) return realFetch(input, init)
    const model = url.match(/models\/([^:/?]+)/)?.[1] || 'desconocido'
    let body: unknown = null
    try { body = typeof init?.body === 'string' ? JSON.parse(init.body) : null } catch { body = null }
    const estimate = estimateRequestMicros({}, model, body, /image/.test(model) ? 'image' : 'text', now())
    const spent = totals()
    if (spent.today + estimate > daily || spent.month + estimate > monthly || run + estimate > perRun) {
      refused++
      console.warn(`[presupuesto de pruebas] llamada NO enviada (${label}): hoy US$ ${(spent.today / 1e6).toFixed(4)} / ${(daily / 1e6).toFixed(2)}, corrida US$ ${(run / 1e6).toFixed(4)} / ${(perRun / 1e6).toFixed(2)}`)
      return new Response(JSON.stringify({ error: { status: 'RESOURCE_EXHAUSTED', message: 'Presupuesto de pruebas agotado' } }), { status: 429 })
    }
    const response = await realFetch(input, init)
    const json = response.ok ? await response.clone().json().catch(() => null) as { usageMetadata?: unknown } | null : null
    const usage = usageFromMetadata(json?.usageMetadata)
    // Billed calls are logged at their real cost; failed ones (HTTP error, not billed) at zero. Unreadable usage → estimate.
    const micros = !response.ok ? 0 : usage.promptTokens || usage.outputTokens ? costOf({}, model, usage, now()).totalMicros : estimate
    run += micros
    calls++
    const entry: Entry = { at: now().toISOString(), label: label.slice(0, 60), model, micros, prompt: usage.promptTokens, output: usage.outputTokens + (usage.thoughtsTokens || 0), status: response.status }
    mkdirSync(dirname(ledger), { recursive: true })
    appendFileSync(ledger, `${JSON.stringify(entry)}\n`)
    return response
  }) as typeof fetch & { spend: () => TestSpend }
  wrapped.spend = () => ({ ...totals(), run, calls, refused })
  return wrapped
}
