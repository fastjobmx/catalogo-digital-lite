import type { StoreRole } from '../tenancy/access'

export type AccessTokenPurpose = 'activation' | 'telegram_link' | 'password_reset'

const LINK_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Long random token for activation links (base64url, 192 bits). */
export function generateSecretToken(bytes = 24): string {
  const random = crypto.getRandomValues(new Uint8Array(bytes))
  let binary = ''
  for (const byte of random) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

/** Short code that is easy to type in Telegram (XXXX-XXXX-XX, ~49 bits, single use, expiring). */
export function generateLinkCode(): string {
  const random = crypto.getRandomValues(new Uint8Array(10))
  const chars = [...random].map((byte) => LINK_ALPHABET[byte % LINK_ALPHABET.length]).join('')
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8)}`
}

export function normalizeLinkCode(code: string): string {
  // Accepts "k7p2-mq9x-t4", "K7P2MQ9XT4" (deep links) or the canonical form.
  const compact = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
  return compact.length === 10 ? `${compact.slice(0, 4)}-${compact.slice(4, 8)}-${compact.slice(8)}` : compact
}

export async function createAccessToken(
  db: D1Database,
  input: { userId: number; storeId: number; purpose: AccessTokenPurpose; ttlSeconds: number; createdBy: string; token?: string },
): Promise<string> {
  const token = input.token ?? (input.purpose === 'telegram_link' ? generateLinkCode() : generateSecretToken())
  const key = input.purpose === 'telegram_link' ? normalizeLinkCode(token) : token
  // A new code replaces older unused codes of the same purpose for that user and store.
  await db.batch([
    db.prepare(`UPDATE user_access_tokens SET used_at = unixepoch() WHERE user_id = ? AND store_id = ? AND purpose = ? AND used_at IS NULL`)
      .bind(input.userId, input.storeId, input.purpose),
    db.prepare(`INSERT INTO user_access_tokens (token_hash, user_id, store_id, purpose, expires_at, created_by) VALUES (?, ?, ?, ?, unixepoch() + ?, ?)`)
      .bind(await sha256Hex(`${input.purpose}:${key}`), input.userId, input.storeId, input.purpose, input.ttlSeconds, input.createdBy),
  ])
  return token
}

/** Marks a token as used exactly once and returns its owner. */
export async function consumeAccessToken(db: D1Database, token: string, purpose: AccessTokenPurpose): Promise<{ userId: number; storeId: number; deliveredVia: string | null } | null> {
  const key = purpose === 'telegram_link' ? normalizeLinkCode(token) : token.trim()
  if (key.length < 8 || key.length > 200) return null
  const row = await db.prepare(
    `UPDATE user_access_tokens SET used_at = unixepoch()
     WHERE token_hash = ? AND purpose = ? AND used_at IS NULL AND expires_at > unixepoch()
     RETURNING user_id AS userId, store_id AS storeId, delivered_via AS deliveredVia`,
  ).bind(await sha256Hex(`${purpose}:${key}`), purpose).first<{ userId: number; storeId: number; deliveredVia: string | null }>()
  return row ?? null
}

/** Records how a link was delivered ('email', 'telegram' or 'manual'). Opening an emailed link proves the address. */
export async function markTokenDelivery(db: D1Database, token: string, purpose: AccessTokenPurpose, via: 'email' | 'telegram' | 'manual'): Promise<void> {
  await db.prepare('UPDATE user_access_tokens SET delivered_via = ? WHERE token_hash = ?').bind(via, await sha256Hex(`${purpose}:${token.trim()}`)).run()
}

/** Reads a token without consuming it (used to show the activation form). */
export async function peekAccessToken(db: D1Database, token: string, purpose: AccessTokenPurpose): Promise<{ userId: number; storeId: number; email: string | null; slug: string; storeName: string } | null> {
  if (token.trim().length < 8) return null
  return db.prepare(
    `SELECT t.user_id AS userId, t.store_id AS storeId, u.email, s.slug, s.name AS storeName
     FROM user_access_tokens t JOIN platform_users u ON u.id = t.user_id JOIN stores s ON s.id = t.store_id
     WHERE t.token_hash = ? AND t.purpose = ? AND t.used_at IS NULL AND t.expires_at > unixepoch()`,
  ).bind(await sha256Hex(`${purpose}:${token.trim()}`), purpose).first()
}

export function validatePasswordPolicy(password: string): string | null {
  if (password.length < 10) return 'La contraseña debe tener al menos 10 caracteres.'
  if (password.length > 200) return 'La contraseña es demasiado larga.'
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'Usa letras y números en la contraseña.'
  return null
}

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const email = value.trim().toLowerCase()
  return /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/.test(email) ? email : null
}

export async function findUserByEmail(db: D1Database, email: string): Promise<{ id: number; email: string; status: string; password_hash: string | null; display_name: string } | null> {
  return db.prepare('SELECT id, email, status, password_hash, display_name FROM platform_users WHERE email = ? COLLATE NOCASE').bind(email).first()
}

/** Returns the existing user for an email or creates an invited one. */
export async function ensureUser(db: D1Database, input: { email?: string | null; displayName?: string; createdBy: string }): Promise<number> {
  if (input.email) {
    const existing = await findUserByEmail(db, input.email)
    if (existing) {
      if (existing.status === 'disabled') throw new Error('USER_DISABLED')
      return existing.id
    }
  }
  const result = await db.prepare(
    `INSERT INTO platform_users (email, display_name, status, created_by) VALUES (?, ?, 'invited', ?)`,
  ).bind(input.email || null, (input.displayName || '').slice(0, 120), input.createdBy).run()
  return Number(result.meta.last_row_id)
}

export async function upsertMembership(db: D1Database, input: { storeId: number; userId: number; role: StoreRole; createdBy: string }): Promise<void> {
  await db.prepare(
    `INSERT INTO store_memberships (store_id, user_id, role, status, created_by) VALUES (?, ?, ?, 'active', ?)
     ON CONFLICT(store_id, user_id) DO UPDATE SET role = excluded.role, status = 'active', updated_at = datetime('now')`,
  ).bind(input.storeId, input.userId, input.role, input.createdBy).run()
}

export async function linkTelegramToUser(db: D1Database, userId: number, telegramUserId: string): Promise<'linked' | 'already_linked_elsewhere'> {
  const other = await db.prepare('SELECT id FROM platform_users WHERE telegram_user_id = ? AND id <> ?').bind(telegramUserId, userId).first()
  if (other) return 'already_linked_elsewhere'
  await db.prepare(
    `UPDATE platform_users SET telegram_user_id = ?, status = CASE WHEN status = 'invited' THEN 'active' ELSE status END, updated_at = datetime('now') WHERE id = ?`,
  ).bind(telegramUserId, userId).run()
  return 'linked'
}
