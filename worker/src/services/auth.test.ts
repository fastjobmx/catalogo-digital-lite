import { describe, it, expect } from 'vitest'
import { createAdminToken, verifyAdminToken, validateCredentials, getJwtSecret } from './auth'

const SECRET = 'test-secret-with-at-least-32-characters'

const testEnv = {
  ADMIN_EMAIL: 'admin@example.com',
  ADMIN_PASSWORD: 'admin123',
  JWT_SECRET: SECRET,
} as unknown as Parameters<typeof validateCredentials>[2]

describe('auth - sesiones JWT del panel admin', () => {
  it('crea y verifica un token válido con el email embebido', async () => {
    const token = await createAdminToken('admin@example.com', SECRET)
    expect(typeof token).toBe('string')
    expect(token.split('.')).toHaveLength(3)

    const payload = await verifyAdminToken(token, SECRET)
    expect(payload).not.toBeNull()
    expect(payload?.email).toBe('admin@example.com')
    expect(payload?.exp).toBeGreaterThan(payload?.iat ?? 0)
  })

  it('rechaza un token firmado con otro secreto', async () => {
    const token = await createAdminToken('admin@example.com', SECRET)
    const payload = await verifyAdminToken(token, 'otro-secreto-distinto-de-32-chars!!')
    expect(payload).toBeNull()
  })

  it('rechaza un token corrupto', async () => {
    expect(await verifyAdminToken('no-es-un-jwt', SECRET)).toBeNull()
  })

  it('valida credenciales correctas e incorrectas', async () => {
    expect(await validateCredentials('admin@example.com', 'admin123', testEnv)).toBe(true)
    expect(await validateCredentials('admin@example.com', 'mal', testEnv)).toBe(false)
    expect(await validateCredentials('otro@example.com', 'admin123', testEnv)).toBe(false)
  })

  it('usa el secreto configurado', () => {
    expect(getJwtSecret(testEnv)).toBe(SECRET)
  })
})
