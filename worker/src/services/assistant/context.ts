import type { Env } from '../../index'
import { listTelegramMemberships, type Membership, type StoreRole } from '../../tenancy/access'
import { PRIMARY_STORE_ID } from '../../tenancy/stores'
import { escapeHtml } from './tools'
import { downloadTelegramFile, sendChatAction, sendTelegramMessage, sendTelegramPhoto, type TelegramSendMessageResponse } from './telegramApi'
import { downloadTelegramImage, type ValidatedTelegramImage } from '../telegramProductImages'

export type AssistantStore = {
  id: number
  slug: string
  name: string
  status: string
  currency: string
  planCode: string
}

/** Parts of the assistant that depend on Telegram itself and are not offered on other channels yet. */
export type ChannelFeature = 'batches' | 'team' | 'panel_password' | 'onboarding'

/**
 * Transport of a channel other than Telegram (WhatsApp). The engine never talks to it directly:
 * say(), sayPhoto(), showTyping() and the fetch* helpers below route here when a context carries one.
 * A context without a channel is Telegram and behaves exactly as before.
 */
export interface AssistantChannel {
  name: 'whatsapp'
  /** Proveedor del transporte (sin definir = Meta Cloud API). Solo separa costos; el motor no cambia. */
  provider?: 'meta' | 'waha'
  unsupported: ReadonlySet<ChannelFeature>
  helpText?: string
  accessHelpText?: string
  send(html: string, replyMarkup?: Record<string, unknown>): Promise<TelegramSendMessageResponse>
  sendPhoto(photo: string, caption: string, replyMarkup?: Record<string, unknown>): Promise<void>
  typing(): Promise<void>
  downloadImage(fileId: string): Promise<ValidatedTelegramImage>
  downloadFile(fileId: string, maxBytes: number): Promise<Uint8Array>
  downloadVoice(fileId: string): Promise<{ mimeType: 'audio/ogg'; data: string; seconds?: number }>
}

/** Everything a single update needs, bound to exactly one store. */
export interface AssistantContext {
  db: D1Database
  env: Env['Bindings']
  botToken: string
  chatId: number
  telegramUserId: string
  firstName: string
  updateId: number
  store: AssistantStore
  role: StoreRole
  memberships: Membership[]
  /** Pending changes of the previous store cancelled by this store switch. */
  cancelledOnSwitch?: number
  /** Voice note being processed (seconds) and a hash of the text of this update: only for the AI message counter. */
  voiceSeconds?: number
  fingerprint?: string
  /** Quota notice (80 % / 100 %) to send after the reply of this update, so it never comes before the answer. */
  quotaNotice?: string
  /** Set only for channels other than Telegram. */
  channel?: AssistantChannel
}

export type SessionState = {
  lastSkus?: string[]
  awaiting?: 'ask_ai' | 'banner_photo' | 'logo_photo' | 'product_photos_for_sku' | 'document_import' | 'order_tracking' | 'campaign_text' | 'shipping_guide'
  pendingCoupon?: { code: string; kind: 'porcentaje' | 'valor'; value: number; minSubtotal: number; endsAt: string | null; maxUses: number | null }
  targetCampaign?: number
  targetOrder?: { id: number; revision: number }
  pendingDelivery?: { orderId: number; carrier?: string; trackingNumber?: string; method?: 'transportadora' | 'entrega_personal' | 'retiro_en_tienda' | 'mensajero' | 'otro' }
  /** Order the conversation is about (last order shown or updated). */
  focusOrder?: number
  /** Shipping guide being registered from a photo. */
  guide?: import('./shippingGuide').GuideState
  targetSku?: string
  pendingPhotoFileId?: string
  /** Product the conversation is about (set only when one product was resolved unequivocally). */
  focusSku?: string
  /** Commerce request waiting for an answer, or the request behind a pending proposal (for corrections). */
  commerce?: CommerceState
  /** A new request received while a product draft was open, kept until the owner decides. */
  deferredText?: string
  updatedAt?: number
}

export type CommerceState = {
  intent: import('./commerce/intent').CommerceIntent
  sku?: string
  ask?: 'product' | 'product_name' | 'mode' | 'distribution' | 'color' | 'amount' | 'duplicate_sku' | 'new_product' | 'reference'
  options?: number[]
  missing?: number
  operationId?: string
}

export async function legacyOwnerIds(db: D1Database, env: Env['Bindings']): Promise<string[]> {
  const row = await db.prepare('SELECT telegram_owner_id FROM store_config WHERE id = ?').bind(PRIMARY_STORE_ID).first<{ telegram_owner_id?: string | null }>()
  return [env.TELEGRAM_OWNER_ID, row?.telegram_owner_id].filter((value): value is string => Boolean(value))
}

export async function membershipsForTelegramUser(db: D1Database, env: Env['Bindings'], telegramUserId: string): Promise<Membership[]> {
  return listTelegramMemberships(db, telegramUserId, await legacyOwnerIds(db, env))
}

export async function readSession(db: D1Database, telegramUserId: string): Promise<{ activeStoreId: number | null; state: SessionState }> {
  const row = await db.prepare('SELECT active_store_id, context_json FROM telegram_sessions WHERE telegram_user_id = ?').bind(telegramUserId).first<{ active_store_id: number | null; context_json: string }>()
  let state: SessionState = {}
  try { state = row?.context_json ? JSON.parse(row.context_json) as SessionState : {} } catch { state = {} }
  // Pending intents expire after 30 minutes so a stale "send the photo" never surprises the owner.
  if (state.updatedAt && Date.now() - state.updatedAt > 30 * 60 * 1000) state = { lastSkus: state.lastSkus }
  return { activeStoreId: row?.active_store_id ?? null, state }
}

export async function writeSession(db: D1Database, telegramUserId: string, activeStoreId: number | null, state: SessionState): Promise<void> {
  await db.prepare(
    `INSERT INTO telegram_sessions (telegram_user_id, active_store_id, context_json, updated_at) VALUES (?, ?, ?, unixepoch())
     ON CONFLICT(telegram_user_id) DO UPDATE SET active_store_id = excluded.active_store_id, context_json = excluded.context_json, updated_at = unixepoch()`,
  ).bind(telegramUserId, activeStoreId, JSON.stringify({ ...state, updatedAt: Date.now() })).run()
}

export async function updateSessionState(ctx: AssistantContext, patch: Partial<SessionState> | null): Promise<void> {
  const current = await readSession(ctx.db, ctx.telegramUserId)
  const next: SessionState = patch === null ? { lastSkus: current.state.lastSkus } : { ...current.state, ...patch }
  for (const key of Object.keys(next) as Array<keyof SessionState>) if (next[key] === undefined) delete next[key]
  await writeSession(ctx.db, ctx.telegramUserId, ctx.store.id, next)
}

export async function loadAssistantStore(db: D1Database, storeId: number, fallbackCurrency: string): Promise<AssistantStore | null> {
  const row = await db.prepare(
    `SELECT s.id, s.slug, s.name, s.status, s.plan_code AS planCode, COALESCE(c.currency, ?) AS currency
     FROM stores s LEFT JOIN store_config c ON c.id = s.id WHERE s.id = ?`,
  ).bind(fallbackCurrency, storeId).first<AssistantStore>()
  return row ?? null
}

/** Sends a message with the environment banner and, for multi-store users, the store name. */
export async function say(ctx: AssistantContext, text: string, replyMarkup?: Record<string, unknown>): Promise<TelegramSendMessageResponse> {
  if (ctx.channel) return ctx.channel.send(`${banner(ctx, isMainMenu(replyMarkup))}${text}`, usableMarkup(replyMarkup))
  return sendTelegramMessage(ctx.botToken, ctx.chatId, `${banner(ctx, isMainMenu(replyMarkup))}${text}`, 'HTML', usableMarkup(replyMarkup))
}

export async function sayPhoto(ctx: AssistantContext, photo: string, caption: string, replyMarkup?: Record<string, unknown>): Promise<void> {
  if (ctx.channel) { await ctx.channel.sendPhoto(photo, `${banner(ctx)}${caption}`, usableMarkup(replyMarkup)); return }
  await sendTelegramPhoto(ctx.botToken, ctx.chatId, photo, `${banner(ctx)}${caption}`, usableMarkup(replyMarkup))
}

/** Who did it, for the audit trail: `telegram:<id>` or `whatsapp:<linked identity>`. */
export function actorOf(ctx: Pick<AssistantContext, 'telegramUserId' | 'channel'>): string {
  return ctx.channel ? `${ctx.channel.name}:${ctx.telegramUserId.replace(/^wa:/, '')}` : `telegram:${ctx.telegramUserId}`
}

/** Channel written in the audit trail. Only these two literals exist, so it is safe inside SQL text. */
export function sourceOf(ctx: Pick<AssistantContext, 'channel'>): 'telegram' | 'whatsapp' {
  return ctx.channel ? 'whatsapp' : 'telegram'
}

/** "Typing…" while a slower step runs. Cosmetic: failures are ignored. */
export async function showTyping(ctx: AssistantContext): Promise<void> {
  if (ctx.channel) { await ctx.channel.typing().catch(() => undefined); return }
  await sendChatAction(ctx.botToken, ctx.chatId)
}

/** Photo sent by the merchant, validated as a raster image, from whichever channel it came. */
export async function fetchImage(ctx: AssistantContext, fileId: string): Promise<ValidatedTelegramImage> {
  return ctx.channel ? ctx.channel.downloadImage(fileId) : downloadTelegramImage(ctx.botToken, fileId)
}

/** File sent by the merchant, with a strict size bound. */
export async function fetchFile(ctx: AssistantContext, fileId: string, maxBytes: number): Promise<Uint8Array> {
  return ctx.channel ? ctx.channel.downloadFile(fileId, maxBytes) : (await downloadTelegramFile(ctx.botToken, fileId, maxBytes)).bytes
}

/** True (after telling the merchant) when this part of the assistant is not offered on the current channel. */
export async function unavailableHere(ctx: AssistantContext, feature: ChannelFeature): Promise<boolean> {
  if (!ctx.channel?.unsupported.has(feature)) return false
  await say(ctx, 'Eso todavía no está disponible por WhatsApp. Puedes hacerlo desde el panel de tu tienda o desde el asistente de Telegram.')
  return true
}

/** The main menu always names the active store, even for single-store owners. */
function isMainMenu(replyMarkup?: Record<string, unknown>): boolean {
  return JSON.stringify(replyMarkup?.inline_keyboard || []).includes('"m:switch_store"')
}

/** Telegram rejects the whole message when a URL button is not absolute (for
 * example when PUBLIC_STORE_BASE_URL is not configured); drop only those buttons. */
export function usableMarkup(replyMarkup?: Record<string, unknown>): Record<string, unknown> | undefined {
  const rows = replyMarkup?.inline_keyboard
  if (!Array.isArray(rows)) return replyMarkup
  const kept = rows
    .map((row) => (Array.isArray(row) ? row : []).filter((button: { url?: unknown }) => button?.url === undefined || /^https?:\/\/[^\s/]+/i.test(String(button.url))))
    .filter((row) => row.length > 0)
  return { ...replyMarkup, inline_keyboard: kept }
}

function banner(ctx: AssistantContext, withStore = false): string {
  const label = ctx.env.TELEGRAM_ENV_LABEL?.trim()
  const parts: string[] = []
  if (label) parts.push(`🧪 <b>${escapeHtml(label)}</b>`)
  if (ctx.memberships.length > 1 || withStore) parts.push(`🏪 Tienda actual: <b>${escapeHtml(ctx.store.name)}</b>`)
  return parts.length ? `${parts.join('\n')}\n\n` : ''
}

/** Short conversation memory per store and user (last turns, 24 h). */
export async function rememberTurn(ctx: AssistantContext, role: 'user' | 'assistant', content: string): Promise<void> {
  const text = content.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
    .replace(/(contrase(?:ñ|n)a|password|token|c[oó]digo de acceso)\s*(?:es|:)?\s*[^\s,;]+/gi, '$1 [oculto]')
    .replace(/\/(?:start\s+link_|link\s+)[A-Za-z0-9-]{8,80}/gi, '[enlace de acceso oculto]')
    .slice(0, 500)
  if (!text) return
  await ctx.db.prepare('INSERT INTO assistant_messages (store_id, telegram_user_id, role, content) VALUES (?, ?, ?, ?)')
    .bind(ctx.store.id, ctx.telegramUserId, role, text).run()
}

export async function conversationContext(ctx: AssistantContext): Promise<string> {
  const rows = await ctx.db.prepare(
    `SELECT role, content FROM assistant_messages WHERE store_id = ? AND telegram_user_id = ? AND created_at > unixepoch() - 86400
     ORDER BY id DESC LIMIT 8`,
  ).bind(ctx.store.id, ctx.telegramUserId).all<{ role: string; content: string }>()
  const session = await readSession(ctx.db, ctx.telegramUserId)
  const lines = (rows.results || []).reverse().map((row) => `${row.role === 'user' ? 'Propietario' : 'Asistente'}: ${row.content}`)
  if (session.state.lastSkus?.length) lines.push(`SKU mencionados recientemente: ${session.state.lastSkus.slice(0, 10).join(', ')}`)
  return lines.join('\n')
}

export async function cleanupAssistantMemory(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM assistant_messages WHERE created_at < unixepoch() - 7 * 86400'),
    db.prepare("DELETE FROM platform_conversations WHERE expires_at < unixepoch()"),
    db.prepare("UPDATE platform_operations SET status = 'expired', completed_at = datetime('now') WHERE status = 'pending' AND expires_at <= unixepoch()"),
  ])
}
