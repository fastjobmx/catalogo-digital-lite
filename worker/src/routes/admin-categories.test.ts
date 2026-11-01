import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import adminRoutes from './admin'
import { createAdminToken } from '../services/auth'
import type { Env } from '../index'

const SECRET = 'test-secret-with-at-least-32-characters'

function appWithDb(duplicateSlug: boolean) {
  const app = new Hono<Env>()
  app.route('/api/admin', adminRoutes)
  const db = {
    prepare: (sql: string) => ({
      bind() { return this },
      first: async () => sql.includes('id !=') ? (duplicateSlug ? { id: 8 } : null) : { id: 3 },
      run: async () => ({ success: true }),
    }),
  }
  return { app, env: { DB: db, JWT_SECRET: SECRET } as unknown as Env['Bindings'] }
}

describe('PUT /api/admin/categories/:id', () => {
  it('rechaza solicitudes sin token', async () => {
    const { app, env } = appWithDb(false)
    const response = await app.request('/api/admin/categories/3', { method: 'PUT', body: JSON.stringify({ name: 'Calzado', slug: 'calzado' }) }, env)
    expect(response.status).toBe(401)
  })

  it('rechaza un slug que ya pertenece a otra categoría', async () => {
    const { app, env } = appWithDb(true)
    const token = await createAdminToken('admin@example.com', SECRET)
    const response = await app.request('/api/admin/categories/3', {
      method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Calzado', slug: 'calzado' }),
    }, env)
    expect(response.status).toBe(409)
  })

  it('actualiza una categoría existente con una sesión válida', async () => {
    const { app, env } = appWithDb(false)
    const token = await createAdminToken('admin@example.com', SECRET)
    const response = await app.request('/api/admin/categories/3', {
      method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Calzado', slug: 'calzado' }),
    }, env)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ success: true, id: 3, slug: 'calzado' })
  })

  it('valida el nombre y slug antes de escribir', async () => {
    const { app, env } = appWithDb(false)
    const token = await createAdminToken('admin@example.com', SECRET)
    const response = await app.request('/api/admin/categories/3', {
      method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: ' ', slug: '' }),
    }, env)
    expect(response.status).toBe(400)
  })
})
