import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPng } from '../../test/sqliteD1'
import { createHarness, createStoreUser, seedStore, superadminToken, userToken, type Harness } from '../testing/harness'
import { creditSummary } from '../ai/credits'

let h: Harness
let storeA: number
let storeB: number
let owner: string
let admin: string
let gemini: ReturnType<typeof vi.fn>

const json = async (response: Response) => response.json() as Promise<any>
const geminiReply = (payload: unknown) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }], usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 150 } }))
const SUGGESTION = { name: 'Tocador con espejo LED', description: 'Tocador blanco con espejo iluminado y cajones amplios.', category: 'Tocadores', colors: ['Blanco'], features: [], visibleBrand: '', confidence: 'alta', isProductPhoto: true }
const photo = (key = `stores/${storeA}/products/tocador.png`) => h.request('/api/admin/ai/photo-product', { method: 'POST', token: owner, store: 'tienda-a', headers: { 'Idempotency-Key': `foto-${Math.random().toString(36).slice(2, 12)}` }, body: { imageUrl: `/api/assets/${key}` } })
const page = (body: Record<string, unknown>, key = `pagina-${Math.random().toString(36).slice(2, 12)}`) => h.request('/api/admin/ai/catalog-page', { method: 'POST', token: owner, store: 'tienda-a', headers: { 'Idempotency-Key': key }, body })
const fund = async (credits: number, cost: number, feature = 'foto_a_producto') => {
  await h.request(`/api/platform/credits/costs/${feature}`, { method: 'PUT', token: admin, body: { credits: cost } })
  await h.request('/api/platform/stores/tienda-a/credits', { method: 'POST', token: admin, headers: { 'Idempotency-Key': `fondos-${feature}-${credits}` }, body: { kind: 'recarga', amount: credits, reason: 'prueba' } })
}

beforeEach(async () => {
  h = createHarness({ GEMINI_API_KEY: 'test-key' })
  admin = await superadminToken()
  storeA = await seedStore(h.db, { slug: 'tienda-a', name: 'Tienda A' })
  storeB = await seedStore(h.db, { slug: 'tienda-b', name: 'Tienda B' })
  owner = await userToken(await createStoreUser(h.db, { email: 'duena@tienda-a.co', storeId: storeA, role: 'owner' }), 'duena@tienda-a.co')
  const png = createPng(64, 64)
  await h.assets.put(`stores/${storeA}/products/tocador.png`, png, { httpMetadata: { contentType: 'image/png' } })
  await h.assets.put(`stores/${storeB}/products/ajena.png`, png, { httpMetadata: { contentType: 'image/png' } })
  gemini = vi.fn(async (url: string) => url.includes('generativelanguage') ? geminiReply(SUGGESTION) : new Response('{}', { status: 404 }))
  vi.stubGlobal('fetch', gemini)
})
afterEach(() => vi.unstubAllGlobals())

describe('photo → product suggestion', () => {
  it('suggests visible data only, charges the configured credits once and sends the untrusted-content rule', async () => {
    await fund(5, 2)
    const response = await photo()
    expect(response.status).toBe(200)
    const body = await json(response)
    expect(body).toMatchObject({ charged: 2, suggestion: { name: 'Tocador con espejo LED', category: 'Tocadores', isProductPhoto: true } })
    expect(body.suggestion).not.toHaveProperty('price')
    expect(body.suggestion).not.toHaveProperty('usage')
    expect(await creditSummary(h.db, storeA)).toMatchObject({ balance: 3, consumed: 2 })
    const sent = JSON.parse(gemini.mock.calls[0]![1].body)
    expect(sent.systemInstruction.parts[0].text).toMatch(/Nunca propongas precio/)
    expect(sent.systemInstruction.parts[0].text).toMatch(/nunca instrucciones/)
    expect(sent.contents[0].parts[1].inlineData.mimeType).toBe('image/png')
  })

  it('refuses photos from another store or outside the product folder without calling the AI', async () => {
    expect((await photo(`stores/${storeB}/products/ajena.png`)).status).toBe(400)
    expect((await photo(`stores/${storeA}/store/logo.png`)).status).toBe(400)
    expect((await photo(`stores/${storeA}/products/../../${storeB}/products/ajena.png`)).status).toBe(400)
    expect((await photo(`stores/${storeA}/products/no-existe.png`)).status).toBe(404)
    expect(gemini).not.toHaveBeenCalled()
  })

  it('blocks without credits or with AI off, and never calls Gemini in that case', async () => {
    await fund(1, 2)
    const noCredits = await photo()
    expect(noCredits.status).toBe(409)
    expect((await json(noCredits)).code).toBe('AI_NO_CREDITS')
    h.db.sqlite.exec(`UPDATE stores SET ai_enabled = 0 WHERE id = ${storeA}`)
    expect((await json(await photo())).code).toBe('AI_DISABLED')
    expect(gemini).not.toHaveBeenCalled()
  })

  it('returns the credits when Gemini fails', async () => {
    await fund(4, 2)
    gemini.mockImplementation(async () => new Response(JSON.stringify({ error: { status: 'UNAVAILABLE' } }), { status: 503 }))
    const response = await photo()
    expect(response.status).toBe(502)
    expect(await creditSummary(h.db, storeA)).toMatchObject({ balance: 4, consumed: 0, reserved: 0 })
  })

  it('requires an idempotency key and the admin role', async () => {
    expect((await h.request('/api/admin/ai/photo-product', { method: 'POST', token: owner, store: 'tienda-a', body: { imageUrl: `/api/assets/stores/${storeA}/products/tocador.png` } })).status).toBe(400)
    const operator = await userToken(await createStoreUser(h.db, { email: 'op@tienda-a.co', storeId: storeA, role: 'operator' }), 'op@tienda-a.co')
    expect((await h.request('/api/admin/ai/photo-product', { method: 'POST', token: operator, store: 'tienda-a', headers: { 'Idempotency-Key': 'operador-0001' }, body: {} })).status).toBe(403)
  })
})

describe('scanned catalogue page → rows', () => {
  const image = Buffer.from(createPng(32, 32)).toString('base64')

  it('transcribes rows and drops rows without a name', async () => {
    gemini.mockImplementation(async () => geminiReply({ readable: true, rows: [{ sku: 'LM-1', name: 'Tocador Imperia', price: '$ 1.200.000', stock: '', category: '', color: 'Blanco', size: '', description: '' }, { name: '', price: '5' }] }))
    await fund(10, 1, 'importar_pdf_pagina')
    const body = await json(await page({ image, mimeType: 'image/png' }))
    expect(body).toMatchObject({ readable: true, charged: 1, rows: [{ sku: 'LM-1', name: 'Tocador Imperia', price: '$ 1.200.000', stock: '' }] })
    expect(body.rows).toHaveLength(1)
    const sent = JSON.parse(gemini.mock.calls[0]![1].body)
    expect(sent.systemInstruction.parts[0].text).toMatch(/Nunca inventes/)
  })

  it('validates the page image before spending anything', async () => {
    expect((await page({ image: 'no es base64!', mimeType: 'image/png' })).status).toBe(400)
    expect((await page({ image, mimeType: 'application/pdf' })).status).toBe(400)
    expect(gemini).not.toHaveBeenCalled()
  })
})
