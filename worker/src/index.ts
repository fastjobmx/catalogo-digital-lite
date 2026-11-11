import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { prettyJSON } from 'hono/pretty-json'
import storeRoutes from './routes/store'
import productsRoutes from './routes/products'
import categoriesRoutes from './routes/categories'
import adminRoutes from './routes/admin'
import healthRoutes from './routes/health'
import uploadRoutes from './routes/upload'
import telegramRoutes from './routes/telegram'
import ordersRoutes from './routes/orders'
import platformRoutes from './routes/platform'
import authRoutes from './routes/auth'
import masterRoutes from './routes/master'
import creativeRoutes from './routes/creative'
import { maintainCreativeJobs } from './creative/jobs'
import { processPendingPhotoJobs } from './creative/photoEngine'
import { processPendingVideoJobs } from './creative/videoEngine'
import { cleanupAssistantMemory } from './services/assistant/context'
import { cleanupExpiredTelegramProductAssets } from './services/telegramProductImages'
import { releaseExpiredReservations } from './ai/credits'
import trialRoutes from './routes/trial'
import seoRoutes from './routes/seo'
import emailRoutes from './routes/email'
import { purgeEmailLogs } from './email/send'
import { pollDeliveryStatus } from './email/webhooks'
import { cleanupExpiredTrials } from './services/trials'
import { cleanupOrderDocuments } from './services/orderDocuments'
import type { Principal, EffectiveRole } from './tenancy/access'
import type { StoreRecord } from './tenancy/stores'

export type Env = {
 Bindings: {
 DB: D1Database
 ASSETS?: R2Bucket
 ENVIRONMENT?: string
 STORE_NAME: string
 STORE_CURRENCY: string
 STORE_COUNTRY: string
 JWT_SECRET?: string
 ADMIN_EMAIL?: string
 ADMIN_PASSWORD?: string
 ADMIN_PASSWORD_HASH?: string
 COMMERCE_ENABLED?: string
 TELEGRAM_BOT_TOKEN?: string
 TELEGRAM_WEBHOOK_SECRET?: string
 TELEGRAM_WEBHOOK_URL?: string
 TELEGRAM_OWNER_ID?: string
 TELEGRAM_ENV_LABEL?: string
 /** Maximum photos accepted in one Telegram product batch (defaults to 100, capped at 500). */
 TELEGRAM_BATCH_MAX_ITEMS?: string
 /** Maximum combined image bytes accepted in one Telegram product batch (defaults to 200 MiB). */
 TELEGRAM_BATCH_MAX_BYTES?: string
 /** Public username of the shared store assistant bot (for t.me deep links). */
 TELEGRAM_BOT_USERNAME?: string
 /** Optional platform-wide monthly AI cap (estimated USD micros). */
 PLATFORM_AI_MONTHLY_CAP_MICROS?: string
 GEMINI_API_KEY?: string
 GEMINI_MODEL?: string
 /** Gemini model that returns images (AI Studio). Unset = the studio is not offered. */
 GEMINI_IMAGE_MODEL?: string
 /** Estudio Creativo IA: modelos extra para el enrutador (JSON sin secretos; ver docs/ESTUDIO_CREATIVO_IA.md). */
 CREATIVE_AI_MODELS?: string
 GEMINI_VIDEO_MODEL?: string
 GEMINI_VIDEO_PRICE_OUTPUT_MICROS_PER_MTOK?: string
 /** Telegram assistant: 'false' turns off the natural-language commerce interpreter / voice notes (previous behaviour stays). */
 TELEGRAM_SMART_INTERPRETER_ENABLED?: string
 TELEGRAM_VOICE_ENABLED?: string
 /** Catalogue trial without sign-up: 'false' turns it off. */
 TRIALS_ENABLED?: string
 /** Email: provider name ('resend'), sender address and API key (secret). Unset = emails are recorded as not configured. */
 EMAIL_PROVIDER?: string
 EMAIL_FROM?: string
 RESEND_API_KEY?: string
 /** Extra addresses allowed to receive template test emails (comma separated). The superadmin email is always allowed. */
 EMAIL_TEST_RECIPIENTS?: string
 /** Reply-To for platform emails (an address with a real inbox or forwarding, e.g. soporte@<domain>). */
 EMAIL_REPLY_TO?: string
 /** Signing secret of the Resend webhook (whsec_…), for delivery, bounce and complaint events. */
 RESEND_WEBHOOK_SECRET?: string
 /** Days of email history kept (default 180, minimum 30). */
 EMAIL_LOG_RETENTION_DAYS?: string
 /** Maximum trials created per day across the platform (default 300). */
 TRIALS_DAILY_LIMIT?: string
 /** Output price per million tokens for that image model, in micro-dollars (for the monthly budget). */
 GEMINI_IMAGE_PRICE_OUTPUT_MICROS_PER_MTOK?: string
 /** Estimated USD micros per million tokens (configurable; used for budgets). */
 GEMINI_PRICE_INPUT_MICROS_PER_MTOK?: string
 GEMINI_PRICE_OUTPUT_MICROS_PER_MTOK?: string
 ALLOWED_ORIGIN?: string
 /** Public storefront base URL used in links (e.g. https://catalogo-digital-ia.catalogo-lite-worker.workers.dev). */
 PUBLIC_STORE_BASE_URL?: string
 /** Master (platform) bot. Separate token and webhook secret from store bots. */
 MASTER_BOT_TOKEN?: string
 MASTER_WEBHOOK_SECRET?: string
 MASTER_ADMIN_TELEGRAM_IDS?: string
 MASTER_ENV_LABEL?: string
 }
 Variables: {
 isAdmin: boolean
 adminEmail?: string
 principal?: Principal
 store?: StoreRecord
 storeId?: number
 role?: EffectiveRole
 }
}

const app = new Hono<Env>()

// Middleware global
app.use('*', (c, next) => c.env?.ENVIRONMENT === 'test' ? next() : logger()(c, next))
app.use('*', prettyJSON())
app.use('*', cors({
 origin: (origin, c) => {
   const defaults = String(c.env.ENVIRONMENT || '').toLowerCase() === 'production' ? [] : [
     'http://localhost:5173',
     'http://localhost:5174',
     'http://localhost:8788',
     'http://127.0.0.1:5173',
     'http://127.0.0.1:5174',
     'http://127.0.0.1:8788',
   ]
   const extra = String(c.env.ALLOWED_ORIGIN || '')
     .split(',')
     .map((s: string) => s.trim())
     .filter(Boolean)
   const allowed = [...defaults, ...extra]
   return origin && allowed.includes(origin) ? origin : null
 },
 credentials: true,
 allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
 allowHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Store-Slug', 'X-Store-Host', 'X-Trial-Token'],
}))

// Rutas públicas (sin autenticación)
app.route('/api/health', healthRoutes)
app.route('/api/store', storeRoutes)
app.route('/api/products', productsRoutes)
app.route('/api/categories', categoriesRoutes)
app.route('/api/upload', uploadRoutes)
app.route('/api/assets', uploadRoutes)
app.route('/api/trial', trialRoutes)
app.route('/api/orders', ordersRoutes)
app.route('/api/telegram', telegramRoutes)
app.route('/api/auth', authRoutes)
app.route('/api/master', masterRoutes)
app.route('/api/seo', seoRoutes)
app.route('/api/email', emailRoutes)

// Rutas protegidas (requieren autenticación admin)
app.route('/api/admin', adminRoutes)
// Administración de la plataforma (solo superadministrador)
app.route('/api/platform', platformRoutes)
// Estudio Creativo IA (owner/admin de la tienda resuelta en el backend)
app.route('/api/creative', creativeRoutes)

// Manejo de errores global
app.onError((err, c) => {
 console.error('Unhandled error:', err)
 return c.json({
 error: 'Internal Server Error',
 message: c.env.ENVIRONMENT === 'development' ? err.message : undefined,
 }, 500)
})

// Ruta 404
app.notFound((c) => {
 return c.json({ error: 'Not Found', path: c.req.path }, 404)
})

const worker = {
 fetch: (request: Request, env: Env['Bindings'], context: ExecutionContext) => app.fetch(request, env, context),
 scheduled: (controller: ScheduledController, env: Env['Bindings'], context: ExecutionContext) => {
  // Once a day (first tick after 08:00 UTC): email history retention.
  const tick = new Date(controller?.scheduledTime || Date.now())
  if (tick.getUTCHours() === 8 && tick.getUTCMinutes() < 15) context.waitUntil(purgeEmailLogs(env.DB, env).catch((error) => console.error('Email log retention failed:', error instanceof Error ? error.message : 'unknown')))
  // Delivery outcome of recent emails, asked to the provider (works with or without the webhook).
  context.waitUntil(pollDeliveryStatus(env.DB, env).catch((error) => console.error('Email delivery check failed:', error instanceof Error ? error.message : 'unknown')))
  if (env.ASSETS) context.waitUntil(cleanupExpiredTelegramProductAssets(env.DB, env.ASSETS))
  context.waitUntil(cleanupOrderDocuments(env.DB, env.ASSETS).catch((error) => console.error('Order documents cleanup failed:', error instanceof Error ? error.message : 'unknown')))
  context.waitUntil(cleanupExpiredTrials(env.DB, env.ASSETS).catch((error) => console.error('Trial cleanup failed:', error instanceof Error ? error.message : 'unknown')))
  context.waitUntil(releaseExpiredReservations(env.DB).catch((error) => console.error('AI credit reservation cleanup failed:', error instanceof Error ? error.message : 'unknown')))
  // Estudio Creativo: primero libera trabajos caídos; después avanza la cola de fotos pendientes.
  context.waitUntil(maintainCreativeJobs(env.DB).then(() => processPendingPhotoJobs(env)).then(() => processPendingVideoJobs(env)).catch((error) => console.error('Creative jobs maintenance failed:', error instanceof Error ? error.message : 'unknown')))
  context.waitUntil(cleanupAssistantMemory(env.DB).catch((error) => console.error('Assistant memory cleanup failed:', error instanceof Error ? error.message : 'unknown')))
 },
}

export default worker
