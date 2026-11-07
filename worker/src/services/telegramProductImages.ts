const TELEGRAM_API_BASE = 'https://api.telegram.org'
export const TELEGRAM_IMAGE_DOWNLOAD_LIMIT = 20 * 1024 * 1024
const MAX_DIMENSION = 10_000
const MAX_PIXELS = 40_000_000

export type ValidatedTelegramImage = {
  bytes: Uint8Array
  contentType: 'image/jpeg' | 'image/png' | 'image/webp'
  extension: 'jpg' | 'png' | 'webp'
  width: number
  height: number
}

export async function downloadTelegramImage(botToken: string, fileId: string): Promise<ValidatedTelegramImage> {
  let fileInfo: { ok?: boolean; result?: { file_path?: string; file_size?: number } }
  try {
    const response = await fetch(`${TELEGRAM_API_BASE}/bot${botToken}/getFile?file_id=${encodeURIComponent(fileId)}`, { signal: AbortSignal.timeout(15_000) })
    if (!response.ok) throw new Error('Telegram getFile failed')
    fileInfo = await response.json() as typeof fileInfo
  } catch {
    throw new Error('TELEGRAM_GET_FILE_FAILED')
  }
  const path = fileInfo.result?.file_path
  const declaredSize = fileInfo.result?.file_size
  if (!fileInfo.ok || !path || !isSafeTelegramPath(path)) throw new Error('TELEGRAM_FILE_METADATA_INVALID')
  if (declaredSize !== undefined && (!Number.isSafeInteger(declaredSize) || declaredSize <= 0 || declaredSize > TELEGRAM_IMAGE_DOWNLOAD_LIMIT)) {
    throw new Error('TELEGRAM_IMAGE_TOO_LARGE')
  }

  const encodedPath = path.split('/').map(encodeURIComponent).join('/')
  let response: Response
  try {
    response = await fetch(`${TELEGRAM_API_BASE}/file/bot${botToken}/${encodedPath}`, { signal: AbortSignal.timeout(30_000) })
  } catch {
    throw new Error('TELEGRAM_FILE_DOWNLOAD_FAILED')
  }
  if (!response.ok || !response.body) throw new Error('TELEGRAM_FILE_DOWNLOAD_FAILED')
  const contentLength = Number(response.headers.get('content-length') || 0)
  if (contentLength > TELEGRAM_IMAGE_DOWNLOAD_LIMIT) throw new Error('TELEGRAM_IMAGE_TOO_LARGE')
  const bytes = await readBounded(response.body, TELEGRAM_IMAGE_DOWNLOAD_LIMIT)
  const metadata = inspectRasterImage(bytes)
  return { bytes, ...metadata }
}

export function inspectRasterImage(bytes: Uint8Array): Omit<ValidatedTelegramImage, 'bytes'> {
  const metadata = sniffImage(bytes)
  if (metadata.width < 128 || metadata.height < 128 || metadata.width > MAX_DIMENSION || metadata.height > MAX_DIMENSION || metadata.width * metadata.height > MAX_PIXELS) {
    throw new Error('TELEGRAM_IMAGE_DIMENSIONS_INVALID')
  }
  if (Math.max(metadata.width / metadata.height, metadata.height / metadata.width) > 20) throw new Error('TELEGRAM_IMAGE_ASPECT_INVALID')
  return metadata
}

export async function storeTelegramDraftImage(
  bucket: R2Bucket,
  operationId: string,
  image: ValidatedTelegramImage,
  telegramFileId: string,
): Promise<{ tempKey: string; telegramFileId: string; contentType: ValidatedTelegramImage['contentType']; extension: ValidatedTelegramImage['extension']; byteLength: number; width: number; height: number }> {
  if (!/^[0-9a-f-]{36}$/i.test(operationId)) throw new Error('INVALID_DRAFT_ID')
  const tempKey = `telegram-drafts/${operationId}/${crypto.randomUUID()}.${image.extension}`
  await bucket.put(tempKey, image.bytes, {
    httpMetadata: { contentType: image.contentType, cacheControl: 'private, no-store' },
    customMetadata: { operationId, purpose: 'telegram-product-draft', uploadedAt: new Date().toISOString() },
  })
  return { tempKey, telegramFileId, contentType: image.contentType, extension: image.extension, byteLength: image.bytes.byteLength, width: image.width, height: image.height }
}

/** Public key prefix for products published from Telegram, scoped by store. */
export function telegramProductPrefix(storeId: number, operationId: string): string {
  return `stores/${storeId}/products/telegram/${operationId}/`
}

export async function promoteTelegramDraftImages(
  bucket: R2Bucket,
  operationId: string,
  images: Array<{ tempKey: string; contentType: string; extension: string }>,
  storeId: number,
): Promise<{ keys: string[]; imageUrls: string[] }> {
  const keys: string[] = []
  try {
    for (const [index, image] of images.entries()) {
      if (!image.tempKey.startsWith(`telegram-drafts/${operationId}/`)) throw new Error('INVALID_DRAFT_IMAGE_KEY')
      const expectedType: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }
      if (expectedType[image.extension] !== image.contentType) throw new Error('INVALID_DRAFT_IMAGE_TYPE')
      const object = await bucket.get(image.tempKey)
      if (!object || object.customMetadata?.operationId !== operationId) throw new Error('DRAFT_IMAGE_NOT_AVAILABLE')
      const key = `${telegramProductPrefix(storeId, operationId)}${index + 1}.${image.extension}`
      await bucket.put(key, object.body, {
        httpMetadata: { contentType: image.contentType, cacheControl: 'public, max-age=31536000, immutable' },
        customMetadata: { operationId, purpose: 'telegram-product-publish', storeId: String(storeId) },
      })
      keys.push(key)
    }
    return { keys, imageUrls: keys.map((key) => `/api/assets/${key}`) }
  } catch {
    await deleteExactKeys(bucket, keys)
    throw new Error('DRAFT_IMAGE_PROMOTION_FAILED')
  }
}

export async function deleteTelegramDraftImages(bucket: R2Bucket, operationId: string, storeId?: number): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(operationId)) return
  await deleteTelegramDraftTempImages(bucket, operationId)
  const prefixes = [`products/telegram/${operationId}/`, ...(storeId ? [telegramProductPrefix(storeId, operationId)] : [])]
  for (const prefix of prefixes) {
    let cursor: string | undefined
    do {
      const page = await bucket.list({ prefix, limit: 100, ...(cursor ? { cursor } : {}) })
      await deleteExactKeys(bucket, page.objects.map((object) => object.key))
      cursor = page.truncated ? page.cursor : undefined
    } while (cursor)
  }
}

export async function deleteTelegramDraftTempImages(bucket: R2Bucket, operationId: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(operationId)) return
  await cleanupPrefix(bucket, `telegram-drafts/${operationId}/`, () => true)
}

export async function cleanupExpiredTelegramProductAssets(db: D1Database, bucket: R2Bucket): Promise<void> {
  const draftActions = `('create_product', 'add_product_photos', 'update_store_banner', 'update_store_logo')`
  await db.prepare(
    `UPDATE telegram_operations SET status = 'expired', completed_at = datetime('now')
     WHERE action IN ${draftActions} AND status = 'pending' AND expires_at <= unixepoch()`,
  ).run()
  const result = await db.prepare(
    `SELECT operation_id, status, params_json, expires_at, store_id FROM telegram_operations WHERE action IN ${draftActions}`,
  ).all<{ operation_id: string; status: string; params_json: string; expires_at: number; store_id: number }>()
  const byId = new Map((result.results || []).map((row) => [row.operation_id, row]))
  const batchRows = await db.prepare('SELECT id, status FROM telegram_product_batches').all<{ id: string; status: string }>()
  const liveBatchIds = new Set((batchRows.results || []).filter((row) => ['receiving', 'analyzing', 'needs_review', 'ready_to_publish', 'publishing', 'partially_published'].includes(row.status)).map((row) => row.id))
  const publishedBatchRows = await db.prepare(
    `SELECT b.store_id, i.batch_id, i.id, i.extension FROM telegram_product_batch_items i JOIN telegram_product_batches b ON b.id = i.batch_id WHERE i.status = 'published'`,
  ).all<{ store_id: number; batch_id: string; id: number; extension: string }>()
  const publishedBatchAssets = new Set((publishedBatchRows.results || []).map((row) => `stores/${row.store_id}/products/telegram/${row.batch_id}/${row.id}.${row.extension}`))
  const referenced = new Set<string>()
  for (const row of result.results || []) {
    if (row.status !== 'pending' || Number(row.expires_at) <= Math.floor(Date.now() / 1000)) continue
    try {
      const draft = JSON.parse(row.params_json) as { images?: Array<{ tempKey?: string }>; draftKey?: string }
      for (const image of draft.images || []) if (typeof image.tempKey === 'string') referenced.add(image.tempKey)
      if (typeof draft.draftKey === 'string') referenced.add(draft.draftKey)
    } catch { /* malformed drafts become eligible after the grace period */ }
  }

  await cleanupPrefix(bucket, 'telegram-drafts/', (object) => {
    const operationId = object.key.split('/')[1]
    const row = operationId ? byId.get(operationId) : undefined
    const ageMs = Date.now() - object.uploaded.getTime()
    if (operationId && liveBatchIds.has(operationId)) return !referenced.has(object.key) && ageMs > 60 * 60 * 1000
    return row?.status === 'pending' && Number(row.expires_at) > Math.floor(Date.now() / 1000)
      ? !referenced.has(object.key) && ageMs > 60 * 60 * 1000
      : true
  })
  const sweepPublished = (operationIndex: number) => (object: R2Object) => {
    if (publishedBatchAssets.has(object.key)) return false
    const operationId = object.key.split('/')[operationIndex]
    const row = operationId ? byId.get(operationId) : undefined
    if (operationId && liveBatchIds.has(operationId)) return false
    if (row?.status === 'applied') return false
    return !row || row.status !== 'pending' || Date.now() - object.uploaded.getTime() > 60 * 60 * 1000
  }
  await cleanupPrefix(bucket, 'products/telegram/', sweepPublished(2))
  // stores/<id>/products/telegram/<operationId>/<n>.<ext>, only for stores with Telegram drafts.
  const storeIds = new Set((result.results || []).map((row) => Number(row.store_id || 1)))
  for (const storeId of storeIds) await cleanupPrefix(bucket, `stores/${storeId}/products/telegram/`, sweepPublished(4))
}

async function cleanupPrefix(bucket: R2Bucket, prefix: string, shouldDelete: (object: R2Object) => boolean): Promise<void> {
  let cursor: string | undefined
  do {
    const page = await bucket.list({ prefix, limit: 1000, ...(cursor ? { cursor } : {}) })
    for (const object of page.objects) if (shouldDelete(object)) await bucket.delete(object.key)
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
}

async function deleteExactKeys(bucket: R2Bucket, keys: string[]): Promise<void> {
  for (const key of keys) await bucket.delete(key)
}

async function readBounded(stream: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const result = await reader.read()
      if (result.done) break
      total += result.value.byteLength
      if (total > limit) {
        await reader.cancel()
        throw new Error('TELEGRAM_IMAGE_TOO_LARGE')
      }
      chunks.push(result.value)
    }
  } finally {
    reader.releaseLock()
  }
  if (!total) throw new Error('TELEGRAM_IMAGE_EMPTY')
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return bytes
}

function isSafeTelegramPath(path: string): boolean {
  return path.length <= 512 && !path.startsWith('/') && !path.split('/').some((part) => !part || part === '.' || part === '..') && /^[a-zA-Z0-9._/-]+$/.test(path)
}

function sniffImage(bytes: Uint8Array): Omit<ValidatedTelegramImage, 'bytes'> {
  if (bytes.length >= 24 && bytes[0] === 0x89 && ascii(bytes, 1, 3) === 'PNG' && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    if (ascii(bytes, 12, 4) !== 'IHDR' || readU32BE(bytes, 8) !== 13 || ascii(bytes, bytes.length - 8, 4) !== 'IEND') throw new Error('TELEGRAM_IMAGE_MALFORMED')
    validatePngChunks(bytes)
    return { contentType: 'image/png', extension: 'png', width: readU32BE(bytes, 16), height: readU32BE(bytes, 20) }
  }
  if (bytes.length >= 30 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    const dimensions = jpegDimensions(bytes)
    if (!dimensions) throw new Error('TELEGRAM_IMAGE_MALFORMED')
    return { contentType: 'image/jpeg', extension: 'jpg', ...dimensions }
  }
  if (bytes.length >= 30 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    const dimensions = webpDimensions(bytes)
    if (!dimensions) throw new Error('TELEGRAM_IMAGE_MALFORMED')
    return { contentType: 'image/webp', extension: 'webp', ...dimensions }
  }
  throw new Error('TELEGRAM_IMAGE_FORMAT_UNSUPPORTED')
}

function validatePngChunks(bytes: Uint8Array): void {
  let offset = 8
  let sawHeader = false
  let sawData = false
  let sawEnd = false
  let chunks = 0
  while (offset + 12 <= bytes.length) {
    if (++chunks > 10_000) throw new Error('TELEGRAM_IMAGE_MALFORMED')
    const length = readU32BE(bytes, offset)
    if (length > bytes.length - offset - 12) throw new Error('TELEGRAM_IMAGE_MALFORMED')
    const type = ascii(bytes, offset + 4, 4)
    if (!sawHeader && (type !== 'IHDR' || length !== 13)) throw new Error('TELEGRAM_IMAGE_MALFORMED')
    if (type === 'IHDR') {
      if (sawHeader) throw new Error('TELEGRAM_IMAGE_MALFORMED')
      sawHeader = true
      const width = readU32BE(bytes, offset + 8)
      const height = readU32BE(bytes, offset + 12)
      const bitDepth = bytes[offset + 16]!
      const colorType = bytes[offset + 17]!
      if (!width || !height || ![1,2,4,8,16].includes(bitDepth) || ![0,2,3,4,6].includes(colorType) || bytes[offset + 18] !== 0 || bytes[offset + 19] !== 0 || ![0,1].includes(bytes[offset + 20]!)) throw new Error('TELEGRAM_IMAGE_MALFORMED')
    }
    if (type === 'acTL' || type === 'fcTL' || type === 'fdAT') throw new Error('TELEGRAM_IMAGE_FORMAT_UNSUPPORTED')
    if (type === 'IDAT') sawData = true
    if (sawData && type === 'IHDR') throw new Error('TELEGRAM_IMAGE_MALFORMED')
    const expectedCrc = readU32BE(bytes, offset + 8 + length)
    if (crc32(bytes, offset + 4, length + 4) !== expectedCrc) throw new Error('TELEGRAM_IMAGE_MALFORMED')
    offset += 12 + length
    if (type === 'IEND') {
      if (length !== 0 || offset !== bytes.length || !sawData) throw new Error('TELEGRAM_IMAGE_MALFORMED')
      sawEnd = true
      break
    }
  }
  if (!sawHeader || !sawEnd) throw new Error('TELEGRAM_IMAGE_MALFORMED')
}

function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  let offset = 2
  let dimensions: { width: number; height: number } | null = null
  let sawScan = false
  let sawEnd = false
  // JPEG's EOI marker is only two bytes; requiring five bytes here rejects
  // ordinary files whose EOI marker is the final bytes in the stream.
  while (offset + 1 < bytes.length) {
    if (bytes[offset] !== 0xff) return null
    while (bytes[offset] === 0xff) offset++
    const marker = bytes[offset++]!
    if (marker === 0xd9) { sawEnd = offset === bytes.length; break }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 2 > bytes.length) return null
    const length = readU16BE(bytes, offset)
    if (length < 2 || offset + length > bytes.length) return null
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (length < 7 || dimensions) return null
      dimensions = { height: readU16BE(bytes, offset + 3), width: readU16BE(bytes, offset + 5) }
    }
    offset += length
    if (marker === 0xda) {
      sawScan = true
      while (offset + 1 < bytes.length) {
        if (bytes[offset] !== 0xff) { offset++; continue }
        const next = bytes[offset + 1]!
        if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) { offset += 2; continue }
        break
      }
    }
  }
  return sawEnd && sawScan ? dimensions : null
}

function webpDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (readU32LE(bytes, 4) !== bytes.length - 8) return null
  let offset = 12
  let dimensions: { width: number; height: number } | null = null
  let sawImageData = false
  while (offset + 8 <= bytes.length) {
    const type = ascii(bytes, offset, 4)
    const length = readU32LE(bytes, offset + 4)
    const start = offset + 8
    if (length > bytes.length - start || start + length + (length & 1) > bytes.length) return null
    if (type === 'ANIM' || type === 'ANMF') return null
    if (type === 'VP8X' && length >= 10) {
      if ((bytes[start]! & 0x02) !== 0 || dimensions) return null
      dimensions = { width: 1 + readU24LE(bytes, start + 4), height: 1 + readU24LE(bytes, start + 7) }
    }
    if (type === 'VP8 ' && length >= 10 && bytes[start + 3] === 0x9d && bytes[start + 4] === 0x01 && bytes[start + 5] === 0x2a) {
      if (sawImageData) return null
      dimensions ||= { width: readU16LE(bytes, start + 6) & 0x3fff, height: readU16LE(bytes, start + 8) & 0x3fff }
      sawImageData = true
    }
    if (type === 'VP8L' && length >= 5 && bytes[start] === 0x2f) {
      if (sawImageData) return null
      dimensions ||= {
        width: 1 + bytes[start + 1]! + ((bytes[start + 2]! & 0x3f) << 8),
        height: 1 + (bytes[start + 2]! >> 6) + (bytes[start + 3]! << 2) + ((bytes[start + 4]! & 0x0f) << 10),
      }
      sawImageData = true
    }
    offset = start + length + (length & 1)
  }
  return offset === bytes.length && sawImageData ? dimensions : null
}

function crc32(bytes: Uint8Array, offset: number, length: number): number {
  let crc = 0xffffffff
  for (let i = offset; i < offset + length; i++) {
    crc ^= bytes[i]!
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let value = ''
  for (let i = offset; i < offset + length; i++) value += String.fromCharCode(bytes[i] || 0)
  return value
}

function readU16BE(bytes: Uint8Array, offset: number): number { return ((bytes[offset] || 0) << 8) | (bytes[offset + 1] || 0) }
function readU16LE(bytes: Uint8Array, offset: number): number { return (bytes[offset] || 0) | ((bytes[offset + 1] || 0) << 8) }
function readU24LE(bytes: Uint8Array, offset: number): number { return (bytes[offset] || 0) | ((bytes[offset + 1] || 0) << 8) | ((bytes[offset + 2] || 0) << 16) }
function readU32BE(bytes: Uint8Array, offset: number): number { return (((bytes[offset] || 0) * 0x1000000) + ((bytes[offset + 1] || 0) << 16) + ((bytes[offset + 2] || 0) << 8) + (bytes[offset + 3] || 0)) >>> 0 }
function readU32LE(bytes: Uint8Array, offset: number): number { return (((bytes[offset] || 0) + ((bytes[offset + 1] || 0) << 8) + ((bytes[offset + 2] || 0) << 16) + ((bytes[offset + 3] || 0) * 0x1000000)) >>> 0) }
