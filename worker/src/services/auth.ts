import { SignJWT, jwtVerify } from 'jose'
import type { Env } from '../index'
import type { Principal } from '../tenancy/access'

export interface AdminToken {
 email: string
 iat: number
 exp: number
 /** Platform user id for store users. Absent for the platform superadmin. */
 sub?: string
 /** Explicit superadmin claim issued only after validating Worker secrets. */
 sa?: boolean
}

const MIN_JWT_SECRET_BYTES = 32
const KNOWN_DEMO_SECRETS = new Set([
 'secret',
 'changeme',
 'change-me',
 'replace-me',
 'placeholder',
 'example',
])

function isProduction(env: Env['Bindings']): boolean {
 return String(env.ENVIRONMENT || '').trim().toLowerCase() === 'production'
}

// Staging is a remote test environment: it follows the non-production rules
// (test password secret) but still requires a strong JWT secret.
function isRuntimeConfigured(env: Env['Bindings']): boolean {
 return ['development', 'test', 'staging', 'production'].includes(String(env.ENVIRONMENT || '').trim().toLowerCase())
}

function isStrongJwtSecret(secret: string, production: boolean): boolean {
 const bytes = new TextEncoder().encode(secret)
 if (bytes.length < MIN_JWT_SECRET_BYTES || bytes.length > 512) return false
 if (/^(.)\1+$/.test(secret)) return false
 if (!production) return true

 const normalized = secret.trim().toLowerCase()
 if (KNOWN_DEMO_SECRETS.has(normalized)) return false
 if (new Set(secret).size < 12) return false
 if (/^(.{1,8})\1+$/.test(secret)) return false
 return !/(change[-_ ]?me|replace[-_ ]?me|fallback|placeholder|example|demo|default|test[-_ ]?secret|dev[-_ ]?only)/i.test(secret)
}

function isProductionAdminConfiguration(email: string, passwordHash: string): boolean {
 const normalizedEmail = email.trim().toLowerCase()
 if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) return false
 if (/(?:@example\.(?:com|org|net)$|@localhost$|\.local$|demo|test|placeholder|change[-_ ]?me)/i.test(normalizedEmail)) return false
 return /^pbkdf2_sha256\$\d{6,}\$[A-Za-z0-9_-]{16,}\$[A-Za-z0-9_-]{40,}$/.test(passwordHash)
}

export function isAuthConfigurationReady(env: Env['Bindings']): boolean {
 if (!isRuntimeConfigured(env)) return false
 const email = String(env.ADMIN_EMAIL || '').trim()
 const password = String(env.ADMIN_PASSWORD || '')
 const passwordHash = String(env.ADMIN_PASSWORD_HASH || '')
 const secret = String(env.JWT_SECRET || '')
 if (!email || !isStrongJwtSecret(secret, isProduction(env))) return false
 if (isProduction(env) ? !passwordHash : !password) return false
 return !isProduction(env) || (!password && isProductionAdminConfiguration(email, passwordHash))
}

// Cloudflare Workers limits PBKDF2 derivations to 100,000 iterations.
// The production password is generated with 256 bits of random entropy.
const PBKDF2_ITERATIONS = 100_000

function encodeBase64Url(bytes: Uint8Array): string {
 let binary = ''
 for (const byte of bytes) binary += String.fromCharCode(byte)
 return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function decodeBase64Url(value: string): Uint8Array {
 const base64 = value.replaceAll('-', '+').replaceAll('_', '/')
 const binary = atob(base64 + '='.repeat((4 - base64.length % 4) % 4))
 return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

export async function hashAdminPassword(password: string, salt = crypto.getRandomValues(new Uint8Array(18))): Promise<string> {
 const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
 const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS }, key, 256)
 return `pbkdf2_sha256$${PBKDF2_ITERATIONS}$${encodeBase64Url(salt)}$${encodeBase64Url(new Uint8Array(bits))}`
}

/** Hash used for store users' passwords (same PBKDF2 scheme as the superadmin). */
export const hashPassword = hashAdminPassword

export async function verifyPasswordHash(password: string, encoded: string): Promise<boolean> {
 return verifyAdminPassword(password, encoded)
}

async function verifyAdminPassword(password: string, encoded: string): Promise<boolean> {
 const [algorithm, iterationText, saltText, hashText, extra] = encoded.split('$')
 const iterations = Number(iterationText)
 if (!algorithm || !saltText || !hashText || algorithm !== 'pbkdf2_sha256' || extra !== undefined || !Number.isInteger(iterations) || iterations < PBKDF2_ITERATIONS || iterations > 1_000_000) return false
 try {
  const salt = decodeBase64Url(saltText)
  const expected = decodeBase64Url(hashText)
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const actual = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, expected.length * 8))
  if (actual.length !== expected.length) return false
  let difference = 0
  for (let index = 0; index < actual.length; index++) difference |= (actual[index] ?? 0) ^ (expected[index] ?? 0)
  return difference === 0
 } catch { return false }
}

export async function createAdminToken(email: string, secret: string, claims: { sub?: string; sa?: boolean } = { sa: true }): Promise<string> {
 const secretKey = new TextEncoder().encode(secret)

 const payload: Record<string, unknown> = { email }
 if (claims.sa) payload.sa = true
 const builder = new SignJWT(payload)
 if (claims.sub) builder.setSubject(claims.sub)
 const jwt = await builder
 .setProtectedHeader({ alg: 'HS256' })
 .setIssuedAt()
 .setExpirationTime('24h')
 .sign(secretKey)

 return jwt
}

export async function verifyAdminToken(token: string, secret: string): Promise<AdminToken | null> {
 try {
 const secretKey = new TextEncoder().encode(secret)
 const { payload } = await jwtVerify(token, secretKey)
  if (typeof payload.email !== 'string' || !payload.email || typeof payload.iat !== 'number' || typeof payload.exp !== 'number') return null
  if (payload.sub !== undefined && !/^\d{1,12}$/.test(String(payload.sub))) return null
  if (payload.sub !== undefined && payload.sa) return null
  return payload as unknown as AdminToken
 } catch {
 return null
 }
}

export async function validateCredentials(
 email: string,
 password: string,
 env: Env['Bindings']
): Promise<boolean> {
 if (!isAuthConfigurationReady(env)) return false
 const adminEmail = String(env.ADMIN_EMAIL || '').trim()
 const emailMatches = email.trim().toLowerCase() === adminEmail.toLowerCase()
 const passwordMatches = isProduction(env)
  ? await verifyAdminPassword(password, String(env.ADMIN_PASSWORD_HASH || ''))
  : password === String(env.ADMIN_PASSWORD || '')
 return emailMatches && passwordMatches
}

export function getJwtSecret(env: Env['Bindings']): string | null {
 if (!isRuntimeConfigured(env)) return null
 const secret = String(env.JWT_SECRET || '')
 return isStrongJwtSecret(secret, isProduction(env)) ? secret : null
}

/** Maps a verified token to the acting principal. Store-user tokens always carry
 * a numeric subject and can never become superadmin. Tokens issued before the
 * multi-store release only carried the superadmin email. */
export function principalFromToken(token: AdminToken, env: Env['Bindings']): Principal | null {
 if (token.sub !== undefined) {
  const userId = Number(token.sub)
  return Number.isSafeInteger(userId) && userId > 0 ? { kind: 'user', userId, email: token.email } : null
 }
 const adminEmail = String(env.ADMIN_EMAIL || '').trim().toLowerCase()
 if (adminEmail && token.email.trim().toLowerCase() === adminEmail) return { kind: 'superadmin', email: token.email }
 return null
}

export function isSuperadminEmail(email: string, env: Env['Bindings']): boolean {
 const adminEmail = String(env.ADMIN_EMAIL || '').trim().toLowerCase()
 return Boolean(adminEmail) && email.trim().toLowerCase() === adminEmail
}
