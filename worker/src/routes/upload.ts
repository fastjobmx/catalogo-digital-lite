import { Hono } from 'hono'
import type { Env } from '../index'
import { adminAuth } from '../middleware/auth'
import { uploadStoreImage } from '../services/business'

const app = new Hono<Env>()

app.post('/image', adminAuth, async (c) => {
 const formData = await c.req.formData()
 const file = formData.get('file') as File | null
 const folder = (formData.get('folder') as string) || 'products'

 if (!file || !(file instanceof File)) {
 return c.json({ error: 'No file provided' }, 400)
 }

 // Validar tipo de archivo
 const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
 if (!allowedTypes.includes(file.type)) {
 return c.json({ error: 'Invalid file type. Allowed: jpeg, png, webp, gif' }, 400)
 }

 // Validar tamaño máximo (5MB)
 const MAX_SIZE = 5 * 1024 * 1024
 if (file.size > MAX_SIZE) {
 return c.json({ error: 'File too large. Max 5MB' }, 400)
 }

 try {
 // Intentar subir a R2 si está disponible
 if (c.env.ASSETS) {
 const asset = await uploadStoreImage(c.env.ASSETS, file, folder)

 // URL pública via R2 public bucket o worker proxy
 const url = `/api/assets/${asset.key}`
 return c.json({ url, ...asset })
 }

 // Fallback para desarrollo sin R2: retornar URL mock
 // En producción siempre se requiere R2 configurado
 return c.json({
 url: `https://placehold.co/800x800/0057FF/FFFFFF?text=${encodeURIComponent(file.name)}`,
 key: `${folder}/${file.name}`,
 size: file.size,
 type: file.type,
 warning: 'R2 not configured. Using placeholder URL. Configure ASSETS binding for production.',
 })
 } catch (err) {
 console.error('Upload failed:', err)
 return c.json({ error: 'Upload failed' }, 500)
 }
})

// GET /api/assets/:key+ - Servir imagen desde R2
app.get('/:key{.+}', async (c) => {
 const key = c.req.param('key')

 if (!c.env.ASSETS) {
 return c.json({ error: 'Assets storage not configured' }, 503)
 }

 const object = await c.env.ASSETS.get(key)
 if (!object) {
 return c.json({ error: 'Asset not found' }, 404)
 }

 const headers = new Headers()
 object.writeHttpMetadata(headers)
 headers.set('etag', object.httpEtag)
 headers.set('cache-control', 'public, max-age=31536000, immutable')

 return new Response(object.body, { headers })
})

export default app
