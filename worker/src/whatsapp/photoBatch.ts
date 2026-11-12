/**
 * Lotes de fotos por WhatsApp (proveedor WAHA). El comerciante reenvía 1, 20 o 100 fotos; el asistente:
 *   1. las recibe en silencio, valida, descarta repetidas y las guarda temporalmente en R2;
 *   2. cuando dejan de llegar, avisa UNA vez y las agrupa por producto con IA (varias fotos de un mismo
 *      producto = un grupo; nunca asume que 100 fotos son 100 productos);
 *   3. presenta un resumen y pide confirmación;
 *   4. abre las fichas una por una con el MISMO borrador del motor (precio, tallas, cantidades,
 *      vista previa) y solo publica lo que el comerciante confirma.
 * No inventa precios, marcas, referencias ni cantidades, y no modifica productos existentes.
 */
import type { Env } from '../index'
import { callGeminiJson, UNTRUSTED_CONTENT_RULE, type GeminiPart } from '../ai/geminiClient'
import { checkAiBudget, recordAiUsage } from '../ai/usage'
import { roleAllows } from '../tenancy/access'
import { slugify } from '../tenancy/stores'
import { readSession, say, type AssistantContext } from '../services/assistant/context'
import { bytesToBase64 } from '../services/assistant/telegramApi'
import { getPendingAttach } from '../services/assistant/media'
import { cancelProductDraft, getPendingProductDraft, handleProductDraftCallback, promptProductDraft } from '../services/assistant/productDraft'
import type { PendingOperation } from '../services/assistant/operations'
import { parseStockLines } from '../services/assistant/commerce/parse'
import { parseMoney } from '../services/assistant/commerce/language'
import { escapeHtml } from '../services/assistant/tools'
import { inspectRasterImage } from '../services/telegramProductImages'
import { createTelegramProductDraft, type TelegramProductDraft } from '../validation/telegramProductDraft'
import { WHATSAPP_IMAGE_LIMIT } from './api'
import type { NormalizedInbound } from './inbound'
import { downloadWahaMedia, wahaEnabled } from './waha'
import { deliver, type Defer, type Outbox } from './processor'

type Bindings = Env['Bindings']

export type BatchGroup = {
  name: string
  category: string
  colors: string[]
  brand: string
  description: string
  /** Ids de whatsapp_photo_items, en el orden en que llegaron. */
  items: number[]
  similar?: { sku: string; name: string } | null
}

type BatchRow = {
  id: string; store_id: number; identity_id: number; chat_id: string; status: string
  photo_count: number; duplicate_count: number; rejected_count: number; analyzed_count: number
  groups_json: string | null; current_group: number | null; published_count: number; skipped_count: number
  last_photo_at: number; lock_until: number | null; error_code: string | null; receiving_notice_sent: number
}

type ItemRow = { id: number; temp_key: string | null; content_type: string | null; byte_length: number | null; caption: string | null; album_id: string | null; group_index: number | null; status: string; position: number }

const OPEN_STATUSES = `('collecting', 'grouping', 'grouped', 'reviewing')`
const MAX_PHOTOS_PER_PRODUCT = 10
/** Fotos por llamada de IA y tope de bytes por llamada (Gemini admite ~20 MB en línea). */
const AI_CHUNK_PHOTOS = 8
const AI_CHUNK_BYTES = 9 * 1024 * 1024
/** Tiempo de trabajo por paso: cabe en los 30 s de waitUntil. En la cola (WHATSAPP_JOBS) el paso puede durar minutos. */
const STEP_BUDGET_MS = 20_000
const QUEUE_STEP_BUDGET_MS = 8 * 60_000
/** Una llamada de agrupación no empieza si quedan menos de estos milisegundos (Gemini tarda 5-20 s). */
const AI_CALL_RESERVE_MS = 15_000
/** Avisos ya enviados (bits de receiving_notice_sent): recibo, lote lleno y resumen entregado. */
const NOTICE_RECEIPT = 1
const NOTICE_FULL = 2
const NOTICE_SUMMARY = 4
const LOCK_SECONDS = 90
const STALE_OPEN_SECONDS = 48 * 60 * 60

const YES = /^(?:s[ií]+|dale|ok(?:ay)?|listo|claro|de una|h[aá]gale|prepara(?:las|r)?(?: (?:las )?fichas)?|empecemos|empezar|comenzar)[.!]*$/i
const CANCEL_BATCH = /^(?:cancelar|cancela|anular|olv[ií]dalo|no)(?: (?:el )?lote| todo)?[.!]*$/i
const CONFIRM = /^(?:confirmar|confirmo|confirmado|guardar|gu[aá]rdalo|publicar|publ[ií]calo|s[ií](?:,? (?:guardar|publicar))?)[.!]*$/i
const SKIP = /^(?:omitir|saltar|s[aá]ltalo|siguiente|pasa(?:r)? al siguiente)[.!]*$/i

export function photoBatchEnabled(env: Partial<Bindings>): boolean {
  return wahaEnabled(env) && String(env.WAHA_PHOTO_BATCH_ENABLED || '').toLowerCase() === 'true'
}

const batchMax = (env: Partial<Bindings>) => Math.min(200, Math.max(1, Number(env.WAHA_PHOTO_BATCH_MAX) || 100))
const quietSeconds = (env: Partial<Bindings>) => {
  const value = Number(env.WAHA_PHOTO_QUIET_SECONDS)
  return Number.isFinite(value) && value >= 0 ? Math.min(120, value) : 12
}
const now = () => Math.floor(Date.now() / 1000)

async function hashBytes(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function openBatch(db: D1Database, chatId: number): Promise<BatchRow | null> {
  return db.prepare(`SELECT * FROM whatsapp_photo_batches WHERE chat_id = ? AND status IN ${OPEN_STATUSES} LIMIT 1`).bind(String(chatId)).first<BatchRow>()
}

function groupsOf(batch: Pick<BatchRow, 'groups_json'>): BatchGroup[] {
  try { return JSON.parse(batch.groups_json || '[]') as BatchGroup[] } catch { return [] }
}

// ───────────────────────── Recepción de fotos ─────────────────────────

/** ¿Esta foto va al lote? No cuando el motor la espera para otra cosa (borrador, fotos de un producto, banner, logo, guía). */
export async function shouldBatchPhoto(ctx: AssistantContext, inbound: NormalizedInbound): Promise<boolean> {
  if (inbound.provider !== 'waha' || !photoBatchEnabled(ctx.env) || !roleAllows(ctx.role, 'admin')) return false
  const batch = await openBatch(ctx.db, ctx.chatId)
  if (batch?.status === 'reviewing') return false
  if (await getPendingProductDraft(ctx)) return false
  if (await getPendingAttach(ctx)) return false
  const session = await readSession(ctx.db, ctx.telegramUserId)
  if (session.state.awaiting === 'banner_photo' || session.state.awaiting === 'logo_photo' || session.state.awaiting === 'shipping_guide' || session.state.guide) return false
  // A caption that asks for something else (banner, logo, a shipping guide, photos for an existing product) goes to the engine.
  if (inbound.caption && /\b(banner|portada|logo|logotipo|gu[ií]a|agr[eé]ga(?:la|las|r)? (?:esta|estas)? ?fotos? a)\b/i.test(inbound.caption)) return false
  return true
}

/** Guarda una foto en el lote abierto (o abre uno). Nunca pregunta nada por foto: el resumen llega cuando dejan de llegar. */
export async function receiveBatchPhoto(ctx: AssistantContext, outbox: Outbox, inbound: NormalizedInbound, defer?: Defer): Promise<string> {
  const { db, env } = ctx
  const media = inbound.media!
  let batch = await openBatch(db, ctx.chatId)
  if (!batch) {
    const id = crypto.randomUUID()
    await db.prepare(`INSERT OR IGNORE INTO whatsapp_photo_batches (id, store_id, identity_id, chat_id) VALUES (?, ?, ?, ?)`)
      .bind(id, ctx.store.id, outbox.identityId, String(ctx.chatId)).run()
    batch = await openBatch(db, ctx.chatId)
    if (!batch) throw new Error('PHOTO_BATCH_OPEN_FAILED')
  }
  if (batch.store_id !== ctx.store.id) {
    await say(ctx, 'Tienes un lote de fotos abierto en otra tienda. Termínalo o escribe <b>cancelar lote</b> antes de enviar fotos para esta.')
    return 'BATCH_OTHER_STORE'
  }
  // New photos after the summary reopen the batch: only the new ones are analysed.
  // The receipt notice and the summary are due again (they announce the new total).
  if (batch.status === 'grouped') {
    await db.prepare(`UPDATE whatsapp_photo_batches SET status = 'collecting', receiving_notice_sent = receiving_notice_sent & ~${NOTICE_RECEIPT | NOTICE_SUMMARY}, updated_at = unixepoch() WHERE id = ? AND status = 'grouped'`).bind(batch.id).run()
  }

  const position = Number((await db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS next FROM whatsapp_photo_items WHERE batch_id = ?').bind(batch.id).first<{ next: number }>())?.next || 1)
  const caption = inbound.caption ? inbound.caption.slice(0, 500) : null
  const record = async (status: string, hash: string, error: string | null, extra: Partial<Record<'temp_key' | 'content_type' | 'extension' | 'byte_length' | 'width' | 'height', string | number>> = {}) => {
    const inserted = await db.prepare(
      `INSERT OR IGNORE INTO whatsapp_photo_items (batch_id, store_id, message_id, album_id, content_hash, temp_key, content_type, extension, byte_length, width, height, caption, forwarded, position, status, error_code)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(batch!.id, ctx.store.id, inbound.messageId, inbound.albumId ?? null, hash, extra.temp_key ?? null, extra.content_type ?? null, extra.extension ?? null,
      extra.byte_length ?? null, extra.width ?? null, extra.height ?? null, caption, inbound.forwarded ? 1 : 0, position, status, error).run()
    const column = status === 'stored' ? 'photo_count' : status === 'duplicate' ? 'duplicate_count' : 'rejected_count'
    if (inserted.meta.changes) await db.prepare(`UPDATE whatsapp_photo_batches SET ${column} = ${column} + 1, last_photo_at = unixepoch(), updated_at = unixepoch() WHERE id = ?`).bind(batch!.id).run()
    return Boolean(inserted.meta.changes)
  }

  const stored = Number((await db.prepare(`SELECT COUNT(*) AS n FROM whatsapp_photo_items WHERE batch_id = ? AND status = 'stored'`).bind(batch.id).first<{ n: number }>())?.n || 0)
  if (stored >= batchMax(env)) {
    await record('rejected', `full:${inbound.messageId}`, 'BATCH_FULL')
    const notice = await db.prepare(`UPDATE whatsapp_photo_batches SET receiving_notice_sent = receiving_notice_sent | ${NOTICE_FULL} WHERE id = ? AND (receiving_notice_sent & ${NOTICE_FULL}) = 0 RETURNING id`).bind(batch.id).first()
    if (notice) await say(ctx, `Este lote ya tiene ${batchMax(env)} fotos, el máximo por lote. Terminemos estas primero; las demás envíalas después.`)
    return 'BATCH_FULL'
  }
  // Duplicates are recognised by the file hash WhatsApp reports, before downloading anything.
  if (media.sha256) {
    const seen = await db.prepare(`SELECT id FROM whatsapp_photo_items WHERE batch_id = ? AND content_hash = ? AND status <> 'duplicate'`).bind(batch.id, media.sha256).first()
    if (seen) { await record('duplicate', `dup:${inbound.messageId}`, null); await scheduleStep(env, db, batch.id, outbox, defer); return 'DUPLICATE' }
  }
  if (!/^image\/(jpeg|png|webp)$/.test(media.mimeType) || (media.size && media.size > WHATSAPP_IMAGE_LIMIT)) {
    await record('rejected', `bad:${inbound.messageId}`, media.size && media.size > WHATSAPP_IMAGE_LIMIT ? 'TOO_LARGE' : 'FORMAT')
    await scheduleStep(env, db, batch.id, outbox, defer)
    return 'REJECTED'
  }
  if (!env.ASSETS) throw new Error('R2_NOT_CONFIGURED')
  let bytes: Uint8Array
  let image: ReturnType<typeof inspectRasterImage>
  try {
    bytes = (await downloadWahaMedia(env, media.ref, WHATSAPP_IMAGE_LIMIT)).bytes
    image = inspectRasterImage(bytes)
  } catch (error) {
    const code = (error instanceof Error ? error.message : 'DOWNLOAD_FAILED').replace(/^TELEGRAM_|^WAHA_/, '').slice(0, 40)
    await record('rejected', `bad:${inbound.messageId}`, code)
    await scheduleStep(env, db, batch.id, outbox, defer)
    return 'REJECTED'
  }
  const hash = media.sha256 || await hashBytes(bytes)
  if (!media.sha256) {
    const seen = await db.prepare(`SELECT id FROM whatsapp_photo_items WHERE batch_id = ? AND content_hash = ? AND status <> 'duplicate'`).bind(batch.id, hash).first()
    if (seen) { await record('duplicate', `dup:${inbound.messageId}`, null); await scheduleStep(env, db, batch.id, outbox, defer); return 'DUPLICATE' }
  }
  const tempKey = `whatsapp-batches/${batch.id}/${crypto.randomUUID()}.${image.extension}`
  await env.ASSETS.put(tempKey, bytes, {
    httpMetadata: { contentType: image.contentType, cacheControl: 'private, no-store' },
    customMetadata: { batchId: batch.id, storeId: String(ctx.store.id), purpose: 'whatsapp-photo-batch' },
  })
  const added = await record('stored', hash, null, { temp_key: tempKey, content_type: image.contentType, extension: image.extension, byte_length: bytes.byteLength, width: image.width, height: image.height })
  if (!added) {
    // The same picture arrived twice at the same moment: the unique index kept one; this one is a duplicate.
    await env.ASSETS.delete(tempKey)
    await record('duplicate', `dup:${inbound.messageId}`, null)
    await scheduleStep(env, db, batch.id, outbox, defer)
    return 'DUPLICATE'
  }
  await scheduleStep(env, db, batch.id, outbox, defer)
  return 'PHOTO_STORED'
}

/**
 * Programa un paso: espera a que dejen de llegar fotos y entonces agrupa. Mientras llegan, analiza por tandas
 * completas. Con la cola WHATSAPP_JOBS el paso final corre en la cola (sin el límite de 30 s de waitUntil);
 * sin ella, en el mismo waitUntil con un plazo, y lo que no alcance lo retoma el siguiente mensaje o la tarea programada.
 */
async function scheduleStep(env: Bindings, db: D1Database, batchId: string, outbox: Outbox, defer?: Defer): Promise<void> {
  const wait = quietSeconds(env)
  const deadline = Date.now() + 27_000
  const work = (async () => {
    // Full chunks are analysed while photos keep arriving, so 100 photos are mostly analysed by the time the last one lands.
    await runBatchStep(env, db, batchId, { outbox, onlyFullChunks: true, deadline })
    if (env.ENVIRONMENT === 'test') return
    if (env.WHATSAPP_JOBS) {
      await env.WHATSAPP_JOBS.send({ type: 'photo_batch_step', batchId }, { delaySeconds: wait + 1 })
      return
    }
    await sleep((wait + 1) * 1000)
    await runBatchStep(env, db, batchId, { outbox, deadline })
  })()
  if (env.ENVIRONMENT === 'test' || !defer) await work.catch((error) => console.error('Photo batch step failed:', error instanceof Error ? error.message : 'unknown'))
  else defer(work)
}

// ───────────────────────── Agrupación con IA ─────────────────────────

async function outboxFor(env: Bindings, db: D1Database, batch: BatchRow): Promise<Outbox | null> {
  const identity = await db.prepare(`SELECT id, business_user_id AS businessUserId, phone FROM whatsapp_identities WHERE id = ? AND status = 'active'`)
    .bind(batch.identity_id).first<{ id: number; businessUserId: string | null; phone: string | null }>()
  if (!identity) return null
  const key = identity.businessUserId || identity.phone || ''
  return {
    env, db, sender: { businessUserId: identity.businessUserId, phone: identity.phone, key, name: '' },
    inboundId: 0, inboundWaId: '', identityId: identity.id, storeId: batch.store_id, lastInboundAt: now(), sent: 0, provider: 'waha', replyLimit: 6,
  }
}

const groupingSchema = {
  type: 'object',
  properties: {
    photos: { type: 'array', items: { type: 'object', properties: { photo: { type: 'integer' }, group: { type: 'integer' }, isProduct: { type: 'boolean' } }, required: ['photo', 'group', 'isProduct'] } },
    groups: { type: 'array', items: { type: 'object', properties: {
      group: { type: 'integer' }, continuesPrevious: { type: 'boolean' }, name: { type: 'string' }, category: { type: 'string' },
      colors: { type: 'array', items: { type: 'string' } }, visibleBrand: { type: 'string' }, description: { type: 'string' },
    }, required: ['group', 'continuesPrevious', 'name', 'category', 'colors', 'visibleBrand', 'description'] } },
  },
  required: ['photos', 'groups'],
}

type GroupingReply = {
  photos: Array<{ photo: number; group: number; isProduct: boolean }>
  groups: Array<{ group: number; continuesPrevious: boolean; name: string; category: string; colors: string[]; visibleBrand: string; description: string }>
}

const cleanText = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max) : '')

/** Una tanda de fotos → grupos por producto. Si la IA no está disponible, cada álbum (o foto suelta) es un grupo. */
async function groupChunk(env: Bindings, db: D1Database, batch: BatchRow, items: ItemRow[], previous: BatchGroup | null): Promise<{ assignments: Map<number, number | 'not_product'>; groups: BatchGroup[]; continuesPrevious: Set<number> }> {
  const fallback = () => {
    const groups: BatchGroup[] = []
    const byAlbum = new Map<string, number>()
    const assignments = new Map<number, number | 'not_product'>()
    for (const item of items) {
      const album = item.album_id ? byAlbum.get(item.album_id) : undefined
      if (album !== undefined) { groups[album]!.items.push(item.id); assignments.set(item.id, album); continue }
      groups.push({ name: '', category: '', colors: [], brand: '', description: '', items: [item.id] })
      if (item.album_id) byAlbum.set(item.album_id, groups.length - 1)
      assignments.set(item.id, groups.length - 1)
    }
    return { assignments, groups, continuesPrevious: new Set<number>() }
  }
  if (!env.GEMINI_API_KEY || !env.ASSETS) return fallback()
  const budget = await checkAiBudget(db, env, batch.store_id)
  if (!budget.allowed) {
    await recordAiUsage(db, env, { storeId: batch.store_id, channel: 'whatsapp_waha', feature: 'agrupar_fotos', status: 'blocked' })
    return fallback()
  }
  const parts: GeminiPart[] = []
  const categories = (await db.prepare('SELECT name FROM categories WHERE store_id = ? AND is_active = 1 ORDER BY sort_order, name LIMIT 40').bind(batch.store_id).all<{ name: string }>()).results?.map((row) => row.name) || []
  parts.push({ text: [
    `Agrupa estas ${items.length} fotografías por producto. Están numeradas en orden de llegada.`,
    previous ? `Producto anterior (justo antes de estas fotos): "${previous.name}" (${previous.colors.join(', ') || 'sin color'}). Si las primeras fotos son de ese mismo producto, marca su grupo con continuesPrevious=true.` : 'No hay producto anterior.',
    `Categorías existentes de la tienda: ${categories.join(', ') || 'ninguna'}.`,
  ].join('\n') })
  for (const [index, item] of items.entries()) {
    const object = item.temp_key ? await env.ASSETS.get(item.temp_key) : null
    if (!object) continue
    parts.push({ text: `Foto ${index + 1}${item.album_id ? ` (álbum ${item.album_id.slice(-4)})` : ''}${item.caption ? `. Texto del comerciante: "${item.caption.slice(0, 200)}"` : ''}:` })
    parts.push({ inlineData: { mimeType: item.content_type || 'image/jpeg', data: bytesToBase64(new Uint8Array(await object.arrayBuffer())) } })
  }
  try {
    const result = await callGeminiJson(env, fetch, {
      system: [
        'Organizas fotografías que un comerciante reenvió para crear fichas de catálogo en español.',
        'Un grupo = un producto vendible. Varias fotos del mismo artículo (ángulos, detalles, empaque, la misma referencia en otros colores) van en el MISMO grupo.',
        'Artículos distintos (otro modelo, otro tipo de producto) van en grupos distintos. Nunca supongas que cada foto es un producto distinto.',
        'Las fotos de un mismo álbum suelen ser del mismo producto, pero sepáralas si claramente muestran artículos distintos.',
        'isProduct=false para capturas de chats, comprobantes, personas sin producto o imágenes que no muestran algo vendible.',
        'name: nombre comercial corto y genérico (máximo 8 palabras). description: 1 o 2 frases solo con lo visible.',
        'Nunca propongas precio, tallas, cantidades, referencias ni que es original. visibleBrand solo si el logotipo o la marca se leen claramente; si no, vacío.',
        'category: preferiblemente una de las categorías existentes; si ninguna aplica, un nombre corto.',
        'Numera los grupos desde 1 en el orden en que aparece su primera foto.',
        UNTRUSTED_CONTENT_RULE,
      ],
      parts,
      schema: groupingSchema,
      maxOutputTokens: 4096,
      temperature: 0.1,
    })
    await recordAiUsage(db, env, { storeId: batch.store_id, channel: 'whatsapp_waha', feature: 'agrupar_fotos', model: result.model, usage: result.usage, status: 'ok' })
    const reply = result.data as GroupingReply
    const localGroups = new Map<number, number>()
    const groups: BatchGroup[] = []
    const continuesPrevious = new Set<number>()
    for (const group of Array.isArray(reply?.groups) ? reply.groups : []) {
      const number = Number(group?.group)
      if (!Number.isInteger(number) || localGroups.has(number)) continue
      localGroups.set(number, groups.length)
      if (group.continuesPrevious === true && previous) continuesPrevious.add(groups.length)
      groups.push({
        name: cleanText(group.name, 120), category: cleanText(group.category, 60), brand: cleanText(group.visibleBrand, 60),
        colors: (Array.isArray(group.colors) ? group.colors : []).map((color) => cleanText(color, 30)).filter(Boolean).slice(0, 6),
        description: cleanText(group.description, 600), items: [],
      })
    }
    const assignments = new Map<number, number | 'not_product'>()
    for (const photo of Array.isArray(reply?.photos) ? reply.photos : []) {
      const item = items[Number(photo?.photo) - 1]
      if (!item || assignments.has(item.id)) continue
      if (photo.isProduct === false) { assignments.set(item.id, 'not_product'); continue }
      const target = localGroups.get(Number(photo.group))
      if (target === undefined) continue
      assignments.set(item.id, target)
      groups[target]!.items.push(item.id)
    }
    // Photos the model skipped are never lost: each becomes its own group for the merchant to review.
    for (const item of items) {
      if (assignments.has(item.id)) continue
      groups.push({ name: '', category: '', colors: [], brand: '', description: '', items: [item.id] })
      assignments.set(item.id, groups.length - 1)
    }
    return { assignments, groups: groups.filter((group) => group.items.length), continuesPrevious }
  } catch (error) {
    await recordAiUsage(db, env, { storeId: batch.store_id, channel: 'whatsapp_waha', feature: 'agrupar_fotos', status: 'error' }).catch(() => undefined)
    console.error('Photo batch grouping failed:', error instanceof Error ? error.message.slice(0, 80) : 'unknown')
    return fallback()
  }
}

/** Nombre parecido en el catálogo (aviso, nunca cambia nada). */
async function similarProduct(db: D1Database, storeId: number, name: string): Promise<{ sku: string; name: string } | null> {
  const words = slugify(name).split('-').filter((word) => word.length > 3)
  if (words.length < 2) return null
  const rows = await db.prepare(`SELECT sku, name FROM products WHERE store_id = ? AND is_archived = 0 AND (${words.map(() => `lower(name) LIKE ?`).join(' OR ')}) LIMIT 30`)
    .bind(storeId, ...words.map((word) => `%${word}%`)).all<{ sku: string; name: string }>()
  let best: { sku: string; name: string; score: number } | null = null
  for (const row of rows.results || []) {
    const theirs = new Set(slugify(row.name).split('-'))
    const score = words.filter((word) => theirs.has(word)).length / words.length
    if (score >= 0.6 && (!best || score > best.score)) best = { ...row, score }
  }
  return best ? { sku: best.sku, name: best.name } : null
}

/**
 * Un paso de trabajo sobre el lote (nunca dos a la vez: candado con vencimiento). Analiza tandas pendientes
 * y, cuando ya no llegan fotos y todo está analizado, envía el resumen. Seguro de repetir.
 */
export async function runBatchStep(env: Bindings, db: D1Database, batchId: string, opts: { outbox?: Outbox; onlyFullChunks?: boolean; force?: boolean; deadline?: number } = {}): Promise<void> {
  const quiet = quietSeconds(env)
  const claimed = await db.prepare(
    `UPDATE whatsapp_photo_batches SET lock_until = unixepoch() + ${LOCK_SECONDS}, updated_at = unixepoch()
     WHERE id = ? AND status IN ('collecting', 'grouping') AND (lock_until IS NULL OR lock_until < unixepoch()) RETURNING *`,
  ).bind(batchId).first<BatchRow>()
  if (!claimed) return
  let batch = claimed
  const deadline = opts.deadline ?? Date.now() + STEP_BUDGET_MS
  let outOfTime = false
  try {
    const outbox = opts.outbox ?? await outboxFor(env, db, batch)
    if (!outbox) { await db.prepare(`UPDATE whatsapp_photo_batches SET status = 'cancelled', error_code = 'UNLINKED', completed_at = unixepoch() WHERE id = ?`).bind(batchId).run(); await purgeBatchAssets(env, batchId); return }
    const quietReached = opts.force || now() - batch.last_photo_at >= quiet
    while (true) {
      const pending = (await db.prepare(`SELECT id, temp_key, content_type, byte_length, caption, album_id, group_index, status, position FROM whatsapp_photo_items WHERE batch_id = ? AND status = 'stored' AND group_index IS NULL ORDER BY position LIMIT ?`)
        .bind(batchId, AI_CHUNK_PHOTOS).all<ItemRow>()).results || []
      if (!pending.length) break
      if (opts.onlyFullChunks && pending.length < AI_CHUNK_PHOTOS) break
      if (!quietReached && !opts.onlyFullChunks) break
      if (batch.status === 'collecting' && quietReached && !(batch.receiving_notice_sent & NOTICE_RECEIPT)) {
        // One notice for the whole batch, never one per photo.
        await db.prepare(`UPDATE whatsapp_photo_batches SET receiving_notice_sent = receiving_notice_sent | ${NOTICE_RECEIPT} WHERE id = ?`).bind(batchId).run()
        batch.receiving_notice_sent |= NOTICE_RECEIPT
        const total = batch.photo_count
        await deliver(outbox, `📸 He recibido ${total === 1 ? '1 fotografía' : `${total} fotografías`}. Estoy revisando si corresponden a uno o varios productos…`)
      }
      // Never start an AI call that could be cut off by the platform's time limit: the next trigger resumes it.
      if (deadline - Date.now() < AI_CALL_RESERVE_MS) { outOfTime = true; break }
      // Respect the per-call byte budget.
      let bytes = 0
      const chunk = pending.filter((item) => (bytes += Number(item.byte_length || 0)) <= AI_CHUNK_BYTES || item === pending[0])
      const groups = groupsOf(batch)
      const result = await groupChunk(env, db, batch, chunk, groups.at(-1) ?? null)
      const merged = [...groups]
      const indexOf = new Map<number, number>()
      for (const [local, group] of result.groups.entries()) {
        if (result.continuesPrevious.has(local) && merged.length) {
          const last = merged.at(-1)!
          last.items.push(...group.items)
          for (const color of group.colors) if (!last.colors.includes(color)) last.colors.push(color)
          indexOf.set(local, merged.length - 1)
        } else {
          group.similar = group.name ? await similarProduct(db, batch.store_id, group.name) : null
          merged.push(group)
          indexOf.set(local, merged.length - 1)
        }
      }
      const statements = chunk.map((item) => {
        const assigned = result.assignments.get(item.id)
        return assigned === 'not_product'
          ? db.prepare(`UPDATE whatsapp_photo_items SET status = 'not_product', group_index = -1 WHERE id = ?`).bind(item.id)
          : db.prepare(`UPDATE whatsapp_photo_items SET group_index = ? WHERE id = ?`).bind(indexOf.get(Number(assigned)) ?? -1, item.id)
      })
      await db.batch([
        ...statements,
        db.prepare(`UPDATE whatsapp_photo_batches SET groups_json = ?, analyzed_count = analyzed_count + ?, status = 'grouping', lock_until = unixepoch() + ${LOCK_SECONDS}, updated_at = unixepoch() WHERE id = ?`)
          .bind(JSON.stringify(merged), chunk.length, batchId),
      ])
      batch = (await db.prepare('SELECT * FROM whatsapp_photo_batches WHERE id = ?').bind(batchId).first<BatchRow>())!
    }
    const left = Number((await db.prepare(`SELECT COUNT(*) AS n FROM whatsapp_photo_items WHERE batch_id = ? AND status = 'stored' AND group_index IS NULL`).bind(batchId).first<{ n: number }>())?.n || 0)
    if (left || !quietReached || opts.onlyFullChunks) {
      // More work later (next photo, the quiet timer or the scheduled task). Long batches report progress once per step.
      if (left && quietReached && batch.analyzed_count) await deliver(outbox, `⏳ Voy en ${batch.analyzed_count} de ${batch.analyzed_count + left} fotos…`)
      else if (left && quietReached && outOfTime) await deliver(outbox, 'Sigo revisando tus fotos. Si en un minuto no te llega el resumen, escríbeme cualquier cosa y lo termino.')
      return
    }
    // Everything analysed and no new photos (checked again now, photos may have landed meanwhile): the summary, sent exactly once.
    const done = await db.prepare(
      `UPDATE whatsapp_photo_batches SET status = 'grouped', updated_at = unixepoch() WHERE id = ? AND status IN ('collecting', 'grouping') AND (? = 1 OR last_photo_at <= unixepoch() - ?) RETURNING *`,
    ).bind(batchId, opts.force ? 1 : 0, quiet).first<BatchRow>()
    if (done) await sendSummary(db, outbox, done)
  } catch (error) {
    const code = (error instanceof Error ? error.message : 'unknown').slice(0, 60)
    await db.prepare(`UPDATE whatsapp_photo_batches SET error_code = ? WHERE id = ?`).bind(code, batchId).run()
    throw error
  } finally {
    await db.prepare(`UPDATE whatsapp_photo_batches SET lock_until = NULL WHERE id = ?`).bind(batchId).run()
  }
}

function summaryText(batch: BatchRow, groups: BatchGroup[]): string {
  const lines = groups.map((group, index) => {
    const label = group.name || `Producto sin nombre`
    const extra = [group.colors.length ? group.colors.join(', ') : '', `${group.items.length} ${group.items.length === 1 ? 'foto' : 'fotos'}`].filter(Boolean).join(' · ')
    const similar = group.similar ? `\n   ⚠️ Parecido a tu producto «${escapeHtml(group.similar.name)}» (${escapeHtml(group.similar.sku)}). Si es reposición, dímelo después; no lo cambio sin confirmar.` : ''
    return `${index + 1}. <b>${escapeHtml(label)}</b> (${escapeHtml(extra)})${similar}`
  })
  const notes = [
    batch.duplicate_count ? `• ${batch.duplicate_count} ${batch.duplicate_count === 1 ? 'foto repetida no se tuvo' : 'fotos repetidas no se tuvieron'} en cuenta.` : '',
    batch.rejected_count ? `• ${batch.rejected_count} ${batch.rejected_count === 1 ? 'archivo no se pudo usar' : 'archivos no se pudieron usar'} (formato, tamaño o descarga).` : '',
  ].filter(Boolean)
  return `He identificado <b>${groups.length} ${groups.length === 1 ? 'posible producto' : 'posibles productos'}</b>:\n\n${lines.join('\n')}` +
    (notes.length ? `\n\n${notes.join('\n')}` : '') +
    `\n\n¿Quieres que prepare sus fichas? Responde <b>sí</b> para empezar.\nSi algo no está bien: <b>une 1 y 2</b> (son el mismo producto), <b>quita 3</b> (no lo publiques) o <b>cancelar lote</b>.`
}

async function sendSummary(db: D1Database, outbox: Outbox, batch: BatchRow): Promise<void> {
  const groups = groupsOf(batch)
  const notProduct = Number((await db.prepare(`SELECT COUNT(*) AS n FROM whatsapp_photo_items WHERE batch_id = ? AND status = 'not_product'`).bind(batch.id).first<{ n: number }>())?.n || 0)
  if (!groups.length) {
    await db.prepare(`UPDATE whatsapp_photo_batches SET status = 'completed', completed_at = unixepoch() WHERE id = ?`).bind(batch.id).run()
    await purgeBatchAssets(outbox.env, batch.id)
    await deliver(outbox, notProduct
      ? 'Revisé las fotos y ninguna parece mostrar un producto para vender (por ejemplo, capturas o comprobantes). No preparé fichas. Si me equivoqué, envíalas de nuevo con un texto como «es un producto».'
      : 'No pude usar ninguna de las fotos de este lote. Envíalas otra vez como fotos (JPG o PNG).')
    return
  }
  // Photos analysed while they were arriving: the receipt notice was never sent, so it leads the summary.
  const receipt = batch.receiving_notice_sent & NOTICE_RECEIPT ? '' : `📸 He recibido ${batch.photo_count === 1 ? '1 fotografía' : `${batch.photo_count} fotografías`} y ya las revisé.\n\n`
  const text = receipt + summaryText(batch, groups) + (notProduct ? `\n\n(${notProduct} ${notProduct === 1 ? 'imagen no parece' : 'imágenes no parecen'} un producto y ${notProduct === 1 ? 'la dejé' : 'las dejé'} por fuera.)` : '')
  await deliver(outbox, text, { inline_keyboard: [[{ text: '✅ Sí, preparar fichas', callback_data: `wb:start:${batch.id}` }], [{ text: '✖ Cancelar lote', callback_data: `wb:cancel:${batch.id}` }]] })
  // Marked only after it was really sent: a summary lost to a timeout is sent again on the next message.
  await db.prepare(`UPDATE whatsapp_photo_batches SET receiving_notice_sent = receiving_notice_sent | ${NOTICE_SUMMARY} WHERE id = ?`).bind(batch.id).run()
}

/** Cola WHATSAPP_JOBS (opcional): pasos de lotes sin el límite de 30 s de waitUntil. */
export async function consumeWhatsAppJobs(batch: MessageBatch<{ type?: string; batchId?: string; force?: boolean }>, env: Bindings): Promise<void> {
  for (const message of batch.messages) {
    const id = message.body?.batchId
    if (message.body?.type !== 'photo_batch_step' || !id || !/^[0-9a-f-]{36}$/.test(id)) { message.ack(); continue }
    try {
      await runBatchStep(env, env.DB, id, { deadline: Date.now() + QUEUE_STEP_BUDGET_MS, force: message.body.force === true })
      message.ack()
    } catch (error) {
      console.error('Photo batch job failed:', error instanceof Error ? error.message.slice(0, 80) : 'unknown')
      message.retry({ delaySeconds: 15 })
    }
  }
}

// ───────────────────────── Conversación del lote ─────────────────────────

/**
 * Texto o botón mientras hay un lote abierto. Devuelve true cuando lo resolvió el lote; false para que lo
 * atienda el motor (por ejemplo, las respuestas del borrador en curso).
 */
export async function handleBatchText(ctx: AssistantContext, outbox: Outbox, input: string, defer?: Defer): Promise<boolean> {
  if (outbox.provider !== 'waha' || !photoBatchEnabled(ctx.env)) return false
  let batch = await openBatch(ctx.db, ctx.chatId)
  if (!batch || batch.store_id !== ctx.store.id) return false
  const text = input.trim()
  const button = /^wb:(start|cancel|skip):([0-9a-f-]{36})$/.exec(text)
  if (button && button[2] !== batch.id) { await say(ctx, 'Ese lote ya terminó o se canceló.'); return true }
  const isCancel = button?.[1] === 'cancel' || /^\/?cancelar (?:el )?lote[.!]*$/i.test(text)

  // Recovery: the merchant writes and the batch never got its summary (the background step was cut off).
  if (!isCancel && (batch.status === 'collecting' || batch.status === 'grouping') && now() - batch.last_photo_at >= quietSeconds(ctx.env) && !(batch.lock_until && batch.lock_until > now())) {
    if (ctx.env.WHATSAPP_JOBS) {
      // The queue has no 30-second limit: the summary arrives from there.
      await ctx.env.WHATSAPP_JOBS.send({ type: 'photo_batch_step', batchId: batch.id, force: true })
      await say(ctx, 'Estoy terminando de revisar tus fotos; en unos segundos te envío el resumen.')
      return true
    }
    await runBatchStep(ctx.env, ctx.db, batch.id, { outbox, force: true })
    const after = await openBatch(ctx.db, ctx.chatId)
    if (after?.status === 'grouped') return true
    if (after) batch = after
  } else if (!isCancel && batch.status === 'grouped' && !(batch.receiving_notice_sent & NOTICE_SUMMARY)) {
    await sendSummary(ctx.db, outbox, batch)
    if (!button && !YES.test(text)) return true
  }

  // Plain "cancelar" only cancels the batch when the batch itself asked the question (its summary).
  if (isCancel || (batch.status === 'grouped' && CANCEL_BATCH.test(text))) {
    await cancelBatch(ctx, batch)
    return true
  }
  if (batch.status === 'collecting' || batch.status === 'grouping') {
    // The merchant writes while photos are still being reviewed: finish now instead of waiting for the timer.
    if (/^(?:listo|ya|eso es todo|son todas|termin[eé])[.!]*$/i.test(text)) {
      await say(ctx, 'Perfecto, reviso las fotos que me enviaste…')
      if (ctx.env.WHATSAPP_JOBS) { await ctx.env.WHATSAPP_JOBS.send({ type: 'photo_batch_step', batchId: batch.id, force: true }); return true }
      const work = runBatchStep(ctx.env, ctx.db, batch.id, { outbox, force: true })
      if (ctx.env.ENVIRONMENT === 'test' || !defer) await work; else defer(work)
      return true
    }
    if (button) { await say(ctx, 'Todavía estoy revisando las fotos. Te aviso en cuanto termine.'); return true }
    return false
  }
  if (batch.status === 'grouped') {
    if (button?.[1] === 'start' || YES.test(text)) { await startReview(ctx, batch); return true }
    const merge = /^(?:une|unir|junta|juntar)\s+(?:el\s+)?(\d{1,3})\s+(?:y|con)\s+(?:el\s+)?(\d{1,3})[.!]*$/i.exec(text)
    const drop = /^(?:quita|quitar|elimina|eliminar|saca|sacar|descarta|descartar)\s+(?:el\s+)?(\d{1,3})[.!]*$/i.exec(text)
    if (merge || drop) { await editGroups(ctx, batch, merge ? { merge: [Number(merge[1]), Number(merge[2])] } : { drop: Number(drop![1]) }); return true }
    return false
  }
  // Reviewing: the draft of the current product handles its own answers; here only the batch-level words.
  const active = await getPendingProductDraft(ctx)
  const inBatch = active?.draft.batch?.id === batch.id ? active : null
  if (inBatch) {
    if (button?.[1] === 'skip' || SKIP.test(text) || /^\/?cancel(?:ar|a)?[.!]*$/i.test(text)) {
      await cancelProductDraft(ctx, inBatch.operation.operation_id)
      await say(ctx, /cancel/i.test(text)
        ? 'Listo, omití este producto. No se publicó. (Si quieres dejar todo el lote, escribe <b>cancelar lote</b>.)'
        : 'Listo, omití ese producto. No se publicó.')
      await continuePhotoBatch(ctx, inBatch.draft, 'skipped')
      return true
    }
    if (inBatch.draft.stage === 'ready' && CONFIRM.test(text)) {
      // "Confirmar" written instead of choosing the option: same as the save button.
      await handleProductDraftCallback(ctx, 'publish', inBatch.operation.operation_id)
      return true
    }
    // One answer with price and sizes ("180 mil, tallas 38 al 42, cinco de cada talla") fills both fields.
    if (inBatch.draft.awaiting === 'price' && await fillPriceAndStock(ctx, inBatch, text)) return true
    // "No" to "¿tiene un código?" means "use the suggested one" (the engine would read a bare "no" as cancel).
    if (inBatch.draft.awaiting === 'sku' && inBatch.draft.suggestedSku && /^(?:no|no tengo|ninguno|no tiene|usa(?:r)? (?:el )?(?:sugerido|ese)|ok|dale|s[ií])[.!]*$/i.test(text)) {
      await handleProductDraftCallback(ctx, 'sku', inBatch.operation.operation_id)
      return true
    }
    return false
  }
  if (!active) {
    // Between products (a draft expired): reopen the current one.
    await openGroupDraft(ctx, batch)
    return true
  }
  return false
}

async function editGroups(ctx: AssistantContext, batch: BatchRow, edit: { merge: [number, number] } | { drop: number }): Promise<void> {
  const groups = groupsOf(batch)
  if ('merge' in edit) {
    const [a, b] = edit.merge.map((value) => value - 1).sort((x, y) => x - y) as [number, number]
    if (a === b || !groups[a] || !groups[b]) { await say(ctx, `No encontré esos números. Elige entre 1 y ${groups.length}.`); return }
    groups[a]!.items.push(...groups[b]!.items)
    for (const color of groups[b]!.colors) if (!groups[a]!.colors.includes(color)) groups[a]!.colors.push(color)
    if (groups[a]!.items.length > MAX_PHOTOS_PER_PRODUCT) await say(ctx, `Ese producto queda con ${groups[a]!.items.length} fotos; usaré las primeras ${MAX_PHOTOS_PER_PRODUCT}.`)
    groups.splice(b, 1)
  } else {
    const index = edit.drop - 1
    if (!groups[index]) { await say(ctx, `No encontré ese número. Elige entre 1 y ${groups.length}.`); return }
    groups.splice(index, 1)
  }
  const saved = await ctx.db.prepare(`UPDATE whatsapp_photo_batches SET groups_json = ?, updated_at = unixepoch() WHERE id = ? AND status = 'grouped' AND groups_json = ? RETURNING *`)
    .bind(JSON.stringify(groups), batch.id, batch.groups_json).first<BatchRow>()
  if (!saved) { await say(ctx, 'El lote cambió mientras escribías. Revisa el último resumen.'); return }
  if (!groups.length) { await cancelBatch(ctx, saved, 'Quitaste todos los productos del lote, así que lo cerré. No se publicó nada.'); return }
  await say(ctx, summaryText(saved, groups), { inline_keyboard: [[{ text: '✅ Sí, preparar fichas', callback_data: `wb:start:${batch.id}` }], [{ text: '✖ Cancelar lote', callback_data: `wb:cancel:${batch.id}` }]] })
}

async function startReview(ctx: AssistantContext, batch: BatchRow): Promise<void> {
  if (!roleAllows(ctx.role, 'admin')) { await say(ctx, 'Tu rol en esta tienda no permite publicar productos.'); return }
  const other = await ctx.db.prepare(`SELECT action FROM telegram_operations WHERE chat_id = ? AND status = 'pending' AND expires_at > unixepoch() LIMIT 1`).bind(String(ctx.chatId)).first<{ action: string }>()
  if (other) { await say(ctx, 'Tienes otro cambio esperando confirmación. Confírmalo o cancélalo y luego responde <b>sí</b> para seguir con el lote.'); return }
  const started = await ctx.db.prepare(`UPDATE whatsapp_photo_batches SET status = 'reviewing', current_group = 0, updated_at = unixepoch() WHERE id = ? AND status = 'grouped' RETURNING *`).bind(batch.id).first<BatchRow>()
  if (!started) return
  await openGroupDraft(ctx, started)
}

/** Abre el borrador del producto actual del lote con sus fotos y lo que la IA vio (sin precio ni cantidades). */
async function openGroupDraft(ctx: AssistantContext, batch: BatchRow): Promise<void> {
  const groups = groupsOf(batch)
  const index = Number(batch.current_group || 0)
  const group = groups[index]
  if (!group) { await finishBatch(ctx, batch); return }
  if (!ctx.env.ASSETS) { await say(ctx, 'El almacenamiento de fotos no está disponible en este momento. Intenta de nuevo en unos minutos.'); return }
  const items = (await ctx.db.prepare(`SELECT id, temp_key, content_type, byte_length, caption, album_id, group_index, status, position FROM whatsapp_photo_items WHERE batch_id = ? AND id IN (${group.items.map(() => '?').join(',')}) AND status = 'stored' ORDER BY position`)
    .bind(batch.id, ...group.items).all<ItemRow>()).results || []
  const operationId = crypto.randomUUID()
  const draft = createTelegramProductDraft()
  for (const item of items.slice(0, MAX_PHOTOS_PER_PRODUCT)) {
    const object = item.temp_key ? await ctx.env.ASSETS.get(item.temp_key) : null
    if (!object) continue
    const bytes = new Uint8Array(await object.arrayBuffer())
    let image: ReturnType<typeof inspectRasterImage>
    try { image = inspectRasterImage(bytes) } catch { continue }
    // Same key layout and metadata the engine's publish step verifies.
    const tempKey = `telegram-drafts/${operationId}/${crypto.randomUUID()}.${image.extension}`
    await ctx.env.ASSETS.put(tempKey, bytes, {
      httpMetadata: { contentType: image.contentType, cacheControl: 'private, no-store' },
      customMetadata: { operationId, purpose: 'telegram-product-draft', uploadedAt: new Date().toISOString() },
    })
    draft.images.push({ tempKey, telegramFileId: `batch:${item.id}`, contentType: image.contentType, extension: image.extension, byteLength: bytes.byteLength, width: image.width, height: image.height })
  }
  if (!draft.images.length) {
    await say(ctx, `Las fotos del producto ${index + 1} ya no están disponibles; lo omito.`)
    await advanceGroup(ctx, batch, 'skipped')
    return
  }
  const suggested: string[] = []
  if (group.name) { draft.fields.name = group.name; suggested.push('name') }
  if (group.description && group.description.length >= 3) { draft.fields.description = group.description; suggested.push('description') }
  if (group.category) {
    const match = await ctx.db.prepare('SELECT id, name FROM categories WHERE store_id = ? AND is_active = 1').bind(ctx.store.id).all<{ id: number; name: string }>()
    const found = (match.results || []).find((category) => slugify(category.name) === slugify(group.category))
    if (found) { draft.fields.categoryId = found.id; draft.fields.categoryName = found.name; suggested.push('category') } else draft.suggestedCategory = group.category
  }
  if (group.colors[0]) draft.defaultColor = group.colors[0]
  if (group.brand) draft.visibleBrand = group.brand
  draft.aiSuggested = suggested
  draft.aiAnalyzed = true
  draft.askFirst = 'price'
  draft.batch = { id: batch.id, group: index, total: groups.length }
  // What the merchant wrote with the photos (never invented): an explicit price and sizes with quantities.
  const caption = items.map((item) => item.caption || '').filter(Boolean).join('. ')
  if (caption) applyMerchantText(draft, caption)
  try {
    await ctx.db.prepare(
      `INSERT INTO telegram_operations (operation_id, update_id, chat_id, store_id, action, params_json, before_json, after_json, expires_at)
       VALUES (?, ?, ?, ?, 'create_product', ?, '{}', '{}', unixepoch() + 86400)`,
    ).bind(operationId, ctx.updateId, String(ctx.chatId), ctx.store.id, JSON.stringify(draft)).run()
  } catch (error) {
    if (ctx.env.ASSETS) for (const image of draft.images) await ctx.env.ASSETS.delete(image.tempKey)
    if (error instanceof Error && /unique constraint/i.test(error.message)) { await say(ctx, 'Tienes otra operación abierta. Termínala o cancélala y responde <b>sí</b> para seguir con el lote.'); return }
    throw error
  }
  const header = `<b>Producto ${index + 1} de ${groups.length}:</b> ${escapeHtml(group.name || 'sin nombre')} (${draft.images.length} ${draft.images.length === 1 ? 'foto' : 'fotos'})` +
    (group.brand ? `\nVeo la marca «${escapeHtml(group.brand)}» en las fotos. No la agregué al nombre: si es correcta, dímelo al revisar.` : '') +
    `\nEscribe <b>omitir</b> para saltar este producto o <b>cancelar lote</b> para dejar todo.`
  await say(ctx, header)
  await promptProductDraft(ctx, { operation_id: operationId, action: 'create_product', params_json: JSON.stringify(draft), before_json: '{}', after_json: '{}' }, draft)
}

/** Precio explícito («180 mil», «$60.000») y tallas con cantidades («38 al 42, cinco de cada talla»). */
function applyMerchantText(draft: TelegramProductDraft, text: string): boolean {
  let changed = false
  if (/\b(?:mil|millones?|mill[oó]n|palos?|lucas?)\b|\$\s*\d|\d{1,3}(?:[.,]\d{3})+/i.test(text)) {
    const price = parseMoney(text)
    if (price && Number.isSafeInteger(price) && price > 0 && price < 1_000_000_000) { draft.fields.price = price; changed = true }
  }
  const lines = parseStockLines(text).lines.filter((line) => Number.isInteger(line.quantity) && line.quantity >= 0 && line.quantity <= 100_000)
  if (lines.length) {
    draft.variants = lines.slice(0, 80).map((line) => ({
      ...(line.size ? { size: String(line.size).slice(0, 24) } : {}),
      ...(line.color || draft.defaultColor ? { color: String(line.color || draft.defaultColor).slice(0, 48) } : {}),
      stock: line.quantity,
    }))
    changed = true
  }
  return changed
}

async function fillPriceAndStock(ctx: AssistantContext, active: { operation: PendingOperation; draft: TelegramProductDraft }, text: string): Promise<boolean> {
  const next = structuredClone(active.draft)
  if (!applyMerchantText(next, text) || !next.fields.price || !next.variants.length || next.variants.some((variant) => variant.stock === undefined)) return false
  delete next.awaiting
  delete next.askFirst
  const saved = await ctx.db.prepare(
    `UPDATE telegram_operations SET params_json = ? WHERE operation_id = ? AND chat_id = ? AND store_id = ? AND status = 'pending' AND params_json = ?`,
  ).bind(JSON.stringify(next), active.operation.operation_id, String(ctx.chatId), ctx.store.id, active.operation.params_json).run()
  if (!saved.meta.changes) return false
  const total = next.variants.reduce((sum, variant) => sum + (variant.stock ?? 0), 0)
  await say(ctx, `Anotado: precio y ${next.variants.length} ${next.variants.length === 1 ? 'variante' : 'variantes'} (${total} u. en total).`)
  await promptProductDraft(ctx, { ...active.operation, params_json: JSON.stringify(next) }, next)
  return true
}

/** El borrador de un producto del lote se publicó o se omitió: sigue con el siguiente. Lo llama el motor. */
export async function continuePhotoBatch(ctx: AssistantContext, draft: Pick<TelegramProductDraft, 'batch'>, outcome: 'published' | 'skipped'): Promise<void> {
  if (!draft.batch) return
  const batch = await ctx.db.prepare(`SELECT * FROM whatsapp_photo_batches WHERE id = ? AND chat_id = ? AND status = 'reviewing'`).bind(draft.batch.id, String(ctx.chatId)).first<BatchRow>()
  if (!batch || Number(batch.current_group) !== draft.batch.group) return
  await advanceGroup(ctx, batch, outcome)
}

async function advanceGroup(ctx: AssistantContext, batch: BatchRow, outcome: 'published' | 'skipped'): Promise<void> {
  const groups = groupsOf(batch)
  const group = groups[Number(batch.current_group || 0)]
  const column = outcome === 'published' ? 'published_count' : 'skipped_count'
  const next = await ctx.db.prepare(
    `UPDATE whatsapp_photo_batches SET current_group = current_group + 1, ${column} = ${column} + 1, updated_at = unixepoch()
     WHERE id = ? AND status = 'reviewing' AND current_group = ? RETURNING *`,
  ).bind(batch.id, batch.current_group).first<BatchRow>()
  if (!next) return
  if (outcome === 'published' && group?.items.length) {
    await ctx.db.prepare(`UPDATE whatsapp_photo_items SET status = 'used' WHERE batch_id = ? AND id IN (${group.items.map(() => '?').join(',')}) AND status = 'stored'`).bind(batch.id, ...group.items).run()
  }
  if (Number(next.current_group) >= groups.length) { await finishBatch(ctx, next); return }
  await openGroupDraft(ctx, next)
}

async function finishBatch(ctx: AssistantContext, batch: BatchRow): Promise<void> {
  const closed = await ctx.db.prepare(`UPDATE whatsapp_photo_batches SET status = 'completed', completed_at = unixepoch(), updated_at = unixepoch() WHERE id = ? AND status IN ${OPEN_STATUSES} RETURNING *`).bind(batch.id).first<BatchRow>()
  if (!closed) return
  await ctx.db.prepare(`UPDATE whatsapp_photo_items SET caption = NULL WHERE batch_id = ?`).bind(batch.id).run()
  await purgeBatchAssets(ctx.env, batch.id)
  const total = groupsOf(closed).length
  await ctx.db.prepare(`INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id) VALUES ('whatsapp_photo_batch_completed', 'photo_batch', ?, ?, ?, 'whatsapp', ?)`)
    .bind(batch.id, JSON.stringify({ photos: closed.photo_count, duplicates: closed.duplicate_count, products: total, published: closed.published_count, skipped: closed.skipped_count }), `whatsapp:${closed.identity_id}`, ctx.store.id).run().catch(() => undefined)
  await say(ctx, `🎉 Terminamos el lote: publicaste ${closed.published_count} de ${total} ${total === 1 ? 'producto' : 'productos'}${closed.skipped_count ? ` (${closed.skipped_count} omitido${closed.skipped_count === 1 ? '' : 's'})` : ''}.\nPuedes enviarme más fotos cuando quieras.`)
}

async function cancelBatch(ctx: AssistantContext, batch: BatchRow, message?: string): Promise<void> {
  const closed = await ctx.db.prepare(`UPDATE whatsapp_photo_batches SET status = 'cancelled', completed_at = unixepoch(), updated_at = unixepoch() WHERE id = ? AND status IN ${OPEN_STATUSES} RETURNING *`).bind(batch.id).first<BatchRow>()
  if (!closed) return
  const active = await getPendingProductDraft(ctx)
  if (active?.draft.batch?.id === batch.id) await cancelProductDraft(ctx, active.operation.operation_id)
  await ctx.db.prepare(`UPDATE whatsapp_photo_items SET caption = NULL WHERE batch_id = ?`).bind(batch.id).run()
  await purgeBatchAssets(ctx.env, batch.id)
  await say(ctx, message || (closed.published_count
    ? `Cancelé el resto del lote. Los ${closed.published_count} productos que ya confirmaste siguen publicados; no se publicó nada más.`
    : 'Listo, cancelé el lote. No se publicó nada y borré las fotos temporales.'))
}

async function purgeBatchAssets(env: Partial<Bindings>, batchId: string): Promise<void> {
  if (!env.ASSETS || !/^[0-9a-f-]{36}$/.test(batchId)) return
  let cursor: string | undefined
  do {
    const listed = await env.ASSETS.list({ prefix: `whatsapp-batches/${batchId}/`, cursor, limit: 500 })
    const keys = listed.objects.map((object) => object.key)
    if (keys.length) await env.ASSETS.delete(keys)
    cursor = listed.truncated ? listed.cursor : undefined
  } while (cursor)
}

// ───────────────────────── Mantenimiento ─────────────────────────

/** Tarea programada: termina lotes que quedaron sin resumen (se cortó el proceso) y aplica la retención. */
export async function maintainPhotoBatches(env: Bindings, db: D1Database): Promise<void> {
  const stale = (await db.prepare(`SELECT id FROM whatsapp_photo_batches WHERE status IN ${OPEN_STATUSES} AND updated_at < unixepoch() - ${STALE_OPEN_SECONDS}`).all<{ id: string }>()).results || []
  for (const row of stale) {
    await db.prepare(`UPDATE whatsapp_photo_batches SET status = 'cancelled', error_code = 'EXPIRED', completed_at = unixepoch() WHERE id = ?`).bind(row.id).run()
    await db.prepare(`UPDATE whatsapp_photo_items SET caption = NULL WHERE batch_id = ?`).bind(row.id).run()
    await purgeBatchAssets(env, row.id)
  }
  await db.prepare('DELETE FROM whatsapp_photo_items WHERE created_at < unixepoch() - 180 * 86400').run()
  await db.prepare(`DELETE FROM whatsapp_photo_batches WHERE created_at < unixepoch() - 180 * 86400 AND status NOT IN ${OPEN_STATUSES}`).run()
  if (!photoBatchEnabled(env)) return
  const waiting = (await db.prepare(
    `SELECT id FROM whatsapp_photo_batches WHERE status IN ('collecting', 'grouping') AND last_photo_at < unixepoch() - ? AND (lock_until IS NULL OR lock_until < unixepoch()) ORDER BY last_photo_at LIMIT 5`,
  ).bind(quietSeconds(env) + 30).all<{ id: string }>()).results || []
  for (const row of waiting) await runBatchStep(env, db, row.id).catch((error) => console.error('Photo batch recovery failed:', error instanceof Error ? error.message : 'unknown'))
  // Summaries lost to a cut-off background step are delivered here at the latest.
  const unsent = (await db.prepare(`SELECT * FROM whatsapp_photo_batches WHERE status = 'grouped' AND (receiving_notice_sent & ${NOTICE_SUMMARY}) = 0 AND updated_at < unixepoch() - 60 LIMIT 5`).all<BatchRow>()).results || []
  for (const row of unsent) {
    const outbox = await outboxFor(env, db, row)
    if (outbox) await sendSummary(db, outbox, row).catch((error) => console.error('Photo batch summary retry failed:', error instanceof Error ? error.message : 'unknown'))
  }
}

export const _test = { applyMerchantText, summaryText }
