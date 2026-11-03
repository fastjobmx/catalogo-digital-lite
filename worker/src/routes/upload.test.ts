import { describe, expect, it } from 'vitest'
import uploadRoutes from './upload'

describe('public assets route', () => {
  it('never serves temporary Telegram product draft images', async () => {
    const response = await uploadRoutes.request('/telegram-drafts/00000000-0000-0000-0000-000000000000/photo.png', {}, {
      DB: {} as D1Database,
      ASSETS: { get: async () => ({ body: new Uint8Array([1]), httpEtag: 'etag', writeHttpMetadata: () => undefined }) } as unknown as R2Bucket,
    })
    expect(response.status).toBe(404)
  })
})
