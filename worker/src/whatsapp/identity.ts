/**
 * Quién escribe por WhatsApp. Un número solo administra tiendas después de vincularse con un código
 * de un solo uso generado por un usuario autenticado de TiendIA Exprés; conocer el teléfono del
 * propietario no da acceso a nada.
 */
import { generateLinkCode, normalizeLinkCode, sha256Hex } from '../services/platformUsers'

export const LINK_CODE_TTL_SECONDS = 15 * 60
const LINK_FAILURES_MAX = 5
const LINK_FAILURES_WINDOW = 60 * 60

/** Remitente tal como lo entrega Meta: identificador de usuario (BSUID) y/o teléfono. */
export type Sender = { businessUserId: string | null; phone: string | null; key: string; name: string }

export type WhatsAppIdentity = { id: number; userId: number; businessUserId: string | null; phone: string | null; lastInboundAt: number | null; menuJson: string | null }

const IDENTITY_COLUMNS = 'id, user_id AS userId, business_user_id AS businessUserId, phone, last_inbound_at AS lastInboundAt, menu_json AS menuJson'

export function senderFrom(message: { from?: unknown; from_user_id?: unknown }, contacts: Array<{ wa_id?: unknown; user_id?: unknown; profile?: { name?: unknown } }> = []): Sender | null {
  const clean = (value: unknown, pattern: RegExp) => (typeof value === 'string' && pattern.test(value) ? value : null)
  const contact = contacts.find((item) => (message.from_user_id && item.user_id === message.from_user_id) || (message.from && item.wa_id === message.from)) || contacts[0]
  const businessUserId = clean(message.from_user_id, /^[A-Za-z0-9._-]{3,160}$/) ?? clean(contact?.user_id, /^[A-Za-z0-9._-]{3,160}$/)
  const phone = clean(message.from, /^\d{6,20}$/) ?? clean(contact?.wa_id, /^\d{6,20}$/)
  if (!businessUserId && !phone) return null
  const name = typeof contact?.profile?.name === 'string' ? contact.profile.name.replace(/[<>&]/g, '').trim().split(/\s+/)[0]?.slice(0, 40) || '' : ''
  return { businessUserId, phone, key: businessUserId || phone!, name }
}

/** Identidad activa del remitente. Un teléfono que ahora pertenece a otro usuario de WhatsApp no hereda el vínculo. */
export async function findIdentity(db: D1Database, sender: Sender): Promise<WhatsAppIdentity | null> {
  if (sender.businessUserId) {
    const byUser = await db.prepare(`SELECT ${IDENTITY_COLUMNS} FROM whatsapp_identities WHERE business_user_id = ? AND status = 'active'`).bind(sender.businessUserId).first<WhatsAppIdentity>()
    if (byUser) {
      if (sender.phone && byUser.phone !== sender.phone) {
        await db.prepare(`UPDATE whatsapp_identities SET phone = ? WHERE id = ? AND NOT EXISTS (SELECT 1 FROM whatsapp_identities WHERE phone = ? AND status = 'active' AND id <> ?)`)
          .bind(sender.phone, byUser.id, sender.phone, byUser.id).run().catch(() => undefined)
      }
      return { ...byUser, phone: sender.phone ?? byUser.phone }
    }
  }
  if (!sender.phone) return null
  const byPhone = await db.prepare(`SELECT ${IDENTITY_COLUMNS} FROM whatsapp_identities WHERE phone = ? AND status = 'active'`).bind(sender.phone).first<WhatsAppIdentity>()
  if (!byPhone) return null
  if (byPhone.businessUserId && sender.businessUserId && byPhone.businessUserId !== sender.businessUserId) return null
  if (!byPhone.businessUserId && sender.businessUserId) {
    await db.prepare('UPDATE whatsapp_identities SET business_user_id = ? WHERE id = ?').bind(sender.businessUserId, byPhone.id).run().catch(() => undefined)
    return { ...byPhone, businessUserId: sender.businessUserId }
  }
  return byPhone
}

/** Cuenta un evento dentro de una ventana y devuelve cuántos van. */
export async function throttle(db: D1Database, senderKey: string, kind: 'link_failures' | 'messages' | 'unlinked_notice', windowSeconds: number, increment = true): Promise<number> {
  const now = Math.floor(Date.now() / 1000)
  if (!increment) {
    const row = await db.prepare('SELECT count FROM whatsapp_throttles WHERE sender_key = ? AND kind = ? AND window_started_at > ?').bind(senderKey, kind, now - windowSeconds).first<{ count: number }>()
    return Number(row?.count || 0)
  }
  const row = await db.prepare(
    `INSERT INTO whatsapp_throttles (sender_key, kind, window_started_at, count) VALUES (?, ?, ?, 1)
     ON CONFLICT(sender_key, kind) DO UPDATE SET
       count = CASE WHEN window_started_at <= ? THEN 1 ELSE count + 1 END,
       window_started_at = CASE WHEN window_started_at <= ? THEN excluded.window_started_at ELSE window_started_at END
     RETURNING count`,
  ).bind(senderKey, kind, now, now - windowSeconds, now - windowSeconds).first<{ count: number }>()
  return Number(row?.count || 1)
}

/** Código de vinculación para un usuario autenticado. Reemplaza los códigos anteriores sin usar de ese usuario. */
export async function createLinkCode(db: D1Database, input: { userId: number; storeId: number; createdBy: string }): Promise<{ code: string; expiresAt: string }> {
  const code = generateLinkCode()
  await db.batch([
    db.prepare('UPDATE whatsapp_link_tokens SET used_at = unixepoch() WHERE user_id = ? AND used_at IS NULL').bind(input.userId),
    db.prepare('INSERT INTO whatsapp_link_tokens (token_hash, user_id, store_id, expires_at, created_by) VALUES (?, ?, ?, unixepoch() + ?, ?)')
      .bind(await sha256Hex(`whatsapp_link:${normalizeLinkCode(code)}`), input.userId, input.storeId, LINK_CODE_TTL_SECONDS, input.createdBy),
    db.prepare(`INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id) VALUES ('whatsapp_link_code_generated', 'user', ?, '{}', ?, 'admin', ?)`)
      .bind(String(input.userId), input.createdBy, input.storeId),
  ])
  return { code, expiresAt: new Date(Date.now() + LINK_CODE_TTL_SECONDS * 1000).toISOString() }
}

/** "VINCULAR K7P2-MQ9X-T4" o el código con sus guiones. Una palabra suelta nunca se toma por código. */
export function linkCodeIn(text: string): string | null {
  const keyword = text.match(/^\s*\/?(?:vincular|link)[\s:]+([A-Za-z0-9-]{10,14})\s*$/i)?.[1]
  const dashed = text.match(/^\s*([A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{2})\s*$/)?.[1]
  const candidate = keyword || dashed
  if (!candidate) return null
  const normalized = normalizeLinkCode(candidate)
  return /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{2}$/.test(normalized) ? normalized : null
}

export type LinkResult = { ok: boolean; message: string; identityId?: number; storeId?: number }

export async function linkWhatsApp(db: D1Database, sender: Sender, code: string): Promise<LinkResult> {
  if (await throttle(db, sender.key, 'link_failures', LINK_FAILURES_WINDOW, false) >= LINK_FAILURES_MAX) {
    return { ok: false, message: 'Hubo demasiados intentos con códigos incorrectos desde este WhatsApp. Espera una hora y genera un código nuevo desde tu cuenta de TiendIA Exprés.' }
  }
  const existing = await findIdentity(db, sender)
  const hash = await sha256Hex(`whatsapp_link:${code}`)
  // The code is spent in the same statement that reads it: it can never be used twice.
  const token = await db.prepare(
    `UPDATE whatsapp_link_tokens SET used_at = unixepoch() WHERE token_hash = ? AND used_at IS NULL AND expires_at > unixepoch()
     RETURNING user_id AS userId, store_id AS storeId`,
  ).bind(hash).first<{ userId: number; storeId: number }>()
  if (!token) {
    await throttle(db, sender.key, 'link_failures', LINK_FAILURES_WINDOW)
    return { ok: false, message: 'Ese código no es válido o ya venció. Genera uno nuevo desde tu cuenta de TiendIA Exprés; cada código sirve una sola vez y dura 15 minutos.' }
  }
  if (existing) {
    return existing.userId === token.userId
      ? { ok: false, message: 'Este WhatsApp ya está vinculado a tu cuenta. Escribe <b>hola</b> para empezar.' }
      : { ok: false, message: 'Este WhatsApp ya está vinculado a otra cuenta de TiendIA Exprés. Escribe <b>desvincular</b> primero si quieres cambiarlo.' }
  }
  const access = await db.prepare(
    `SELECT s.name FROM store_memberships m JOIN stores s ON s.id = m.store_id JOIN platform_users u ON u.id = m.user_id
     WHERE m.store_id = ? AND m.user_id = ? AND m.status = 'active' AND u.status = 'active' AND s.status <> 'cancelled'`,
  ).bind(token.storeId, token.userId).first<{ name: string }>()
  if (!access) return { ok: false, message: 'Ese código ya no da acceso a una tienda activa. Genera uno nuevo desde tu cuenta.' }
  // One WhatsApp per account: replacing it requires revoking the current one first, from the account itself.
  const other = await db.prepare(`SELECT id FROM whatsapp_identities WHERE user_id = ? AND status = 'active'`).bind(token.userId).first<{ id: number }>()
  if (other) return { ok: false, message: 'Esa cuenta ya tiene otro WhatsApp vinculado. Desvincúlalo primero desde tu cuenta de TiendIA Exprés y genera un código nuevo.' }
  let identityId: number
  try {
    const inserted = await db.prepare('INSERT INTO whatsapp_identities (user_id, business_user_id, phone, linked_store_id, last_inbound_at) VALUES (?, ?, ?, ?, unixepoch())')
      .bind(token.userId, sender.businessUserId, sender.phone, token.storeId).run()
    identityId = Number(inserted.meta.last_row_id)
  } catch {
    return { ok: false, message: 'No pude completar la vinculación. Genera un código nuevo e inténtalo otra vez.' }
  }
  await db.batch([
    db.prepare('UPDATE whatsapp_link_tokens SET used_by_identity = ? WHERE token_hash = ?').bind(identityId, hash),
    db.prepare(`INSERT INTO telegram_sessions (telegram_user_id, active_store_id, context_json) VALUES (?, ?, '{}')
      ON CONFLICT(telegram_user_id) DO UPDATE SET active_store_id = excluded.active_store_id, context_json = '{}', updated_at = unixepoch()`).bind(`wa:${identityId}`, token.storeId),
    db.prepare(`INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id) VALUES ('whatsapp_linked', 'user', ?, ?, ?, 'whatsapp', ?)`)
      .bind(String(token.userId), JSON.stringify({ identityId, phoneEnding: sender.phone?.slice(-4) ?? null }), `whatsapp:${identityId}`, token.storeId),
    db.prepare(`DELETE FROM whatsapp_throttles WHERE sender_key = ? AND kind = 'link_failures'`).bind(sender.key),
  ])
  return { ok: true, identityId, storeId: token.storeId, message: `✅ ¡Listo! Este WhatsApp quedó vinculado a <b>${access.name.replace(/[<>&]/g, '')}</b>.\nEscribe <b>hola</b> para empezar. Si administras otras tiendas, escribe <b>tiendas</b> para cambiar entre ellas.` }
}

/** Revoca el vínculo y descarta lo que estuviera pendiente en esa conversación. */
export async function revokeIdentity(db: D1Database, where: { identityId: number } | { userId: number }, by: string): Promise<number | null> {
  const row = 'identityId' in where
    ? await db.prepare(`SELECT id, user_id AS userId FROM whatsapp_identities WHERE id = ? AND status = 'active'`).bind(where.identityId).first<{ id: number; userId: number }>()
    : await db.prepare(`SELECT id, user_id AS userId FROM whatsapp_identities WHERE user_id = ? AND status = 'active'`).bind(where.userId).first<{ id: number; userId: number }>()
  if (!row) return null
  await db.batch([
    db.prepare(`UPDATE whatsapp_identities SET status = 'revoked', revoked_at = datetime('now'), revoked_by = ?, menu_json = NULL WHERE id = ? AND status = 'active'`).bind(by, row.id),
    db.prepare(`UPDATE telegram_operations SET status = 'cancelled', completed_at = datetime('now') WHERE chat_id = ? AND status = 'pending'`).bind(String(whatsappChatId(row.id))),
    db.prepare('DELETE FROM telegram_sessions WHERE telegram_user_id = ?').bind(`wa:${row.id}`),
    db.prepare(`INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source) VALUES ('whatsapp_unlinked', 'user', ?, ?, ?, 'whatsapp')`)
      .bind(String(row.userId), JSON.stringify({ identityId: row.id }), by),
  ])
  return row.id
}

/**
 * Claves del motor para una conversación de WhatsApp. Quedan fuera del rango de Telegram (sus
 * identificadores caben en 52 bits y los chats privados son positivos), así que nunca coinciden.
 */
const WHATSAPP_ID_BASE = 5_000_000_000_000_000
export const whatsappChatId = (identityId: number) => -(WHATSAPP_ID_BASE + identityId)
export const whatsappUpdateId = (messageRowId: number) => WHATSAPP_ID_BASE + messageRowId
export const whatsappUserKey = (identityId: number) => `wa:${identityId}`
