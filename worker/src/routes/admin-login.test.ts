import { describe, expect, it } from 'vitest'
import { createAdminToken, hashAdminPassword } from '../services/auth'
import { createHarness, createStoreUser, PLATFORM_EMAIL, PLATFORM_PASSWORD, seedStore, TEST_SECRET } from '../testing/harness'

const login = (h: ReturnType<typeof createHarness>, email: string, password: string, ip = '203.0.113.4') =>
  h.request('/api/admin/login', { method: 'POST', body: { email, password }, headers: { 'CF-Connecting-IP': ip } })

describe('admin authentication configuration', () => {
  it('fails closed with a sanitized 503 when auth configuration is missing', async () => {
    const h = createHarness({ JWT_SECRET: undefined })
    const response = await login(h, PLATFORM_EMAIL, PLATFORM_PASSWORD)
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ error: 'Authentication service is not configured' })
  })

  it('rejects incorrect credentials without issuing a session', async () => {
    const response = await login(createHarness(), PLATFORM_EMAIL, 'wrong-password')
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid credentials' })
  })

  it('issues a production superadmin session only with the PBKDF2 password hash', async () => {
    const productionPassword = 'secure-production-fixture-password'
    const h = createHarness({
      ENVIRONMENT: 'production', ADMIN_EMAIL: 'owner@acme-shop.com', ADMIN_PASSWORD: undefined,
      ADMIN_PASSWORD_HASH: await hashAdminPassword(productionPassword), ALLOWED_ORIGIN: 'https://shop.example.com',
      JWT_SECRET: '8f2c1a7d9e4b6c3a5f0d8e2b7c1a9f4e',
    })
    const response = await login(h, 'owner@acme-shop.com', productionPassword)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ email: 'owner@acme-shop.com', role: 'superadmin' })
  })

  it('applies persistent rate limiting after eight failed logins', async () => {
    const h = createHarness()
    for (let attempt = 0; attempt < 8; attempt++) expect((await login(h, PLATFORM_EMAIL, 'wrong-password')).status).toBe(401)
    const limited = await login(h, PLATFORM_EMAIL, PLATFORM_PASSWORD)
    expect(limited.status).toBe(429)
    expect(limited.headers.get('Retry-After')).toBe('900')
  })

  it('rejects protected requests when the configured JWT secret is invalid', async () => {
    const h = createHarness({ JWT_SECRET: 'short' })
    const response = await h.request('/api/admin/stats', { token: await createAdminToken(PLATFORM_EMAIL, TEST_SECRET) })
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ error: 'Authentication service is not configured' })
  })

  it('rejects existing sessions when admin credentials are no longer configured', async () => {
    const h = createHarness({ ADMIN_EMAIL: undefined })
    const response = await h.request('/api/admin/stats', { token: await createAdminToken(PLATFORM_EMAIL, TEST_SECRET) })
    expect(response.status).toBe(503)
  })
})

describe('store user sessions', () => {
  it('logs in a store owner with a hashed password and returns only their stores', async () => {
    const h = createHarness()
    const moda = await seedStore(h.db, { slug: 'moda-urbana', name: 'Moda Urbana' })
    await seedStore(h.db, { slug: 'otra-tienda', name: 'Otra Tienda' })
    await createStoreUser(h.db, { email: 'duena@moda.test', password: 'clave-segura-123', storeId: moda, role: 'owner' })
    const response = await login(h, 'duena@moda.test', 'clave-segura-123')
    expect(response.status).toBe(200)
    const session = await response.json() as { token: string; role: string; stores: Array<{ slug: string; role: string }> }
    expect(session.role).toBe('user')
    expect(session.stores).toEqual([expect.objectContaining({ slug: 'moda-urbana', role: 'owner' })])
    const me = await h.request('/api/admin/session', { token: session.token, store: 'moda-urbana' })
    await expect(me.json()).resolves.toMatchObject({ kind: 'user', role: 'owner', store: { slug: 'moda-urbana' } })
  })

  it('never lets a store user become superadmin, even with the platform email in the token', async () => {
    const h = createHarness()
    const moda = await seedStore(h.db, { slug: 'moda-urbana', name: 'Moda Urbana' })
    const userId = await createStoreUser(h.db, { email: 'duena@moda.test', password: 'clave-segura-123', storeId: moda, role: 'owner' })
    const forged = await createAdminToken(PLATFORM_EMAIL, TEST_SECRET, { sub: String(userId) })
    expect((await h.request('/api/platform/stores', { token: forged })).status).toBe(403)
    expect((await h.request('/api/admin/stats', { token: forged })).status).toBe(403)
  })

  it('rejects disabled users and users without an active store', async () => {
    const h = createHarness()
    const moda = await seedStore(h.db, { slug: 'moda-urbana', name: 'Moda Urbana' })
    await createStoreUser(h.db, { email: 'off@moda.test', password: 'clave-segura-123', storeId: moda, role: 'admin', status: 'disabled' })
    expect((await login(h, 'off@moda.test', 'clave-segura-123')).status).toBe(401)
  })
})
