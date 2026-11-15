/** Notices of the monthly allowance of smart queries: 50 % (information), 75 % (suggest an own API key),
 * 90 % (warning) and 100 % (the included allowance is used up). Each threshold is notified once per store and cycle,
 * and only the highest one reached is shown (crossing 50 and 75 at once shows the 75 % notice only). */
import { bogotaDate, cycleOf, planQuota, usedUnits } from './planUsage'

export const NOTICE_THRESHOLDS = [50, 75, 90, 100] as const
export type NoticeThreshold = typeof NOTICE_THRESHOLDS[number]

export type QuotaStatus = {
  limit: number
  used: number
  remaining: number
  percent: number
  cycleKey: string
  cycleEnd: string
  /** Highest threshold reached in this cycle, or null below 50 %. */
  level: NoticeThreshold | null
}

export async function quotaStatus(db: D1Database, storeId: number, now = new Date()): Promise<QuotaStatus | null> {
  const quota = await planQuota(db, storeId)
  if (quota.monthlyUnits === null) return null
  const cycle = await cycleOf(db, storeId, now)
  const used = await usedUnits(db, storeId, cycle.key)
  const limit = quota.monthlyUnits
  const percent = limit > 0 ? Math.min(100, Math.floor((used / limit) * 100)) : 100
  const level = [...NOTICE_THRESHOLDS].reverse().find((threshold) => percent >= threshold) ?? null
  return { limit, used, remaining: Math.max(0, limit - used), percent, cycleKey: cycle.key, cycleEnd: cycle.end, level }
}

const OWN_API = 'Configuración → Inteligencia artificial → Mi API'

export function noticeText(threshold: NoticeThreshold, status: Pick<QuotaStatus, 'limit' | 'used' | 'remaining' | 'cycleEnd'>, ownKeyConnected: boolean): string {
  const counts = `${status.used} de ${status.limit} consultas`
  const renewal = `Se renuevan el ${bogotaDate(status.cycleEnd)}.`
  switch (threshold) {
    case 50: return `ℹ️ Llevas la mitad de tus consultas de IA del mes (${counts}). ${renewal}`
    case 75: return `💡 Llevas el 75 % de tus consultas de IA del mes (${counts}). ${ownKeyConnected ? 'Tu API propia ya está conectada: las tareas que procese no gastan consultas.' : `Si necesitas más, puedes conectar tu propia API de Gemini en ${OWN_API}.`} ${renewal}`
    case 90: return `⚠️ Llevas el 90 % de tus consultas de IA del mes: te quedan ${status.remaining}. ${renewal}`
    case 100: return `⛔ Usaste las ${status.limit} consultas de IA incluidas en tu plan este mes. ${renewal} Ver existencias, precios exactos, pedidos, el catálogo y los comandos siguen funcionando. ${ownKeyConnected ? '' : `Puedes seguir con IA conectando tu API de Gemini en ${OWN_API}.`}`.trim()
  }
}

/** The notice to show now, if a threshold was reached and not notified yet in this cycle (atomic: once only). */
export async function takeQuotaNotice(db: D1Database, storeId: number, ownKeyConnected: boolean, now = new Date()): Promise<{ threshold: NoticeThreshold; text: string } | null> {
  const status = await quotaStatus(db, storeId, now)
  if (!status?.level) return null
  // Mark every threshold up to the reached one; only the highest new one is said.
  let fresh: NoticeThreshold | null = null
  for (const threshold of NOTICE_THRESHOLDS) {
    if (threshold > status.level) break
    const inserted = await db.prepare('INSERT OR IGNORE INTO ai_quota_notices (store_id, cycle_key, threshold) VALUES (?, ?, ?) RETURNING threshold')
      .bind(storeId, status.cycleKey, threshold).first()
    if (inserted) fresh = threshold
  }
  return fresh ? { threshold: fresh, text: noticeText(fresh, status, ownKeyConnected) } : null
}
