/** Private order documents (shipping-guide photos). They can contain the buyer's address and phone:
 * they live under the R2 prefix order-docs/ (never served by the public asset route), are served only
 * to authorised store users with private, no-store headers, and are deleted after the retention period. */
import { inspectRasterImage } from './telegramProductImages'

export const ORDER_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024
/** Guides are kept while the order is open and this many days after it was delivered or cancelled. */
export const ORDER_DOCUMENT_RETENTION_DAYS = 180

export type OrderDocument = { id: number; kind: string; contentType: string; byteSize: number; source: string; createdBy: string; createdAt: string; hasTelegramCopy: boolean }

export class DocumentError extends Error {
  constructor(readonly code: 'INVALID_FILE' | 'TOO_LARGE' | 'STORAGE_UNAVAILABLE' | 'STORAGE_FAILED' | 'NOT_FOUND', message: string) { super(message) }
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Validates a guide photo by its real content (JPEG, PNG or WebP; size and dimensions). */
export function validateGuideImage(bytes: Uint8Array): { contentType: string; extension: string } {
  if (bytes.byteLength > ORDER_DOCUMENT_MAX_BYTES) throw new DocumentError('TOO_LARGE', 'La foto pesa más de 10 MB.')
  try {
    const metadata = inspectRasterImage(bytes)
    return { contentType: metadata.contentType, extension: metadata.extension }
  } catch {
    throw new DocumentError('INVALID_FILE', 'El archivo no es una foto válida (JPG, PNG o WebP de al menos 128 px).')
  }
}

/** Stores a guide photo for an order. The same photo twice for the same order is recognised and not duplicated. */
export async function storeOrderDocument(
  db: D1Database, bucket: R2Bucket | undefined,
  input: { storeId: number; orderId: number; bytes: Uint8Array; source: 'telegram' | 'panel'; actor: string; telegramFileId?: string | null; sha256?: string },
): Promise<{ id: number; duplicate: boolean }> {
  if (!bucket) throw new DocumentError('STORAGE_UNAVAILABLE', 'El almacenamiento no está disponible; no se guardó nada.')
  const { contentType, extension } = validateGuideImage(input.bytes)
  const sha = input.sha256 || await sha256Hex(input.bytes)
  const existing = await db.prepare('SELECT id FROM order_documents WHERE store_id = ? AND order_id = ? AND sha256 = ?').bind(input.storeId, input.orderId, sha).first<{ id: number }>()
  if (existing) return { id: existing.id, duplicate: true }
  const key = `order-docs/${input.storeId}/${input.orderId}/${crypto.randomUUID()}.${extension}`
  try {
    await bucket.put(key, input.bytes, { httpMetadata: { contentType, cacheControl: 'private, no-store' }, customMetadata: { storeId: String(input.storeId), orderId: String(input.orderId), purpose: 'guia_envio' } })
  } catch {
    throw new DocumentError('STORAGE_FAILED', 'No pude guardar la foto de la guía; el pedido no cambió.')
  }
  try {
    const row = await db.prepare(
      `INSERT INTO order_documents (store_id, order_id, kind, r2_key, content_type, byte_size, sha256, telegram_file_id, source, created_by)
       SELECT ?, ?, 'guia_envio', ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM orders WHERE id = ? AND store_id = ?) RETURNING id`,
    ).bind(input.storeId, input.orderId, key, contentType, input.bytes.byteLength, sha, input.telegramFileId ?? null, input.source, input.actor, input.orderId, input.storeId).first<{ id: number }>()
    if (!row) throw new DocumentError('NOT_FOUND', 'El pedido no existe en esta tienda.')
    await db.prepare(`INSERT INTO order_events (order_id, event_type, to_value, performed_by) VALUES (?, 'shipping_document', 'guia_envio', ?)`).bind(input.orderId, input.actor).run()
    return { id: row.id, duplicate: false }
  } catch (error) {
    await bucket.delete(key).catch(() => undefined)
    if (error instanceof DocumentError) throw error
    if (/unique constraint/i.test(String(error))) {
      const again = await db.prepare('SELECT id FROM order_documents WHERE store_id = ? AND order_id = ? AND sha256 = ?').bind(input.storeId, input.orderId, sha).first<{ id: number }>()
      if (again) return { id: again.id, duplicate: true }
    }
    throw new DocumentError('STORAGE_FAILED', 'No pude registrar la foto de la guía; el pedido no cambió.')
  }
}

export async function listOrderDocuments(db: D1Database, storeId: number, orderId: number): Promise<OrderDocument[]> {
  const { results } = await db.prepare(
    `SELECT id, kind, content_type, byte_size, source, created_by, created_at, telegram_file_id FROM order_documents WHERE store_id = ? AND order_id = ? ORDER BY id DESC`,
  ).bind(storeId, orderId).all<{ id: number; kind: string; content_type: string; byte_size: number; source: string; created_by: string; created_at: string; telegram_file_id: string | null }>()
  return (results || []).map((row) => ({ id: row.id, kind: row.kind, contentType: row.content_type, byteSize: row.byte_size, source: row.source, createdBy: row.created_by, createdAt: row.created_at, hasTelegramCopy: Boolean(row.telegram_file_id) }))
}

export async function latestGuide(db: D1Database, storeId: number, orderId: number): Promise<{ id: number; telegram_file_id: string | null } | null> {
  return db.prepare(`SELECT id, telegram_file_id FROM order_documents WHERE store_id = ? AND order_id = ? AND kind = 'guia_envio' ORDER BY id DESC LIMIT 1`).bind(storeId, orderId).first()
}

/** Serves a document to an authorised user of the same store (never cached, never public). */
export async function readOrderDocument(db: D1Database, bucket: R2Bucket | undefined, storeId: number, orderId: number, documentId: number, download = false): Promise<Response> {
  const row = await db.prepare('SELECT r2_key, content_type FROM order_documents WHERE id = ? AND order_id = ? AND store_id = ?').bind(documentId, orderId, storeId).first<{ r2_key: string; content_type: string }>()
  if (!row || !bucket) throw new DocumentError('NOT_FOUND', 'Documento no encontrado.')
  const object = await bucket.get(row.r2_key)
  if (!object) throw new DocumentError('NOT_FOUND', 'Documento no encontrado.')
  return new Response(object.body, {
    headers: {
      'content-type': row.content_type, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'x-robots-tag': 'noindex, nofollow',
      'content-disposition': `${download ? 'attachment' : 'inline'}; filename="guia-pedido-${orderId}.${row.content_type.split('/')[1] || 'jpg'}"`,
    },
  })
}

/** Cron: deletes guide photos of orders delivered or cancelled more than the retention period ago. */
export async function cleanupOrderDocuments(db: D1Database, bucket: R2Bucket | undefined): Promise<number> {
  const { results } = await db.prepare(
    `SELECT d.id, d.r2_key FROM order_documents d JOIN orders o ON o.id = d.order_id
     WHERE (o.status = 'entregado' AND COALESCE(o.delivered_at, o.updated_at) < datetime('now', '-${ORDER_DOCUMENT_RETENTION_DAYS} days'))
        OR (o.status = 'cancelado' AND o.updated_at < datetime('now', '-${ORDER_DOCUMENT_RETENTION_DAYS} days'))
     LIMIT 50`,
  ).all<{ id: number; r2_key: string }>()
  for (const row of results || []) {
    if (bucket) await bucket.delete(row.r2_key).catch(() => undefined)
    await db.prepare('DELETE FROM order_documents WHERE id = ?').bind(row.id).run()
  }
  return (results || []).length
}
