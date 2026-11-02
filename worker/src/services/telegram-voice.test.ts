import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadTelegramVoice, sendTelegramMessage } from './telegram'

afterEach(() => vi.unstubAllGlobals())

describe('Telegram voice file handling', () => {
  it('downloads only an OGG file path returned by the official Telegram API', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, result: { file_path: 'voice/clip.oga', file_size: 4 } })))
      .mockResolvedValueOnce(new Response(new Uint8Array([0x4f, 0x67, 0x67, 0x53]), { headers: { 'content-type': 'audio/ogg' } }))
    vi.stubGlobal('fetch', fetcher)

    const result = await downloadTelegramVoice('test-token', 'telegram-file-id')

    expect(result).toEqual({ mimeType: 'audio/ogg', data: 'T2dnUw==' })
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(String(fetcher.mock.calls[0]?.[0])).toMatch(/^https:\/\/api\.telegram\.org\/bottest-token\/getFile\?/)
    expect(String(fetcher.mock.calls[1]?.[0])).toMatch(/^https:\/\/api\.telegram\.org\/file\/bottest-token\/voice\/clip\.oga$/)
  })

  it('rejects unexpected file types before making a file download request', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, result: { file_path: 'voice/photo.jpg', file_size: 4 } })))
    vi.stubGlobal('fetch', fetcher)
    await expect(downloadTelegramVoice('test-token', 'id')).rejects.toThrow(/Invalid Telegram file metadata/)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('rejects oversized files before downloading them', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, result: { file_path: 'voice/clip.oga', file_size: 11 * 1024 * 1024 } })))
    vi.stubGlobal('fetch', fetcher)
    await expect(downloadTelegramVoice('test-token', 'id')).rejects.toThrow(/too large/i)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})

describe('Telegram API failure handling', () => {
  it('surfaces a send failure without retrying or mutating state', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: false, description: 'test upstream failure' }), { status: 502 }))
    vi.stubGlobal('fetch', fetcher)
    await expect(sendTelegramMessage('test-token', 123, 'test message')).rejects.toThrow(/Telegram API error: test upstream failure/)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
