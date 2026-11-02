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
 GEMINI_API_KEY?: string
 GEMINI_MODEL?: string
 ALLOWED_ORIGIN?: string
 }
 Variables: {
 isAdmin: boolean
 adminEmail?: string
 }
}

const app = new Hono<Env>()

// Middleware global
app.use('*', logger())
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
 allowHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
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

// Rutas protegidas (requieren autenticación admin)
app.route('/api/admin', adminRoutes)

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

export default app
