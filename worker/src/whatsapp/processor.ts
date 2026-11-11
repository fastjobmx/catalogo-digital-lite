/**
 * Adaptador de WhatsApp del asistente de tiendas. Recibe los eventos de Meta, identifica al
 * comerciante vinculado y entrega cada mensaje al MISMO motor que usa Telegram
 * (services/telegram.ts → dispatchAssistantUpdate). Aquí no hay reglas de productos, inventario
 * ni permisos: solo canal, identidad, trazabilidad y costos.
 */
import type { Env } from '../index'
import { listUserMemberships, type Membership } from '../tenancy/access'
import { dispatchAssistantUpdate, openAssistantContext, type AssistantIdentity } from '../services/telegram'
import type { AssistantChannel } from '../services/assistant/context'
import { bytesToBase64, type TelegramUpdate } from '../services/assistant/telegramApi'
import { inspectRasterImage } from '../services/telegramProductImages'
import { downloadWhatsAppMedia, markReadAndTyping, oggOpusSeconds, sendWhatsApp, WhatsAppApiError, whatsappEnabled, WHATSAPP_IMAGE_LIMIT } from './api'
import { buildOutbound, type Option } from './format'
import {
  findIdentity, linkCodeIn, linkWhatsApp, revokeIdentity, senderFrom, throttle,
  whatsappChatId, whatsappUpdateId, whatsappUserKey, type Sender, type WhatsAppIdentity,
} from './identity'

type Bindings = Env['Bindings']

const WINDOW_SECONDS = 24 * 60 * 60
const STALE_INBOUND_SECONDS = 15 * 60
const MAX_REPLIES_PER_MESSAGE = 12
const BURST_PER_MINUTE = 30
const VOICE_LIMIT = 10 * 1024 * 1024
const MENU_TTL_MS = 30 * 60 * 1000

export const WHATSAPP_HELP_TEXT = [
  '📖 <b>Cómo te ayudo por WhatsApp</b>',
  '',
  'Soy el Asistente TiendIA, un asistente con IA. Escríbeme como le hablarías a un colaborador, o envíame una nota de voz. Por ejemplo:',
  '• “¿Cuántas unidades quedan del AD223?”',
  '• “Muéstrame los productos agotados”',
  '• “Agrega tenis blancos AD223, tallas 38, 39 y 40, cinco pares de cada una, a 180 mil”',
  '• “Me llegaron 10 camisetas: 4 M, 3 L y 3 XL”',
  '• “Cambia el precio de AD223 a 195 mil”',
  '',
  'También puedes enviarme una 📷 foto para crear un producto o un 📄 archivo CSV para actualizar precios y existencias.',
  '',
  'Antes de cambiar algo te muestro un resumen con <b>Confirmar</b>, <b>Corregir</b> y <b>Cancelar</b>. Nada se guarda sin tu confirmación.',
  'Escribe <b>menú</b> para ver las opciones, <b>tiendas</b> para cambiar de tienda o <b>desvincular</b> para quitar este WhatsApp de tu cuenta.',
].join('\n')

export const WHATSAPP_ACCESS_TEXT = [
  '⚙️ <b>Accesos a tus tiendas</b>',
  '',
  'Aquí aparecen solo las tiendas en las que tu cuenta de TiendIA Exprés tiene acceso autorizado.',
  'El acceso de otras personas se administra desde el panel de la tienda. Nunca vinculamos un WhatsApp solo por el número de teléfono.',
].join('\n')

const UNLINKED_TEXT = [
  '👋 ¡Hola! Soy el Asistente TiendIA para comercios de TiendIA Exprés.',
  '',
  'Este WhatsApp todavía no está vinculado a una cuenta. Para administrar tu tienda desde aquí, genera un código de vinculación con tu cuenta de TiendIA Exprés y envíamelo así:',
  '<code>VINCULAR TU-CODIGO</code>',
  '',
  'Si no tienes una tienda, conócenos en https://tiendiaexpres.com/',
].join('\n')

type InboundMessage = {
  id?: string; type?: string; timestamp?: string; from?: string; from_user_id?: string
  text?: { body?: string }
  interactive?: { button_reply?: { id?: string }; list_reply?: { id?: string } }
  button?: { payload?: string }
  image?: { id?: string; caption?: string; mime_type?: string }
  audio?: { id?: string; mime_type?: string; voice?: boolean }
  document?: { id?: string; filename?: string; mime_type?: string; caption?: string }
}

/** Tiendas habilitadas para el canal: todas, o solo las del piloto (WHATSAPP_PILOT_STORE_IDS). */
export function pilotAllows(env: Partial<Bindings>, storeId: number): boolean {
  const pilot = String(env.WHATSAPP_PILOT_STORE_IDS || '').split(',').map((value) => Number(value.trim())).filter((value) => Number.isSafeInteger(value) && value > 0)
  return !pilot.length || pilot.includes(storeId)
}

// ───────────────────────── Recepción ─────────────────────────

/** Guarda los eventos de una carga ya autenticada. Devuelve los mensajes nuevos por procesar. */
export async function recordWebhook(env: Bindings, db: D1Database, payload: unknown): Promise<number[]> {
  const body = payload as { object?: string; entry?: Array<{ changes?: Array<{ field?: string; value?: Record<string, any> }> }> }
  if (body?.object !== 'whatsapp_business_account' || !Array.isArray(body.entry)) return []
  const pending: number[] = []
  const now = Math.floor(Date.now() / 1000)
  for (const entry of body.entry.slice(0, 50)) {
    for (const change of (Array.isArray(entry?.changes) ? entry.changes : []).slice(0, 50)) {
      const value = change?.value
      // Only events of the platform's own number are accepted.
      if (change?.field !== 'messages' || !value || String(value.metadata?.phone_number_id || '') !== String(env.WHATSAPP_PHONE_NUMBER_ID || '')) continue
      for (const status of (Array.isArray(value.statuses) ? value.statuses : []).slice(0, 100)) await recordStatus(env, db, status)
      for (const message of (Array.isArray(value.messages) ? value.messages : []).slice(0, 100) as InboundMessage[]) {
        const sender = senderFrom(message, Array.isArray(value.contacts) ? value.contacts : [])
        if (!sender || typeof message.id !== 'string' || !message.id || message.id.length > 200) continue
        const kind = String(message.type || 'unknown').slice(0, 24)
        const stale = now - Number(message.timestamp || now) > STALE_INBOUND_SECONDS
        const skip = stale || kind === 'system' || kind === 'reaction' || kind === 'unsupported'
        // The message id is the idempotency key: a redelivery from Meta inserts nothing.
        const inserted = await db.prepare(
          `INSERT OR IGNORE INTO whatsapp_messages (wa_message_id, direction, sender_key, kind, status, payload_json, error_code) VALUES (?, 'in', ?, ?, ?, ?, ?)`,
        ).bind(message.id, sender.key, kind, skip ? 'ignored' : 'received', skip ? null : JSON.stringify({ message, sender }), stale ? 'STALE' : null).run()
        if (inserted.meta.changes && !skip) pending.push(Number(inserted.meta.last_row_id))
      }
    }
  }
  return pending
}

function rateMicros(env: Partial<Bindings>, category: string): number | null {
  try {
    const rates = JSON.parse(env.WHATSAPP_RATES_USD_MICROS || '{}') as Record<string, unknown>
    const value = Number(rates[category])
    return Number.isSafeInteger(value) && value >= 0 ? value : null
  } catch { return null }
}

/** Estado de un mensaje enviado (entregado, leído, fallido) y lo que Meta informa sobre su cobro. */
async function recordStatus(env: Partial<Bindings>, db: D1Database, status: Record<string, any>): Promise<void> {
  if (typeof status?.id !== 'string') return
  const state = ({ sent: 'sent', delivered: 'delivered', read: 'read', failed: 'error' } as Record<string, string>)[String(status.status)]
  if (!state) return
  const pricing = status.pricing && typeof status.pricing === 'object' ? status.pricing : null
  const billable = pricing ? (pricing.billable ? 1 : 0) : null
  const category = pricing?.category ? String(pricing.category).slice(0, 40) : null
  const estimate = billable === null ? null : billable ? (category ? rateMicros(env, category) : null) : 0
  await db.prepare(
    `UPDATE whatsapp_messages SET
       status = CASE WHEN ? = 'error' OR status = 'sent' OR (status = 'delivered' AND ? = 'read') THEN ? ELSE status END,
       billable = COALESCE(?, billable), pricing_category = COALESCE(?, pricing_category), pricing_type = COALESCE(?, pricing_type),
       estimated_cost_micros = COALESCE(?, estimated_cost_micros), error_code = COALESCE(?, error_code), updated_at = unixepoch()
     WHERE wa_message_id = ? AND direction = 'out'`,
  ).bind(state, state, state, billable, category, pricing?.type ? String(pricing.type).slice(0, 40) : null, estimate,
    state === 'error' ? String(status.errors?.[0]?.code ?? 'FAILED').slice(0, 40) : null, status.id).run()
}

// ───────────────────────── Envío ─────────────────────────

type Outbox = {
  env: Bindings; db: D1Database; sender: Sender; inboundId: number; inboundWaId: string
  identityId: number | null; storeId: number | null; lastInboundAt: number; sent: number
}

async function deliver(outbox: Outbox, html: string, replyMarkup?: Record<string, unknown>): Promise<Option[] | null> {
  const { messages, numbered } = buildOutbound(html, replyMarkup)
  for (const message of messages) {
    // Free-form replies are only allowed within 24 h of the merchant's last message, and one
    // incoming message never fans out into an unbounded number of (possibly billed) replies.
    const blocked = Math.floor(Date.now() / 1000) - outbox.lastInboundAt > WINDOW_SECONDS ? 'WINDOW_CLOSED' : outbox.sent >= MAX_REPLIES_PER_MESSAGE ? 'REPLY_LIMIT' : null
    let waId = `local:${crypto.randomUUID()}`
    let failure = blocked
    if (!blocked) {
      try { waId = await sendWhatsApp(outbox.env, { phone: outbox.sender.phone, businessUserId: outbox.sender.businessUserId }, message); outbox.sent++ }
      catch (error) { failure = error instanceof WhatsAppApiError ? error.code : 'SEND_FAILED' }
    }
    await outbox.db.prepare(
      `INSERT OR IGNORE INTO whatsapp_messages (wa_message_id, direction, sender_key, identity_id, store_id, kind, status, reply_to, error_code) VALUES (?, 'out', ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(waId, outbox.sender.key, outbox.identityId, outbox.storeId, String(message.type), failure ? 'error' : 'sent', outbox.inboundId, failure).run()
    if (failure && !blocked) throw new Error(`WHATSAPP_SEND_${failure}`)
  }
  return numbered
}

function createChannel(outbox: Outbox): AssistantChannel {
  const { env, db } = outbox
  return {
    name: 'whatsapp',
    unsupported: new Set(['batches', 'team', 'panel_password', 'onboarding'] as const),
    helpText: WHATSAPP_HELP_TEXT,
    accessHelpText: WHATSAPP_ACCESS_TEXT,
    async send(html, replyMarkup) {
      const numbered = await deliver(outbox, html, replyMarkup)
      if (outbox.identityId) {
        await db.prepare('UPDATE whatsapp_identities SET menu_json = ? WHERE id = ?')
          .bind(numbered ? JSON.stringify({ at: Date.now(), ids: numbered.map((option) => option.id) }) : null, outbox.identityId).run()
      }
      return { ok: true, result: { message_id: outbox.sent } }
    },
    // The merchant has just sent the photo; the preview is the summary with its buttons.
    async sendPhoto(_photo, caption, replyMarkup) { await this.send(caption, replyMarkup) },
    async typing() { await markReadAndTyping(env, outbox.inboundWaId) },
    async downloadImage(fileId) {
      let bytes: Uint8Array
      try { bytes = (await downloadWhatsAppMedia(env, fileId, WHATSAPP_IMAGE_LIMIT)).bytes }
      catch (error) { throw new Error(error instanceof Error && error.message === 'WHATSAPP_MEDIA_TOO_LARGE' ? 'TELEGRAM_IMAGE_TOO_LARGE' : 'TELEGRAM_FILE_DOWNLOAD_FAILED') }
      return { bytes, ...inspectRasterImage(bytes) }
    },
    async downloadFile(fileId, maxBytes) { return (await downloadWhatsAppMedia(env, fileId, maxBytes)).bytes },
    async downloadVoice(fileId) {
      const { bytes } = await downloadWhatsAppMedia(env, fileId, VOICE_LIMIT)
      if (bytes[0] !== 0x4f || bytes[1] !== 0x67 || bytes[2] !== 0x67 || bytes[3] !== 0x53) throw new Error('WhatsApp voice is not an OGG stream')
      return { mimeType: 'audio/ogg', data: bytesToBase64(bytes), seconds: oggOpusSeconds(bytes) }
    },
  }
}

// ───────────────────────── Procesamiento ─────────────────────────

/** Procesa un mensaje entrante guardado. Solo un proceso lo toma; nunca se ejecuta dos veces. */
export async function processInbound(env: Bindings, db: D1Database, rowId: number): Promise<void> {
  const row = await db.prepare(
    `UPDATE whatsapp_messages SET status = 'processing', attempts = attempts + 1, updated_at = unixepoch()
     WHERE id = ? AND direction = 'in' AND status = 'received' RETURNING wa_message_id AS waId, payload_json AS payload`,
  ).bind(rowId).first<{ waId: string; payload: string | null }>()
  if (!row) return
  let outcome: { status: 'processed' | 'ignored' | 'failed'; code?: string; identityId?: number | null; storeId?: number | null } = { status: 'processed' }
  try {
    const { message, sender } = JSON.parse(row.payload || '{}') as { message: InboundMessage; sender: Sender }
    outcome = await handleInbound(env, db, { rowId, waId: row.waId, message, sender })
  } catch (error) {
    // Technical detail stays in the platform's events; the conversation content is never logged.
    const code = (error instanceof Error ? error.message : 'unknown').slice(0, 80)
    console.error('WhatsApp message failed:', code)
    await db.prepare(`INSERT INTO platform_events (level, source, code, detail) VALUES ('error', 'whatsapp', 'MESSAGE_FAILED', ?)`).bind(code).run().catch(() => undefined)
    outcome = { status: 'failed', code }
  } finally {
    // The content of the message is kept only while it is being processed.
    await db.prepare(
      `UPDATE whatsapp_messages SET status = ?, error_code = ?, identity_id = COALESCE(?, identity_id), store_id = COALESCE(?, store_id), payload_json = NULL, updated_at = unixepoch() WHERE id = ?`,
    ).bind(outcome.status, outcome.code ?? null, outcome.identityId ?? null, outcome.storeId ?? null, rowId).run()
  }
}

type Outcome = { status: 'processed' | 'ignored'; code?: string; identityId?: number | null; storeId?: number | null }

async function handleInbound(env: Bindings, db: D1Database, input: { rowId: number; waId: string; message: InboundMessage; sender: Sender }): Promise<Outcome> {
  const { message, sender, rowId } = input
  if (await throttle(db, sender.key, 'messages', 60) > BURST_PER_MINUTE) return { status: 'ignored', code: 'RATE_LIMITED' }
  const outbox: Outbox = { env, db, sender, inboundId: rowId, inboundWaId: input.waId, identityId: null, storeId: null, lastInboundAt: Math.floor(Date.now() / 1000), sent: 0 }
  const text = message.type === 'text' ? String(message.text?.body || '').trim().slice(0, 4000) : ''

  const code = text ? linkCodeIn(text) : null
  if (code) {
    const result = await linkWhatsApp(db, sender, code)
    outbox.identityId = result.identityId ?? null
    outbox.storeId = result.storeId ?? null
    await deliver(outbox, result.message)
    return { status: 'processed', code: result.ok ? 'LINKED' : 'LINK_REJECTED', identityId: outbox.identityId, storeId: outbox.storeId }
  }

  const identity = await findIdentity(db, sender)
  if (!identity) {
    // Strangers learn how to link and nothing else, at most once every six hours.
    if (await throttle(db, sender.key, 'unlinked_notice', 6 * 60 * 60) === 1) await deliver(outbox, UNLINKED_TEXT)
    return { status: 'ignored', code: 'UNLINKED' }
  }
  outbox.identityId = identity.id
  await db.prepare('UPDATE whatsapp_identities SET last_inbound_at = unixepoch() WHERE id = ?').bind(identity.id).run()

  if (/^\/?desvincular(?: whatsapp)?[.!]*$/i.test(text)) {
    await revokeIdentity(db, { identityId: identity.id }, `whatsapp:${identity.id}`)
    await deliver(outbox, 'Listo. Este WhatsApp ya no está vinculado a tu cuenta y no puede administrar tus tiendas. Lo que estaba pendiente se canceló sin aplicarse.')
    return { status: 'processed', code: 'UNLINKED_BY_USER', identityId: identity.id }
  }

  // Memberships and roles are read fresh on every message: a revoked access stops working at once.
  const memberships: Membership[] = (await listUserMemberships(db, identity.userId)).filter((membership) => pilotAllows(env, membership.storeId))
  if (!memberships.length) {
    await deliver(outbox, 'Tu cuenta no tiene en este momento una tienda activa habilitada para administrarse por WhatsApp. Si crees que es un error, escribe a soporte@tiendiaexpres.com.')
    return { status: 'ignored', code: 'NO_STORES', identityId: identity.id }
  }

  const update = toAssistantUpdate(identity, rowId, sender.name, message, text)
  const channel = createChannel(outbox)
  const who: AssistantIdentity = {
    db, env, botToken: '', chatId: whatsappChatId(identity.id), telegramUserId: whatsappUserKey(identity.id),
    firstName: sender.name, updateId: update.update_id, channel,
  }
  const ctx = await openAssistantContext(who, memberships, update.callback_query ? { data: update.callback_query.data } : null)
  if (!ctx) return { status: 'processed', code: 'STORE_PICKER', identityId: identity.id }
  outbox.storeId = ctx.store.id
  await dispatchAssistantUpdate(ctx, update)
  await watchVolume(env, db, ctx.store.id)
  return { status: 'processed', identityId: identity.id, storeId: ctx.store.id }
}

/** El mensaje de WhatsApp en la forma que el motor ya entiende (la misma de Telegram). */
function toAssistantUpdate(identity: WhatsAppIdentity, rowId: number, firstName: string, message: InboundMessage, text: string): TelegramUpdate {
  const chatId = whatsappChatId(identity.id)
  const from = { id: chatId, first_name: firstName }
  const chat = { id: chatId, type: 'private' as const }
  const updateId = whatsappUpdateId(rowId)
  const callback = (data: string): TelegramUpdate => ({ update_id: updateId, callback_query: { id: 'whatsapp', from, data: data.slice(0, 200), message: { message_id: rowId, chat, date: 0 } } })
  const base = { message_id: rowId, from, chat, date: Number(message.timestamp || 0) }

  const tapped = message.interactive?.button_reply?.id || message.interactive?.list_reply?.id || message.button?.payload
  if (typeof tapped === 'string' && tapped) return callback(tapped)
  if (text) {
    // A number answers the last numbered menu, and only while that menu is the last thing shown.
    const choice = /^\d{1,2}$/.test(text) ? numberedChoice(identity.menuJson, Number(text)) : null
    if (choice) return callback(choice)
    const normalized = /^\/start\b/i.test(text) ? 'hola' : /^(?:mis )?tiendas?$/i.test(text) ? '/tiendas' : /^ayuda$/i.test(text) ? '/ayuda' : text
    return { update_id: updateId, message: { ...base, text: normalized } }
  }
  if (message.type === 'image' && message.image?.id) {
    return { update_id: updateId, message: { ...base, photo: [{ file_id: message.image.id }], ...(message.image.caption ? { caption: message.image.caption.slice(0, 1000) } : {}) } }
  }
  if (message.type === 'audio' && message.audio?.id) {
    const mime = String(message.audio.mime_type || '')
    return /ogg|opus/i.test(mime)
      ? { update_id: updateId, message: { ...base, voice: { file_id: message.audio.id, duration: 0, mime_type: mime } } }
      : { update_id: updateId, message: { ...base, audio: { file_id: message.audio.id, duration: 0, mime_type: mime } } }
  }
  if (message.type === 'document' && message.document?.id) {
    return { update_id: updateId, message: { ...base, document: { file_id: message.document.id, file_name: String(message.document.filename || 'archivo').slice(0, 200), mime_type: String(message.document.mime_type || '').split(';')[0] }, ...(message.document.caption ? { caption: message.document.caption.slice(0, 1000) } : {}) } }
  }
  // Stickers, locations, videos, contacts: the engine answers what it can work with.
  return { update_id: updateId, message: base }
}

function numberedChoice(menuJson: string | null, choice: number): string | null {
  try {
    const menu = JSON.parse(menuJson || 'null') as { at?: number; ids?: string[] } | null
    if (!menu?.ids || Date.now() - Number(menu.at || 0) > MENU_TTL_MS) return null
    return menu.ids[choice - 1] ?? null
  } catch { return null }
}

/** Aviso único por día cuando una tienda genera un volumen anómalo de mensajes (nunca bloquea). */
async function watchVolume(env: Partial<Bindings>, db: D1Database, storeId: number): Promise<void> {
  const threshold = Math.max(20, Number(env.WHATSAPP_MONITOR_DAILY_MESSAGES) || 300)
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM whatsapp_messages WHERE store_id = ? AND direction = 'out' AND created_at > unixepoch() - 86400`).bind(storeId).first<{ n: number }>()
  if (Number(row?.n || 0) < threshold) return
  await db.prepare(
    `INSERT INTO platform_events (store_id, level, source, code, detail)
     SELECT ?, 'warning', 'whatsapp', 'WHATSAPP_VOLUME', ? WHERE NOT EXISTS (
       SELECT 1 FROM platform_events WHERE store_id = ? AND code = 'WHATSAPP_VOLUME' AND created_at > datetime('now', '-1 day'))`,
  ).bind(storeId, `${row!.n} mensajes salientes en 24 h (umbral ${threshold})`, storeId).run().catch(() => undefined)
}

// ───────────────────────── Mantenimiento y costos ─────────────────────────

/** Tarea programada: retoma mensajes que no alcanzaron a procesarse y aplica la retención de datos. */
export async function maintainWhatsApp(env: Bindings, db: D1Database): Promise<void> {
  await db.batch([
    // A message that started and never finished is not replayed (it may have acted already): it is closed as failed.
    db.prepare(`UPDATE whatsapp_messages SET status = 'failed', error_code = 'TIMEOUT', payload_json = NULL, updated_at = unixepoch() WHERE direction = 'in' AND status = 'processing' AND updated_at < unixepoch() - 600`),
    db.prepare(`UPDATE whatsapp_messages SET status = 'failed', error_code = 'EXPIRED', payload_json = NULL, updated_at = unixepoch() WHERE direction = 'in' AND status = 'received' AND (created_at < unixepoch() - 3600 OR attempts >= 3)`),
    db.prepare('DELETE FROM whatsapp_messages WHERE created_at < unixepoch() - 180 * 86400'),
    db.prepare('DELETE FROM whatsapp_link_tokens WHERE expires_at < unixepoch() - 7 * 86400'),
    db.prepare('DELETE FROM whatsapp_throttles WHERE window_started_at < unixepoch() - 7 * 86400'),
  ])
  if (!whatsappEnabled(env)) return
  const waiting = await db.prepare(`SELECT id FROM whatsapp_messages WHERE direction = 'in' AND status = 'received' AND created_at < unixepoch() - 60 ORDER BY id LIMIT 10`).all<{ id: number }>()
  for (const row of waiting.results || []) await processInbound(env, db, row.id)
}

/** Consumo del canal por tienda en un mes (AAAA-MM). Los mensajes sin tienda son costo de plataforma. */
export async function whatsappUsageReport(db: D1Database, period: string) {
  const messages = await db.prepare(
    `SELECT m.store_id AS storeId, s.name AS storeName,
            SUM(m.direction = 'in') AS inbound, SUM(m.direction = 'out' AND m.status <> 'error') AS outbound,
            SUM(m.direction = 'out' AND m.status = 'error') AS failed,
            SUM(m.direction = 'out' AND m.billable = 1) AS billable, SUM(m.direction = 'out' AND m.billable = 0) AS free,
            SUM(m.direction = 'out' AND m.status <> 'error' AND m.billable IS NULL) AS pricingUnknown,
            SUM(m.direction = 'in' AND m.kind = 'audio') AS voiceNotes, SUM(m.direction = 'in' AND m.kind = 'image') AS images,
            SUM(m.direction = 'in' AND m.kind = 'document') AS documents,
            COALESCE(SUM(m.estimated_cost_micros), 0) AS estimatedMetaCostMicros
     FROM whatsapp_messages m LEFT JOIN stores s ON s.id = m.store_id
     WHERE strftime('%Y-%m', m.created_at, 'unixepoch') = ? GROUP BY m.store_id ORDER BY outbound DESC`,
  ).bind(period).all()
  const categories = await db.prepare(
    `SELECT store_id AS storeId, COALESCE(pricing_category, 'sin_informar') AS category, COALESCE(pricing_type, '') AS type, COUNT(*) AS messages, SUM(billable = 1) AS billable
     FROM whatsapp_messages WHERE direction = 'out' AND status <> 'error' AND strftime('%Y-%m', created_at, 'unixepoch') = ? GROUP BY store_id, category, type`,
  ).bind(period).all()
  // AI interactions that entered through WhatsApp (their event key starts with "wa:").
  const ai = await db.prepare(
    `SELECT store_id AS storeId, COUNT(*) AS aiMessages, SUM(channel = 'telegram_voice') AS voiceMessages, COALESCE(SUM(audio_seconds), 0) AS audioSeconds,
            COALESCE(SUM(ai_cost_micros), 0) AS aiCostMicros, COALESCE(SUM(transcription_cost_micros), 0) AS transcriptionCostMicros
     FROM ai_message_ledger WHERE event_key LIKE 'wa:%' AND status = 'consumed' AND strftime('%Y-%m', created_at) = ? GROUP BY store_id`,
  ).bind(period).all()
  return { period, stores: messages.results || [], categories: categories.results || [], ai: ai.results || [] }
}
