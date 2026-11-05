/** Catalogue trial without sign-up: a temporary, unpublished preview that lives 48 hours.
 * It never creates users or stores, stores no contact data and keeps the visitor's IP only as a hash. */
import type { Env } from '../index'
import { TEMPLATE_KEYS } from './templates'

export const TRIAL_HOURS = 48
export const TRIAL_MAX_PHOTOS = 6
export const TRIAL_MAX_PRODUCTS = 12
const MAX_PHOTO_BYTES = 5 * 1024 * 1024
const LIMITS = { create: 5, photo: 40, save: 120 } as const // per IP and hour

export class TrialError extends Error {
  constructor(readonly code: string, message: string, readonly status: 400 | 401 | 404 | 409 | 410 | 413 | 429 | 503 = 400) { super(message) }
}

const clean = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '')
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const randomToken = (bytes: number) => b64url(crypto.getRandomValues(new Uint8Array(bytes)))
async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
export const ipHash = (env: Partial<Env['Bindings']>, ip: string) => sha256(`trial:${ip.trim().slice(0, 100) || 'unknown'}:${env.JWT_SECRET || ''}`)

export function trialsEnabled(env: Partial<Env['Bindings']>): boolean {
  return env.TRIALS_ENABLED !== 'false'
}

/** Counts one hit for this IP and action in the current hour; refuses above the limit. */
async function rateLimit(db: D1Database, ip: string, action: keyof typeof LIMITS) {
  const window = Math.floor(Date.now() / 3_600_000)
  const row = await db.prepare(
    `INSERT INTO trial_rate_limits (rate_key, window_start, hits) VALUES (?, ?, 1)
     ON CONFLICT(rate_key, window_start) DO UPDATE SET hits = hits + 1 RETURNING hits`,
  ).bind(`${action}:${ip}`, window).first<{ hits: number }>()
  if (Number(row?.hits || 0) > LIMITS[action]) throw new TrialError('RATE_LIMITED', 'Hiciste muchas pruebas seguidas. Intenta de nuevo en una hora.', 429)
}

type TrialRow = { id: string; edit_token_hash: string; business_name: string; template: string; content_json: string; photo_count: number; created_at: string; expires_at: string }

async function loadTrial(db: D1Database, id: string): Promise<TrialRow> {
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(id)) throw new TrialError('TRIAL_NOT_FOUND', 'Esta prueba no existe', 404)
  const row = await db.prepare('SELECT * FROM trial_sessions WHERE id = ?').bind(id).first<TrialRow>()
  if (!row) throw new TrialError('TRIAL_NOT_FOUND', 'Esta prueba no existe o ya se borró', 404)
  if (row.expires_at <= new Date().toISOString().replace('T', ' ').slice(0, 19)) throw new TrialError('TRIAL_EXPIRED', 'Esta prueba ya venció y se borrará', 410)
  return row
}

async function authorize(db: D1Database, id: string, token: string | undefined): Promise<TrialRow> {
  const trial = await loadTrial(db, id)
  if (!token || (await sha256(token)) !== trial.edit_token_hash) throw new TrialError('TRIAL_FORBIDDEN', 'No puedes editar esta prueba', 401)
  return trial
}

function publicView(row: TrialRow) {
  const content = JSON.parse(row.content_json || '{}') as { products?: unknown[] }
  return { id: row.id, businessName: row.business_name, template: row.template, products: content.products || [], expiresAt: `${row.expires_at.replace(' ', 'T')}Z`, temporary: true, published: false }
}

export async function createTrial(db: D1Database, env: Partial<Env['Bindings']>, ip: string, body: { businessName?: unknown; template?: unknown }) {
  if (!trialsEnabled(env)) throw new TrialError('TRIALS_DISABLED', 'Las pruebas no están disponibles en este momento', 503)
  const businessName = clean(body.businessName, 80)
  if (businessName.length < 2) throw new TrialError('INVALID_NAME', 'Escribe el nombre de tu negocio')
  const template = typeof body.template === 'string' && (TEMPLATE_KEYS as readonly string[]).includes(body.template) ? body.template : 'moderno'
  const hashedIp = await ipHash(env, ip)
  await rateLimit(db, hashedIp, 'create')
  const daily = Number(env.TRIALS_DAILY_LIMIT || 300)
  const today = await db.prepare("SELECT COUNT(*) AS n FROM trial_sessions WHERE created_at >= datetime('now', '-1 day')").first<{ n: number }>()
  if (Number(today?.n || 0) >= daily) throw new TrialError('TRIALS_BUSY', 'Hay muchas pruebas activas. Intenta de nuevo más tarde.', 503)
  const id = randomToken(16)
  const editToken = randomToken(32)
  await db.prepare(`INSERT INTO trial_sessions (id, edit_token_hash, business_name, template, ip_hash, expires_at) VALUES (?, ?, ?, ?, ?, datetime('now', '+${TRIAL_HOURS} hours'))`)
    .bind(id, await sha256(editToken), businessName, template, hashedIp).run()
  return { ...publicView((await loadTrial(db, id))), editToken }
}

export async function getTrial(db: D1Database, id: string) {
  return publicView(await loadTrial(db, id))
}

function imageType(bytes: Uint8Array): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') return 'image/webp'
  return null
}

export async function addTrialPhoto(db: D1Database, env: Partial<Env['Bindings']>, ip: string, id: string, token: string | undefined, file: unknown) {
  const trial = await authorize(db, id, token)
  await rateLimit(db, await ipHash(env, ip), 'photo')
  if (!env.ASSETS) throw new TrialError('STORAGE_UNAVAILABLE', 'El almacenamiento no está disponible', 503)
  if (!(file instanceof File)) throw new TrialError('INVALID_PHOTO', 'Falta la foto')
  if (file.size > MAX_PHOTO_BYTES) throw new TrialError('PHOTO_TOO_LARGE', 'La foto pesa más de 5 MB', 413)
  const bytes = new Uint8Array(await file.arrayBuffer())
  const type = imageType(bytes)
  if (!type) throw new TrialError('INVALID_PHOTO', 'Usa fotos JPG, PNG o WebP')
  // Reserve the slot first so two parallel uploads cannot exceed the limit.
  const slot = await db.prepare(`UPDATE trial_sessions SET photo_count = photo_count + 1, updated_at = datetime('now') WHERE id = ? AND photo_count < ? RETURNING photo_count`).bind(trial.id, TRIAL_MAX_PHOTOS).first()
  if (!slot) throw new TrialError('TOO_MANY_PHOTOS', `La prueba admite hasta ${TRIAL_MAX_PHOTOS} fotos`, 409)
  const name = `${crypto.randomUUID()}.${type.split('/')[1]}`
  await env.ASSETS.put(`trials/${trial.id}/${name}`, bytes, { httpMetadata: { contentType: type }, customMetadata: { trial: trial.id } })
  return { url: `/api/trial/${trial.id}/assets/${name}` }
}

export async function saveTrial(db: D1Database, env: Partial<Env['Bindings']>, ip: string, id: string, token: string | undefined, body: { businessName?: unknown; template?: unknown; products?: unknown }) {
  const trial = await authorize(db, id, token)
  await rateLimit(db, await ipHash(env, ip), 'save')
  const businessName = clean(body.businessName, 80) || trial.business_name
  const template = typeof body.template === 'string' && (TEMPLATE_KEYS as readonly string[]).includes(body.template) ? body.template : trial.template
  if (!Array.isArray(body.products) || body.products.length > TRIAL_MAX_PRODUCTS) throw new TrialError('INVALID_PRODUCTS', `Agrega hasta ${TRIAL_MAX_PRODUCTS} productos`)
  const ownImage = new RegExp(`^/api/trial/${trial.id}/assets/[0-9a-f-]{36}\\.(?:jpeg|png|webp)$`)
  const products = body.products.map((raw, index) => {
    const item = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
    const name = clean(item.name, 120)
    if (!name) throw new TrialError('INVALID_PRODUCTS', `El producto ${index + 1} no tiene nombre`)
    const price = item.price === null || item.price === undefined || item.price === '' ? null : Number(item.price)
    if (price !== null && (!Number.isInteger(price) || price < 0 || price > 10_000_000_000)) throw new TrialError('INVALID_PRODUCTS', `El precio del producto ${index + 1} no es válido`)
    const imageUrl = typeof item.imageUrl === 'string' && item.imageUrl ? item.imageUrl : null
    if (imageUrl && !ownImage.test(imageUrl)) throw new TrialError('INVALID_PRODUCTS', 'Una foto no pertenece a esta prueba')
    return { name, price, description: clean(item.description, 600), imageUrl }
  })
  await db.prepare(`UPDATE trial_sessions SET business_name = ?, template = ?, content_json = ?, updated_at = datetime('now') WHERE id = ?`)
    .bind(businessName, template, JSON.stringify({ products }), trial.id).run()
  return getTrial(db, trial.id)
}

async function removeTrialAssets(bucket: R2Bucket | undefined, id: string) {
  if (!bucket) return
  let cursor: string | undefined
  do {
    const page = await bucket.list({ prefix: `trials/${id}/`, limit: 100, ...(cursor ? { cursor } : {}) })
    for (const object of page.objects) await bucket.delete(object.key)
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
}

export async function deleteTrial(db: D1Database, env: Partial<Env['Bindings']>, id: string, token: string | undefined) {
  const trial = await authorize(db, id, token)
  await removeTrialAssets(env.ASSETS, trial.id)
  await db.prepare('DELETE FROM trial_sessions WHERE id = ?').bind(trial.id).run()
  return { deleted: true }
}

/** Cron: deletes expired trials with their photos and old rate-limit windows. */
export async function cleanupExpiredTrials(db: D1Database, bucket: R2Bucket | undefined): Promise<number> {
  const { results } = await db.prepare("SELECT id FROM trial_sessions WHERE expires_at <= datetime('now') LIMIT 50").all<{ id: string }>()
  for (const row of results || []) {
    await removeTrialAssets(bucket, row.id)
    await db.prepare('DELETE FROM trial_sessions WHERE id = ?').bind(row.id).run()
  }
  await db.prepare('DELETE FROM trial_rate_limits WHERE window_start < ?').bind(Math.floor(Date.now() / 3_600_000) - 24).run()
  return (results || []).length
}

export async function trialAsset(db: D1Database, bucket: R2Bucket | undefined, id: string, file: string): Promise<Response> {
  await loadTrial(db, id)
  if (!bucket || !/^[0-9a-f-]{36}\.(?:jpeg|png|webp)$/.test(file)) throw new TrialError('ASSET_NOT_FOUND', 'Foto no encontrada', 404)
  const object = await bucket.get(`trials/${id}/${file}`)
  if (!object) throw new TrialError('ASSET_NOT_FOUND', 'Foto no encontrada', 404)
  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('cache-control', 'private, max-age=3600')
  headers.set('x-content-type-options', 'nosniff')
  headers.set('x-robots-tag', 'noindex, nofollow')
  headers.set('content-disposition', 'inline')
  return new Response(object.body, { headers })
}
