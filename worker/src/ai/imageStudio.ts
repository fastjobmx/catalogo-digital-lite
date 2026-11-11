/** AI Studio: improves a product photo (background or lighting) with a Gemini image model.
 * Only fixed presets are offered and the instructions forbid changing the product itself, so the
 * result still shows what the customer will receive. The original photo is never replaced. */
import type { Env } from '../index'
import { classifyGeminiError, GeminiRequestError, UNTRUSTED_CONTENT_RULE } from './geminiClient'
import type { InlineImage } from './productVision'
import type { TokenUsage } from './usage'

export const STUDIO_PRESETS = {
  fondo_blanco: {
    label: 'Fondo blanco',
    instruction: 'Coloca el producto sobre un fondo blanco puro y uniforme de estudio, con una sombra suave y natural debajo.',
  },
  fondo_estudio: {
    label: 'Fondo de estudio',
    instruction: 'Coloca el producto sobre un fondo neutro de estudio fotográfico, gris claro con un degradado suave, con una sombra natural.',
  },
  mejorar_luz: {
    label: 'Mejorar luz',
    instruction: 'Mejora la iluminación, la nitidez y el balance de blancos de la foto. Conserva el mismo fondo y el mismo encuadre.',
  },
} as const
export type StudioPreset = keyof typeof STUDIO_PRESETS
export const isStudioPreset = (value: unknown): value is StudioPreset => typeof value === 'string' && Object.hasOwn(STUDIO_PRESETS, value)

const PRODUCT_FIDELITY = [
  'Eres un retocador de fotografía de producto para una tienda en línea.',
  'No cambies el producto: conserva exactamente su forma, proporciones, colores, materiales, textos, logotipos y cada uno de sus detalles.',
  'No agregues ni quites objetos, accesorios, textos, precios, sellos ni marcas de agua. No inventes partes que no se ven en la foto.',
  'Devuelve una sola imagen fotorrealista del mismo producto.',
  UNTRUSTED_CONTENT_RULE,
]

export function studioModel(env: Partial<Env['Bindings']>): string | null {
  const model = (env.GEMINI_IMAGE_MODEL || '').replace(/[^a-zA-Z0-9._-]/g, '')
  return model || null
}

/** Calls the image model with one of the fixed AI Studio presets. */
export function editProductPhoto(
  env: Partial<Env['Bindings']>,
  fetcher: typeof fetch,
  image: InlineImage,
  preset: StudioPreset,
): Promise<{ image: InlineImage; usage: TokenUsage; model: string }> {
  return editPhotoWithInstruction(env, fetcher, image, STUDIO_PRESETS[preset].instruction)
}

/** Calls the image model with a platform-written instruction (never free text from a user) under the product
 * fidelity rules, and returns the first image it produces. `model` defaults to GEMINI_IMAGE_MODEL. */
export async function editPhotoWithInstruction(
  env: Partial<Env['Bindings']>,
  fetcher: typeof fetch,
  image: InlineImage,
  instruction: string,
  modelOverride?: string,
  systemOverride?: string[],
): Promise<{ image: InlineImage; usage: TokenUsage; model: string }> {
  const model = (modelOverride || '').replace(/[^a-zA-Z0-9._-]/g, '') || studioModel(env)
  if (!env.GEMINI_API_KEY || !model) throw new Error('Image model not configured')
  const response = await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: (systemOverride || PRODUCT_FIDELITY).join(' ') }] },
      contents: [{ role: 'user', parts: [{ text: instruction }, { inlineData: image }] }],
      generationConfig: { responseModalities: ['IMAGE'], temperature: 0.2 },
    }),
  })
  if (!response.ok) throw await classifyGeminiError(response)
  const body = await response.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> }; finishReason?: string }>
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number }
  }
  const usage: TokenUsage = {
    promptTokens: Number(body.usageMetadata?.promptTokenCount || 0),
    outputTokens: Number(body.usageMetadata?.candidatesTokenCount || 0) + Number(body.usageMetadata?.thoughtsTokenCount || 0),
  }
  const part = body.candidates?.[0]?.content?.parts?.find((item) => item.inlineData?.data)
  const mimeType = part?.inlineData?.mimeType || ''
  if (!part?.inlineData?.data || !/^image\/(png|jpeg|webp)$/.test(mimeType)) {
    throw Object.assign(new GeminiRequestError('structured_schema', 200, `no-image:${body.candidates?.[0]?.finishReason || 'empty'}`), { usage })
  }
  return { image: { mimeType, data: part.inlineData.data }, usage, model }
}
