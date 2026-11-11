/** Biblioteca de recursos del Estudio Creativo. Originales siempre privados en R2
 * (creative-private/stores/<id>/originals/…); resultados privados hasta que el comercio los aprueba, y solo
 * entonces se copian al espacio público de la tienda. Un original nunca se modifica ni se borra al procesar. */
import { assetUrlBelongsToStore } from '../lib/assets'
import { getTelegramBatchPhoto } from '../services/telegramProductBatches'
import { CreativeError } from './brandKit'
import type { CreativeContext } from './contracts'
import { IMAGE_EXTENSION, imageDimensions, sha256Hex, sniffImageType, type ImageType } from './imageInfo'

export const MAX_ASSET_BYTES = 5 * 1024 * 1024
export const MAX_ASSETS_PER_STORE = 2000
export const MAX_PRODUCT_IMAGES = 12

export type AssetRole = 'original' | 'resultado'
export type AssetStatus = 'activo' | 'pendiente' | 'aprobado' | 'descartado'
export type AttachMode = 'principal' | 'agregar'

type Row = {
  id: string; store_id: number; product_id: number | null; role: AssetRole; status: AssetStatus; r2_key: string | null; public_url: string | null
  content_type: ImageType; byte_size: number; width: number | null; height: number | null; sha256: string; level: 'A' | 'B' | 'C' | null
  operation: string | null; model: string | null; credits: number; cost_micros: number; source_asset_id: string | null; job_id: string | null
  origin: string; origin_ref: string | null; created_by: string; created_at: string; product_name?: string | null
}

export interface CreativeAsset {
  id: string; role: AssetRole; status: AssetStatus; productId: number | null; productName: string | null; publicUrl: string | null
  contentType: ImageType; bytes: number; width: number | null; height: number | null; level: 'A' | 'B' | 'C' | null; operation: string | null
  model: string | null; credits: number; costMicros: number; sourceAssetId: string | null; jobId: string | null; origin: string
  /** true cuando viene de un borrador de Telegram que aún no es producto. */
  telegramDraft: boolean; hasFile: boolean; createdBy: string; createdAt: string
}

const toAsset = (row: Row): CreativeAsset => ({
  id: row.id, role: row.role, status: row.status, productId: row.product_id, productName: row.product_name ?? null, publicUrl: row.public_url,
  contentType: row.content_type, bytes: row.byte_size, width: row.width, height: row.height, level: row.level, operation: row.operation,
  model: row.model, credits: row.credits, costMicros: row.cost_micros, sourceAssetId: row.source_asset_id, jobId: row.job_id, origin: row.origin,
  telegramDraft: Boolean(row.origin_ref?.startsWith('telegram:')) && row.product_id === null, hasFile: Boolean(row.r2_key), createdBy: row.created_by, createdAt: row.created_at,
})

const SELECT = `SELECT a.*, p.name AS product_name FROM creative_assets a LEFT JOIN products p ON p.id = a.product_id AND p.store_id = a.store_id`
const validId = (id: unknown): id is string => typeof id === 'string' && /^[0-9a-f-]{36}$/.test(id)
const privateKey = (storeId: number, folder: 'originals' | 'results', id: string, type: ImageType) => `creative-private/stores/${storeId}/${folder}/${id}.${IMAGE_EXTENSION[type]}`

function inspect(bytes: Uint8Array) {
  if (!bytes.length) throw new CreativeError('INVALID_IMAGE', 'El archivo está vacío')
  if (bytes.length > MAX_ASSET_BYTES) throw new CreativeError('IMAGE_TOO_LARGE', 'La imagen pesa más de 5 MB')
  const type = sniffImageType(bytes)
  if (!type) throw new CreativeError('INVALID_IMAGE', 'Usa fotos JPG, PNG o WebP')
  return { type, dimensions: imageDimensions(bytes) }
}

async function audit(db: D1Database, ctx: CreativeContext, action: string, id: string, payload: unknown = {}) {
  await db.prepare(`INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id) VALUES (?, 'creative_asset', ?, ?, ?, 'admin', ?)`)
    .bind(action, id, JSON.stringify(payload), ctx.actor, ctx.storeId).run()
}

export function assetLibrary(db: D1Database, bucket: R2Bucket | undefined) {
  const storage = () => { if (!bucket) throw new CreativeError('STORAGE_UNAVAILABLE', 'El almacenamiento de fotos no está disponible', 409); return bucket }
  const find = async (storeId: number, id: unknown) => validId(id) ? db.prepare(`${SELECT} WHERE a.id = ? AND a.store_id = ?`).bind(id, storeId).first<Row>() : null
  const need = async (storeId: number, id: unknown) => {
    const row = await find(storeId, id)
    if (!row) throw new CreativeError('ASSET_NOT_FOUND', 'Recurso no encontrado', 404)
    return row
  }
  const product = async (storeId: number, productId: unknown) => {
    const id = Number(productId)
    const row = Number.isSafeInteger(id) && id > 0
      ? await db.prepare('SELECT id, name, image_urls FROM products WHERE id = ? AND store_id = ?').bind(id, storeId).first<{ id: number; name: string; image_urls: string }>()
      : null
    if (!row) throw new CreativeError('PRODUCT_NOT_FOUND', 'Producto no encontrado', 404)
    let images: string[] = []
    try { const parsed = JSON.parse(row.image_urls || '[]'); if (Array.isArray(parsed)) images = parsed.filter((v): v is string => typeof v === 'string') } catch { images = [] }
    return { id: row.id, name: row.name, images }
  }

  /** Guarda un original una sola vez por tienda (misma huella = mismo recurso). */
  async function registerOriginal(ctx: CreativeContext, bytes: Uint8Array, meta: { productId?: number | null; origin: string; originRef?: string | null }): Promise<{ asset: CreativeAsset; duplicate: boolean }> {
    const { type, dimensions } = inspect(bytes)
    const hash = await sha256Hex(bytes)
    const existing = await db.prepare(`${SELECT} WHERE a.store_id = ? AND a.sha256 = ? AND a.role = 'original'`).bind(ctx.storeId, hash).first<Row>()
    if (existing) {
      // Un archivo repetido no se duplica; si ahora se conoce su producto u origen, se completa.
      if ((meta.productId && !existing.product_id) || (meta.originRef && !existing.origin_ref)) {
        await db.prepare(`UPDATE creative_assets SET product_id = COALESCE(product_id, ?), origin_ref = COALESCE(origin_ref, ?), updated_at = datetime('now') WHERE id = ? AND store_id = ?`)
          .bind(meta.productId ?? null, meta.originRef ?? null, existing.id, ctx.storeId).run()
        return { asset: toAsset((await find(ctx.storeId, existing.id))!), duplicate: true }
      }
      return { asset: toAsset(existing), duplicate: true }
    }
    const count = await db.prepare(`SELECT COUNT(*) AS n FROM creative_assets WHERE store_id = ? AND status <> 'descartado'`).bind(ctx.storeId).first<{ n: number }>()
    if (Number(count?.n || 0) >= MAX_ASSETS_PER_STORE) throw new CreativeError('LIBRARY_FULL', 'La biblioteca llegó a su límite. Descarta recursos que ya no uses.', 409)
    const id = crypto.randomUUID()
    const key = privateKey(ctx.storeId, 'originals', id, type)
    await storage().put(key, bytes, { httpMetadata: { contentType: type }, customMetadata: { storeId: String(ctx.storeId), assetId: id } })
    const inserted = await db.prepare(
      `INSERT OR IGNORE INTO creative_assets (id, store_id, product_id, role, status, r2_key, content_type, byte_size, width, height, sha256, origin, origin_ref, created_by)
       VALUES (?, ?, ?, 'original', 'activo', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, ctx.storeId, meta.productId ?? null, key, type, bytes.length, dimensions?.width ?? null, dimensions?.height ?? null, hash, meta.origin, meta.originRef ?? null, ctx.actor.slice(0, 160)).run()
    if (!inserted.meta?.changes) {
      // Otra solicitud registró el mismo archivo a la vez.
      await storage().delete(key).catch(() => undefined)
      const raced = await db.prepare(`${SELECT} WHERE a.store_id = ? AND a.sha256 = ? AND a.role = 'original'`).bind(ctx.storeId, hash).first<Row>()
      return { asset: toAsset(raced!), duplicate: true }
    }
    return { asset: toAsset((await find(ctx.storeId, id))!), duplicate: false }
  }

  /** Agrega una imagen pública de la tienda a un producto sin quitar las que ya tiene. */
  async function addProductImage(ctx: CreativeContext, productId: number, url: string, mode: AttachMode) {
    const target = await product(ctx.storeId, productId)
    const images = target.images.filter((item) => item !== url)
    if (images.length >= MAX_PRODUCT_IMAGES) throw new CreativeError('PRODUCT_IMAGES_FULL', `El producto ya tiene ${MAX_PRODUCT_IMAGES} fotos. Quita alguna desde Productos.`, 409)
    const next = mode === 'principal' ? [url, ...images] : [...images, url]
    await db.prepare(`UPDATE products SET image_urls = ?, updated_at = datetime('now') WHERE id = ? AND store_id = ?`).bind(JSON.stringify(next), target.id, ctx.storeId).run()
    return target
  }

  return {
    registerOriginal,

    /** Sube una foto nueva desde el panel. */
    async upload(ctx: CreativeContext, file: unknown, productId?: unknown) {
      if (!(file instanceof File)) throw new CreativeError('INVALID_IMAGE', 'Falta la foto')
      if (file.size > MAX_ASSET_BYTES) throw new CreativeError('IMAGE_TOO_LARGE', 'La imagen pesa más de 5 MB')
      const linked = productId === undefined || productId === null || productId === '' ? null : (await product(ctx.storeId, productId)).id
      return registerOriginal(ctx, new Uint8Array(await file.arrayBuffer()), { productId: linked, origin: 'panel' })
    },

    /** Toma una foto que el producto ya tiene en el catálogo, sin volver a subirla. */
    async importProductImage(ctx: CreativeContext, productId: unknown, imageUrl?: unknown) {
      const target = await product(ctx.storeId, productId)
      const url = typeof imageUrl === 'string' && imageUrl ? imageUrl : target.images[0]
      if (!url) throw new CreativeError('PRODUCT_WITHOUT_PHOTO', 'Ese producto no tiene fotos', 409)
      if (!target.images.includes(url)) throw new CreativeError('PHOTO_NOT_IN_PRODUCT', 'Esa foto no pertenece al producto')
      const path = url.startsWith('http') ? (() => { try { return new URL(url).pathname } catch { return '' } })() : url
      if (!path.startsWith('/api/assets/')) throw new CreativeError('EXTERNAL_IMAGE', 'Esa foto está alojada fuera de la tienda. Súbela para poder mejorarla.', 409)
      const key = path.slice('/api/assets/'.length).split(/[?#]/, 1)[0] || ''
      if (!assetUrlBelongsToStore(path, ctx.storeId) || /^(creative-private|trials|order-docs|telegram-drafts)\//.test(key)) throw new CreativeError('ASSET_NOT_OWNED', 'La foto no pertenece a esta tienda')
      const object = await storage().get(key)
      if (!object) throw new CreativeError('PHOTO_NOT_FOUND', 'No encontré la foto', 404)
      return registerOriginal(ctx, new Uint8Array(await object.arrayBuffer()), { productId: target.id, origin: 'producto' })
    },

    /** Toma la foto de un borrador (o producto ya publicado) de la importación masiva de Telegram. */
    async importTelegramItem(ctx: CreativeContext, batchId: unknown, itemId: unknown) {
      const item = Number(itemId)
      if (typeof batchId !== 'string' || !/^[\w-]{8,64}$/.test(batchId) || !Number.isSafeInteger(item) || item <= 0) throw new CreativeError('TELEGRAM_ITEM_NOT_FOUND', 'Foto de Telegram no encontrada', 404)
      const row = await db.prepare('SELECT status, product_id FROM telegram_product_batch_items WHERE id = ? AND batch_id = ? AND store_id = ?').bind(item, batchId, ctx.storeId).first<{ status: string; product_id: number | null }>()
      const photo = row && row.status !== 'ignored' ? await getTelegramBatchPhoto(db, storage(), ctx.storeId, batchId, item) : null
      if (!row || !photo) throw new CreativeError('TELEGRAM_ITEM_NOT_FOUND', 'Foto de Telegram no encontrada', 404)
      return registerOriginal(ctx, new Uint8Array(await photo.arrayBuffer()), { productId: row.product_id, origin: 'telegram', originRef: `telegram:${batchId}:${item}` })
    },

    /** Guarda un resultado (IA o edición convencional) pendiente de revisión. No toca el original. */
    async saveResult(ctx: CreativeContext, input: { sourceId: string; bytes: Uint8Array; level: 'A' | 'B' | 'C'; operation: string; model: string | null; credits: number; costMicros: number; jobId: string | null; origin: 'ia' | 'navegador' }) {
      const source = await need(ctx.storeId, input.sourceId)
      if (source.role !== 'original') throw new CreativeError('INVALID_SOURCE', 'El resultado debe partir de una foto original')
      const { type, dimensions } = inspect(input.bytes)
      const id = crypto.randomUUID()
      const key = privateKey(ctx.storeId, 'results', id, type)
      await storage().put(key, input.bytes, { httpMetadata: { contentType: type }, customMetadata: { storeId: String(ctx.storeId), assetId: id } })
      await db.prepare(
        `INSERT INTO creative_assets (id, store_id, product_id, role, status, r2_key, content_type, byte_size, width, height, sha256, level, operation, model, credits, cost_micros, source_asset_id, job_id, origin, origin_ref, created_by)
         VALUES (?, ?, ?, 'resultado', 'pendiente', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(id, ctx.storeId, source.product_id, key, type, input.bytes.length, dimensions?.width ?? null, dimensions?.height ?? null, await sha256Hex(input.bytes),
        input.level, input.operation.slice(0, 60), input.model, input.credits, input.costMicros, source.id, input.jobId, input.origin, source.origin_ref, ctx.actor.slice(0, 160)).run()
      return toAsset((await find(ctx.storeId, id))!)
    },

    async get(ctx: CreativeContext, id: unknown) {
      const row = await find(ctx.storeId, id)
      return row ? toAsset(row) : null
    },

    async list(ctx: CreativeContext, filter: { role?: string; status?: string; productId?: number; sourceId?: string; limit?: number; before?: string } = {}) {
      const where = ['a.store_id = ?']
      const binds: unknown[] = [ctx.storeId]
      if (filter.role === 'original' || filter.role === 'resultado') { where.push('a.role = ?'); binds.push(filter.role) }
      if (filter.status && ['activo', 'pendiente', 'aprobado', 'descartado'].includes(filter.status)) { where.push('a.status = ?'); binds.push(filter.status) }
      else where.push(`a.status <> 'descartado'`)
      if (filter.productId && Number.isSafeInteger(filter.productId)) { where.push('a.product_id = ?'); binds.push(filter.productId) }
      if (validId(filter.sourceId)) { where.push('a.source_asset_id = ?'); binds.push(filter.sourceId) }
      if (filter.before && /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(filter.before)) { where.push('a.created_at < ?'); binds.push(filter.before) }
      const limit = Math.min(Math.max(1, Number(filter.limit) || 60), 100)
      const { results } = await db.prepare(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY a.created_at DESC, a.id LIMIT ?`).bind(...binds, limit).all<Row>()
      return (results || []).map(toAsset)
    },

    /** Archivo privado; solo se entrega a la tienda dueña (la ruta ya verificó sesión y permiso). */
    async readFile(ctx: CreativeContext, id: unknown) {
      const row = await need(ctx.storeId, id)
      const object = row.r2_key ? await storage().get(row.r2_key) : null
      if (!object) throw new CreativeError('ASSET_NOT_FOUND', 'Recurso no encontrado', 404)
      return { body: object.body, contentType: row.content_type, bytes: row.byte_size }
    },

    async readBytes(storeId: number, id: string): Promise<{ bytes: Uint8Array; contentType: ImageType; row: CreativeAsset } | null> {
      const row = await find(storeId, id)
      const object = row?.r2_key ? await storage().get(row.r2_key) : null
      return row && object ? { bytes: new Uint8Array(await object.arrayBuffer()), contentType: row.content_type, row: toAsset(row) } : null
    },

    /** Aprueba un resultado: lo publica en el espacio de la tienda y, si se pide, lo asocia al catálogo.
     * `attach`: 'principal' (primera foto), 'agregar' (foto adicional) o sin asociar (queda en la biblioteca). */
    async approve(ctx: CreativeContext, id: unknown, options: { attach?: unknown; productId?: unknown } = {}) {
      const row = await need(ctx.storeId, id)
      if (row.role !== 'resultado') throw new CreativeError('NOT_A_RESULT', 'Solo se aprueban resultados', 409)
      if (row.status === 'descartado') throw new CreativeError('ASSET_DISCARDED', 'Este resultado fue descartado', 409)
      const attach = options.attach === 'principal' || options.attach === 'agregar' ? options.attach : null
      let publicUrl = row.public_url
      if (!publicUrl) {
        const object = row.r2_key ? await storage().get(row.r2_key) : null
        if (!object) throw new CreativeError('ASSET_NOT_FOUND', 'Recurso no encontrado', 404)
        const publicKey = `stores/${ctx.storeId}/products/estudio-${row.id}.${IMAGE_EXTENSION[row.content_type]}`
        await storage().put(publicKey, await object.arrayBuffer(), { httpMetadata: { contentType: row.content_type }, customMetadata: { storeId: String(ctx.storeId), assetId: row.id } })
        publicUrl = `/api/assets/${publicKey}`
        await db.prepare(`UPDATE creative_assets SET status = 'aprobado', public_url = ?, updated_at = datetime('now') WHERE id = ? AND store_id = ?`).bind(publicUrl, row.id, ctx.storeId).run()
        await audit(db, ctx, 'creative_asset_approved', row.id, { operation: row.operation })
      }
      let attached: { productId: number; mode: AttachMode } | { telegramDraft: true } | null = null
      if (attach) {
        const productId = options.productId ?? row.product_id
        const draft = !productId && row.origin_ref?.match(/^telegram:([\w-]+):(\d+)$/)
        if (draft) {
          await replaceTelegramDraftPhoto(db, storage(), ctx.storeId, draft[1]!, Number(draft[2]), row)
          attached = { telegramDraft: true }
        } else {
          if (!productId) throw new CreativeError('PRODUCT_REQUIRED', 'Elige el producto al que quieres asociar la foto')
          const target = await addProductImage(ctx, Number(productId), publicUrl, attach)
          await db.prepare(`UPDATE creative_assets SET product_id = ?, updated_at = datetime('now') WHERE id = ? AND store_id = ?`).bind(target.id, row.id, ctx.storeId).run()
          attached = { productId: target.id, mode: attach }
        }
        await audit(db, ctx, 'creative_asset_attached', row.id, attached)
      }
      return { asset: toAsset((await find(ctx.storeId, row.id))!), attached }
    },

    /** Descarta un resultado pendiente y borra su archivo. El original se conserva siempre. */
    async discard(ctx: CreativeContext, id: unknown) {
      const row = await need(ctx.storeId, id)
      if (row.role !== 'resultado') throw new CreativeError('ORIGINAL_PROTECTED', 'Los originales no se descartan desde aquí', 409)
      if (row.status !== 'pendiente') throw new CreativeError('NOT_PENDING', 'Solo se descartan resultados pendientes de revisión', 409)
      const updated = await db.prepare(`UPDATE creative_assets SET status = 'descartado', r2_key = NULL, updated_at = datetime('now') WHERE id = ? AND store_id = ? AND status = 'pendiente'`).bind(row.id, ctx.storeId).run()
      if (updated.meta?.changes && row.r2_key) await storage().delete(row.r2_key).catch(() => undefined)
      await audit(db, ctx, 'creative_asset_discarded', row.id, { operation: row.operation })
      return toAsset((await find(ctx.storeId, row.id))!)
    },
  }
}

/** Sustituye la foto temporal de un borrador de Telegram por el resultado aprobado. El original ya está
 * guardado en la biblioteca, así que se puede recuperar. Solo aplica mientras el borrador no se publique. */
async function replaceTelegramDraftPhoto(db: D1Database, bucket: R2Bucket, storeId: number, batchId: string, itemId: number, result: Row) {
  const item = await db.prepare(`SELECT temp_key, status, product_id FROM telegram_product_batch_items WHERE id = ? AND batch_id = ? AND store_id = ?`).bind(itemId, batchId, storeId).first<{ temp_key: string; status: string; product_id: number | null }>()
  if (!item || item.product_id || !['needs_review', 'ready_to_publish', 'failed'].includes(item.status)) throw new CreativeError('TELEGRAM_DRAFT_CLOSED', 'Ese borrador de Telegram ya no se puede cambiar', 409)
  const object = result.r2_key ? await bucket.get(result.r2_key) : null
  if (!object) throw new CreativeError('ASSET_NOT_FOUND', 'Recurso no encontrado', 404)
  const bytes = await object.arrayBuffer()
  const extension = IMAGE_EXTENSION[result.content_type]
  const newKey = `${item.temp_key.replace(/\.[a-z]+$/, '')}-estudio-${result.id.slice(0, 8)}.${extension}`
  await bucket.put(newKey, bytes, { httpMetadata: { contentType: result.content_type }, customMetadata: { operationId: batchId, storeId: String(storeId) } })
  const updated = await db.prepare(
    `UPDATE telegram_product_batch_items SET temp_key = ?, content_type = ?, extension = ?, byte_length = ?, updated_at = datetime('now')
     WHERE id = ? AND batch_id = ? AND store_id = ? AND product_id IS NULL AND status IN ('needs_review', 'ready_to_publish', 'failed')`,
  ).bind(newKey, result.content_type, extension, bytes.byteLength, itemId, batchId, storeId).run()
  if (!updated.meta?.changes) { await bucket.delete(newKey).catch(() => undefined); throw new CreativeError('TELEGRAM_DRAFT_CLOSED', 'Ese borrador de Telegram ya no se puede cambiar', 409) }
  if (item.temp_key !== newKey) await bucket.delete(item.temp_key).catch(() => undefined)
}
