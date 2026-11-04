import { downloadTelegramImage, deleteTelegramDraftImages, deleteTelegramDraftTempImages, promoteTelegramDraftImages, storeTelegramDraftImage } from '../telegramProductImages'
import { roleAllows } from '../../tenancy/access'
import { readSession, say, sayPhoto, updateSessionState, type AssistantContext } from './context'
import { proposeChange, type PendingOperation } from './operations'
import { escapeHtml } from './tools'
import { backToMenu } from './menus'
import type { TelegramMessage } from './telegramApi'
import { getOnboarding, storeOnboardingLogoOptions } from './onboarding'
import { analyzeLogoColors } from './ai'
import { palettesFromColors, palettesFromPng } from './logoPalette'
import { bytesToBase64 } from './telegramApi'

export function photoFileId(message: TelegramMessage): string | null {
  const document = message.document
  if (document && (!document.mime_type?.startsWith('image/') || !/\.(jpe?g|png|webp)$/i.test(document.file_name || ''))) return null
  return message.photo?.at(-1)?.file_id || document?.file_id || null
}

/** Uploads a private draft of a banner or logo and shows a confirmable preview. */
export async function proposeStoreImage(ctx: AssistantContext, kind: 'banner' | 'logo', fileId: string): Promise<void> {
  if (!roleAllows(ctx.role, 'admin')) { await say(ctx, 'Tu rol no permite cambiar la apariencia de la tienda.'); return }
  if (!ctx.env.ASSETS) { await say(ctx, 'El almacenamiento de imágenes no está disponible. No cambié nada.'); return }
  let image
  try {
    image = await downloadTelegramImage(ctx.botToken, fileId)
  } catch {
    await say(ctx, 'No pude usar esa imagen. Envía una foto JPG, PNG o WebP de buena calidad.')
    return
  }
  if (kind === 'logo') {
    const onboarding = await getOnboarding(ctx)
    if (onboarding?.status === 'in_progress' && onboarding.step === 'logo') {
      let options = image.contentType === 'image/png' ? await palettesFromPng(image.bytes).catch(() => null) : null
      if (!options && ctx.env.GEMINI_API_KEY && image.bytes.byteLength <= 8 * 1024 * 1024) {
        const vision = await analyzeLogoColors(ctx, { mimeType: image.contentType, data: bytesToBase64(image.bytes) })
        if (vision.ok) options = palettesFromColors(vision.value.primaryColor, vision.value.accentColor)
      }
      await storeOnboardingLogoOptions(ctx, options)
    }
  }
  if (kind === 'banner' && image.width < 800) {
    await say(ctx, `La imagen mide ${image.width}×${image.height} px. Para el banner usa una foto horizontal de al menos 800 px de ancho (ideal 1600 px).`)
    return
  }
  const operationId = crypto.randomUUID()
  const stored = await storeTelegramDraftImage(ctx.env.ASSETS, operationId, image, fileId)
  const finalKey = `stores/${ctx.store.id}/store/${kind}-${operationId}.${image.extension}`
  await updateSessionState(ctx, { awaiting: undefined, pendingPhotoFileId: undefined })
  await proposeChange(ctx, kind === 'banner' ? 'update_store_banner' : 'update_store_logo', {
    imageUrl: `/api/assets/${finalKey}`, draftKey: stored.tempKey, finalKey, contentType: image.contentType,
  }, kind === 'banner' ? 'Así quedaría el nuevo banner principal de tu tienda.' : 'Este sería tu nuevo logotipo.', { photoFileId: fileId, operationId })
}

type AttachDraft = { version: 1; kind: 'attach'; sku: string; name: string; images: Array<{ tempKey: string; telegramFileId: string; contentType: string; extension: string }> }

export async function getPendingAttach(ctx: AssistantContext): Promise<{ operation: PendingOperation; draft: AttachDraft } | null> {
  const operation = await ctx.db.prepare(
    `SELECT operation_id, action, params_json, before_json, after_json, store_id FROM telegram_operations
     WHERE chat_id = ? AND store_id = ? AND action = 'add_product_photos' AND status = 'pending' AND expires_at > unixepoch()
     ORDER BY created_at DESC LIMIT 1`,
  ).bind(String(ctx.chatId), ctx.store.id).first<PendingOperation>()
  if (!operation) return null
  try { return { operation, draft: JSON.parse(operation.params_json) as AttachDraft } } catch { return null }
}

/** Starts collecting new photos for an existing product. */
export async function beginAttachPhotos(ctx: AssistantContext, sku: string): Promise<string | null> {
  if (!roleAllows(ctx.role, 'admin')) { await say(ctx, 'Tu rol no permite cambiar fotos de productos.'); return null }
  const product = await ctx.db.prepare('SELECT sku, name, image_urls FROM products WHERE store_id = ? AND upper(sku) = upper(?) AND is_archived = 0').bind(ctx.store.id, sku).first<{ sku: string; name: string; image_urls: string }>()
  if (!product) { await say(ctx, `No encontré el producto ${escapeHtml(sku)} en tu catálogo.`); return null }
  const operationId = crypto.randomUUID()
  const draft: AttachDraft = { version: 1, kind: 'attach', sku: product.sku, name: product.name, images: [] }
  try {
    await ctx.db.prepare(
      `INSERT INTO telegram_operations (operation_id, update_id, chat_id, store_id, action, params_json, before_json, after_json, expires_at)
       VALUES (?, ?, ?, ?, 'add_product_photos', ?, ?, '{}', unixepoch() + 3600)`,
    ).bind(operationId, ctx.updateId, String(ctx.chatId), ctx.store.id, JSON.stringify(draft), JSON.stringify({ image_urls: product.image_urls })).run()
  } catch (error) {
    if (error instanceof Error && /unique constraint/i.test(error.message)) { await say(ctx, 'Tienes otra operación abierta. Termínala o cancélala con /cancelar.'); return null }
    throw error
  }
  await say(ctx, `📸 Envíame las fotos nuevas para <b>${escapeHtml(product.name)}</b>. Cuando termines, toca “Listo”.`, {
    inline_keyboard: [[{ text: '✅ Listo', callback_data: `ap:done:${operationId}` }, { text: '✖ Cancelar', callback_data: `ap:cancel:${operationId}` }]],
  })
  return operationId
}

export async function receiveAttachPhoto(ctx: AssistantContext, fileId: string): Promise<void> {
  const pending = await getPendingAttach(ctx)
  if (!pending || !ctx.env.ASSETS) { await say(ctx, 'No hay fotos pendientes por agregar.'); return }
  let image
  try { image = await downloadTelegramImage(ctx.botToken, fileId) }
  catch { await say(ctx, 'No pude usar esa imagen. Envía una foto JPG, PNG o WebP.'); return }
  const stored = await storeTelegramDraftImage(ctx.env.ASSETS, pending.operation.operation_id, image, fileId)
  for (let attempt = 0; attempt < 4; attempt++) {
    const latest = await getPendingAttach(ctx)
    if (!latest || latest.operation.operation_id !== pending.operation.operation_id || latest.draft.images.length >= 10) break
    const next = { ...latest.draft, images: [...latest.draft.images, { tempKey: stored.tempKey, telegramFileId: fileId, contentType: stored.contentType, extension: stored.extension }] }
    const result = await ctx.db.prepare(`UPDATE telegram_operations SET params_json = ? WHERE operation_id = ? AND status = 'pending' AND params_json = ?`)
      .bind(JSON.stringify(next), latest.operation.operation_id, latest.operation.params_json).run()
    if (result.meta.changes) {
      await say(ctx, `Recibí ${next.images.length} foto(s) para ${escapeHtml(next.name)}. Envía más o toca “Listo”.`, {
        inline_keyboard: [[{ text: '✅ Listo', callback_data: `ap:done:${pending.operation.operation_id}` }, { text: '✖ Cancelar', callback_data: `ap:cancel:${pending.operation.operation_id}` }]],
      })
      return
    }
  }
  await ctx.env.ASSETS.delete(stored.tempKey)
  await say(ctx, 'No pude guardar esa foto. Intenta enviarla de nuevo.')
}

export async function handleAttachCallback(ctx: AssistantContext, intent: string, operationId: string): Promise<void> {
  const pending = await getPendingAttach(ctx)
  if (!pending || pending.operation.operation_id !== operationId) { await say(ctx, 'Esa carga de fotos ya venció o se procesó.'); return }
  if (intent === 'cancel') {
    await ctx.db.prepare(`UPDATE telegram_operations SET status = 'cancelled', completed_at = datetime('now') WHERE operation_id = ? AND status = 'pending'`).bind(operationId).run()
    if (ctx.env.ASSETS) await deleteTelegramDraftImages(ctx.env.ASSETS, operationId, ctx.store.id)
    await say(ctx, 'Cancelado. El producto no cambió.', backToMenu())
    return
  }
  if (intent === 'done') {
    if (!pending.draft.images.length) { await say(ctx, 'Aún no recibo fotos. Envíame al menos una.'); return }
    const before = JSON.parse(pending.operation.before_json) as { image_urls: string }
    const current = (() => { try { return (JSON.parse(before.image_urls || '[]') as string[]).length } catch { return 0 } })()
    await sayPhoto(ctx, pending.draft.images[0]!.telegramFileId,
      `<b>Revisa este cambio</b>\nAgregar ${pending.draft.images.length} foto(s) a <b>${escapeHtml(pending.draft.name)}</b> (${escapeHtml(pending.draft.sku)}).\nFotos actuales: ${current} → <b>${current + pending.draft.images.length}</b>\n\n<i>Nada cambia hasta que confirmes.</i>`,
      { inline_keyboard: [[{ text: '✅ Agregar fotos', callback_data: `ap:confirm:${operationId}` }, { text: '✖ Cancelar', callback_data: `ap:cancel:${operationId}` }]] })
    return
  }
  if (intent !== 'confirm' || !ctx.env.ASSETS) return
  if (!roleAllows(ctx.role, 'admin')) { await say(ctx, 'Tu rol no permite cambiar fotos de productos.'); return }
  const before = JSON.parse(pending.operation.before_json) as { image_urls: string }
  let existing: string[] = []
  try { existing = JSON.parse(before.image_urls || '[]') as string[] } catch { existing = [] }
  let promoted: { keys: string[] }
  try {
    promoted = await promoteTelegramDraftImages(ctx.env.ASSETS, operationId, pending.draft.images, ctx.store.id)
  } catch {
    await say(ctx, 'Una de las fotos ya no está disponible. Envíalas de nuevo; el producto no cambió.')
    return
  }
  const nextUrls = [...existing, ...promoted.keys.map((key) => `/api/assets/${key}`)].slice(0, 20)
  const token = crypto.randomUUID()
  const gate = `EXISTS (SELECT 1 FROM telegram_operations WHERE operation_id = ? AND status = 'applying' AND execution_token = ?)`
  const results = await ctx.db.batch([
    ctx.db.prepare(`UPDATE telegram_operations SET status = 'applying', execution_token = ? WHERE operation_id = ? AND chat_id = ? AND store_id = ? AND status = 'pending' AND expires_at > unixepoch() AND params_json = ?`)
      .bind(token, operationId, String(ctx.chatId), ctx.store.id, pending.operation.params_json),
    ctx.db.prepare(`UPDATE products SET image_urls = ?, updated_at = datetime('now') WHERE store_id = ? AND sku = ? AND image_urls = ? AND ${gate}`)
      .bind(JSON.stringify(nextUrls), ctx.store.id, pending.draft.sku, before.image_urls, operationId, token),
    ctx.db.prepare(`INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id) SELECT 'product_photos_added', 'product', ?, ?, ?, 'telegram', ? WHERE ${gate}`)
      .bind(pending.draft.sku, JSON.stringify({ operationId, added: promoted.keys.length }), `telegram:${ctx.telegramUserId}`, ctx.store.id, operationId, token),
    ctx.db.prepare(`UPDATE telegram_operations SET status = 'applied', execution_token = NULL, completed_at = datetime('now')
      WHERE operation_id = ? AND status = 'applying' AND execution_token = ? AND EXISTS (SELECT 1 FROM products WHERE store_id = ? AND sku = ? AND image_urls = ?)`)
      .bind(operationId, token, ctx.store.id, pending.draft.sku, JSON.stringify(nextUrls)),
  ])
  if (Number(results[0]?.meta.changes || 0) !== 1 || Number(results[1]?.meta.changes || 0) !== 1) {
    await Promise.all(promoted.keys.map((key) => ctx.env.ASSETS!.delete(key)))
    await ctx.db.prepare(`UPDATE telegram_operations SET status = 'stale', completed_at = datetime('now') WHERE operation_id = ? AND status IN ('pending', 'applying')`).bind(operationId).run()
    await say(ctx, 'El producto cambió mientras preparaba las fotos. No apliqué nada; inténtalo de nuevo.')
    return
  }
  await deleteTelegramDraftTempImages(ctx.env.ASSETS, operationId).catch(() => undefined)
  await say(ctx, `✅ ¡Listo! Agregué ${promoted.keys.length} foto(s) a ${escapeHtml(pending.draft.name)}.`, backToMenu())
}

/** Photo received without a pending flow: ask what to do with it. */
export async function askWhatToDoWithPhoto(ctx: AssistantContext, fileId: string): Promise<void> {
  await updateSessionState(ctx, { pendingPhotoFileId: fileId })
  await say(ctx, '¡Linda foto! ¿Qué hago con ella?', { inline_keyboard: [
    [{ text: '➕ Crear un producto', callback_data: 'ph:product' }],
    [{ text: '🖼️ Usar como banner', callback_data: 'ph:banner' }, { text: '🔖 Usar como logo', callback_data: 'ph:logo' }],
    [{ text: '✖ Nada', callback_data: 'ph:none' }],
  ] })
}

export async function pendingPhotoFromSession(ctx: AssistantContext): Promise<string | null> {
  const session = await readSession(ctx.db, ctx.telegramUserId)
  return session.state.pendingPhotoFileId || null
}
