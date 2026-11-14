/** Artistic credits wallet on top of the append-only ledger (`ai_credit_ledger`).
 *
 * Every credit that enters has an origin (`source`): plan (assigned each billing cycle, expires when the cycle ends),
 * cortesia (gifts; the ones that existed before keep no expiry), compra (paid packs, 12 months) or ajuste.
 * Balance is still SUM(amount). Which lot a spent credit came from is derived by replaying the ledger in a fixed
 * order — plan first, then courtesy, adjustments and finally purchased credits, each by nearest expiry — so the
 * credits that would expire first are always used first. When a lot expires with credits left, one adjustment
 * row (idempotent per lot) removes exactly those credits.
 *
 * Costs in credits are versioned: version 1 = `ai_credit_costs` (existing stores, unchanged); version 2 =
 * `ai_credit_cost_versions` for the new plans (only artistic generation costs credits there).
 */
import { cycleOf, planQuota } from './planUsage'

export type CreditSource = 'plan' | 'cortesia' | 'compra' | 'ajuste'
const PRIORITY: Record<CreditSource, number> = { plan: 0, cortesia: 1, ajuste: 2, compra: 3 }

type LedgerRow = { id: number; kind: string; amount: number; source: CreditSource; reservation_id: number | null; idempotency_key: string | null; lot_expires_at: string | null; created_at: string }

export type CreditLot = { id: number; source: CreditSource; granted: number; remaining: number; expiresAt: string | null; createdAt: string; expired: boolean }

const isGrant = (row: LedgerRow) => (row.kind === 'recarga' || (row.kind === 'ajuste' && row.amount > 0))
const expiryLotId = (row: LedgerRow) => row.kind === 'ajuste' && row.idempotency_key?.startsWith('vence:') ? Number(row.idempotency_key.slice(6)) : null

/** Replays the ledger and returns every lot with what is left of it. */
export async function creditLots(db: D1Database, storeId: number, now = new Date()): Promise<CreditLot[]> {
  const rows = (await db.prepare(
    `SELECT id, kind, amount, source, reservation_id, idempotency_key, lot_expires_at, created_at FROM ai_credit_ledger WHERE store_id = ? ORDER BY id`,
  ).bind(storeId).all<LedgerRow>()).results || []
  const nowText = now.toISOString().slice(0, 19).replace('T', ' ')
  const lots: CreditLot[] = []
  const byId = new Map<number, CreditLot>()
  const taken = new Map<number, Array<{ lot: CreditLot; amount: number }>>() // reservation id → credits taken from each lot
  const take = (amount: number, at: string, exclusive?: CreditLot) => {
    const parts: Array<{ lot: CreditLot; amount: number }> = []
    const pool = exclusive ? [exclusive] : lots
      .filter((lot) => lot.remaining > 0 && (!lot.expiresAt || lot.expiresAt > at))
      .sort((x, y) => PRIORITY[x.source] - PRIORITY[y.source] || (x.expiresAt ?? '9999').localeCompare(y.expiresAt ?? '9999') || x.id - y.id)
    let left = amount
    for (const lot of pool) {
      if (left <= 0) break
      const used = Math.min(lot.remaining, left)
      lot.remaining -= used
      left -= used
      parts.push({ lot, amount: used })
    }
    return parts
  }
  for (const row of rows) {
    if (isGrant(row)) {
      const lot: CreditLot = { id: row.id, source: row.kind === 'ajuste' ? 'ajuste' : row.source, granted: row.amount, remaining: row.amount, expiresAt: row.lot_expires_at, createdAt: row.created_at, expired: false }
      lots.push(lot)
      byId.set(row.id, lot)
    } else if (row.kind === 'reserva') {
      taken.set(row.id, take(-row.amount, row.created_at))
    } else if (row.kind === 'liberacion' && row.reservation_id) {
      for (const part of taken.get(row.reservation_id) || []) part.lot.remaining += part.amount
    } else if (row.kind === 'ajuste' && row.amount < 0) {
      const target = expiryLotId(row)
      take(-row.amount, row.created_at, target ? byId.get(target) : undefined)
    }
  }
  for (const lot of lots) lot.expired = Boolean(lot.expiresAt && lot.expiresAt <= nowText)
  return lots
}

/** Removes what is left of expired lots (one idempotent adjustment per lot). Safe to run anytime (cron). */
export async function expireCreditLots(db: D1Database, storeId?: number, now = new Date()): Promise<number> {
  const stores = storeId ? [storeId] : ((await db.prepare(
    `SELECT DISTINCT store_id AS id FROM ai_credit_ledger WHERE kind = 'recarga' AND lot_expires_at IS NOT NULL AND lot_expires_at <= datetime('now')`,
  ).all<{ id: number }>()).results || []).map((row) => row.id)
  let expired = 0
  for (const id of stores) {
    for (const lot of await creditLots(db, id, now)) {
      if (!lot.expired || lot.remaining <= 0) continue
      const result = await db.prepare(
        `INSERT OR IGNORE INTO ai_credit_ledger (store_id, kind, amount, source, idempotency_key, actor, reason) VALUES (?, 'ajuste', ?, 'ajuste', ?, 'system', ?)`,
      ).bind(id, -lot.remaining, `vence:${lot.id}`, `Vencimiento de créditos (${lot.source})`).run()
      expired += Number(result.meta?.changes || 0) ? lot.remaining : 0
    }
  }
  return expired
}

/** Assigns the plan's credits for the current cycle once (idempotent per cycle). They expire when the cycle ends. */
export async function grantPlanCredits(db: D1Database, storeId: number, now = new Date()): Promise<boolean> {
  const quota = await planQuota(db, storeId)
  if (!quota.monthlyCredits || quota.monthlyCredits <= 0) return false
  const cycle = await cycleOf(db, storeId, now)
  // The cycle ends at 00:00 in Bogotá (05:00 UTC) of its end date.
  const result = await db.prepare(
    `INSERT OR IGNORE INTO ai_credit_ledger (store_id, kind, amount, source, idempotency_key, actor, reason, lot_expires_at)
     VALUES (?, 'recarga', ?, 'plan', ?, 'system', ?, ?)`,
  ).bind(storeId, quota.monthlyCredits, `plan:${cycle.key}`, `Créditos del plan (ciclo ${cycle.key})`, `${cycle.end} 05:00:00`).run()
  return Number(result.meta?.changes || 0) === 1
}

export type WalletSummary = {
  balance: number
  bySource: Record<CreditSource, number>
  nextExpiry: { credits: number; at: string } | null
  lots: Array<Pick<CreditLot, 'source' | 'granted' | 'remaining' | 'expiresAt' | 'createdAt'>>
}

export async function walletSummary(db: D1Database, storeId: number, now = new Date()): Promise<WalletSummary> {
  const lots = await creditLots(db, storeId, now)
  const live = lots.filter((lot) => !lot.expired && lot.remaining > 0)
  const bySource: Record<CreditSource, number> = { plan: 0, cortesia: 0, compra: 0, ajuste: 0 }
  for (const lot of live) bySource[lot.source] += lot.remaining
  const balance = Number((await db.prepare('SELECT COALESCE(SUM(amount), 0) AS b FROM ai_credit_ledger WHERE store_id = ?').bind(storeId).first<{ b: number }>())?.b || 0)
  const expiring = live.filter((lot) => lot.expiresAt).sort((x, y) => x.expiresAt!.localeCompare(y.expiresAt!))[0]
  return {
    balance,
    bySource,
    nextExpiry: expiring ? { credits: live.filter((lot) => lot.expiresAt === expiring.expiresAt).reduce((sum, lot) => sum + lot.remaining, 0), at: expiring.expiresAt! } : null,
    lots: lots.slice(-20).map(({ source, granted, remaining, expiresAt, createdAt }) => ({ source, granted, remaining, expiresAt, createdAt })),
  }
}

// ---- costs -----------------------------------------------------------------------

/** Version of the credit price table that applies to the store: its own setting, else 2 for the new plans
 * (they assign monthly credits) and 1 for every other plan (today's prices, unchanged). */
export async function creditPriceVersion(db: D1Database, storeId: number): Promise<number> {
  const row = await db.prepare('SELECT s.credit_price_version AS version, p.ai_monthly_credits AS credits FROM stores s LEFT JOIN plans p ON p.code = s.plan_code WHERE s.id = ?')
    .bind(storeId).first<{ version: number | null; credits: number | null }>()
  if (row?.version) return Number(row.version)
  return row?.credits ? 2 : 1
}

/** Credits per unit of a feature for this store, or null when the feature has no configured cost. */
export async function creditCostFor(db: D1Database, storeId: number, feature: string): Promise<{ credits: number; enabled: number } | null> {
  const version = await creditPriceVersion(db, storeId)
  if (version >= 2) {
    const row = await db.prepare('SELECT credits, enabled FROM ai_credit_cost_versions WHERE feature = ? AND version = ?').bind(feature, version).first<{ credits: number; enabled: number }>()
    if (row) return row
  }
  return db.prepare('SELECT credits, enabled FROM ai_credit_costs WHERE feature = ?').bind(feature).first<{ credits: number; enabled: number }>()
}

export async function creditPacks(db: D1Database) {
  return (await db.prepare('SELECT code, credits, price_cop AS priceCop, valid_months AS validMonths FROM ai_credit_packs WHERE active = 1 ORDER BY sort_order').all()).results || []
}
