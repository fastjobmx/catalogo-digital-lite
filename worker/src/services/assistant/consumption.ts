/** /consumo: how many AI messages the store has used in its current cycle. Deterministic (no AI, never counted
 * and never blocked). Plain language for merchants: no technical terms. */
import { formatCycleDate, getConsumption, quotaMode } from '../../ai/messageQuota'
import { say, type AssistantContext } from './context'
import { backToMenu } from './menus'

export const CONSUMPTION_INTENT = /^\s*(?:¿\s*)?(?:cu[aá]ntos?\s+mensajes(?:\s+(?:con\s+ia\s+)?(?:me\s+)?(?:quedan|llevo|he\s+usado|tengo))?|mi\s+consumo|consumo(?:\s+de\s+(?:ia|mensajes))?|mensajes\s+(?:me\s+)?quedan|cu[aá]nto\s+he\s+usado)\b/i

export async function showConsumption(ctx: AssistantContext): Promise<void> {
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
