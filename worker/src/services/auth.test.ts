import { describe, it, expect } from 'vitest'
import { createAdminToken, hashAdminPassword, verifyAdminToken, validateCredentials, getJwtSecret, isAuthConfigurationReady } from './auth'

const SECRET = 'test-secret-with-at-least-32-characters'

const testEnv = {
  ENVIRONMENT: 'test',
  ADMIN_EMAIL: 'fixture-owner@unit.test',
  ADMIN_PASSWORD: 'unit-test-password-fixture',
  JWT_SECRET: SECRET,
} as unknown as Parameters<typeof validateCredentials>[2]

describe('auth - sesiones JWT del panel admin', () => {
  it('crea y verifica un token válido con el email embebido', async () => {
    const token = await createAdminToken('fixture-owner@unit.test', SECRET)
    expect(typeof token).toBe('string')
    expect(token.split('.')).toHaveLength(3)

    const payload = await verifyAdminToken(token, SECRET)
    expect(payload).not.toBeNull()
    expect(payload?.email).toBe('fixture-owner@unit.test')
    expect(payload?.exp).toBeGreaterThan(payload?.iat ?? 0)
  })

  it('rechaza un token firmado con otro secreto', async () => {
    const token = await createAdminToken('fixture-owner@unit.test', SECRET)
    const payload = await verifyAdminToken(token, 'otro-secreto-distinto-de-32-chars!!')
    expect(payload).toBeNull()
  })

  it('rechaza un token corrupto', async () => {
    expect(await verifyAdminToken('no-es-un-jwt', SECRET)).toBeNull()
  })

  it('valida credenciales correctas e incorrectas', async () => {
    expect(await validateCredentials('fixture-owner@unit.test', 'unit-test-password-fixture', testEnv)).toBe(true)
    expect(await validateCredentials('fixture-owner@unit.test', 'mal', testEnv)).toBe(false)
    expect(await validateCredentials('otro@example.com', 'unit-test-password-fixture', testEnv)).toBe(false)
  })

  it('usa el secreto configurado', () => {
    expect(getJwtSecret(testEnv)).toBe(SECRET)
  })

  it('rechaza iniciar sesión si falta configuración o el secreto es débil', async () => {
    expect(await validateCredentials('fixture-owner@unit.test', 'unit-test-password-fixture', { ...testEnv, JWT_SECRET: '' })).toBe(false)
    expect(getJwtSecret({ ...testEnv, JWT_SECRET: 'short' })).toBeNull()
    expect(getJwtSecret({ ...testEnv, ENVIRONMENT: 'production', JWT_SECRET: 'a'.repeat(64) })).toBeNull()
  })

  it('requiere credenciales propias y secretos fuertes en producción', () => {
    const production = {
      ENVIRONMENT: 'production',
      ADMIN_EMAIL: 'owner@acme-shop.com',
      ADMIN_PASSWORD: '',
      ADMIN_PASSWORD_HASH: 'pbkdf2_sha256$310000$abcdefghijklmnopqrstuvwx$' + 'a'.repeat(43),
      JWT_SECRET: 'd7a19c3f08b25e64a0f7c12d9835e4bf',
    } as unknown as typeof testEnv
    expect(isAuthConfigurationReady(production)).toBe(true)
    expect(isAuthConfigurationReady({ ...production, ADMIN_EMAIL: 'fixture-owner@unit.test' })).toBe(false)
    expect(isAuthConfigurationReady({ ...production, ADMIN_PASSWORD: 'unit-test-password-fixture' })).toBe(false)
    expect(isAuthConfigurationReady({ ...production, ADMIN_PASSWORD_HASH: undefined })).toBe(false)
    expect(isAuthConfigurationReady({ ...production, JWT_SECRET: 'dev only secret ' + 'c4'.repeat(30) })).toBe(false)
  })

  it('hashea y verifica contraseñas con PBKDF2 y rechaza hashes alterados', async () => {
    const hash = await hashAdminPassword('strong production fixture password')
    const production = {
      ENVIRONMENT: 'production',
      ADMIN_EMAIL: 'owner@acme-shop.com',
      ADMIN_PASSWORD_HASH: hash,
      JWT_SECRET: 'd7a19c3f08b25e64a0f7c12d9835e4bf',
    } as unknown as typeof testEnv
    expect(await validateCredentials('owner@acme-shop.com', 'strong production fixture password', production)).toBe(true)
    expect(await validateCredentials('owner@acme-shop.com', 'wrong password', production)).toBe(false)
    expect(await validateCredentials('other@acme-shop.com', 'strong production fixture password', production)).toBe(false)
  })

  it('acepta staging como entorno de pruebas remoto, con secreto JWT fuerte y rechaza nombres desconocidos', async () => {
    const staging = { ...testEnv, ENVIRONMENT: 'staging' } as typeof testEnv
    expect(isAuthConfigurationReady(staging)).toBe(true)
    expect(await validateCredentials('fixture-owner@unit.test', 'unit-test-password-fixture', staging)).toBe(true)
    expect(getJwtSecret({ ...staging, JWT_SECRET: 'short' })).toBeNull()
    expect(isAuthConfigurationReady({ ...staging, ENVIRONMENT: 'stage' } as typeof testEnv)).toBe(false)
  })
})
