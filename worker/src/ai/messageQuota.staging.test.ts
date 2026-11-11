/** Validation of the message counter against the REMOTE STAGING D1 (never production).
 * Opt-in: STAGING_D1_VALIDATE=1 npx vitest run src/ai/messageQuota.staging.test.ts   (run from worker/)
 * Uses synthetic stores named qa-staging-*, creates and removes only its own rows. Slow: one wrangler call per statement. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { assertStagingTarget, remoteStagingD1 } from '../testing/remoteStagingD1'
import { checkAiBudget, currentPeriod } from './usage'
import { completeMessage, cycleFor, getConsumption, releaseMessage, reserveMessage, resolveCycle, resolveLimit } from './messageQuota'
import { platformConsumption, storeConsumptionDetail } from '../services/aiMessageAdmin'

const enabled = process.env.STAGING_D1_VALIDATE === '1'
const run = enabled ? describe : describe.skip
const db = enabled ? remoteStagingD1() : (null as unknown as D1Database)
const mode = (value: 'off' | 'shadow' | 'enforce') => ({ AI_MESSAGE_QUOTA_MODE: value })
const ids: Record<string, number> = {}
const NAMES = ['one', 'multi', 'dup', 'fail', 'conc', 'shadow', 'enforce', 'cycle', 'plan', 'iso-a', 'iso-b', 'alert', 'budget-old', 'budget-new', 'off']

const ref = (store: string, key: string, feature = 'interpretacion') => ({ storeId: ids[store]!, eventKey: `qa:${key}`, feature })
const setLimit = (store: string, limit: number | null) => db.prepare('UPDATE stores SET ai_monthly_messages_override = ? WHERE id = ?').bind(limit, ids[store]).run()
const rows = async (store: string) => (await db.prepare('SELECT status, calls, channel, ai_cost_micros FROM ai_message_ledger WHERE store_id = ? ORDER BY id').bind(ids[store]).all<{ status: string; calls: number; channel: string; ai_cost_micros: number }>()).results

beforeAll(async () => {
  if (!enabled) return
  assertStagingTarget()
  const values = NAMES.map((name) => `('qa-staging-${name}', 'QA staging ${name}', 'active', '${name === 'budget-old' ? 'basico' : name === 'budget-new' || name === 'plan' ? 'emprendedor' : 'profesional'}', 'qa-staging')`).join(', ')
  await db.prepare(`INSERT INTO stores (slug, name, status, plan_code, created_by) VALUES ${values}`).run()
  const { results } = await db.prepare("SELECT id, slug FROM stores WHERE slug LIKE 'qa-staging-%'").all<{ id: number; slug: string }>()
  for (const row of results) ids[row.slug.replace('qa-staging-', '')] = row.id
}, 600_000)

afterAll(async () => {
  if (!enabled) return
  const list = Object.values(ids).join(',')
  if (!list) return
  await db.batch([
    db.prepare(`DELETE FROM ai_message_alerts WHERE store_id IN (${list})`), db.prepare(`DELETE FROM ai_message_ledger WHERE store_id IN (${list})`),
    db.prepare(`DELETE FROM platform_events WHERE store_id IN (${list})`), db.prepare(`DELETE FROM ai_usage_monthly WHERE store_id IN (${list})`),
    db.prepare(`DELETE FROM ai_usage_events WHERE store_id IN (${list})`), db.prepare(`DELETE FROM audit_log WHERE store_id IN (${list})`),
    db.prepare(`DELETE FROM store_services WHERE store_id IN (${list})`), db.prepare(`DELETE FROM stores WHERE id IN (${list})`),
  ])
}, 600_000)

run('message counter on the staging D1', () => {
  it('is the staging database and the migration is in place', async () => {
    const columns = await db.prepare("SELECT name FROM pragma_table_info('plans') WHERE name IN ('ai_monthly_messages', 'products_unlimited', 'ai_budget_policy')").all<{ name: string }>()
    expect(columns.results).toHaveLength(3)
    expect((await db.prepare("SELECT COUNT(*) AS n FROM plans WHERE is_active = 1 AND code IN ('emprendedor', 'negocio', 'mayorista')").first<{ n: number }>())?.n).toBe(0)
  }, 300_000)

  it('mode off counts nothing', async () => {
    expect((await reserveMessage(db, mode('off'), ref('off', 'o1'))).state).toBe('off')
    expect(await rows('off')).toEqual([])
  }, 300_000)

  it('one message counts one, with its cost', async () => {
    const r = ref('one', 'm1')
    expect((await reserveMessage(db, mode('shadow'), r)).state).toBe('counted')
    await completeMessage(db, mode('shadow'), r, { costMicros: 420, promptTokens: 900 })
    expect(await rows('one')).toEqual([{ status: 'consumed', calls: 1, channel: 'telegram_text', ai_cost_micros: 420 }])
    expect((await getConsumption(db, ids.one!)).used).toBe(1)
  }, 300_000)

  it('several model calls inside one interaction count once; a duplicate or retry adds nothing', async () => {
    const r = ref('multi', 'm1')
    await reserveMessage(db, mode('shadow'), r)
    await completeMessage(db, mode('shadow'), r, { costMicros: 300, promptTokens: 700 })
    expect((await reserveMessage(db, mode('shadow'), r)).state).toBe('duplicate')
    await completeMessage(db, mode('shadow'), r, { costMicros: 200, promptTokens: 500 })
    expect(await rows('multi')).toEqual([{ status: 'consumed', calls: 2, channel: 'telegram_text', ai_cost_micros: 500 }])
  }, 300_000)

  it('the same event delivered again is a duplicate', async () => {
    const r = ref('dup', 'm1')
    expect((await reserveMessage(db, mode('shadow'), r)).state).toBe('counted')
    expect((await reserveMessage(db, mode('shadow'), r)).state).toBe('duplicate')
    expect((await rows('dup'))).toHaveLength(1)
  }, 300_000)

  it('a provider failure releases the reservation and the retry can count once', async () => {
    const r = ref('fail', 'm1')
    await reserveMessage(db, mode('shadow'), r)
    await releaseMessage(db, mode('shadow'), r)
    expect((await rows('fail')).map((row) => row.status)).toEqual(['released'])
    expect((await getConsumption(db, ids.fail!)).used).toBe(0)
    expect((await reserveMessage(db, mode('shadow'), r)).state).toBe('counted')
    await completeMessage(db, mode('shadow'), r, { costMicros: 100, promptTokens: 100 })
    expect((await rows('fail')).map((row) => row.status)).toEqual(['consumed'])
  }, 300_000)

  it('simultaneous requests near the limit never exceed it (enforce, test store only)', async () => {
    await setLimit('conc', 3)
    const results = await Promise.all(Array.from({ length: 8 }, (_, index) => reserveMessage(db, mode('enforce'), ref('conc', `c${index}`))))
    expect(results.filter((result) => result.state === 'counted')).toHaveLength(3)
    expect(results.filter((result) => result.state === 'blocked')).toHaveLength(5)
    expect(await rows('conc')).toHaveLength(3)
  }, 600_000)

  it('shadow mode never blocks, even far over the quota', async () => {
    await setLimit('shadow', 2)
    for (let index = 0; index < 4; index++) {
      const r = ref('shadow', `s${index}`)
      expect((await reserveMessage(db, mode('shadow'), r)).state).toBe('counted')
      await completeMessage(db, mode('shadow'), r, { costMicros: 10, promptTokens: 1 })
    }
    expect((await getConsumption(db, ids.shadow!)).used).toBe(4)
  }, 600_000)

  it('enforce blocks only AI interactions beyond the quota (test store only)', async () => {
    await setLimit('enforce', 2)
    for (let index = 0; index < 2; index++) {
      const r = ref('enforce', `e${index}`)
      await reserveMessage(db, mode('enforce'), r)
      await completeMessage(db, mode('enforce'), r, { costMicros: 10, promptTokens: 1 })
    }
    expect((await reserveMessage(db, mode('enforce'), ref('enforce', 'e9'))).state).toBe('blocked')
  }, 600_000)

  it('80 % and 100 % alerts fire once each per cycle', async () => {
    await setLimit('alert', 5)
    const alerts: Array<number | null> = []
    for (let index = 0; index < 7; index++) {
      const r = ref('alert', `a${index}`)
      await reserveMessage(db, mode('shadow'), r)
      alerts.push((await completeMessage(db, mode('shadow'), r, { costMicros: 10, promptTokens: 1 })).alert?.threshold ?? null)
    }
    expect(alerts).toEqual([null, null, null, 80, 100, null, null])
  }, 900_000)

  it('cycle: a change of anchor day moves the window; the next period starts again at zero', async () => {
    const r = ref('cycle', 'c1')
    await reserveMessage(db, mode('shadow'), r)
    await completeMessage(db, mode('shadow'), r, { costMicros: 10, promptTokens: 1 })
    const now = new Date()
    const current = await getConsumption(db, ids.cycle!, now)
    expect(current.used).toBe(1)
    expect(current.cycle.source).toBe('calendar')
    const later = new Date(now.getTime() + 40 * 86_400_000)
    expect((await getConsumption(db, ids.cycle!, later)).used).toBe(0)
    await db.prepare('UPDATE stores SET ai_cycle_anchor_day = 15 WHERE id = ?').bind(ids.cycle).run()
    const anchored = await resolveCycle(db, ids.cycle!, new Date('2026-11-20T12:00:00Z'))
    expect(anchored).toMatchObject({ key: '2026-11-15', end: '2026-12-15', source: 'store' })
    expect(cycleFor(15, new Date('2026-11-20T12:00:00Z'), 'store').key).toBe(anchored.key)
  }, 600_000)

  it('plan change in tests: Emprendedor 500 -> Negocio without a numeric cap', async () => {
    expect(await resolveLimit(db, ids.plan!)).toMatchObject({ planCode: 'emprendedor', limit: 500, policy: 'quota' })
    await db.prepare("UPDATE stores SET plan_code = 'negocio' WHERE id = ?").bind(ids.plan).run()
    expect(await resolveLimit(db, ids.plan!)).toMatchObject({ planCode: 'negocio', limit: null, policy: 'monitored' })
  }, 300_000)

  it('multi-store isolation: one store at its limit does not affect another', async () => {
    await setLimit('iso-a', 1)
    const a = ref('iso-a', 'i1')
    await reserveMessage(db, mode('enforce'), a)
    await completeMessage(db, mode('enforce'), a, { costMicros: 10, promptTokens: 1 })
    expect((await reserveMessage(db, mode('enforce'), ref('iso-a', 'i2'))).state).toBe('blocked')
    expect((await reserveMessage(db, mode('enforce'), ref('iso-b', 'i1'))).state).toBe('counted')
    expect((await getConsumption(db, ids['iso-b']!)).used).toBe(0)
  }, 600_000)

  it('cost budget is a separate protection: old plans are still cut off, the new plans only alert', async () => {
    const spend = (store: string, micros: number) => db.prepare('INSERT INTO ai_usage_monthly (store_id, period, requests, estimated_cost_micros) VALUES (?, ?, 1, ?)').bind(ids[store], currentPeriod(), micros).run()
    await db.prepare('UPDATE stores SET ai_monthly_budget_micros = 1000000 WHERE id = ?').bind(ids['budget-old']).run()
    await db.prepare('UPDATE stores SET ai_monthly_budget_micros = 5000000 WHERE id = ?').bind(ids['budget-new']).run()
    await spend('budget-old', 1_000_000)
    await spend('budget-new', 15_000_000)
    expect(await checkAiBudget(db, {}, ids['budget-old']!)).toMatchObject({ allowed: false, reason: 'budget_exhausted' })
    expect(await checkAiBudget(db, {}, ids['budget-new']!)).toMatchObject({ allowed: true, warn: true })
  }, 600_000)

  it('administrative API reads the staging data and keeps stores apart', async () => {
    const overview = await platformConsumption(db, mode('shadow'), { limit: 500 })
    const ours = overview.items.filter((item) => item.store.slug.startsWith('qa-staging-'))
    expect(ours.length).toBe(NAMES.length)
    expect(overview.mode).toBe('shadow')
    const detail = await storeConsumptionDetail(db, mode('shadow'), 'qa-staging-multi')
    expect(detail.used).toBe(1)
    expect(JSON.stringify(detail)).not.toContain('qa-staging-one')
  }, 900_000)
})
