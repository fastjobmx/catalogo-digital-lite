import type { Env } from '../index'
import { watchAllowances } from './messageQuota'

/** Conservative default estimates in USD micros per million tokens. They are
 * configurable per installation because provider prices change; reports always
 * label the resulting amounts as estimates. */
export const DEFAULT_INPUT_MICROS_PER_MTOK = 300_000
export const DEFAULT_OUTPUT_MICROS_PER_MTOK = 2_500_000

export type TokenUsage = { promptTokens: number; outputTokens: number }

export type AiBudgetStatus = {
  allowed: boolean
  reason?: 'disabled' | 'budget_exhausted' | 'store_unavailable' | 'platform_cap'
  period: string
  spentMicros: number
  budgetMicros: number
  percent: number
  warn: boolean
}

export function currentPeriod(date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

function price(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

/** Estimated USD micros per million input/output tokens for this installation. */
export function geminiPrices(env: Partial<Env['Bindings']>): { input: number; output: number } {
  return {
    input: price(env.GEMINI_PRICE_INPUT_MICROS_PER_MTOK, DEFAULT_INPUT_MICROS_PER_MTOK),
    output: price(env.GEMINI_PRICE_OUTPUT_MICROS_PER_MTOK, DEFAULT_OUTPUT_MICROS_PER_MTOK),
  }
}

export function estimateCostMicros(env: Partial<Env['Bindings']>, usage: TokenUsage): number {
  const { input, output } = geminiPrices(env)
  return Math.ceil((Math.max(0, usage.promptTokens) * input + Math.max(0, usage.outputTokens) * output) / 1_000_000)
}

export function formatUsd(micros: number): string {
  return `US$ ${(micros / 1_000_000).toFixed(2)}`
}

/** Checks the store's monthly AI budget before calling Gemini. */
export async function checkAiBudget(db: D1Database, env: Partial<Env['Bindings']>, storeId: number): Promise<AiBudgetStatus> {
  const period = currentPeriod()
  const row = await db.prepare(
    `SELECT s.status, s.ai_enabled, s.ai_monthly_budget_micros AS budget, s.ai_warn_percent AS warnPercent,
            COALESCE(u.estimated_cost_micros, 0) AS spent, p.ai_budget_policy AS budgetPolicy
     FROM stores s LEFT JOIN ai_usage_monthly u ON u.store_id = s.id AND u.period = ?
     LEFT JOIN plans p ON p.code = s.plan_code
     WHERE s.id = ?`,
  ).bind(period, storeId).first<{ status: string; ai_enabled: number; budget: number; warnPercent: number; spent: number; budgetPolicy: string | null }>()
  if (!row) return { allowed: false, reason: 'store_unavailable', period, spentMicros: 0, budgetMicros: 0, percent: 0, warn: false }
  const budget = Number(row.budget || 0)
  const spent = Number(row.spent || 0)
  const percent = budget > 0 ? Math.min(999, Math.round((spent / budget) * 100)) : 100
  const base = { period, spentMicros: spent, budgetMicros: budget, percent, warn: percent >= Number(row.warnPercent || 80) }
  if (row.status === 'suspended' || row.status === 'cancelled') return { ...base, allowed: false, reason: 'store_unavailable' }
  if (!row.ai_enabled) return { ...base, allowed: false, reason: 'disabled' }
  // Plans with budget policy 'observe' (the new commercial plans) only alert at the budget; they are never cut off by it.
  if ((budget <= 0 || spent >= budget) && row.budgetPolicy !== 'observe') return { ...base, allowed: false, reason: 'budget_exhausted' }
  const cap = Number(env.PLATFORM_AI_MONTHLY_CAP_MICROS || 0)
  if (cap > 0) {
    const total = await db.prepare('SELECT COALESCE(SUM(estimated_cost_micros), 0) AS total FROM ai_usage_monthly WHERE period = ?').bind(period).first<{ total: number }>()
    if (Number(total?.total || 0) >= cap) return { ...base, allowed: false, reason: 'platform_cap' }
  }
  return { ...base, allowed: true }
}

/** Records one Gemini call. Returns whether the call crossed the warning threshold for the first time this month. */
export async function recordAiUsage(
  db: D1Database,
  env: Partial<Env['Bindings']>,
  input: { storeId: number; feature: string; model?: string; usage?: TokenUsage; status: 'ok' | 'blocked' | 'error' },
): Promise<{ crossedWarning: boolean; status: AiBudgetStatus }> {
  const period = currentPeriod()
  const usage = input.usage || { promptTokens: 0, outputTokens: 0 }
  const cost = input.status === 'blocked' ? 0 : estimateCostMicros(env, usage)
  await db.batch([
    db.prepare(
      `INSERT INTO ai_usage_events (store_id, period, feature, model, status, prompt_tokens, output_tokens, estimated_cost_micros)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(input.storeId, period, input.feature.slice(0, 60), (input.model || '').slice(0, 80), input.status, usage.promptTokens, usage.outputTokens, cost),
    db.prepare(
      `INSERT INTO ai_usage_monthly (store_id, period, requests, blocked_requests, prompt_tokens, output_tokens, estimated_cost_micros)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(store_id, period) DO UPDATE SET
         requests = requests + excluded.requests,
         blocked_requests = blocked_requests + excluded.blocked_requests,
         prompt_tokens = prompt_tokens + excluded.prompt_tokens,
         output_tokens = output_tokens + excluded.output_tokens,
         estimated_cost_micros = estimated_cost_micros + excluded.estimated_cost_micros,
         updated_at = datetime('now')`,
    ).bind(input.storeId, period, input.status === 'blocked' ? 0 : 1, input.status === 'blocked' ? 1 : 0, usage.promptTokens, usage.outputTokens, cost),
  ])
  const status = await checkAiBudget(db, env, input.storeId)
  let crossedWarning = false
  if (status.warn) {
    const marked = await db.prepare(
      `UPDATE ai_usage_monthly SET warned_at = datetime('now') WHERE store_id = ? AND period = ? AND warned_at IS NULL RETURNING store_id`,
    ).bind(input.storeId, period).first()
    crossedWarning = Boolean(marked)
    if (crossedWarning) {
      await db.prepare(
        `INSERT INTO platform_events (store_id, level, source, code, detail) VALUES (?, 'warning', 'ai', 'AI_BUDGET_WARNING', ?)`,
      ).bind(input.storeId, `Consumo IA estimado ${status.percent}% del presupuesto mensual`).run()
    }
  }
  // Plans that include a monthly number of photos / descriptions: tell the platform when it is being reached (never blocks).
  if (input.status === 'ok') await watchAllowances(db, input.storeId, input.feature)
  return { crossedWarning, status }
}

export async function getStoreAiUsage(db: D1Database, storeId: number) {
  const period = currentPeriod()
  const row = await db.prepare(
    `SELECT s.ai_enabled AS aiEnabled, s.ai_monthly_budget_micros AS budgetMicros, s.ai_warn_percent AS warnPercent,
            COALESCE(u.requests, 0) AS requests, COALESCE(u.blocked_requests, 0) AS blockedRequests,
            COALESCE(u.prompt_tokens, 0) AS promptTokens, COALESCE(u.output_tokens, 0) AS outputTokens,
            COALESCE(u.estimated_cost_micros, 0) AS estimatedCostMicros
     FROM stores s LEFT JOIN ai_usage_monthly u ON u.store_id = s.id AND u.period = ? WHERE s.id = ?`,
  ).bind(period, storeId).first<Record<string, number>>()
  const budget = Number(row?.budgetMicros || 0)
  const spent = Number(row?.estimatedCostMicros || 0)
  return {
    period,
    aiEnabled: Boolean(row?.aiEnabled),
    budgetMicros: budget,
    warnPercent: Number(row?.warnPercent || 80),
    requests: Number(row?.requests || 0),
    blockedRequests: Number(row?.blockedRequests || 0),
    promptTokens: Number(row?.promptTokens || 0),
    outputTokens: Number(row?.outputTokens || 0),
    estimatedCostMicros: spent,
    percent: budget > 0 ? Math.round((spent / budget) * 100) : 0,
    isEstimate: true,
  }
}

export const BUDGET_MESSAGES: Record<NonNullable<AiBudgetStatus['reason']>, string> = {
  disabled: 'El asistente de IA no está activo para esta tienda. Puedes seguir usando los botones y comandos.',
  budget_exhausted: 'Se alcanzó el límite mensual de IA de tu tienda. Puedes seguir usando los botones; para ampliar el límite contacta a soporte.',
  store_unavailable: 'Tu tienda no está disponible en este momento. Contacta a soporte.',
  platform_cap: 'La IA está en pausa temporalmente. Puedes seguir usando los botones y comandos.',
}
