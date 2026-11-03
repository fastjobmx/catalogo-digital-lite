import { beforeEach, describe, expect, it } from 'vitest'
import { createHarness, seedCatalog, superadminToken, type Harness } from '../testing/harness'

let h: Harness
let token: string

beforeEach(async () => {
  h = createHarness()
  token = await superadminToken()
  await seedCatalog(h.db, 1, { categories: [{ name: 'Running', slug: 'running' }, { name: 'Lifestyle', slug: 'lifestyle' }] })
})

const categoryId = (slug: string) => h.db.query<{ id: number }>('SELECT id FROM categories WHERE slug = ?', slug)[0]!.id

describe('PUT /api/admin/categories/:id', () => {
  it('rechaza solicitudes sin token', async () => {
    expect((await h.request(`/api/admin/categories/${categoryId('running')}`, { method: 'PUT', body: { name: 'X', slug: 'x' } })).status).toBe(401)
  })

  it('rechaza un slug que ya pertenece a otra categoría de la misma tienda', async () => {
    const response = await h.request(`/api/admin/categories/${categoryId('running')}`, { method: 'PUT', token, body: { name: 'Running', slug: 'lifestyle' } })
    expect(response.status).toBe(409)
  })

  it('actualiza una categoría existente con una sesión válida y la audita', async () => {
    const response = await h.request(`/api/admin/categories/${categoryId('running')}`, { method: 'PUT', token, body: { name: 'Correr', slug: 'correr' } })
    expect(response.status).toBe(200)
    expect(h.db.query('SELECT name, slug FROM categories WHERE slug = ?', 'correr')).toEqual([{ name: 'Correr', slug: 'correr' }])
    expect(h.db.query("SELECT store_id FROM audit_log WHERE action = 'category_updated'")).toEqual([{ store_id: 1 }])
  })

  it('valida el nombre y slug antes de escribir', async () => {
    const response = await h.request(`/api/admin/categories/${categoryId('running')}`, { method: 'PUT', token, body: { name: '', slug: '' } })
    expect(response.status).toBe(400)
    expect(h.db.query('SELECT name FROM categories WHERE slug = ?', 'running')).toEqual([{ name: 'Running' }])
  })
})
