import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import type { Env } from '../index'
import adminRoutes from './admin'
import { createAdminToken, hashAdminPassword } from '../services/auth'

const SECRET = '9f'.repeat(32)

function createApp(envOverrides: Partial<Env['Bindings']> = {}) {
  const app = new Hono<Env>()
  app.route('/api/admin', adminRoutes)
  let failures = 0
  let blocked = false
  const db = {
    prepare: (sql: string) => ({
      bind() { return this },
      run: async () => ({ success: true }),
      first: async () => sql.includes('blocked_until') && blocked ? { blocked: 1 } : null,
    }),
    batch: async () => { failures++; if (failures >= 8) blocked = true; return [] },
  }
  const env = {
    DB: db,
    ENVIRONMENT: 'development',
    ADMIN_EMAIL: 'admin@local.test',
    ADMIN_PASSWORD: 'local-test-password',
    JWT_SECRET: SECRET,
    ...envOverrides,
  } as unknown as Env['Bindings']
  return { app, env, get failures() { return failures } }
}

describe('admin authentication configuration', () => {
  it('fails closed with a sanitized 503 when auth configuration is missing', async () => {
    const { app, env } = createApp({ JWT_SECRET: undefined })
    const response = await app.request('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@local.test', password: 'local-test-password' }),
    }, env)
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ error: 'Authentication service is not configured' })
  })

  it('rejects incorrect credentials without issuing a session', async () => {
    const { app, env } = createApp()
    const response = await app.request('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@local.test', password: 'wrong-password' }),
    }, env)
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid credentials' })
  })

  it('issues a production session only with the PBKDF2 password hash', async () => {
    const productionPassword = 'secure-production-fixture-password'
    const production = createApp({
      ENVIRONMENT: 'production',
      ADMIN_EMAIL: 'owner@acme-shop.com',
      ADMIN_PASSWORD: undefined,
      ADMIN_PASSWORD_HASH: await hashAdminPassword(productionPassword),
      ALLOWED_ORIGIN: 'https://shop.example.com',
      JWT_SECRET: '8f2c1a7d9e4b6c3a5f0d8e2b7c1a9f4e',
    })
    const response = await production.app.request('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'owner@acme-shop.com', password: productionPassword }),
    }, production.env)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ email: 'owner@acme-shop.com' })
  })

  it('applies persistent rate limiting after eight failed logins', async () => {
    const context = createApp()
    const { app, env } = context
    for (let attempt = 0; attempt < 8; attempt++) {
      const response = await app.request('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.4' },
        body: JSON.stringify({ email: 'admin@local.test', password: 'wrong-password' }),
      }, env)
      expect(response.status).toBe(401)
    }
    expect(context.failures).toBe(8)
    const limited = await app.request('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.4' },
      body: JSON.stringify({ email: 'admin@local.test', password: 'wrong-password' }),
    }, env)
    expect(limited.status).toBe(429)
    expect(limited.headers.get('Retry-After')).toBe('900')
  })

  it('rejects protected requests when the configured JWT secret is invalid', async () => {
    const { app, env } = createApp({ JWT_SECRET: 'short' })
    const response = await app.request('/api/admin/stats', {
      headers: { Authorization: `Bearer ${await createAdminToken('admin@local.test', SECRET)}` },
    }, env)
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ error: 'Authentication service is not configured' })
  })

  it('rejects existing sessions when admin credentials are no longer configured', async () => {
    const { app, env } = createApp({ ADMIN_EMAIL: undefined })
    const response = await app.request('/api/admin/stats', {
      headers: { Authorization: `Bearer ${await createAdminToken('admin@local.test', SECRET)}` },
    }, env)
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ error: 'Authentication service is not configured' })
  })
})
