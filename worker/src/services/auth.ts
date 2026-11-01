import { SignJWT, jwtVerify } from 'jose'
import type { Env } from '../index'

export interface AdminToken {
 email: string
 iat: number
 exp: number
}

export async function createAdminToken(email: string, secret: string): Promise<string> {
 const secretKey = new TextEncoder().encode(secret)

 const jwt = await new SignJWT({ email })
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
 // jose returns JWTPayload which doesn't know about custom claims;
 // safe-cast through unknown since we control the signing side
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
 const adminEmail = env.ADMIN_EMAIL || 'admin@example.com'
 const adminPassword = env.ADMIN_PASSWORD || 'admin123'

 return email === adminEmail && password === adminPassword
}

export function getJwtSecret(env: Env['Bindings']): string {
 return env.JWT_SECRET || 'fallback-secret-change-in-production-32chars-min'
}