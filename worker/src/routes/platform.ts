import { Hono } from 'hono'
import type { Context } from 'hono'
import type { Env } from '../index'
import { platformAuth } from '../middleware/auth'
import { provisionStore, ProvisioningError } from '../services/provisioning'
import {
  addStoreService, assignOwner, getStoreDetail, listStores, platformSummary, PlatformError, purgeStore, recentEvents, regenerateOwnerAccess,
  renameStoreSlug, requestCustomDomain, setStoreAiBudget, setStorePlan, setStoreStatus, storesHealth,
} from '../services/platform'
import type { StoreStatus } from '../tenancy/stores'
import { getStoreBySlug } from '../tenancy/stores'
import { TemplateError } from '../email/templates'
import { createTemplate, duplicateTemplate, emailHistory, emailStatus, listTemplates, previewTemplate, sendTestEmail, setTemplateActive, updateTemplate, variablesFor } from '../email/manage'
import { regularizeOwner, storesWithoutVerifiedOwner } from '../services/ownerRegularization'
import { CreditError, creditSummary, grantCredits, listCreditCosts, listCreditMovements, listCreditRequests, resolveCreditRequest, setCreditCost } from '../ai/credits'
import { ConversionError, convertTrial, discardActivationRequest, listActivationRequests, trialMetrics } from '../services/trialConversion'
import { getTrialSettings, setTrialSettings, SettingsError } from '../services/trialSettings'
import { aiUsageAlerts, currentBillingPeriod, generateInvoices, listInvoices, setDomainStatus, setInvoiceStatus } from '../services/billing'

const app = new Hono<Env>()
app.use('*', platformAuth)

function actor(c: Context<Env>): string {
  return `platform:${c.get('adminEmail') || 'superadmin'}`
}

function fail(c: Context<Env>, error: unknown) {
  if (error instanceof ConversionError) return c.json({ error: error.message, code: error.code }, error.status)
  if (error instanceof SettingsError) return c.json({ error: error.message, code: error.code }, 400)
  if (error instanceof CreditError) return c.json({ error: error.message, code: error.code }, error.status)
  if (error instanceof TemplateError) return c.json({ error: error.message, code: error.code }, error.code.endsWith('NOT_FOUND') ? 404 : 400)
  if (error instanceof PlatformError || error instanceof ProvisioningError) {
    const status = error.code.endsWith('NOT_FOUND') ? 404 : ['SLUG_TAKEN', 'DOMAIN_TAKEN', 'INVALID_TRANSITION', 'TELEGRAM_IN_USE', 'STORE_ACTIVE'].includes(error.code) ? 409 : 400
    return c.json({ error: error.message, code: error.code }, status)
  }
  throw error
}

app.get('/summary', async (c) => c.json(await platformSummary(c.env.DB)))
app.get('/plans', async (c) => c.json({ items: (await c.env.DB.prepare('SELECT code, name, setup_price AS setupPrice, monthly_price AS monthlyPrice, currency, ai_monthly_budget_micros AS aiBudgetMicros, max_products AS maxProducts, features_json AS features FROM plans WHERE is_active = 1 ORDER BY sort_order').all()).results || [] }))
app.get('/events', async (c) => c.json({ items: await recentEvents(c.env.DB, { level: c.req.query('level'), limit: Number(c.req.query('limit') || 20) }) }))
app.get('/health', async (c) => c.json({ items: await storesHealth(c.env.DB) }))
app.get('/stores', async (c) => c.json({ items: await listStores(c.env.DB, { status: c.req.query('status'), query: c.req.query('q') }) }))

app.get('/stores/:slug', async (c) => {
  try { return c.json(await getStoreDetail(c.env.DB, c.env, c.req.param('slug'))) } catch (error) { return fail(c, error) }
})

// POST /api/platform/stores — automated provisioning (idempotent by Idempotency-Key)
app.post('/stores', async (c) => {
  const body = await c.req.json().catch(() => null)
  const requestKey = (c.req.header('Idempotency-Key') || '').trim()
  if (!body) return c.json({ error: 'Invalid JSON body' }, 400)
  if (!/^[\w.:-]{8,120}$/.test(requestKey)) return c.json({ error: 'A valid Idempotency-Key header is required' }, 400)
  try {
    const result = await provisionStore(c.env.DB, c.env, body, { requestKey, actor: actor(c) })
    return c.json(result, result.status === 'completed' ? (result.replayed ? 200 : 201) : result.status === 'running' ? 202 : 422)
  } catch (error) { return fail(c, error) }
})

app.post('/stores/:slug/status', async (c) => {
  const body = await c.req.json().catch(() => null) as { status?: StoreStatus; reason?: string } | null
  if (!body?.status || !['active', 'suspended', 'cancelled', 'draft'].includes(body.status)) return c.json({ error: 'Invalid status' }, 400)
  try { return c.json(await setStoreStatus(c.env.DB, c.req.param('slug'), body.status, actor(c), body.reason)) } catch (error) { return fail(c, error) }
})

app.put('/stores/:slug/plan', async (c) => {
  const body = await c.req.json().catch(() => null) as { planCode?: string } | null
  if (!body?.planCode) return c.json({ error: 'planCode is required' }, 400)
  try { return c.json(await setStorePlan(c.env.DB, c.req.param('slug'), body.planCode, actor(c))) } catch (error) { return fail(c, error) }
})

app.put('/stores/:slug/ai', async (c) => {
  const body = await c.req.json().catch(() => null) as { budgetUsd?: number; enabled?: boolean; warnPercent?: number } | null
  if (!body) return c.json({ error: 'Invalid JSON body' }, 400)
  try { return c.json(await setStoreAiBudget(c.env.DB, c.req.param('slug'), body, actor(c))) } catch (error) { return fail(c, error) }
})

app.post('/stores/:slug/owner', async (c) => {
  const body = await c.req.json().catch(() => null) as { email?: string; telegramUserId?: string; name?: string } | null
  if (!body) return c.json({ error: 'Invalid JSON body' }, 400)
  try { return c.json(await assignOwner(c.env.DB, c.env, c.req.param('slug'), body, actor(c))) } catch (error) { return fail(c, error) }
})

app.post('/stores/:slug/access', async (c) => {
  try { return c.json(await regenerateOwnerAccess(c.env.DB, c.env, c.req.param('slug'), actor(c))) } catch (error) { return fail(c, error) }
})

app.post('/stores/:slug/services', async (c) => {
  const body = await c.req.json().catch(() => null) as { serviceCode?: string; billing?: string; price?: number; status?: string; notes?: string } | null
  const codes = ['instalacion', 'mantenimiento_mensual', 'dominio_propio', 'personalizacion_visual', 'asistente_ia', 'soporte_prioritario', 'otro']
  if (!body?.serviceCode || !codes.includes(body.serviceCode)) return c.json({ error: 'Invalid serviceCode' }, 400)
  if (body.billing && !['unico', 'mensual', 'anual'].includes(body.billing)) return c.json({ error: 'Invalid billing' }, 400)
  if (body.status && !['pendiente', 'activo', 'suspendido', 'cancelado'].includes(body.status)) return c.json({ error: 'Invalid status' }, 400)
  try { return c.json(await addStoreService(c.env.DB, c.req.param('slug'), { ...body, serviceCode: body.serviceCode }, actor(c)), 201) } catch (error) { return fail(c, error) }
})

app.put('/stores/:slug/domain', async (c) => {
  const body = await c.req.json().catch(() => null) as { domain?: string } | null
  if (!body?.domain) return c.json({ error: 'domain is required' }, 400)
  try { return c.json(await requestCustomDomain(c.env.DB, c.req.param('slug'), body.domain, actor(c))) } catch (error) { return fail(c, error) }
})

app.put('/stores/:slug/slug', async (c) => {
  const body = await c.req.json().catch(() => null) as { slug?: string } | null
  if (!body?.slug) return c.json({ error: 'slug is required' }, 400)
  try { return c.json(await renameStoreSlug(c.env.DB, c.req.param('slug'), body.slug.trim().toLowerCase(), actor(c))) } catch (error) { return fail(c, error) }
})

// DELETE /api/platform/stores/:slug — permanent removal of a non-active,
// non-primary store (test stores, cancelled clients). Body: { "confirm": "<slug>" }.
app.delete('/stores/:slug', async (c) => {
  const body = await c.req.json().catch(() => null) as { confirm?: string } | null
  try { return c.json(await purgeStore(c.env.DB, c.env.ASSETS, c.req.param('slug'), String(body?.confirm || ''), actor(c))) } catch (error) { return fail(c, error) }
})

// Billing: invoices generated from active services and plan prices; payment is recorded manually.
app.get('/invoices', async (c) => c.json({ items: await listInvoices(c.env.DB, { status: c.req.query('status'), slug: c.req.query('store') }) }))
app.post('/invoices/generate', async (c) => {
  const body = await c.req.json().catch(() => ({})) as { period?: string }
  try { return c.json(await generateInvoices(c.env.DB, body.period || currentBillingPeriod(), actor(c))) } catch (error) { return fail(c, error) }
})
app.post('/invoices/:id/status', async (c) => {
  const body = await c.req.json().catch(() => null) as { status?: string } | null
  if (body?.status !== 'pagada' && body?.status !== 'anulada') return c.json({ error: 'Invalid status' }, 400)
  try { return c.json(await setInvoiceStatus(c.env.DB, Number(c.req.param('id')), body.status, actor(c))) } catch (error) { return fail(c, error) }
})

// Custom domains: pendiente → verificado → activo → retirado (DNS and the Cloudflare custom domain are manual steps).
app.post('/domains/:domain/status', async (c) => {
  const body = await c.req.json().catch(() => null) as { status?: string } | null
  if (!body?.status || !['verificado', 'activo', 'retirado'].includes(body.status)) return c.json({ error: 'Invalid status' }, 400)
  try { return c.json(await setDomainStatus(c.env.DB, c.req.param('domain'), body.status as 'verificado' | 'activo' | 'retirado', actor(c))) } catch (error) { return fail(c, error) }
})

// AI credits: costs per action, balances, recharges/adjustments and merchant recharge requests.
// Only the platform superadmin reaches these routes; merchants can only read and request.
app.get('/credits/costs', async (c) => c.json({ items: await listCreditCosts(c.env.DB) }))
app.put('/credits/costs/:feature', async (c) => {
  const body = await c.req.json().catch(() => null) as { credits?: unknown; enabled?: unknown } | null
  if (!body) return c.json({ error: 'Invalid JSON body' }, 400)
  try { return c.json(await setCreditCost(c.env.DB, c.req.param('feature'), body, actor(c))) } catch (error) { return fail(c, error) }
})
app.get('/credits/requests', async (c) => c.json({ items: await listCreditRequests(c.env.DB, { status: c.req.query('status'), limit: Number(c.req.query('limit') || 50) }) }))
app.post('/credits/requests/:id/resolve', async (c) => {
  const body = await c.req.json().catch(() => null) as { decision?: unknown; credits?: unknown; note?: unknown } | null
  if (!body) return c.json({ error: 'Invalid JSON body' }, 400)
  try { return c.json(await resolveCreditRequest(c.env.DB, Number(c.req.param('id')), body, actor(c))) } catch (error) { return fail(c, error) }
})
app.get('/stores/:slug/credits', async (c) => {
  const store = await getStoreBySlug(c.env.DB, c.req.param('slug'))
  if (!store) return c.json({ error: 'Store not found', code: 'STORE_NOT_FOUND' }, 404)
  return c.json({
    ...(await creditSummary(c.env.DB, store.id)),
    movements: await listCreditMovements(c.env.DB, store.id, Number(c.req.query('limit') || 50)),
    requests: await listCreditRequests(c.env.DB, { storeId: store.id, limit: 20 }),
  })
})
app.post('/stores/:slug/credits', async (c) => {
  const store = await getStoreBySlug(c.env.DB, c.req.param('slug'))
  if (!store) return c.json({ error: 'Store not found', code: 'STORE_NOT_FOUND' }, 404)
  const body = await c.req.json().catch(() => null) as { kind?: unknown; amount?: unknown; reason?: unknown } | null
  if (!body) return c.json({ error: 'Invalid JSON body' }, 400)
  try {
    const result = await grantCredits(c.env.DB, store.id, body, (c.req.header('Idempotency-Key') || '').trim(), actor(c))
    return c.json(result, result.replayed ? 200 : 201)
  } catch (error) { return fail(c, error) }
})

// Diagnostic: which Gemini models this platform key can use (names only, never the key).
app.get('/ai/models', async (c) => {
  if (!c.env.GEMINI_API_KEY) return c.json({ configured: false, items: [] })
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': c.env.GEMINI_API_KEY } })
  if (!response.ok) return c.json({ configured: true, error: `HTTP ${response.status}`, items: [] }, 502)
  const body = await response.json() as { models?: Array<{ name?: string; displayName?: string; supportedGenerationMethods?: string[] }> }
  const items = (body.models || [])
    .filter((model) => model.supportedGenerationMethods?.includes('generateContent'))
    .map((model) => ({ name: String(model.name || '').replace(/^models\//, ''), displayName: model.displayName || '' }))
  return c.json({ configured: true, textModel: c.env.GEMINI_MODEL || null, imageModel: c.env.GEMINI_IMAGE_MODEL || null, items })
})

// Email templates and send history (superadmin). Links are produced only by the system flows.
app.get('/email/status', (c) => c.json(emailStatus(c.env)))
app.get('/email/templates', async (c) => c.json({ items: (await listTemplates(c.env.DB)).map((template) => ({ ...template, variables: variablesFor(template.systemKey) })) }))
app.post('/email/templates', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body) return c.json({ error: 'Invalid JSON body' }, 400)
  try { return c.json(await createTemplate(c.env.DB, body, actor(c)), 201) } catch (error) { return fail(c, error) }
})
app.put('/email/templates/:id', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body) return c.json({ error: 'Invalid JSON body' }, 400)
  try { return c.json(await updateTemplate(c.env.DB, Number(c.req.param('id')), body, actor(c))) } catch (error) { return fail(c, error) }
})
app.post('/email/templates/:id/duplicate', async (c) => {
  try { return c.json(await duplicateTemplate(c.env.DB, Number(c.req.param('id')), actor(c)), 201) } catch (error) { return fail(c, error) }
})
app.post('/email/templates/:id/status', async (c) => {
  const body = await c.req.json().catch(() => null) as { active?: unknown } | null
  if (typeof body?.active !== 'boolean') return c.json({ error: 'active must be true or false' }, 400)
  try { return c.json(await setTemplateActive(c.env.DB, Number(c.req.param('id')), body.active, actor(c))) } catch (error) { return fail(c, error) }
})
app.post('/email/templates/:id/preview', async (c) => {
  const body = await c.req.json().catch(() => ({})) as { draft?: Record<string, unknown> }
  try { return c.json(await previewTemplate(c.env.DB, Number(c.req.param('id')), body.draft)) } catch (error) { return fail(c, error) }
})
app.post('/email/templates/:id/test', async (c) => {
  const body = await c.req.json().catch(() => null) as { to?: unknown } | null
  try { return c.json(await sendTestEmail(c.env.DB, c.env, Number(c.req.param('id')), body?.to, (c.req.header('Idempotency-Key') || '').trim(), actor(c))) } catch (error) { return fail(c, error) }
})
app.get('/email/messages', async (c) => c.json({ items: await emailHistory(c.env.DB, { status: c.req.query('status'), purpose: c.req.query('purpose'), limit: Number(c.req.query('limit') || 100) }) }))

// Stores without an owner whose email is verified, and their supervised regularization.
app.get('/owners/unverified', async (c) => c.json({ items: await storesWithoutVerifiedOwner(c.env.DB) }))
app.post('/stores/:slug/owner-regularization', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body) return c.json({ error: 'Invalid JSON body' }, 400)
  try { return c.json(await regularizeOwner(c.env.DB, c.env, c.req.param('slug'), body, actor(c))) } catch (error) { return fail(c, error) }
})

// Mini-store trials: real metrics, settings and activation requests (conversion is idempotent).
app.get('/trials/summary', async (c) => c.json(await trialMetrics(c.env.DB)))
app.get('/trials/settings', async (c) => c.json(await getTrialSettings(c.env.DB)))
app.put('/trials/settings', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body || typeof body !== 'object') return c.json({ error: 'Invalid JSON body' }, 400)
  try { return c.json(await setTrialSettings(c.env.DB, body, actor(c))) } catch (error) { return fail(c, error) }
})
app.get('/trials/requests', async (c) => c.json({ items: await listActivationRequests(c.env.DB, { status: c.req.query('status') }) }))
app.post('/trials/requests/:id/convert', async (c) => {
  const body = await c.req.json().catch(() => ({})) as { planCode?: unknown }
  try { return c.json(await convertTrial(c.env.DB, c.env, Number(c.req.param('id')), body || {}, actor(c))) } catch (error) { return fail(c, error) }
})
app.post('/trials/requests/:id/discard', async (c) => {
  try { return c.json(await discardActivationRequest(c.env.DB, Number(c.req.param('id')), actor(c))) } catch (error) { return fail(c, error) }
})

app.get('/ai-alerts', async (c) => c.json({ items: await aiUsageAlerts(c.env.DB) }))

app.get('/jobs/:id', async (c) => {
  const job = await c.env.DB.prepare('SELECT id, slug, store_id AS storeId, status, current_step AS currentStep, steps_json AS steps, error_code AS errorCode, attempts, created_at AS createdAt, completed_at AS completedAt FROM provisioning_jobs WHERE id = ?').bind(c.req.param('id')).first<Record<string, unknown>>()
  if (!job) return c.json({ error: 'Job not found' }, 404)
  return c.json({ ...job, steps: JSON.parse(String(job.steps || '[]')) })
})

export default app
