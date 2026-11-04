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
import { cleanupAssistantMemory } from './services/assistant/context'
import { cleanupExpiredTelegramProductAssets } from './services/telegramProductImages'
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
 /** Public username of the shared store assistant bot (for t.me deep links). */
 TELEGRAM_BOT_USERNAME?: string
 /** Optional platform-wide monthly AI cap (estimated USD micros). */
 PLATFORM_AI_MONTHLY_CAP_MICROS?: string
 GEMINI_API_KEY?: string
 GEMINI_MODEL?: string
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
 allowHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Store-Slug', 'X-Store-Host'],
}))

// Rutas públicas (sin autenticación)
app.route('/api/health', healthRoutes)
app.route('/api/store', storeRoutes)
app.route('/api/products', productsRoutes)
app.route('/api/categories', categoriesRoutes)
app.route('/api/upload', uploadRoutes)
app.route('/api/assets', uploadRoutes)
app.route('/api/orders', ordersRoutes)
app.route('/api/telegram', telegramRoutes)
app.route('/api/auth', authRoutes)
app.route('/api/master', masterRoutes)

// Rutas protegidas (requieren autenticación admin)
app.route('/api/admin', adminRoutes)
// Administración de la plataforma (solo superadministrador)
app.route('/api/platform', platformRoutes)

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
 scheduled: (_controller: ScheduledController, env: Env['Bindings'], context: ExecutionContext) => {
  if (env.ASSETS) context.waitUntil(cleanupExpiredTelegramProductAssets(env.DB, env.ASSETS))
  context.waitUntil(cleanupAssistantMemory(env.DB).catch((error) => console.error('Assistant memory cleanup failed:', error instanceof Error ? error.message : 'unknown')))
 },
}

export default worker
