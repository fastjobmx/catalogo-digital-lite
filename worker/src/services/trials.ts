/** Mini-store trial without sign-up: a temporary, unpublished store preview (name, logo, colours,
 * template and a few products) with a read-only public link and a private edit token.
 * It never creates users or stores. Real orders go by WhatsApp straight to the merchant's number (no
 * payment, no inventory); the visitor's IP is kept only as a hash.
 * Lifecycle: activa (editable until expires_at) → vencida (read-only for its owner until retain_until)
 * → eliminada (files and content deleted; the row stays for metrics) — or convertida into a real store. */
import type { Env } from '../index'
import { getTrialSettings, TRIAL_TEMPLATES, type TrialSettings, type TrialTemplate } from './trialSettings'

const LIMITS = { photo: 60, save: 600, order: 20, ordersPerTrialDay: 200 } as const // per IP and hour (create comes from settings)
/** Unused photos younger than this are kept: a save queued before an upload finished must never
 * delete the new photo. Older orphans go on a later save, and everything goes when the trial is erased. */
export const ORPHAN_GRACE_MS = 10 * 60_000
const MAX_UPLOADS_FACTOR = 4 // uploads per trial: (products + logo) × factor, so replacing photos is possible but bounded

export class TrialError extends Error {
  constructor(readonly code: string, message: string, readonly status: 400 | 401 | 404 | 409 | 410 | 413 | 429 | 503 = 400) { super(message) }
}

const clean = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '')
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const randomToken = (bytes: number) => b64url(crypto.getRandomValues(new Uint8Array(bytes)))
export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
export const ipHash = (env: Partial<Env['Bindings']>, ip: string) => sha256(`trial:${ip.trim().slice(0, 100) || 'unknown'}:${env.JWT_SECRET || ''}`)
const sqlNow = () => new Date().toISOString().replace('T', ' ').slice(0, 19)
const iso = (value: string | null) => (value ? `${value.replace(' ', 'T')}Z` : null)

export function trialsEnabled(env: Partial<Env['Bindings']>): boolean {
  return env.TRIALS_ENABLED !== 'false'
}

/** Counts one hit for this IP and action in the current hour; refuses above the limit. */
async function rateLimit(db: D1Database, ip: string, action: string, limit: number) {
  const window = Math.floor(Date.now() / 3_600_000)
  const row = await db.prepare(
    `INSERT INTO trial_rate_limits (rate_key, window_start, hits) VALUES (?, ?, 1)
     ON CONFLICT(rate_key, window_start) DO UPDATE SET hits = hits + 1 RETURNING hits`,
  ).bind(`${action}:${ip}`, window).first<{ hits: number }>()
  if (Number(row?.hits || 0) > limit) throw new TrialError('RATE_LIMITED', 'Hiciste muchas acciones seguidas. Intenta de nuevo en una hora.', 429)
}

export type TrialProduct = { id: string; name: string; price: number | null; description: string; imageUrl: string | null }
export type TrialContent = { logoUrl: string | null; whatsapp: string | null; colors: { primary: string; accent: string }; products: TrialProduct[] }
type TrialRow = {
  id: string; edit_token_hash: string; business_name: string; template: string; content_json: string; photo_count: number
  created_at: string; expires_at: string; retain_until: string | null; status: string; product_count: number; converted_store_id: number | null
}

const DEFAULT_COLORS = { primary: '#03301f', accent: '#cdf53f' }

function parseContent(json: string): TrialContent {
  let raw: Partial<TrialContent> & { products?: Array<Partial<TrialProduct>> } = {}
  try { raw = JSON.parse(json || '{}') } catch { raw = {} }
  const colors = raw.colors && typeof raw.colors === 'object' ? raw.colors : DEFAULT_COLORS
  return {
    logoUrl: typeof raw.logoUrl === 'string' ? raw.logoUrl : null,
    whatsapp: typeof raw.whatsapp === 'string' && /^\+[1-9]\d{7,14}$/.test(raw.whatsapp) ? raw.whatsapp : null,
    colors: { primary: /^#[0-9a-f]{6}$/i.test(String(colors.primary)) ? String(colors.primary) : DEFAULT_COLORS.primary, accent: /^#[0-9a-f]{6}$/i.test(String(colors.accent)) ? String(colors.accent) : DEFAULT_COLORS.accent },
    products: (raw.products || []).map((product, index) => ({
      id: typeof product.id === 'string' ? product.id : `p${index + 1}`,
      name: String(product.name || ''), price: typeof product.price === 'number' ? product.price : null,
      description: String(product.description || ''), imageUrl: typeof product.imageUrl === 'string' ? product.imageUrl : null,
    })),
  }
}

const templateOf = (value: string): TrialTemplate => ((TRIAL_TEMPLATES as readonly string[]).includes(value) ? value as TrialTemplate : 'clasica')

function phase(row: TrialRow): 'activa' | 'vencida' | 'convertida' | 'eliminada' {
  if (row.status === 'convertida' || row.status === 'eliminada') return row.status
  const now = sqlNow()
  if (row.expires_at > now) return 'activa'
  if ((row.retain_until || row.expires_at) > now) return 'vencida'
  return 'eliminada'
}

async function loadRow(db: D1Database, id: string): Promise<TrialRow> {
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(id)) throw new TrialError('TRIAL_NOT_FOUND', 'Esta prueba no existe', 404)
  const row = await db.prepare('SELECT * FROM trial_sessions WHERE id = ?').bind(id).first<TrialRow>()
  if (!row) throw new TrialError('TRIAL_NOT_FOUND', 'Esta prueba no existe o ya se borró', 404)
  return row
}

/** True when the request carries this trial's private edit token. */
export async function isTrialOwner(row: { edit_token_hash: string }, token: string | undefined): Promise<boolean> {
  return Boolean(token) && (await sha256(token!)) === row.edit_token_hash
}

async function authorize(db: D1Database, id: string, token: string | undefined, mustBeEditable = true): Promise<TrialRow> {
  const row = await loadRow(db, id)
  if (!(await isTrialOwner(row, token))) throw new TrialError('TRIAL_FORBIDDEN', 'No puedes editar esta prueba', 401)
  const state = phase(row)
  if (state === 'eliminada') throw new TrialError('TRIAL_GONE', 'Esta prueba ya se borró', 410)
  if (mustBeEditable && state !== 'activa') throw new TrialError(state === 'convertida' ? 'TRIAL_CONVERTED' : 'TRIAL_EXPIRED', state === 'convertida' ? 'Esta prueba ya se convirtió en una tienda' : 'La prueba venció: ya no se puede editar', 409)
  return row
}

/** Public (read-only) or owner view. The edit token is never part of it. */
function view(row: TrialRow, settings: TrialSettings, owner: boolean) {
  const state = phase(row)
  const content = parseContent(row.content_json)
  const base = {
    id: row.id, businessName: row.business_name, template: templateOf(row.template), state,
    expiresAt: iso(row.expires_at), deleteAfter: iso(row.retain_until || row.expires_at), owner,
    limits: { maxProducts: settings.maxProducts, maxPhotoMb: settings.maxPhotoMb, templates: settings.templates },
    temporary: true, published: false,
    // Orders open only while the trial is active, the platform allows them and the merchant left a WhatsApp.
    ordersOpen: state === 'activa' && settings.ordersEnabled && Boolean(content.whatsapp),
    ordersEnabled: settings.ordersEnabled,
  }
  // After expiry only the owner still sees the content (to activate it); the public link shows the state.
  if (state === 'eliminada' || (state === 'vencida' && !owner)) return { ...base, logoUrl: null, colors: DEFAULT_COLORS, products: [] as TrialProduct[], whatsapp: null }
  // The merchant's number is shown to the owner; buyers reach it through the order link only.
  return { ...base, ...content, whatsapp: owner ? content.whatsapp : null }
}

export async function createTrial(db: D1Database, env: Partial<Env['Bindings']>, ip: string, body: { businessName?: unknown; template?: unknown }) {
  if (!trialsEnabled(env)) throw new TrialError('TRIALS_DISABLED', 'Las pruebas no están disponibles en este momento', 503)
  const settings = await getTrialSettings(db)
  const businessName = clean(body.businessName, 80)
  if (businessName.length < 2) throw new TrialError('INVALID_NAME', 'Escribe el nombre de tu negocio')
  const template = settings.templates.includes(body.template as TrialTemplate) ? body.template as TrialTemplate : settings.templates.includes('clasica') ? 'clasica' : settings.templates[0]!
  const hashedIp = await ipHash(env, ip)
  await rateLimit(db, hashedIp, 'create', settings.createPerIpHour)
  const today = await db.prepare("SELECT COUNT(*) AS n FROM trial_sessions WHERE created_at >= datetime('now', '-1 day')").first<{ n: number }>()
  if (Number(today?.n || 0) >= Math.min(settings.dailyLimit, Number(env.TRIALS_DAILY_LIMIT || settings.dailyLimit))) throw new TrialError('TRIALS_BUSY', 'Hay muchas pruebas activas. Intenta de nuevo más tarde.', 503)
  const id = randomToken(16)
  const editToken = randomToken(32)
  const content: TrialContent = { logoUrl: null, whatsapp: null, colors: DEFAULT_COLORS, products: [] }
  await db.prepare(
    `INSERT INTO trial_sessions (id, edit_token_hash, business_name, template, content_json, ip_hash, expires_at, retain_until)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+${settings.durationHours} hours'), datetime('now', '+${settings.durationHours + settings.retentionHours} hours'))`,
  ).bind(id, await sha256(editToken), businessName, template, JSON.stringify(content), hashedIp).run()
  return { ...view(await loadRow(db, id), settings, true), editToken }
}

export async function getTrial(db: D1Database, id: string, token?: string) {
  const row = await loadRow(db, id)
  const owner = await isTrialOwner(row, token)
  if (phase(row) === 'eliminada') throw new TrialError('TRIAL_GONE', 'Esta prueba ya venció y se borró', 410)
  return view(row, await getTrialSettings(db), owner)
}

function imageType(bytes: Uint8Array): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') return 'image/webp'
  return null
}

export async function addTrialPhoto(db: D1Database, env: Partial<Env['Bindings']>, ip: string, id: string, token: string | undefined, file: unknown) {
  const trial = await authorize(db, id, token)
  const settings = await getTrialSettings(db)
  await rateLimit(db, await ipHash(env, ip), 'photo', LIMITS.photo)
  if (!env.ASSETS) throw new TrialError('STORAGE_UNAVAILABLE', 'El almacenamiento no está disponible', 503)
  if (!(file instanceof File)) throw new TrialError('INVALID_PHOTO', 'Falta la foto')
  if (file.size > settings.maxPhotoMb * 1024 * 1024) throw new TrialError('PHOTO_TOO_LARGE', `La foto pesa más de ${settings.maxPhotoMb} MB`, 413)
  const bytes = new Uint8Array(await file.arrayBuffer())
  const type = imageType(bytes)
  if (!type) throw new TrialError('INVALID_PHOTO', 'Usa fotos JPG, PNG o WebP')
  const maxUploads = (settings.maxProducts + 1) * MAX_UPLOADS_FACTOR
  const slot = await db.prepare(`UPDATE trial_sessions SET photo_count = photo_count + 1, updated_at = datetime('now') WHERE id = ? AND photo_count < ? RETURNING photo_count`).bind(trial.id, maxUploads).first()
  if (!slot) throw new TrialError('TOO_MANY_PHOTOS', 'Llegaste al máximo de fotos subidas en esta prueba', 409)
  const name = `${crypto.randomUUID()}.${type.split('/')[1]}`
  await env.ASSETS.put(`trials/${trial.id}/${name}`, bytes, { httpMetadata: { contentType: type }, customMetadata: { trial: trial.id } })
  return { url: `/api/trial/${trial.id}/assets/${name}` }
}

export async function saveTrial(db: D1Database, env: Partial<Env['Bindings']>, ip: string, id: string, token: string | undefined, body: Record<string, unknown>) {
  const trial = await authorize(db, id, token)
  const settings = await getTrialSettings(db)
  await rateLimit(db, await ipHash(env, ip), 'save', LIMITS.save)
  const current = parseContent(trial.content_json)
  const businessName = clean(body.businessName, 80) || trial.business_name
  const template = body.template === undefined ? templateOf(trial.template) : settings.templates.includes(body.template as TrialTemplate) ? body.template as TrialTemplate : null
  if (!template) throw new TrialError('INVALID_TEMPLATE', 'Esa plantilla no está disponible')
  const ownImage = new RegExp(`^/api/trial/${trial.id}/assets/[0-9a-f-]{36}\\.(?:jpeg|png|webp)$`)
  const image = (value: unknown, what: string) => {
    const url = typeof value === 'string' && value ? value : null
    if (url && !ownImage.test(url)) throw new TrialError('INVALID_PRODUCTS', `${what} no pertenece a esta prueba`)
    return url
  }
  const color = (value: unknown, fallback: string) => (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback)
  const colorsIn = body.colors && typeof body.colors === 'object' ? body.colors as Record<string, unknown> : {}
  const productsIn = body.products === undefined ? current.products : body.products
  if (!Array.isArray(productsIn)) throw new TrialError('INVALID_PRODUCTS', 'Productos no válidos')
  if (productsIn.length > settings.maxProducts) throw new TrialError('TOO_MANY_PRODUCTS', `La prueba admite hasta ${settings.maxProducts} productos`)
  const products: TrialProduct[] = productsIn.map((raw, index) => {
    const item = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
    const name = clean(item.name, 120)
    if (!name) throw new TrialError('INVALID_PRODUCTS', `El producto ${index + 1} no tiene nombre`)
    const price = item.price === null || item.price === undefined || item.price === '' ? null : Number(item.price)
    if (price !== null && (!Number.isInteger(price) || price < 0 || price > 10_000_000_000)) throw new TrialError('INVALID_PRODUCTS', `El precio del producto ${index + 1} no es válido`)
    return { id: typeof item.id === 'string' && /^[\w-]{1,40}$/.test(item.id) ? item.id : `p${index + 1}`, name, price, description: clean(item.description, 600), imageUrl: image(item.imageUrl, 'Una foto') }
  })
  let whatsapp = current.whatsapp
  if (body.whatsapp !== undefined) {
    const digits = clean(body.whatsapp, 30).replace(/[\s().-]/g, '')
    if (digits && !/^\+[1-9]\d{7,14}$/.test(digits)) throw new TrialError('INVALID_WHATSAPP', 'Escribe el WhatsApp con el código del país, por ejemplo +57 300 000 0000')
    whatsapp = digits || null
  }
  const content: TrialContent = {
    logoUrl: body.logoUrl === undefined ? current.logoUrl : image(body.logoUrl, 'El logo'),
    whatsapp,
    colors: { primary: color(colorsIn.primary, current.colors.primary), accent: color(colorsIn.accent, current.colors.accent) },
    products,
  }
  await db.prepare(`UPDATE trial_sessions SET business_name = ?, template = ?, content_json = ?, product_count = ?, updated_at = datetime('now') WHERE id = ?`)
    .bind(businessName, template, JSON.stringify(content), products.length, trial.id).run()
  // Photos that are no longer used are deleted right away: storage stays bounded. Photos of products
  // still being written in the editor (not saved yet, for example without a name) come in `keep`.
  const keep = (Array.isArray(body.keep) ? body.keep : []).slice(0, (settings.maxProducts + 1) * MAX_UPLOADS_FACTOR)
    .filter((url): url is string => typeof url === 'string' && ownImage.test(url))
  await removeTrialAssets(env.ASSETS, trial.id, new Set([content.logoUrl, ...products.map((product) => product.imageUrl), ...keep].filter(Boolean).map((url) => String(url).split('/').pop()!)), ORPHAN_GRACE_MS)
  return getTrial(db, trial.id, token)
}

export async function removeTrialAssets(bucket: R2Bucket | undefined, id: string, keep: Set<string> = new Set(), graceMs = 0) {
  if (!bucket) return
  const newest = Date.now() - graceMs
  let cursor: string | undefined
  do {
    const page = await bucket.list({ prefix: `trials/${id}/`, limit: 100, ...(cursor ? { cursor } : {}) })
    for (const object of page.objects) {
      if (keep.has(object.key.split('/').pop()!)) continue
      if (graceMs && object.uploaded && new Date(object.uploaded).getTime() > newest) continue
      await bucket.delete(object.key)
    }
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
}

/** Erases a trial's files and content; the row stays (without personal content) for the metrics. */
export async function eraseTrial(db: D1Database, bucket: R2Bucket | undefined, id: string, status: 'eliminada' | 'convertida' = 'eliminada') {
  await removeTrialAssets(bucket, id)
  await db.batch([
    db.prepare(`UPDATE trial_sessions SET status = ?, content_json = '{}', updated_at = datetime('now') WHERE id = ?`).bind(status, id),
    db.prepare('DELETE FROM trial_orders WHERE trial_id = ?').bind(id),
  ])
}

export async function deleteTrial(db: D1Database, env: Partial<Env['Bindings']>, id: string, token: string | undefined) {
  const trial = await authorize(db, id, token, false)
  if (trial.status === 'convertida') throw new TrialError('TRIAL_CONVERTED', 'Esta prueba ya se convirtió en una tienda', 409)
  await eraseTrial(db, env.ASSETS, trial.id)
  return { deleted: true }
}

/** Cron: erases trials whose retention ended (pending activation requests extend it). */
export async function cleanupExpiredTrials(db: D1Database, bucket: R2Bucket | undefined): Promise<number> {
  const { results } = await db.prepare(
    `SELECT id FROM trial_sessions WHERE status = 'activa' AND COALESCE(retain_until, expires_at) <= datetime('now') LIMIT 50`,
  ).all<{ id: string }>()
  for (const row of results || []) await eraseTrial(db, bucket, row.id)
  await db.prepare('DELETE FROM trial_rate_limits WHERE window_start < ?').bind(Math.floor(Date.now() / 3_600_000) - 24).run()
  return (results || []).length
}

/** Photos have unguessable names; after expiry they stay readable (for the owner's recovery screen)
 * until the retention ends, and the public view no longer lists them. */
export async function trialAsset(db: D1Database, bucket: R2Bucket | undefined, id: string, file: string): Promise<Response> {
  const row = await loadRow(db, id)
  const state = phase(row)
  if (state === 'eliminada' || state === 'convertida') throw new TrialError('ASSET_NOT_FOUND', 'Foto no encontrada', 404)
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

const money = (value: number) => `$ ${value.toLocaleString('es-CO')}`
function orderCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return `PRB-${[...crypto.getRandomValues(new Uint8Array(6))].map((byte) => alphabet[byte % alphabet.length]).join('')}`
}

/** Public: a real order from the temporary store. Prices and totals are computed here from the saved
 * products (never trusted from the browser); the buyer sends the message to the merchant's WhatsApp.
 * No payment is taken and there is no inventory. The buyer's phone is not stored. */
export async function placeTrialOrder(db: D1Database, env: Partial<Env['Bindings']>, ip: string, id: string, body: Record<string, unknown>) {
  const row = await loadRow(db, id)
  const settings = await getTrialSettings(db)
  const content = parseContent(row.content_json)
  if (phase(row) !== 'activa' || !settings.ordersEnabled || !content.whatsapp) throw new TrialError('ORDERS_CLOSED', 'Esta tienda no está recibiendo pedidos', 409)
  await rateLimit(db, await ipHash(env, ip), 'order', LIMITS.order)
  const today = await db.prepare(`SELECT COUNT(*) AS n FROM trial_orders WHERE trial_id = ? AND created_at >= datetime('now', '-1 day')`).bind(row.id).first<{ n: number }>()
  if (Number(today?.n || 0) >= LIMITS.ordersPerTrialDay) throw new TrialError('RATE_LIMITED', 'Esta tienda recibió muchos pedidos hoy. Escríbele directamente por WhatsApp.', 429)
  const itemsIn = Array.isArray(body.items) ? body.items : []
  if (!itemsIn.length || itemsIn.length > 20) throw new TrialError('INVALID_ORDER', 'Agrega al menos un producto')
  const lines = itemsIn.map((raw) => {
    const item = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
    const product = content.products.find((candidate) => candidate.id === item.productId)
    const quantity = Number(item.quantity)
    if (!product || product.price === null) throw new TrialError('INVALID_ORDER', 'Uno de los productos ya no está disponible')
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw new TrialError('INVALID_ORDER', 'Cantidad no válida')
    return { productId: product.id, name: product.name, price: product.price, quantity, subtotal: product.price * quantity }
  })
  const total = lines.reduce((sum, line) => sum + line.subtotal, 0)
  const customerName = clean(body.customerName, 80) || null
  const note = clean(body.note, 300) || null
  let code = orderCode()
  for (let attempt = 0; attempt < 5; attempt++) {
    const inserted = await db.prepare(`INSERT INTO trial_orders (trial_id, code, items_json, total, customer_name, note) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(code) DO NOTHING`)
      .bind(row.id, code, JSON.stringify(lines), total, customerName, note).run()
    if (Number(inserted.meta.changes || 0) > 0) break
    code = orderCode()
  }
  const message = [
    `Hola, quiero hacer este pedido en ${row.business_name}:`,
    '',
    ...lines.map((line) => `• ${line.quantity} × ${line.name}: ${money(line.subtotal)}`),
    '',
    `Total: ${money(total)}`,
    `Pedido: ${code}`,
    ...(customerName ? [`Nombre: ${customerName}`] : []),
    ...(note ? [`Nota: ${note}`] : []),
    '',
    'Pedido hecho en una tienda temporal creada con Tienda IA Express. El pago y la entrega se acuerdan con el vendedor.',
  ].join('\n')
  return { code, total, items: lines, whatsappUrl: `https://wa.me/${content.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(message)}` }
}

/** Owner: orders received by the temporary store. */
export async function listTrialOrders(db: D1Database, id: string, token: string | undefined) {
  const row = await authorize(db, id, token, false)
  const { results } = await db.prepare('SELECT code, items_json, total, customer_name, note, created_at FROM trial_orders WHERE trial_id = ? ORDER BY created_at DESC, id DESC LIMIT 100').bind(row.id)
    .all<{ code: string; items_json: string; total: number; customer_name: string | null; note: string | null; created_at: string }>()
  return { items: (results || []).map((order) => ({ code: order.code, items: JSON.parse(order.items_json), total: order.total, customerName: order.customer_name, note: order.note, createdAt: iso(order.created_at) })) }
}

export const trialInternals = { loadRow, parseContent, phase, templateOf }
