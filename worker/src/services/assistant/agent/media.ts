/** Asistente TiendIA — capa conversacional, paso 2: fotos y voz dentro de la conversación.
 *
 * Fotos, notas de voz y texto del mismo comerciante forman UNA operación. Esta capa solo decide a qué operación
 * pertenece cada mensaje y lo dice en corto; el trabajo lo siguen haciendo las piezas que ya existían:
 *   · el borrador de producto del motor (fotos, preguntas una por una, vista previa, «Guardar producto»);
 *   · los lotes de fotos de WAHA (R2, cola, agrupación con IA, recuperación), a los que solo se les agrega la
 *     descripción del comerciante como texto de las fotos;
 *   · el intérprete determinista de precios, tallas y cantidades.
 * Nada se publica ni se modifica aquí: preparar un borrador no pide confirmación; publicar sí, en su vista previa.
 *
 * Interruptor propio: ASSISTANT_MEDIA_STORE_IDS (independiente del de texto). Apagado = flujo anterior intacto. */
import { roleAllows } from '../../../tenancy/access'
import { escapeHtml, formatMoney } from '../tools'
import { getPendingOperation } from '../operations'
import { readSession, say, sayPhoto, updateSessionState, type AssistantContext } from '../context'
import { proposeStoreImage } from '../media'
import { detectIntent } from '../intents'
import { beginProductDraft, getPendingProductDraft, handleProductDraftCallback, promptProductDraft, receiveProductPhoto, saveProductDraft, type PendingProductDraft } from '../productDraft'
import { colorOf, fold, numberWordsToDigits, parseMoney, quantityOf, sizeOf } from '../commerce/language'
import { parseCommerce, parseStockLines } from '../commerce/parse'
import { loadCatalog, matchProducts, resolveProduct, type CatalogProduct } from '../commerce/resolve'
import type { TelegramMessage } from '../telegramApi'
import type { TelegramProductDraft } from '../../../validation/telegramProductDraft'
import { planTurn } from './planner'
import { withAiBudget } from '../ai'

export function mediaEnabled(ctx: Pick<AssistantContext, 'env' | 'store'>): boolean {
  const raw = String(ctx.env.ASSISTANT_MEDIA_STORE_IDS || '').trim()
  if (!raw) return false
  return raw === '*' || raw.split(',').map((value) => Number(value.trim())).includes(ctx.store.id)
}

export type MediaToolSpec = {
  description: string
  kind: 'read' | 'write' | 'control'
  /** What the merchant must confirm before anything reaches the catalogue. */
  confirm: string | null
  allowed: (ctx: Pick<AssistantContext, 'role'>) => boolean
  /** The existing flow the tool wraps (nothing is reimplemented here). */
  wraps: string
}
const adminOnly = (ctx: Pick<AssistantContext, 'role'>) => roleAllows(ctx.role, 'admin')

/** Tools of this step, in the same registry style as agent/tools.ts. All wrap existing flows; none writes to the catalogue. */
export const MEDIA_TOOLS = {
  borrador_desde_fotos: { description: 'Crea el borrador de un producto con las fotos en espera y lo que el comerciante dijo o escribió.', kind: 'write', confirm: '«Guardar producto» en la vista previa', allowed: adminOnly, wraps: 'productDraft (beginProductDraft, receiveProductPhoto)' },
  borrador_ajustar: { description: 'Corrige el borrador abierto: precio, tallas y cantidades, quitar una foto.', kind: 'write', confirm: '«Guardar producto» en la vista previa', allowed: adminOnly, wraps: 'productDraft (saveProductDraft)' },
  asociar_descripcion_a_lote: { description: 'Agrega la descripción (voz o texto) al producto del lote de fotos al que se refiere.', kind: 'write', confirm: '«sí» al resumen del lote y luego cada vista previa', allowed: adminOnly, wraps: 'lotes de WAHA (texto de las fotos del grupo)' },
  lote_agrupar: { description: 'Une o quita productos del resumen del lote («une 1 y 2», «quita 3»).', kind: 'write', confirm: '«sí» al resumen del lote', allowed: adminOnly, wraps: 'lotes de WAHA (handleBatchText)' },
  detectar_duplicados: { description: 'Fotos repetidas dentro del lote o ya recibidas, y productos existentes parecidos.', kind: 'read', confirm: null, allowed: adminOnly, wraps: 'índice único de fotos, huella de WAHA y buscador del catálogo' },
  lote_estado: { description: 'Cuántas fotos esperan descripción y qué falta.', kind: 'read', confirm: null, allowed: adminOnly, wraps: 'assistant_media_items / resumen del lote' },
  lote_confirmar: { description: 'Preparar las fichas del lote; cada producto se publica solo con su confirmación.', kind: 'control', confirm: 'cada vista previa', allowed: adminOnly, wraps: 'lotes de WAHA (startReview)' },
  lote_cancelar: { description: 'Descartar las fotos en espera o el lote (no se publicó nada).', kind: 'control', confirm: null, allowed: adminOnly, wraps: 'assistant_media_items / cancelBatch' },
} as const satisfies Record<string, MediaToolSpec>

type MediaAsk =
  | { kind: 'same_or_new'; sku: string; text: string; voice: boolean }
  | { kind: 'price_confirm'; price: number; operationId: string }
  | { kind: 'batch_target'; batchId: string; text: string; options: number[] }
export type MediaState = { ask?: MediaAsk; reminded?: boolean; note?: { batchId: string; text: string } }

const window = (ctx: AssistantContext) => Math.min(6 * 3600, Math.max(60, Number(ctx.env.ASSISTANT_MEDIA_WINDOW_SECONDS) || 1800))
const maxPhotos = (ctx: AssistantContext) => Math.min(10, Math.max(1, Number(ctx.env.ASSISTANT_MEDIA_MAX_PHOTOS) || 10))
const dailySets = (ctx: AssistantContext) => Math.min(500, Math.max(1, Number(ctx.env.ASSISTANT_MEDIA_DAILY_PRODUCTS) || 60))
/** Milliseconds of work after which the merchant is told it is still going (only then; fast answers say nothing extra). */
const progressAfter = (ctx: AssistantContext) => Math.min(20_000, Math.max(20, Number(ctx.env.ASSISTANT_MEDIA_PROGRESS_MS) || 4000))
const photosWord = (count: number) => (count === 1 ? 'la foto' : `las ${count} fotos`)

async function readMedia(ctx: AssistantContext): Promise<MediaState> {
  return ((await readSession(ctx.db, ctx.telegramUserId)).state.agent as { media?: MediaState } | undefined)?.media || {}
}
async function saveMedia(ctx: AssistantContext, patch: Partial<MediaState> | null): Promise<void> {
  const session = await readSession(ctx.db, ctx.telegramUserId)
  const agent = { ...(session.state.agent || {}) } as Record<string, unknown>
  const next = patch === null ? {} : { ...((agent.media as MediaState) || {}), ...patch }
  for (const key of Object.keys(next) as Array<keyof MediaState>) if (next[key] === undefined) delete next[key]
  if (Object.keys(next).length) agent.media = next; else delete agent.media
  await updateSessionState(ctx, { agent: Object.keys(agent).length ? agent : undefined })
}

type OpenPhoto = { id: number; file_id: string; created_at: number }
/** Photos of this merchant in this store still waiting for their description (inside the time window). */
async function openPhotos(ctx: AssistantContext): Promise<OpenPhoto[]> {
  return (await ctx.db.prepare(
    `SELECT id, file_id, created_at FROM assistant_media_items WHERE store_id = ? AND user_key = ? AND status = 'open' AND created_at > unixepoch() - ? ORDER BY id LIMIT 20`,
  ).bind(ctx.store.id, ctx.telegramUserId, window(ctx)).all<OpenPhoto>()).results || []
}
async function closePhotos(ctx: AssistantContext, status: 'used' | 'discarded', operationId?: string): Promise<void> {
  await ctx.db.prepare(`UPDATE assistant_media_items SET status = ?, operation_id = ? WHERE store_id = ? AND user_key = ? AND status = 'open'`)
    .bind(status, operationId ?? null, ctx.store.id, ctx.telegramUserId).run()
}

const quiet = (ctx: AssistantContext, offset = 0) => ({ ...ctx, capture: [] as NonNullable<AssistantContext['capture']>, ...(offset ? { updateId: -(Date.now() * 100 + offset) } : {}) })

async function measure(ctx: AssistantContext, started: number, tool: keyof typeof MEDIA_TOOLS | 'foto_recibida', outcome: string): Promise<void> {
  await ctx.db.prepare(`INSERT INTO assistant_agent_turns (store_id, channel, path, tools, outcome, latency_ms) VALUES (?, ?, 'media', ?, ?, ?)`)
    .bind(ctx.store.id, ctx.channel ? (ctx.channel.provider === 'waha' ? 'waha' : 'whatsapp') : 'telegram', tool, outcome.slice(0, 40), Date.now() - started).run().catch(() => undefined)
}

/** Runs the slow part (downloading and looking at the photos); one short notice if it is taking long, none otherwise. */
async function withProgress<T>(ctx: AssistantContext, notice: string, work: () => Promise<T>): Promise<T> {
  let pending: Promise<unknown> | null = null
  const timer = setTimeout(() => { pending = say(ctx, notice).catch(() => undefined) }, progressAfter(ctx))
  try { return await work() } finally { clearTimeout(timer); if (pending) await pending }
}

// ───────────────────────── Fotos: se reciben en silencio y esperan su descripción ─────────────────────────

/**
 * A photo that no other flow is waiting for (no draft, banner, logo, guide or WAHA batch). It joins the set of
 * photos waiting for a description: one acknowledgement for the whole set, never one question per photo.
 */
export async function handleAgentPhoto(ctx: AssistantContext, fileId: string, caption: string): Promise<boolean> {
  if (!mediaEnabled(ctx) || !MEDIA_TOOLS.borrador_desde_fotos.allowed(ctx)) return false
  const started = Date.now()
  if (caption) {
    const intent = detectIntent(caption)
    // A caption that asks for something else keeps its own flow.
    if (intent?.kind === 'change_store_image' || intent?.kind === 'attach_photos' || /\b(?:banner|portada|logo|logotipo|gu[ií]a)\b/i.test(caption)) return false
  }
  await ctx.db.prepare(`UPDATE assistant_media_items SET status = 'discarded' WHERE store_id = ? AND user_key = ? AND status = 'open' AND created_at <= unixepoch() - ?`)
    .bind(ctx.store.id, ctx.telegramUserId, window(ctx)).run()
  const before = await openPhotos(ctx)
  if (before.length >= maxPhotos(ctx) && !before.some((photo) => photo.file_id === fileId)) {
    // Said once, when the limit is reached: the rest of the album is not answered one by one.
    if (before.length === maxPhotos(ctx)) {
      await ctx.db.prepare(`INSERT OR IGNORE INTO assistant_media_items (store_id, user_key, chat_id, file_id, status) VALUES (?, ?, ?, ?, 'discarded')`).bind(ctx.store.id, ctx.telegramUserId, String(ctx.chatId), fileId).run()
      const extra = Number((await ctx.db.prepare(`SELECT COUNT(*) AS n FROM assistant_media_items WHERE store_id = ? AND user_key = ? AND status = 'discarded' AND created_at > unixepoch() - 120`).bind(ctx.store.id, ctx.telegramUserId).first<{ n: number }>())?.n || 0)
      if (extra === 1) await say(ctx, `Un producto lleva máximo ${maxPhotos(ctx)} fotos, así que me quedo con las primeras ${maxPhotos(ctx)}. Dime qué producto es y las demás envíalas después.`)
    }
    await measure(ctx, started, 'foto_recibida', 'limit')
    return true
  }
  // The unique index makes a resent file or webhook a no-op.
  const inserted = await ctx.db.prepare(`INSERT OR IGNORE INTO assistant_media_items (store_id, user_key, chat_id, file_id) VALUES (?, ?, ?, ?) RETURNING id`)
    .bind(ctx.store.id, ctx.telegramUserId, String(ctx.chatId), fileId).first<{ id: number }>()
  const photos = await openPhotos(ctx)
  if (caption && inserted) {
    // The caption is the description: the whole set becomes one draft now.
    if (await describePhotos(ctx, caption, { voice: false, photos })) { await measure(ctx, started, 'borrador_desde_fotos', 'caption'); return true }
  }
  // Only the first photo of the set is acknowledged (albums arrive as several simultaneous messages).
  if (inserted && photos[0]?.id === inserted.id) {
    const pending = await getPendingOperation(ctx)
    await saveMedia(ctx, { reminded: undefined })
    await say(ctx, `📸 Recibí la foto. Si son varias, envíalas todas y luego dime qué producto es: nombre, tallas, cantidades y precio (escrito o en nota de voz).${pending && pending.action !== 'create_product' ? '\nTienes un cambio esperando confirmación; lo vemos primero si quieres.' : ''}`)
  }
  await measure(ctx, started, 'foto_recibida', inserted ? 'stored' : 'duplicate')
  return true
}

// ───────────────────────── Lo que el comerciante dijo: nombre, tallas, cantidades y precio ─────────────────────────

export type Description = { name: string | null; color: string | null; price: number | null; lines: Array<{ size: string | null; color: string | null; quantity: number }>; lead: boolean }

const LEAD = /^(?:(?:mira|listo|bueno|oye|ve|pues)[, ]+)*(?:(?:est[oa]s?|es[oa]s?|eso|esto|aquell[oa]s)\s+(?:son|es)|son|es|te\s+(?:mando|env[ií]o|paso)|ah[ií]\s+(?:van|te\s+van|est[aá]n)|van|llegaron|me\s+llegaron)\s+/i
const MONEY_HINT = /\b(?:mil|millones?|mill[oó]n|palos?|lucas?|pesos)\b|\$\s*\d|\d{1,3}(?:[.,]\d{3})+/i

type Line = { size: string | null; color: string | null; quantity: number }
const UNIT = String.raw`(?:unidades|unidad|pares|par|piezas|pieza)`
const SIZE = String.raw`(?:\d{1,2}(?:[.,]5)?|x{0,3}[sml]|unica)`
const EACH = new RegExp(String.raw`\b([a-z]+|\d{1,4})\s+(?:${UNIT}\s+)?(?:de|por|para|en)\s+cada\s+(?:un[oa]|talla|numero)\b`)
const FLAT = new RegExp(String.raw`\b([a-z]+|\d{1,4})\s+${UNIT}\b`)
const SIZE_RANGE = /\b(?:tallas?|numeros?)\s+(?:de\s+la\s+|del?\s+)?(\d{2})\s*(?:a|al|hasta|-)\s*(?:la\s+|el\s+)?(\d{2})\b/
const SIZE_LIST = new RegExp(String.raw`\b(?:tallas?|numeros?)\s+((?:${SIZE}\b(?:\s*(?:,|y|e)\s*|\s+)?)+)`)
const SIZE_RUN = /(?:^|[\s,])((?:[23]\d|4\d)(?:\s*(?:,|y|e)?\s*(?:[23]\d|4\d)\b)+)(?!\s*(?:mil|k\b|lucas|pesos|[.,]\d{3}))/

/**
 * Sizes and quantities of a description. The engine's parser reads «3 de la 38», «del 38 al 42, cinco de cada una»,
 * «38:3»; this adds the ways merchants say it when sizes go first and one quantity applies to all of them:
 * «talla 38, dos unidades» · «tallas 38 y 39, cinco pares» · «38 39 40 dos de cada uno» · «10 unidades» (no sizes).
 */
export function stockLinesOf(text: string): Line[] {
  const valid = (quantity: number) => Number.isInteger(quantity) && quantity >= 0 && quantity <= 100_000
  const parsed = parseStockLines(text).lines.filter((line) => valid(line.quantity)).map((line) => ({ size: line.size ?? null, color: line.color ?? null, quantity: line.quantity }))
  if (parsed.some((line) => line.size)) return parsed
  const folded = numberWordsToDigits(text)
  const each = folded.match(EACH)
  const flat = each || folded.match(FLAT)
  const quantity = flat ? quantityOf(flat[1]) : null
  if (!flat || quantity === null || !valid(quantity)) return parsed
  const before = folded.slice(0, flat.index)
  const after = folded.slice(flat.index! + flat[0].length)
  const sizes = sizesIn(before, true).length ? sizesIn(before, true) : sizesIn(after, false)
  if (sizes.length) return sizes.map((size) => ({ size, color: null, quantity }))
  // «gorras negras, 10 unidades»: a quantity with no sizes is the stock of a product without sizes.
  return each || parsed.length || /\b(?:tallas?|numeros?)\b/.test(folded) ? parsed : [{ size: null, color: null, quantity }]
}

function sizesIn(segment: string, bareRuns: boolean): string[] {
  const range = segment.match(SIZE_RANGE)
  if (range && Number(range[2]) > Number(range[1]) && Number(range[2]) - Number(range[1]) <= 20) return Array.from({ length: Number(range[2]) - Number(range[1]) + 1 }, (_, index) => String(Number(range[1]) + index))
  const labelled = segment.match(SIZE_LIST)
  // Shoe sizes said in a row with no label («38 39 40»): at least two, and only before the quantity.
  const run = labelled || !bareRuns ? null : segment.match(SIZE_RUN)
  const list = labelled?.[1] ?? run?.[1]
  if (!list) return []
  return [...new Set(list.split(/\s*(?:,|\by\b|\be\b)\s*|\s+/).map((value) => sizeOf(value)).filter((value): value is string => Boolean(value)))]
}

/** Reads a merchant description with the deterministic parsers (the same the batches and the commerce engine use). */
export function readDescription(text: string): Description {
  const trimmed = text.trim()
  const lead = LEAD.test(trimmed)
  const price = MONEY_HINT.test(trimmed) ? parseMoney(trimmed) : null
  const lines = stockLinesOf(trimmed)
  const rest = trimmed.replace(LEAD, '').replace(/^(?:un[oa]s?|l[oa]s|el|la)\s+/i, '')
  const head = rest.split(/[,.;:]|\s+(?=(?:del?\s+(?:la\s+)?\d|tallas?\b|a\s+\$?\s*\d|en\s+\$?\s*\d|por\s+\$?\s*\d|precio\b|cada\b|\d|cuestan?\b|valen?\b))/i)[0]!.trim()
  const words = head.split(/\s+/).filter(Boolean)
  const usable = words.length >= 1 && words.length <= 6 && words.some((word) => /[a-záéíóúñ]{3,}/i.test(word)) && !parseMoney(head) && !/^\d/.test(head)
    && !/^(?:s[ií]|no|listo|dale|ok|hola|gracias|cancel\w*|cu[aá]nt\w*|qu[eé])\b/i.test(head)
  const color = words.map((word) => colorOf(word)).find(Boolean) || null
  return { name: usable ? head.charAt(0).toUpperCase() + head.slice(1) : null, color, price: price && price > 0 ? price : null, lines, lead }
}

/** Sizes and quantities in one short phrase: «tallas 38 a 42, 5 de cada una (25 en total)». */
export function sizesPhrase(variants: Array<{ size?: string | null; stock?: number }>): string {
  const sized = variants.filter((variant) => variant.size && variant.size !== 'Única')
  if (!variants.length) return ''
  const total = variants.reduce((sum, variant) => sum + (variant.stock ?? 0), 0)
  const known = variants.every((variant) => variant.stock !== undefined)
  if (!sized.length) return known ? `${total} ${total === 1 ? 'unidad' : 'unidades'}` : ''
  const numbers = sized.map((variant) => Number(variant.size))
  const run = numbers.length > 2 && numbers.every((value, index) => Number.isInteger(value) && (index === 0 || value === numbers[index - 1]! + 1))
  const sameStock = known && sized.every((variant) => variant.stock === sized[0]!.stock)
  const sizes = run ? `tallas ${numbers[0]} a ${numbers.at(-1)}` : `${sized.length === 1 ? 'talla' : 'tallas'} ${sized.map((variant) => variant.size).join(', ')}`
  if (!known) return sizes
  if (sameStock && sized.length > 1) return `${sizes}, ${sized[0]!.stock} de cada una (${total} en total)`
  if (sized.length === 1) return `${sizes}, ${total} ${total === 1 ? 'unidad' : 'unidades'}`
  return `${sized.map((variant) => `${variant.size}: ${variant.stock}`).join(' · ')} (${total} en total)`
}

/**
 * A price heard in a voice note that does not fit what the store sells is probably a transcription slip («dieciocho
 * mil» for «ciento ochenta mil»): it is far below the comparable products and ten times more fits them. The comparison
 * uses the products that share the name's first word when there are at least two, the whole catalogue otherwise.
 */
export function suspiciousPrice(price: number, catalog: CatalogProduct[], name?: string | null): number | null {
  const first = name ? fold(name).split(/\s+/)[0]!.replace(/s$/, '') : ''
  const alike = first.length > 2 ? catalog.filter((product) => fold(product.name).split(/\s+/).some((word) => word.replace(/s$/, '') === first)) : []
  const prices = (alike.length >= 2 ? alike : catalog).map((product) => product.price).filter((value) => value > 0).sort((a, b) => a - b)
  if (prices.length < 2) return null
  const low = prices[0]!
  const high = prices.at(-1)!
  return price < low * 0.6 && price * 10 >= low * 0.5 && price * 10 <= high * 2 ? price * 10 : null
}

// ───────────────────────── Asociación: ¿a qué operación pertenece este mensaje? ─────────────────────────

export type Association = 'draft' | 'photos' | 'batch' | 'ask_batch' | 'none'
/**
 * Explicit, tested rules. Same store and merchant are given (every query is scoped by them). In order:
 *   1. an open draft owns the message (its own questions and corrections);
 *   2. photos waiting inside the time window take a message that describes a product;
 *   3. an open photo batch takes it when it has one product, or when the message names exactly one of them;
 *      with several products and no clear match, the merchant is asked;
 *   4. anything else is not about media.
 */
export function associate(input: { draftOpen: boolean; openPhotos: number; batchGroups: string[] | null; describes: boolean; namedGroup: number | null }): Association {
  if (input.draftOpen) return 'draft'
  if (!input.describes) return 'none'
  if (input.openPhotos > 0) return 'photos'
  if (input.batchGroups) {
    if (input.batchGroups.length === 1 || input.namedGroup !== null) return 'batch'
    if (input.batchGroups.length > 1) return 'ask_batch'
  }
  return 'none'
}

const looksLikeDescription = (description: Description) => Boolean(description.price || description.lines.length || (description.lead && description.name))

type BatchRow = { id: string; status: string; groups_json: string | null; photo_count: number }
async function openWahaBatch(ctx: AssistantContext): Promise<BatchRow | null> {
  if (ctx.channel?.provider !== 'waha') return null
  return ctx.db.prepare(`SELECT id, status, groups_json, photo_count FROM whatsapp_photo_batches WHERE chat_id = ? AND store_id = ? AND status IN ('collecting', 'grouping', 'grouped') LIMIT 1`)
    .bind(String(ctx.chatId), ctx.store.id).first<BatchRow>().catch(() => null)
}
type Group = { name: string; items: number[] }
const groupsOf = (batch: BatchRow): Group[] => { try { return JSON.parse(batch.groups_json || '[]') as Group[] } catch { return [] } }

/**
 * Text or transcribed voice while media is waiting. Returns true when the message belonged to a media operation.
 * Runs before the text orchestrator; a message about something else returns false and is answered as usual.
 */
export async function handleAgentDescription(ctx: AssistantContext, text: string, options: { voice?: boolean } = {}): Promise<boolean> {
  if (!mediaEnabled(ctx)) return false
  const started = Date.now()
  const media = await readMedia(ctx)
  const trimmed = text.trim()
  const lower = fold(trimmed)

  if (media.ask) {
    const handled = await answerAsk(ctx, media.ask, trimmed)
    if (handled) { await measure(ctx, started, handled, 'answer'); return true }
  }
  if (await getPendingProductDraft(ctx)) return false
  const photos = await openPhotos(ctx)
  const batch = await openWahaBatch(ctx)
  if (!photos.length && !batch) return false
  // Only who may publish products describes photos or a batch; anyone else keeps the usual answers.
  if (!MEDIA_TOOLS.asociar_descripcion_a_lote.allowed(ctx)) return false

  if (photos.length) {
    const explicit = /\b(?:descarta|borra|olvida|cancela|quita)\w*\s+(?:las?\s+|esas?\s+)?fotos?\b/.test(lower) || /^(?:descart\w*|b[oó]rral[ao]s)[.! ]*$/.test(lower)
    const bare = /^(?:no|nada|ninguno|cancel\w*|olv[ií]dal[oa]s?|ya no)[.! ]*$/.test(lower)
    // A bare «cancela» answers a pending change when there is one; the photos keep waiting.
    if (explicit || (bare && !await getPendingOperation(ctx))) {
      await closePhotos(ctx, 'discarded')
      await saveMedia(ctx, null)
      await say(ctx, `Listo, descarté ${photosWord(photos.length)}. No se creó ni se publicó nada.`)
      await measure(ctx, started, 'lote_cancelar', 'discarded')
      return true
    }
    if (/^(?:cu[aá]ntas fotos|qu[eé] (?:fotos )?(?:tengo|hay) pendiente|estado de las fotos)/.test(lower)) {
      await say(ctx, `Tengo ${photosWord(photos.length)} esperando. Dime qué producto es (nombre, tallas, cantidades y precio) o escribe «descarta las fotos».`)
      await measure(ctx, started, 'lote_estado', 'status')
      return true
    }
    if (/^(?:es|son)\s+(?:el|del|la|de la|los|de los)?\s*mism[oa]s?(?:\s+producto)?[.! ]*$/.test(lower) || /^son (?:de|del) (?:ese|esa|eso)(?: producto)?[.! ]*$/.test(lower)) {
      const session = await readSession(ctx.db, ctx.telegramUserId)
      const focus = session.state.focusSku
      await closePhotos(ctx, 'discarded')
      await saveMedia(ctx, null)
      await say(ctx, `Entendido: no creo otro producto con ${photosWord(photos.length)}.${focus ? ` Si quieres agregárselas al que ya tienes, escribe «agrega fotos al ${escapeHtml(focus)}» y envíalas.` : ''}`)
      await measure(ctx, started, 'detectar_duplicados', 'same')
      return true
    }
    const store = /\b(banner|portada)\b/.test(lower) ? 'banner' : /\b(logo|logotipo)\b/.test(lower) ? 'logo' : null
    if (store) {
      await closePhotos(ctx, 'used')
      await proposeStoreImage(ctx, store, photos.at(-1)!.file_id)
      return true
    }
  }
  const description = readDescription(trimmed)
  let describes = looksLikeDescription(description)
  // A request about a product the store already has (stock, price, a question) is not the description of these photos.
  const parsed = parseCommerce(trimmed)
  const catalog = describes || parsed ? await loadCatalog(ctx) : []
  if (parsed && parsed.kind !== 'create_product' && 'product' in parsed && parsed.product && resolveProduct(catalog, parsed.product, {}, null).kind === 'one') describes = false
  if (parsed?.kind === 'stock_query' || /\?\s*$/.test(trimmed) && !description.price && !description.lines.length) describes = false

  const groups = batch?.status === 'grouped' ? groupsOf(batch) : null
  const named = groups && description.name ? groups.findIndex((group) => matchesName(group.name, description.name!)) : -1
  const decision = associate({ draftOpen: false, openPhotos: photos.length, batchGroups: batch ? (groups || ['?']).map((group) => typeof group === 'string' ? group : group.name) : null, describes, namedGroup: named >= 0 ? named : null })

  if (decision === 'photos') {
    if (await describePhotos(ctx, trimmed, { voice: Boolean(options.voice), photos, description, catalog })) { await measure(ctx, started, 'borrador_desde_fotos', 'draft'); return true }
    return false
  }
  if ((decision === 'batch' || decision === 'ask_batch') && batch) {
    if (!groups) {
      // Photos are still being organised: the description is kept and applied when the summary is ready.
      await saveMedia(ctx, { note: { batchId: batch.id, text: trimmed.slice(0, 500) } })
      await say(ctx, `Anotado${summaryOf(description) ? `: ${summaryOf(description, ctx.store.currency)}` : ''}. Estoy organizando las ${batch.photo_count} fotos; en cuanto termine lo aplico y te muestro el resumen.`)
      await measure(ctx, started, 'asociar_descripcion_a_lote', 'kept')
      return true
    }
    await noteToBatch(ctx, batch, groups, trimmed, description, decision === 'batch' ? (groups.length === 1 ? 0 : named) : null)
    await measure(ctx, started, 'asociar_descripcion_a_lote', decision)
    return true
  }
  // Something else while photos wait: it is answered as usual, and the merchant is reminded once.
  if (photos.length && !media.reminded) {
    ctx.afterNote = `Siguen esperando ${photosWord(photos.length)} que me enviaste: dime qué producto es o escribe «descarta las fotos».`
    await saveMedia(ctx, { reminded: true })
  }
  return false
}

const matchesName = (groupName: string, said: string) => {
  const words = (value: string) => fold(value).split(/\s+/).filter((word) => word.length > 2)
  const group = words(groupName)
  const mine = words(said)
  return mine.length > 0 && mine.every((word) => group.some((other) => other.startsWith(word.replace(/s$/, '')) || word.startsWith(other.replace(/s$/, ''))))
}

function summaryOf(description: Description, currency = 'COP'): string {
  const sizes = sizesPhrase(description.lines.map((line) => ({ size: line.size, stock: line.quantity })))
  return [description.name ? `<b>${escapeHtml(description.name)}</b>` : '', sizes, description.price ? `a ${formatMoney(description.price, currency)}` : ''].filter(Boolean).join(', ')
}

/** The description goes to the batch as the text of the photos of that product: the batch flow reads it when it opens the draft. */
async function noteToBatch(ctx: AssistantContext, batch: BatchRow, groups: Group[], text: string, description: Description, target: number | null): Promise<void> {
  if (target === null) {
    const shown = groups.slice(0, 3)
    await saveMedia(ctx, { ask: { kind: 'batch_target', batchId: batch.id, text: text.slice(0, 500), options: shown.map((_, index) => index) }, note: undefined })
    await say(ctx, `¿A cuál producto del lote te refieres?\n${shown.map((group, index) => `${index + 1}) ${escapeHtml(group.name || 'Producto sin nombre')}`).join('\n')}${groups.length > 3 ? `\n(hay ${groups.length}; dime el número)` : ''}\nO dime «a todos» si aplica para todos.`)
    return
  }
  await writeBatchCaption(ctx, batch.id, [groups[target]!], text)
  await saveMedia(ctx, { note: undefined, ask: undefined })
  const photos = groups[target]!.items.length
  await say(ctx, `Listo, entendí: ${summaryOf(description, ctx.store.currency) || escapeHtml(text.slice(0, 120))}.\n${groups.length === 1 ? `¿Los dejo preparados con ${photosWord(photos)}? Responde <b>sí</b>.` : `Lo anoté para el producto ${target + 1} (${escapeHtml(groups[target]!.name || 'sin nombre')}). Responde <b>sí</b> para preparar las fichas.`}`)
}

/** What the batch will read: price and «talla:cantidad» in the plain form its own parser understands, whatever
 * way the merchant said it. Without sizes the merchant's words go as they are. */
function batchCaption(text: string): string {
  const description = readDescription(text)
  const sized = description.lines.filter((line) => line.size)
  if (!sized.length) return text
  return [description.price ? `$${description.price.toLocaleString('es-CO')}` : '', sized.map((line) => `${line.size}:${line.quantity}`).join(', ')].filter(Boolean).join('. ')
}

async function writeBatchCaption(ctx: AssistantContext, batchId: string, groups: Group[], text: string): Promise<void> {
  const caption = batchCaption(text)
  for (const group of groups) {
    const first = group.items[0]
    if (first === undefined) continue
    // Scoped by batch and store: a batch of another store can never be written.
    await ctx.db.prepare(`UPDATE whatsapp_photo_items SET caption = trim(COALESCE(caption || '. ', '') || ?) WHERE id = ? AND batch_id = ? AND store_id = ?`)
      .bind(caption.slice(0, 400), first, batchId, ctx.store.id).run()
  }
}

/** Called by the WhatsApp transport before the batch reads the merchant's answer: a kept description is applied first. */
export async function applyPendingBatchNote(ctx: AssistantContext): Promise<void> {
  if (!mediaEnabled(ctx)) return
  const media = await readMedia(ctx)
  if (!media.note) return
  const batch = await openWahaBatch(ctx)
  if (!batch || batch.id !== media.note.batchId) { await saveMedia(ctx, { note: undefined }); return }
  if (batch.status !== 'grouped') return
  const groups = groupsOf(batch)
  const description = readDescription(media.note.text)
  const named = description.name ? groups.findIndex((group) => matchesName(group.name, description.name!)) : -1
  if (groups.length === 1 || named >= 0) {
    await writeBatchCaption(ctx, batch.id, [groups[groups.length === 1 ? 0 : named]!], media.note.text)
    await saveMedia(ctx, { note: undefined })
  }
}

async function answerAsk(ctx: AssistantContext, ask: MediaAsk, text: string): Promise<keyof typeof MEDIA_TOOLS | null> {
  const lower = fold(text)
  if (ask.kind === 'batch_target') {
    const batch = await openWahaBatch(ctx)
    if (!batch || batch.id !== ask.batchId || batch.status !== 'grouped') { await saveMedia(ctx, { ask: undefined }); return null }
    const groups = groupsOf(batch)
    const all = /^(?:a\s+)?tod[oa]s\b|para tod[oa]s/.test(lower)
    const ordinal = lower.match(/^(?:el|la|al|a la|opcion|numero|producto)?\s*(\d{1,2}|primer[oa]?|segund[oa]|tercer[oa]?)\b/)
    const words: Record<string, number> = { primero: 1, primera: 1, primer: 1, segundo: 2, segunda: 2, tercero: 3, tercera: 3, tercer: 3 }
    const index = ordinal ? (Number(ordinal[1]) || words[ordinal[1]!] || 0) - 1 : groups.findIndex((group) => matchesName(group.name, text))
    if (!all && !groups[index]) return null
    await writeBatchCaption(ctx, batch.id, all ? groups : [groups[index]!], ask.text)
    await saveMedia(ctx, { ask: undefined })
    await say(ctx, `Anotado para ${all ? `los ${groups.length} productos` : `<b>${escapeHtml(groups[index]!.name || `el producto ${index + 1}`)}</b>`}: ${summaryOf(readDescription(ask.text), ctx.store.currency) || escapeHtml(ask.text.slice(0, 120))}.\nResponde <b>sí</b> para preparar las fichas.`)
    return 'asociar_descripcion_a_lote'
  }
  if (ask.kind === 'price_confirm') {
    const active = await getPendingProductDraft(ctx)
    if (!active || active.operation.operation_id !== ask.operationId) { await saveMedia(ctx, { ask: undefined }); return null }
    const yes = /^(?:s[ií]+|correcto|as[ií] es|ese|exacto|dale|listo|ok)\b/.test(lower)
    const other = MONEY_HINT.test(text) || /^\$?\s*\d/.test(text) ? parseMoney(text) : null
    const price = yes ? ask.price : other && other >= 1000 ? other : /\b(?:no|otro|el otro|el segundo)\b/.test(lower) ? ask.price * 10 : null
    if (!price) return null
    const next = structuredClone(active.draft)
    next.fields.price = price
    delete next.awaiting
    const saved = await saveProductDraft(ctx, active.operation, next)
    await saveMedia(ctx, { ask: undefined })
    await say(ctx, `Precio: <b>${formatMoney(price, ctx.store.currency)}</b>.`)
    if (saved) await promptProductDraft(ctx, saved, next)
    return 'borrador_ajustar'
  }
  // same_or_new
  const photos = await openPhotos(ctx)
  if (!photos.length) { await saveMedia(ctx, { ask: undefined }); return null }
  const isNew = /\b(?:nuevo|nueva|otro|otra|distinto|diferente)\b/.test(lower)
  const same = /\b(?:el mismo|la misma|mismo|misma|es ese|ese mismo|s[ií])\b/.test(lower)
  if (!isNew && !same) return null
  await saveMedia(ctx, { ask: undefined })
  if (isNew) {
    // «Es uno nuevo, ponle como nombre Adidas violeta»: the answer may carry the name of the new product.
    await describePhotos(ctx, ask.text, { voice: ask.voice, photos, forceNew: true, name: nameIn(text) || undefined })
    return 'borrador_desde_fotos'
  }
  const product = (await loadCatalog(ctx)).find((item) => item.sku === ask.sku)
  await closePhotos(ctx, 'discarded')
  await say(ctx, `Entendido, es <b>${escapeHtml(product?.name || ask.sku)}</b>, que ya tienes: no creo otro producto. Si llegaron unidades dime cuántas por talla, y si quieres agregarle estas fotos escribe «agrega fotos al ${escapeHtml(ask.sku)}» y envíalas.`)
  await updateSessionState(ctx, { focusSku: ask.sku, lastSkus: [ask.sku] })
  return 'detectar_duplicados'
}

/** «ponle como nombre Adidas violeta», «que se llame…», «el nombre es…», «llámalo…»: the name the merchant dictates. */
export function nameIn(text: string): string | null {
  const match = text.trim().match(/(?:p[oó]n(?:le|ele|gale|me)?\s+(?:como\s+|de\s+|por\s+)?nombre|que\s+se\s+llamen?|ll[aá]m[ae]l[oa]s?|n[oó]mbr[ae]l[oa]s?(?:\s+como)?|(?:el|su|de|como)\s+nombre\s+(?:es|ser[ií]a|va a ser|:)?|c[aá]mbi[ae]le\s+el\s+nombre\s+(?:a|por)|nombre\s*:)\s+(.+)$/i)
  if (!match) return null
  const name = match[1]!.replace(/^(?:es|ser[ií]a|como|a|por|de)\s+/i, '').replace(/^[«"“']+|[»"”'.!]+$/g, '').split(/[,;]|\s+(?=(?:a\s+\$?\s*\d|del?\s+\d|tallas?\b|precio\b|y\s+(?:el\s+)?precio\b))/i)[0]!.trim()
  return name.length >= 2 && name.length <= 120 && /[a-záéíóúñ]{2,}/i.test(name) ? name.charAt(0).toUpperCase() + name.slice(1) : null
}

// ───────────────────────── Fotos + descripción = un borrador y un solo resumen ─────────────────────────

async function describePhotos(ctx: AssistantContext, text: string, input: { voice: boolean; photos: OpenPhoto[]; description?: Description; catalog?: CatalogProduct[]; forceNew?: boolean; name?: string }): Promise<boolean> {
  const photos = input.photos
  if (!photos.length) return false
  if (!roleAllows(ctx.role, 'admin')) { await say(ctx, 'Tu rol en esta tienda no permite publicar productos. Pídeselo al propietario o a un administrador.'); return true }
  const pending = await getPendingOperation(ctx)
  if (pending) {
    await say(ctx, 'Tienes un cambio esperando confirmación. Confírmalo o cancélalo y luego repíteme qué producto es; las fotos siguen guardadas.')
    return true
  }
  const made = Number((await ctx.db.prepare(`SELECT COUNT(DISTINCT operation_id) AS n FROM assistant_media_items WHERE store_id = ? AND status = 'used' AND created_at > unixepoch() - 86400`).bind(ctx.store.id).first<{ n: number }>())?.n || 0)
  if (made >= dailySets(ctx)) { await say(ctx, 'Hoy ya preparé el máximo de productos desde fotos para esta tienda. Las fotos siguen guardadas: retómalo mañana o crea el producto desde el panel.'); return true }

  const description = input.description || readDescription(text)
  const catalog = input.catalog?.length ? input.catalog : await loadCatalog(ctx)
  // The name the merchant gave, or the one the model reads from the same words (never from the photos' text).
  let name = input.name || nameIn(text) || description.name
  if ((!name || !description.lines.length) && looksLikeDescription(description) && ctx.env.GEMINI_API_KEY) {
    const plan = await withAiBudget(ctx, 'interpretacion', () => planTurn(ctx, text, { focus: null, options: [], pending: null, recent: 'El comerciante acaba de enviar fotos de un producto nuevo y lo está describiendo: usa preparar_producto.' }, 6000)).catch(() => null)
    const step = plan && plan.ok ? plan.value.steps.find((item) => item.tool === 'preparar_producto') : null
    if (step?.nombre && !name) name = step.nombre
    // Sizes and quantities the model read from the same sentence, only when the deterministic reading found none.
    if (step && !description.lines.length) {
      const read = step.lineas.filter((line) => line.talla).map((line) => ({ size: sizeOf(line.talla!) || line.talla!, color: line.color, quantity: line.cantidad }))
      if (read.length) description.lines.push(...read)
    }
  }
  if (!looksLikeDescription(description) && !name) return false
  // A size heard in a voice note that is not a real size («talla 83»): it is never kept, and it is asked by name.
  const oddSize = input.voice ? (fold(text).match(/\b(?:tallas?|numero)\s+(\d{2,3})\b/) || []).slice(1).find((value) => !sizeOf(value)) : undefined
  if (input.voice) description.lines = description.lines.filter((line) => !line.size || sizeOf(line.size))

  if (name && !input.forceNew) {
    const twins = matchProducts(catalog, name)
    if (twins.length === 1) {
      await saveMedia(ctx, { ask: { kind: 'same_or_new', sku: twins[0]!.sku, text: text.slice(0, 500), voice: input.voice } })
      await say(ctx, `Eso se parece a <b>${escapeHtml(twins[0]!.name)}</b>, que ya tienes. ¿Es el mismo producto o uno nuevo?`, {
        inline_keyboard: [[{ text: 'Es el mismo', callback_data: `am:${ctx.store.id}:same` }, { text: 'Es uno nuevo', callback_data: `am:${ctx.store.id}:new` }]],
      })
      return true
    }
  }
  // A price that does not fit the store, heard in a voice note: that number is confirmed on its own.
  const doubt = input.voice && description.price ? suspiciousPrice(description.price, catalog, name) : null
  const color = description.color || description.lines.find((line) => line.color)?.color || null
  const fields = {
    ...(name ? { name } : {}), ...(description.price && !doubt ? { price: description.price } : {}), ...(color ? { color } : {}),
    ...(description.lines.length ? { variants: description.lines.map((line) => ({ ...(line.size ? { size: line.size } : {}), stock: line.quantity, ...(line.color || color ? { color: line.color || color } : {}) })) } : {}),
    askFirst: 'price',
  }
  const sub = quiet(ctx)
  await beginProductDraft(sub, fields, text)
  let active = await getPendingProductDraft(ctx)
  if (!active) { await say(ctx, sub.capture.at(-1)?.text || 'No pude preparar el producto. Las fotos siguen guardadas; intenta de nuevo.'); return true }
  let stored = 0
  const next = quiet(ctx)
  await withProgress(ctx, `Estoy revisando ${photosWord(photos.length)}; ya te muestro el resumen.`, async () => {
    for (const [index, photo] of photos.entries()) {
      const latest = await getPendingProductDraft(ctx)
      if (!latest) break
      const one = quiet(ctx, index + 1)
      await receiveProductPhoto(one, latest, { photo: [{ file_id: photo.file_id }] } as unknown as TelegramMessage)
      const after = await getPendingProductDraft(ctx)
      if (after && after.draft.images.length > latest.draft.images.length) stored += 1
    }
    // The engine continues its own draft: it looks at the photos for what is still missing and asks the next thing.
    const ready = stored ? await getPendingProductDraft(ctx) : null
    if (ready) await handleProductDraftCallback(next, 'done', ready.operation.operation_id)
  })
  active = await getPendingProductDraft(ctx)
  if (!active || !stored) {
    if (active) await handleProductDraftCallback(quiet(ctx), 'cancel', active.operation.operation_id)
    await say(ctx, 'No pude usar esas fotos (formato o descarga). No se creó nada: envíalas otra vez como fotos y repíteme el producto.')
    await closePhotos(ctx, 'discarded')
    return true
  }
  await closePhotos(ctx, 'used', active.operation.operation_id)
  await saveMedia(ctx, null)

  active = (await getPendingProductDraft(ctx)) || active
  const draft = active.draft
  const sizes = sizesPhrase(draft.variants)
  const understood = [draft.fields.name ? `<b>${escapeHtml(draft.fields.name)}</b>` : '', sizes, draft.fields.price ? `a ${formatMoney(draft.fields.price, ctx.store.currency)}` : ''].filter(Boolean).join(', ')
  const skipped = photos.length - stored
  const head = `${input.voice ? 'Listo, entendí' : 'Listo'}: ${understood || 'producto nuevo'}, con ${photosWord(stored)}${skipped ? ` (${skipped} no se ${skipped === 1 ? 'pudo' : 'pudieron'} usar)` : ''}. Nada se publica todavía.`
  if (doubt && description.price) {
    await saveMedia(ctx, { ask: { kind: 'price_confirm', price: description.price, operationId: active.operation.operation_id } })
    await say(ctx, `${head}\nEl precio lo escuché como <b>${formatMoney(description.price, ctx.store.currency)}</b>. ¿Es ese, o son ${formatMoney(doubt, ctx.store.currency)}?`)
    return true
  }
  // One message: what was understood, then the engine's next step (its question, or the preview to publish).
  const last = next.capture.filter((item) => item.text.trim() && !/Voy a analizarlas|Te preparé esta propuesta/.test(item.text)).at(-1)
  if (last?.photo) {
    await say(ctx, head)
    await sayPhoto(ctx, last.photo, last.text, last.markup)
  } else {
    await say(ctx, `${head}${oddSize ? `\nLa talla la escuché como «${escapeHtml(oddSize)}» y no me cuadra.` : ''}${last ? `\n\n${friendlyPrompt(last.text, draft)}` : ''}`, last?.markup)
  }
  return true
}

/** The engine's question in the short form of this layer (one thing at a time, never what was already said). */
function friendlyPrompt(text: string, draft: TelegramProductDraft): string {
  if (/¿Qué precio deseas colocar\?/.test(text)) return '¿A qué precio lo publico?'
  if (/¿Cuántas unidades tienes/.test(text)) return draft.variants.length ? `¿Cuántas unidades hay por talla (${draft.variants.map((variant) => variant.size).filter(Boolean).join(', ')})?` : '¿Qué tallas hay y cuántas unidades de cada una?'
  if (/¿Cómo se llama el producto\?/.test(text)) return '¿Cómo se llama el producto?'
  return text
}

// ───────────────────────── Borrador abierto: correcciones naturales ─────────────────────────

/**
 * Natural corrections while a draft is open, before the engine's own handling: «cambia el precio a 170 mil»,
 * «del 38 al 42, cinco de cada una», «quita la tercera», «listo» after the photos. Nothing is saved to the catalogue.
 */
export async function handleAgentDraftText(ctx: AssistantContext, active: PendingProductDraft, text: string, options: { voice?: boolean } = {}): Promise<boolean> {
  if (!mediaEnabled(ctx)) return false
  const started = Date.now()
  const lower = fold(text.trim())
  const draft = active.draft
  const media = await readMedia(ctx)
  if (media.ask?.kind === 'price_confirm') {
    const handled = await answerAsk(ctx, media.ask, text)
    if (handled) { await measure(ctx, started, handled, 'price_confirm'); return true }
  }
  // A request about a product the store already has is not a correction of this draft.
  const parsed = parseCommerce(text)
  if (parsed && parsed.kind !== 'create_product' && parsed.kind !== 'correction' && 'product' in parsed && parsed.product
    && resolveProduct(await loadCatalog(ctx), parsed.product, {}, null).kind === 'one') return false
  const awaiting = draft.editField || draft.awaiting
  // Photos are in and the merchant says so with words instead of the button.
  if (!awaiting && draft.images.length && draft.stage !== 'ready' && /^(?:listo|ya|eso es todo|son todas|esas son|termin[eé]|no hay mas|ya estan)[.! ]*$/.test(lower)) {
    await handleProductDraftCallback(ctx, 'done', active.operation.operation_id)
    await measure(ctx, started, 'borrador_ajustar', 'photos_done')
    return true
  }
  const next = structuredClone(draft)
  const changes: string[] = []
  // The name the merchant dictates replaces any suggested one (it is theirs to decide; nothing is published yet).
  const renamed = awaiting === 'name' ? null : nameIn(text)
  if (renamed) {
    next.fields.name = renamed
    next.aiSuggested = (next.aiSuggested || []).filter((field) => field !== 'name')
    changes.push(`nombre «${escapeHtml(renamed)}»`)
  }

  const photo = lower.match(/\b(?:quita|quitar|elimina|borra|saca)\s+(?:la\s+)?(?:foto\s+)?(?:numero\s+)?(\d{1,2}|primera|segunda|tercera|cuarta|quinta|ultima)(?:\s+foto)?\b/)
    || (/\besa foto (?:es de otro producto|no es|no va)\b/.test(lower) ? ['', 'ultima'] : null)
  if (photo) {
    const words: Record<string, number> = { primera: 1, segunda: 2, tercera: 3, cuarta: 4, quinta: 5 }
    const index = photo[1] === 'ultima' ? next.images.length - 1 : (Number(photo[1]) || words[photo[1]!] || 0) - 1
    if (!next.images[index]) { await say(ctx, `Ese producto tiene ${next.images.length} ${next.images.length === 1 ? 'foto' : 'fotos'}; dime cuál quito (por ejemplo «quita la 2»).`); return true }
    if (next.images.length === 1) { await say(ctx, 'Es la única foto del producto; si la quito queda sin imagen. Envíame otra primero.'); return true }
    const [removed] = next.images.splice(index, 1)
    if (next.primaryImageIndex >= next.images.length || next.primaryImageIndex === index) next.primaryImageIndex = 0
    if (removed && ctx.env.ASSETS) await ctx.env.ASSETS.delete(removed.tempKey).catch(() => undefined)
    changes.push(`quité la foto ${index + 1} (quedan ${next.images.length})`)
  }
  const wantsPrice = /\b(?:precio|vale|valen|cuesta|cuestan|cobr\w+)\b/.test(lower) || (awaiting === 'price' && MONEY_HINT.test(text))
  if (!photo && wantsPrice && (awaiting !== 'price' || parseStockLines(text).lines.length)) {
    const price = MONEY_HINT.test(text) ? parseMoney(text) : (() => { const bare = text.match(/\b(\d{2,3})\b(?!\s*(?:pares|unidades|de cada))/); return bare ? Number(bare[1]) * 1000 : null })()
    if (price && price >= 1000 && price < 1_000_000_000) { next.fields.price = price; changes.push(`precio ${formatMoney(price, ctx.store.currency)}`) }
  }
  const lines = stockLinesOf(text)
  if (!photo && lines.length && lines.some((line) => line.size) && (awaiting !== 'variants')) {
    const color = next.defaultColor || next.variants.find((variant) => variant.color)?.color
    next.variants = lines.slice(0, 80).map((line) => ({ ...(line.size ? { size: String(line.size).slice(0, 24) } : {}), ...(line.color || color ? { color: String(line.color || color).slice(0, 48) } : {}), stock: line.quantity }))
    changes.push(sizesPhrase(next.variants))
  }
  if (!changes.length) return false
  if (awaiting === 'price' && next.fields.price) delete next.awaiting
  const saved = await saveProductDraft(ctx, active.operation, next)
  if (!saved) { await say(ctx, 'El borrador cambió mientras escribías. Revisa el último mensaje y vuelve a intentarlo.'); return true }
  await say(ctx, `${options.voice ? 'Entendí' : 'Corregido'}: ${changes.join(' · ')}. Nada se publicó todavía.`)
  await promptProductDraft(ctx, saved, next)
  await measure(ctx, started, 'borrador_ajustar', 'corrected')
  return true
}

/** Photos sent to an open draft: one line for the first of the burst, silence for the rest (never one message per photo). */
export async function receiveDraftPhotoQuietly(ctx: AssistantContext, active: PendingProductDraft, message: TelegramMessage): Promise<boolean> {
  if (!mediaEnabled(ctx)) return false
  const sub = quiet(ctx)
  await receiveProductPhoto(sub, active, message)
  const said = sub.capture.at(-1)
  if (!said) return true
  const received = /^📸 Recibí/.test(said.text)
  if (!received) { await say(ctx, said.text, said.markup); return true }
  const count = (await getPendingProductDraft(ctx))?.draft.images.length || 0
  if (count <= 1) await say(ctx, '📸 Recibí la foto. Envía las demás si hay y, cuando termines, escribe «listo».', said.markup)
  return true
}

export async function handleAgentMediaCallback(ctx: AssistantContext, data: string): Promise<boolean> {
  const match = data.match(/^am:(\d+):(same|new)$/)
  if (!match || Number(match[1]) !== ctx.store.id || !mediaEnabled(ctx)) return false
  const media = await readMedia(ctx)
  if (media.ask?.kind !== 'same_or_new') { await say(ctx, 'Eso ya no está pendiente.'); return true }
  await answerAsk(ctx, media.ask, match[2] === 'same' ? 'es el mismo' : 'es uno nuevo')
  return true
}
