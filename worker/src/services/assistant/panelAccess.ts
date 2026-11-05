/** "🔐 Contraseña del panel": the person who is already identified by this Telegram account asks for
 * a reset link of the panel account linked to it. The link goes only to that account's channels
 * (verified email or this same Telegram chat) and is never written in the conversation text. */
import { maskEmail, sendAdminPasswordReset, type ResetTarget } from '../passwordReset'
import { say, type AssistantContext } from './context'
import { escapeHtml } from './tools'

const back = { inline_keyboard: [[{ text: '↩ Menú principal', callback_data: 'm:menu' }]] }

export async function sendPanelPasswordReset(ctx: AssistantContext): Promise<void> {
  const user = await ctx.db.prepare(
    `SELECT id, email, display_name AS displayName, password_hash IS NOT NULL AS hasPassword, email_verified_at IS NOT NULL AS emailVerified
     FROM platform_users WHERE telegram_user_id = ? AND status = 'active'`,
  ).bind(ctx.telegramUserId).first<{ id: number; email: string | null; displayName: string; hasPassword: number; emailVerified: number }>()
  if (!user?.email) {
    await say(ctx, 'Este Telegram no está vinculado a una cuenta del panel con correo, así que no hay una contraseña que restablecer desde aquí. Pide a la administración de la plataforma que te asigne una cuenta.', back)
    return
  }
  if (!user.hasPassword) {
    await say(ctx, `La cuenta ${escapeHtml(maskEmail(user.email))} todavía no está activada. Usa el enlace de activación que te compartieron o pide uno nuevo al propietario de la tienda.`, back)
    return
  }
  const recent = await ctx.db.prepare(
    `SELECT COUNT(*) AS n FROM audit_log WHERE entity_type = 'user' AND entity_id = ? AND action IN ('password_reset_issued', 'password_reset_requested') AND created_at >= datetime('now', '-2 minutes')`,
  ).bind(String(user.id)).first<{ n: number }>()
  if (Number(recent?.n || 0) > 0) {
    await say(ctx, 'Ya te envié un enlace hace menos de 2 minutos. Revisa el mensaje anterior: sirve una sola vez y vence en 60 minutos.', back)
    return
  }
  // The store in use if this account belongs to it, otherwise its first active store.
  const store = await ctx.db.prepare(
    `SELECT s.id, s.slug, s.name FROM store_memberships m JOIN stores s ON s.id = m.store_id
     WHERE m.user_id = ? AND m.status = 'active' AND s.status <> 'cancelled'
     ORDER BY CASE WHEN s.id = ? THEN 0 ELSE 1 END, s.id LIMIT 1`,
  ).bind(user.id, ctx.store.id).first<{ id: number; slug: string; name: string }>()
  if (!store) {
    await say(ctx, 'Tu cuenta no tiene acceso activo a ninguna tienda en este momento.', back)
    return
  }
  const target: ResetTarget = { id: user.id, email: user.email, displayName: user.displayName, emailVerified: Boolean(user.emailVerified), telegram_user_id: ctx.telegramUserId, storeId: store.id, slug: store.slug, storeName: store.name }
  const result = await sendAdminPasswordReset(ctx.db, ctx.env, target, `telegram:${ctx.telegramUserId}`, 'admin')
  const text = result.delivery === 'email'
    ? `🔐 Te enviamos el enlace para crear una contraseña nueva al correo verificado ${escapeHtml(maskEmail(user.email))}. Vence en 60 minutos.`
    : result.delivery === 'telegram'
      ? `🔐 Te envié aquí arriba el botón «Crear contraseña nueva» para la cuenta ${escapeHtml(maskEmail(user.email))} del panel de ${escapeHtml(store.name)}. Vence en 60 minutos y sirve una sola vez. No lo compartas.`
      : 'No pude enviar el enlace en este momento. Inténtalo de nuevo en unos minutos.'
  await say(ctx, text, back)
}
