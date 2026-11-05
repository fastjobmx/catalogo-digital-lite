/** Password reset for panel accounts. The response never reveals whether an email exists.
 * The single-use link (60 minutes, only its SHA-256 is stored) is delivered by email when the
 * account's address is verified and email is configured, otherwise through the Telegram account
 * already linked to that user. Nobody (not even the superadmin) ever sees the link or the token. */
import type { Env } from '../index'
import { adminStoreUrl } from '../tenancy/stores'
import { createAccessToken, markTokenDelivery, normalizeEmail, sha256Hex } from './platformUsers'
import { isAdminLoginBlocked, recordAdminLoginFailure } from './loginRateLimit'
import { sendTelegramMessage } from './assistant/telegramApi'
import { sendEmail } from '../email/send'

export const RESET_TTL_SECONDS = 60 * 60

export type ResetDelivery = 'email' | 'telegram' | 'none'

export function maskEmail(email: string): string {
  const [user = '', domain = ''] = email.split('@')
  return `${user.slice(0, 2)}${'•'.repeat(Math.max(1, Math.min(6, user.length - 2)))}@${domain}`
}

export type ResetTarget = { id: number; email: string; displayName: string; emailVerified: boolean; telegram_user_id: string | null; storeId: number; slug: string; storeName: string }

const TARGET_COLUMNS = `u.id, u.email, u.display_name AS displayName, u.email_verified_at IS NOT NULL AS emailVerified, u.telegram_user_id, s.id AS storeId, s.slug, s.name AS storeName`

async function findResetTarget(db: D1Database, email: string): Promise<ResetTarget | null> {
  const row = await db.prepare(
    `SELECT ${TARGET_COLUMNS}
     FROM platform_users u
     JOIN store_memberships m ON m.user_id = u.id AND m.status = 'active'
     JOIN stores s ON s.id = m.store_id AND s.status <> 'cancelled'
     WHERE u.email = ? COLLATE NOCASE AND u.status <> 'disabled'
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, s.id LIMIT 1`,
  ).bind(email).first<ResetTarget>()
  return row ? { ...row, emailVerified: Boolean(row.emailVerified) } : null
}

/** The reset target for a member of one specific store (panel action). */
export async function findStoreMemberTarget(db: D1Database, storeId: number, userId: number): Promise<ResetTarget | null> {
  const row = await db.prepare(
    `SELECT ${TARGET_COLUMNS}
     FROM platform_users u JOIN store_memberships m ON m.user_id = u.id JOIN stores s ON s.id = m.store_id
     WHERE m.store_id = ? AND u.id = ? AND m.status = 'active' AND u.status <> 'disabled' AND u.email IS NOT NULL`,
  ).bind(storeId, userId).first<ResetTarget>()
  return row ? { ...row, emailVerified: Boolean(row.emailVerified) } : null
}

/** Creates a fresh link (older reset links of that user stop working) and delivers it. */
async function issueAndDeliver(db: D1Database, env: Env['Bindings'], target: ResetTarget, requestedBy: string): Promise<ResetDelivery> {
  await db.prepare(`UPDATE user_access_tokens SET used_at = unixepoch() WHERE user_id = ? AND purpose = 'password_reset' AND used_at IS NULL`).bind(target.id).run()
  const token = await createAccessToken(db, { userId: target.id, storeId: target.storeId, purpose: 'password_reset', ttlSeconds: RESET_TTL_SECONDS, createdBy: requestedBy })
  const link = `${adminStoreUrl(env.PUBLIC_STORE_BASE_URL, { id: target.storeId, slug: target.slug })}/restablecer?token=${encodeURIComponent(token)}`
  const delivery = await deliverResetLink(db, env, target, link, requestedBy, token)
  if (delivery !== 'none') await markTokenDelivery(db, token, 'password_reset', delivery)
  else await db.prepare(`UPDATE user_access_tokens SET used_at = unixepoch() WHERE user_id = ? AND purpose = 'password_reset' AND used_at IS NULL`).bind(target.id).run()
  return delivery
}

async function deliverResetLink(db: D1Database, env: Env['Bindings'], target: ResetTarget, link: string, requestedBy: string, token: string): Promise<ResetDelivery> {
  // Email only to a verified address, and only with an absolute https link.
  if (target.emailVerified && /^https:\/\//.test(link)) {
    try {
      const sent = await sendEmail(db, env, {
        template: { key: 'password_reset' }, to: target.email, purpose: 'password_reset', storeId: target.storeId, userId: target.id, requestedBy,
        // Keyed by the token's hash: one email per link, and the token itself is never stored.
        idempotencyKey: `password_reset:${await sha256Hex(`email:${token}`)}`,
        values: { nombre_usuario: target.displayName || target.email.split('@')[0]!, correo_usuario: target.email, nombre_comercio: target.storeName, vence_en: '60 minutos', enlace_recuperacion: link },
      })
      if (sent.status === 'enviado') return 'email'
    } catch { /* falls back to Telegram */ }
  }
  if (target.telegram_user_id && env.TELEGRAM_BOT_TOKEN && /^https:\/\//.test(link)) {
    try {
      await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, Number(target.telegram_user_id),
        `🔐 <b>Restablecer contraseña</b>\n\nRecibimos una solicitud para crear una contraseña nueva del panel para ${maskEmail(target.email)}.\n\nEl enlace sirve una sola vez y vence en 60 minutos. Si no fuiste tú, ignora este mensaje: tu contraseña actual sigue funcionando.`,
        'HTML', { inline_keyboard: [[{ text: '🔐 Crear contraseña nueva', url: link }]] })
      return 'telegram'
    } catch { return 'none' }
  }
  return 'none'
}

/** Public request: always the same answer, rate limited per IP and per email. */
export async function requestPasswordReset(db: D1Database, env: Env['Bindings'], rawEmail: unknown, ip: string): Promise<{ limited: boolean }> {
  const email = normalizeEmail(rawEmail)
  if (await isAdminLoginBlocked(db, ip, 'password_reset')) return { limited: true }
  await recordAdminLoginFailure(db, ip, 'password_reset')
  if (!email) return { limited: false }
  if (await isAdminLoginBlocked(db, ip, `password_reset:${email}`)) return { limited: true }
  await recordAdminLoginFailure(db, ip, `password_reset:${email}`)
  const target = await findResetTarget(db, email)
  if (!target) return { limited: false }
  const delivery = await issueAndDeliver(db, env, target, 'password_reset_request')
  await db.prepare(`INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id) VALUES (?, 'user', ?, ?, 'self', 'api', ?)`)
    .bind(delivery === 'none' ? 'password_reset_undeliverable' : 'password_reset_requested', String(target.id), JSON.stringify({ channel: delivery }), target.storeId).run()
  return { limited: false }
}

/** Administrative reset (panel or master bot): the same process as the public one. The caller only
 * learns the channel used; the link is never returned. */
export async function sendAdminPasswordReset(db: D1Database, env: Env['Bindings'], target: ResetTarget, actor: string, source: 'platform' | 'admin'): Promise<{ email: string; delivery: ResetDelivery }> {
  const delivery = await issueAndDeliver(db, env, target, actor)
  await db.prepare(`INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id) VALUES (?, 'user', ?, ?, ?, ?, ?)`)
    .bind(delivery === 'none' ? 'password_reset_undeliverable' : 'password_reset_issued', String(target.id), JSON.stringify({ channel: delivery }), actor, source, target.storeId).run()
  return { email: target.email, delivery }
}

/** Master bot: by email address. */
export async function adminPasswordReset(db: D1Database, env: Env['Bindings'], rawEmail: unknown, actor: string): Promise<{ email: string; delivery: ResetDelivery } | null> {
  const email = normalizeEmail(rawEmail)
  if (!email) return null
  const target = await findResetTarget(db, email)
  if (!target) return null
  return sendAdminPasswordReset(db, env, target, actor, 'platform')
}
