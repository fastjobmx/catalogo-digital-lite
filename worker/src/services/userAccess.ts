/** "Usuarios y accesos": email verification, invitations and member status for one store.
 * Every action is scoped to the store resolved by the backend; a store can never touch members
 * of another store. Administrators learn whether and when something was sent, never links or tokens. */
import type { Env } from '../index'
import { adminStoreUrl } from '../tenancy/stores'
import { createAccessToken, generateSecretToken, markTokenDelivery, sha256Hex } from './platformUsers'
import { sendEmail, emailConfig } from '../email/send'
import { findStoreMemberTarget, sendAdminPasswordReset } from './passwordReset'

export const VERIFICATION_TTL_SECONDS = 48 * 3600
export const INVITATION_TTL_SECONDS = 72 * 3600

export class AccessError extends Error {
  constructor(readonly code: string, message: string, readonly status: 400 | 403 | 404 | 409 | 429 = 400) { super(message) }
}

async function audit(db: D1Database, action: string, userId: number, storeId: number | null, payload: unknown, actor: string, source: string) {
  await db.prepare(`INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id) VALUES (?, 'user', ?, ?, ?, ?, ?)`)
    .bind(action, String(userId), JSON.stringify(payload), actor, source, storeId).run()
}

type Member = { id: number; email: string | null; displayName: string; status: string; role: string; membershipStatus: string; passwordSet: number; emailVerifiedAt: string | null; lastLoginAt: string | null; telegramLinked: number; createdAt: string }

/** Members of one store with what the panel may show (no hashes, no tokens). */
export async function listStoreMembers(db: D1Database, storeId: number) {
  const { results } = await db.prepare(
    `SELECT u.id, u.email, u.display_name AS displayName, u.status, m.role, m.status AS membershipStatus,
            u.password_hash IS NOT NULL AS passwordSet, u.email_verified_at AS emailVerifiedAt, u.last_login_at AS lastLoginAt,
            u.telegram_user_id IS NOT NULL AS telegramLinked, m.created_at AS createdAt
     FROM store_memberships m JOIN platform_users u ON u.id = m.user_id
     WHERE m.store_id = ? ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.email`,
  ).bind(storeId).all<Member>()
  const { results: messages } = await db.prepare(
    `SELECT user_id AS userId, purpose, status, created_at AS createdAt FROM email_messages
     WHERE store_id = ? AND user_id IS NOT NULL AND id IN (SELECT MAX(id) FROM email_messages WHERE store_id = ? GROUP BY user_id, purpose)`,
  ).bind(storeId, storeId).all<{ userId: number; purpose: string; status: string; createdAt: string }>()
  const { results: resets } = await db.prepare(
    `SELECT entity_id AS userId, action, payload, created_at AS createdAt FROM audit_log
     WHERE store_id = ? AND entity_type = 'user' AND action IN ('password_reset_issued', 'password_reset_requested', 'password_reset_undeliverable')
       AND id IN (SELECT MAX(id) FROM audit_log WHERE store_id = ? AND entity_type = 'user' AND action IN ('password_reset_issued', 'password_reset_requested', 'password_reset_undeliverable') GROUP BY entity_id)`,
  ).bind(storeId, storeId).all<{ userId: string; action: string; payload: string; createdAt: string }>()
  return (results || []).map((member) => {
    const reset = (resets || []).find((row) => Number(row.userId) === member.id)
    let channel: string | null = null
    try { channel = reset ? (JSON.parse(reset.payload) as { channel?: string }).channel ?? null : null } catch { channel = null }
    return {
      id: member.id, email: member.email, displayName: member.displayName, role: member.role,
      status: member.status === 'disabled' ? 'deshabilitado' : member.membershipStatus !== 'active' ? 'inactivo' : member.passwordSet ? 'activo' : 'invitado',
      emailVerified: Boolean(member.emailVerifiedAt), emailVerifiedAt: member.emailVerifiedAt, lastLoginAt: member.lastLoginAt,
      telegramLinked: Boolean(member.telegramLinked), createdAt: member.createdAt,
      lastPasswordReset: reset ? { at: reset.createdAt, channel: reset.action === 'password_reset_undeliverable' ? 'none' : channel } : null,
      emails: (messages || []).filter((row) => row.userId === member.id).map(({ purpose, status, createdAt }) => ({ purpose, status, createdAt })),
    }
  })
}

async function memberOf(db: D1Database, storeId: number, userId: number) {
  const row = await db.prepare(
    `SELECT u.id, u.email, u.display_name AS displayName, u.status, u.password_hash IS NOT NULL AS passwordSet, u.email_verified_at AS verifiedAt,
            m.role, m.status AS membershipStatus, s.id AS storeId, s.slug, s.name AS storeName
     FROM store_memberships m JOIN platform_users u ON u.id = m.user_id JOIN stores s ON s.id = m.store_id
     WHERE m.store_id = ? AND m.user_id = ?`,
  ).bind(storeId, userId).first<{ id: number; email: string | null; displayName: string; status: string; passwordSet: number; verifiedAt: string | null; role: string; membershipStatus: string; storeId: number; slug: string; storeName: string }>()
  if (!row) throw new AccessError('MEMBER_NOT_FOUND', 'Ese usuario no pertenece a esta tienda', 404)
  return row
}

/** Same reset process as "¿Olvidaste tu contraseña?", started by an administrator. */
export async function resetMemberPassword(db: D1Database, env: Env['Bindings'], storeId: number, userId: number, actor: string) {
  const member = await memberOf(db, storeId, userId)
  if (!member.passwordSet) throw new AccessError('NOT_ACTIVATED', 'Esta persona todavía no activó su cuenta: reenvía la invitación', 409)
  const target = await findStoreMemberTarget(db, storeId, userId)
  if (!target) throw new AccessError('MEMBER_INACTIVE', 'El usuario está inactivo en esta tienda', 409)
  const recent = await db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE entity_type = 'user' AND entity_id = ? AND action IN ('password_reset_issued', 'password_reset_requested') AND created_at >= datetime('now', '-2 minutes')`).bind(String(userId)).first<{ n: number }>()
  if (Number(recent?.n || 0) > 0) throw new AccessError('TOO_SOON', 'Ya se envió un enlace hace menos de 2 minutos', 429)
  const result = await sendAdminPasswordReset(db, env, target, actor, 'admin')
  return { delivery: result.delivery, sentAt: new Date().toISOString() }
}

/** Sends a link that only confirms the address. It gives no access to the panel. */
export async function requestEmailVerification(db: D1Database, env: Env['Bindings'], storeId: number, userId: number, actor: string) {
  const member = await memberOf(db, storeId, userId)
  if (!member.email) throw new AccessError('NO_EMAIL', 'Este usuario no tiene correo')
  if (member.verifiedAt) throw new AccessError('ALREADY_VERIFIED', 'El correo ya está verificado', 409)
  if (!emailConfig(env).configured) throw new AccessError('EMAIL_NOT_CONFIGURED', 'El envío de correos todavía no está configurado en la plataforma', 409)
  const recent = await db.prepare(`SELECT COUNT(*) AS n FROM email_messages WHERE user_id = ? AND purpose = 'email_verification' AND created_at >= datetime('now', '-2 minutes')`).bind(userId).first<{ n: number }>()
  if (Number(recent?.n || 0) > 0) throw new AccessError('TOO_SOON', 'Ya se envió un enlace hace menos de 2 minutos', 429)
  const token = generateSecretToken(32)
  const hash = await sha256Hex(`email_verification:${token}`)
  await db.batch([
    db.prepare('UPDATE email_verification_tokens SET used_at = unixepoch() WHERE user_id = ? AND used_at IS NULL').bind(userId),
    db.prepare('INSERT INTO email_verification_tokens (token_hash, user_id, email, expires_at, created_by) VALUES (?, ?, ?, unixepoch() + ?, ?)').bind(hash, userId, member.email, VERIFICATION_TTL_SECONDS, actor),
  ])
  const link = `${adminStoreUrl(env.PUBLIC_STORE_BASE_URL, { id: member.storeId, slug: member.slug })}/verificar-correo?token=${encodeURIComponent(token)}`
  const sent = await sendEmail(db, env, {
    template: { key: 'email_verification' }, to: member.email, purpose: 'email_verification', storeId, userId, requestedBy: actor,
    idempotencyKey: `email_verification:${hash}`,
    values: { nombre_usuario: member.displayName || member.email.split('@')[0]!, correo_usuario: member.email, nombre_comercio: member.storeName, vence_en: '48 horas', enlace_verificacion: link },
  })
  if (sent.status !== 'enviado') await db.prepare('UPDATE email_verification_tokens SET used_at = unixepoch() WHERE token_hash = ?').bind(hash).run()
  await audit(db, 'email_verification_sent', userId, storeId, { status: sent.status }, actor, 'admin')
  return { status: sent.status, sentAt: new Date().toISOString() }
}

/** Public: confirms an address with a verification link (single use, only if the address did not change). */
export async function confirmEmailVerification(db: D1Database, token: string) {
  if (token.length < 20 || token.length > 200) return null
  const row = await db.prepare(
    `UPDATE email_verification_tokens SET used_at = unixepoch() WHERE token_hash = ? AND used_at IS NULL AND expires_at > unixepoch() RETURNING user_id AS userId, email`,
  ).bind(await sha256Hex(`email_verification:${token.trim()}`)).first<{ userId: number; email: string }>()
  if (!row) return null
  const updated = await db.prepare(`UPDATE platform_users SET email_verified_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND email = ? COLLATE NOCASE AND status <> 'disabled' RETURNING id`).bind(row.userId, row.email).first()
  if (!updated) return null
  await audit(db, 'email_verified', row.userId, null, {}, 'self', 'api')
  return { verified: true }
}

/** Resends the activation invitation. By email when configured (invitations go to the address the
 * store authorised); otherwise the one-time link is returned to share privately, as before. */
export async function resendInvitation(db: D1Database, env: Env['Bindings'], storeId: number, userId: number, actor: string) {
  const member = await memberOf(db, storeId, userId)
  if (!member.email) throw new AccessError('NO_EMAIL', 'Este usuario no tiene correo')
  if (member.passwordSet) throw new AccessError('ALREADY_ACTIVE', 'La cuenta ya está activa: usa «Enviar enlace para restablecer contraseña»', 409)
  if (member.membershipStatus !== 'active' || member.status === 'disabled') throw new AccessError('MEMBER_INACTIVE', 'El usuario está inactivo en esta tienda', 409)
  return sendInvitation(db, env, { userId, email: member.email, displayName: member.displayName, storeId, slug: member.slug, storeName: member.storeName }, actor)
}

export async function sendInvitation(db: D1Database, env: Env['Bindings'], user: { userId: number; email: string; displayName: string; storeId: number; slug: string; storeName: string }, actor: string) {
  const token = await createAccessToken(db, { userId: user.userId, storeId: user.storeId, purpose: 'activation', ttlSeconds: INVITATION_TTL_SECONDS, createdBy: actor })
  const link = `${adminStoreUrl(env.PUBLIC_STORE_BASE_URL, { id: user.storeId, slug: user.slug })}/activar?token=${encodeURIComponent(token)}`
  let delivery: 'email' | 'manual' = 'manual'
  if (emailConfig(env).configured && /^https:\/\//.test(link)) {
    const sent = await sendEmail(db, env, {
      template: { key: 'invitation' }, to: user.email, purpose: 'invitation', storeId: user.storeId, userId: user.userId, requestedBy: actor,
      idempotencyKey: `invitation:${await sha256Hex(`email:${token}`)}`,
      values: { nombre_usuario: user.displayName || user.email.split('@')[0]!, correo_usuario: user.email, nombre_comercio: user.storeName, vence_en: '72 horas', enlace_invitacion: link },
    })
    if (sent.status === 'enviado') delivery = 'email'
  }
  await markTokenDelivery(db, token, 'activation', delivery)
  await audit(db, 'invitation_sent', user.userId, user.storeId, { delivery }, actor, 'admin')
  return { delivery, sentAt: new Date().toISOString(), activationUrl: delivery === 'manual' ? link : null }
}

/** Activates or deactivates someone's access to this store only (other stores are not affected). */
export async function setMemberAccess(db: D1Database, storeId: number, userId: number, active: boolean, actor: string, actorUserId: number | null) {
  const member = await memberOf(db, storeId, userId)
  if (member.role === 'owner') throw new AccessError('OWNER_PROTECTED', 'El acceso del propietario no se desactiva aquí: usa la regularización de propietario', 409)
  if (actorUserId === userId) throw new AccessError('SELF', 'No puedes cambiar tu propio acceso', 409)
  if (member.status === 'disabled' && active) throw new AccessError('USER_DISABLED', 'La cuenta está deshabilitada en la plataforma', 409)
  await db.prepare(`UPDATE store_memberships SET status = ?, updated_at = datetime('now') WHERE store_id = ? AND user_id = ?`).bind(active ? 'active' : 'revoked', storeId, userId).run()
  await audit(db, active ? 'member_access_enabled' : 'member_access_disabled', userId, storeId, { role: member.role }, actor, 'admin')
  return { active }
}
