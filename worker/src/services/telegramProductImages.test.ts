import { describe, expect, it, vi } from 'vitest'
import { cleanupExpiredTelegramProductAssets, downloadTelegramImage, inspectRasterImage, storeTelegramDraftImage } from './telegramProductImages'

describe('Telegram image safety validation', () => {
  it('accepts a structurally valid PNG within dimensions', async () => {
    const image = await makePng(128, 128)
    expect(inspectRasterImage(image)).toEqual({ contentType: 'image/png', extension: 'png', width: 128, height: 128 })
  })

  it('accepts a JPEG whose EOI marker is the final two bytes', () => {
    const jpeg = new Uint8Array([
      0xff, 0xd8,
      0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x80, 0x00, 0x80, 0x01, 0x01, 0x11, 0x00,
      0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00,
      0x00, 0x00, 0x00, 0xff, 0xd9,
    ])
    expect(inspectRasterImage(jpeg)).toEqual({ contentType: 'image/jpeg', extension: 'jpg', width: 128, height: 128 })
  })

  it('rejects small, oversized, malformed, animated, and non-raster content', async () => {
    const small = await makePng(64, 64)
    const large = await makePng(10001, 128)
    expect(() => inspectRasterImage(small)).toThrow()
    expect(() => inspectRasterImage(large)).toThrow()
    expect(() => inspectRasterImage(new TextEncoder().encode('<svg><script/></svg>'))).toThrow('TELEGRAM_IMAGE_FORMAT_UNSUPPORTED')
    const png = await makePng(128, 128)
    const corrupted = png.slice()
    const lastCrcByte = corrupted.length - 9
    corrupted[lastCrcByte] = (corrupted[lastCrcByte] || 0) ^ 0x01
    expect(() => inspectRasterImage(corrupted)).toThrow('TELEGRAM_IMAGE_MALFORMED')
  })

  it('sanitizes getFile failures and never includes the token in thrown errors', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => new Response('not available', { status: 500 })
    try {
      const error = await downloadTelegramImage('secret-bot-token', 'file-id').catch((value: Error) => value)
      expect(error).toBeInstanceOf(Error)
      if (error instanceof Error) {
        expect(error.message).toBe('TELEGRAM_GET_FILE_FAILED')
        expect(error.message).not.toContain('secret-bot-token')
      }
    } catch (error) { throw error }
    finally { globalThis.fetch = originalFetch }
  })

  it('downloads the actual Telegram image and stores only a validated temporary R2 object', async () => {
    const png = await makePng(128, 128)
    const originalFetch = globalThis.fetch
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, result: { file_path: 'photos/demo.png', file_size: png.length } })))
      .mockResolvedValueOnce(new Response(png, { headers: { 'content-type': 'application/octet-stream' } }))
    globalThis.fetch = fetcher as typeof fetch
    const bucket = makeBucket()
    try {
      const image = await downloadTelegramImage('secret-bot-token', 'telegram-file-id')
      const stored = await storeTelegramDraftImage(bucket as unknown as R2Bucket, '7f7c48a1-c723-4ef8-a9d1-2bc48c9c771a', image, 'telegram-file-id')
      expect(fetcher).toHaveBeenCalledTimes(2)
      expect(stored.contentType).toBe('image/png')
      expect(stored.tempKey).toMatch(/^telegram-drafts\/7f7c48a1-c723-4ef8-a9d1-2bc48c9c771a\//)
      expect(bucket.objects.has(stored.tempKey)).toBe(true)
      const httpMetadata = bucket.options.get(stored.tempKey)?.httpMetadata
      const cacheControl = httpMetadata instanceof Headers ? httpMetadata.get('cache-control') : httpMetadata?.cacheControl
      expect(cacheControl).toContain('private')
    } finally { globalThis.fetch = originalFetch }
  })

  it('cleans expired or orphaned draft assets and preserves pending and published assets', async () => {
    const now = Date.now()
    const activeId = '11111111-1111-4111-8111-111111111111'
    const appliedId = '22222222-2222-4222-8222-222222222222'
    const expiredId = '33333333-3333-4333-8333-333333333333'
    const orphanId = '44444444-4444-4444-8444-444444444444'
    const activeTemp = `telegram-drafts/${activeId}/keep.png`
    const rows = [
      { operation_id: activeId, status: 'pending', params_json: JSON.stringify({ images: [{ tempKey: activeTemp }] }), expires_at: Math.floor(now / 1000) + 3600 },
      { operation_id: appliedId, status: 'applied', params_json: '{}', expires_at: Math.floor(now / 1000) - 1 },
      { operation_id: expiredId, status: 'expired', params_json: '{}', expires_at: Math.floor(now / 1000) - 1 },
    ]
    const objects = [
      { key: activeTemp, uploaded: new Date(now) },
      { key: `telegram-drafts/${activeId}/orphan.png`, uploaded: new Date(now - 2 * 60 * 60 * 1000) },
      { key: `telegram-drafts/${expiredId}/old.png`, uploaded: new Date(now) },
      { key: `telegram-drafts/${orphanId}/old.png`, uploaded: new Date(now) },
      { key: `products/telegram/${appliedId}/1.png`, uploaded: new Date(now) },
      { key: `products/telegram/${activeId}/partial.png`, uploaded: new Date(now - 2 * 60 * 60 * 1000) },
      { key: `products/telegram/${activeId}/recent-partial.png`, uploaded: new Date(now) },
      { key: `products/telegram/${expiredId}/partial.png`, uploaded: new Date(now) },
    ]
    const deleted: string[] = []
    const db = {
      prepare: (sql: string) => sql.startsWith('UPDATE')
        ? { run: async () => ({ success: true }) }
        : { all: async () => ({ results: rows }) },
    } as unknown as D1Database
    const bucket = {
      list: async ({ prefix }: { prefix: string }) => ({
        objects: objects.filter((object) => object.key.startsWith(prefix)),
        truncated: false,
      }),
      delete: async (key: string) => { deleted.push(key) },
    } as unknown as R2Bucket

    await cleanupExpiredTelegramProductAssets(db, bucket)

    expect(deleted).toEqual(expect.arrayContaining([
      `telegram-drafts/${activeId}/orphan.png`,
      `telegram-drafts/${expiredId}/old.png`,
      `telegram-drafts/${orphanId}/old.png`,
      `products/telegram/${activeId}/partial.png`,
      `products/telegram/${expiredId}/partial.png`,
    ]))
    expect(deleted).not.toContain(activeTemp)
    expect(deleted).not.toContain(`products/telegram/${appliedId}/1.png`)
    expect(deleted).not.toContain(`products/telegram/${activeId}/recent-partial.png`)
  })
})

async function makePng(width: number, height: number): Promise<Uint8Array> {
  const raw = new Uint8Array(height * (width * 4 + 1))
  const compressed = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer())
  const chunks = [pngChunk('IHDR', concat(u32(width), u32(height), new Uint8Array([8, 6, 0, 0, 0]))), pngChunk('IDAT', compressed), pngChunk('IEND', new Uint8Array())]
  return concat(new Uint8Array([137,80,78,71,13,10,26,10]), ...chunks)
}

function makeBucket() {
  const objects = new Map<string, Uint8Array>()
  const options = new Map<string, R2PutOptions>()
  return {
    objects, options,
    async put(key: string, value: ArrayBuffer | ArrayBufferView | ReadableStream, metadata?: R2PutOptions) {
      const bytes = value instanceof ReadableStream ? new Uint8Array(await new Response(value).arrayBuffer())
        : value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
      objects.set(key, bytes.slice())
      if (metadata) options.set(key, metadata)
    },
  }
}

function pngChunk(name: string, body: Uint8Array): Uint8Array {
  const type = new TextEncoder().encode(name)
  return concat(u32(body.length), type, body, u32(crc32(concat(type, body))))
}
function u32(value: number): Uint8Array { return new Uint8Array([value >>> 24, value >>> 16, value >>> 8, value]) }
function concat(...items: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(items.reduce((total, item) => total + item.length, 0))
  let offset = 0
  for (const item of items) { result.set(item, offset); offset += item.length }
  return result
}
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}
