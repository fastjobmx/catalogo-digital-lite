/** A team with roles from the Negocio plan up (owner decision of 2026-11-19): Emprendedor stores keep only
 * their owner; other plans, the trial and the existing members are not affected. */
import { beforeEach, describe, expect, it } from 'vitest'
import { createHarness, createStoreUser, seedStore, userToken, type Harness } from '../testing/harness'

let h: Harness

beforeEach(() => { h = createHarness() })

async function ownerOf(slug: string, plan: string) {
  const storeId = await seedStore(h.db, { slug, name: slug, plan })
  const owner = await createStoreUser(h.db, { email: `owner@${slug}.test`, password: 'clave-segura-123', storeId, role: 'owner' })
  return { storeId, token: await userToken(owner, `owner@${slug}.test`) }
}

const invite = (token: string, store: string) => h.request('/api/admin/team', { method: 'POST', token, store, body: { email: `op@${store}.test`, role: 'operator' } })

describe('POST /api/admin/team by plan', () => {
  it('refuses new members on the Emprendedor plan and writes nothing', async () => {
    const { storeId, token } = await ownerOf('emprende', 'emprendedor')
    const response = await invite(token, 'emprende')
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'PLAN_WITHOUT_TEAM' })
    expect(h.db.query("SELECT role FROM store_memberships WHERE store_id = ? AND role <> 'owner'", storeId)).toEqual([])
    expect(h.db.query("SELECT 1 FROM audit_log WHERE action = 'team_member_added'")).toEqual([])
  })

  it('lets Negocio, Mayorista, the trial and legacy plans invite as before', async () => {
    for (const plan of ['negocio', 'mayorista', 'prueba', 'profesional']) {
      const { token } = await ownerOf(`t-${plan}`, plan)
      expect((await invite(token, `t-${plan}`)).status, plan).toBe(201)
    }
  })
})
