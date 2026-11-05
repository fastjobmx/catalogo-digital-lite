import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHarness, createStoreUser, seedStore, superadminToken, userToken, type Harness } from '../testing/harness'
import { creditSummary, releaseExpiredReservations, reserveCredits, runWithCredits, settleReservation } from '../ai/credits'

let h: Harness
let admin: string
let storeA: number
let storeB: number
let ownerA: string
let ownerB: string

const json = async (response: Response) => response.json() as Promise<any>
const recharge = (slug: string, amount: number, key: string, kind = 'recarga', token = admin) => h.request(`/api/platform/stores/${slug}/credits`, {
  method: 'POST', token, headers: { 'Idempotency-Key': key }, body: { kind, amount, reason: 'Pago recibido por transferencia' },
})
const setCost = (feature: string, credits: number, enabled = true) => h.request(`/api/platform/credits/costs/${feature}`, { method: 'PUT', token: admin, body: { credits, enabled } })
const fakeAi = () => vi.fn(async () => ({ text: 'ok', model: 'gemini-test', usage: { promptTokens: 100, outputTokens: 20 } }))

beforeEach(async () => {
  h = createHarness({ GEMINI_API_KEY: 'test-key' })
  admin = await superadminToken()
  storeA = await seedStore(h.db, { slug: 'tienda-a', name: 'Tienda A' })
  storeB = await seedStore(h.db, { slug: 'tienda-b', name: 'Tienda B' })
  ownerA = await userToken(await createStoreUser(h.db, { email: 'duena@tienda-a.co', storeId: storeA, role: 'owner' }), 'duena@tienda-a.co')
  ownerB = await userToken(await createStoreUser(h.db, { email: 'dueno@tienda-b.co', storeId: storeB, role: 'owner' }), 'dueno@tienda-b.co')
})

describe('AI credit costs', () => {
  it('starts with no commercial values and lets only the superadmin set them', async () => {
    const costs = await json(await h.request('/api/platform/credits/costs', { token: admin }))
    expect(costs.items.length).toBeGreaterThan(0)
    expect(costs.items.every((row: any) => row.configured === false && row.credits === null)).toBe(true)
    expect((await setCost('foto_a_producto', 2)).status).toBe(200)
    expect((await setCost('no_existe', 2)).status).toBe(404)
    expect((await h.request('/api/platform/credits/costs/foto_a_producto', { method: 'PUT', token: ownerA, body: { credits: 0 } })).status).toBe(403)
    const merchantView = await json(await h.request('/api/admin/credits', { token: ownerA, store: 'tienda-a' }))
    expect(merchantView.costs.find((row: any) => row.feature === 'foto_a_producto')).toMatchObject({ configured: true, credits: 2, enabled: true })
  })
})

describe('recharges and adjustments', () => {
  it('belong to the store, are idempotent and audited', async () => {
    const first = await recharge('tienda-a', 50, 'recarga-0001')
    expect(first.status).toBe(201)
    const retry = await recharge('tienda-a', 50, 'recarga-0001')
    expect(retry.status).toBe(200)
    expect(await json(retry)).toMatchObject({ replayed: true, balance: 50 })
    expect(await creditSummary(h.db, storeA)).toMatchObject({ balance: 50, recharged: 50 })
    expect(await creditSummary(h.db, storeB)).toMatchObject({ balance: 0 })
    expect(h.db.query("SELECT action, performed_by FROM audit_log WHERE entity_type = 'ai_credits'")).toEqual([{ action: 'ai_credits_recharged', performed_by: 'platform:platform@admin.test' }])
  })

  it('never lets an adjustment leave a negative balance and requires a reason and key', async () => {
    await recharge('tienda-a', 10, 'recarga-0002')
    expect((await recharge('tienda-a', -11, 'ajuste-00001', 'ajuste')).status).toBe(409)
    expect((await recharge('tienda-a', -4, 'ajuste-00002', 'ajuste')).status).toBe(201)
    expect(await creditSummary(h.db, storeA)).toMatchObject({ balance: 6 })
    expect((await h.request('/api/platform/stores/tienda-a/credits', { method: 'POST', token: admin, body: { kind: 'recarga', amount: 5, reason: 'x' } })).status).toBe(400)
    expect((await h.request('/api/platform/stores/tienda-a/credits', { method: 'POST', token: admin, headers: { 'Idempotency-Key': 'sin-motivo-01' }, body: { kind: 'recarga', amount: 5 } })).status).toBe(400)
    expect((await recharge('tienda-a', 0, 'recarga-cero1')).status).toBe(400)
    expect((await recharge('tienda-a', 2.5, 'recarga-frac1')).status).toBe(400)
  })

  it('cannot be done by a merchant, not even the owner, on its own store', async () => {
    expect((await recharge('tienda-a', 100, 'auto-recarga1', 'recarga', ownerA)).status).toBe(403)
    expect((await h.request('/api/admin/credits', { method: 'POST', token: ownerA, store: 'tienda-a', body: { amount: 100 } })).status).toBe(404)
    expect(await creditSummary(h.db, storeA)).toMatchObject({ balance: 0 })
  })

  it('keeps every store isolated', async () => {
    await recharge('tienda-a', 30, 'recarga-0003')
    expect((await h.request('/api/admin/credits', { token: ownerB, store: 'tienda-a' })).status).toBe(403)
    const viewB = await json(await h.request('/api/admin/credits', { token: ownerB, store: 'tienda-b' }))
    expect(viewB).toMatchObject({ balance: 0, movements: [] })
  })
})

describe('recharge requests', () => {
  it('flows from the merchant request to the superadmin approval exactly once', async () => {
    const created = await h.request('/api/admin/credits/requests', { method: 'POST', token: ownerA, store: 'tienda-a', body: { credits: 40, note: 'Pagué por Nequi' } })
    expect(created.status).toBe(201)
    const { id } = await json(created)
    expect(await creditSummary(h.db, storeA)).toMatchObject({ balance: 0 })
    const pending = await json(await h.request('/api/platform/credits/requests?status=pendiente', { token: admin }))
    expect(pending.items).toMatchObject([{ id, slug: 'tienda-a', credits: 40, status: 'pendiente' }])
    const approved = await h.request(`/api/platform/credits/requests/${id}/resolve`, { method: 'POST', token: admin, body: { decision: 'aprobada', credits: 35, note: 'Pago parcial' } })
    expect(approved.status).toBe(200)
    expect(await json(approved)).toMatchObject({ status: 'aprobada', approvedCredits: 35 })
    expect((await h.request(`/api/platform/credits/requests/${id}/resolve`, { method: 'POST', token: admin, body: { decision: 'aprobada' } })).status).toBe(409)
    expect(await creditSummary(h.db, storeA)).toMatchObject({ balance: 35 })
    expect(h.db.query('SELECT ledger_id IS NOT NULL AS linked FROM ai_credit_requests WHERE id = ?', id)).toEqual([{ linked: 1 }])
    const view = await json(await h.request('/api/admin/credits', { token: ownerA, store: 'tienda-a' }))
    expect(view.requests[0]).toMatchObject({ status: 'aprobada', approvedCredits: 35 })
    expect(view.movements[0]).toMatchObject({ kind: 'recarga', amount: 35, actor: 'platform' })
  })

  it('limits pending requests, lets the platform reject them and blocks merchants from resolving', async () => {
    const ask = () => h.request('/api/admin/credits/requests', { method: 'POST', token: ownerA, store: 'tienda-a', body: { credits: 10 } })
    for (let i = 0; i < 3; i++) expect((await ask()).status).toBe(201)
    expect((await ask()).status).toBe(409)
    const [first] = (await json(await h.request('/api/platform/credits/requests', { token: admin }))).items
    expect((await h.request(`/api/platform/credits/requests/${first.id}/resolve`, { method: 'POST', token: ownerA, body: { decision: 'aprobada' } })).status).toBe(403)
    expect((await h.request(`/api/platform/credits/requests/${first.id}/resolve`, { method: 'POST', token: admin, body: { decision: 'rechazada', note: 'Sin pago' } })).status).toBe(200)
    expect((await ask()).status).toBe(201)
    expect(await creditSummary(h.db, storeA)).toMatchObject({ balance: 0 })
    expect((await h.request('/api/admin/credits/requests', { method: 'POST', token: ownerA, store: 'tienda-a', body: { credits: -5 } })).status).toBe(400)
  })
})

describe('running AI actions with credits', () => {
  const run = (key: string, call = fakeAi(), storeId = storeA) => runWithCredits(h.db, h.env, { storeId, feature: 'foto_a_producto', key, actor: 'duena@tienda-a.co' }, call)

  it('reserves, then charges once on success', async () => {
    await setCost('foto_a_producto', 3)
    await recharge('tienda-a', 10, 'recarga-0004')
    const result = await run('accion-00001')
    expect(result).toMatchObject({ ok: true, charged: 3 })
    expect(await creditSummary(h.db, storeA)).toMatchObject({ balance: 7, consumed: 3, reserved: 0 })
    const again = await run('accion-00001')
    expect(again).toMatchObject({ ok: false, reason: 'duplicate' })
    expect(await creditSummary(h.db, storeA)).toMatchObject({ balance: 7 })
    expect(h.db.query("SELECT status FROM ai_usage_events WHERE feature = 'foto_a_producto'")).toEqual([{ status: 'ok' }])
  })

  it('returns the credits when the AI call fails', async () => {
    await setCost('foto_a_producto', 3)
    await recharge('tienda-a', 3, 'recarga-0005')
    const result = await run('accion-00002', vi.fn(async () => { throw new Error('upstream down') }))
    expect(result).toMatchObject({ ok: false, reason: 'error' })
    expect(await creditSummary(h.db, storeA)).toMatchObject({ balance: 3, reserved: 0, consumed: 0 })
  })

  it('does not call the AI without enough credits, when the feature is paused or the store has AI off', async () => {
    await setCost('foto_a_producto', 5)
    await recharge('tienda-a', 4, 'recarga-0006')
    const call = fakeAi()
    expect(await run('accion-00003', call)).toMatchObject({ ok: false, reason: 'no_credits' })
    await recharge('tienda-a', 10, 'recarga-0007')
    await setCost('foto_a_producto', 5, false)
    expect(await run('accion-00004', call)).toMatchObject({ ok: false, reason: 'feature_disabled' })
    await setCost('foto_a_producto', 5, true)
    h.db.sqlite.exec(`UPDATE stores SET ai_enabled = 0 WHERE id = ${storeA}`)
    expect(await run('accion-00005', call)).toMatchObject({ ok: false, reason: 'disabled' })
    expect(call).not.toHaveBeenCalled()
    expect(await creditSummary(h.db, storeA)).toMatchObject({ balance: 14 })
  })

  it('keeps working on the monthly budget alone when the platform has not priced the feature', async () => {
    const result = await run('accion-00006')
    expect(result).toMatchObject({ ok: true, charged: 0 })
    expect(h.db.query('SELECT COUNT(*) AS n FROM ai_credit_ledger')).toEqual([{ n: 0 }])
  })

  it('never double-spends when two actions race for the last credits', async () => {
    await setCost('foto_a_producto', 6)
    await recharge('tienda-a', 10, 'recarga-0008')
    const results = await Promise.all([run('carrera-0001'), run('carrera-0002')])
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(await creditSummary(h.db, storeA)).toMatchObject({ balance: 4 })
  })

  it('releases reservations that never finished and ignores a late close', async () => {
    await recharge('tienda-a', 8, 'recarga-0009')
    const reservation = await reserveCredits(h.db, { storeId: storeA, feature: 'estudio_imagen', credits: 5, key: 'colgada-0001', actor: 'test' })
    expect(reservation.ok).toBe(true)
    expect(await creditSummary(h.db, storeA)).toMatchObject({ balance: 3, reserved: 5 })
    h.db.sqlite.exec("UPDATE ai_credit_ledger SET expires_at = datetime('now', '-1 minute') WHERE kind = 'reserva'")
    expect(await releaseExpiredReservations(h.db)).toBe(1)
    expect(await creditSummary(h.db, storeA)).toMatchObject({ balance: 8, reserved: 0 })
    if (reservation.ok) expect(await settleReservation(h.db, reservation.reservationId, 'consumo')).toBe(false)
    expect(await releaseExpiredReservations(h.db)).toBe(0)
    expect(await creditSummary(h.db, storeA)).toMatchObject({ balance: 8 })
  })

  it('the ledger rejects impossible rows even if code tried to write them', () => {
    expect(() => h.db.sqlite.exec(`INSERT INTO ai_credit_ledger (store_id, kind, amount, actor) VALUES (${storeA}, 'recarga', -5, 'x')`)).toThrow()
    expect(() => h.db.sqlite.exec(`INSERT INTO ai_credit_ledger (store_id, kind, amount, actor) VALUES (${storeA}, 'consumo', 0, 'x')`)).toThrow()
  })
})

describe('store purge', () => {
  it('removes the credit history of a purged test store', async () => {
    await recharge('tienda-b', 5, 'recarga-0010')
    await h.request('/api/admin/credits/requests', { method: 'POST', token: ownerB, store: 'tienda-b', body: { credits: 10 } })
    h.db.sqlite.exec(`UPDATE stores SET status = 'draft' WHERE id = ${storeB}`)
    const purge = await h.request('/api/platform/stores/tienda-b', { method: 'DELETE', token: admin, body: { confirm: 'tienda-b' } })
    expect(purge.status).toBe(200)
    expect(h.db.query('SELECT COUNT(*) AS n FROM ai_credit_ledger WHERE store_id = ?', storeB)).toEqual([{ n: 0 }])
    expect(h.db.query('SELECT COUNT(*) AS n FROM ai_credit_requests WHERE store_id = ?', storeB)).toEqual([{ n: 0 }])
  })
})
