/**
 * Store assistant for Telegram (Sistema B). One shared bot serves every store:
 * the Telegram user is mapped to store memberships in the backend, and every
 * action runs inside exactly one store with the user's role.
 */
import type { Env } from '../index'
import { interpretCommand } from '../ai/interpreter'
import { executeReadAction } from '../ai/executor'
import { READ_ONLY_ACTIONS, type ActionName } from '../validation/actions'
import { PRIMARY_STORE_ID } from '../tenancy/stores'
import { roleAllows, type Membership } from '../tenancy/access'
import { consumeAccessToken, linkTelegramToUser, normalizeLinkCode } from './platformUsers'
import {
  answerCallback, downloadTelegramVoice, sendChatAction, sendTelegramMessage,
  type TelegramMessage, type TelegramUpdate,
} from './assistant/telegramApi'
import {
  loadAssistantStore, membershipsForTelegramUser, readSession, rememberTurn, say, updateSessionState, writeSession,
  type AssistantContext,
} from './assistant/context'
import { appearanceKeyboard, backToMenu, greeting, HELP_TEXT, inventoryKeyboard, mainMenuKeyboard, orderMenuKeyboard, storePickerKeyboard } from './assistant/menus'
import { cancelOperation, confirmOperation, formatOperationPreview, getPendingOperation, isConfirmableAction, proposeChange } from './assistant/operations'
import { acceptProductDraftText, beginProductDraft, cancelProductDraft, getPendingProductDraft, handleProductDraftCallback, receiveProductPhoto } from './assistant/productDraft'
import { askWhatToDoWithPhoto, beginAttachPhotos, getPendingAttach, handleAttachCallback, pendingPhotoFromSession, photoFileId, proposeStoreImage, receiveAttachPhoto } from './assistant/media'
import { handleDocument, isSupportedDocument } from './assistant/documents'
import { answerWithStoreFacts, draftProductDescription, interpretRequest } from './assistant/ai'
import { detectIntent } from './assistant/intents'
import { catalogFacts, deterministicAdvice, escapeHtml, storeSummaryTool } from './assistant/tools'

export { sendTelegramMessage, downloadTelegramVoice }
export type { TelegramMessage, TelegramUpdate, TelegramCallbackQuery, TelegramSendMessageResponse } from './assistant/telegramApi'

const CONFIRM_WORDS = /^(s[ií]|si,? confirmo|confirmar|confirmo|ok|okay|dale|aprobar|apruebo|de acuerdo|hazlo)[.!]*$/i
const CANCEL_WORDS = /^(no|cancelar|cancela|cancelado|olv[ií]dalo|mejor no)[.!]*$/i

/** Builds the per-update context. Returns null when the user has no store, or
 * asks the user to pick a store when several are available. */
async function buildContext(update: TelegramUpdate, env: Env['Bindings'], db: D1Database, memberships?: Membership[]): Promise<AssistantContext | null> {
  const botToken = env.TELEGRAM_BOT_TOKEN
  const message = update.message || update.callback_query?.message
  const from = update.message?.from || update.callback_query?.from
  if (!botToken || !message || !from || message.chat.type !== 'private' || message.chat.id !== from.id) return null
  const telegramUserId = String(from.id)
  const available = memberships ?? await membershipsForTelegramUser(db, env, telegramUserId)
  if (!available.length) return null
  const session = await readSession(db, telegramUserId)
  const selection = update.callback_query?.data?.match(/^s:select:(\d+)$/)
  let storeId = selection ? Number(selection[1]) : session.activeStoreId
  if (!storeId || !available.some((membership) => membership.storeId === storeId)) storeId = available.length === 1 ? available[0]!.storeId : null
  if (!storeId) {
    await sendTelegramMessage(botToken, message.chat.id, `¡Hola${from.first_name ? `, ${escapeHtml(from.first_name)}` : ''}! 👋 Administras varias tiendas. ¿Con cuál quieres trabajar?`, 'HTML', storePickerKeyboard(available))
    if (update.callback_query) await answerCallback(botToken, update.callback_query.id).catch(() => undefined)
    return null
  }
  const membership = available.find((item) => item.storeId === storeId)!
  const store = await loadAssistantStore(db, storeId, env.STORE_CURRENCY || 'COP')
  if (!store) return null
  if (store.status === 'suspended') {
    await sendTelegramMessage(botToken, message.chat.id, `La tienda <b>${escapeHtml(store.name)}</b> está suspendida en este momento. Si crees que es un error, contacta a soporte.`, 'HTML')
    return null
  }
  if (session.activeStoreId !== storeId) await writeSession(db, telegramUserId, storeId, selection ? {} : session.state)
  return {
    db, env, botToken, chatId: message.chat.id, telegramUserId, firstName: from.first_name || '', updateId: update.update_id,
    store, role: membership.role, memberships: available,
  }
}

export async function processTelegramUpdate(
  update: TelegramUpdate,
  env: Env['Bindings'],
  db: D1Database,
  options: { memberships?: Membership[] } = {},
): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) {
    console.error('TELEGRAM_BOT_TOKEN not configured')
    return
  }
  const ctx = await buildContext(update, env, db, options.memberships)
  if (!ctx) return
  try {
    if (update.callback_query) {
      await answerCallback(ctx.botToken, update.callback_query.id).catch(() => undefined)
      await handleCallback(ctx, update.callback_query.data || '')
      return
    }
    const message = update.message!
    if (message.photo?.length || (message.document && !isSupportedDocument(message))) {
      await handlePhoto(ctx, message)
      return
    }
    if (message.document) {
      await handleDocument(ctx, message)
      return
    }
    if (message.voice || message.audio) {
      await handleVoice(ctx, message)
      return
    }
    if (!message.text) {
      await say(ctx, 'Puedo trabajar con texto, notas de voz, fotos y archivos CSV o PDF. ¿Qué necesitas?', mainMenuKeyboard(ctx.memberships.length > 1))
      return
    }
    await handleText(ctx, message.text.trim())
  } catch (error) {
    // Technical detail goes to logs and platform events; the owner gets a calm message.
    console.error('Assistant update failed:', error instanceof Error ? error.message : 'unknown error')
    await ctx.db.prepare(`INSERT INTO platform_events (store_id, level, source, code, detail) VALUES (?, 'error', 'assistant', 'UPDATE_FAILED', ?)`)
      .bind(ctx.store.id, (error instanceof Error ? error.message : 'unknown').slice(0, 200)).run().catch(() => undefined)
    await say(ctx, 'Algo no salió bien y no se modificó nada. Puedes intentarlo nuevamente.', backToMenu()).catch(() => undefined)
  }
}

async function handleCallback(ctx: AssistantContext, data: string): Promise<void> {
  const key = data.trim()
  const select = key.match(/^s:select:(\d+)$/)
  if (select) {
    await say(ctx, greeting(ctx.firstName, ctx.store.name), mainMenuKeyboard(ctx.memberships.length > 1))
    return
  }
  const product = key.match(/^pd:(preview|edit|publish|cancel|done|field|photo|main|cat|newcat|sku):([0-9a-f-]{36})(?::([a-z_]+|\d+))?$/i)
  if (product) { await handleProductDraftCallback(ctx, product[1]!.toLowerCase(), product[2]!, product[3]); return }
  const attach = key.match(/^ap:(done|confirm|cancel):([0-9a-f-]{36})$/)
  if (attach) { await handleAttachCallback(ctx, attach[1]!, attach[2]!); return }
  const operation = key.match(/^op:(preview|confirm|cancel):([0-9a-f-]{36})$/i)
  if (operation) {
    const [, intent, operationId] = operation
    if (intent === 'cancel') {
      const cancelled = await cancelOperation(ctx, operationId)
      await say(ctx, cancelled ? 'Listo, lo cancelé. Tu tienda no cambió.' : 'Esa propuesta ya venció o se procesó.', backToMenu())
      return
    }
    const pending = await getPendingOperation(ctx, operationId)
    if (!pending) { await say(ctx, 'Esa propuesta ya venció o se procesó. Pídemela de nuevo si la necesitas.'); return }
    if (intent === 'preview') {
      await say(ctx, `<b>Revisa este cambio</b>\n${formatOperationPreview(pending, ctx.store.currency)}\n\n<i>Nada cambia hasta que confirmes.</i>`, {
        inline_keyboard: [[{ text: '✅ Confirmar', callback_data: `op:confirm:${operationId}` }, { text: '✖ Cancelar', callback_data: `op:cancel:${operationId}` }]],
      })
      return
    }
    await confirmOperation(ctx, pending)
    return
  }
  const photo = key.match(/^ph:(product|banner|logo|none)$/)
  if (photo) {
    const fileId = await pendingPhotoFromSession(ctx)
    await updateSessionState(ctx, { pendingPhotoFileId: undefined })
    if (photo[1] === 'none' || !fileId) { await say(ctx, 'De acuerdo, no hice nada con la foto.'); return }
    if (photo[1] === 'banner' || photo[1] === 'logo') { await proposeStoreImage(ctx, photo[1], fileId); return }
    await beginProductDraft(ctx)
    const active = await getPendingProductDraft(ctx)
    if (active) await receiveProductPhoto(ctx, active, { message_id: 0, chat: { id: ctx.chatId, type: 'private' }, date: 0, photo: [{ file_id: fileId }] })
    return
  }
  await handleMenu(ctx, key)
}

async function readAndReply(ctx: AssistantContext, action: ActionName, params: Record<string, unknown> = {}, keyboard?: Record<string, unknown>): Promise<void> {
  const result = await executeReadAction(ctx.db, action, params, { storeId: ctx.store.id, currency: ctx.store.currency })
  if (result.skus?.length) await updateSessionState(ctx, { lastSkus: result.skus.slice(0, 20) })
  await rememberTurn(ctx, 'assistant', result.message)
  await say(ctx, result.message, keyboard ?? backToMenu())
}

async function handleMenu(ctx: AssistantContext, key: string): Promise<void> {
  switch (key) {
    case 'm:menu': await say(ctx, '¿Qué hacemos ahora?', mainMenuKeyboard(ctx.memberships.length > 1)); return
    case 'm:switch_store': await say(ctx, '¿Con qué tienda quieres trabajar?', storePickerKeyboard(ctx.memberships)); return
    case 'm:new_product': await beginProductDraft(ctx); return
    case 'm:help': await say(ctx, HELP_TEXT, backToMenu()); return
    case 'm:inventory': await readAndReply(ctx, 'get_inventory', {}, inventoryKeyboard()); return
    case 'm:low_stock': await readAndReply(ctx, 'get_low_stock', { threshold: 5 }, inventoryKeyboard()); return
    case 'm:out_of_stock': {
      await readAndReply(ctx, 'get_out_of_stock', {}, { inline_keyboard: [[{ text: '🙈 Ocultar agotados', callback_data: 'm:hide_out' }], [{ text: '↩ Menú principal', callback_data: 'm:menu' }]] })
      return
    }
    case 'm:hide_out': await proposeChange(ctx, 'hide_out_of_stock', {}); return
    case 'm:no_description': await readAndReply(ctx, 'get_products_without_description', {}, inventoryKeyboard()); return
    case 'm:no_photos': await readAndReply(ctx, 'get_products_without_photos', {}, inventoryKeyboard()); return
    case 'm:orders': await readAndReply(ctx, 'get_sales_summary', { days: 30 }, orderMenuKeyboard()); return
    case 'm:orders_pending': await readAndReply(ctx, 'get_pending_orders', {}, orderMenuKeyboard()); return
    case 'm:sales': await readAndReply(ctx, 'get_sales_summary', { days: 30 }, orderMenuKeyboard()); return
    case 'm:top': await readAndReply(ctx, 'get_top_products', { days: 30 }, orderMenuKeyboard()); return
    case 'm:reports': await readAndReply(ctx, 'get_sales_summary', { days: 30 }, orderMenuKeyboard()); return
    case 'm:categories': {
      const result = await ctx.db.prepare(
        `SELECT c.name, COUNT(p.id) AS count FROM categories c LEFT JOIN products p ON p.category_id = c.id AND p.store_id = c.store_id AND p.is_active = 1 AND p.is_archived = 0
         WHERE c.store_id = ? AND c.is_active = 1 GROUP BY c.id ORDER BY c.sort_order, c.name`,
      ).bind(ctx.store.id).all<{ name: string; count: number }>()
      const rows = result.results || []
      await say(ctx, rows.length ? `🏷️ <b>Tus categorías</b>\n${rows.map((row) => `• ${escapeHtml(row.name)} — ${row.count} producto(s)`).join('\n')}\n\nPara organizar productos escribe, por ejemplo: “Mueve ABC123 y XYZ789 a la categoría Ofertas”.` : 'Aún no tienes categorías. Puedes crearlas al agregar un producto.', backToMenu())
      return
    }
    case 'm:appearance':
    case 'm:store':
    case 'm:settings': {
      const summary = await storeSummaryTool(ctx.db, ctx.store.id)
      await say(ctx, `${summary.text}\n\n¿Qué quieres cambiar?`, appearanceKeyboard())
      return
    }
    case 'm:banner':
    case 'm:logo':
      await updateSessionState(ctx, { awaiting: key === 'm:banner' ? 'banner_photo' : 'logo_photo' })
      await say(ctx, key === 'm:banner' ? '🖼️ Envíame la foto para el banner principal (horizontal, idealmente 1600 px de ancho).' : '🔖 Envíame la imagen de tu logotipo (cuadrada, fondo limpio).')
      return
    case 'm:ask_ai':
      await updateSessionState(ctx, { awaiting: 'ask_ai' })
      await say(ctx, '✨ ¿Qué quieres preguntarme? Puedo darte ideas para tu catálogo, tus descripciones o tus ventas, basándome en los datos de tu tienda.')
      return
    case 'm:featured':
      await say(ctx, '⭐ Escríbeme los códigos de los productos que quieres destacar, por ejemplo: “Pon ABC123, XYZ789 como destacados”.')
      return
  }
  const prompts: Record<string, string> = {
    'm:name': 'Escribe el nuevo nombre. Ejemplo: “Cambia el nombre de mi tienda a Moda Urbana”.',
    'm:primary_color': 'Escribe el color. Ejemplo: “Cambia el color principal a azul oscuro” o un código como #153D70.',
    'm:hero_title': 'Escribe el nuevo título. Ejemplo: “Cambia el título de portada a Viste a tu manera”.',
    'm:whatsapp': 'Escribe el WhatsApp con código de país. Ejemplo: “Mi WhatsApp es +573001234567”.',
    'm:hours': 'Escribe tu horario. Ejemplo: “Mi horario es lunes a sábado de 9 a. m. a 7 p. m.”.',
  }
  await say(ctx, prompts[key] || 'Ese botón ya no está disponible. Aquí tienes el menú:', prompts[key] ? undefined : mainMenuKeyboard(ctx.memberships.length > 1))
}

async function handlePhoto(ctx: AssistantContext, message: TelegramMessage): Promise<void> {
  const fileId = photoFileId(message)
  if (!fileId) {
    await say(ctx, 'Ese tipo de archivo no es compatible. Envía fotos JPG, PNG o WebP, o archivos CSV/PDF.')
    return
  }
  const draft = await getPendingProductDraft(ctx)
  if (draft) { await receiveProductPhoto(ctx, draft, message); return }
  if (await getPendingAttach(ctx)) { await receiveAttachPhoto(ctx, fileId); return }
  const session = await readSession(ctx.db, ctx.telegramUserId)
  if (session.state.awaiting === 'banner_photo' || session.state.awaiting === 'logo_photo') {
    await proposeStoreImage(ctx, session.state.awaiting === 'banner_photo' ? 'banner' : 'logo', fileId)
    return
  }
  const caption = (message.caption || '').trim()
  if (caption) {
    const intent = detectIntent(caption, session.state.lastSkus)
    if (intent?.kind === 'change_store_image') { await proposeStoreImage(ctx, intent.target, fileId); return }
    if (intent?.kind === 'attach_photos') {
      const operationId = await beginAttachPhotos(ctx, intent.sku)
      if (operationId) await receiveAttachPhoto(ctx, fileId)
      return
    }
    if (intent?.kind === 'start_product' || /producto|vender|agrega|publica/i.test(caption)) {
      await beginProductDraft(ctx, undefined, caption)
      const active = await getPendingProductDraft(ctx)
      if (active) await receiveProductPhoto(ctx, active, message)
      return
    }
  }
  await askWhatToDoWithPhoto(ctx, fileId)
}

async function handleVoice(ctx: AssistantContext, message: TelegramMessage): Promise<void> {
  const voice = message.voice || message.audio!
  if (!ctx.env.GEMINI_API_KEY) { await say(ctx, 'Las notas de voz necesitan la IA, que aún no está activada. Escríbeme tu solicitud, por favor.'); return }
  if (voice.duration > 120) { await say(ctx, 'La nota de voz es muy larga. Envíame una de máximo 2 minutos.'); return }
  if (message.audio && !/ogg|opus/i.test(message.audio.mime_type || '')) { await say(ctx, 'Envíame el audio como nota de voz de Telegram (mantén presionado el micrófono).'); return }
  await sendChatAction(ctx.botToken, ctx.chatId)
  let audio: { mimeType: 'audio/ogg'; data: string }
  try {
    audio = await downloadTelegramVoice(ctx.botToken, voice.file_id)
  } catch (error) {
    console.error('Telegram voice download failed:', error instanceof Error ? error.message : 'unknown')
    await say(ctx, 'No pude escuchar la nota de voz. ¿Puedes enviarla otra vez o escribirlo?')
    return
  }
  const outcome = await interpretRequest(ctx, 'Interpreta la nota de voz adjunta.', audio)
  if (!outcome.ok) { await say(ctx, outcome.message); return }
  const transcript = outcome.value.transcript?.trim()
  if (!transcript) { await say(ctx, 'No logré entender el audio. ¿Puedes repetirlo con más claridad o escribirlo?'); return }
  await say(ctx, `🎙️ Entendí: <i>“${escapeHtml(transcript)}”</i>`)
  await rememberTurn(ctx, 'user', transcript)
  // Pending drafts take precedence: the transcript answers the current question.
  const draft = await getPendingProductDraft(ctx)
  if (draft) { await acceptProductDraftText(ctx, draft, transcript); return }
  await handleProposal(ctx, outcome.value, transcript)
}

async function handleCommand(ctx: AssistantContext, text: string): Promise<boolean> {
  const command = (text.split(/\s+/)[0] || '').split('@')[0]!.toLowerCase()
  switch (command) {
    case '/start': {
      const memoryRow = await ctx.db.prepare('SELECT COUNT(*) AS n FROM assistant_messages WHERE store_id = ? AND telegram_user_id = ?').bind(ctx.store.id, ctx.telegramUserId).first<{ n: number }>()
      await say(ctx, greeting(ctx.firstName, ctx.store.name, !Number(memoryRow?.n)), mainMenuKeyboard(ctx.memberships.length > 1))
      await rememberTurn(ctx, 'assistant', 'Saludo inicial')
      return true
    }
    case '/menu': await say(ctx, '¿Qué hacemos ahora?', mainMenuKeyboard(ctx.memberships.length > 1)); return true
    case '/ayuda':
    case '/help': await say(ctx, HELP_TEXT, backToMenu()); return true
    case '/tienda':
    case '/tiendas':
      if (ctx.memberships.length > 1) await say(ctx, '¿Con qué tienda quieres trabajar?', storePickerKeyboard(ctx.memberships))
      else await say(ctx, `Administras <b>${escapeHtml(ctx.store.name)}</b>.`)
      return true
    case '/estado':
    case '/stats':
    case '/estadisticas': await readAndReply(ctx, 'get_inventory'); return true
    case '/productos': await readAndReply(ctx, 'get_products'); return true
    case '/inventario': await readAndReply(ctx, 'get_inventory', {}, inventoryKeyboard()); return true
    case '/agotados': await readAndReply(ctx, 'get_out_of_stock'); return true
    case '/pedido':
    case '/pedidos': await readAndReply(ctx, 'get_pending_orders', {}, orderMenuKeyboard()); return true
    case '/categorias': await handleMenu(ctx, 'm:categories'); return true
    case '/nuevo_producto':
    case '/crear_producto':
    case '/agregar': await beginProductDraft(ctx); return true
    case '/consejos': await handleProposal(ctx, { action: 'catalog_advice', params: {}, missing: [], summary: '', needsConfirmation: false }, text); return true
    case '/cancelar': {
      const draft = await getPendingProductDraft(ctx)
      if (draft) { await cancelProductDraft(ctx, draft.operation.operation_id); await say(ctx, 'Cancelé el borrador del producto. No se publicó nada.', backToMenu()); return true }
      const attach = await getPendingAttach(ctx)
      if (attach) { await handleAttachCallback(ctx, 'cancel', attach.operation.operation_id); return true }
      const cancelled = await cancelOperation(ctx)
      await updateSessionState(ctx, { awaiting: undefined, pendingPhotoFileId: undefined })
      await say(ctx, cancelled ? 'Listo, cancelé la propuesta. Tu tienda no cambió.' : 'No hay nada pendiente por cancelar. Los cambios ya confirmados no se revierten con /cancelar.', backToMenu())
      return true
    }
    default:
      await say(ctx, 'No conozco ese comando. Escribe /ayuda o cuéntame qué necesitas con tus palabras.', mainMenuKeyboard(ctx.memberships.length > 1))
      return true
  }
}

async function handleText(ctx: AssistantContext, text: string): Promise<void> {
  if (text.startsWith('/')) { await handleCommand(ctx, text); return }
  await rememberTurn(ctx, 'user', text)
  const draft = await getPendingProductDraft(ctx)
  if (draft) {
    if (CANCEL_WORDS.test(text)) { await cancelProductDraft(ctx, draft.operation.operation_id); await say(ctx, 'Cancelé el borrador del producto. No se publicó nada.', backToMenu()); return }
    if (CONFIRM_WORDS.test(text) && !draft.draft.awaiting) { await say(ctx, 'Para publicarlo, toca “Publicar producto” en la vista previa.'); return }
    await acceptProductDraftText(ctx, draft, text)
    return
  }
  const attach = await getPendingAttach(ctx)
  if (attach) {
    if (CANCEL_WORDS.test(text)) { await handleAttachCallback(ctx, 'cancel', attach.operation.operation_id); return }
    await say(ctx, `Envíame las fotos para ${escapeHtml(attach.draft.name)} o toca “Listo”.`)
    return
  }
  const pending = await getPendingOperation(ctx)
  if (pending && CONFIRM_WORDS.test(text)) { await confirmOperation(ctx, pending); return }
  if (pending && CANCEL_WORDS.test(text)) {
    await cancelOperation(ctx, pending.operation_id)
    await say(ctx, 'Listo, lo cancelé. Tu tienda no cambió.', backToMenu())
    return
  }
  if (CONFIRM_WORDS.test(text)) { await say(ctx, 'No hay nada pendiente por confirmar. ¿Qué necesitas?', mainMenuKeyboard(ctx.memberships.length > 1)); return }

  const session = await readSession(ctx.db, ctx.telegramUserId)
  if (session.state.awaiting === 'ask_ai') {
    await updateSessionState(ctx, { awaiting: undefined })
    await handleProposal(ctx, { action: 'ask_ai', params: { question: text }, missing: [], summary: '', needsConfirmation: false }, text)
    return
  }

  const intent = detectIntent(text, session.state.lastSkus)
  if (intent) {
    switch (intent.kind) {
      case 'greeting': await say(ctx, greeting(ctx.firstName, ctx.store.name), mainMenuKeyboard(ctx.memberships.length > 1)); return
      case 'thanks': await say(ctx, '¡Con gusto! Aquí estoy cuando me necesites. 🙌'); return
      case 'menu': await say(ctx, '¿Qué hacemos ahora?', mainMenuKeyboard(ctx.memberships.length > 1)); return
      case 'help': await say(ctx, HELP_TEXT, backToMenu()); return
      case 'switch_store': await handleCommand(ctx, '/tienda'); return
      case 'start_product': await beginProductDraft(ctx, undefined, intent.hint); return
      case 'change_store_image':
        await updateSessionState(ctx, { awaiting: intent.target === 'banner' ? 'banner_photo' : 'logo_photo' })
        await say(ctx, intent.target === 'banner' ? '🖼️ ¡Claro! Envíame la foto para el nuevo banner y te muestro cómo quedaría antes de cambiarlo.' : '🔖 ¡Claro! Envíame la imagen del nuevo logo y te la muestro antes de cambiarlo.')
        return
      case 'attach_photos': await beginAttachPhotos(ctx, intent.sku); return
      case 'needs_sku':
        await say(ctx, intent.action === 'update_price'
          ? '¿A qué producto le cambio el precio? Escríbeme su código (SKU), por ejemplo: “Cambia el precio de ABC123 a 180.000”.'
          : '¿Para qué producto escribo la descripción? Indícame su código (SKU).')
        return
      case 'action':
        await handleProposal(ctx, { action: intent.action as ActionName, params: intent.params, missing: [], summary: intent.summary || '', needsConfirmation: !READ_ONLY_ACTIONS.has(intent.action) }, text)
        return
    }
  }

  const local = interpretCommand(text)
  if (local.action !== 'unknown' && !(local.action === 'create_product' && local.missing.length && ctx.env.GEMINI_API_KEY)) {
    await handleProposal(ctx, { action: local.action, params: local.params, missing: local.missing, summary: local.summary, needsConfirmation: local.needsConfirmation }, text)
    return
  }

  if (!ctx.env.GEMINI_API_KEY) {
    await say(ctx, 'No estoy seguro de haber entendido. ¿Quieres hacer alguna de estas cosas?', mainMenuKeyboard(ctx.memberships.length > 1))
    return
  }
  await sendChatAction(ctx.botToken, ctx.chatId)
  const outcome = await interpretRequest(ctx, text)
  if (!outcome.ok) {
    await say(ctx, `${outcome.message}\n\nMientras tanto, puedes usar el menú:`, mainMenuKeyboard(ctx.memberships.length > 1))
    return
  }
  await handleProposal(ctx, outcome.value, text)
}

type Proposal = { action: ActionName | 'ask' | 'unknown'; params: Record<string, unknown>; missing: string[]; summary: string; needsConfirmation: boolean }

async function handleProposal(ctx: AssistantContext, proposal: Proposal, originalText: string): Promise<void> {
  const { action, params } = proposal
  if (action === 'unknown') {
    await say(ctx, 'No estoy seguro de haber entendido. ¿Me lo dices de otra forma o eliges una opción?', mainMenuKeyboard(ctx.memberships.length > 1))
    return
  }
  if (action === 'create_product') {
    await beginProductDraft(ctx, params, originalText)
    return
  }
  if (action === 'ask') {
    const missing = proposal.missing.length ? `\n\nMe falta: ${escapeHtml(proposal.missing.join(', '))}.` : ''
    await say(ctx, `${escapeHtml(proposal.summary)}${missing}`)
    await rememberTurn(ctx, 'assistant', proposal.summary)
    return
  }
  if (proposal.missing.length) {
    await say(ctx, `Para hacerlo necesito: ${escapeHtml(proposal.missing.join(', '))}. No invento precios, stock ni datos que no me hayas dado.`)
    return
  }
  if (action === 'catalog_advice' || action === 'ask_ai') {
    const facts = await catalogFacts(ctx.db, ctx.store.id)
    const question = action === 'ask_ai' ? String(params.question || originalText) : 'Dame consejos concretos para mejorar mi catálogo y vender más.'
    if (!ctx.env.GEMINI_API_KEY) {
      await say(ctx, `💡 <b>Ideas para tu catálogo</b>\n${deterministicAdvice(facts).map((tip) => `• ${escapeHtml(tip)}`).join('\n')}`, backToMenu())
      return
    }
    await sendChatAction(ctx.botToken, ctx.chatId)
    const outcome = await answerWithStoreFacts(ctx, question, facts, action === 'ask_ai' ? 'pregunta' : 'consejos')
    if (!outcome.ok) {
      await say(ctx, action === 'catalog_advice'
        ? `💡 <b>Ideas para tu catálogo</b>\n${deterministicAdvice(facts).map((tip) => `• ${escapeHtml(tip)}`).join('\n')}`
        : outcome.message, backToMenu())
      return
    }
    await rememberTurn(ctx, 'assistant', outcome.value.answer)
    await say(ctx, `✨ ${escapeHtml(outcome.value.answer)}`, backToMenu())
    return
  }
  if (action === 'write_description') {
    if (!roleAllows(ctx.role, 'admin')) { await say(ctx, 'Tu rol no permite editar productos.'); return }
    const sku = String(params.sku)
    const product = await ctx.db.prepare(
      `SELECT p.sku, p.name, p.description, p.brand, c.name AS category,
              (SELECT group_concat(trim(COALESCE(v.color, '') || ' ' || COALESCE(v.size, '')), ', ') FROM product_variants v WHERE v.product_id = p.id AND v.is_active = 1) AS variants
       FROM products p LEFT JOIN categories c ON c.id = p.category_id AND c.store_id = p.store_id
       WHERE p.store_id = ? AND upper(p.sku) = upper(?) AND p.is_archived = 0`,
    ).bind(ctx.store.id, sku).first<{ sku: string; name: string; description: string | null; brand: string | null; category: string | null; variants: string | null }>()
    if (!product) { await say(ctx, `No encontré el producto ${escapeHtml(sku)}.`); return }
    if (!ctx.env.GEMINI_API_KEY) { await say(ctx, 'Redactar descripciones necesita la IA, que aún no está activada.'); return }
    await sendChatAction(ctx.botToken, ctx.chatId)
    const outcome = await draftProductDescription(ctx, { name: product.name, description: product.description, category: product.category, brand: product.brand, variants: (product.variants || '').split(', ').filter(Boolean), tone: typeof params.tone === 'string' ? params.tone : undefined })
    if (!outcome.ok) { await say(ctx, outcome.message); return }
    await updateSessionState(ctx, { lastSkus: [product.sku] })
    await proposeChange(ctx, 'update_product', { sku: product.sku, description: outcome.value.description }, 'Te propongo esta descripción:')
    return
  }
  if (READ_ONLY_ACTIONS.has(action)) {
    await readAndReply(ctx, action, params)
    return
  }
  if (isConfirmableAction(action)) {
    if (typeof params.sku === 'string') await updateSessionState(ctx, { lastSkus: [params.sku] })
    await proposeChange(ctx, action, params, proposal.summary || undefined)
    return
  }
  await say(ctx, 'Eso todavía no lo puedo hacer desde Telegram. Puedes hacerlo desde el panel de tu tienda.', backToMenu())
}

/**
 * Links a Telegram account with a one-time code. New codes belong to a platform
 * user and store; the legacy code stored in store_config keeps working for the
 * primary store while it has no owner.
 */
export async function linkTelegramAccount(
  chatId: number,
  code: string,
  db: D1Database,
): Promise<{ success: boolean; message: string; storeId?: number }> {
  const telegramUserId = String(chatId)
  const normalized = normalizeLinkCode(code)
  if (/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{2}$/.test(normalized)) {
    const existing = await db.prepare('SELECT id FROM platform_users WHERE telegram_user_id = ?').bind(telegramUserId).first<{ id: number }>()
    const token = await consumeAccessToken(db, normalized, 'telegram_link')
    if (!token) return { success: false, message: 'Ese código no es válido o ya venció. Pide uno nuevo desde el panel de tu tienda.' }
    if (existing && existing.id !== token.userId) return { success: false, message: 'Esta cuenta de Telegram ya está vinculada a otro usuario. Contacta a soporte si necesitas cambiarla.' }
    const linked = await linkTelegramToUser(db, token.userId, telegramUserId)
    if (linked !== 'linked') return { success: false, message: 'Esta cuenta de Telegram ya está vinculada a otro usuario.' }
    const store = await db.prepare('SELECT name FROM stores WHERE id = ?').bind(token.storeId).first<{ name: string }>()
    await db.batch([
      db.prepare(`INSERT INTO telegram_sessions (telegram_user_id, active_store_id, context_json) VALUES (?, ?, '{}')
        ON CONFLICT(telegram_user_id) DO UPDATE SET active_store_id = excluded.active_store_id, updated_at = unixepoch()`).bind(telegramUserId, token.storeId),
      db.prepare(`INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id) VALUES ('telegram_linked', 'user', ?, '{}', ?, 'telegram', ?)`)
        .bind(String(token.userId), `telegram:${telegramUserId}`, token.storeId),
    ])
    return { success: true, storeId: token.storeId, message: `✅ ¡Listo! Tu Telegram quedó vinculado a <b>${escapeHtml(store?.name || 'tu tienda')}</b>.\nEscribe <b>hola</b> para empezar.` }
  }
  const linked = await db.prepare(
    `UPDATE store_config SET telegram_owner_id = ?, telegram_link_code = NULL, telegram_link_expires_at = NULL, updated_at = datetime('now')
     WHERE id = ? AND telegram_owner_id IS NULL AND telegram_link_code = ? AND telegram_link_expires_at > datetime('now')
     RETURNING telegram_owner_id`,
  ).bind(telegramUserId, PRIMARY_STORE_ID, code).first()
  if (!linked) return { success: false, message: 'Código de enlace inválido o expirado.' }
  return { success: true, storeId: PRIMARY_STORE_ID, message: '✅ Cuenta de Telegram vinculada correctamente. Escribe hola para empezar.' }
}
