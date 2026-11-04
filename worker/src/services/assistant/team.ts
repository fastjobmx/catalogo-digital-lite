/** Store team from Telegram: list members, invite with a one-time link (least
 * privilege role chosen by the owner) and revoke access. Every change is audited. */
import { can, INVITABLE_ROLES, ROLE_LABELS, type StoreRole } from '../../tenancy/access'
import { createAccessToken, upsertMembership } from '../platformUsers'
import { say, type AssistantContext } from './context'
import { escapeHtml } from './tools'

const ROLE_HELP: Record<StoreRole, string> = {
  owner: 'Todo, incluido el equipo.',
  admin: 'Productos, apariencia, pedidos, inventario, marketing y equipo.',
  operator: 'Pedidos e inventario.',
  seller: 'Pedidos y consultas; no cambia existencias ni productos.',
  inventory: 'Existencias y movimientos; no gestiona pedidos ni productos.',
}

const cb = (ctx: AssistantContext, ...parts: Array<string | number>) => ['team', ctx.store.id, ...parts].join(':')

async function botUsername(ctx: AssistantContext): Promise<string | null> {
  const configured = ctx.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, '')
  if (configured) return configured
  try {
    const response = await fetch(`https://api.telegram.org/bot${ctx.botToken}/getMe`, { signal: AbortSignal.timeout(5000) })
    const body = await response.json() as { ok?: boolean; result?: { username?: string } }
    return body.ok && body.result?.username ? body.result.username : null
  } catch { return null }
}

export async function showTeam(ctx: AssistantContext): Promise<void> {
  if (!can(ctx.role, 'team.manage')) { await say(ctx, 'Solo el propietario o un administrador pueden ver y gestionar el equipo.'); return }
  const members = (await ctx.db.prepare(
    `SELECT u.id, u.display_name AS name, m.role, CASE WHEN u.telegram_user_id IS NULL THEN 0 ELSE 1 END AS linked
     FROM store_memberships m JOIN platform_users u ON u.id = m.user_id
     WHERE m.store_id = ? AND m.status = 'active' ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.id`,
  ).bind(ctx.store.id).all<{ id: number; name: string; role: StoreRole; linked: number }>()).results || []
  const lines = members.map((member) => `• ${escapeHtml(member.name || `Persona ${member.id}`)} · ${ROLE_LABELS[member.role]}${member.linked ? '' : ' · ⏳ sin Telegram vinculado'}`)
  const removable = members.filter((member) => member.role !== 'owner' && (member.role !== 'admin' || ctx.role === 'owner'))
  await say(ctx, `👥 <b>Equipo de ${escapeHtml(ctx.store.name)}</b>\n\n${lines.join('\n') || 'Todavía no hay miembros registrados.'}\n\nCada persona ve solo lo que su rol permite.`, { inline_keyboard: [
    [{ text: '➕ Invitar a alguien', callback_data: cb(ctx, 'invite') }],
    ...removable.slice(0, 8).map((member) => [{ text: `🚫 Quitar acceso: ${(member.name || `Persona ${member.id}`).slice(0, 30)}`, callback_data: cb(ctx, 'askrevoke', member.id) }]),
    [{ text: '↩ Menú principal', callback_data: 'm:menu' }],
  ] })
}

async function chooseRole(ctx: AssistantContext): Promise<void> {
  const roles = INVITABLE_ROLES.filter((role) => role !== 'admin' || ctx.role === 'owner')
  await say(ctx, `¿Qué rol tendrá la persona? Elige el mínimo que necesite:\n\n${roles.map((role) => `<b>${ROLE_LABELS[role]}</b>: ${ROLE_HELP[role]}`).join('\n')}`, { inline_keyboard: [
    ...roles.map((role) => [{ text: ROLE_LABELS[role], callback_data: cb(ctx, 'role', role) }]),
    [{ text: '✖ Cancelar', callback_data: cb(ctx, 'list') }],
  ] })
}

/** Creates an invited account with the chosen role and a 72-hour, single-use link. */
async function invite(ctx: AssistantContext, role: StoreRole): Promise<void> {
  if (!INVITABLE_ROLES.includes(role) || (role === 'admin' && ctx.role !== 'owner')) { await say(ctx, 'No puedes invitar con ese rol.'); return }
  const actor = `telegram:${ctx.telegramUserId}`
  const created = await ctx.db.prepare(`INSERT INTO platform_users (email, display_name, status, created_by) VALUES (NULL, ?, 'invited', ?)`)
    .bind(`${ROLE_LABELS[role]} invitado`, actor).run()
  const userId = Number(created.meta.last_row_id)
  await upsertMembership(ctx.db, { storeId: ctx.store.id, userId, role, createdBy: actor })
  const code = await createAccessToken(ctx.db, { userId, storeId: ctx.store.id, purpose: 'telegram_link', ttlSeconds: 72 * 3600, createdBy: actor })
  await ctx.db.prepare(`INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id) VALUES ('team_member_invited', 'user', ?, ?, ?, 'telegram', ?)`)
    .bind(String(userId), JSON.stringify({ role }), actor, ctx.store.id).run()
  const username = await botUsername(ctx)
  const link = username ? `https://t.me/${username}?start=link_${code.replaceAll('-', '')}` : null
  await say(ctx, `✅ Invitación creada como <b>${ROLE_LABELS[role]}</b>.\n\nEnvíale a esa persona${link ? ' este enlace:\n' + escapeHtml(link) + '\n\no' : ''} este mensaje para que lo escriba en este bot:\n<code>/link ${escapeHtml(code)}</code>\n\nVale una sola vez y vence en 72 horas. No compartas el código en grupos.`, { inline_keyboard: [
    [{ text: '👥 Ver equipo', callback_data: cb(ctx, 'list') }],
  ] })
}

async function revoke(ctx: AssistantContext, userId: number, confirmed: boolean): Promise<void> {
  const member = await ctx.db.prepare(`SELECT u.display_name AS name, m.role FROM store_memberships m JOIN platform_users u ON u.id = m.user_id WHERE m.store_id = ? AND m.user_id = ? AND m.status = 'active'`)
    .bind(ctx.store.id, userId).first<{ name: string; role: StoreRole }>()
  if (!member || member.role === 'owner') { await say(ctx, 'Esa persona no tiene un acceso que se pueda quitar aquí.'); return }
  if (member.role === 'admin' && ctx.role !== 'owner') { await say(ctx, 'Solo el propietario puede quitar a un administrador.'); return }
  const self = await ctx.db.prepare('SELECT 1 FROM platform_users WHERE id = ? AND telegram_user_id = ?').bind(userId, ctx.telegramUserId).first()
  if (self) { await say(ctx, 'No puedes quitarte tu propio acceso desde aquí.'); return }
  if (!confirmed) {
    await say(ctx, `¿Quitar el acceso de <b>${escapeHtml(member.name || `Persona ${userId}`)}</b> (${ROLE_LABELS[member.role]}) a ${escapeHtml(ctx.store.name)}? Sus otras tiendas no cambian.`, { inline_keyboard: [
      [{ text: '✅ Sí, quitar acceso', callback_data: cb(ctx, 'revoke', userId) }, { text: '✖ No', callback_data: cb(ctx, 'list') }],
    ] })
    return
  }
  const result = await ctx.db.batch([
    ctx.db.prepare(`UPDATE store_memberships SET status = 'revoked', updated_at = datetime('now') WHERE store_id = ? AND user_id = ? AND status = 'active' AND role <> 'owner'`).bind(ctx.store.id, userId),
    ctx.db.prepare(`UPDATE user_access_tokens SET used_at = unixepoch() WHERE user_id = ? AND store_id = ? AND used_at IS NULL`).bind(userId, ctx.store.id),
    ctx.db.prepare(`INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id) VALUES ('team_member_revoked', 'user', ?, ?, ?, 'telegram', ?)`)
      .bind(String(userId), JSON.stringify({ role: member.role }), `telegram:${ctx.telegramUserId}`, ctx.store.id),
  ])
  await say(ctx, Number(result[0]?.meta.changes || 0) ? '✅ Acceso quitado. Esa persona ya no puede ver ni cambiar esta tienda.' : 'Ese acceso ya había sido quitado.', { inline_keyboard: [[{ text: '👥 Ver equipo', callback_data: cb(ctx, 'list') }]] })
}

export async function handleTeamCallback(ctx: AssistantContext, data: string): Promise<boolean> {
  const match = data.match(/^team:(\d+):(list|invite|role|askrevoke|revoke)(?::([a-z]+|\d+))?$/)
  if (!match) return false
  if (Number(match[1]) !== ctx.store.id) { await say(ctx, 'Ese botón pertenece a otra tienda y no lo apliqué. Usa /equipo en la tienda actual.'); return true }
  if (!can(ctx.role, 'team.manage')) { await say(ctx, 'Solo el propietario o un administrador pueden gestionar el equipo.'); return true }
  const [, , verb, arg] = match
  if (verb === 'list') await showTeam(ctx)
  else if (verb === 'invite') await chooseRole(ctx)
  else if (verb === 'role' && arg) await invite(ctx, arg as StoreRole)
  else if (verb === 'askrevoke' && arg) await revoke(ctx, Number(arg), false)
  else if (verb === 'revoke' && arg) await revoke(ctx, Number(arg), true)
  return true
}
