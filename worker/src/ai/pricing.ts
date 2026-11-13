/** Official Gemini API prices, in USD micros per million tokens, versioned by model and date.
 *
 * Single source of truth for every cost estimate on the platform (budgets, reservations, reports).
 * Source: https://ai.google.dev/gemini-api/docs/pricing (Standard tier, read 2026-11-13). Every change to this
 * table is a reviewed commit: bump PRICING_VERSION and note the source date. Operators can correct a price
 * without a release through AI_PRICING_OVERRIDES (JSON, same shape as one rate), which is recorded with each event.
 *
 * Output prices include thinking tokens (Google bills them as output). Failed requests (HTTP 4xx/5xx) are not billed.
 */
import type { Env } from '../index'

export const PRICING_VERSION = '2026-11-13'

export type ServiceTier = 'standard' | 'batch' | 'priority'

export type Rate = {
  /** Text, image and video input. */
  input: number
  /** Audio input when the model prices it apart (defaults to `input`). */
  audioInput?: number
  /** Text output, including thinking tokens. */
  output: number
  /** Image output tokens (image models only). */
  imageOutput?: number
  /** Cached input tokens (context caching). */
  cachedInput?: number
  /** Prompts above 200k tokens (Pro models). */
  longInput?: number
  longOutput?: number
}

type Entry = { model: string; from: string; until?: string; standard: Rate; batchFactor?: number; priorityFactor?: number }

/** Dates are inclusive, in UTC (YYYY-MM-DD). The first matching entry wins. */
export const PRICE_TABLE: readonly Entry[] = [
  // Introductory price until 2026-12-31; the published standard price applies from 2027-01-01.
  { model: 'gemini-3.8-flash', from: '2000-01-01', until: '2026-12-31', standard: { input: 750_000, output: 3_750_000, cachedInput: 75_000 }, batchFactor: 0.5, priorityFactor: 1.8 },
  { model: 'gemini-3.8-flash', from: '2027-01-01', standard: { input: 1_500_000, output: 7_500_000, cachedInput: 150_000 }, batchFactor: 0.5, priorityFactor: 1.8 },
  { model: 'gemini-3.1-flash-image', from: '2000-01-01', standard: { input: 500_000, output: 3_000_000, imageOutput: 60_000_000 } },
  { model: 'gemini-3.1-flash-lite', from: '2000-01-01', standard: { input: 250_000, audioInput: 500_000, output: 1_500_000, cachedInput: 25_000 } },
  { model: 'gemini-3.5-flash-lite', from: '2000-01-01', standard: { input: 300_000, output: 2_500_000, cachedInput: 30_000 } },
  { model: 'gemini-2.5-flash-lite', from: '2000-01-01', standard: { input: 100_000, audioInput: 300_000, output: 400_000, cachedInput: 10_000 } },
  // Video (Interactions API): US$ 12 per million output tokens, 1.931 tokens/s at 360p and 5.792 at 720p (docs read 2026-11-10).
  { model: 'gemini-omni-flash-preview', from: '2000-01-01', standard: { input: 1_500_000, output: 12_000_000 } },
  { model: 'gemini-3.1-pro-preview', from: '2000-01-01', standard: { input: 2_000_000, output: 12_000_000, cachedInput: 200_000, longInput: 4_000_000, longOutput: 18_000_000 } },
]

/** Unknown models are priced with the most expensive text rate in the table, never with a cheaper guess. */
export const UNKNOWN_MODEL_RATE: Rate = { input: 2_000_000, output: 12_000_000, imageOutput: 60_000_000, longInput: 4_000_000, longOutput: 18_000_000 }

export type GeminiUsage = {
  promptTokens: number
  /** Output tokens. Legacy callers already add thinking tokens here; new callers report them in `thoughtsTokens`. */
  outputTokens: number
  thoughtsTokens?: number
  cachedTokens?: number
  /** Part of `promptTokens` that was audio. */
  audioInputTokens?: number
  /** Part of `outputTokens` that was image. Image models with no breakdown count all output as image. */
  imageOutputTokens?: number
}

export type CostBreakdown = {
  model: string
  pricingVersion: string
  rateSource: 'table' | 'override' | 'unknown_model'
  tier: ServiceTier
  inputMicros: number
  cachedMicros: number
  outputMicros: number
  imageMicros: number
  totalMicros: number
}

const day = (date: Date) => date.toISOString().slice(0, 10)

function overrides(env: Partial<Env['Bindings']> | undefined): Record<string, Rate> {
  const raw = (env as Record<string, unknown> | undefined)?.AI_PRICING_OVERRIDES
  if (typeof raw !== 'string' || !raw.trim()) return {}
  try {
    const parsed = JSON.parse(raw) as Record<string, Partial<Rate>>
    const valid: Record<string, Rate> = {}
    for (const [model, rate] of Object.entries(parsed || {})) {
      if (rate && Number.isFinite(rate.input) && Number.isFinite(rate.output) && rate.input! >= 0 && rate.output! >= 0) valid[model] = rate as Rate
    }
    return valid
  } catch {
    return {}
  }
}

/** Rate for a model on a date. Model names are matched exactly, then by stripping version suffixes (`-001`, `-latest`). */
export function rateFor(env: Partial<Env['Bindings']> | undefined, model: string, at = new Date(), tier: ServiceTier = 'standard'): { rate: Rate; source: CostBreakdown['rateSource'] } {
  const name = (model || '').trim()
  const override = overrides(env)[name]
  if (override) return { rate: override, source: 'override' }
  const base = name.replace(/-(\d{3}|latest|preview-\d{2}-\d{2})$/, '')
  const today = day(at)
  const entry = PRICE_TABLE.find((item) => (item.model === name || item.model === base) && item.from <= today && (!item.until || today <= item.until))
  if (!entry) return { rate: UNKNOWN_MODEL_RATE, source: 'unknown_model' }
  const factor = tier === 'batch' ? entry.batchFactor ?? 1 : tier === 'priority' ? entry.priorityFactor ?? 1 : 1
  const scale = (value: number | undefined) => value === undefined ? undefined : Math.round(value * factor)
  const r = entry.standard
  return {
    rate: { input: scale(r.input)!, output: scale(r.output)!, audioInput: scale(r.audioInput), imageOutput: scale(r.imageOutput), cachedInput: scale(r.cachedInput), longInput: scale(r.longInput), longOutput: scale(r.longOutput) },
    source: 'table',
  }
}

const isImageModel = (model: string, rate: Rate) => rate.imageOutput !== undefined && /image/i.test(model)

/** Cost of one call, split by component. Always rounds up: estimates never undercount. */
export function costOf(env: Partial<Env['Bindings']> | undefined, model: string, usage: GeminiUsage, at = new Date(), tier: ServiceTier = 'standard'): CostBreakdown {
  const { rate, source } = rateFor(env, model, at, tier)
  const n = (value: number | undefined) => Math.max(0, Number(value || 0))
  const prompt = n(usage.promptTokens)
  const cached = Math.min(prompt, n(usage.cachedTokens))
  const audio = Math.min(prompt - cached, n(usage.audioInputTokens))
  const plainInput = prompt - cached - audio
  const long = prompt > 200_000 && rate.longInput !== undefined
  const inputRate = long ? rate.longInput! : rate.input
  const outputRate = long && rate.longOutput !== undefined ? rate.longOutput : rate.output
  const output = n(usage.outputTokens) + n(usage.thoughtsTokens)
  const image = Math.min(output, usage.imageOutputTokens !== undefined ? n(usage.imageOutputTokens) : isImageModel(model, rate) ? output : 0)
  const inputMicros = (plainInput * inputRate + audio * (rate.audioInput ?? inputRate)) / 1_000_000
  const cachedMicros = (cached * (rate.cachedInput ?? inputRate)) / 1_000_000
  const outputMicros = ((output - image) * outputRate) / 1_000_000
  const imageMicros = (image * (rate.imageOutput ?? outputRate)) / 1_000_000
  return {
    model, pricingVersion: PRICING_VERSION, rateSource: source, tier,
    inputMicros: Math.ceil(inputMicros), cachedMicros: Math.ceil(cachedMicros), outputMicros: Math.ceil(outputMicros), imageMicros: Math.ceil(imageMicros),
    totalMicros: Math.ceil(inputMicros + cachedMicros + outputMicros + imageMicros),
  }
}

/** Usage as reported by `generateContent` (`usageMetadata`), with the modality breakdowns when present. */
export function usageFromMetadata(meta: unknown): GeminiUsage {
  const m = (meta || {}) as {
    promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; cachedContentTokenCount?: number
    promptTokensDetails?: Array<{ modality?: string; tokenCount?: number }>
    candidatesTokensDetails?: Array<{ modality?: string; tokenCount?: number }>
  }
  const sum = (list: typeof m.promptTokensDetails, modality: string) => list?.length ? list.filter((item) => item.modality === modality).reduce((total, item) => total + Number(item.tokenCount || 0), 0) : undefined
  return {
    promptTokens: Number(m.promptTokenCount || 0),
    outputTokens: Number(m.candidatesTokenCount || 0),
    thoughtsTokens: Number(m.thoughtsTokenCount || 0),
    cachedTokens: Number(m.cachedContentTokenCount || 0),
    audioInputTokens: sum(m.promptTokensDetails, 'AUDIO'),
    imageOutputTokens: sum(m.candidatesTokensDetails, 'IMAGE'),
  }
}

/** Upper bound of a request before it is sent, from what the request itself declares. Used for the reservation. */
export function estimateRequestMicros(env: Partial<Env['Bindings']> | undefined, model: string, body: unknown, kind: 'text' | 'image' | 'video', at = new Date()): number {
  const b = (body || {}) as {
    systemInstruction?: unknown; contents?: Array<{ parts?: Array<{ text?: string; inlineData?: { mimeType?: string; data?: string } }> }>; generationConfig?: { maxOutputTokens?: number }
    input?: Array<{ type?: string; text?: string; data?: string }>; response_format?: { resolution?: string; duration?: string }
  }
  let textChars = JSON.stringify(b.systemInstruction || '').length
  let images = 0
  let audioBytes = 0
  let documentBytes = 0
  for (const content of b.contents || []) {
    for (const part of content.parts || []) {
      if (typeof part.text === 'string') textChars += part.text.length
      const mime = part.inlineData?.mimeType || ''
      const bytes = Math.floor((part.inlineData?.data?.length || 0) * 0.75)
      if (mime.startsWith('image/')) images++
      else if (mime.startsWith('audio/')) audioBytes += bytes
      else if (part.inlineData) documentBytes += bytes
    }
  }
  for (const item of b.input || []) {
    if (typeof item.text === 'string') textChars += item.text.length
    if (item.type === 'image') images++
  }
  // Conservative: ~3 characters per token for Spanish text, 1.290 tokens per image (largest tile set), 32 tokens per
  // second of audio at ~2 KB per second of compressed voice, 258 tokens per PDF page at ~50 KB per page.
  const audioTokens = Math.ceil(audioBytes / 2_000) * 32
  const promptTokens = Math.ceil(textChars / 3) + images * 1_290 + audioTokens + Math.ceil(documentBytes / 50_000) * 258
  const declared = Number(b.generationConfig?.maxOutputTokens || 0)
  const seconds = Math.min(60, Math.max(1, parseInt(String(b.response_format?.duration || ''), 10) || 15))
  const videoTokens = Math.ceil(seconds * (/720/.test(String(b.response_format?.resolution || '')) ? 5_792 : /360/.test(String(b.response_format?.resolution || '')) ? 1_931 : 5_792) * 1.1)
  const outputTokens = kind === 'image' ? Math.max(declared, 2_600) : kind === 'video' ? Math.max(declared, videoTokens) : declared > 0 ? declared : 8_192
  return costOf(env, model, { promptTokens, outputTokens, audioInputTokens: audioTokens }, at).totalMicros
}
