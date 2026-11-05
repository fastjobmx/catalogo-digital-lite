/** Web panel AI actions for the catalogue, behind the store switch, the monthly budget and credits. */
import type { Env } from '../index'
import { runWithCredits, validIdempotencyKey, type CreditRun } from '../ai/credits'
import { geminiFailureCode } from '../ai/geminiClient'
import { extractCatalogPage, suggestProductFromPhotos, type InlineImage } from '../ai/productVision'

export const AI_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

export class AiCatalogError extends Error {
  constructor(readonly code: string, message: string, readonly status: 400 | 404 | 409 | 502 = 400) { super(message) }
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

/** Reads one of the store's own product photos from R2. Any other key is refused. */
async function storePhoto(bucket: R2Bucket | undefined, storeId: number, url: unknown): Promise<InlineImage> {
  if (!bucket) throw new AiCatalogError('STORAGE_UNAVAILABLE', 'El almacenamiento de fotos no está disponible', 409)
  const key = typeof url === 'string' ? url.replace(/^\/api\/assets\//, '') : ''
  if (!new RegExp(`^stores/${storeId}/products/[\\w.-]+$`).test(key) || key.includes('..')) throw new AiCatalogError('ASSET_NOT_OWNED', 'La foto no pertenece a esta tienda')
  const object = await bucket.get(key)
  if (!object) throw new AiCatalogError('PHOTO_NOT_FOUND', 'No encontré la foto', 404)
  const mimeType = object.httpMetadata?.contentType || ''
  if (!AI_IMAGE_TYPES.includes(mimeType as typeof AI_IMAGE_TYPES[number])) throw new AiCatalogError('INVALID_IMAGE', 'Usa fotos JPG, PNG o WebP')
  const bytes = new Uint8Array(await object.arrayBuffer())
  if (bytes.length > MAX_IMAGE_BYTES) throw new AiCatalogError('IMAGE_TOO_LARGE', 'La foto pesa más de 5 MB')
  return { mimeType, data: toBase64(bytes) }
}

function gate<T>(run: CreditRun<T>) {
  if (run.ok) return run
  if (run.reason === 'error') {
    console.error('AI catalog action failed:', geminiFailureCode(run.error))
    throw new AiCatalogError('AI_FAILED', run.message, 502)
  }
  throw new AiCatalogError(`AI_${run.reason.toUpperCase()}`, run.message, 409)
}

/** Suggests name, description and category for a product photo. Price and stock stay with the store. */
export async function photoToProduct(env: Env['Bindings'], storeId: number, actor: string, key: string, body: { imageUrl?: unknown; hint?: unknown }) {
  if (!validIdempotencyKey(key)) throw new AiCatalogError('INVALID_IDEMPOTENCY_KEY', 'Falta el encabezado Idempotency-Key')
  const image = await storePhoto(env.ASSETS, storeId, body.imageUrl)
  const { results } = await env.DB.prepare('SELECT name FROM categories WHERE store_id = ? AND is_active = 1 ORDER BY sort_order, name LIMIT 40').bind(storeId).all<{ name: string }>()
  const hint = typeof body.hint === 'string' ? body.hint.slice(0, 300) : undefined
  const run = gate(await runWithCredits(env.DB, env, { storeId, feature: 'foto_a_producto', key, actor }, () => suggestProductFromPhotos(env, fetch, [image], { text: hint, categories: (results || []).map((row) => row.name) })))
  const { usage: _usage, model: _model, ...suggestion } = run.value
  return { suggestion, charged: run.charged }
}

/** Transcribes the product rows of one scanned catalogue page (rendered as an image in the browser). */
export async function readCatalogPage(env: Env['Bindings'], storeId: number, actor: string, key: string, body: { image?: unknown; mimeType?: unknown }) {
  if (!validIdempotencyKey(key)) throw new AiCatalogError('INVALID_IDEMPOTENCY_KEY', 'Falta el encabezado Idempotency-Key')
  const mimeType = typeof body.mimeType === 'string' ? body.mimeType : ''
  const data = typeof body.image === 'string' ? body.image : ''
  if (!AI_IMAGE_TYPES.includes(mimeType as typeof AI_IMAGE_TYPES[number]) || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new AiCatalogError('INVALID_IMAGE', 'Imagen de página no válida')
  if (data.length * 0.75 > MAX_IMAGE_BYTES) throw new AiCatalogError('IMAGE_TOO_LARGE', 'La página pesa más de 5 MB')
  const run = gate(await runWithCredits(env.DB, env, { storeId, feature: 'importar_pdf_pagina', key, actor }, () => extractCatalogPage(env, fetch, { mimeType, data })))
  return { rows: run.value.rows, readable: run.value.readable, charged: run.charged }
}
