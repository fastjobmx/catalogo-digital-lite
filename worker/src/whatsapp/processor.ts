/**
 * Adaptador de WhatsApp del asistente de tiendas. Recibe los eventos de Meta (Cloud API oficial) o de
 * WAHA, los normaliza a un formato común (inbound.ts), identifica al
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
import { fromMetaMessage, readStoredInbound, type MetaInboundMessage, type NormalizedInbound, type WhatsAppProvider } from './inbound'
import { downloadWahaMedia, sendWahaImage, sendWahaText, wahaEnabled, wahaSeenAndTyping, wahaStopTyping, type WahaSessionStatus } from './waha'
import { handleBatchText, maintainPhotoBatches, receiveBatchPhoto, shouldBatchPhoto } from './photoBatch'
import { applyPendingBatchNote } from '../services/assistant/agent/media'

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

type InboundMessage = MetaInboundMessage

/** Programa trabajo que debe seguir después de responder al proveedor (waitUntil en producción). */
export type Defer = (work: Promise<unknown>) => void

/**
 * Tiendas habilitadas para el canal (WHATSAPP_PILOT_STORE_IDS): una lista de ids, o «*» para todas.
 * Vacío o sin definir = ninguna: abrir el canal a todos los comercios exige escribirlo a propósito.
 */
export function pilotAllows(env: Partial<Bindings>, storeId: number): boolean {
  const raw = String(env.WHATSAPP_PILOT_STORE_IDS || '').trim()
  if (raw === '*') return true
  const pilot = raw.split(',').map((value) => Number(value.trim())).filter((value) => Number.isSafeInteger(value) && value > 0)
  return pilot.includes(storeId)
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
        ).bind(message.id, sender.key, kind, skip ? 'ignored' : 'received', skip ? null : JSON.stringify({ v: 2, inbound: fromMetaMessage(message, sender, String(env.WHATSAPP_PHONE_NUMBER_ID || '')) }), stale ? 'STALE' : null).run()
        if (inserted.meta.changes && !skip) pending.push(Number(inserted.meta.last_row_id))
      }
    }
  }
  return pending
}

/**
 * WAHA: guarda un evento ya autenticado y normalizado. Devuelve el renglón por procesar (o null).
 * El id del mensaje lleva el prefijo del proveedor, así nunca choca con un id de Meta.
 */
export async function recordWahaMessage(db: D1Database, inbound: NormalizedInbound): Promise<number | null> {
  const inserted = await db.prepare(
    `INSERT OR IGNORE INTO whatsapp_messages (wa_message_id, direction, sender_key, kind, status, payload_json, provider) VALUES (?, 'in', ?, ?, 'received', ?, 'waha')`,
  ).bind(`waha:${inbound.messageId}`, inbound.sender.key, inbound.kind, JSON.stringify({ v: 2, inbound })).run()
  if (inserted.meta.changes) {
    await db.prepare(
      `INSERT INTO whatsapp_channels (provider, session_name, status, last_message_at) VALUES ('waha', ?, 'WORKING', unixepoch())
       ON CONFLICT(provider, session_name) DO UPDATE SET last_message_at = unixepoch(), updated_at = unixepoch()`,
    ).bind(inbound.sessionId).run().catch(() => undefined)
  }
  return inserted.meta.changes ? Number(inserted.meta.last_row_id) : null
}

/** WAHA: estado de la sesión (vinculada, esperando QR, caída). Los cambios quedan como evento de plataforma. */
export async function recordWahaStatus(db: D1Database, status: WahaSessionStatus): Promise<void> {
  const previous = await db.prepare(`SELECT status FROM whatsapp_channels WHERE provider = 'waha' AND session_name = ?`).bind(status.session).first<{ status: string }>()
  await db.prepare(
    `INSERT INTO whatsapp_channels (provider, session_name, status, phone_ending, last_status_at) VALUES ('waha', ?, ?, ?, ?)
     ON CONFLICT(provider, session_name) DO UPDATE SET status = excluded.status, phone_ending = COALESCE(excluded.phone_ending, phone_ending),
       last_status_at = excluded.last_status_at, updated_at = unixepoch()`,
  ).bind(status.session, status.status, status.phoneEnding, status.at).run()
  if (previous?.status !== status.status) {
    const level = ['FAILED', 'STOPPED', 'SCAN_QR_CODE'].includes(status.status) ? 'warning' : 'info'
    await db.prepare(`INSERT INTO platform_events (level, source, code, detail) VALUES (?, 'whatsapp', 'WAHA_SESSION_STATUS', ?)`)
      .bind(level, `${status.session}: ${previous?.status ?? 'sin estado'} -> ${status.status}`).run().catch(() => undefined)
  }
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

export type Outbox = {
  env: Bindings; db: D1Database; sender: Sender; inboundId: number; inboundWaId: string
  identityId: number | null; storeId: number | null; lastInboundAt: number; sent: number
  provider: WhatsAppProvider
  /** Límite de respuestas de este mensaje (por defecto MAX_REPLIES_PER_MESSAGE). */
  replyLimit?: number
}

const pause = (env: Partial<Bindings>, ms: number) => (env.ENVIRONMENT === 'test' ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms)))

export async function deliver(outbox: Outbox, html: string, replyMarkup?: Record<string, unknown>): Promise<Option[] | null> {
  const waha = outbox.provider === 'waha'
  const { messages, numbered } = buildOutbound(html, replyMarkup, { interactive: !waha })
  for (const message of messages) {
    // Meta: free-form replies are only allowed within 24 h of the merchant's last message. Every provider:
    // one incoming message never fans out into an unbounded number of (possibly billed) replies.
    const windowClosed = !waha && Math.floor(Date.now() / 1000) - outbox.lastInboundAt > WINDOW_SECONDS
    const blocked = windowClosed ? 'WINDOW_CLOSED' : outbox.sent >= (outbox.replyLimit ?? MAX_REPLIES_PER_MESSAGE) ? 'REPLY_LIMIT' : null
    let waId = `local:${crypto.randomUUID()}`
    let failure = blocked
    if (!blocked) {
      try {
        if (waha) {
          // WAHA: ritmo humano (leído, escribiendo, breve pausa, texto), como recomienda su documentación.
          // The time the assistant took to think already reads as a person typing: only a short, uneven pause
          // before the first message, and a slightly longer one between consecutive messages.
          await pause(outbox.env, (outbox.sent ? 350 : 120) + Math.floor(Math.random() * 250))
          waId = await sendWahaText(outbox.env, outbox.sender, String((message.text as { body?: string } | undefined)?.body || ''))
        } else {
          waId = await sendWhatsApp(outbox.env, { phone: outbox.sender.phone, businessUserId: outbox.sender.businessUserId }, message)
        }
        outbox.sent++
      } catch (error) {
        failure = error instanceof WhatsAppApiError ? error.code : error instanceof Error && error.message.startsWith('WAHA_API_') ? error.message.slice(9, 49) : 'SEND_FAILED'
      }
    }
    await outbox.db.prepare(
      `INSERT OR IGNORE INTO whatsapp_messages (wa_message_id, direction, sender_key, identity_id, store_id, kind, status, reply_to, error_code, provider) VALUES (?, 'out', ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(waId, outbox.sender.key, outbox.identityId, outbox.storeId, String(message.type), failure ? 'error' : 'sent', outbox.inboundId, failure, outbox.provider).run()
    if (failure && !blocked) throw new Error(`WHATSAPP_SEND_${failure}`)
  }
  // Cosmetic: the reply never waits for it (WhatsApp clears "typing" when the message lands anyway).
  if (waha && messages.length) {
    const stop = wahaStopTyping(outbox.env, outbox.sender).catch(() => undefined)
    if (outbox.env.ENVIRONMENT === 'test') await stop
  }
  return numbered
}

async function downloadMedia(outbox: Outbox, ref: string, maxBytes: number): Promise<{ bytes: Uint8Array; mimeType: string }> {
  return outbox.provider === 'waha' ? downloadWahaMedia(outbox.env, ref, maxBytes) : downloadWhatsAppMedia(outbox.env, ref, maxBytes)
}

/** Bytes de una foto que el motor nombra por su id: foto de un lote (R2) o archivo recibido por WAHA. */
async function sendPhotoViaWaha(outbox: Outbox, photo: string): Promise<void> {
  if (outbox.sent >= (outbox.replyLimit ?? MAX_REPLIES_PER_MESSAGE)) return
  let image: { bytes: Uint8Array; mimeType: string } | null = null
  const item = /^batch:(\d{1,12})$/.exec(photo)
  if (item && outbox.env.ASSETS) {
    const row = await outbox.db.prepare(`SELECT temp_key, content_type FROM whatsapp_photo_items WHERE id = ? AND store_id = ?`).bind(Number(item[1]), outbox.storeId).first<{ temp_key: string | null; content_type: string | null }>()
    const object = row?.temp_key ? await outbox.env.ASSETS.get(row.temp_key) : null
    if (object) image = { bytes: new Uint8Array(await object.arrayBuffer()), mimeType: String(row!.content_type || 'image/jpeg') }
  } else if (/^[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9@._-]{1,200}$/.test(photo)) {
    image = await downloadWahaMedia(outbox.env, photo, WHATSAPP_IMAGE_LIMIT)
    if (!/^image\//.test(image.mimeType)) image = { ...image, mimeType: inspectRasterImage(image.bytes).contentType }
  }
  if (!image) return
  await pause(outbox.env, 150 + Math.floor(Math.random() * 250))
  const waId = await sendWahaImage(outbox.env, outbox.sender, image)
  outbox.sent++
  await outbox.db.prepare(
    `INSERT OR IGNORE INTO whatsapp_messages (wa_message_id, direction, sender_key, identity_id, store_id, kind, status, reply_to, provider) VALUES (?, 'out', ?, ?, ?, 'image', 'sent', ?, 'waha')`,
  ).bind(waId, outbox.sender.key, outbox.identityId, outbox.storeId, outbox.inboundId).run()
}

export function createChannel(outbox: Outbox): AssistantChannel {
  const { env, db } = outbox
  return {
    name: 'whatsapp',
    provider: outbox.provider,
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
    async sendPhoto(photo, caption, replyMarkup) {
      // WAHA: the product photo goes first (preview and published product), then the text with its options.
      // Meta: the merchant has just sent the photo; the preview is the summary with its buttons.
      if (outbox.provider === 'waha') await sendPhotoViaWaha(outbox, photo).catch((error) => console.error('WAHA image send failed:', error instanceof Error ? error.message.slice(0, 60) : 'unknown'))
      await this.send(caption, replyMarkup)
    },
    async typing() {
      // "Seen" and "typing…" are sent in the background: the assistant starts working at once instead of
      // waiting for two round trips to the provider.
      const signal = (outbox.provider === 'waha' ? wahaSeenAndTyping(env, outbox.sender, outbox.inboundWaId) : markReadAndTyping(env, outbox.inboundWaId)).catch(() => undefined)
      if (env.ENVIRONMENT === 'test') await signal
    },
    async downloadImage(fileId) {
      let bytes: Uint8Array
      try { bytes = (await downloadMedia(outbox, fileId, WHATSAPP_IMAGE_LIMIT)).bytes }
      catch (error) { throw new Error(error instanceof Error && /_MEDIA_TOO_LARGE$/.test(error.message) ? 'TELEGRAM_IMAGE_TOO_LARGE' : 'TELEGRAM_FILE_DOWNLOAD_FAILED') }
      return { bytes, ...inspectRasterImage(bytes) }
    },
    async downloadFile(fileId, maxBytes) { return (await downloadMedia(outbox, fileId, maxBytes)).bytes },
    async downloadVoice(fileId) {
      const { bytes } = await downloadMedia(outbox, fileId, VOICE_LIMIT)
      if (bytes[0] !== 0x4f || bytes[1] !== 0x67 || bytes[2] !== 0x67 || bytes[3] !== 0x53) throw new Error('WhatsApp voice is not an OGG stream')
      return { mimeType: 'audio/ogg', data: bytesToBase64(bytes), seconds: oggOpusSeconds(bytes) }
    },
  }
}

// ───────────────────────── Procesamiento ─────────────────────────

/** Procesa un mensaje entrante guardado. Solo un proceso lo toma; nunca se ejecuta dos veces. */
export async function processInbound(env: Bindings, db: D1Database, rowId: number, opts: { defer?: Defer } = {}): Promise<void> {
  const row = await db.prepare(
    `UPDATE whatsapp_messages SET status = 'processing', attempts = attempts + 1, updated_at = unixepoch()
     WHERE id = ? AND direction = 'in' AND status = 'received' RETURNING wa_message_id AS waId, payload_json AS payload`,
  ).bind(rowId).first<{ waId: string; payload: string | null }>()
  if (!row) return
  let outcome: { status: 'processed' | 'ignored' | 'failed'; code?: string; identityId?: number | null; storeId?: number | null } = { status: 'processed' }
  try {
    const inbound = readStoredInbound(row.payload, String(env.WHATSAPP_PHONE_NUMBER_ID || ''))
    if (!inbound) throw new Error('INBOUND_UNREADABLE')
    // A provider switched off after the message was stored: nothing is answered through it.
    if (inbound.provider === 'waha' && !wahaEnabled(env)) outcome = { status: 'ignored', code: 'WAHA_DISABLED' }
    else outcome = await handleInbound(env, db, { rowId, inbound, defer: opts.defer })
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

async function handleInbound(env: Bindings, db: D1Database, input: { rowId: number; inbound: NormalizedInbound; defer?: Defer }): Promise<Outcome> {
  const { inbound, rowId } = input
  const sender = inbound.sender
  // A batch of forwarded photos arrives as a burst: WAHA photos have their own, wider window, so 100 of them
  // are not throttled and never use up the window of the texts that follow ("listo", "sí").
  const photoBurst = inbound.kind === 'image' && inbound.provider === 'waha'
  if (await throttle(db, photoBurst ? `${sender.key}#photos` : sender.key, 'messages', 60) > (photoBurst ? 8 * BURST_PER_MINUTE : BURST_PER_MINUTE)) return { status: 'ignored', code: 'RATE_LIMITED' }
  const outbox: Outbox = { env, db, sender, inboundId: rowId, inboundWaId: inbound.messageId, identityId: null, storeId: null, lastInboundAt: Math.floor(Date.now() / 1000), sent: 0, provider: inbound.provider }
  const text = inbound.kind === 'text' ? inbound.text : ''

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

  const update = toAssistantUpdate(identity, rowId, sender.name, inbound)
  const channel = createChannel(outbox)
  const who: AssistantIdentity = {
    db, env, botToken: '', chatId: whatsappChatId(identity.id), telegramUserId: whatsappUserKey(identity.id),
    firstName: sender.name, updateId: update.update_id, channel,
  }
  const ctx = await openAssistantContext(who, memberships, update.callback_query ? { data: update.callback_query.data } : null)
  if (!ctx) return { status: 'processed', code: 'STORE_PICKER', identityId: identity.id }
  outbox.storeId = ctx.store.id
  // Lotes de fotos (WAHA, activados aparte): las fotos sueltas se agrupan por productos con IA y el
  // comerciante revisa el lote por bloques, en vez de recibir una pregunta por cada foto.
  if (inbound.kind === 'image' && await shouldBatchPhoto(ctx, inbound)) {
    const code = await receiveBatchPhoto(ctx, outbox, inbound, input.defer)
    return { status: 'processed', code, identityId: identity.id, storeId: ctx.store.id }
  }
  const batchInput = update.callback_query?.data ?? text
  // Media layer: a description the merchant gave while the photos were being organised is applied before the batch reads «sí».
  if (batchInput) await applyPendingBatchNote(ctx)
  if (batchInput && await handleBatchText(ctx, outbox, batchInput, input.defer)) {
    return { status: 'processed', code: 'PHOTO_BATCH', identityId: identity.id, storeId: ctx.store.id }
  }
  await dispatchAssistantUpdate(ctx, update)
  await watchVolume(env, db, ctx.store.id)
  return { status: 'processed', identityId: identity.id, storeId: ctx.store.id }
}

/** El mensaje de WhatsApp en la forma que el motor ya entiende (la misma de Telegram). */
function toAssistantUpdate(identity: WhatsAppIdentity, rowId: number, firstName: string, inbound: NormalizedInbound): TelegramUpdate {
  const chatId = whatsappChatId(identity.id)
  const from = { id: chatId, first_name: firstName }
  const chat = { id: chatId, type: 'private' as const }
  const updateId = whatsappUpdateId(rowId)
  const callback = (data: string): TelegramUpdate => ({ update_id: updateId, callback_query: { id: 'whatsapp', from, data: data.slice(0, 200), message: { message_id: rowId, chat, date: 0 } } })
  const base = { message_id: rowId, from, chat, date: Number(inbound.receivedAt || 0) }
  const text = inbound.kind === 'text' ? inbound.text : ''
  const media = inbound.media

  if (inbound.kind === 'interactive' && inbound.tapped) return callback(inbound.tapped)
  if (text) {
    // A number answers the last numbered menu, and only while that menu is the last thing shown.
    const choice = /^\d{1,2}$/.test(text) ? numberedChoice(identity.menuJson, Number(text)) : null
    if (choice) return callback(choice)
    const normalized = /^\/start\b/i.test(text) ? 'hola' : /^(?:mis )?tiendas?$/i.test(text) ? '/tiendas' : /^ayuda$/i.test(text) ? '/ayuda' : text
    return { update_id: updateId, message: { ...base, text: normalized } }
  }
  const caption = inbound.caption ? { caption: inbound.caption.slice(0, 1000) } : {}
  if (inbound.kind === 'image' && media) {
    return { update_id: updateId, message: { ...base, photo: [{ file_id: media.ref }], ...caption } }
  }
  if (inbound.kind === 'audio' && media) {
    return media.voice
      ? { update_id: updateId, message: { ...base, voice: { file_id: media.ref, duration: 0, mime_type: media.mimeType } } }
      : { update_id: updateId, message: { ...base, audio: { file_id: media.ref, duration: 0, mime_type: media.mimeType } } }
  }
  if (inbound.kind === 'document' && media) {
    return { update_id: updateId, message: { ...base, document: { file_id: media.ref, file_name: String(media.filename || 'archivo').slice(0, 200), mime_type: media.mimeType.split(';')[0] }, ...caption } }
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
  // Photo batches: retention of temporary images runs even with the channel off.
  await maintainPhotoBatches(env, db).catch((error) => console.error('WhatsApp photo batches maintenance failed:', error instanceof Error ? error.message : 'unknown'))
  const providers = [whatsappEnabled(env) ? 'meta' : null, wahaEnabled(env) ? 'waha' : null].filter(Boolean) as string[]
  if (!providers.length) return
  const waiting = await db.prepare(
    `SELECT id FROM whatsapp_messages WHERE direction = 'in' AND status = 'received' AND created_at < unixepoch() - 60 AND provider IN (${providers.map(() => '?').join(', ')}) ORDER BY id LIMIT 10`,
  ).bind(...providers).all<{ id: number }>()
  for (const row of waiting.results || []) await processInbound(env, db, row.id)
}

/** Consumo del canal por tienda en un mes (AAAA-MM). Los mensajes sin tienda son costo de plataforma. */
export async function whatsappUsageReport(db: D1Database, period: string) {
  const messages = await db.prepare(
    `SELECT m.provider AS provider, m.store_id AS storeId, s.name AS storeName,
            SUM(m.direction = 'in') AS inbound, SUM(m.direction = 'out' AND m.status <> 'error') AS outbound,
            SUM(m.direction = 'out' AND m.status = 'error') AS failed,
            SUM(m.direction = 'out' AND m.billable = 1) AS billable, SUM(m.direction = 'out' AND m.billable = 0) AS free,
            SUM(m.direction = 'out' AND m.status <> 'error' AND m.billable IS NULL) AS pricingUnknown,
            SUM(m.direction = 'in' AND m.kind = 'audio') AS voiceNotes, SUM(m.direction = 'in' AND m.kind = 'image') AS images,
            SUM(m.direction = 'in' AND m.kind = 'document') AS documents,
            COALESCE(SUM(m.estimated_cost_micros), 0) AS estimatedMetaCostMicros
     FROM whatsapp_messages m LEFT JOIN stores s ON s.id = m.store_id
     WHERE strftime('%Y-%m', m.created_at, 'unixepoch') = ? GROUP BY m.provider, m.store_id ORDER BY outbound DESC`,
  ).bind(period).all()
  const categories = await db.prepare(
    `SELECT store_id AS storeId, COALESCE(pricing_category, 'sin_informar') AS category, COALESCE(pricing_type, '') AS type, COUNT(*) AS messages, SUM(billable = 1) AS billable
     FROM whatsapp_messages WHERE direction = 'out' AND status <> 'error' AND strftime('%Y-%m', created_at, 'unixepoch') = ? GROUP BY store_id, category, type`,
  ).bind(period).all()
  // AI interactions of the WhatsApp assistant: their own ledger, apart from the Telegram quota of the plan.
  const ai = await db.prepare(
    `SELECT CASE WHEN event_key LIKE 'wa:waha:%' THEN 'waha' ELSE 'meta' END AS provider, store_id AS storeId, COUNT(*) AS aiMessages, SUM(kind = 'voice') AS voiceMessages, COALESCE(SUM(audio_seconds), 0) AS audioSeconds,
            COALESCE(SUM(ai_cost_micros), 0) AS aiCostMicros, COALESCE(SUM(transcription_cost_micros), 0) AS transcriptionCostMicros
     FROM whatsapp_ai_ledger WHERE status = 'consumed' AND strftime('%Y-%m', created_at) = ? GROUP BY provider, store_id`,
  ).bind(period).all()
  // Every AI call made from WhatsApp (photos, documents, descriptions included), never added to the store budget.
  const calls = await db.prepare(
    `SELECT CASE channel WHEN 'whatsapp_waha' THEN 'waha' ELSE 'meta' END AS provider, store_id AS storeId, feature, status, COUNT(*) AS calls, COALESCE(SUM(estimated_cost_micros), 0) AS costMicros
     FROM ai_usage_events WHERE channel IN ('whatsapp', 'whatsapp_waha') AND period = ? GROUP BY provider, store_id, feature, status`,
  ).bind(period).all()
  // Connections of the platform (WAHA sessions): the bot number is a property of the connection, never of a store.
  const channels = await db.prepare(
    `SELECT provider, session_name AS session, status, phone_ending AS phoneEnding, last_status_at AS lastStatusAt, last_message_at AS lastMessageAt FROM whatsapp_channels ORDER BY provider, session_name`,
  ).all()
  const batches = await db.prepare(
    `SELECT store_id AS storeId, COUNT(*) AS batches, COALESCE(SUM(photo_count), 0) AS photos, COALESCE(SUM(duplicate_count), 0) AS duplicates,
            COALESCE(SUM(published_count), 0) AS published, COALESCE(SUM(skipped_count), 0) AS skipped
     FROM whatsapp_photo_batches WHERE strftime('%Y-%m', created_at, 'unixepoch') = ? GROUP BY store_id`,
  ).bind(period).all()
  return {
    period, stores: messages.results || [], categories: categories.results || [], ai: ai.results || [], aiCalls: calls.results || [],
    channels: channels.results || [], photoBatches: batches.results || [],
  }
}
