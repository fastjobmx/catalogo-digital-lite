const WINDOW_SECONDS = 15 * 60
const MAX_FAILURES = 8

async function digestKey(value: string): Promise<string> {
 const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
 return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function rateKeys(ip: string, email: string): Promise<string[]> {
 const normalizedIp = ip.trim().slice(0, 100) || 'unknown'
 const normalizedEmail = email.trim().toLowerCase().slice(0, 320)
 return Promise.all([digestKey(`admin-login-ip:${normalizedIp}`), digestKey(`admin-login-identity:${normalizedIp}:${normalizedEmail}`)])
}

export async function isAdminLoginBlocked(db: D1Database, ip: string, email: string): Promise<boolean> {
 const keys = await rateKeys(ip, email)
 const placeholders = keys.map(() => '?').join(',')
 const row = await db.prepare(
  `SELECT 1 AS blocked FROM admin_login_rate_limits WHERE rate_key IN (${placeholders}) AND blocked_until > unixepoch('now') LIMIT 1`,
 ).bind(...keys).first<{ blocked: number }>()
 return Boolean(row?.blocked)
}

export async function recordAdminLoginFailure(db: D1Database, ip: string, email: string): Promise<void> {
 const keys = await rateKeys(ip, email)
 await db.batch(keys.map((key) => db.prepare(
  `INSERT INTO admin_login_rate_limits (rate_key, window_started_at, failed_attempts)
   VALUES (?, unixepoch('now'), 1)
   ON CONFLICT(rate_key) DO UPDATE SET
    failed_attempts = CASE WHEN window_started_at <= unixepoch('now') - ? THEN 1 ELSE failed_attempts + 1 END,
    window_started_at = CASE WHEN window_started_at <= unixepoch('now') - ? THEN unixepoch('now') ELSE window_started_at END,
    blocked_until = CASE
      WHEN window_started_at <= unixepoch('now') - ? THEN NULL
      WHEN failed_attempts + 1 >= ? THEN unixepoch('now') + ?
      ELSE blocked_until END`,
  ).bind(key, WINDOW_SECONDS, WINDOW_SECONDS, WINDOW_SECONDS, MAX_FAILURES, WINDOW_SECONDS)))
}

export async function clearAdminLoginFailures(db: D1Database, ip: string, email: string): Promise<void> {
 const keys = await rateKeys(ip, email)
 const placeholders = keys.map(() => '?').join(',')
 await db.prepare(`DELETE FROM admin_login_rate_limits WHERE rate_key IN (${placeholders})`).bind(...keys).run()
}
