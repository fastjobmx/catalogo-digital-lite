/** /api/creative · Estudio Creativo IA (fase 1): resumen, Brand Kit y trabajos.
 * La tienda la resuelve adminAuth; solo owner/admin (capacidad marketing.manage) entran. */
import { Hono, type Context } from 'hono'
import type { Env } from '../index'
import { adminAuth, requireCapability } from '../middleware/auth'
import { taskAvailability } from '../creative/aiRouter'
import { ALLOWED_FONTS, CreativeError, TONES, VISUAL_STYLES, brandKitService, storeAppearanceHints } from '../creative/brandKit'
import { creativeJobService, isJobKind, JOB_STATUSES } from '../creative/jobs'
import { CREATIVE_MODULES, CREATIVE_STUDIO, ENGINES_AVAILABLE } from '../creative/modules'
import type { CreativeContext, CreativeJobStatus } from '../creative/contracts'

const app = new Hono<Env>()
app.use('*', adminAuth, requireCapability('marketing.manage'))
app.use('*', async (c, next) => { await next(); c.header('Cache-Control', 'private, no-store') })

const ctx = (c: Context<Env>): CreativeContext => ({ storeId: c.get('storeId')!, actor: c.get('adminEmail') || 'unknown', role: c.get('role')! })
function fail(c: Context<Env>, error: unknown) {
  if (error instanceof CreativeError) return c.json({ error: error.message, code: error.code }, error.status)
  throw error
}

app.get('/overview', async (c) => {
  const store = await c.env.DB.prepare('SELECT ai_enabled FROM stores WHERE id = ?').bind(c.get('storeId')).first<{ ai_enabled: number }>()
  return c.json({
    ...CREATIVE_STUDIO,
    modules: CREATIVE_MODULES,
    aiEnabled: Boolean(store?.ai_enabled) && Boolean(c.env.GEMINI_API_KEY),
    // Sin secretos: solo si cada tipo de tarea tiene hoy un modelo utilizable.
    tasks: taskAvailability(c.env),
  })
})

app.get('/brand-kit', async (c) => c.json({
  kit: await brandKitService(c.env.DB).get(ctx(c)),
  hints: await storeAppearanceHints(c.env.DB, c.get('storeId')!),
  options: { fonts: ALLOWED_FONTS, visualStyles: VISUAL_STYLES, tones: TONES },
}))

app.put('/brand-kit', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return c.json({ error: 'Invalid JSON body' }, 400)
  try { return c.json({ kit: await brandKitService(c.env.DB).update(ctx(c), body) }) } catch (error) { return fail(c, error) }
})

app.get('/jobs', async (c) => {
  const status = c.req.query('status')
  if (status && !JOB_STATUSES.includes(status as CreativeJobStatus)) return c.json({ error: 'Estado desconocido', code: 'INVALID_STATUS' }, 400)
  return c.json({ items: await creativeJobService(c.env.DB).list(ctx(c), { status: status as CreativeJobStatus | undefined, limit: Number(c.req.query('limit')) || undefined }) })
})

app.get('/jobs/:id', async (c) => {
  const job = await creativeJobService(c.env.DB).get(ctx(c), c.req.param('id'))
  return job ? c.json(job) : c.json({ error: 'Trabajo no encontrado', code: 'JOB_NOT_FOUND' }, 404)
})

// Crear trabajos requiere un motor conectado. En la fase 1 no hay ninguno: se responde con honestidad.
app.post('/jobs', async (c) => {
  const body = await c.req.json().catch(() => null) as { kind?: unknown; input?: unknown } | null
  if (!body || !isJobKind(body.kind)) return c.json({ error: 'Tipo de trabajo desconocido', code: 'INVALID_KIND' }, 400)
  if (!ENGINES_AVAILABLE[body.kind]) return c.json({ error: 'Esta función del Estudio Creativo todavía no está disponible.', code: 'ENGINE_UNAVAILABLE' }, 409)
  const input = body.input && typeof body.input === 'object' && !Array.isArray(body.input) ? body.input as Record<string, unknown> : {}
  try {
    const result = await creativeJobService(c.env.DB).create(ctx(c), { kind: body.kind, idempotencyKey: (c.req.header('Idempotency-Key') || '').trim(), input })
    return c.json(result, result.replayed ? 200 : 201)
  } catch (error) { return fail(c, error) }
})

app.post('/jobs/:id/cancel', async (c) => {
  try { return c.json(await creativeJobService(c.env.DB).cancel(ctx(c), c.req.param('id'))) } catch (error) { return fail(c, error) }
})

export default app
