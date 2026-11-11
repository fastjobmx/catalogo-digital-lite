/** Coherence between the commercial offer, the plan configuration and what the backend really enforces:
 * product limits, cost budget policy, message quota, photo and description allowances. Synthetic data only. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness, createStoreUser, seedCatalog, seedStore, stubTelegram, textUpdate, type Harness } from '../testing/harness'
import { createCatalogProduct, productLimit } from '../services/business'
import { checkAiBudget, currentPeriod, estimateCostMicros } from './usage'
import { COUNTED_FEATURES, getConsumption } from './messageQuota'

let h: Harness
const planOf = (code: string) => h.db.query<Record<string, unknown>>('SELECT * FROM plans WHERE code = ?', code)[0]!
const storeWith = async (slug: string, plan: string) => seedStore(h.db, { slug, name: slug, status: 'active', plan })
const addUsage = (store: number, feature: string, when = "datetime('now')", status = 'ok') =>
  h.db.query(`INSERT INTO ai_usage_events (store_id, period, feature, status, created_at) VALUES (?, ?, ?, ?, ${when})`, store, currentPeriod(), feature, status)
const setSpent = (store: number, micros: number) =>
  h.db.query('INSERT INTO ai_usage_monthly (store_id, period, requests, estimated_cost_micros) VALUES (?, ?, 1, ?) ON CONFLICT(store_id, period) DO UPDATE SET estimated_cost_micros = excluded.estimated_cost_micros', store, currentPeriod(), micros)

beforeEach(() => { h = createHarness({ MASTER_BOT_TOKEN: 'master-token', MASTER_WEBHOOK_SECRET: 'master-secret', MASTER_ADMIN_TELEGRAM_IDS: '9001' }) })
afterEach(() => vi.unstubAllGlobals())

describe('the commercial offer is what the plan rows say', () => {
  it('Emprendedor, Negocio and Mayorista match the approved offer and are inactive', () => {
    const pick = (code: string) => {
      const plan = planOf(code)
      return { active: plan.is_active, products: plan.max_products, unlimited: plan.products_unlimited, messages: plan.ai_monthly_messages, photos: plan.ai_photo_monthly, descriptions: plan.ai_description_monthly, usage: plan.ai_usage_policy, budget: plan.ai_budget_policy }
    }
    expect(pick('emprendedor')).toEqual({ active: 0, products: 150, unlimited: 0, messages: 500, photos: 50, descriptions: 200, usage: 'quota', budget: 'observe' })
    expect(pick('negocio')).toEqual({ active: 0, products: 500, unlimited: 0, messages: null, photos: 150, descriptions: null, usage: 'monitored', budget: 'observe' })
    expect(pick('mayorista')).toMatchObject({ active: 0, unlimited: 1, messages: null, photos: 400, descriptions: null, usage: 'monitored', budget: 'observe' })
  })

  it('the existing plans keep their limits and their cost protection', () => {
    const rows = h.db.query<Record<string, unknown>>("SELECT code, max_products, products_unlimited, ai_monthly_budget_micros, ai_budget_policy, ai_monthly_messages, ai_photo_monthly, ai_description_monthly, is_active FROM plans WHERE code IN ('basico', 'profesional', 'premium', 'legacy') ORDER BY sort_order")
    expect(rows).toEqual([
      { code: 'basico', max_products: 100, products_unlimited: 0, ai_monthly_budget_micros: 1_000_000, ai_budget_policy: 'enforced', ai_monthly_messages: null, ai_photo_monthly: null, ai_description_monthly: null, is_active: 1 },
      { code: 'profesional', max_products: 500, products_unlimited: 0, ai_monthly_budget_micros: 3_000_000, ai_budget_policy: 'enforced', ai_monthly_messages: null, ai_photo_monthly: null, ai_description_monthly: null, is_active: 1 },
      { code: 'premium', max_products: 2000, products_unlimited: 0, ai_monthly_budget_micros: 8_000_000, ai_budget_policy: 'enforced', ai_monthly_messages: null, ai_photo_monthly: null, ai_description_monthly: null, is_active: 1 },
      { code: 'legacy', max_products: 2000, products_unlimited: 0, ai_monthly_budget_micros: 5_000_000, ai_budget_policy: 'enforced', ai_monthly_messages: null, ai_photo_monthly: null, ai_description_monthly: null, is_active: 1 },
    ])
  })
})

describe('product limit enforced by the backend', () => {
  it('reads 150 / 500 / unlimited for the new plans and keeps the old ones', async () => {
    const stores = { emprendedor: await storeWith('s-emp', 'emprendedor'), negocio: await storeWith('s-neg', 'negocio'), mayorista: await storeWith('s-may', 'mayorista'), basico: await storeWith('s-bas', 'basico'), premium: await storeWith('s-pre', 'premium') }
    expect((await productLimit(h.db, stores.emprendedor)).max).toBe(150)
    expect((await productLimit(h.db, stores.negocio)).max).toBe(500)
    expect((await productLimit(h.db, stores.mayorista)).max).toBeNull()
    expect((await productLimit(h.db, stores.basico)).max).toBe(100)
    expect((await productLimit(h.db, stores.premium)).max).toBe(2000)
  })

  it('Emprendedor refuses product 151; Mayorista keeps creating past 150 and 500 without any invented cap', async () => {
    const emp = await storeWith('e150', 'emprendedor')
    const may = await storeWith('m501', 'mayorista')
    const products = (n: number) => Array.from({ length: n }, (_, index) => ({ sku: `P-${index}`, name: `Producto ${index}`, price: 1000, variants: [{ stock: 1 }] }))
    await seedCatalog(h.db, emp, { products: products(150) })
    await seedCatalog(h.db, may, { products: products(501) })
    await expect(createCatalogProduct(h.db, { sku: 'NUEVO', name: 'Nuevo', price: 1 }, { actor: 't', source: 'admin', storeId: emp })).rejects.toThrow('PLAN_PRODUCT_LIMIT')
    await expect(createCatalogProduct(h.db, { sku: 'NUEVO', name: 'Nuevo', price: 1 }, { actor: 't', source: 'admin', storeId: may })).resolves.toMatchObject({ sku: 'NUEVO' })
  })

  it('the platform plan list shows null (unlimited) and never the placeholder', async () => {
    h.db.query("UPDATE plans SET is_active = 1 WHERE code = 'mayorista'")
    const { superadminToken } = await import('../testing/harness')
    const body = await (await h.request('/api/platform/plans', { token: await superadminToken() })).json() as { items: Array<Record<string, unknown>> }
    expect(body.items.find((plan) => plan.code === 'mayorista')).toMatchObject({ maxProducts: null, productsUnlimited: 1, aiPhotoMonthly: 400 })
    expect(JSON.stringify(body)).not.toContain('2147483647')
  })
})

describe('cost budget versus message quota', () => {
  it('a typical interaction costs about 420 micro-USD, so 500 messages are about US$0.21', () => {
    // 900 prompt + 60 output tokens at the default prices (US$0.30 / US$2.50 per million tokens).
    expect(estimateCostMicros({}, { promptTokens: 900, outputTokens: 60 })).toBe(420)
    expect(500 * estimateCostMicros({}, { promptTokens: 900, outputTokens: 60 })).toBe(210_000)
  })

  it('existing plans (policy enforced) are still cut off when the budget is spent', async () => {
    const store = await storeWith('antiguo', 'basico')
    h.db.query('UPDATE stores SET ai_monthly_budget_micros = 1000000 WHERE id = ?', store)
    setSpent(store, 1_000_000)
    expect(await checkAiBudget(h.db, h.env, store)).toMatchObject({ allowed: false, reason: 'budget_exhausted' })
    const legacy = await storeWith('antiguo-legacy', 'legacy')
    h.db.query('UPDATE stores SET ai_monthly_budget_micros = 5000000 WHERE id = ?', legacy)
    setSpent(legacy, 5_000_000)
    expect(await checkAiBudget(h.db, h.env, legacy)).toMatchObject({ allowed: false, reason: 'budget_exhausted' })
  })

  it('the new plans only alert at the budget reference: they are never interrupted by it', async () => {
    for (const plan of ['emprendedor', 'negocio', 'mayorista']) {
      const store = await storeWith(`nuevo-${plan}`, plan)
      h.db.query('UPDATE stores SET ai_monthly_budget_micros = (SELECT ai_monthly_budget_micros FROM plans WHERE code = ?) WHERE id = ?', plan, store)
      const budget = planOf(plan).ai_monthly_budget_micros as number
      setSpent(store, budget * 3)
      expect(await checkAiBudget(h.db, h.env, store)).toMatchObject({ allowed: true, warn: true })
    }
  })

  it('the hard protections remain for every plan: AI switched off, suspended store and the platform cap', async () => {
    const store = await storeWith('protegida', 'emprendedor')
    h.db.query('UPDATE stores SET ai_enabled = 0 WHERE id = ?', store)
    expect(await checkAiBudget(h.db, h.env, store)).toMatchObject({ allowed: false, reason: 'disabled' })
    h.db.query('UPDATE stores SET ai_enabled = 1, status = ? WHERE id = ?', 'suspended', store)
    expect(await checkAiBudget(h.db, h.env, store)).toMatchObject({ allowed: false, reason: 'store_unavailable' })
    h.db.query("UPDATE stores SET status = 'active' WHERE id = ?", store)
    setSpent(store, 100)
    expect(await checkAiBudget(h.db, { ...h.env, PLATFORM_AI_MONTHLY_CAP_MICROS: '50' }, store)).toMatchObject({ allowed: false, reason: 'platform_cap' })
  })

  it('with the OLD budgets of US$2 / 6 / 10, photo use would have cut the bot before the offer was reached (why they were replaced)', () => {
    // Assumption to verify with real measurements: one image ~1,290 output tokens at US$60 per million = ~77,400 micro-USD.
    const imageMicros = Math.ceil((1290 * 60_000_000) / 1_000_000)
    expect(imageMicros).toBe(77_400)
    expect(50 * imageMicros).toBeGreaterThan(2_000_000)
    expect(150 * imageMicros).toBeGreaterThan(6_000_000)
    expect(400 * imageMicros).toBeGreaterThan(10_000_000)
    // The new alert references cover the included photos plus the messages of the offer.
    expect(50 * imageMicros + 500 * 420).toBeLessThan(planOf('emprendedor').ai_monthly_budget_micros as number)
    expect(150 * imageMicros + 3000 * 420).toBeLessThan(planOf('negocio').ai_monthly_budget_micros as number)
    expect(400 * imageMicros + 10000 * 420).toBeLessThan(planOf('mayorista').ai_monthly_budget_micros as number)
  })
})

describe('photo and description allowances', () => {
  it('descriptions and photos do not use the message quota; they are observed against their own figures', async () => {
    expect(COUNTED_FEATURES.has('descripcion')).toBe(false)
    expect(COUNTED_FEATURES.has('foto_packshot')).toBe(false)
    const store = await storeWith('cuotas', 'emprendedor')
    await createStoreUser(h.db, { email: 'c@c.test', storeId: store, role: 'owner' })
    for (const feature of ['foto_packshot', 'foto_premium', 'estudio_imagen', 'descripcion', 'descripcion']) addUsage(store, feature)
    addUsage(store, 'foto_packshot', "datetime('now')", 'error')
    addUsage(store, 'foto_packshot', "datetime('now', '-70 days')")
    const info = await getConsumption(h.db, store)
    expect(info.photos).toEqual({ used: 3, included: 50, remaining: 47 })
    expect(info.descriptions).toEqual({ used: 2, included: 200, remaining: 198 })
    expect(info.used).toBe(0)
  })

  it('plans without a figure show usage with no numeric allowance', async () => {
    const store = await storeWith('sin-cifra', 'negocio')
    addUsage(store, 'descripcion')
    const info = await getConsumption(h.db, store)
    expect(info.descriptions).toEqual({ used: 1, included: null, remaining: null })
    expect(info.photos.included).toBe(150)
  })

  it('another store never sees these counts', async () => {
    const a = await storeWith('aislada-a', 'emprendedor')
    const b = await storeWith('aislada-b', 'emprendedor')
    addUsage(a, 'foto_packshot')
    expect((await getConsumption(h.db, b)).photos.used).toBe(0)
  })
})

describe('the internal "unlimited" marker is never read as a real limit', () => {
  it('the master bot shows "productos ilimitados" and never the placeholder', async () => {
    h.db.query("UPDATE plans SET is_active = 1 WHERE code IN ('mayorista', 'emprendedor')")
    const telegram = stubTelegram()
    await h.request('/api/master/webhook', { method: 'POST', body: textUpdate(9001, '/configuracion'), headers: { 'X-Telegram-Bot-Api-Secret-Token': 'master-secret' } })
    const text = telegram.messages().join(' | ')
    expect(text).toContain('productos ilimitados')
    expect(text).toContain('hasta 150 productos')
    expect(text).not.toContain('2147483647')
    expect(text).not.toContain('2.147.483.647')
  })

  it('only the vetted modules read max_products; any new reader must honour products_unlimited', () => {
    const readers: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) walk(path)
        else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name) && /max_products/.test(readFileSync(path, 'utf8'))) readers.push(path.replaceAll('\\', '/').split('/src/')[1]!)
      }
    }
    walk(join(process.cwd(), 'src'))
    expect(readers.sort()).toEqual(['routes/platform.ts', 'services/business.ts', 'services/master/bot.ts'])
    for (const file of readers) {
      const source = readFileSync(join(process.cwd(), 'src', file), 'utf8').split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n')
      const uses = source.match(/max_products/g)!.length
      const guarded = source.match(/products_unlimited = 1 THEN NULL ELSE (?:p.)?max_products/g)?.length ?? 0
      expect(guarded, file).toBe(uses)
    }
  })
})

describe('safeguards for the allowances that are not enforced, and real-cost measurement', () => {
  it('tells the platform at 80 % and 100 % of the included photos, once per cycle, without blocking anything', async () => {
    const { recordAiUsage } = await import('./usage')
    const store = await storeWith('fotos-80', 'emprendedor')
    const usage = { promptTokens: 1200, outputTokens: 1290 }
    for (let index = 0; index < 52; index++) {
      const result = await recordAiUsage(h.db, h.env, { storeId: store, feature: 'foto_packshot', usage, status: 'ok' })
      expect(result.status.allowed).toBe(true)
    }
    const events = (code: string) => h.db.query('SELECT detail FROM platform_events WHERE store_id = ? AND code = ?', store, code)
    expect(events('AI_PHOTOS_80')).toHaveLength(1)
    expect(events('AI_PHOTOS_100')).toHaveLength(1)
    expect(JSON.stringify(events('AI_PHOTOS_100'))).toContain('solo observación')
  })

  it('a store without included photos or descriptions raises no allowance event', async () => {
    const { recordAiUsage } = await import('./usage')
    const store = await storeWith('sin-cuota', 'profesional')
    for (let index = 0; index < 5; index++) await recordAiUsage(h.db, h.env, { storeId: store, feature: 'foto_packshot', usage: { promptTokens: 10, outputTokens: 10 }, status: 'ok' })
    expect(h.db.query("SELECT 1 FROM platform_events WHERE store_id = ? AND code LIKE 'AI_PHOTOS%'", store)).toEqual([])
  })

  it('the cost report separates conversations, voice, photos, descriptions and the rest, and prorates infrastructure only when informed', async () => {
    const { recordAiUsage } = await import('./usage')
    const { aiCostReport } = await import('../services/aiMessageAdmin')
    const store = await storeWith('costos', 'profesional')
    const call = (feature: string, outputTokens: number, status: 'ok' | 'error' = 'ok') => recordAiUsage(h.db, h.env, { storeId: store, feature, usage: { promptTokens: 1000, outputTokens }, status })
    await call('interpretacion', 60); await call('interpretacion', 60); await call('consejos', 200); await call('voz', 80)
    await call('foto_premium', 1290); await call('descripcion', 150); await call('documentos', 300); await call('foto_packshot', 0, 'error')
    h.db.query("INSERT INTO ai_message_ledger (store_id, cycle_key, event_key, channel, feature, status, audio_seconds, transcription_cost_micros) VALUES (?, '2026-11-01', 'qa:v1', 'telegram_voice', 'voz', 'consumed', 12, 116)", store)
    const report = await aiCostReport(h.db, { days: 30, infraMonthlyMicros: 20_000_000 })
    expect(Object.keys(report.categories).sort()).toEqual(['conversaciones', 'descripciones', 'fotos', 'otros', 'voz'])
    expect(report.categories.conversaciones).toMatchObject({ calls: 3 })
    expect(report.categories.fotos).toMatchObject({ calls: 1, errors: 1 })
    expect(report.categories.fotos!.avgCostPerCallMicros).toBeGreaterThan(report.categories.conversaciones!.avgCostPerCallMicros!)
    expect(report.transcription).toMatchObject({ voiceNotes: 1, audioSeconds: 12, estimatedAudioShareMicros: 116 })
    expect(report.totals).toMatchObject({ infrastructureMicros: 20_000_000, infrastructureMeasured: false })
    expect(report.isEstimate).toBe(true)
    expect((await aiCostReport(h.db, {})).totals.infrastructureMicros).toBeNull()
  })

  it('the cost report is only for the superadministrator', async () => {
    const { superadminToken } = await import('../testing/harness')
    expect((await h.request('/api/platform/ai-costs')).status).toBe(401)
    expect((await h.request('/api/platform/ai-costs?days=7', { token: await superadminToken() })).status).toBe(200)
  })
})
