import { describe, expect, it, vi } from 'vitest'
import { interpretWithGemini } from './gemini'

const env = { GEMINI_API_KEY: 'mock-key', GEMINI_MODEL: 'test-model' } as never
const response = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status })
const candidate = (text: string) => ({ candidates: [{ content: { parts: [{ text }] } }] })

describe('Gemini structured proposal validation', () => {
  it('sends the configured model and validates a mutation with the current action schema', async () => {
    const fetcher = vi.fn().mockResolvedValue(response(candidate(JSON.stringify({
      action: 'update_price', params: { sku: 'SH-1', price: 90000 }, missing: [], summary: 'Cambiar precio',
    }))))
    const result = await interpretWithGemini('Cambia el precio', env, fetcher)
    expect(fetcher.mock.calls[0]![0]).toContain('/models/test-model:generateContent')
    expect(result).toMatchObject({ action: 'update_price', needsConfirmation: true, params: { sku: 'SH-1', price: 90000 } })
    expect(fetcher.mock.calls[0]![1]?.headers).toMatchObject({ 'x-goog-api-key': 'mock-key' })
    const request = JSON.parse(String(fetcher.mock.calls[0]![1]?.body))
    expect(request.generationConfig.responseFormat.text.mimeType).toBe('APPLICATION_JSON')
    expect(request.generationConfig.responseFormat.text.schema.properties.params.properties.size.type).toBe('string')
    expect(request.generationConfig.responseFormat.text.schema.properties.params.properties.stock.type).toBe('integer')
  })

  it('turns invalid params into a clarification instead of an executable proposal', async () => {
    const fetcher = vi.fn().mockResolvedValue(response(candidate(JSON.stringify({
      action: 'update_price', params: { sku: 'SH-1', price: -1 }, missing: [], summary: 'Cambiar precio',
    }))))
    const result = await interpretWithGemini('Cambia el precio', env, fetcher)
    expect(result.action).toBe('ask')
    expect(result.needsConfirmation).toBe(false)
    expect(result.missing.length).toBeGreaterThan(0)
  })

  it('fills a missing stock size only from one explicit spoken talla', async () => {
    const fetcher = vi.fn().mockResolvedValue(response(candidate(JSON.stringify({
      action: 'update_stock', params: { sku: 'TEST-TRN-001', stock: 6 }, missing: [],
      summary: 'Cambiar stock', transcript: 'Propón cambiar el stock de TEST-TRN-001 talla 38 a 6 unidades.',
    }))))
    const result = await interpretWithGemini('audio de prueba', env, fetcher, { mimeType: 'audio/ogg', data: 'b2dn' })
    expect(result).toMatchObject({ action: 'update_stock', needsConfirmation: true, params: { sku: 'TEST-TRN-001', size: '38', stock: 6 } })
  })

  it('refuses an audio stock proposal when the interpreted size conflicts with its transcript', async () => {
    const fetcher = vi.fn().mockResolvedValue(response(candidate(JSON.stringify({
      action: 'update_stock', params: { sku: 'TEST-TRN-001', size: '39', stock: 6 }, missing: [],
      summary: 'Cambiar stock', transcript: 'Propón cambiar el stock de TEST-TRN-001 talla 38 a 6 unidades.',
    }))))
    const result = await interpretWithGemini('audio de prueba', env, fetcher, { mimeType: 'audio/ogg', data: 'b2dn' })
    expect(result.action).toBe('ask')
    expect(result.needsConfirmation).toBe(false)
    expect(result.missing).toContain('la talla transcrita y la interpretada no coinciden')
  })

  it('rejects generated SQL and malformed JSON', async () => {
    const sql = vi.fn().mockResolvedValue(response(candidate('{"action":"run_sql","params":{"sql":"DROP TABLE products"},"summary":"run"}')))
    await expect(interpretWithGemini('borra', env, sql)).rejects.toThrow(/schema/i)
    const malformed = vi.fn().mockResolvedValue(response(candidate('{oops')))
    await expect(interpretWithGemini('cambia', env, malformed)).rejects.toThrow(/malformed JSON/i)
  })

  it('maps quota and network failures without producing an action', async () => {
    const quota = vi.fn().mockResolvedValue(response({}, 429))
    await expect(interpretWithGemini('consulta', env, quota)).rejects.toThrow(/quota/i)
    const network = vi.fn().mockRejectedValue(new Error('network down'))
    await expect(interpretWithGemini('consulta', env, network)).rejects.toThrow(/network down/)
  })

  it('classifies structured-schema and model rejection responses without exposing provider details', async () => {
    const schema = vi.fn().mockResolvedValue(response({ error: { message: 'Invalid responseFormat schema' } }, 400))
    await expect(interpretWithGemini('consulta', env, schema)).rejects.toMatchObject({ category: 'structured_schema', status: 400 })
    const model = vi.fn().mockResolvedValue(response({ error: { message: 'Model not found' } }, 404))
    await expect(interpretWithGemini('consulta', env, model)).rejects.toMatchObject({ category: 'model', status: 404 })
  })
})
