/** /api/creative · Estudio Creativo IA: resumen, Brand Kit, trabajos, biblioteca y estudio fotográfico.
 * La tienda la resuelve adminAuth; solo owner/admin (capacidad marketing.manage) entran. */
import { Hono, type Context } from 'hono'
import type { Env } from '../index'
import { adminAuth, requireCapability } from '../middleware/auth'
import { taskAvailability } from '../creative/aiRouter'
import { ALLOWED_FONTS, CreativeError, TONES, VISUAL_STYLES, brandKitService, storeAppearanceHints } from '../creative/brandKit'
import { creativeJobService, isJobKind, JOB_STATUSES, retryJob } from '../creative/jobs'
import { assetLibrary } from '../creative/library'
import { cancelPhotoBatch, createPhotoBatch, PHOTO_OPERATIONS, photoBatchStatus, photoCatalog, quotePhotoBatch, runPhotoJob } from '../creative/photoEngine'
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

// Ruta genérica: no crea trabajos. Los de foto se crean por lotes en /photo/batches (con cotización y confirmación).
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

app.post('/jobs/:id/retry', async (c) => {
  try { return c.json(await retryJob(c.env.DB, ctx(c), c.req.param('id'))) } catch (error) { return fail(c, error) }
})

// Ejecuta un trabajo pendiente de la tienda. El panel llama aquí para avanzar el lote; el cron hace lo mismo en segundo plano.
app.post('/jobs/:id/run', async (c) => {
  const job = await runPhotoJob(c.env, c.get('storeId')!, c.req.param('id'))
  if (job) return c.json(job)
  const current = await creativeJobService(c.env.DB).get(ctx(c), c.req.param('id'))
  if (!current) return c.json({ error: 'Trabajo no encontrado', code: 'JOB_NOT_FOUND' }, 404)
  return current.status === 'pendiente' ? c.json({ error: 'Tu tienda ya está procesando otras fotos. Este trabajo sigue en cola.', code: 'STORE_BUSY' }, 429) : c.json(current)
})

// ---- Estudio fotográfico --------------------------------------------------------------------
app.get('/photo/catalog', async (c) => c.json(await photoCatalog(c.env, c.get('storeId')!)))

app.post('/photo/quote', async (c) => {
  const body = await c.req.json().catch(() => null) as { operation?: unknown; count?: unknown } | null
  if (!body) return c.json({ error: 'Invalid JSON body' }, 400)
  try { return c.json(await quotePhotoBatch(c.env, ctx(c), body.operation, body.count)) } catch (error) { return fail(c, error) }
})

app.post('/photo/batches', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body || typeof body !== 'object') return c.json({ error: 'Invalid JSON body' }, 400)
  try {
    const result = await createPhotoBatch(c.env, ctx(c), body, (c.req.header('Idempotency-Key') || '').trim())
    return c.json(result, result.replayed ? 200 : 201)
  } catch (error) { return fail(c, error) }
})

app.get('/photo/batches/:id', async (c) => {
  const status = await photoBatchStatus(c.env, ctx(c), c.req.param('id'))
  return status.total ? c.json(status) : c.json({ error: 'Lote no encontrado', code: 'BATCH_NOT_FOUND' }, 404)
})

app.post('/photo/batches/:id/cancel', async (c) => {
  const cancelled = await cancelPhotoBatch(c.env, ctx(c), c.req.param('id'))
  const status = await photoBatchStatus(c.env, ctx(c), c.req.param('id'))
  return status.total ? c.json({ cancelled, ...status }) : c.json({ error: 'Lote no encontrado', code: 'BATCH_NOT_FOUND' }, 404)
})

// ---- Biblioteca de recursos -------------------------------------------------------------------
const library = (c: Context<Env>) => assetLibrary(c.env.DB, c.env.ASSETS)

app.get('/assets', async (c) => c.json({
  items: await library(c).list(ctx(c), {
    role: c.req.query('role'), status: c.req.query('status'), productId: Number(c.req.query('productId')) || undefined,
    sourceId: c.req.query('sourceId'), limit: Number(c.req.query('limit')) || undefined, before: c.req.query('before'),
  }),
}))

app.post('/assets', async (c) => {
  const form = await c.req.formData().catch(() => null)
  try {
    const result = await library(c).upload(ctx(c), form?.get('file'), form?.get('productId') ?? undefined)
    return c.json(result, result.duplicate ? 200 : 201)
  } catch (error) { return fail(c, error) }
})

app.post('/assets/import-product', async (c) => {
  const body = await c.req.json().catch(() => null) as { productId?: unknown; imageUrl?: unknown } | null
  if (!body) return c.json({ error: 'Invalid JSON body' }, 400)
  try { return c.json(await library(c).importProductImage(ctx(c), body.productId, body.imageUrl)) } catch (error) { return fail(c, error) }
})

app.post('/assets/import-telegram', async (c) => {
  const body = await c.req.json().catch(() => null) as { batchId?: unknown; itemId?: unknown } | null
  if (!body) return c.json({ error: 'Invalid JSON body' }, 400)
  try { return c.json(await library(c).importTelegramItem(ctx(c), body.batchId, body.itemId)) } catch (error) { return fail(c, error) }
})

app.get('/assets/:id', async (c) => {
  const asset = await library(c).get(ctx(c), c.req.param('id'))
  return asset ? c.json(asset) : c.json({ error: 'Recurso no encontrado', code: 'ASSET_NOT_FOUND' }, 404)
})

// Archivo privado: solo con sesión de la tienda dueña. Nunca se sirve por /api/assets.
app.get('/assets/:id/file', async (c) => {
  try {
    const file = await library(c).readFile(ctx(c), c.req.param('id'))
    return new Response(file.body, { headers: { 'Content-Type': file.contentType, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': c.req.query('download') ? 'attachment' : 'inline' } })
  } catch (error) { return fail(c, error) }
})

// Resultado de una edición convencional (nivel A) hecha en el navegador: sin IA y sin créditos.
app.post('/assets/:id/edits', async (c) => {
  const form = await c.req.formData().catch(() => null)
  const file = form?.get('file')
  const operation = String(form?.get('operation') || '')
  if (!(file instanceof File)) return c.json({ error: 'Falta la imagen', code: 'INVALID_IMAGE' }, 400)
  if (PHOTO_OPERATIONS[operation]?.runsIn !== 'navegador') return c.json({ error: 'Elige un tipo de edición válido', code: 'INVALID_OPERATION' }, 400)
  try {
    const asset = await library(c).saveResult(ctx(c), { sourceId: c.req.param('id'), bytes: new Uint8Array(await file.arrayBuffer()), level: 'A', operation, model: null, credits: 0, costMicros: 0, jobId: null, origin: 'navegador' })
    return c.json(asset, 201)
  } catch (error) { return fail(c, error) }
})

app.post('/assets/:id/approve', async (c) => {
  const body = await c.req.json().catch(() => ({})) as { attach?: unknown; productId?: unknown }
  try { return c.json(await library(c).approve(ctx(c), c.req.param('id'), body || {})) } catch (error) { return fail(c, error) }
})

app.post('/assets/:id/discard', async (c) => {
  try { return c.json(await library(c).discard(ctx(c), c.req.param('id'))) } catch (error) { return fail(c, error) }
})

export default app
