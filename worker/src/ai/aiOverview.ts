/** What the merchant sees about their AI: queries of the month, artistic credits, own API and
 * history. Read-only (it only performs the idempotent wallet upkeep). Never includes message content or secrets. */
import type { Env } from '../index'
import { creditPacks, creditPriceVersion, expireCreditLots, grantPlanCredits, walletSummary } from './creditWallet'
import { ownKeyStatus } from './ownKey'
import { cycleOf, planQuota, unitWeights, usedUnits } from './planUsage'
import { noticeText, NOTICE_THRESHOLDS } from './quotaNotices'
import { DEFAULT_STORE_BURST_PER_MINUTE, DEFAULT_STORE_CONCURRENCY, guardMode, MAX_ATTEMPTS_PER_OPERATION } from './spendGuard'

type Bindings = Partial<Env['Bindings']>

const CHANNELS: Record<string, string> = { tg: 'Telegram', wa: 'WhatsApp', waha: 'WhatsApp', cr: 'Panel', master: 'Plataforma', trial: 'Prueba gratuita' }
const PAID_WITH: Record<string, string> = { plan: 'Plan', own_key: 'Mi API', platform: 'Plataforma', trial: 'Prueba gratuita' }
const ROUTE_LABELS: Record<string, string> = { plan_respaldo: 'Plan (respaldo autorizado: tu API falló)', plan_privacidad: 'Plan (datos de compradores)' }
const IMAGE_FEATURES = ['estudio_imagen', 'foto_packshot', 'foto_premium', 'video_ia_segundo']

export async function aiOverview(db: D1Database, env: Bindings, storeId: number, now = new Date()) {
  await expireCreditLots(db, storeId, now).catch(() => 0)
  await grantPlanCredits(db, storeId, now).catch(() => false)
  const [quota, cycle, wallet, ownKey, weights, version, packs] = await Promise.all([
    planQuota(db, storeId), cycleOf(db, storeId, now), walletSummary(db, storeId, now),
    ownKeyStatus(db, env, storeId), unitWeights(db), creditPriceVersion(db, storeId), creditPacks(db),
  ])
  const plan = quota.planCode ? await db.prepare('SELECT name FROM plans WHERE code = ?').bind(quota.planCode).first<{ name: string }>() : null
  const used = await usedUnits(db, storeId, cycle.key)
  const limit = quota.monthlyUnits
  const percent = limit === null ? null : limit > 0 ? Math.min(100, Math.floor((used / limit) * 100)) : 100
  const level = percent === null ? null : [...NOTICE_THRESHOLDS].reverse().find((threshold) => percent >= threshold) ?? null
  const label = new Map(weights.map((weight) => [weight.feature, weight.label]))
  const rows = (await db.prepare(
    `SELECT created_at AS at, feature, kind, billing_source AS paidWith, route, units, status, outcome, op_key AS opKey FROM ai_spend_reservations WHERE store_id = ? ORDER BY id DESC LIMIT 40`,
  ).bind(storeId).all<{ at: string; feature: string; kind: string; paidWith: string; units: number; status: string; outcome: string | null; opKey: string; route: string | null }>()).results || []
  const history = await Promise.all(rows.map(async (row) => {
    // Artistic generation is paid with credits: show the credits of its reservation (0 if they were given back).
    let credits: number | null = null
    if (row.paidWith !== 'own_key' && (row.kind === 'image' || row.kind === 'video')) {
      const key = row.opKey.startsWith(`cr:${storeId}:`) ? row.opKey.slice(`cr:${storeId}:`.length) : null
      const hold = key ? await db.prepare(
        `SELECT -r.amount AS credits, EXISTS (SELECT 1 FROM ai_credit_ledger s WHERE s.reservation_id = r.id AND s.kind = 'liberacion') AS released
         FROM ai_credit_ledger r WHERE r.store_id = ? AND r.kind = 'reserva' AND r.idempotency_key = ?`,
      ).bind(storeId, key).first<{ credits: number; released: number }>() : null
      credits = row.status === 'released' || hold?.released ? 0 : Number(hold?.credits ?? 0)
    }
    return {
      at: row.at, task: label.get(row.feature) || row.feature, channel: CHANNELS[row.opKey.split(':')[0] || ''] || 'Panel',
      paidWith: credits !== null ? 'Créditos' : ROUTE_LABELS[row.route || ''] || PAID_WITH[row.paidWith] || row.paidWith,
      units: row.status === 'released' ? 0 : row.units, credits,
      result: row.status === 'released' ? 'falló (no se descontó)' : row.outcome === 'truncated' ? 'respuesta incompleta' : row.status === 'reserved' ? 'en curso' : 'ok',
    }
  }))
  const byTask = ((await db.prepare(
    `SELECT feature, COUNT(*) AS tasks, COALESCE(SUM(units), 0) AS units FROM ai_spend_reservations
     WHERE store_id = ? AND cycle_key = ? AND billing_source = 'plan' AND kind = 'text' AND status <> 'released' GROUP BY feature ORDER BY units DESC`,
  ).bind(storeId, cycle.key).all<{ feature: string; tasks: number; units: number }>()).results || []).map((row) => ({ task: label.get(row.feature) || row.feature, tasks: row.tasks, units: row.units }))
  const credits = ((await db.prepare(
    `SELECT id, kind, amount, source, feature, reason, created_at AS at FROM ai_credit_ledger WHERE store_id = ? AND kind IN ('recarga', 'ajuste', 'reserva', 'liberacion') ORDER BY id DESC LIMIT 20`,
  ).bind(storeId).all()).results || [])
  const imageCosts = version >= 2
    ? (await db.prepare(`SELECT feature, credits FROM ai_credit_cost_versions WHERE version = ? AND enabled = 1 AND credits > 0`).bind(version).all<{ feature: string; credits: number }>()).results || []
    : (await db.prepare(`SELECT feature, credits FROM ai_credit_costs WHERE enabled = 1 AND credits > 0`).all<{ feature: string; credits: number }>()).results || []
  return {
    plan: { code: quota.planCode, name: plan?.name || null, metered: quota.metered, enforced: guardMode(env) === 'enforce' },
    month: {
      limit, used, available: limit === null ? null : Math.max(0, limit - used), percent, level,
      notice: level && limit !== null ? noticeText(level, { limit, used, remaining: Math.max(0, limit - used), cycleEnd: cycle.end }, Boolean(ownKey.connected)) : null,
      cycleStart: cycle.start, cycleEnd: cycle.end, provisional: cycle.provisional,
    },
    credits: { ...wallet, monthlyFromPlan: quota.monthlyCredits, priceVersion: version, costs: imageCosts.map((row) => ({ ...row, label: label.get(row.feature) || row.feature, image: IMAGE_FEATURES.includes(row.feature) })), packs },
    ownKey,
    history,
    byTask,
    creditMovements: credits,
    weights: weights.map(({ feature, units, perItem, label: text }) => ({ feature, units, perItem, label: text })),
    policy: {
      concurrency: DEFAULT_STORE_CONCURRENCY, perMinute: DEFAULT_STORE_BURST_PER_MINUTE, attemptsPerTask: MAX_ATTEMPTS_PER_OPERATION,
      duplicateWindowMinutes: 2, maxImageMb: 5, maxAudioMinutes: 2, maxDocumentMb: 10,
    },
  }
}
