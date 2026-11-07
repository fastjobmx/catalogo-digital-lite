import { applyConfirmedTelegramProductCreation, createCatalogCategory, productLimit } from '../business'
import { deleteTelegramDraftImages, deleteTelegramDraftTempImages, downloadTelegramImage, promoteTelegramDraftImages, storeTelegramDraftImage } from '../telegramProductImages'
import {
  createTelegramProductDraft, mergeGeminiProductFields, missingProductDraftFields, parseProductDraftFieldReply,
  suggestSku, telegramProductDraftSchema, type ProductDraftField, type ProductDraftMissingField, type TelegramProductDraft,
} from '../../validation/telegramProductDraft'
import { roleAllows } from '../../tenancy/access'
import { publicStoreUrl, slugify } from '../../tenancy/stores'
import { bytesToBase64, type TelegramMessage } from './telegramApi'
import { say, sayPhoto, rememberTurn, type AssistantContext } from './context'
import { analyzeProductPhotos } from './ai'
import { escapeHtml, formatMoney } from './tools'
import { advanceAfterPublishedProduct } from './onboarding'
import { backToMenu } from './menus'
import type { PendingOperation } from './operations'

export type PendingProductDraft = { operation: PendingOperation; draft: TelegramProductDraft }
type DraftCategory = { id: number; name: string; slug: string }

const FIELD_ORDER: ProductDraftMissingField[] = ['photos', 'name', 'description', 'category', 'price', 'variants', 'sku']

const IMAGE_ERRORS: Record<string, string> = {
  TELEGRAM_GET_FILE_FAILED: 'Telegram no me entregó esta foto. ¿Puedes enviarla otra vez?',
  TELEGRAM_FILE_METADATA_INVALID: 'No pude leer esta foto. ¿Puedes enviarla otra vez?',
  TELEGRAM_IMAGE_TOO_LARGE: 'La foto es muy pesada (máximo 20 MB). Envíala como foto normal.',
  TELEGRAM_IMAGE_FORMAT_UNSUPPORTED: 'Ese formato no es compatible. Envía una imagen JPG, PNG o WebP.',
  TELEGRAM_IMAGE_MALFORMED: 'La imagen parece dañada. ¿Puedes enviar otra?',
  TELEGRAM_IMAGE_DIMENSIONS_INVALID: 'La imagen es muy pequeña o demasiado grande. Usa una foto de al menos 128 px.',
  TELEGRAM_IMAGE_ASPECT_INVALID: 'La proporción de la imagen no sirve para el catálogo. Prueba con otra foto.',
  R2_NOT_CONFIGURED: 'El almacenamiento de fotos no está disponible en este momento. No guardé la imagen.',
  PRODUCT_DRAFT_CHANGED: 'El borrador cambió mientras recibía la foto. ¿Puedes enviarla otra vez?',
}

function parseDraft(operation: PendingOperation): TelegramProductDraft | null {
  try {
    const parsed = telegramProductDraftSchema.safeParse(JSON.parse(operation.params_json))
    return parsed.success ? parsed.data : null
  } catch { return null }
}

export async function getPendingProductDraft(ctx: AssistantContext): Promise<PendingProductDraft | null> {
  const operation = await ctx.db.prepare(
    `SELECT operation_id, action, params_json, before_json, after_json, store_id FROM telegram_operations
     WHERE chat_id = ? AND store_id = ? AND action = 'create_product' AND status = 'pending' AND expires_at > unixepoch()
     ORDER BY created_at DESC LIMIT 1`,
  ).bind(String(ctx.chatId), ctx.store.id).first<PendingOperation>()
  if (!operation) return null
  const draft = parseDraft(operation)
  return draft ? { operation, draft } : null
}

async function listActiveCategories(ctx: AssistantContext): Promise<DraftCategory[]> {
  const result = await ctx.db.prepare('SELECT id, name, slug FROM categories WHERE store_id = ? AND is_active = 1 ORDER BY sort_order, name').bind(ctx.store.id).all<DraftCategory>()
  return result.results || []
}

function sameText(a: string, b: string): boolean {
  return slugify(a) === slugify(b)
}

async function resolveDraftCategory(ctx: AssistantContext, draft: TelegramProductDraft): Promise<TelegramProductDraft> {
  if (!draft.fields.categoryName) return draft
  const match = (await listActiveCategories(ctx)).find((category) => sameText(category.name, draft.fields.categoryName!))
  if (!match) {
    delete draft.fields.categoryId
    return draft
  }
  draft.fields.categoryId = match.id
  draft.fields.categoryName = match.name
  return draft
}

async function saveDraft(ctx: AssistantContext, operation: PendingOperation, draft: TelegramProductDraft): Promise<PendingOperation | null> {
  const json = JSON.stringify(draft)
  if (json === operation.params_json) return operation
  const result = await ctx.db.prepare(
    `UPDATE telegram_operations SET params_json = ? WHERE operation_id = ? AND chat_id = ? AND store_id = ? AND action = 'create_product'
       AND status = 'pending' AND expires_at > unixepoch() AND params_json = ?`,
  ).bind(json, operation.operation_id, String(ctx.chatId), ctx.store.id, operation.params_json).run()
  return result.meta.changes ? { ...operation, params_json: json } : null
}

export async function beginProductDraft(ctx: AssistantContext, input?: Record<string, unknown>, hint?: string): Promise<void> {
  if (!roleAllows(ctx.role, 'admin')) {
    await say(ctx, 'Tu rol en esta tienda no permite publicar productos. Pídeselo al propietario o a un administrador.')
    return
  }
  const batch = await ctx.db.prepare(`SELECT id FROM telegram_product_batches WHERE chat_id = ? AND store_id = ? AND status IN ('receiving','analyzing','needs_review','ready_to_publish','publishing','partially_published') LIMIT 1`)
    .bind(String(ctx.chatId), ctx.store.id).first<{ id: string }>()
  if (batch) { await say(ctx, 'Tienes un lote de productos activo. Termínalo con /listo y /publicar, o cancélalo con /cancelar antes de crear un producto individual.'); return }
  const current = await ctx.db.prepare(
    `SELECT operation_id, action, params_json, before_json, after_json FROM telegram_operations
     WHERE chat_id = ? AND status = 'pending' AND expires_at > unixepoch() ORDER BY created_at DESC LIMIT 1`,
  ).bind(String(ctx.chatId)).first<PendingOperation>()
  if (current) {
    if (current.action !== 'create_product') {
      await say(ctx, 'Tienes otro cambio esperando confirmación. Confírmalo o cancélalo con /cancelar y seguimos con el producto.')
      return
    }
    const active = await getPendingProductDraft(ctx)
    if (active && input) {
      const merged = await resolveDraftCategory(ctx, mergeGeminiProductFields(active.draft, input))
      const saved = await saveDraft(ctx, active.operation, merged)
      if (saved) await promptProductDraft(ctx, saved, merged)
    } else {
      await say(ctx, 'Seguimos con el producto que estabas creando. Envíame lo que te pedí, o escribe /cancelar para empezar de nuevo.')
      if (active) await promptProductDraft(ctx, active.operation, active.draft)
    }
    return
  }
  const draft = await resolveDraftCategory(ctx, mergeGeminiProductFields(createTelegramProductDraft(), input || {}))
  if (hint) draft.hint = hint.slice(0, 300)
  const operationId = crypto.randomUUID()
  try {
    await ctx.db.prepare(
      `INSERT INTO telegram_operations (operation_id, update_id, chat_id, store_id, action, params_json, before_json, after_json, expires_at)
       VALUES (?, ?, ?, ?, 'create_product', ?, '{}', '{}', unixepoch() + 3600)`,
    ).bind(operationId, ctx.updateId, String(ctx.chatId), ctx.store.id, JSON.stringify(draft)).run()
  } catch (error) {
    if (error instanceof Error && /unique constraint/i.test(error.message)) {
      await say(ctx, 'Tienes otra operación abierta. Termínala o cancélala con /cancelar antes de crear otra.')
      return
    }
    throw error
  }
  await say(ctx, '¡Perfecto! Vamos a registrarlo. 🛍️').catch(() => undefined)
  await promptProductDraft(ctx, { operation_id: operationId, action: 'create_product', params_json: JSON.stringify(draft), before_json: '{}', after_json: '{}' }, draft)
}

function nextMissing(draft: TelegramProductDraft): ProductDraftMissingField | null {
  const missing = new Set(missingProductDraftFields(draft))
  if (draft.askFirst && missing.has(draft.askFirst)) return draft.askFirst
  return FIELD_ORDER.find((field) => missing.has(field)) ?? null
}

export async function promptProductDraft(ctx: AssistantContext, operation: PendingOperation, original: TelegramProductDraft): Promise<void> {
  const draft = await resolveDraftCategory(ctx, structuredClone(original))
  const field = nextMissing(draft)
  if (!field) {
    draft.stage = 'ready'
    delete draft.awaiting
    delete draft.editField
    const saved = await saveDraft(ctx, operation, draft)
    await sendDraftPreview(ctx, (saved || operation).operation_id, draft)
    return
  }
  draft.stage = 'collecting'
  if (field === 'photos') {
    delete draft.awaiting
    await saveDraft(ctx, operation, draft)
    await say(ctx, '📸 ¿Tienes fotografías del producto? Envíamelas aquí (puedes mandar varias, hasta 10).\nCuando termines, toca “Listo con fotos”.', {
      inline_keyboard: [[{ text: '✖ Cancelar', callback_data: `pd:cancel:${operation.operation_id}` }]],
    })
    return
  }
  if (field === 'sku' && !draft.suggestedSku) {
    draft.suggestedSku = await uniqueSkuSuggestion(ctx, draft)
  }
  draft.awaiting = field as ProductDraftField
  const saved = await saveDraft(ctx, operation, draft)
  const operationId = (saved || operation).operation_id
  const categories = field === 'category' ? await listActiveCategories(ctx) : []
  const prompts: Record<ProductDraftField, string> = {
    name: '¿Cómo se llama el producto? Escribe el nombre comercial.',
    description: 'Escribe una breve descripción del producto (qué es, materiales, para quién).',
    category: categories.length ? '¿En qué categoría lo publico? Elige una o escribe el nombre de una nueva.' : 'Escribe el nombre de la categoría para este producto (por ejemplo “Calzado”).',
    price: `¿Qué precio deseas colocar? Escríbelo en ${escapeHtml(ctx.store.currency)}, por ejemplo 180000 o 180.000.`,
    variants: draft.variants.length > 1 && draft.variants.every((variant) => variant.size && variant.stock === undefined)
      ? `¿Cuántas unidades tienes por talla (${escapeHtml(draft.variants.map((variant) => variant.size).join(', '))})?\nEjemplo: <b>${escapeHtml(draft.variants.map((variant, index) => `${variant.size}:${index + 2}`).join(', '))}</b>, o “2 de cada una”.\nNo crearé existencias que no me indiques.`
      : '¿Cuántas unidades tienes?\n• Si es talla única, escribe solo la cantidad. Ejemplo: <b>10</b>\n• Si tiene tallas o colores: <b>Negro talla 38:3, Negro talla 39:2</b>\nNo crearé existencias que no me indiques.',
    sku: `Por último, ¿tiene un código o SKU? Si no, uso <b>${escapeHtml(draft.suggestedSku || '')}</b>.`,
  }
  const keyboard: Array<Array<{ text: string; callback_data: string }>> = []
  if (field === 'category') {
    for (let index = 0; index < Math.min(categories.length, 12); index += 2) {
      keyboard.push(categories.slice(index, index + 2).map((category) => ({ text: category.name, callback_data: `pd:cat:${operationId}:${category.id}` })))
    }
    if (draft.suggestedCategory && !categories.some((category) => sameText(category.name, draft.suggestedCategory!))) {
      keyboard.push([{ text: `➕ Crear “${draft.suggestedCategory}”`, callback_data: `pd:newcat:${operationId}` }])
    }
  }
  if (field === 'sku' && draft.suggestedSku) keyboard.push([{ text: `Usar ${draft.suggestedSku}`, callback_data: `pd:sku:${operationId}` }])
  keyboard.push([{ text: '✖ Cancelar', callback_data: `pd:cancel:${operationId}` }])
  await say(ctx, prompts[field as ProductDraftField], { inline_keyboard: keyboard })
}

async function uniqueSkuSuggestion(ctx: AssistantContext, draft: TelegramProductDraft): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = suggestSku(draft.fields.name, draft.defaultColor || draft.variants.find((variant) => variant.color)?.color)
    const exists = await ctx.db.prepare('SELECT id FROM products WHERE store_id = ? AND sku = ?').bind(ctx.store.id, candidate).first()
    if (!exists) return candidate
  }
  return `PRD-${Date.now().toString(36).toUpperCase().slice(-6)}`
}

function draftKeyboard(operationId: string, imageCount: number) {
  const rows: Array<Array<{ text: string; callback_data: string }>> = [
    [{ text: '✅ Guardar producto', callback_data: `pd:publish:${operationId}` }],
    [{ text: '✏️ Editar', callback_data: `pd:edit:${operationId}` }, { text: '❌ Cancelar', callback_data: `pd:cancel:${operationId}` }],
  ]
  if (imageCount > 1) rows.push([{ text: '🖼 Ver fotos', callback_data: `pd:photo:${operationId}:0` }])
  return { inline_keyboard: rows }
}

function photoKeyboard(operationId: string, photoIndex: number, total: number) {
  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [
    [{ text: '✅ Listo con fotos', callback_data: `pd:done:${operationId}` }, { text: '⭐ Usar como principal', callback_data: `pd:main:${operationId}:${photoIndex}` }],
    [{ text: '✖ Cancelar', callback_data: `pd:cancel:${operationId}` }],
  ]
  if (total > 1) keyboard.unshift([
    ...(photoIndex > 0 ? [{ text: '◀ Anterior', callback_data: `pd:photo:${operationId}:${photoIndex - 1}` }] : []),
    ...(photoIndex + 1 < total ? [{ text: 'Siguiente ▶', callback_data: `pd:photo:${operationId}:${photoIndex + 1}` }] : []),
  ])
  return { inline_keyboard: keyboard }
}

async function sendDraftPreview(ctx: AssistantContext, operationId: string, draft: TelegramProductDraft): Promise<void> {
  const mainImage = draft.images[draft.primaryImageIndex]
  if (!mainImage) {
    await say(ctx, 'El producto todavía no tiene foto principal. Envíame una foto para continuar.')
    return
  }
  const ai = new Set(draft.aiSuggested || [])
  const mark = (field: string) => ai.has(field) ? ' ✨' : ''
  const variants = draft.variants.map((variant) => `• ${escapeHtml([variant.color, variant.size && variant.size !== 'Única' ? `talla ${variant.size}` : variant.size].filter(Boolean).join(' · '))}: ${variant.stock} u.`).join('\n')
  // Same name with another code is likely the same product uploaded twice: warn, never block.
  const similar = draft.fields.name
    ? await ctx.db.prepare(`SELECT sku FROM products WHERE store_id = ? AND is_archived = 0 AND lower(trim(name)) = lower(trim(?)) AND upper(sku) <> upper(?) LIMIT 1`)
      .bind(ctx.store.id, draft.fields.name, draft.fields.sku || '').first<{ sku: string }>()
    : null
  const caption = `<b>Vista previa del producto</b>\n\n` +
    (similar ? `⚠️ Ya tienes un producto con el mismo nombre (código ${escapeHtml(similar.sku)}). Revisa que no sea un duplicado.\n\n` : '') +
    `<b>${escapeHtml(draft.fields.name)}</b>${mark('name')}\n` +
    `Precio: ${formatMoney(Number(draft.fields.price), ctx.store.currency)}\n` +
    `Categoría: ${escapeHtml(draft.fields.categoryName)}${mark('category')}\n` +
    `Código: ${escapeHtml(draft.fields.sku)}\n` +
    `${escapeHtml(draft.fields.description)}${mark('description')}\n\n${variants}\n\n` +
    `Fotos: ${draft.images.length}${ai.size ? '\n✨ = sugerido por la IA a partir de tus fotos; revísalo.' : ''}\n<i>No se guarda ni se publica hasta que toques “Guardar producto”.</i>`
  await sayPhoto(ctx, mainImage.telegramFileId, caption, draftKeyboard(operationId, draft.images.length))
}

export async function receiveProductPhoto(ctx: AssistantContext, active: PendingProductDraft, message: TelegramMessage): Promise<void> {
  try {
    if (!ctx.env.ASSETS) throw new Error('R2_NOT_CONFIGURED')
    if (active.draft.images.length >= 10) {
      await say(ctx, 'Este producto ya tiene el máximo de 10 fotos. Toca “Listo con fotos” para continuar.', photoKeyboard(active.operation.operation_id, active.draft.images.length - 1, active.draft.images.length))
      return
    }
    const document = message.document
    if (document && (!document.mime_type?.startsWith('image/') || !/\.(jpe?g|png|webp)$/i.test(document.file_name || ''))) throw new Error('TELEGRAM_IMAGE_FORMAT_UNSUPPORTED')
    const fileId = message.photo?.at(-1)?.file_id || document?.file_id
    if (!fileId) throw new Error('TELEGRAM_IMAGE_FORMAT_UNSUPPORTED')
    const image = await downloadTelegramImage(ctx.botToken, fileId)
    const stored = await storeTelegramDraftImage(ctx.env.ASSETS, active.operation.operation_id, image, fileId)
    // Re-read the draft so several photos sent as an album are all kept.
    for (let attempt = 0; attempt < 4; attempt++) {
      const latest = await getPendingProductDraft(ctx)
      if (!latest || latest.operation.operation_id !== active.operation.operation_id) break
      const next = structuredClone(latest.draft)
      if (next.images.length >= 10) break
      next.images.push(stored)
      if (message.caption && !next.hint) next.hint = message.caption.slice(0, 300)
      const saved = await saveDraft(ctx, latest.operation, next)
      if (saved) {
        const count = next.images.length
        await say(ctx, `📸 Recibí ${count === 1 ? 'la primera foto' : `${count} fotos`}. Envía más o toca “Listo con fotos”.`, photoKeyboard(active.operation.operation_id, count - 1, count))
        return
      }
    }
    await ctx.env.ASSETS.delete(stored.tempKey)
    throw new Error('PRODUCT_DRAFT_CHANGED')
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    if (!IMAGE_ERRORS[code]) console.error('Telegram product image processing failed:', code || 'unknown error')
    await say(ctx, IMAGE_ERRORS[code] || 'No pude guardar esta foto. El producto sigue sin publicarse; intenta de nuevo.')
  }
}

/** Uses Gemini to suggest name, description, category and color from the draft photos. */
async function suggestFromPhotos(ctx: AssistantContext, active: PendingProductDraft): Promise<PendingProductDraft> {
  const draft = active.draft
  const needsSuggestions = !draft.fields.name || !draft.fields.description || !draft.fields.categoryName
  if (draft.aiAnalyzed || !needsSuggestions || !ctx.env.ASSETS || !ctx.env.GEMINI_API_KEY) return active
  const images: Array<{ mimeType: string; data: string }> = []
  for (const image of draft.images.slice(0, 3)) {
    if (image.byteLength > 4 * 1024 * 1024) continue
    const object = await ctx.env.ASSETS.get(image.tempKey)
    if (!object) continue
    images.push({ mimeType: image.contentType, data: bytesToBase64(new Uint8Array(await object.arrayBuffer())) })
  }
  if (!images.length) return active
  await say(ctx, `Recibí ${draft.images.length === 1 ? 'la foto' : `las ${draft.images.length} fotos`}. Voy a analizarlas para ayudarte a preparar el producto… ✨`)
  const categories = (await listActiveCategories(ctx)).map((category) => category.name)
  const business = await ctx.db.prepare('SELECT business_type FROM store_config WHERE id = ?').bind(ctx.store.id).first<{ business_type: string }>()
  const outcome = await analyzeProductPhotos(ctx, images, { text: draft.hint, categories, businessType: business?.business_type })
  const next = structuredClone(draft)
  next.aiAnalyzed = true
  if (!outcome.ok) {
    await say(ctx, `${outcome.message}\nNo pasa nada: te pido los datos uno por uno.`)
  } else if (!outcome.value.isProductPhoto) {
    await say(ctx, 'Esas fotos no parecen mostrar un producto. Puedes enviar otras o seguir escribiendo los datos.')
  } else {
    const suggestion = outcome.value
    const suggested: string[] = []
    if (!next.fields.name) { next.fields.name = suggestion.name.slice(0, 120); suggested.push('name') }
    if (!next.fields.description) { next.fields.description = suggestion.description.slice(0, 2000); suggested.push('description') }
    if (!next.fields.categoryName && suggestion.category) {
      const match = categories.find((name) => sameText(name, suggestion.category))
      if (match) { next.fields.categoryName = match; suggested.push('category') } else next.suggestedCategory = suggestion.category.slice(0, 60)
    }
    if (!next.defaultColor && suggestion.colors[0]) next.defaultColor = suggestion.colors[0].slice(0, 48)
    if (suggestion.visibleBrand) next.visibleBrand = suggestion.visibleBrand.slice(0, 60)
    next.aiSuggested = suggested
    await say(ctx, `<b>Te preparé esta propuesta:</b>\n` +
      `Nombre: ${escapeHtml(next.fields.name)}\n` +
      `Categoría: ${escapeHtml(next.fields.categoryName || next.suggestedCategory || '—')}\n` +
      `Color: ${escapeHtml(suggestion.colors.join(', ') || '—')}\n` +
      `Descripción: ${escapeHtml(next.fields.description)}` +
      (suggestion.visibleBrand ? `\n\nVeo la marca “${escapeHtml(suggestion.visibleBrand)}” en la foto. No la agregué: si es correcta, inclúyela al editar el nombre.` : '') +
      `\n\nPodrás corregir todo antes de publicar.`)
  }
  const saved = await saveDraft(ctx, active.operation, next)
  return { operation: saved || active.operation, draft: saved ? next : draft }
}

export async function acceptProductDraftText(ctx: AssistantContext, active: PendingProductDraft, text: string): Promise<void> {
  const awaiting = active.draft.editField || active.draft.awaiting
  if (!awaiting) {
    await say(ctx, active.draft.images.length
      ? 'Usa los botones para continuar, o envíame otra foto.'
      : 'Envíame las fotos del producto para continuar, o escribe /cancelar.')
    return
  }
  if (awaiting === 'sku' && /^(no|no tengo|usa(?:r)? (?:el )?(?:sugerido|ese)|ok|dale|s[ií])$/i.test(text.trim()) && active.draft.suggestedSku) {
    text = active.draft.suggestedSku
  }
  const parsed = parseProductDraftFieldReply(awaiting, text, active.draft)
  if (parsed.error) {
    await say(ctx, parsed.error)
    return
  }
  const draft = await resolveDraftCategory(ctx, parsed.draft)
  draft.aiSuggested = (draft.aiSuggested || []).filter((field) => field !== (awaiting === 'category' ? 'category' : awaiting))
  if (awaiting === 'category' && !draft.fields.categoryId && draft.fields.categoryName) {
    draft.suggestedCategory = draft.fields.categoryName
    delete draft.fields.categoryName
    const saved = await saveDraft(ctx, active.operation, draft)
    await say(ctx, `No tienes una categoría llamada “${escapeHtml(draft.suggestedCategory)}”. ¿La creo?`, { inline_keyboard: [
      [{ text: `➕ Crear “${draft.suggestedCategory}”`, callback_data: `pd:newcat:${(saved || active.operation).operation_id}` }],
      [{ text: 'Elegir otra', callback_data: `pd:field:${(saved || active.operation).operation_id}:category` }],
    ] })
    return
  }
  if (awaiting === 'sku' && draft.fields.sku) {
    const existing = await ctx.db.prepare('SELECT id FROM products WHERE store_id = ? AND sku = ?').bind(ctx.store.id, draft.fields.sku).first()
    if (existing) {
      await say(ctx, 'Ese código ya lo usa otro producto de tu tienda. Escribe otro.')
      return
    }
  }
  const saved = await saveDraft(ctx, active.operation, draft)
  if (!saved) { await say(ctx, 'El borrador cambió mientras escribías. Revisa el último mensaje y vuelve a intentarlo.'); return }
  await promptProductDraft(ctx, saved, draft)
}

export async function cancelProductDraft(ctx: AssistantContext, operationId: string): Promise<boolean> {
  const result = await ctx.db.prepare(
    `UPDATE telegram_operations SET status = 'cancelled', completed_at = datetime('now')
     WHERE operation_id = ? AND chat_id = ? AND store_id = ? AND action = 'create_product' AND status = 'pending'`,
  ).bind(operationId, String(ctx.chatId), ctx.store.id).run()
  if (result.meta.changes && ctx.env.ASSETS) await deleteTelegramDraftImages(ctx.env.ASSETS, operationId, ctx.store.id)
  return Boolean(result.meta.changes)
}

export async function handleProductDraftCallback(ctx: AssistantContext, intent: string, operationId: string, value?: string): Promise<void> {
  let active = await getPendingProductDraft(ctx)
  if (!active || active.operation.operation_id !== operationId) {
    await say(ctx, 'Ese borrador ya venció, se canceló o se publicó. Escribe “agregar producto” para empezar otro.')
    return
  }
  switch (intent) {
    case 'cancel':
      await cancelProductDraft(ctx, operationId)
      await say(ctx, 'Listo, cancelé el borrador. No se publicó nada.', backToMenu())
      return
    case 'done':
      if (!active.draft.images.length) { await say(ctx, 'Aún no recibo fotos. Envíame al menos una.'); return }
      active = await suggestFromPhotos(ctx, active)
      await promptProductDraft(ctx, active.operation, active.draft)
      return
    case 'main': {
      const index = Number(value)
      if (!Number.isInteger(index) || !active.draft.images[index]) { await say(ctx, 'No encontré esa foto.'); return }
      const next = structuredClone(active.draft)
      next.primaryImageIndex = index
      await saveDraft(ctx, active.operation, next)
      await say(ctx, `La foto ${index + 1} quedó como principal.`)
      return
    }
    case 'photo': {
      const index = Number(value)
      const photo = active.draft.images[index]
      if (!photo) { await say(ctx, 'No encontré esa foto.'); return }
      await sayPhoto(ctx, photo.telegramFileId, `Foto ${index + 1} de ${active.draft.images.length}`, photoKeyboard(operationId, index, active.draft.images.length))
      return
    }
    case 'edit': {
      const fields: Array<[ProductDraftField, string]> = [['name', 'Nombre'], ['description', 'Descripción'], ['price', 'Precio'], ['category', 'Categoría'], ['variants', 'Tallas y stock'], ['sku', 'Código / SKU']]
      const keyboard = []
      for (let index = 0; index < fields.length; index += 2) keyboard.push(fields.slice(index, index + 2).map(([field, label]) => ({ text: label, callback_data: `pd:field:${operationId}:${field}` })))
      keyboard.push([{ text: '👁 Ver vista previa', callback_data: `pd:preview:${operationId}` }])
      await say(ctx, '¿Qué dato quieres corregir?', { inline_keyboard: keyboard })
      return
    }
    case 'field': {
      const field = value as ProductDraftField
      if (!['name', 'sku', 'description', 'price', 'category', 'variants'].includes(field)) { await say(ctx, 'Ese dato no se puede editar aquí.'); return }
      const next = structuredClone(active.draft)
      if (field === 'category') { delete next.fields.categoryId; delete next.fields.categoryName }
      const saved = await saveDraft(ctx, active.operation, next)
      const prompted = structuredClone(next)
      prompted.editField = field
      prompted.awaiting = field
      if (field === 'category') {
        await promptProductDraft(ctx, saved || active.operation, next)
        return
      }
      await saveDraft(ctx, saved || active.operation, prompted)
      const messages: Record<ProductDraftField, string> = {
        name: 'Escribe el nuevo nombre.', sku: 'Escribe el nuevo código o SKU.', description: 'Escribe la nueva descripción.',
        price: `Escribe el nuevo precio en ${escapeHtml(ctx.store.currency)}.`, category: '',
        variants: 'Escribe las tallas y el stock. Talla única: solo la cantidad (ej. 10). Con tallas: Negro talla 38:3, Negro talla 39:2.',
      }
      await say(ctx, messages[field])
      return
    }
    case 'cat': {
      const category = (await listActiveCategories(ctx)).find((item) => item.id === Number(value))
      if (!category) { await say(ctx, 'Esa categoría ya no está disponible. Elige otra.'); return }
      const next = structuredClone(active.draft)
      next.fields.categoryId = category.id
      next.fields.categoryName = category.name
      delete next.awaiting
      delete next.editField
      next.aiSuggested = (next.aiSuggested || []).filter((field) => field !== 'category')
      const saved = await saveDraft(ctx, active.operation, next)
      await promptProductDraft(ctx, saved || active.operation, next)
      return
    }
    case 'newcat': {
      const name = active.draft.suggestedCategory?.trim()
      if (!name) { await say(ctx, 'Escribe el nombre de la categoría que quieres crear.'); return }
      let categoryId: number
      try {
        const created = await createCatalogCategory(ctx.db, { name, slug: slugify(name) }, { actor: `telegram:${ctx.telegramUserId}`, source: 'telegram', storeId: ctx.store.id })
        categoryId = created.id
      } catch (error) {
        if (!(error instanceof Error && error.message === 'CATEGORY_SLUG_EXISTS')) throw error
        const existing = await ctx.db.prepare('SELECT id, is_active FROM categories WHERE store_id = ? AND slug = ?').bind(ctx.store.id, slugify(name)).first<{ id: number; is_active: number }>()
        if (!existing) throw error
        if (!existing.is_active) await ctx.db.prepare("UPDATE categories SET is_active = 1, updated_at = datetime('now') WHERE id = ? AND store_id = ?").bind(existing.id, ctx.store.id).run()
        categoryId = existing.id
      }
      const next = structuredClone(active.draft)
      next.fields.categoryId = categoryId
      next.fields.categoryName = name
      delete next.suggestedCategory
      delete next.awaiting
      delete next.editField
      const saved = await saveDraft(ctx, active.operation, next)
      await say(ctx, `Creé la categoría “${escapeHtml(name)}”.`)
      await promptProductDraft(ctx, saved || active.operation, next)
      return
    }
    case 'sku': {
      const sku = active.draft.suggestedSku
      if (!sku) { await say(ctx, 'Escribe el código del producto.'); return }
      await acceptProductDraftText(ctx, active, sku)
      return
    }
    case 'preview': {
      if (nextMissing(active.draft)) { await promptProductDraft(ctx, active.operation, active.draft); return }
      await sendDraftPreview(ctx, operationId, active.draft)
      return
    }
    case 'publish':
      await publishProductDraft(ctx, active)
      return
    default:
      await say(ctx, 'No reconocí esa opción. Escribe /menu para ver las opciones.')
  }
}

export async function publishProductDraft(ctx: AssistantContext, active: PendingProductDraft): Promise<void> {
  const { operation, draft } = active
  if (!roleAllows(ctx.role, 'admin')) { await say(ctx, 'Tu rol no permite publicar productos.'); return }
  if (!ctx.env.ASSETS) { await say(ctx, 'El almacenamiento de fotos no está disponible. No publiqué el producto; intenta más tarde.'); return }
  const missing = nextMissing(draft)
  if (missing) { await promptProductDraft(ctx, operation, draft); return }
  const category = await ctx.db.prepare('SELECT id, name, slug FROM categories WHERE id = ? AND store_id = ? AND is_active = 1').bind(draft.fields.categoryId, ctx.store.id).first<DraftCategory>()
  if (!category || category.name !== draft.fields.categoryName) { await say(ctx, 'La categoría cambió o ya no está activa. Elige otra en “Editar información”.'); return }
  const duplicate = await ctx.db.prepare('SELECT id FROM products WHERE store_id = ? AND sku = ?').bind(ctx.store.id, draft.fields.sku).first()
  if (duplicate) { await say(ctx, 'Ese código ya lo usa otro producto. Cámbialo en “Editar información”.'); return }
  const limit = await productLimit(ctx.db, ctx.store.id)
  if (limit.max !== null && limit.count >= limit.max) { await say(ctx, `Tu plan${limit.plan ? ` ${escapeHtml(limit.plan)}` : ''} permite ${limit.max} productos activos y ya tienes ${limit.count}. Archiva alguno o pide un cambio de plan; no publiqué este producto.`); return }
  for (const image of draft.images) {
    const stored = image.tempKey.startsWith(`telegram-drafts/${operation.operation_id}/`) ? await ctx.env.ASSETS.get(image.tempKey) : null
    if (!stored || stored.customMetadata?.operationId !== operation.operation_id) {
      await say(ctx, 'Una de las fotos ya no está disponible. Reenvíala, por favor; el producto no se publicó.')
      return
    }
  }
  const promoted = await promoteTelegramDraftImages(ctx.env.ASSETS, operation.operation_id, draft.images, ctx.store.id)
  const imageUrls = promoted.keys.map((key) => `/api/assets/${key}`)
  const ready = { ...draft, stage: 'ready' as const }
  const paramsJson = JSON.stringify(ready)
  const afterJson = JSON.stringify({ sku: draft.fields.sku, imageUrls, variants: draft.variants })
  const claimed = await ctx.db.prepare(
    `UPDATE telegram_operations SET params_json = ?, after_json = ? WHERE operation_id = ? AND chat_id = ? AND store_id = ? AND action = 'create_product'
       AND status = 'pending' AND expires_at > unixepoch() AND params_json = ?`,
  ).bind(paramsJson, afterJson, operation.operation_id, String(ctx.chatId), ctx.store.id, operation.params_json).run()
  if (!claimed.meta.changes) {
    await Promise.all(promoted.keys.map((key) => ctx.env.ASSETS!.delete(key)))
    await say(ctx, 'El borrador cambió o venció antes de publicar. No se publicó nada.')
    return
  }
  const product = {
    sku: draft.fields.sku!, name: draft.fields.name!, description: draft.fields.description!, brand: draft.fields.brand || null,
    categoryId: draft.fields.categoryId!, price: draft.fields.price!, isFeatured: false,
    imageUrls: imageUrls.map((_, index) => imageUrls[(index + draft.primaryImageIndex) % imageUrls.length]!),
    variants: draft.variants.map((variant, index) => ({
      sku: `${draft.fields.sku}-${index + 1}`.slice(0, 64), name: [variant.color, variant.size].filter(Boolean).join(' '),
      size: variant.size!, color: variant.color!, stock: variant.stock!, sortOrder: index,
    })),
  }
  let status: string
  try {
    status = await applyConfirmedTelegramProductCreation(ctx.db, {
      operationId: operation.operation_id, chatId: String(ctx.chatId), storeId: ctx.store.id, actor: `telegram:${ctx.telegramUserId}`,
      paramsJson, beforeJson: operation.before_json, afterJson, category, product,
    })
  } catch (error) {
    let committed = false
    try {
      const result = await ctx.db.prepare(`SELECT o.status, p.image_urls FROM telegram_operations o LEFT JOIN products p ON p.store_id = ? AND p.sku = ? WHERE o.operation_id = ?`)
        .bind(ctx.store.id, product.sku, operation.operation_id).first<{ status: string; image_urls: string | null }>()
      const savedUrls = result?.image_urls ? JSON.parse(result.image_urls) as string[] : []
      committed = result?.status === 'applied' && promoted.keys.every((key) => savedUrls.includes(`/api/assets/${key}`))
    } catch { /* keep promoted assets when the commit status cannot be determined */ }
    if (!committed) {
      try { await Promise.all(promoted.keys.map((key) => ctx.env.ASSETS!.delete(key))) } catch { console.error('Telegram product promotion cleanup deferred to the asset sweeper') }
      console.error('Telegram product D1 publish failed:', error instanceof Error ? error.message : 'unknown error')
      await say(ctx, 'No pude publicar el producto. No se guardó nada y tus fotos siguen en el borrador: puedes intentarlo nuevamente.')
      return
    }
    status = 'applied'
  }
  if (status !== 'applied') {
    await Promise.all(promoted.keys.map((key) => ctx.env.ASSETS!.delete(key)))
    const messages: Record<string, string> = {
      sku_exists: 'Ese código ya existe en tu tienda. Cámbialo en “Editar información”.',
      stale: 'La categoría o el borrador cambió desde la vista previa. Revisa de nuevo antes de publicar.',
      expired: 'El borrador venció. Empecemos de nuevo cuando quieras.',
      not_pending: 'Este producto ya se publicó o se canceló. No se duplicó.',
    }
    await say(ctx, messages[status] || 'No se pudo publicar el producto.')
    return
  }
  await deleteTelegramDraftTempImages(ctx.env.ASSETS, operation.operation_id)
  const saved = await ctx.db.prepare(
    `SELECT p.name, p.sku, p.price, COUNT(v.id) AS variant_count, COALESCE(SUM(v.stock), 0) AS stock
     FROM products p LEFT JOIN product_variants v ON v.product_id = p.id WHERE p.store_id = ? AND p.sku = ? GROUP BY p.id`,
  ).bind(ctx.store.id, product.sku).first<{ name: string; sku: string; price: number; variant_count: number; stock: number }>().catch(() => null)
  const url = `${publicStoreUrl(ctx.env.PUBLIC_STORE_BASE_URL, ctx.store).replace(/\/$/, '')}/producto/${encodeURIComponent(product.sku)}`
  const mainPhoto = draft.images[draft.primaryImageIndex]!
  await rememberTurn(ctx, 'assistant', `Publiqué el producto ${product.name} (${product.sku}).`)
  await sayPhoto(ctx, mainPhoto.telegramFileId,
    `✅ <b>¡Producto publicado!</b>\n${escapeHtml(saved?.name || product.name)}\nCódigo: ${escapeHtml(product.sku)} · ${formatMoney(Number(saved?.price ?? product.price), ctx.store.currency)}\n` +
    `Stock: ${saved?.stock ?? product.variants.reduce((sum, variant) => sum + variant.stock, 0)} u. · Fotos: ${imageUrls.length}\n\nYa está visible en tu tienda:\n${escapeHtml(url)}`,
    backToMenu())
  await advanceAfterPublishedProduct(ctx)
}
