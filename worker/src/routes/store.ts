import { Hono } from 'hono'
import type { Env } from '../index'
import { mapStoreRow } from '../lib/storeMap'
import { publicStore } from '../middleware/tenant'

const app = new Hono<Env>()

// GET /api/store - Obtener configuración pública de la tienda
app.get('/', publicStore, async (c) => {
  const db = c.env.DB
  const store = c.get('store')!
  const result = await db.prepare(
    `SELECT name, description, slogan, business_type, logo_url, favicon_url, cover_image_url,
            primary_color, secondary_color, accent_color, button_color,
            whatsapp_phone, whatsapp_orders, phone, email, address, hours,
            instagram, facebook, tiktok, maps_url, currency, country,
            delivery_methods, pickup_available, payment_info, default_whatsapp_message,
            theme_config
     FROM store_config WHERE id = ?`
  ).bind(store.id).first()

  if (!result) {
    return c.json({ error: 'Store not configured' }, 404)
  }

  return c.json({ ...mapStoreRow(result as Record<string, unknown>), slug: store.slug, status: store.status })
})

export default app