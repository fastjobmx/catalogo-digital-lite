/** /consumo: how many AI messages the store has used in its current cycle. Deterministic (no AI, never counted
 * and never blocked). Plain language for merchants: no technical terms. */
import { formatCycleDate, getConsumption, quotaMode } from '../../ai/messageQuota'
import { say, type AssistantContext } from './context'
import { aiOverview } from '../../ai/aiOverview'
import { bogotaDate } from '../../ai/planUsage'
import { backToMenu } from './menus'

export const CONSUMPTION_INTENT = /^\s*(?:¿\s*)?(?:cu[aá]ntos?\s+mensajes(?:\s+(?:con\s+ia\s+)?(?:me\s+)?(?:quedan|llevo|he\s+usado|tengo))?|mi\s+consumo|consumo(?:\s+de\s+(?:ia|mensajes))?|mensajes\s+(?:me\s+)?quedan|cu[aá]nto\s+he\s+usado)\b/i

export async function showConsumption(ctx: AssistantContext): Promise<void> {
  // Plans with smart queries (Emprendedor, Negocio, Mayorista): monthly allowance, artistic credits and own API.
  const overview = await aiOverview(ctx.db, ctx.env, ctx.store.id)
  if (overview.plan.metered) {
    const month = overview.month
    const lines = ['📊 <b>Tu IA este mes</b>', `Plan: <b>${overview.plan.name || 'Tu plan'}</b>`]
    if (month.limit !== null) {
      lines.push(`Consultas usadas: <b>${month.used}</b> de <b>${month.limit}</b> (${month.percent} %)`)
      lines.push(`Te quedan: <b>${month.available}</b> · se renuevan el ${bogotaDate(month.cycleEnd)}`)
    }
    lines.push(`Créditos artísticos: <b>${overview.credits.balance}</b>`)
    const key = overview.ownKey
    lines.push(key.connected ? `Mi API de Gemini: ${'statusLabel' in key ? key.statusLabel : 'conectada'} — las tareas que procese no gastan tus consultas.` : 'Mi API de Gemini: no conectada.')
    lines.push('', 'Ver existencias, cambiar un precio exacto, confirmar, deshacer y el menú no gastan consultas. Detalle e historial en el panel: Configuración → Inteligencia artificial.')
    await say(ctx, lines.join('\n'), backToMenu())
    return
  }
  if (quotaMode(ctx.env) === 'off') {
    await say(ctx, 'Por ahora no llevo la cuenta de tus mensajes con IA: tu asistente funciona con normalidad.', backToMenu())
    return
  }
  const plan = await ctx.db.prepare('SELECT name FROM plans WHERE code = ?').bind(ctx.store.planCode).first<{ name: string }>()
  const info = await getConsumption(ctx.db, ctx.store.id)
  const lines = ['📊 <b>Consumo del asistente</b>', `Plan: <b>${plan?.name || 'Tu plan'}</b>`]
  if (info.limit !== null && info.policy !== 'none') {
    lines.push(`Mensajes con IA usados: <b>${info.used}</b> de <b>${info.limit}</b> (${info.percent}%)`)
    lines.push(`Disponibles: <b>${info.remaining}</b>`)
  } else {
    lines.push(`Mensajes con IA este ciclo: <b>${info.used}</b>`)
    if (info.policy === 'monitored') lines.push('Tu plan incluye uso conversacional ampliado.')
  }
  if (info.photos.included !== null) lines.push(`Mejoras de fotos con IA: <b>${info.photos.used}</b> de <b>${info.photos.included}</b>`)
  if (info.descriptions.included !== null) lines.push(`Descripciones con IA: <b>${info.descriptions.used}</b> de <b>${info.descriptions.included}</b>`)
  lines.push(`Ciclo: del ${formatCycleDate(info.cycle.start)} al ${formatCycleDate(info.cycle.end)}${info.cycle.provisional ? ' (mes calendario)' : ''}`)
  if (info.lastActivityAt) lines.push(`Última actividad: ${info.lastActivityAt.slice(0, 16).replace('T', ' ')} UTC`)
  lines.push('', 'Los botones, la ayuda y las consultas de inventario no gastan mensajes.')
  await say(ctx, lines.join('\n'), backToMenu())
}
