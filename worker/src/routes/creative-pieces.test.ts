/** Estudio Creativo IA · fase 3: plantillas con datos verificados, textos, piezas (resolución, idempotencia,
 * reutilización, revisión, campañas), textos con IA filtrados y video generativo con créditos. La IA se simula. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPng } from '../../test/sqliteD1'
import { createHarness, createStoreUser, seedCatalog, seedStore, superadminToken, userToken, type Harness } from '../testing/harness'
import { creditSummary } from '../ai/credits'
import { processPendingVideoJobs, videoPrompt } from '../creative/videoEngine'
import { sniffVideoType } from '../creative/pieces'
import { defaultCopy, guardAiCopy, unsupportedClaim, type CreativeFacts } from '../creative/templates'

let h: Harness
let admin: string
let storeA: number
let storeB: number
let ownerA: string
let ownerB: string
let sellerA: string
let ids: Record<string, number>
let aiCalls: Array<{ url: string; body: any }>

const json = async (response: Response) => response.json() as Promise<any>
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
const MP4 = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0, 1, 2, 3, 4, 5, 6, 7, 8])
const A = (path: string, init: Parameters<Harness['request']>[1] = {}) => h.request(`/api/creative${path}`, { store: 'tienda-a', token: ownerA, ...init })
const B = (path: string, init: Parameters<Harness['request']>[1] = {}) => h.request(`/api/creative${path}`, { store: 'tienda-b', token: ownerB, ...init })
const setCost = (feature: string, credits: number, enabled = true) => h.request(`/api/platform/credits/costs/${feature}`, { method: 'PUT', token: admin, body: { credits, enabled } })
const recharge = (slug: string, amount: number) => h.request(`/api/platform/stores/${slug}/credits`, { method: 'POST', token: admin, headers: { 'Idempotency-Key': `recarga-${slug}-${amount}` }, body: { kind: 'recarga', amount, reason: 'Pago recibido' } })

function save(spec: Record<string, unknown>, files: Uint8Array[], key: string, send = A, type = 'image/png') {
  const form = new FormData()
  form.append('spec', JSON.stringify(spec))
  for (const [index, bytes] of files.entries()) form.append('file', new File([bytes], `pieza-${index}`, { type }))
  return send('/creatives', { method: 'POST', body: form, headers: { 'Idempotency-Key': key } })
}

/** Simula Gemini: textos (generateContent) y video (interactions). */
function stubAi(options: { copy?: Record<string, unknown>; video?: 'ok' | 'error' | 'empty' } = {}) {
  aiCalls = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (!url.includes('generativelanguage.googleapis.com')) throw new Error(`Unexpected fetch ${url}`)
    expect(new Headers(init?.headers).get('x-goog-api-key')).toBe('test-key')
    const body = JSON.parse(String(init?.body))
    aiCalls.push({ url, body })
    if (url.endsWith('/interactions')) {
      if (options.video === 'error') return new Response(JSON.stringify({ error: { status: 'UNAVAILABLE', message: 'overloaded' } }), { status: 503 })
      const content = options.video === 'empty' ? [{ type: 'text', text: 'no' }] : [{ type: 'video', mime_type: 'video/mp4', data: b64(MP4) }]
      return new Response(JSON.stringify({ status: 'completed', steps: [{ type: 'model_output', content }] }))
    }
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(options.copy ?? {}) }] } }], usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 120 } }))
  }))
}

beforeEach(async () => {
  h = createHarness({ GEMINI_API_KEY: 'test-key', GEMINI_VIDEO_MODEL: 'gemini-test-video' })
  admin = await superadminToken()
  storeA = await seedStore(h.db, { slug: 'tienda-a', name: 'Tienda A' })
  storeB = await seedStore(h.db, { slug: 'tienda-b', name: 'Tienda B' })
  ownerA = await userToken(await createStoreUser(h.db, { email: 'a@tiendas.test', storeId: storeA, role: 'owner' }), 'a@tiendas.test')
  ownerB = await userToken(await createStoreUser(h.db, { email: 'b@tiendas.test', storeId: storeB, role: 'owner' }), 'b@tiendas.test')
  sellerA = await userToken(await createStoreUser(h.db, { email: 'v@tiendas.test', storeId: storeA, role: 'seller' }), 'v@tiendas.test')
  ids = {
    ...await seedCatalog(h.db, storeA, { categories: [{ name: 'Ropa', slug: 'ropa' }], products: [
      { sku: 'A1', name: 'Camisa de lino', price: 50000, category: 'ropa', description: 'Camisa de lino fresca, manga larga y botones de coco.', variants: [{ size: 'M', stock: 12 }] },
      { sku: 'A2', name: 'Gorra', price: 30000, variants: [{ size: 'Única', stock: 3 }] },
      { sku: 'A3', name: 'Bolso', price: 80000, variants: [{ size: 'Única', stock: 40 }] },
      { sku: 'A4', name: 'Sin foto', price: 1000, imageUrls: [] },
    ] }),
    ...Object.fromEntries(Object.entries(await seedCatalog(h.db, storeB, { products: [{ sku: 'B1', name: 'Zapato', price: 70000 }] })).map(([k, v]) => [`B:${k}`, v])),
  }
  await h.db.prepare('UPDATE products SET compare_at_price = 100000 WHERE id = ?').bind(ids.A3).run()
  await h.db.prepare(`UPDATE products SET created_at = datetime('now', '-200 days') WHERE id = ?`).bind(ids.A3).run()
  await h.assets.put(`stores/${storeA}/products/A1.jpg`, createPng(40, 30), { httpMetadata: { contentType: 'image/png' } })
  stubAi()
})
afterEach(() => { vi.unstubAllGlobals() })

describe('plantillas y datos verificados', () => {
  it('solo ofrece cada plantilla cuando el dato que afirma es real', async () => {
    const check = async (sku: string) => Object.fromEntries((await json(await A('/creatives/eligibility', { method: 'POST', body: { productIds: [ids[sku]] } }))).templates.map((t: any) => [t.key, t.ok]))
    const camisa = await check('A1')
    expect(camisa).toMatchObject({ producto_nuevo: true, producto_destacado: true, ultimas_unidades: false, oferta_aprobada: false, antes_despues: false, coleccion: false, historia_marca: false })
    expect((await check('A2')).ultimas_unidades).toBe(true)
    const bolso = await check('A3')
    expect(bolso).toMatchObject({ oferta_aprobada: true, producto_nuevo: false, ultimas_unidades: false })
    // No se puede forzar una plantilla cuyo dato es falso.
    const forced = await A('/creatives/plan', { method: 'POST', body: { kind: 'imagen', template: 'oferta_aprobada', format: 'cuadrado', productIds: [ids.A1] } })
    expect(forced.status).toBe(409)
    expect((await json(forced)).code).toBe('TEMPLATE_NOT_ELIGIBLE')
  })

  it('el plan trae precio, etiqueta y porcentaje calculados por el servidor, con costo separado y sin créditos', async () => {
    const plan = await json(await A('/creatives/plan', { method: 'POST', body: { kind: 'imagen', template: 'oferta_aprobada', format: 'vertical', productIds: [ids.A3] } }))
    expect(plan.spec).toMatchObject({ width: 1080, height: 1350, badge: '-20%', slides: 1 })
    expect(plan.spec.products[0].priceText).toMatch(/^\$\s?80\.000$/)
    expect(plan.spec.products[0].compareAtText).toMatch(/100\.000/)
    expect(plan.cost).toEqual({ composicionConvencional: 0, imagenGenerativa: 0, videoGenerativo: 0, total: 0 })
    expect(plan.copy.whatsapp).toContain('Antes')
    expect(plan.copy.whatsapp).toContain('https://tiendas.test/t/tienda-a')
    // El precio anterior solo aparece en la plantilla de oferta.
    const plain = await json(await A('/creatives/plan', { method: 'POST', body: { kind: 'imagen', template: 'producto_destacado', format: 'cuadrado', productIds: [ids.A3] } }))
    expect(plain.spec.badge).toBeNull()
    expect(plain.spec.products[0].compareAtText).toBeNull()
  })

  it('valida tipo, formato, duración, fotos, permisos y aislamiento', async () => {
    const plan = (body: Record<string, unknown>, send = A) => send('/creatives/plan', { method: 'POST', body: { kind: 'imagen', template: 'producto_destacado', format: 'cuadrado', productIds: [ids.A1], ...body } })
    expect((await json(await plan({ kind: 'video', format: 'portada' }))).code).toBe('FORMAT_NOT_ALLOWED')
    expect((await json(await plan({ kind: 'video', seconds: 99 }))).code).toBe('INVALID_DURATION')
    expect((await json(await plan({ kind: 'carrusel' }))).code).toBe('KIND_NOT_ALLOWED')
    expect((await json(await plan({ productIds: [ids.A4] }))).code).toBe('PRODUCT_WITHOUT_PHOTO')
    expect((await plan({ productIds: [ids['B:B1']] })).status).toBe(404)
    expect((await plan({}, B)).status).toBe(404)
    expect((await h.request('/api/creative/creatives/catalog', { store: 'tienda-a', token: sellerA })).status).toBe(403)
    expect((await h.request('/api/creative/creatives/catalog', { store: 'tienda-a' })).status).toBe(401)
  })

  it('los textos base no inventan nada y el filtro rechaza cifras y promesas sin respaldo', () => {
    const facts: CreativeFacts = {
      store: { name: 'Tienda A', url: 'https://tiendas.test/t/tienda-a', currency: 'COP' },
      brand: { name: 'Tienda A', slogan: null, tone: null, logoUrl: null, colors: [], font: null },
      products: [{ id: 1, sku: 'A1', name: 'Camisa de lino', description: 'Camisa de lino fresca con 2 bolsillos.', category: 'Ropa', price: 50000, priceFrom: false, priceText: '$ 50.000', compareAtText: null, discountPercent: null, stock: 9, daysSinceCreated: 3, images: ['x'], beforeAfter: null }],
    }
    const base = defaultCopy('producto_nuevo', facts)
    expect(base).toMatchObject({ headline: 'Nuevo: Camisa de lino', benefits: [], cta: 'Pídelo por WhatsApp' })
    expect(base.whatsapp).toContain('Precio: $ 50.000')
    expect(unsupportedClaim('Camisa de lino con 2 bolsillos', facts)).toBe(false)
    expect(unsupportedClaim('Camisa con 30% de descuento', facts)).toBe(true)
    expect(unsupportedClaim('Envío gratis hoy', facts)).toBe(true)
    expect(unsupportedClaim('Garantía de por vida', facts)).toBe(true)
    const guarded = guardAiCopy({ headline: 'Lino fresco para tus días', description: 'Solo hoy 50% de descuento y envío gratis', benefits: ['Fresca', 'Garantía de 2 años'], cta: 'Escríbenos', hashtags: ['#Lino', '#Oferta'] }, base, facts, 'producto_nuevo')
    expect(guarded.copy.headline).toBe('Lino fresco para tus días')
    expect(guarded.copy.description).toBe(base.description)
    expect(guarded.copy.benefits).toEqual(['Fresca'])
    expect(guarded.copy.hashtags).toEqual(['#Lino'])
    expect(guarded.rejected.sort()).toEqual(['benefits', 'description'])
  })
})

describe('piezas convencionales', () => {
  const SPEC = () => ({ kind: 'imagen', template: 'producto_destacado', format: 'cuadrado', productIds: [ids.A1] })

  it('exige la resolución exacta del formato, guarda en privado, es idempotente y reutiliza la misma configuración', async () => {
    expect((await json(await save(SPEC(), [createPng(500, 500)], 'pieza-clave-001'))).code).toBe('INVALID_RESOLUTION')
    expect((await json(await save(SPEC(), [new TextEncoder().encode('<svg onload=alert(1)>')], 'pieza-clave-002'))).code).toBe('INVALID_IMAGE')
    const created = await save(SPEC(), [createPng(1080, 1080)], 'pieza-clave-003')
    expect(created.status).toBe(201)
    const { piece } = await json(created)
    expect(piece).toMatchObject({ kind: 'imagen', mode: 'convencional', status: 'pendiente', credits: 0, files: [{ width: 1080, height: 1080, contentType: 'image/png' }] })
    expect(piece.spec.products[0].priceText).toMatch(/50\.000/)
    // Privada: no se sirve por la ruta pública de archivos.
    const key = [...h.assets.objects.keys()].find((item) => item.includes('/pieces/'))!
    expect(key.startsWith(`creative-private/stores/${storeA}/pieces/`)).toBe(true)
    expect((await h.request(`/api/assets/${key}`)).status).toBe(404)
    // Misma clave: misma pieza. Misma configuración con otra clave: se reutiliza, no se duplica.
    expect((await json(await save(SPEC(), [createPng(1080, 1080)], 'pieza-clave-003'))).replayed).toBe(true)
    const again = await json(await save(SPEC(), [createPng(1080, 1080)], 'pieza-clave-004'))
    expect(again).toMatchObject({ reused: true, piece: { id: piece.id } })
    expect([...h.assets.objects.keys()].filter((item) => item.includes('/pieces/'))).toHaveLength(1)
    expect((await json(await A('/creatives/plan', { method: 'POST', body: SPEC() }))).reusable.id).toBe(piece.id)
    // Otra tienda no la ve.
    expect((await B(`/creatives/${piece.id}`)).status).toBe(404)
    expect((await B(`/creatives/${piece.id}/files/0`)).status).toBe(404)
    expect((await json(await B('/creatives'))).items).toHaveLength(0)
  })

  it('revisión: aprobar, descargar, asociar a campaña y rechazar (borra el archivo)', async () => {
    const { piece } = await json(await save(SPEC(), [createPng(1080, 1080)], 'pieza-rev-0001'))
    const campaign = Number((await h.db.prepare(`INSERT INTO campaigns (store_id, name, message, created_by) VALUES (?, 'Temporada', 'Hola', 'test')`).bind(storeA).run()).meta.last_row_id)
    const foreign = Number((await h.db.prepare(`INSERT INTO campaigns (store_id, name, message, created_by) VALUES (?, 'Ajena', 'Hola', 'test')`).bind(storeB).run()).meta.last_row_id)
    expect((await json(await A(`/creatives/${piece.id}/campaign`, { method: 'POST', body: { campaignId: campaign } }))).code).toBe('PIECE_NOT_APPROVED')
    expect((await json(await A(`/creatives/${piece.id}/approve`, { method: 'POST' }))).status).toBe('aprobado')
    const file = await A(`/creatives/${piece.id}/files/0?download=1`)
    expect(file.headers.get('content-type')).toBe('image/png')
    expect(file.headers.get('content-disposition')).toContain('attachment')
    expect(file.headers.get('cache-control')).toContain('no-store')
    expect((await A(`/creatives/${piece.id}/campaign`, { method: 'POST', body: { campaignId: foreign } })).status).toBe(404)
    expect(await json(await A(`/creatives/${piece.id}/campaign`, { method: 'POST', body: { campaignId: campaign } }))).toMatchObject({ campaignId: campaign, campaignName: 'Temporada' })
    expect((await json(await A(`/creatives?campaignId=${campaign}`))).items).toHaveLength(1)
    const rejected = await json(await A(`/creatives/${piece.id}/reject`, { method: 'POST' }))
    expect(rejected).toMatchObject({ status: 'rechazado', files: [], campaignId: null })
    expect([...h.assets.objects.keys()].some((item) => item.includes('/pieces/'))).toBe(false)
    expect((await json(await A('/creatives'))).items).toHaveLength(0)
    // El producto y su foto original no se tocan.
    expect(h.assets.objects.has(`stores/${storeA}/products/A1.jpg`)).toBe(true)
  })

  it('editar el texto crea una versión nueva y retira la anterior pendiente', async () => {
    const first = (await json(await save(SPEC(), [createPng(1080, 1080)], 'pieza-edit-0001'))).piece
    const edited = await json(await save({ ...SPEC(), copy: { headline: 'Camisa para clima cálido' }, replaces: first.id }, [createPng(1080, 1080)], 'pieza-edit-0002'))
    expect(edited.piece.copy.headline).toBe('Camisa para clima cálido')
    expect(edited.piece.id).not.toBe(first.id)
    expect((await json(await A(`/creatives/${first.id}`))).status).toBe('rechazado')
    expect([...h.assets.objects.keys()].filter((item) => item.includes('/pieces/'))).toHaveLength(1)
  })

  it('carrusel: una imagen por producto; video: MP4 o WebM real con la duración de la plantilla', async () => {
    const carousel = { kind: 'carrusel', template: 'coleccion', format: 'cuadrado', productIds: [ids.A1, ids.A2, ids.A3] }
    expect((await json(await save(carousel, [createPng(1080, 1080)], 'carrusel-0001'))).code).toBe('INVALID_FILES')
    const saved = await json(await save(carousel, [createPng(1080, 1080), createPng(1080, 1080), createPng(1080, 1080)], 'carrusel-0002'))
    expect(saved.piece.files).toHaveLength(3)
    expect((await A(`/creatives/${saved.piece.id}/files/2`)).status).toBe(200)
    expect((await A(`/creatives/${saved.piece.id}/files/3`)).status).toBe(404)

    const video = { kind: 'video', template: 'producto_destacado', format: 'historia', seconds: 6, quality: 'estandar', productIds: [ids.A1] }
    expect((await json(await save({ ...video, durationMs: 6000 }, [createPng(1080, 1920)], 'video-0001', A, 'video/mp4'))).code).toBe('INVALID_VIDEO')
    expect((await json(await save({ ...video, durationMs: 20000 }, [MP4], 'video-0002', A, 'video/mp4'))).code).toBe('INVALID_DURATION')
    const ok = await json(await save({ ...video, durationMs: 6033 }, [MP4], 'video-0003', A, 'video/mp4'))
    expect(ok.piece).toMatchObject({ kind: 'video', mode: 'convencional', credits: 0, files: [{ contentType: 'video/mp4', width: 720, height: 1280, durationMs: 6033 }] })
    expect(sniffVideoType(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2]))).toBe('video/webm')
  })
})

describe('motor de diseño publicitario', () => {
  const DESIGN = { sector: 'moda', objective: 'coleccion', style: 'editorial_nude', layout: 'lookbook', seed: 7, colors: ['#b76e79'], showPrice: true, removeBg: true, showReference: true }
  const plan = (body: Record<string, unknown>) => A('/creatives/plan', { method: 'POST', body: { kind: 'imagen', template: 'producto_destacado', format: 'vertical', productIds: [ids.A1], ...body } })

  it('el plan guarda el estilo validado, la referencia real y es otra pieza distinta de la clásica', async () => {
    const classic = await json(await plan({}))
    expect(classic.spec.version).toBe(1)
    expect(classic.spec.design).toBeUndefined()
    expect(classic.spec.products[0].reference).toBeUndefined()
    const designed = await json(await plan({ design: DESIGN }))
    expect(designed.spec).toMatchObject({ version: 2, design: { ...DESIGN, colors: ['#B76E79'] } })
    expect(designed.spec.products[0]).toMatchObject({ reference: 'A1', category: 'Ropa', gallery: expect.any(Array) })
    expect(designed.specHash).not.toBe(classic.specHash)
    // Otra variante (semilla) es otra huella: no se confunde con la anterior.
    const other = await json(await plan({ design: { ...DESIGN, seed: 8 } }))
    expect(other.specHash).not.toBe(designed.specHash)
  })

  it('rechaza estilos, composiciones y colores fuera de la lista, y una oferta sin precio', async () => {
    expect((await json(await plan({ design: { ...DESIGN, style: 'otro' } }))).code).toBe('INVALID_STYLE')
    expect((await json(await plan({ design: { ...DESIGN, layout: 'x' } }))).code).toBe('INVALID_LAYOUT')
    expect((await json(await plan({ design: { ...DESIGN, colors: ['red'] } }))).code).toBe('INVALID_COLORS')
    expect((await json(await plan({ design: { ...DESIGN, seed: -1 } }))).code).toBe('INVALID_SEED')
    expect((await json(await plan({ design: { ...DESIGN, sector: 'autos' } }))).code).toBe('INVALID_SECTOR')
    expect((await json(await plan({ design: { ...DESIGN, objective: 'x' } }))).code).toBe('INVALID_OBJECTIVE')
    // Sin sector, se toma el de la familia del estilo.
    expect((await json(await plan({ design: { ...DESIGN, sector: undefined } }))).spec.design.sector).toBe('moda')
    expect((await json(await A('/creatives/plan', { method: 'POST', body: { kind: 'imagen', template: 'oferta_aprobada', format: 'vertical', productIds: [ids.A3], design: { ...DESIGN, showPrice: false } } }))).code).toBe('PRICE_REQUIRED')
  })

  it('formato de anuncio horizontal 1200 × 628 con resolución exacta; guarda WebP y JPG', async () => {
    const spec = { kind: 'imagen', template: 'producto_destacado', format: 'anuncio', productIds: [ids.A1], design: DESIGN }
    expect((await json(await plan({ format: 'anuncio', design: DESIGN }))).spec).toMatchObject({ width: 1200, height: 628 })
    expect((await json(await save(spec, [createPng(1080, 1080)], 'pieza-diseno-001'))).code).toBe('INVALID_RESOLUTION')
    const created = await json(await save(spec, [createPng(1200, 628)], 'pieza-diseno-002'))
    expect(created.piece).toMatchObject({ format: 'anuncio', files: [{ width: 1200, height: 628 }] })
    expect(created.piece.spec.design.style).toBe('editorial_nude')
    expect((await json(await A('/creatives/catalog'))).formats.some((item: { key: string }) => item.key === 'anuncio')).toBe(true)
  })
})

describe('textos con IA', () => {
  it('cobra créditos, filtra lo que la ficha no respalda y no cobra si la IA falla', async () => {
    await setCost('creativo_texto', 2)
    await recharge('tienda-a', 10)
    stubAi({ copy: { headline: 'Frescura de lino todo el día', description: 'Llévala con 40% de descuento', benefits: ['Manga larga', 'Envío gratis'], cta: 'Pídela ya', hashtags: ['#CamisaDeLino'] } })
    const body = { template: 'producto_nuevo', productIds: [ids.A1] }
    const response = await A('/creatives/copy', { method: 'POST', body, headers: { 'Idempotency-Key': 'texto-ia-0001' } })
    expect(response.status).toBe(200)
    const result = await json(response)
    expect(result.credits).toBe(2)
    expect(result.copy.headline).toBe('Frescura de lino todo el día')
    expect(result.copy.description).toContain('Camisa de lino fresca')
    expect(result.copy.benefits).toEqual(['Manga larga'])
    expect(result.rejected.sort()).toEqual(['benefits', 'description'])
    // A la IA no se le entrega el precio.
    expect(JSON.stringify(aiCalls[0]!.body)).not.toContain('50000')
    expect((await creditSummary(h.db, storeA)).balance).toBe(8)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { status: 'UNAVAILABLE' } }), { status: 503 })))
    expect((await A('/creatives/copy', { method: 'POST', body, headers: { 'Idempotency-Key': 'texto-ia-0002' } })).status).toBe(502)
    expect((await creditSummary(h.db, storeA)).balance).toBe(8)
  })
})

describe('video generativo con IA', () => {
  const VIDEO = () => ({ productId: ids.A1, format: 'historia', seconds: 6, resolution: '720p', motion: 'acercamiento' })
  const create = (key: string, extra: Record<string, unknown> = {}) => A('/creatives/video-ai', { method: 'POST', body: { ...VIDEO(), ...extra }, headers: { 'Idempotency-Key': key } })
  const run = (jobId: string) => A(`/jobs/${jobId}/run`, { method: 'POST' })

  it('no se ofrece sin precio en créditos ni sin modelo configurado', async () => {
    const catalog = await json(await A('/creatives/catalog'))
    expect(catalog.videoAi).toMatchObject({ available: false, model: 'gemini-test-video', creditsPerSecond: null })
    expect((await json(await create('video-ia-0001', { confirmCredits: 0 }))).code).toBe('VIDEO_AI_UNAVAILABLE')
    const bare = createHarness({ GEMINI_API_KEY: 'test-key' })
    const store = await seedStore(bare.db, { slug: 'tienda-c', name: 'C' })
    const token = await userToken(await createStoreUser(bare.db, { email: 'c@tiendas.test', storeId: store, role: 'owner' }), 'c@tiendas.test')
    expect((await json(await bare.request('/api/creative/creatives/catalog', { store: 'tienda-c', token }))).videoAi).toMatchObject({ available: false, model: null })
    expect(aiCalls).toHaveLength(0)
  })

  it('cotiza por segundo, exige confirmación y saldo, genera, cobra una sola vez y reutiliza', async () => {
    await setCost('video_ia_segundo', 5)
    const quote = await json(await A('/creatives/video-ai/quote', { method: 'POST', body: VIDEO() }))
    expect(quote).toMatchObject({ available: true, creditsPerSecond: 5, totalCredits: 30, enough: false, cost: { composicionConvencional: 0, imagenGenerativa: 0, videoGenerativo: 30, total: 30 } })
    // 6 s a 720p: 5.792 tokens/s × US$ 12 por millón.
    expect(quote.providerCostMicros).toBe(Math.round(5792 * 6 * 12))
    expect((await json(await create('video-ia-0002'))).code).toBe('CONFIRMATION_REQUIRED')
    expect((await json(await create('video-ia-0003', { confirmCredits: 30 }))).code).toBe('NO_CREDITS')
    expect((await json(await create('video-ia-0004', { confirmCredits: 30, format: 'cuadrado' }))).code).toBe('INVALID_FORMAT')
    expect((await json(await create('video-ia-0005', { confirmCredits: 30, productId: ids['B:B1'] }))).code).toBe('PRODUCT_NOT_FOUND')
    await recharge('tienda-a', 100)
    const created = await create('video-ia-0006', { confirmCredits: 30 })
    expect(created.status).toBe(201)
    const { job } = await json(created)
    expect((await json(await create('video-ia-0006', { confirmCredits: 30 }))).job.id).toBe(job.id)
    const done = await json(await run(job.id))
    expect(done).toMatchObject({ status: 'completado', model: 'gemini-test-video', result: { credits: 30 } })
    // Petición al proveedor: foto real + instrucción fija, sin texto del comercio.
    const call = aiCalls.find((item) => item.url.endsWith('/interactions'))!
    expect(call.body).toMatchObject({ model: 'gemini-test-video', response_format: { type: 'video', aspect_ratio: '9:16', resolution: '720p', duration: '6s' } })
    expect(call.body.input[0]).toMatchObject({ type: 'image', mime_type: 'image/png' })
    expect(call.body.input[1].text).toBe(videoPrompt('acercamiento'))
    expect(videoPrompt('paneo')).toContain('Do not rotate')
    const piece = await json(await A(`/creatives/${done.result.pieceId}`))
    expect(piece).toMatchObject({ kind: 'video', mode: 'video_ia', status: 'pendiente', credits: 30, model: 'gemini-test-video', files: [{ contentType: 'video/mp4', width: 720, height: 1280, durationMs: 6000 }] })
    expect(piece.costMicros).toBe(Math.round(5792 * 6 * 12))
    expect(String(piece.spec.disclaimer)).toContain('no es una vista real')
    expect((await creditSummary(h.db, storeA)).balance).toBe(70)
    // Volver a ejecutar no cobra; pedir lo mismo reutiliza el video sin llamar a la IA.
    await run(job.id)
    const calls = aiCalls.length
    const again = await json(await create('video-ia-0007', { confirmCredits: 30 }))
    expect(again).toMatchObject({ reused: true, job: null, piece: { id: piece.id } })
    expect(aiCalls).toHaveLength(calls)
    expect((await creditSummary(h.db, storeA)).balance).toBe(70)
    expect((await B(`/creatives/${piece.id}/files/0`)).status).toBe(404)
  })

  it('un fallo del proveedor o una respuesta sin video no descuenta créditos; el cron retoma los pendientes', async () => {
    await setCost('video_ia_segundo', 5)
    await recharge('tienda-a', 100)
    stubAi({ video: 'error' })
    const first = (await json(await create('video-ia-0010', { confirmCredits: 30 }))).job
    expect(await json(await run(first.id))).toMatchObject({ status: 'fallido', errorCode: 'GEMINI_SERVICE' })
    stubAi({ video: 'empty' })
    const second = (await json(await create('video-ia-0011', { confirmCredits: 20, seconds: 4 }))).job
    expect((await json(await run(second.id))).status).toBe('fallido')
    expect((await creditSummary(h.db, storeA)).balance).toBe(100)
    expect((await json(await A('/creatives'))).items).toHaveLength(0)
    stubAi()
    expect((await json(await A(`/jobs/${first.id}/retry`, { method: 'POST' }))).status).toBe('pendiente')
    expect(await processPendingVideoJobs(h.env)).toBe(1)
    expect((await json(await A(`/jobs/${first.id}`))).status).toBe('completado')
    expect((await creditSummary(h.db, storeA)).balance).toBe(70)
  })
})
