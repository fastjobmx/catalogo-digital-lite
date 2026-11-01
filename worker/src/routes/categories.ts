import { Hono } from 'hono'
import type { Env } from '../index'

const app = new Hono<Env>()

// GET /api/categories - Listar categorías activas con conteo de productos
app.get('/', async (c) => {
 const db = c.env.DB
 const { results } = await db.prepare(`
 SELECT c.id, c.name, c.slug, c.description, c.sort_order,
 COUNT(p.id) as product_count
 FROM categories c
 LEFT JOIN products p ON p.category_id = c.id AND p.is_active = 1 AND p.is_archived = 0
 WHERE c.is_active = 1
 GROUP BY c.id
 ORDER BY c.sort_order ASC, c.name ASC
 `).all()

 return c.json(results || [])
})

export default app