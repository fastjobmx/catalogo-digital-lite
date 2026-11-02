import { z } from 'zod'
import { ACTION_NAMES, parseActionPayload, type ActionName } from '../validation/actions'
import type { Env } from '../index'

const proposalShape = z.object({
  action: z.string().min(1).max(40),
  params: z.record(z.unknown()).default({}),
  missing: z.array(z.string()).default([]),
  summary: z.string().min(1).max(1000),
  transcript: z.string().max(4000).optional(),
})

export type ValidatedProposal = {
  action: ActionName | 'ask'
  params: Record<string, unknown>
  missing: string[]
  summary: string
  transcript?: string
  needsConfirmation: boolean
}

export type GeminiFailureCategory = 'quota' | 'service' | 'api_key' | 'permission_or_billing' | 'model' | 'structured_schema' | 'request'

export class GeminiRequestError extends Error {
  constructor(readonly category: GeminiFailureCategory, readonly status: number, readonly reason: string) {
    super(`Gemini ${category} error (${status}; ${reason})`)
    this.name = 'GeminiRequestError'
  }
}

export async function interpretWithGemini(
  message: string,
  env: Env['Bindings'],
  fetcher: typeof fetch = fetch,
  audio?: { mimeType: 'audio/ogg'; data: string },
): Promise<ValidatedProposal> {
  if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not configured')
  const model = (env.GEMINI_MODEL || 'gemini-3.8-flash').replace(/[^a-zA-Z0-9._-]/g, '')
  if (!model) throw new Error('Invalid GEMINI_MODEL')

  const response = await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: [
        'Eres un intérprete de órdenes de SneakerHub. Propón una sola acción permitida o ask.',
        'No propongas SQL, código ni llamadas a herramientas. No inventes SKU, precio, stock, talla, URL ni identificadores.',
        'Respeta los tipos del esquema: sku y size siempre son cadenas (por ejemplo size="38"); price y stock son enteros numéricos, nunca cadenas.',
        'Si faltan campos o la orden es ambigua, usa action=ask y explica qué dato falta.',
        'Las lecturas son consultas. Toda mutación requiere aprobación explícita posterior del Worker.',
        ...(audio ? ['Transcribe el audio completo en transcript y basa la propuesta únicamente en esa transcripción.'] : []),
      ].join(' ') }] },
      contents: [{ role: 'user', parts: [
        { text: message.slice(0, 4000) },
        ...(audio ? [{ inlineData: audio }] : []),
      ] }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 700,
        responseFormat: {
          text: {
            mimeType: 'APPLICATION_JSON',
            schema: {
              type: 'object',
              properties: {
                action: { type: 'string', enum: [...ACTION_NAMES, 'ask'] },
                params: {
                  type: 'object',
                  properties: {
                    sku: { type: 'string' },
                    size: { type: 'string' },
                    price: { type: 'integer' },
                    stock: { type: 'integer' },
                    query: { type: 'string' },
                  },
                  additionalProperties: true,
                },
                missing: { type: 'array', items: { type: 'string' } },
                summary: { type: 'string' },
                transcript: { type: 'string' },
              },
              required: ['action', 'params', 'missing', 'summary'],
            },
          },
        },
      },
    }),
  })

  if (!response.ok) {
    const status = response.status
    const errorBody = await response.json().catch(() => null) as { error?: { status?: string; message?: string } } | null
    const diagnostic = `${errorBody?.error?.status || ''} ${errorBody?.error?.message || ''}`.toLowerCase()
    const reason = /additionalpropert/.test(diagnostic)
      ? 'additional-properties'
      : /response.?format/.test(diagnostic)
        ? 'response-format'
        : /unknown name|unrecognized field|cannot find field/.test(diagnostic)
          ? 'unknown-request-field'
          : /schema/.test(diagnostic)
            ? 'schema-definition'
            : 'unclassified'
    const category: GeminiFailureCategory = status === 429
      ? 'quota'
      : status >= 500
        ? 'service'
        : status === 401 || /api key.*(invalid|not valid|expired)/i.test(diagnostic)
          ? 'api_key'
          : status === 403
            ? 'permission_or_billing'
            : /model.*(not found|not supported|unavailable|invalid)|unknown model/i.test(diagnostic)
              ? 'model'
              : /schema|response.?format|structured output|additionalpropert/i.test(diagnostic)
                ? 'structured_schema'
                : 'request'
    throw new GeminiRequestError(category, status, reason)
  }
  const data = await response.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>
  }
  const raw = data.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim()
  if (!raw) throw new Error('Gemini returned an empty proposal')

  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ''))
  } catch {
    throw new Error('Gemini returned malformed JSON')
  }
  const parsed = proposalShape.safeParse(parsedJson)
  if (!parsed.success) throw new Error('Gemini proposal does not match the response schema')
  if (parsed.data.action === 'ask') return { ...parsed.data, action: 'ask', needsConfirmation: false }
  if (!ACTION_NAMES.includes(parsed.data.action as ActionName)) throw new Error('Gemini proposal does not match the response schema')

  const actionName = parsed.data.action as ActionName
  let params = parsed.data.params
  if (actionName === 'update_stock' && audio) {
    const spokenSize = extractSingleSpokenSize(parsed.data.transcript)
    const proposedSize = (params as Record<string, unknown>).size
    if (spokenSize && (proposedSize === undefined || String(proposedSize).trim() === spokenSize)) {
      params = { ...params, size: spokenSize }
    } else if (spokenSize && String(proposedSize).trim() !== spokenSize) {
      return {
        ...parsed.data,
        action: 'ask',
        missing: [...new Set([...parsed.data.missing, 'la talla transcrita y la interpretada no coinciden'])],
        needsConfirmation: false,
      }
    }
  }

  const validated = parseActionPayload({ action: actionName, params })
  if (!validated.success) {
    const supplied = parsed.data.missing
    const issues = validated.error.split(', ').filter(Boolean)
    const missing = [...new Set([...supplied, ...issues])]
    return { ...parsed.data, action: 'ask', missing, needsConfirmation: false }
  }

  const action = actionName
  const readOnly = ['get_inventory', 'get_products', 'get_store_configuration'].includes(action)
  return {
    ...parsed.data,
    action,
    params: validated.data.params as Record<string, unknown>,
    missing: parsed.data.missing,
    needsConfirmation: !readOnly,
  }
}

function extractSingleSpokenSize(transcript?: string): string | null {
  if (!transcript) return null
  const matches = [...transcript.matchAll(/\btalla\s+(\d+)\b/gi)]
  return matches.length === 1 ? matches[0]?.[1] || null : null
}
