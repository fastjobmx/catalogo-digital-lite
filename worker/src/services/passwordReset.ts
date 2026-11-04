/** Password reset for panel accounts. The response never reveals whether an email
 * exists; the single-use link (60 minutes, only its SHA-256 is stored) is delivered
 * through the Telegram account already linked to that user. An email channel can be
 * added later in `deliverResetLink` without changing the flow. */
import type { Env } from '../index'
import { adminStoreUrl } from '../tenancy/stores'
import { createAccessToken, normalizeEmail } from './platformUsers'
import { isAdminLoginBlocked, recordAdminLoginFailure } from './loginRateLimit'
import { sendTelegramMessage } from './assistant/telegramApi'

export const RESET_TTL_SECONDS = 60 * 60

export type ResetDelivery = 'telegram' | 'none'

export function maskEmail(email: string): string {
  const [user = '', domain = ''] = email.split('@')
  return `${user.slice(0, 2)}${'•'.repeat(Math.max(1, Math.min(6, user.length - 2)))}@${domain}`
}

type ResetTarget = { id: number; email: string; telegram_user_id: string | null; storeId: number; slug: string }

async function findResetTarget(db: D1Database, email: string): Promise<ResetTarget | null> {
  return db.prepare(
    `SELECT u.id, u.email, u.telegram_user_id, s.id AS storeId, s.slug
     FROM platform_users u
     JOIN store_memberships m ON m.user_id = u.id AND m.status = 'active'
     JOIN stores s ON s.id = m.store_id AND s.status <> 'cancelled'
     WHERE u.email = ? COLLATE NOCASE AND u.status <> 'disabled'
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, s.id LIMIT 1`,
  ).bind(email).first<ResetTarget>()
}

/** Creates a fresh link (older reset links of that user stop working). */
export async function issueResetLink(db: D1Database, env: Env['Bindings'], target: ResetTarget, createdBy: string): Promise<string> {
  await db.prepare(`UPDATE user_access_tokens SET used_at = unixepoch() WHERE user_id = ? AND purpose = 'password_reset' AND used_at IS NULL`).bind(target.id).run()
  const token = await createAccessToken(db, { userId: target.id, storeId: target.storeId, purpose: 'password_reset', ttlSeconds: RESET_TTL_SECONDS, createdBy })
  return `${adminStoreUrl(env.PUBLIC_STORE_BASE_URL, { id: target.storeId, slug: target.slug })}/restablecer?token=${encodeURIComponent(token)}`
}

async function deliverResetLink(env: Env['Bindings'], target: ResetTarget, link: string): Promise<ResetDelivery> {
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
  const link = await issueResetLink(db, env, target, 'password_reset_request')
  const delivery = await deliverResetLink(env, target, link)
  await db.prepare(`INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id) VALUES (?, 'user', ?, ?, 'self', 'api', ?)`)
    .bind(delivery === 'none' ? 'password_reset_undeliverable' : 'password_reset_requested', String(target.id), JSON.stringify({ channel: delivery }), target.storeId).run()
  return { limited: false }
}

/** Superadmin (bot maestro): sends the link to the user's Telegram, or returns it to share privately. */
export async function adminPasswordReset(db: D1Database, env: Env['Bindings'], rawEmail: unknown, actor: string): Promise<{ email: string; delivery: ResetDelivery; link: string | null } | null> {
  const email = normalizeEmail(rawEmail)
  if (!email) return null
  const target = await findResetTarget(db, email)
  if (!target) return null
  const link = await issueResetLink(db, env, target, actor)
  const delivery = await deliverResetLink(env, target, link)
  await db.prepare(`INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id) VALUES ('password_reset_issued', 'user', ?, ?, ?, 'platform', ?)`)
    .bind(String(target.id), JSON.stringify({ channel: delivery }), actor, target.storeId).run()
  return { email: target.email, delivery, link: delivery === 'none' ? link : null }
}
