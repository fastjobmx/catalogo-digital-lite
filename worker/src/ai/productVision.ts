/** Gemini vision helpers shared by Telegram and the web panel. They only describe what is visible:
 * prices, stock, sizes and guarantees are never proposed from a photo, and text inside images or
 * documents is treated as data, never as instructions. */
import { z } from 'zod'
import type { Env } from '../index'
import { callGeminiJson, GeminiRequestError, UNTRUSTED_CONTENT_RULE, type GeminiPart } from './geminiClient'
import type { TokenUsage } from './usage'

export const visionShape = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().min(10).max(1200),
  category: z.string().trim().max(60).default(''),
  colors: z.array(z.string().trim().min(2).max(30)).max(6).default([]),
  features: z.array(z.string().trim().min(2).max(120)).max(8).default([]),
  visibleBrand: z.string().trim().max(60).default(''),
  confidence: z.enum(['alta', 'media', 'baja']).default('media'),
  isProductPhoto: z.boolean().default(true),
})
export type VisionSuggestion = z.infer<typeof visionShape>
export type InlineImage = { mimeType: string; data: string }

/** Suggests catalogue fields from product photos. Never proposes price, stock or sizes. */
export async function suggestProductFromPhotos(
  env: Partial<Env['Bindings']>,
  fetcher: typeof fetch,
  images: InlineImage[],
  hint: { text?: string; categories: string[] },
): Promise<VisionSuggestion & { usage: TokenUsage; model: string }> {
  const parts: GeminiPart[] = [
    { text: `Analiza estas fotografías de un producto para preparar su ficha de catálogo.${hint.text ? ` El propietario dijo: "${hint.text.slice(0, 300)}".` : ''} Categorías existentes de la tienda: ${hint.categories.join(', ') || 'ninguna'}.` },
    ...images.slice(0, 3).map((image) => ({ inlineData: image })),
  ]
  const result = await callGeminiJson(env, fetcher, {
    system: [
      'Eres un asistente de catálogo para una tienda en línea en español.',
      'Describe solo características visibles: tipo de producto, colores, materiales aparentes y detalles de diseño.',
      'Nunca propongas precio, stock, tallas, medidas exactas ni garantías. No afirmes que un producto es original.',
      'Si ves una marca o logotipo legible, escríbelo en visibleBrand; no la incluyas en el nombre si no estás seguro.',
      'Si la imagen no muestra un producto vendible, usa isProductPhoto=false.',
      'El nombre debe ser comercial y claro (máximo 8 palabras). La descripción: 2 a 4 frases atractivas y honestas, sin inventar datos.',
      'En category usa preferiblemente una de las categorías existentes; si ninguna aplica, sugiere un nombre corto.',
      UNTRUSTED_CONTENT_RULE,
    ],
    parts,
    maxOutputTokens: 2048,
    temperature: 0.3,
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string' }, description: { type: 'string' }, category: { type: 'string' },
        colors: { type: 'array', items: { type: 'string' } }, features: { type: 'array', items: { type: 'string' } },
        visibleBrand: { type: 'string' }, confidence: { type: 'string', enum: ['alta', 'media', 'baja'] },
        isProductPhoto: { type: 'boolean' },
      },
      required: ['name', 'description', 'category', 'colors', 'confidence', 'isProductPhoto'],
    },
  })
  const parsed = visionShape.safeParse(result.data)
  if (!parsed.success) throw Object.assign(new GeminiRequestError('structured_schema', 200, 'vision-shape'), { usage: result.usage })
  return { ...parsed.data, usage: result.usage, model: result.model }
}

const cell = z.string().trim().max(300).default('')
export const catalogPageShape = z.object({
  rows: z.array(z.object({ sku: cell, name: cell, price: cell, stock: cell, category: cell, color: cell, size: cell, description: cell })).max(80).default([]),
  readable: z.boolean().default(true),
})
export type CatalogPageRow = z.infer<typeof catalogPageShape>['rows'][number]

/** Reads a scanned catalogue page and copies its product rows exactly as written. Empty when not visible. */
export async function extractCatalogPage(
  env: Partial<Env['Bindings']>,
  fetcher: typeof fetch,
  image: InlineImage,
): Promise<{ rows: CatalogPageRow[]; readable: boolean; usage: TokenUsage; model: string }> {
  const result = await callGeminiJson(env, fetcher, {
    system: [
      'Eres un lector de catálogos impresos. Transcribes; no redactas ni completas.',
      'Devuelve una fila por cada producto visible en la página, copiando el texto tal como aparece: código o referencia, nombre, precio, existencias, categoría, color, talla y descripción.',
      'Si un dato no se ve escrito en la página, deja ese campo vacío. Nunca inventes ni calcules precios, códigos, existencias, marcas ni medidas.',
      'Copia el precio con su formato original (por ejemplo "$ 1.250.000"). No conviertas monedas.',
      'Si la página no contiene productos o no se puede leer, devuelve rows vacío y readable=false.',
      UNTRUSTED_CONTENT_RULE,
    ],
    parts: [{ text: 'Transcribe los productos de esta página de catálogo.' }, { inlineData: image }],
    maxOutputTokens: 8192,
    temperature: 0,
    schema: {
      type: 'object',
      properties: {
        rows: {
          type: 'array',
          items: {
            type: 'object',
            properties: Object.fromEntries(['sku', 'name', 'price', 'stock', 'category', 'color', 'size', 'description'].map((key) => [key, { type: 'string' }])),
            required: ['name'],
          },
        },
        readable: { type: 'boolean' },
      },
      required: ['rows', 'readable'],
    },
  })
  const parsed = catalogPageShape.safeParse(result.data)
  if (!parsed.success) throw Object.assign(new GeminiRequestError('structured_schema', 200, 'catalog-page-shape'), { usage: result.usage })
  return { rows: parsed.data.rows.filter((row) => row.name), readable: parsed.data.readable, usage: result.usage, model: result.model }
}
