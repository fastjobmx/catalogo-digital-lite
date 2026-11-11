import { describe, expect, it, vi } from 'vitest'
import { canSharePhotos, MAX_SHARED_PHOTOS, photoFileName, photoSources, sharePhotos } from './orderShare'

const jpeg = () => new File([new Uint8Array([0xff, 0xd8, 0xff])], '1-tenis.jpg', { type: 'image/jpeg' })

function fakeNavigator(options: { canShare?: boolean; share?: () => Promise<void> } = {}) {
  const writeText = vi.fn(async () => undefined)
  const share = vi.fn(options.share ?? (async () => undefined))
  const nav = { canShare: vi.fn(() => options.canShare ?? true), share, clipboard: { writeText } }
  return { nav: nav as unknown as Navigator, share, writeText }
}

describe('photo sharing', () => {
  it('is offered only where the browser can share image files', () => {
    expect(canSharePhotos(undefined)).toBe(false)
    expect(canSharePhotos({} as Navigator)).toBe(false)
    expect(canSharePhotos(fakeNavigator({ canShare: false }).nav)).toBe(false)
    expect(canSharePhotos(fakeNavigator({ canShare: true }).nav)).toBe(true)
  })

  it('keeps one real main photo per product, in order, without duplicates and with a cap', () => {
    const items = [
      { name: 'Tenis A', imageUrl: '/api/assets/a.jpg' },
      { name: 'Tenis A talla 41', imageUrl: '/api/assets/a.jpg' },
      { name: 'Sin foto', imageUrl: null },
      ...Array.from({ length: 8 }, (_, i) => ({ name: `P${i}`, imageUrl: `/api/assets/p${i}.webp` })),
    ]
    const sources = photoSources(items)
    expect(sources).toHaveLength(MAX_SHARED_PHOTOS)
    expect(sources[0]).toEqual({ name: 'Tenis A', url: '/api/assets/a.jpg' })
    expect(sources.map((s) => s.url)).not.toContain(null)
  })

  it('names files after the product', () => {
    expect(photoFileName('Tocador Imperia Ñandú', 0)).toBe('1-tocador-imperia-nandu.jpg')
    expect(photoFileName('***', 2)).toBe('3-producto.jpg')
  })

  it('shares files and text together and copies the text first (some apps drop it)', async () => {
    const { nav, share, writeText } = fakeNavigator()
    await expect(sharePhotos([jpeg()], 'Pedido PED-1', 'Pedido', nav)).resolves.toBe('shared')
    expect(writeText).toHaveBeenCalledWith('Pedido PED-1')
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ text: 'Pedido PED-1', files: [expect.any(File)] }))
  })

  it('reports a cancelled share sheet as cancelled, other errors as failed, and never shares without files', async () => {
    const abort = fakeNavigator({ share: async () => { throw new DOMException('cancel', 'AbortError') } })
    await expect(sharePhotos([jpeg()], 't', 'x', abort.nav)).resolves.toBe('cancelled')
    const denied = fakeNavigator({ share: async () => { throw new DOMException('no', 'NotAllowedError') } })
    await expect(sharePhotos([jpeg()], 't', 'x', denied.nav)).resolves.toBe('failed')
    const none = fakeNavigator()
    await expect(sharePhotos([], 't', 'x', none.nav)).resolves.toBe('unsupported')
    expect(none.share).not.toHaveBeenCalled()
  })
})
