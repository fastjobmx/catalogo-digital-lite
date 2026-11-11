/** Estudio Creativo IA · fase 1: aislamiento entre tiendas, permisos, Brand Kit y trabajos. */
import { beforeEach, describe, expect, it } from 'vitest'
import { createHarness, createStoreUser, seedStore, superadminToken, userToken, type Harness } from '../testing/harness'
import { creativeJobService, maintainCreativeJobs, MAX_ACTIVE_JOBS_PER_STORE } from '../creative/jobs'
import { creditSummary, reserveCredits } from '../ai/credits'
import type { CreativeContext } from '../creative/contracts'

let h: Harness
let storeA: number
let storeB: number
let ownerA: string
let ownerB: string
let sellerA: string

const json = async (response: Response) => response.json() as Promise<any>
const ctxA = (): CreativeContext => ({ storeId: storeA, actor: 'a@tiendas.test', role: 'owner' })
const ctxB = (): CreativeContext => ({ storeId: storeB, actor: 'b@tiendas.test', role: 'owner' })

beforeEach(async () => {
  h = createHarness()
  storeA = await seedStore(h.db, { slug: 'tienda-a', name: 'Tienda A' })
  storeB = await seedStore(h.db, { slug: 'tienda-b', name: 'Tienda B' })
  ownerA = await userToken(await createStoreUser(h.db, { email: 'a@tiendas.test', storeId: storeA, role: 'owner' }), 'a@tiendas.test')
  ownerB = await userToken(await createStoreUser(h.db, { email: 'b@tiendas.test', storeId: storeB, role: 'owner' }), 'b@tiendas.test')
  sellerA = await userToken(await createStoreUser(h.db, { email: 'v@tiendas.test', storeId: storeA, role: 'seller' }), 'v@tiendas.test')
})

describe('acceso al Estudio Creativo', () => {
  it('exige sesión, pertenencia a la tienda y un rol con marketing', async () => {
    expect((await h.request('/api/creative/overview', { store: 'tienda-a' })).status).toBe(401)
    expect((await h.request('/api/creative/overview', { store: 'tienda-b', token: ownerA })).status).toBe(403)
    expect((await h.request('/api/creative/brand-kit', { store: 'tienda-a', token: sellerA })).status).toBe(403)
    const ok = await h.request('/api/creative/overview', { store: 'tienda-a', token: ownerA })
    expect(ok.status).toBe(200)
    expect(ok.headers.get('Cache-Control')).toContain('no-store')
    const body = await json(ok)
    expect(body.name).toBe('Estudio Creativo IA')
    expect(body.modules.find((m: any) => m.key === 'brand_kit').status).toBe('disponible')
    expect(body.modules.find((m: any) => m.key === 'video').status).toBe('disponible')
    expect(body.modules.find((m: any) => m.key === 'campanas').status).toBe('proximamente')
    expect(JSON.stringify(body)).not.toContain('GEMINI_API_KEY')
    expect((await h.request('/api/creative/overview', { store: 'tienda-b', token: await superadminToken() })).status).toBe(200)
  })
})

describe('Brand Kit', () => {
  it('empieza vacío (sin datos inventados) y sugiere lo que ya existe en Apariencia', async () => {
    const body = await json(await h.request('/api/creative/brand-kit', { store: 'tienda-a', token: ownerA }))
    expect(body.kit).toMatchObject({ brandName: null, slogan: null, colors: [], revision: 0 })
    expect(body.hints.name).toBe('Tienda A')
  })

  it('guarda solo en la tienda resuelta y nunca se mezcla con otra', async () => {
    const saved = await h.request('/api/creative/brand-kit', { method: 'PUT', store: 'tienda-a', token: ownerA, body: { brandName: 'Marca A', colors: ['#112233'], fonts: ['Inter'], visualStyles: ['urbano'], tone: 'cercano' } })
    expect(saved.status).toBe(200)
    expect((await json(saved)).kit).toMatchObject({ brandName: 'Marca A', colors: ['#112233'], revision: 1 })
    expect((await json(await h.request('/api/creative/brand-kit', { store: 'tienda-b', token: ownerB }))).kit.brandName).toBeNull()
    // Un owner de A que apunte a B no puede escribir allí.
    expect((await h.request('/api/creative/brand-kit', { method: 'PUT', store: 'tienda-b', token: ownerA, body: { brandName: 'Intruso' } })).status).toBe(403)
    expect(h.db.query('SELECT store_id FROM brand_kits')).toEqual([{ store_id: storeA }])
    const audit = h.db.query("SELECT store_id FROM audit_log WHERE action = 'brand_kit_updated'") as Array<{ store_id: number }>
    expect(audit).toEqual([{ store_id: storeA }])
  })

  it('rechaza logos de otra tienda, valores fuera de las listas y ediciones simultáneas', async () => {
    const put = (body: unknown) => h.request('/api/creative/brand-kit', { method: 'PUT', store: 'tienda-a', token: ownerA, body })
    const foreign = await put({ logoUrl: `/api/assets/stores/${storeB}/store/logo.png` })
    expect(foreign.status).toBe(400)
    expect((await json(foreign)).code).toBe('ASSET_NOT_OWNED')
    expect((await put({ logoUrl: `/api/assets/stores/${storeA}/store/logo.png` })).status).toBe(200)
    expect((await put({ logoUrl: 'javascript:alert(1)' })).status).toBe(400)
    expect((await put({ colors: ['rojo'] })).status).toBe(400)
    expect((await put({ fonts: ['Comic Sans'] })).status).toBe(400)
    expect((await put({ colors: Array(7).fill(0).map((_, i) => `#00000${i}`) })).status).toBe(400)
    expect((await put({ brandName: 'x'.repeat(81) })).status).toBe(400)
    const stale = await put({ slogan: 'Hola', revision: 0 })
    expect(stale.status).toBe(409)
    expect((await put({ slogan: 'Hola', revision: 1 })).status).toBe(200)
  })
})

describe('trabajos creativos', () => {
  it('no crea trabajos por HTTP mientras no haya motores conectados', async () => {
    const response = await h.request('/api/creative/jobs', { method: 'POST', store: 'tienda-a', token: ownerA, headers: { 'Idempotency-Key': 'job-key-0000001' }, body: { kind: 'foto' } })
    expect(response.status).toBe(409)
    expect((await json(response)).code).toBe('ENGINE_UNAVAILABLE')
    expect((await h.request('/api/creative/jobs', { method: 'POST', store: 'tienda-a', token: ownerA, body: { kind: 'otro' } })).status).toBe(400)
    expect((await json(await h.request('/api/creative/jobs', { store: 'tienda-a', token: ownerA }))).items).toEqual([])
  })

  it('aísla trabajos entre tiendas: listar, leer y cancelar', async () => {
    const jobs = creativeJobService(h.db)
    const { job } = await jobs.create(ctxA(), { kind: 'foto', idempotencyKey: 'clave-unica-001', input: { productId: 1 } })
    expect((await json(await h.request('/api/creative/jobs', { store: 'tienda-a', token: ownerA }))).items.map((j: any) => j.id)).toEqual([job.id])
    expect((await json(await h.request('/api/creative/jobs', { store: 'tienda-b', token: ownerB }))).items).toEqual([])
    expect((await h.request(`/api/creative/jobs/${job.id}`, { store: 'tienda-b', token: ownerB })).status).toBe(404)
    expect((await h.request(`/api/creative/jobs/${job.id}/cancel`, { method: 'POST', store: 'tienda-b', token: ownerB })).status).toBe(404)
    expect(await jobs.get(ctxB(), job.id)).toBeNull()
    const cancelled = await h.request(`/api/creative/jobs/${job.id}/cancel`, { method: 'POST', store: 'tienda-a', token: ownerA })
    expect((await json(cancelled)).status).toBe('cancelado')
    expect((await h.request(`/api/creative/jobs/${job.id}/cancel`, { method: 'POST', store: 'tienda-a', token: ownerA })).status).toBe(409)
  })

  it('es idempotente por tienda y la misma clave en otra tienda es otro trabajo', async () => {
    const jobs = creativeJobService(h.db)
    const first = await jobs.create(ctxA(), { kind: 'video', idempotencyKey: 'misma-clave-01', input: {} })
    const again = await jobs.create(ctxA(), { kind: 'video', idempotencyKey: 'misma-clave-01', input: {} })
    expect(again).toMatchObject({ replayed: true, job: { id: first.job.id } })
    await expect(jobs.create(ctxA(), { kind: 'foto', idempotencyKey: 'misma-clave-01', input: {} })).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' })
    const other = await jobs.create(ctxB(), { kind: 'video', idempotencyKey: 'misma-clave-01', input: {} })
    expect(other.replayed).toBe(false)
    expect(other.job.id).not.toBe(first.job.id)
    await expect(jobs.create(ctxA(), { kind: 'foto', idempotencyKey: 'x', input: {} })).rejects.toMatchObject({ code: 'INVALID_IDEMPOTENCY_KEY' })
    await expect(jobs.create(ctxA(), { kind: 'foto', idempotencyKey: 'clave-grande-01', input: { big: 'x'.repeat(9000) } })).rejects.toMatchObject({ code: 'INPUT_TOO_LARGE' })
  })

  it('limita los trabajos activos por tienda sin afectar a las demás', async () => {
    const jobs = creativeJobService(h.db)
    for (let i = 0; i < MAX_ACTIVE_JOBS_PER_STORE; i++) await jobs.create(ctxA(), { kind: 'foto', idempotencyKey: `activo-a-000${i}`, input: {} })
    await expect(jobs.create(ctxA(), { kind: 'foto', idempotencyKey: 'activo-a-extra', input: {} })).rejects.toMatchObject({ code: 'TOO_MANY_JOBS', status: 429 })
    expect((await jobs.create(ctxB(), { kind: 'foto', idempotencyKey: 'activo-b-0001', input: {} })).replayed).toBe(false)
  })

  it('el mantenimiento marca trabajos caídos como fallidos, devuelve sus créditos y aplica la retención', async () => {
    const jobs = creativeJobService(h.db)
    await h.db.prepare(`INSERT INTO ai_credit_ledger (store_id, kind, amount, idempotency_key, actor, reason) VALUES (?, 'recarga', 10, 'recarga-test-001', 'test', 'prueba')`).bind(storeA).run()
    const reservation = await reserveCredits(h.db, { storeId: storeA, feature: 'estudio_imagen', credits: 4, key: 'reserva-job-0001', actor: 'test' })
    if (!reservation.ok) throw new Error('reserva')
    const { job } = await jobs.create(ctxA(), { kind: 'foto', idempotencyKey: 'caido-000001', input: {} })
    h.db.query("UPDATE creative_jobs SET status = 'en_proceso', started_at = datetime('now', '-2 hours'), credit_reservation_id = ? WHERE id = ?", reservation.reservationId, job.id)
    const { job: old } = await jobs.create(ctxB(), { kind: 'foto', idempotencyKey: 'viejo-000001', input: {} })
    h.db.query("UPDATE creative_jobs SET status = 'completado', expires_at = datetime('now', '-1 day') WHERE id = ?", old.id)
    expect((await creditSummary(h.db, storeA)).balance).toBe(6)
    expect(await maintainCreativeJobs(h.db)).toEqual({ failed: 1, purged: 1 })
    expect((await jobs.get(ctxA(), job.id))).toMatchObject({ status: 'fallido', errorCode: 'TIMEOUT' })
    expect((await creditSummary(h.db, storeA)).balance).toBe(10)
  })
})

describe('recursos privados', () => {
  it('la ruta pública de assets nunca sirve originales del Estudio Creativo', async () => {
    await h.assets.put(`creative-private/stores/${storeA}/original.jpg`, new Uint8Array([1, 2, 3]))
    expect((await h.request(`/api/assets/creative-private/stores/${storeA}/original.jpg`)).status).toBe(404)
  })
})
