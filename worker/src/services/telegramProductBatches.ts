import type { AssistantContext } from './assistant/context'
import type { TelegramMessage } from './assistant/telegramApi'
import { say } from './assistant/context'
import { escapeHtml, formatMoney } from './assistant/tools'
import { roleAllows } from '../tenancy/access'
import { adminStoreUrl, publicStoreUrl, slugify } from '../tenancy/stores'
import { applyTelegramProductBatchItem, createCatalogCategory, productLimit } from './business'
import { downloadTelegramImage, storeTelegramDraftImage } from './telegramProductImages'
import { bytesToBase64, sendChatAction } from './assistant/telegramApi'
import { suggestProductFromPhotos } from '../ai/productVision'
import { creditSummary, runWithCredits } from '../ai/credits'

export const DEFAULT_TELEGRAM_BATCH_LIMIT = 100
export const DEFAULT_TELEGRAM_BATCH_MAX_BYTES = 200 * 1024 * 1024
const ACTIVE_BATCH_STATES = "'receiving','analyzing','needs_review','ready_to_publish','publishing','partially_published'"

export type TelegramBatch = {
  id: string; store_id: number; chat_id: string; telegram_user_id: string; status: string; max_items: number; max_bytes: number
  created_at: string; updated_at: string; completed_at: string | null
}
export type TelegramBatchItem = {
  id: number; batch_id: string; store_id: number; telegram_message_id: number; update_id: number; media_group_id: string | null
  telegram_file_id: string; telegram_file_unique_id: string | null; position: number; temp_key: string; content_type: string; extension: string
  name: string | null; description: string | null; price: number | null; category_id: number | null; category_name: string | null
  size: string | null; color: string | null; stock: number | null; sku: string | null; status: string
  validation_errors: string; warnings: string; product_id: number | null; created_at: string; updated_at: string
}

function clean(value: string, max = 500): string {
  return value.normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
}

function parseMoney(text: string): number | null {
  const match = text.match(/(?:precio|vale|cuesta|por)\s*:?\s*\$?\s*(\d{1,3}(?:[.,]\d{3})+|\d+)/i)
    || text.match(/\$\s*(\d{1,3}(?:[.,]\d{3})+|\d+)/)
  if (!match?.[1]) return null
  const amount = Number(match[1].replace(/[.,]/g, ''))
  return Number.isSafeInteger(amount) && amount >= 0 && amount <= 10_000_000_000 ? amount : null
}

/** Extract only explicit commercial facts. Prices, stock and size are never inferred from the image. */
export function parseTelegramProductCaption(raw: string, allowBarePrice = false): { name: string | null; description: string | null; price: number | null; stock: number | null; size: string | null; color: string | null; categoryName: string | null; sku: string | null } {
  const text = clean(raw, 1000)
  const stockMatch = text.match(/(?:^|[,;\s])(?:cantidad\s*:?\s*)?(\d{1,7})\s*(?:unidad(?:es)?|uds?\.?|u\b)/i)
  const sizeMatch = text.match(/\b(?:talla|talle|size)\s*[:#-]?\s*([a-z0-9.-]{1,16})/i)
  let price = parseMoney(text)
  let barePriceMatch: RegExpMatchArray | null = null
  if (price === null && allowBarePrice) {
    const candidates = [...text.matchAll(/\b(\d{4,12})\b/g)]
    barePriceMatch = candidates.find((candidate) => candidate[1] !== stockMatch?.[1] && candidate[1] !== sizeMatch?.[1]) || null
    const amount = barePriceMatch?.[1] ? Number(barePriceMatch[1]) : NaN
    if (Number.isSafeInteger(amount) && amount <= 10_000_000_000) price = amount
  }
  const colorMatch = text.match(/\b(?:color)\s*[:#-]?\s*([\p{L} -]{2,40}?)(?=\s*(?:,|;|\bprecio\b|\bvale\b|\bcuesta\b|\b\d+\s*(?:unidad(?:es)?|uds?\.?|u\b))|$)/iu)
  const descriptionMatch = text.match(/\b(?:descripci[oó]n|detalle)\s*:?\s*(.+?)(?=\s*(?:[,;]\s*)?(?:categor[ií]a|precio|vale|cuesta|cantidad|talla|talle|color|sku|c[oó]digo)\b|$)/i)
  const explicitName = text.match(/\bnombre\s*:?\s*(.+?)(?=\s*(?:[,;]\s*)?(?:descripci[oó]n|detalle|precio|vale|cuesta|cantidad|talla|talle|color|sku|c[oó]digo)\b|$)/i)
  const categoryMatch = text.match(/\bcategor[ií]a\s*:?\s*([\p{L}\d &-]{2,80}?)(?=\s*(?:[,;]\s*)?(?:descripci[oó]n|detalle|precio|vale|cuesta|cantidad|talla|talle|color|sku|c[oó]digo)\b|$)/iu)
  const skuMatch = text.match(/\b(?:sku|c[oó]digo|referencia)\s*[:#-]?\s*([A-Z0-9][A-Z0-9._/-]{1,63})/i)
  const stock = stockMatch ? Number(stockMatch[1]) : null
  const size = sizeMatch?.[1] ? clean(sizeMatch[1], 20) : null
  const color = colorMatch?.[1] ? clean(colorMatch[1], 40) : null
  const name = clean(explicitName?.[1] || text
    .replace(/\b(?:descripci[oó]n|detalle)\s*:?\s*.+?(?=\s*(?:[,;]\s*)?(?:categor[ií]a|precio|vale|cuesta|cantidad|talla|talle|color|sku|c[oó]digo)\b|$)/i, ' ')
    .replace(/\bcategor[ií]a\s*:?\s*[\p{L}\d &-]{2,80}(?=\s*(?:[,;]\s*)?(?:descripci[oó]n|detalle|precio|vale|cuesta|cantidad|talla|talle|color|sku|c[oó]digo)\b|$)/iu, ' ')
    .replace(/\b(?:sku|c[oó]digo|referencia)\s*[:#-]?\s*[A-Z0-9][A-Z0-9._/-]{1,63}/i, ' ')
    .replace(/\b(?:talla|talle|size)\s*[:#-]?\s*[a-z0-9.-]{1,16}/i, ' ')
    .replace(/\bcolor\s*[:#-]?\s*[\p{L} -]{2,40}(?=\s*(?:,|;|\bprecio\b|\bvale\b|\bcuesta\b|\b\d+\s*(?:unidad(?:es)?|uds?\.?|u\b))|$)/iu, ' ')
    .replace(/(?:precio|vale|cuesta|por)\s*:?\s*\$?\s*\d{1,3}(?:[.,]\d{3})+|(?:precio|vale|cuesta|por)\s*:?\s*\$?\s*\d+/i, ' ')
    .replace(/\$\s*\d{1,3}(?:[.,]\d{3})+|\$\s*\d+/g, ' ')
    .replace(/\b(?:cantidad\s*:?\s*)?\d{1,7}\s*(?:unidad(?:es)?|uds?\.?|u\b)/i, ' ')
    .replace(barePriceMatch?.[0] || /$^/, ' ')
    .replace(/[,;]+/g, ' '), 160)
  return {
    name: name || null,
    description: descriptionMatch?.[1] ? clean(descriptionMatch[1], 2000) : null,
    price,
    stock: stock !== null && Number.isSafeInteger(stock) && stock <= 1_000_000 ? stock : null,
    size,
    color,
    categoryName: categoryMatch?.[1] ? clean(categoryMatch[1], 80) : null,
    sku: skuMatch?.[1] ? clean(skuMatch[1], 64).toUpperCase() : null,
  }
}

function itemErrors(item: Pick<TelegramBatchItem, 'name' | 'price' | 'stock'>): string[] {
  const errors: string[] = []
  if (!item.name?.trim()) errors.push('Falta el nombre')
  if (item.price === null || !Number.isSafeInteger(item.price) || item.price < 0) errors.push('Falta el precio')
  if (item.stock === null || !Number.isSafeInteger(item.stock) || item.stock < 0) errors.push('Falta la cantidad inicial')
  return errors
}

async function listItems(ctx: AssistantContext, batchId: string): Promise<TelegramBatchItem[]> {
  const result = await ctx.db.prepare('SELECT * FROM telegram_product_batch_items WHERE batch_id = ? AND store_id = ? ORDER BY position, id')
    .bind(batchId, ctx.store.id).all<TelegramBatchItem>()
  return result.results || []
}

export async function activeTelegramBatch(ctx: AssistantContext): Promise<TelegramBatch | null> {
  return ctx.db.prepare(`SELECT * FROM telegram_product_batches WHERE chat_id = ? AND store_id = ? AND status IN (${ACTIVE_BATCH_STATES}) ORDER BY created_at DESC LIMIT 1`)
    .bind(String(ctx.chatId), ctx.store.id).first<TelegramBatch>()
}

async function isTelegramBatchEnabled(ctx: AssistantContext): Promise<boolean> {
  const feature = await ctx.db.prepare('SELECT telegram_bulk_import_enabled AS enabled FROM stores WHERE id = ?')
    .bind(ctx.store.id).first<{ enabled: number }>()
  return Number(feature?.enabled) === 1
}

async function explainTelegramBatchDisabled(ctx: AssistantContext): Promise<void> {
  await say(ctx, 'La importación masiva por Telegram está desactivada para esta tienda. La administración de la plataforma puede habilitarla desde su configuración.')
}

export async function startTelegramBatch(ctx: AssistantContext): Promise<void> {
  if (!roleAllows(ctx.role, 'admin')) { await say(ctx, 'Tu rol no permite publicar productos. Pídeselo al propietario o a un administrador.'); return }
  if (!await isTelegramBatchEnabled(ctx)) { await explainTelegramBatchDisabled(ctx); return }
  const active = await activeTelegramBatch(ctx)
  if (active?.status === 'receiving') {
    const count = await ctx.db.prepare('SELECT COUNT(*) AS n FROM telegram_product_batch_items WHERE batch_id = ?').bind(active.id).first<{ n: number }>()
    await say(ctx, `Ya tienes un lote abierto con ${Number(count?.n || 0)} foto(s). Sigue enviándolas o escribe /listo para revisar.`)
    return
  }
  if (active) { await showTelegramBatch(ctx, active.id, 0); return }
  const pendingSingle = await ctx.db.prepare(`SELECT action FROM telegram_operations WHERE chat_id = ? AND status IN ('pending','applying') LIMIT 1`).bind(String(ctx.chatId)).first<{ action: string }>()
  if (pendingSingle) { await say(ctx, 'Tienes otra operación de Telegram pendiente. Complétala o escribe /cancelar antes de iniciar un lote.'); return }
  const limit = await productLimit(ctx.db, ctx.store.id)
  const remaining = limit.max === null ? DEFAULT_TELEGRAM_BATCH_LIMIT : Math.max(0, limit.max - limit.count)
  const configured = Number(ctx.env.TELEGRAM_BATCH_MAX_ITEMS || DEFAULT_TELEGRAM_BATCH_LIMIT)
  const backendMax = Number.isSafeInteger(configured) && configured > 0 ? Math.min(configured, 500) : DEFAULT_TELEGRAM_BATCH_LIMIT
  const configuredBytes = Number(ctx.env.TELEGRAM_BATCH_MAX_BYTES || DEFAULT_TELEGRAM_BATCH_MAX_BYTES)
  const maxBytes = Number.isSafeInteger(configuredBytes) && configuredBytes > 0 ? Math.min(configuredBytes, 1024 * 1024 * 1024) : DEFAULT_TELEGRAM_BATCH_MAX_BYTES
  const maxItems = Math.min(remaining, backendMax)
  if (maxItems < 1) { await say(ctx, `Tu plan ${escapeHtml(limit.plan || '')} alcanzó el máximo de ${limit.max ?? 0} productos. Ajusta tu plan desde el panel antes de importar más.`); return }
  const id = crypto.randomUUID()
  try {
    await ctx.db.prepare('INSERT INTO telegram_product_batches (id, store_id, chat_id, telegram_user_id, max_items, max_bytes) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, ctx.store.id, String(ctx.chatId), ctx.telegramUserId, maxItems, maxBytes).run()
  } catch (error) {
    if (error instanceof Error && /unique constraint/i.test(error.message)) { await say(ctx, 'Ya hay un lote activo para esta conversación. Escribe /listo para revisarlo o /cancelar para detenerlo.'); return }
    throw error
  }
  await ctx.db.prepare(`INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id) VALUES ('telegram_product_batch_started', 'telegram_product_batch', ?, ?, ?, 'telegram', ?)`)
    .bind(id, JSON.stringify({ maxItems }), `telegram:${ctx.telegramUserId}`, ctx.store.id).run()
  await say(ctx, `Vamos a cargar varios productos a tu tienda.\n\nEnvíame una fotografía por cada artículo. Puedes enviar varias fotografías juntas o por separado.\n\nCuando termines, escribe /listo.\n\nSi necesitas detener el proceso, escribe /cancelar.\n\nLímite disponible para este lote: ${maxItems} productos.`)
}

export async function receiveTelegramBatchPhoto(ctx: AssistantContext, message: TelegramMessage): Promise<boolean> {
  const batch = await activeTelegramBatch(ctx)
  if (!batch) return false
  if (!await isTelegramBatchEnabled(ctx)) { await explainTelegramBatchDisabled(ctx); return true }
  if (batch.status !== 'receiving') { await say(ctx, 'Este lote ya cerró la recepción de fotos. Corrige los productos pendientes o publica desde /publicar; /cancelar lo detiene.'); return true }
  if (!roleAllows(ctx.role, 'admin')) { await say(ctx, 'Tu rol no permite cargar productos.'); return true }
  const fileId = message.photo?.at(-1)?.file_id || message.document?.file_id
  if (!fileId) { await say(ctx, 'No pude leer esta imagen. Envía una foto JPG, PNG o WebP.'); return true }
  const document = message.document
  if (document && (!document.mime_type?.startsWith('image/') || !/\.(jpe?g|png|webp)$/i.test(document.file_name || ''))) {
    await say(ctx, 'Ese archivo no es compatible. Envía una imagen JPG, PNG o WebP.'); return true
  }
  const duplicate = await ctx.db.prepare('SELECT id FROM telegram_product_batch_items WHERE batch_id = ? AND (telegram_message_id = ? OR (? IS NOT NULL AND telegram_file_unique_id = ?)) LIMIT 1')
    .bind(batch.id, message.message_id, message.photo?.at(-1)?.file_unique_id || document?.file_unique_id || null, message.photo?.at(-1)?.file_unique_id || document?.file_unique_id || null).first()
  if (duplicate) { await say(ctx, 'Ya recibí ese mismo archivo en este lote y lo omití para evitar un duplicado técnico.'); return true }
  const countRow = await ctx.db.prepare('SELECT COUNT(*) AS n FROM telegram_product_batch_items WHERE batch_id = ?').bind(batch.id).first<{ n: number }>()
  const currentCount = Number(countRow?.n || 0)
  if (currentCount >= batch.max_items) { await say(ctx, `Este lote llegó a su límite de ${batch.max_items} productos. Escribe /listo para revisarlo.`); return true }
  if (!ctx.env.ASSETS) { await say(ctx, 'El almacenamiento de imágenes no está disponible. No guardé la foto.'); return true }
  let image
  try {
    image = await downloadTelegramImage(ctx.botToken, fileId)
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    const messageText = code === 'TELEGRAM_IMAGE_TOO_LARGE' ? 'La imagen supera el límite de 20 MB.'
      : code === 'TELEGRAM_IMAGE_FORMAT_UNSUPPORTED' ? 'Usa una imagen JPG, PNG o WebP.'
        : 'No pude validar o descargar esta foto. Envíala de nuevo como imagen.'
    await say(ctx, `${messageText} No agregué este producto al lote.`)
    return true
  }
  const bytesRow = await ctx.db.prepare('SELECT COALESCE(SUM(byte_length), 0) AS total FROM telegram_product_batch_items WHERE batch_id = ?').bind(batch.id).first<{ total: number }>()
  if (Number(bytesRow?.total || 0) + image.bytes.byteLength > batch.max_bytes) {
    await say(ctx, `Este lote llegó a su límite de almacenamiento (${Math.round(batch.max_bytes / 1024 / 1024)} MB). Escribe /listo para revisar las fotos recibidas.`)
    return true
  }
  const stored = await storeTelegramDraftImage(ctx.env.ASSETS, batch.id, image, fileId)
  const fields = parseTelegramProductCaption(message.caption || '')
  const category = fields.categoryName ? await ctx.db.prepare('SELECT id, name FROM categories WHERE store_id = ? AND is_active = 1 AND lower(name) = lower(?) LIMIT 1').bind(ctx.store.id, fields.categoryName).first<{ id: number; name: string }>() : null
  try {
    const inserted = await ctx.db.prepare(
      `INSERT OR IGNORE INTO telegram_product_batch_items
       (batch_id, store_id, telegram_message_id, update_id, media_group_id, telegram_file_id, telegram_file_unique_id, position, temp_key, content_type, extension, byte_length,
        name, description, price, stock, size, color, sku, category_id, category_name, status, validation_errors)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'needs_review', ?
       WHERE EXISTS (SELECT 1 FROM telegram_product_batches WHERE id = ? AND store_id = ? AND chat_id = ? AND status = 'receiving')
         AND (SELECT COUNT(*) FROM telegram_product_batch_items WHERE batch_id = ?) < ?
         AND (SELECT COALESCE(SUM(byte_length), 0) FROM telegram_product_batch_items WHERE batch_id = ?) + ? <= (SELECT max_bytes FROM telegram_product_batches WHERE id = ? AND store_id = ?)`,
    ).bind(batch.id, ctx.store.id, message.message_id, ctx.updateId, message.media_group_id || null, fileId,
      message.photo?.at(-1)?.file_unique_id || document?.file_unique_id || null, message.message_id, stored.tempKey,
      image.contentType, image.extension, image.bytes.byteLength, fields.name, fields.description, fields.price, fields.stock, fields.size, fields.color, fields.sku,
      category?.id || null, category?.name || fields.categoryName || null, JSON.stringify(['Falta el nombre', 'Falta el precio', 'Falta la cantidad inicial'].filter((error) => error === 'Falta el nombre' ? !fields.name : error === 'Falta el precio' ? fields.price === null : fields.stock === null)),
      batch.id, ctx.store.id, String(ctx.chatId), batch.id, batch.max_items, batch.id, image.bytes.byteLength, batch.id, ctx.store.id).run()
    if (Number(inserted.meta.changes || 0) !== 1) { await ctx.env.ASSETS.delete(stored.tempKey).catch(() => undefined); return true }
  } catch (error) {
    await ctx.env.ASSETS.delete(stored.tempKey).catch(() => undefined)
    throw error
  }
  const saved = await ctx.db.prepare('SELECT id FROM telegram_product_batch_items WHERE batch_id = ? AND telegram_message_id = ?').bind(batch.id, message.message_id).first()
  if (!saved) { await ctx.env.ASSETS.delete(stored.tempKey).catch(() => undefined); return true }
  const total = await ctx.db.prepare('SELECT COUNT(*) AS n FROM telegram_product_batch_items WHERE batch_id = ?').bind(batch.id).first<{ n: number }>()
  const n = Number(total?.n || 0)
  if (n === 1 || n % 10 === 0) await say(ctx, `Recibí ${n} foto(s), una por producto. Los álbumes se ordenan por su número de mensaje. Envía más o escribe /listo para revisar.`)
  return true
}

async function refreshItem(ctx: AssistantContext, item: TelegramBatchItem, fields: Partial<Pick<TelegramBatchItem, 'name' | 'price' | 'stock' | 'size' | 'color' | 'category_name' | 'description' | 'sku' | 'status'>>): Promise<void> {
  const next = { ...item, ...fields }
  const errors = itemErrors(next)
  const status = item.status === 'published' || item.status === 'ignored' ? item.status : (errors.length ? 'needs_review' : 'ready_to_publish')
  await ctx.db.prepare(
    `UPDATE telegram_product_batch_items SET name = ?, price = ?, stock = ?, size = ?, color = ?, category_name = ?, description = ?, sku = ?, status = ?, validation_errors = ?, updated_at = datetime('now')
     WHERE id = ? AND batch_id = ? AND store_id = ? AND status NOT IN ('published','ignored','publishing','analyzing')`,
  ).bind(next.name, next.price, next.stock, next.size, next.color, next.category_name, next.description, next.sku, status, JSON.stringify(errors), item.id, item.batch_id, ctx.store.id).run()
}

function parseListLines(text: string): Array<{ index: number; fields: ReturnType<typeof parseTelegramProductCaption> }> {
  return text.split(/\r?\n/).map((line) => {
    const match = line.trim().match(/^(\d{1,3})[.)\-:]\s*(.+)$/)
    return match ? { index: Number(match[1]), fields: parseTelegramProductCaption(match[2]!, true) } : null
  }).filter((item): item is { index: number; fields: ReturnType<typeof parseTelegramProductCaption> } => Boolean(item))
}

export async function handleTelegramBatchText(ctx: AssistantContext, text: string): Promise<boolean> {
  const batch = await activeTelegramBatch(ctx)
  if (!batch) return false
  if (!await isTelegramBatchEnabled(ctx)) { await explainTelegramBatchDisabled(ctx); return true }
  if (!roleAllows(ctx.role, 'admin')) { await say(ctx, 'Tu rol no permite revisar productos.'); return true }
  if (/^(?:sugiere|sugerir|analiza|analizar)(?:\s+(?:los|las|fotos|productos|con\s+ia))*[.!]*$/i.test(text.trim())) {
    await requestTelegramBatchAnalysis(ctx, batch.id)
    return true
  }
  if (/^(publica(?:r)? todos|guarda los productos|sube los art[ií]culos a mi cat[aá]logo|publica(?:r)? los que est[aá]n listos)[.!]*$/i.test(text.trim())) {
    await requestTelegramBatchPublish(ctx, batch.id)
    return true
  }
  const items = await listItems(ctx, batch.id)
  if (!items.length) { await say(ctx, 'Envíame una foto por producto y luego escribe /listo.'); return true }
  const lines = parseListLines(text)
  if (lines.length) {
    let changed = 0
    for (const line of lines) {
      const item = items[line.index - 1]
      if (!item || item.status === 'published' || item.status === 'ignored') continue
      await refreshItem(ctx, item, {
        name: line.fields.name || item.name, description: line.fields.description || item.description, price: line.fields.price ?? item.price, stock: line.fields.stock ?? item.stock,
        size: line.fields.size || item.size, color: line.fields.color || item.color, category_name: line.fields.categoryName || item.category_name, sku: line.fields.sku || item.sku,
      })
      changed++
    }
    await showTelegramBatch(ctx, batch.id, 0, `Apliqué ${changed} línea(s) de la lista por número de foto. Revisa el orden y completa los campos que faltan.`)
    return true
  }
  let match = text.match(/^(?:el\s+)?producto\s+(\d+)\s+(?:vale|cuesta|precio(?:\s+es)?)\s*:?\s*\$?\s*([\d.,]+)/i)
  if (match) {
    const index = Number(match[1]); const amount = Number(match[2]!.replace(/[.,]/g, ''))
    const item = items[index - 1]
    if (item && Number.isSafeInteger(amount) && amount >= 0 && amount <= 10_000_000_000) await refreshItem(ctx, item, { price: amount })
    await showTelegramBatch(ctx, batch.id, Math.floor((index - 1) / 8), `Actualicé el precio del producto ${index}.`); return true
  }
  match = text.match(/^(?:del\s+)?(\d+)\s*(?:al|a)\s*(\d+)\s+pon(?:les|les\s+la)?\s+categor[ií]a\s+(.+)$/i)
  if (match) {
    const first = Number(match[1]); const last = Number(match[2]); const name = clean(match[3]!, 80)
    if (first < 1 || last < first || last > items.length) { await say(ctx, 'Ese rango no coincide con las fotos del lote.'); return true }
    for (const item of items.slice(first - 1, last)) await refreshItem(ctx, item, { category_name: name })
    await showTelegramBatch(ctx, batch.id, Math.floor((first - 1) / 8), `Asignaré “${escapeHtml(name)}” a los productos ${first}–${last}. La categoría se guardará al publicar.`); return true
  }
  match = text.match(/^todos\s+los\s+productos\s+(?:tienen|con)\s+(\d+)\s+unidad(?:es)?$/i)
  if (match) {
    const stock = Number(match[1]); if (!Number.isSafeInteger(stock) || stock > 1_000_000) { await say(ctx, 'La cantidad debe ser un entero entre 0 y 1.000.000.'); return true }
    for (const item of items) await refreshItem(ctx, item, { stock })
    await showTelegramBatch(ctx, batch.id, 0, `Puse ${stock} unidades iniciales en todos los productos editables. No sumé existencias.`); return true
  }
  match = text.match(/^(?:el\s+)?producto\s+(\d+)\s+es\s+talla\s+([\p{L}\d.-]{1,16})$/iu)
  if (match) {
    const index = Number(match[1]); const item = items[index - 1]
    if (item) await refreshItem(ctx, item, { size: clean(match[2]!, 20) })
    await showTelegramBatch(ctx, batch.id, Math.floor((index - 1) / 8), `Actualicé la talla del producto ${index}.`); return true
  }
  match = text.match(/^(?:el\s+)?(?:producto\s+)?(\d+)\s+(?:no\s+lo\s+publiques|omitir|no publicar)$/i)
  if (match) {
    const item = items[Number(match[1]) - 1]
    if (item && item.status !== 'published') await ctx.db.prepare(`UPDATE telegram_product_batch_items SET status = 'ignored', updated_at = datetime('now') WHERE id = ? AND batch_id = ? AND store_id = ? AND product_id IS NULL`).bind(item.id, batch.id, ctx.store.id).run()
    await showTelegramBatch(ctx, batch.id, 0, `El producto ${match[1]} quedó excluido de esta publicación.`); return true
  }
  match = text.match(/^(?:corrige|cambia)\s+(?:el\s+)?nombre\s+(?:del\s+)?producto\s+(\d+)\s*(?:a|por|:)\s*(.+)$/i)
  if (match) {
    const index = Number(match[1]); const item = items[index - 1]
    if (item) await refreshItem(ctx, item, { name: clean(match[2]!, 160) })
    await showTelegramBatch(ctx, batch.id, Math.floor((index - 1) / 8), `Actualicé el nombre del producto ${index}.`); return true
  }
  await say(ctx, batch.status === 'receiving'
    ? 'Puedes enviar otra foto, mandar una lista numerada (1. nombre, precio 80000, 3 unidades) o escribir /listo para revisar.'
    : 'Puedo corregir precios, nombres, tallas, cantidades o asignar una categoría por rango. Ejemplo: “El producto 3 vale 85000”.')
  return true
}

export async function finishTelegramBatchReceiving(ctx: AssistantContext): Promise<void> {
  const batch = await activeTelegramBatch(ctx)
  if (batch && !await isTelegramBatchEnabled(ctx)) { await explainTelegramBatchDisabled(ctx); return }
  if (!batch || batch.status !== 'receiving') { if (batch) await showTelegramBatch(ctx, batch.id, 0); else await say(ctx, 'No hay un lote recibiendo fotos. Escribe /lote para comenzar.'); return }
  const items = await listItems(ctx, batch.id)
  if (!items.length) { await say(ctx, 'Aún no recibo fotos. Envíame una fotografía por producto y luego escribe /listo.'); return }
  let ready = 0
  for (const item of items) {
    const errors = itemErrors(item)
    const status = errors.length ? 'needs_review' : 'ready_to_publish'
    if (!errors.length) ready++
    await ctx.db.prepare('UPDATE telegram_product_batch_items SET status = ?, validation_errors = ?, updated_at = datetime(\'now\') WHERE id = ? AND batch_id = ? AND product_id IS NULL')
      .bind(status, JSON.stringify(errors), item.id, batch.id).run()
  }
  const status = ready === items.length ? 'ready_to_publish' : 'needs_review'
  await ctx.db.prepare('UPDATE telegram_product_batches SET status = ?, updated_at = datetime(\'now\') WHERE id = ? AND store_id = ? AND status = \'receiving\'')
    .bind(status, batch.id, ctx.store.id).run()
  await showTelegramBatch(ctx, batch.id, 0, `Recibí ${items.length} fotografía(s). Preparé ${items.length} productos:\n• ${ready} listos.\n• ${items.length - ready} requieren revisión.\n• 0 publicados.`)
}

export async function showTelegramBatch(ctx: AssistantContext, batchId: string, requestedPage = 0, lead = ''): Promise<void> {
  const batch = await ctx.db.prepare('SELECT * FROM telegram_product_batches WHERE id = ? AND store_id = ? AND chat_id = ? AND telegram_user_id = ?')
    .bind(batchId, ctx.store.id, String(ctx.chatId), ctx.telegramUserId).first<TelegramBatch>()
  if (!batch) { await say(ctx, 'No encontré ese lote en tu tienda.'); return }
  if (!await isTelegramBatchEnabled(ctx)) { await explainTelegramBatchDisabled(ctx); return }
  const items = await listItems(ctx, batchId)
  const pageSize = 8
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize))
  const page = Math.min(Math.max(0, requestedPage, 0), pageCount - 1)
  const visible = items.slice(page * pageSize, (page + 1) * pageSize)
  const ready = items.filter((item) => item.status === 'ready_to_publish').length
  const failed = items.filter((item) => item.status === 'failed').length
  const published = items.filter((item) => item.status === 'published').length
  const lines = await Promise.all(visible.map(async (item, offset) => {
    const index = page * pageSize + offset + 1
    const title = item.name ? escapeHtml(item.name) : '<i>Falta nombre</i>'
    const price = item.price === null ? '<i>falta precio</i>' : formatMoney(Number(item.price), ctx.store.currency)
    const stock = item.stock === null ? '<i>falta cantidad</i>' : `${item.stock} u.`
    const category = item.category_name ? ` · ${escapeHtml(item.category_name)}` : ''
    const errors = (() => { try { return JSON.parse(item.validation_errors) as string[] } catch { return [] } })()
    const sameName = item.name ? await ctx.db.prepare('SELECT sku FROM products WHERE store_id = ? AND is_archived = 0 AND lower(trim(name)) = lower(trim(?)) LIMIT 1')
      .bind(ctx.store.id, item.name).first<{ sku: string }>() : null
    const state = item.status === 'published' ? '✅ publicado' : item.status === 'ignored' ? '⏭ excluido' : item.status === 'failed' ? `❌ ${escapeHtml(errors[0] || 'falló')}` : errors.length ? `⚠️ ${escapeHtml(errors.join(', '))}` : '✅ listo'
    const duplicate = sameName ? `\n   ⚠️ Ya existe el mismo nombre con SKU ${escapeHtml(sameName.sku)}; confirma si es otra referencia.` : ''
    return `${index}. <b>${title}</b> · ${price} · ${stock}${category}\n   ${state}${duplicate}`
  }))
  const buttons: Array<Array<{ text: string; callback_data: string }>> = []
  if (page > 0 || page + 1 < pageCount) buttons.push([
    ...(page > 0 ? [{ text: '◀ Anterior', callback_data: `tb:page:${batchId}:${page - 1}` }] : []),
    ...(page + 1 < pageCount ? [{ text: 'Siguiente ▶', callback_data: `tb:page:${batchId}:${page + 1}` }] : []),
  ])
  if (ready) buttons.push([{ text: `✅ Publicar ${ready} listo(s)`, callback_data: `tb:publish:${batchId}` }])
  if (items.some((item) => item.status !== 'published' && item.status !== 'ignored' && (!item.name || !item.description || !item.category_name))) buttons.push([{ text: '✨ Sugerir datos con IA (opcional)', callback_data: `tb:suggest:${batchId}` }])
  if (batch.status === 'receiving') buttons.push([{ text: 'Cerrar recepción (/listo)', callback_data: `tb:finish:${batchId}` }])
  if (batch.status !== 'published' && batch.status !== 'cancelled') buttons.push([{ text: '✖ Cancelar lote', callback_data: `tb:cancel:${batchId}` }])
  const state = `Estado: ${escapeHtml(batch.status)} · ${items.length}/${batch.max_items} fotos · ${ready} listos · ${published} publicados${failed ? ` · ${failed} fallidos` : ''}`
  await say(ctx, `${lead ? `${escapeHtml(lead)}\n\n` : ''}<b>Importación desde Telegram</b>\n${state}\nPágina ${page + 1}/${pageCount}\n\n${lines.join('\n\n') || 'Aún no hay fotos.'}\n\n${batch.status === 'receiving' ? 'Una fotografía equivale a un producto. Envía más o escribe /listo.' : 'Corrige los datos pendientes por número y usa /publicar cuando estés listo.'}\n\nSi no enviaste un SKU, asignaré un código interno único al confirmar la publicación.`, buttons.length ? { inline_keyboard: buttons } : undefined)
}

export async function requestTelegramBatchPublish(ctx: AssistantContext, batchId?: string): Promise<void> {
  const batch = batchId ? await ctx.db.prepare('SELECT * FROM telegram_product_batches WHERE id = ? AND store_id = ? AND chat_id = ? AND telegram_user_id = ?')
    .bind(batchId, ctx.store.id, String(ctx.chatId), ctx.telegramUserId).first<TelegramBatch>() : await activeTelegramBatch(ctx)
  if (!batch) { await say(ctx, 'No hay un lote pendiente. Escribe /lote para comenzar.'); return }
  if (!await isTelegramBatchEnabled(ctx)) { await explainTelegramBatchDisabled(ctx); return }
  if (!roleAllows(ctx.role, 'admin')) { await say(ctx, 'Tu rol no permite publicar productos.'); return }
  if (batch.status === 'receiving') { await say(ctx, 'Primero cierra la recepción con /listo.'); return }
  const items = await listItems(ctx, batch.id)
  const ready = items.filter((item) => item.status === 'ready_to_publish')
  if (!ready.length) { await say(ctx, 'No hay productos listos para publicar. Completa nombre, precio y cantidad de los pendientes.'); await showTelegramBatch(ctx, batch.id); return }
  const limit = await productLimit(ctx.db, ctx.store.id)
  const space = limit.max === null ? ready.length : Math.max(0, limit.max - limit.count)
  const count = Math.min(space, ready.length)
  if (!count) { await say(ctx, `Tu plan alcanzó el límite de ${limit.max} productos. Cambia de plan desde el panel antes de publicar.`); return }
  await say(ctx, `Voy a publicar ${count} producto(s) listo(s) de ${items.length}. Se validará el plan y cada producto; los pendientes se conservarán para corregirlos.\n\n¿Confirmas esta publicación?`, {
    inline_keyboard: [[{ text: `✅ Confirmar ${count}`, callback_data: `tb:confirm:${batch.id}` }, { text: '✖ Cancelar', callback_data: `tb:page:${batch.id}:0` }]],
  })
}

function aiCandidates(items: TelegramBatchItem[]): TelegramBatchItem[] {
  return items.filter((item) => item.status !== 'published' && item.status !== 'ignored' && (!item.name || !item.description || !item.category_name))
}

/** AI is opt-in; show the estimate before any photo is sent to Gemini. */
export async function requestTelegramBatchAnalysis(ctx: AssistantContext, batchId?: string): Promise<void> {
  const batch = batchId ? await ctx.db.prepare('SELECT * FROM telegram_product_batches WHERE id = ? AND store_id = ? AND chat_id = ? AND telegram_user_id = ?')
    .bind(batchId, ctx.store.id, String(ctx.chatId), ctx.telegramUserId).first<TelegramBatch>() : await activeTelegramBatch(ctx)
  if (!batch) { await say(ctx, 'No hay un lote activo para analizar.'); return }
  if (!await isTelegramBatchEnabled(ctx)) { await explainTelegramBatchDisabled(ctx); return }
  if (!roleAllows(ctx.role, 'admin')) { await say(ctx, 'Tu rol no permite analizar ni publicar este lote.'); return }
  if (batch.status === 'receiving') { await say(ctx, 'Cierra primero la recepción con /listo.'); return }
  const candidates = aiCandidates(await listItems(ctx, batch.id))
  if (!candidates.length) { await say(ctx, 'Los productos ya tienen nombre, descripción y categoría. La IA no hace falta; revisa los datos y corrige lo necesario.'); return }
  if (!ctx.env.GEMINI_API_KEY) { await say(ctx, 'La IA no está configurada. Puedes continuar manualmente; no se inventarán precios, existencias, tallas ni SKU.'); return }
  const state = await ctx.db.prepare('SELECT ai_enabled AS enabled FROM stores WHERE id = ?').bind(ctx.store.id).first<{ enabled: number }>()
  if (!state?.enabled) { await say(ctx, 'La IA está desactivada para esta tienda. La importación manual sigue disponible.'); return }
  const cost = await ctx.db.prepare('SELECT credits, enabled FROM ai_credit_costs WHERE feature = ?').bind('foto_a_producto').first<{ credits: number; enabled: number }>()
  if (cost && !cost.enabled) { await say(ctx, 'El análisis de fotos está pausado por la plataforma. Puedes completar los datos manualmente.'); return }
  const balance = await creditSummary(ctx.db, ctx.store.id)
  const estimate = Number(cost?.credits || 0) * candidates.length
  if (estimate > balance.balance) {
    await say(ctx, `El análisis costaría aproximadamente ${estimate} créditos y tu saldo disponible es ${balance.balance}. No inicié el análisis. Puedes completar el lote manualmente o solicitar una recarga desde el panel.`)
    return
  }
  await say(ctx, `La IA puede sugerir nombre, categoría, descripción y color para ${candidates.length} foto(s). No propondrá precio, cantidad, talla ni SKU.\n\nCosto estimado: ${cost?.credits ? `${cost.credits} créditos por foto · ${estimate} en total · saldo ${balance.balance}` : 'se aplica el presupuesto mensual de IA'} .\n\nEl análisis se hará en grupos pequeños después de tu confirmación. ¿Continuamos?`, {
    inline_keyboard: [[{ text: `✨ Analizar primeras 3 de ${candidates.length}`, callback_data: `tb:analyze:${batch.id}` }, { text: 'Ahora no', callback_data: `tb:page:${batch.id}:0` }]],
  })
}

/** Process a bounded set per callback so a 50-photo lot never holds one webhook open for all analyses. */
export async function analyzeTelegramBatchNext(ctx: AssistantContext, batchId: string): Promise<void> {
  if (!roleAllows(ctx.role, 'admin')) { await say(ctx, 'Tu rol no permite analizar este lote.'); return }
  const batch = await ctx.db.prepare('SELECT * FROM telegram_product_batches WHERE id = ? AND store_id = ? AND chat_id = ? AND telegram_user_id = ?')
    .bind(batchId, ctx.store.id, String(ctx.chatId), ctx.telegramUserId).first<TelegramBatch>()
  if (!batch || !['needs_review', 'ready_to_publish', 'analyzing', 'partially_published'].includes(batch.status)) { await say(ctx, 'Ese lote no está disponible para análisis.'); return }
  if (!await isTelegramBatchEnabled(ctx)) { await explainTelegramBatchDisabled(ctx); return }
  if (!ctx.env.ASSETS || !ctx.env.GEMINI_API_KEY) { await say(ctx, 'La IA o el almacenamiento no están disponibles. Puedes seguir editando el lote manualmente.'); return }
  await ctx.db.prepare(`UPDATE telegram_product_batch_items SET status = 'needs_review', updated_at = datetime('now') WHERE batch_id = ? AND store_id = ? AND status = 'analyzing' AND updated_at < datetime('now','-30 minutes')`)
    .bind(batch.id, ctx.store.id).run()
  const state = await ctx.db.prepare('SELECT ai_enabled AS enabled FROM stores WHERE id = ?').bind(ctx.store.id).first<{ enabled: number }>()
  if (!state?.enabled) { await say(ctx, 'La IA está desactivada para esta tienda. La importación manual sigue disponible.'); return }
  const all = await listItems(ctx, batch.id)
  const candidates = aiCandidates(all).slice(0, 3)
  if (!candidates.length) { await showTelegramBatch(ctx, batch.id, 0, 'No quedan productos que necesiten sugerencias.'); return }
  const categoriesResult = await ctx.db.prepare('SELECT name FROM categories WHERE store_id = ? AND is_active = 1 ORDER BY sort_order, name LIMIT 40').bind(ctx.store.id).all<{ name: string }>()
  const categoryNames = (categoriesResult.results || []).map((row) => row.name)
  let analyzed = 0
  await ctx.db.prepare(`UPDATE telegram_product_batches SET status = 'analyzing', updated_at = datetime('now') WHERE id = ? AND store_id = ? AND status IN ('needs_review','ready_to_publish','partially_published','analyzing')`)
    .bind(batch.id, ctx.store.id).run()
  await sendChatAction(ctx.botToken, ctx.chatId)
  for (const item of candidates) {
    const claimed = await ctx.db.prepare(`UPDATE telegram_product_batch_items SET status = 'analyzing', updated_at = datetime('now') WHERE id = ? AND batch_id = ? AND store_id = ? AND status IN ('needs_review','ready_to_publish')`)
      .bind(item.id, batch.id, ctx.store.id).run()
    if (!claimed.meta.changes) continue
    try {
      const image = await ctx.env.ASSETS.get(item.temp_key)
      if (!image || image.customMetadata?.operationId !== batch.id) throw new Error('IMAGE_NOT_AVAILABLE')
      if (Number(image.size || 0) > 5 * 1024 * 1024) throw new Error('IMAGE_TOO_LARGE_FOR_AI')
      const bytes = new Uint8Array(await image.arrayBuffer())
      const run = await runWithCredits(ctx.db, ctx.env, {
        storeId: ctx.store.id, feature: 'foto_a_producto', key: `telegram-batch-${batch.id}-${item.id}`, actor: `telegram:${ctx.telegramUserId}`,
      }, () => suggestProductFromPhotos(ctx.env, fetch, [{ mimeType: item.content_type, data: bytesToBase64(bytes) }], { text: item.name || undefined, categories: categoryNames }))
      if (!run.ok) {
        const note = run.reason === 'error' ? run.message : run.message
        const errors = itemErrors(item)
        await ctx.db.prepare(`UPDATE telegram_product_batch_items SET status = ?, warnings = ?, validation_errors = ?, updated_at = datetime('now') WHERE id = ? AND status = 'analyzing'`)
          .bind(errors.length ? 'needs_review' : 'ready_to_publish', JSON.stringify([note]), JSON.stringify(errors), item.id).run()
        continue
      }
      const suggestion = run.value
      const existingCategory = suggestion.category ? categoryNames.find((name) => slugify(name) === slugify(suggestion.category)) : undefined
      const proposed = {
        ...item,
        name: item.name || suggestion.name,
        description: item.description || suggestion.description,
        category_name: item.category_name || existingCategory || (suggestion.category || null),
        color: item.color || suggestion.colors[0] || null,
      }
      const errors = itemErrors(proposed)
      const warnings = suggestion.isProductPhoto ? [] : ['La IA no reconoció un producto en esta imagen; revisa la sugerencia.']
      await ctx.db.prepare(
        `UPDATE telegram_product_batch_items SET name = ?, description = ?, category_name = ?, color = ?, status = ?, validation_errors = ?, warnings = ?, updated_at = datetime('now') WHERE id = ? AND batch_id = ? AND status = 'analyzing'`,
      ).bind(proposed.name, proposed.description, proposed.category_name, proposed.color, errors.length ? 'needs_review' : 'ready_to_publish', JSON.stringify(errors), JSON.stringify(warnings), item.id, batch.id).run()
      analyzed++
    } catch (error) {
      const errors = itemErrors(item)
      const note = error instanceof Error && error.message === 'IMAGE_TOO_LARGE_FOR_AI' ? 'La imagen supera 5 MB para el análisis IA.' : 'La IA no pudo analizar esta foto; completa los campos manualmente.'
      await ctx.db.prepare(`UPDATE telegram_product_batch_items SET status = ?, warnings = ?, validation_errors = ?, updated_at = datetime('now') WHERE id = ? AND status = 'analyzing'`)
        .bind(errors.length ? 'needs_review' : 'ready_to_publish', JSON.stringify([note]), JSON.stringify(errors), item.id).run()
    }
  }
  const latest = await listItems(ctx, batch.id)
  const more = aiCandidates(latest).length > 0
  const finalStatus = latest.some((item) => item.status === 'published') ? 'partially_published' : latest.some((item) => item.status === 'needs_review') ? 'needs_review' : 'ready_to_publish'
  await ctx.db.prepare('UPDATE telegram_product_batches SET status = ?, updated_at = datetime(\'now\') WHERE id = ? AND store_id = ? AND status = \'analyzing\'')
    .bind(finalStatus, batch.id, ctx.store.id).run()
  const markup = more ? { inline_keyboard: [[{ text: '✨ Analizar siguientes 3 fotos', callback_data: `tb:analyze:${batch.id}` }]] } : undefined
  await say(ctx, `La IA procesó ${analyzed} foto(s). Los datos comerciales que faltan siguen pendientes y nunca se inventan. ${more ? 'Puedes pedir el siguiente grupo o corregir manualmente.' : 'Ya revisé todas las fotos que necesitaban sugerencias.'}`, markup)
  await showTelegramBatch(ctx, batch.id, 0)
}

export async function publishTelegramBatch(ctx: AssistantContext, batchId: string): Promise<void> {
  if (!roleAllows(ctx.role, 'admin')) { await say(ctx, 'Tu rol no permite publicar productos.'); return }
  let batch = await ctx.db.prepare('SELECT * FROM telegram_product_batches WHERE id = ? AND store_id = ? AND chat_id = ? AND telegram_user_id = ?')
    .bind(batchId, ctx.store.id, String(ctx.chatId), ctx.telegramUserId).first<TelegramBatch>()
  if (!batch) { await say(ctx, 'Ese lote ya no está disponible.'); return }
  if (!await isTelegramBatchEnabled(ctx)) { await explainTelegramBatchDisabled(ctx); return }
  if (batch.status === 'published' || batch.status === 'cancelled') { await showTelegramBatch(ctx, batch.id); return }
  if (batch.status === 'publishing' && batch.updated_at < new Date(Date.now() - 30 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ')) {
    await ctx.db.prepare(`UPDATE telegram_product_batch_items SET status = 'ready_to_publish', updated_at = datetime('now') WHERE batch_id = ? AND store_id = ? AND status = 'publishing' AND product_id IS NULL`)
      .bind(batch.id, ctx.store.id).run()
    await ctx.db.prepare(`UPDATE telegram_product_batches SET status = 'partially_published', updated_at = datetime('now') WHERE id = ? AND store_id = ? AND status = 'publishing'`)
      .bind(batch.id, ctx.store.id).run()
    batch = await ctx.db.prepare('SELECT * FROM telegram_product_batches WHERE id = ? AND store_id = ? AND chat_id = ? AND telegram_user_id = ?')
      .bind(batchId, ctx.store.id, String(ctx.chatId), ctx.telegramUserId).first<TelegramBatch>()
    if (!batch) { await say(ctx, 'Ese lote ya no está disponible.'); return }
  }
  if (batch.status === 'receiving' || batch.status === 'publishing') { await say(ctx, 'El lote todavía no está listo o ya está publicándose.'); return }
  if (!ctx.env.ASSETS) { await say(ctx, 'El almacenamiento de imágenes no está disponible. No publiqué productos.'); return }
  await ctx.db.prepare(`UPDATE telegram_product_batches SET status = 'publishing', updated_at = datetime('now') WHERE id = ? AND store_id = ? AND chat_id = ? AND status IN ('needs_review','ready_to_publish','partially_published')`)
    .bind(batch.id, ctx.store.id, String(ctx.chatId)).run()
  await say(ctx, 'Estoy publicando los productos listos uno por uno. Si uno falla, los demás pueden completarse igual.')
  const items = (await listItems(ctx, batch.id)).filter((item) => item.status === 'ready_to_publish')
  let created = 0
  for (const item of items) {
    if (!await isTelegramBatchEnabled(ctx)) break
    const limit = await productLimit(ctx.db, ctx.store.id)
    if (limit.max !== null && limit.count >= limit.max) {
      await ctx.db.prepare(`UPDATE telegram_product_batch_items SET status = 'failed', validation_errors = ?, updated_at = datetime('now') WHERE id = ? AND status = 'ready_to_publish'`)
        .bind(JSON.stringify(['Se alcanzó el límite de productos del plan']), item.id).run()
      continue
    }
    const sku = item.sku || `TG-${batch.id.replace(/-/g, '').slice(0, 8).toUpperCase()}-${item.position}`
    const existing = await ctx.db.prepare('SELECT id FROM products WHERE store_id = ? AND upper(sku) = upper(?)').bind(ctx.store.id, sku).first()
    if (existing) {
      await ctx.db.prepare(`UPDATE telegram_product_batch_items SET status = 'failed', sku = ?, validation_errors = ?, updated_at = datetime('now') WHERE id = ? AND status = 'ready_to_publish'`)
        .bind(sku, JSON.stringify(['El SKU generado ya existe en esta tienda']), item.id).run()
      continue
    }
    const categoryName = item.category_name ? clean(item.category_name, 80) : null
    let categoryId: number | null = item.category_id
    if (categoryName) {
      const found = await ctx.db.prepare('SELECT id FROM categories WHERE store_id = ? AND lower(name) = lower(?) AND is_active = 1 LIMIT 1').bind(ctx.store.id, categoryName).first<{ id: number }>()
      if (found) categoryId = found.id
      else {
        try { categoryId = (await createCatalogCategory(ctx.db, { name: categoryName, slug: `${slugify(categoryName)}-${ctx.store.id}` }, { actor: `telegram:${ctx.telegramUserId}`, source: 'telegram', storeId: ctx.store.id })).id }
        catch { categoryId = null }
      }
    }
    const claimed = await ctx.db.prepare(`UPDATE telegram_product_batch_items SET status = 'publishing', sku = ?, updated_at = datetime('now') WHERE id = ? AND batch_id = ? AND store_id = ? AND status = 'ready_to_publish' AND product_id IS NULL`)
      .bind(sku, item.id, batch.id, ctx.store.id).run()
    if (!claimed.meta.changes) continue
    const finalKey = `stores/${ctx.store.id}/products/telegram/${batch.id}/${item.id}.${item.extension}`
    try {
      const object = await ctx.env.ASSETS.get(item.temp_key)
      if (!object || object.customMetadata?.operationId !== batch.id || object.httpMetadata?.contentType !== item.content_type) throw new Error('IMAGE_NOT_AVAILABLE')
      await ctx.env.ASSETS.put(finalKey, object.body, { httpMetadata: { contentType: item.content_type, cacheControl: 'public, max-age=31536000, immutable' }, customMetadata: { batchId: batch.id, itemId: String(item.id), storeId: String(ctx.store.id) } })
      await applyTelegramProductBatchItem(ctx.db, {
        batchId: batch.id, itemId: item.id, chatId: String(ctx.chatId), telegramUserId: ctx.telegramUserId,
        storeId: ctx.store.id, actor: `telegram:${ctx.telegramUserId}`,
        product: {
          sku, name: item.name!, description: item.description || '', categoryId, price: Number(item.price),
          imageUrls: [`/api/assets/${finalKey}`],
          variants: [{ sku: `${sku}-1`, name: item.size || item.color || 'Única', size: item.size, color: item.color, stock: Number(item.stock), sortOrder: 0 }],
        },
      })
      created++
      await ctx.env.ASSETS.delete(item.temp_key).catch(() => undefined)
    } catch (error) {
      await ctx.env.ASSETS.delete(finalKey).catch(() => undefined)
      const detail = error instanceof Error && error.message === 'IMAGE_NOT_AVAILABLE' ? 'La foto temporal ya no está disponible'
        : error instanceof Error && error.message === 'PLAN_PRODUCT_LIMIT' ? 'Se alcanzó el límite de productos del plan'
          : error instanceof Error && error.message === 'SKU_ALREADY_EXISTS' ? 'El SKU ya existe en esta tienda; corrígelo antes de reintentar'
            : 'Falló la creación del producto; vuelve a intentarlo desde el panel'
      await ctx.db.prepare(`UPDATE telegram_product_batch_items SET status = 'failed', validation_errors = ?, updated_at = datetime('now') WHERE id = ? AND batch_id = ? AND status = 'publishing'`)
        .bind(JSON.stringify([detail]), item.id, batch.id).run()
    }
  }
  const all = await listItems(ctx, batch.id)
  const pending = all.filter((item) => ['needs_review', 'ready_to_publish'].includes(item.status)).length
  const failed = all.filter((item) => item.status === 'failed').length
  const published = all.filter((item) => item.status === 'published').length
  const allResolved = all.every((item) => item.status === 'published' || item.status === 'ignored')
  const finalStatus = allResolved ? 'published' : published || failed ? 'partially_published' : 'needs_review'
  await ctx.db.prepare('UPDATE telegram_product_batches SET status = ?, updated_at = datetime(\'now\'), completed_at = CASE WHEN ? IN (\'published\',\'failed\') THEN datetime(\'now\') ELSE completed_at END WHERE id = ? AND store_id = ?')
    .bind(finalStatus, finalStatus, batch.id, ctx.store.id).run()
  await ctx.db.prepare(`INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id) VALUES ('telegram_product_batch_published', 'telegram_product_batch', ?, ?, ?, 'telegram', ?)`)
    .bind(batch.id, JSON.stringify({ created, pending, failed, published }), `telegram:${ctx.telegramUserId}`, ctx.store.id).run()
  const publicUrl = publicStoreUrl(ctx.env.PUBLIC_STORE_BASE_URL, ctx.store)
  const adminUrl = `${adminStoreUrl(ctx.env.PUBLIC_STORE_BASE_URL, ctx.store)}/products`
  await say(ctx, `${created ? '¡Listo! Tu catálogo fue actualizado.' : 'No se informó éxito: revisa los errores y vuelve a intentarlo.'}\n\nProductos publicados en esta operación: ${created}\nProductos pendientes: ${pending}\nProductos fallidos: ${failed}`, {
    inline_keyboard: [
      [{ text: 'Ver mi catálogo', url: publicUrl }, { text: 'Ver productos creados', url: adminUrl }],
      [{ text: 'Corregir pendientes', callback_data: `tb:page:${batch.id}:0` }, { text: 'Iniciar otro lote', callback_data: 'tb:new' }],
    ],
  })
  await showTelegramBatch(ctx, batch.id, 0)
}

export async function cancelTelegramBatch(ctx: AssistantContext, batchId?: string): Promise<void> {
  const batch = batchId ? await ctx.db.prepare('SELECT * FROM telegram_product_batches WHERE id = ? AND store_id = ? AND chat_id = ? AND telegram_user_id = ?')
    .bind(batchId, ctx.store.id, String(ctx.chatId), ctx.telegramUserId).first<TelegramBatch>() : await activeTelegramBatch(ctx)
  if (!batch || batch.status === 'published' || batch.status === 'cancelled') { await say(ctx, 'No hay un lote activo que pueda cancelarse.'); return }
  await ctx.db.prepare(`UPDATE telegram_product_batches SET status = 'cancelled', updated_at = datetime('now'), completed_at = datetime('now') WHERE id = ? AND store_id = ? AND chat_id = ? AND status IN (${ACTIVE_BATCH_STATES})`)
    .bind(batch.id, ctx.store.id, String(ctx.chatId)).run()
  await ctx.db.prepare(`UPDATE telegram_product_batch_items SET status = 'ignored', updated_at = datetime('now') WHERE batch_id = ? AND store_id = ? AND status NOT IN ('published','ignored')`)
    .bind(batch.id, ctx.store.id).run()
  const temp = await ctx.db.prepare('SELECT temp_key FROM telegram_product_batch_items WHERE batch_id = ? AND store_id = ?').bind(batch.id, ctx.store.id).all<{ temp_key: string }>()
  if (ctx.env.ASSETS) await Promise.all((temp.results || []).map((item) => ctx.env.ASSETS!.delete(item.temp_key).catch(() => undefined)))
  await ctx.db.prepare(`INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id) VALUES ('telegram_product_batch_cancelled', 'telegram_product_batch', ?, '{}', ?, 'telegram', ?)`)
    .bind(batch.id, `telegram:${ctx.telegramUserId}`, ctx.store.id).run()
  await say(ctx, `Cancelé el lote. No se publicaron productos nuevos.${batch.status === 'partially_published' ? ' Los que ya se habían publicado permanecen en el catálogo.' : ''}`)
}

export async function listTelegramBatches(db: D1Database, storeId: number) {
  const result = await db.prepare(
    `SELECT b.id, b.status, b.created_at AS createdAt, b.updated_at AS updatedAt, b.completed_at AS completedAt,
       b.telegram_user_id AS telegramUserId, COUNT(i.id) AS photos,
       SUM(CASE WHEN i.status = 'published' THEN 1 ELSE 0 END) AS published,
       SUM(CASE WHEN i.status IN ('needs_review','ready_to_publish') THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN i.status = 'failed' THEN 1 ELSE 0 END) AS failed
     FROM telegram_product_batches b LEFT JOIN telegram_product_batch_items i ON i.batch_id = b.id AND i.store_id = b.store_id
     WHERE b.store_id = ? GROUP BY b.id ORDER BY b.created_at DESC LIMIT 50`,
  ).bind(storeId).all()
  return result.results || []
}

export async function getTelegramBatchReview(db: D1Database, storeId: number, batchId: string) {
  const batch = await db.prepare('SELECT id, store_id AS storeId, status, max_items AS maxItems, created_at AS createdAt, updated_at AS updatedAt, completed_at AS completedAt FROM telegram_product_batches WHERE id = ? AND store_id = ?')
    .bind(batchId, storeId).first()
  if (!batch) return null
  const result = await db.prepare(
    `SELECT id, position, name, description, price, stock, size, color, sku, category_name AS categoryName,
       status, validation_errors AS validationErrors, warnings, product_id AS productId
     FROM telegram_product_batch_items WHERE batch_id = ? AND store_id = ? ORDER BY position, id`,
  ).bind(batchId, storeId).all<any>()
  return {
    batch,
    items: (result.results || []).map((item) => ({
      ...item,
      validationErrors: safeJsonArray(item.validationErrors),
      warnings: safeJsonArray(item.warnings),
    })),
  }
}

function safeJsonArray(value: unknown): string[] {
  try { const parsed = JSON.parse(String(value || '[]')); return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [] } catch { return [] }
}

/** Store-scoped, validated correction endpoint backing the secure panel review. */
export async function updateTelegramBatchReviewItem(db: D1Database, storeId: number, batchId: string, itemId: number, body: Record<string, unknown>, actor: string) {
  const batch = await db.prepare('SELECT status FROM telegram_product_batches WHERE id = ? AND store_id = ?').bind(batchId, storeId).first<{ status: string }>()
  if (!batch) throw new Error('BATCH_NOT_FOUND')
  if (['published', 'cancelled', 'publishing', 'analyzing'].includes(batch.status)) throw new Error('BATCH_NOT_EDITABLE')
  const item = await db.prepare('SELECT * FROM telegram_product_batch_items WHERE id = ? AND batch_id = ? AND store_id = ?')
    .bind(itemId, batchId, storeId).first<TelegramBatchItem>()
  if (!item) throw new Error('BATCH_ITEM_NOT_FOUND')
  if (['published', 'ignored', 'publishing', 'analyzing'].includes(item.status)) throw new Error('BATCH_ITEM_NOT_EDITABLE')
  const textField = (key: string, max: number) => typeof body[key] === 'string' ? clean(body[key] as string, max) || null : item[key as keyof TelegramBatchItem] as string | null
  const name = textField('name', 160)
  const description = textField('description', 2000)
  const categoryName = textField('categoryName', 80)
  const size = textField('size', 20)
  const color = textField('color', 40)
  const rawSku = textField('sku', 64)
  if (rawSku && !/^[A-Za-z0-9][A-Za-z0-9._/-]{1,63}$/.test(rawSku)) throw new Error('INVALID_SKU')
  const price = body.price === '' || body.price === null ? null : body.price === undefined ? item.price : Number(body.price)
  const stock = body.stock === '' || body.stock === null ? null : body.stock === undefined ? item.stock : Number(body.stock)
  if (price !== null && (!Number.isSafeInteger(price) || price < 0 || price > 10_000_000_000)) throw new Error('INVALID_PRICE')
  if (stock !== null && (!Number.isSafeInteger(stock) || stock < 0 || stock > 1_000_000)) throw new Error('INVALID_STOCK')
  if (rawSku) {
    const duplicate = await db.prepare('SELECT id FROM products WHERE store_id = ? AND upper(sku) = upper(?)').bind(storeId, rawSku).first()
    if (duplicate) throw new Error('SKU_ALREADY_EXISTS')
  }
  const category = categoryName ? await db.prepare('SELECT id, name FROM categories WHERE store_id = ? AND is_active = 1 AND lower(name) = lower(?) LIMIT 1')
    .bind(storeId, categoryName).first<{ id: number; name: string }>() : null
  const next = { ...item, name, description, category_name: category?.name || categoryName, price, stock }
  const errors = itemErrors(next)
  const status = errors.length ? 'needs_review' : 'ready_to_publish'
  const result = await db.prepare(
    `UPDATE telegram_product_batch_items SET name = ?, description = ?, price = ?, stock = ?, size = ?, color = ?, sku = ?, category_id = ?, category_name = ?,
       status = ?, validation_errors = ?, warnings = '[]', updated_at = datetime('now')
     WHERE id = ? AND batch_id = ? AND store_id = ? AND product_id IS NULL AND status IN ('needs_review','ready_to_publish','failed')`,
  ).bind(name, description, price, stock, size, color, rawSku, category?.id || null, category?.name || categoryName, status, JSON.stringify(errors), itemId, batchId, storeId).run()
  if (!result.meta.changes) throw new Error('BATCH_ITEM_NOT_EDITABLE')
  await db.prepare(`INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id) VALUES ('telegram_batch_item_corrected', 'telegram_product_batch_item', ?, ?, ?, 'admin', ?)`)
    .bind(String(itemId), JSON.stringify({ batchId, fields: Object.keys(body) }), actor.slice(0, 160), storeId).run()
  const counts = await db.prepare(
    `SELECT SUM(CASE WHEN status = 'needs_review' OR status = 'failed' THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) AS published
     FROM telegram_product_batch_items WHERE batch_id = ? AND store_id = ?`,
  ).bind(batchId, storeId).first<{ pending: number; published: number }>()
  const batchStatus = Number(counts?.pending || 0) ? (Number(counts?.published || 0) ? 'partially_published' : 'needs_review') : (Number(counts?.published || 0) ? 'partially_published' : 'ready_to_publish')
  await db.prepare('UPDATE telegram_product_batches SET status = ?, updated_at = datetime(\'now\') WHERE id = ? AND store_id = ? AND status IN (\'needs_review\',\'ready_to_publish\',\'partially_published\',\'failed\')')
    .bind(batchStatus, batchId, storeId).run()
  return getTelegramBatchReview(db, storeId, batchId)
}

export async function getTelegramBatchPhoto(db: D1Database, bucket: R2Bucket | undefined, storeId: number, batchId: string, itemId: number): Promise<R2ObjectBody | null> {
  if (!bucket) return null
  const item = await db.prepare('SELECT status, temp_key, extension FROM telegram_product_batch_items WHERE id = ? AND batch_id = ? AND store_id = ?')
    .bind(itemId, batchId, storeId).first<{ status: string; temp_key: string; extension: string }>()
  if (!item) return null
  const key = item.status === 'published' ? `stores/${storeId}/products/telegram/${batchId}/${itemId}.${item.extension}` : item.temp_key
  return bucket.get(key)
}
