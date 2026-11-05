import { beforeEach, describe, expect, it } from 'vitest'
import { createPng } from '../../test/sqliteD1'
import { createHarness, type Harness } from '../testing/harness'
import { cleanupExpiredTrials } from '../services/trials'

let h: Harness
const json = async (response: Response) => response.json() as Promise<any>
const create = (body: Record<string, unknown> = { businessName: 'Dulce Hogar', template: 'stories' }, ip = '203.0.113.7') =>
  h.request('/api/trial', { method: 'POST', body, headers: { 'CF-Connecting-IP': ip } })
const photo = (id: string, token: string, bytes: Uint8Array = createPng(40, 40), type = 'image/png') => {
  const form = new FormData()
  form.append('file', new File([bytes], 'foto.png', { type }))
  return h.request(`/api/trial/${id}/photos`, { method: 'POST', body: form, headers: { 'X-Trial-Token': token, 'CF-Connecting-IP': '203.0.113.7' } })
}
const save = (id: string, token: string, body: Record<string, unknown>) => h.request(`/api/trial/${id}`, { method: 'PUT', body, headers: { 'X-Trial-Token': token, 'CF-Connecting-IP': '203.0.113.7' } })

beforeEach(() => { h = createHarness() })

describe('catalogue trial without sign-up', () => {
  it('creates a temporary, unpublished preview without users or stores and keeps no raw IP', async () => {
    const storesBefore = h.db.query('SELECT COUNT(*) AS n FROM stores')
    const response = await create()
    expect(response.status).toBe(201)
    expect(response.headers.get('x-robots-tag')).toContain('noindex')
    const trial = await json(response)
    expect(trial).toMatchObject({ businessName: 'Dulce Hogar', template: 'stories', temporary: true, published: false, products: [] })
    expect(trial.editToken).toMatch(/^[\w-]{40,}$/)
    const hours = (Date.parse(trial.expiresAt) - Date.now()) / 3_600_000
    expect(hours).toBeGreaterThan(47.9)
    expect(hours).toBeLessThanOrEqual(48)
    expect(h.db.query('SELECT COUNT(*) AS n FROM stores')).toEqual(storesBefore)
    expect(h.db.query('SELECT COUNT(*) AS n FROM platform_users')).toEqual([{ n: 0 }])
    const row = h.db.query<any>('SELECT ip_hash, edit_token_hash FROM trial_sessions')[0]
    expect(row.ip_hash).not.toContain('203.0.113.7')
    expect(row.edit_token_hash).not.toBe(trial.editToken)
  })

  it('stores photos and products only with the edit token, and shows them publicly', async () => {
    const trial = await json(await create())
    const uploaded = await photo(trial.id, trial.editToken)
    expect(uploaded.status).toBe(201)
    const { url } = await json(uploaded)
    expect(url).toMatch(new RegExp(`^/api/trial/${trial.id}/assets/[0-9a-f-]{36}\\.png$`))
    expect((await photo(trial.id, 'token-falso')).status).toBe(401)
    const saved = await save(trial.id, trial.editToken, { businessName: 'Dulce Hogar Deco', products: [{ name: 'Lámpara', price: 85000, description: 'Luz cálida', imageUrl: url }, { name: 'Cojín', price: null }] })
    expect(saved.status).toBe(200)
    const view = await json(await h.request(`/api/trial/${trial.id}`))
    expect(view).toMatchObject({ businessName: 'Dulce Hogar Deco', products: [{ name: 'Lámpara', price: 85000, imageUrl: url }, { name: 'Cojín', price: null }] })
    const asset = await h.request(url)
    expect(asset.status).toBe(200)
    expect(asset.headers.get('x-robots-tag')).toContain('noindex')
    expect((await save(trial.id, 'otro', { products: [] })).status).toBe(401)
  })

  it('refuses fake images, foreign photo links, too many photos and too many products', async () => {
    const trial = await json(await create())
    expect((await photo(trial.id, trial.editToken, new TextEncoder().encode('<script>alert(1)</script>'), 'image/png')).status).toBe(400)
    const other = await json(await create({ businessName: 'Otra prueba' }, '198.51.100.1'))
    const foreign = (await json(await photo(other.id, other.editToken))).url
    expect((await save(trial.id, trial.editToken, { products: [{ name: 'X', imageUrl: foreign }] })).status).toBe(400)
    expect((await save(trial.id, trial.editToken, { products: [{ name: 'X', imageUrl: 'https://evil.example/x.png' }] })).status).toBe(400)
    for (let i = 0; i < 6; i++) expect((await photo(trial.id, trial.editToken)).status).toBe(201)
    expect((await photo(trial.id, trial.editToken)).status).toBe(409)
    expect((await save(trial.id, trial.editToken, { products: Array.from({ length: 13 }, (_, i) => ({ name: `P${i}` })) })).status).toBe(400)
    expect((await h.request(`/api/assets/trials/${trial.id}/x.png`)).status).toBe(404)
  })

  it('limits trials per IP and hour', async () => {
    for (let i = 0; i < 5; i++) expect((await create({ businessName: `Prueba ${i}` })).status).toBe(201)
    const blocked = await create({ businessName: 'Una más' })
    expect(blocked.status).toBe(429)
    expect((await create({ businessName: 'Desde otra red' }, '192.0.2.44')).status).toBe(201)
  })

  it('expires after 48 hours and the cleanup removes the trial and its photos', async () => {
    const trial = await json(await create())
    await photo(trial.id, trial.editToken)
    expect([...h.assets.objects.keys()].some((key) => key.startsWith(`trials/${trial.id}/`))).toBe(true)
    h.db.sqlite.exec(`UPDATE trial_sessions SET expires_at = datetime('now', '-1 minute') WHERE id = '${trial.id}'`)
    expect((await h.request(`/api/trial/${trial.id}`)).status).toBe(410)
    expect(await cleanupExpiredTrials(h.db, h.env.ASSETS)).toBe(1)
    expect((await h.request(`/api/trial/${trial.id}`)).status).toBe(404)
    expect([...h.assets.objects.keys()].some((key) => key.startsWith('trials/'))).toBe(false)
  })

  it('can be deleted by its creator and switched off by the platform', async () => {
    const trial = await json(await create())
    expect((await h.request(`/api/trial/${trial.id}`, { method: 'DELETE', headers: { 'X-Trial-Token': trial.editToken } })).status).toBe(200)
    expect((await h.request(`/api/trial/${trial.id}`)).status).toBe(404)
    h.env.TRIALS_ENABLED = 'false'
    expect((await create()).status).toBe(503)
  })
})
