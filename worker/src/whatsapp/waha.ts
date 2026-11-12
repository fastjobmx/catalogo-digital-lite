/**
 * WAHA (WhatsApp HTTP API, devlikeapro) como proveedor alternativo de WhatsApp. NO es la API oficial
 * de Meta: usa una sesión de WhatsApp vinculada por QR y puede ser suspendida por WhatsApp.
 *
 * El Worker solo habla con WAHA a través del gateway de infra/waha (lista blanca, X-Gateway-Token)
 * con una clave de sesión limitada a lectura y envío. Nada aquí conoce tiendas ni productos.
 */
import type { Env } from '../index'
import { constantTimeEqual } from './api'
import type { NormalizedInbound } from './inbound'
import type { Sender } from './identity'

type Bindings = Env['Bindings']

/** WAHA no documenta un tope; un evento de mensaje real pesa pocos KB (las fotos van por URL). */
export const MAX_WAHA_WEBHOOK_BYTES = 512 * 1024
const STALE_EVENT_SECONDS = 15 * 60

export function wahaEnabled(env: Partial<Bindings>): boolean {
  return String(env.WAHA_ENABLED || '').toLowerCase() === 'true'
}

export function wahaConfigured(env: Partial<Bindings>): boolean {
  return Boolean(env.WAHA_API_URL && env.WAHA_API_KEY && env.WAHA_GATEWAY_TOKEN && env.WAHA_WEBHOOK_HMAC_KEY && wahaSession(env))
}

export function wahaSession(env: Partial<Bindings>): string {
  const value = String(env.WAHA_SESSION || '').trim()
  return /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : ''
}

/** X-Webhook-Hmac: HMAC-SHA512 en hexadecimal del cuerpo original, con la clave del webhook. */
export async function verifyWahaSignature(rawBody: ArrayBuffer, header: string | null | undefined, algorithm: string | null | undefined, key: string): Promise<boolean> {
  const signature = (header || '').trim().toLowerCase()
  if (!key || !/^[0-9a-f]{128}$/.test(signature)) return false
  if (algorithm && algorithm.trim().toLowerCase() !== 'sha512') return false
  const cryptoKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign'])
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, rawBody))
  return constantTimeEqual([...digest].map((byte) => byte.toString(16).padStart(2, '0')).join(''), signature)
}

// ───────────────────────── Normalización ─────────────────────────

type WahaEvent = {
  id?: string; event?: string; session?: string; timestamp?: number
  me?: { id?: string }
  payload?: Record<string, any>
}

export type WahaSessionStatus = { session: string; status: string; phoneEnding: string | null; at: number }

/** JID → teléfono (solo dígitos) cuando es un número; null si es un LID u otra cosa. */
function phoneOf(jid: unknown): string | null {
  const match = typeof jid === 'string' ? /^(\d{6,20})(?::\d+)?@(?:c\.us|s\.whatsapp\.net)$/.exec(jid) : null
  return match ? match[1]! : null
}

function lidOf(jid: unknown): string | null {
  const match = typeof jid === 'string' ? /^(\d{1,30})@lid$/.exec(jid) : null
  return match ? match[1]! : null
}

/** Ruta del archivo en WAHA a partir de media.url: nunca se usa el host que viene en el evento. */
function mediaRef(url: unknown, session: string): string | null {
  if (typeof url !== 'string') return null
  let path: string
  try { path = new URL(url).pathname } catch { return null }
  const match = /^\/api\/files\/([A-Za-z0-9_-]{1,64})\/([A-Za-z0-9@._-]{1,200})$/.exec(path)
  return match && match[1] === session ? `${match[1]}/${match[2]}` : null
}

function base64ToHex(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/=]{40,64}$/.test(value)) return undefined
  try { return [...atob(value)].map((char) => char.charCodeAt(0).toString(16).padStart(2, '0')).join('') } catch { return undefined }
}

export type WahaParsed =
  | { kind: 'message'; inbound: NormalizedInbound }
  | { kind: 'status'; status: WahaSessionStatus }
  | { kind: 'ignored'; reason: string }

/**
 * Convierte un evento autenticado de WAHA al formato interno. Solo acepta mensajes privados recibidos
 * por la sesión configurada; descarta los propios (evita bucles), grupos, canales, estados y difusiones.
 */
export function parseWahaEvent(env: Partial<Bindings>, body: unknown, trace: { requestId?: string } = {}): WahaParsed {
  const event = body as WahaEvent
  const session = wahaSession(env)
  if (!event || typeof event !== 'object' || !session) return { kind: 'ignored', reason: 'INVALID' }
  if (event.session !== session) return { kind: 'ignored', reason: 'OTHER_SESSION' }
  const now = Math.floor(Date.now() / 1000)
  if (event.event === 'session.status') {
    const status = String(event.payload?.status || '').slice(0, 40)
    if (!/^[A-Z_]{2,40}$/.test(status)) return { kind: 'ignored', reason: 'INVALID_STATUS' }
    const me = phoneOf(event.me?.id)
    return { kind: 'status', status: { session, status, phoneEnding: me ? me.slice(-4) : null, at: Math.floor(Number(event.timestamp || now * 1000) / 1000) } }
  }
  if (event.event !== 'message') return { kind: 'ignored', reason: 'EVENT_NOT_HANDLED' }
  const p = event.payload
  if (!p || typeof p !== 'object') return { kind: 'ignored', reason: 'INVALID' }
  if (p.fromMe === true || p._data?.Info?.IsFromMe === true) return { kind: 'ignored', reason: 'FROM_ME' }
  const from = String(p.from || '')
  if (p._data?.Info?.IsGroup === true || /@(g\.us|newsletter|broadcast)$/.test(from) || from === 'status@broadcast') return { kind: 'ignored', reason: 'NOT_PRIVATE' }
  const messageId = typeof p.id === 'string' && p.id.length <= 200 ? p.id : ''
  if (!messageId) return { kind: 'ignored', reason: 'NO_ID' }
  const receivedAt = Number(p.timestamp || 0)
  if (!receivedAt || now - receivedAt > STALE_EVENT_SECONDS) return { kind: 'ignored', reason: 'STALE' }

  const info = p._data?.Info ?? {}
  const message = p._data?.Message ?? {}
  // GOWS entrega el remitente como LID y el teléfono en SenderAlt; WEBJS/NOWEB pueden traer @c.us.
  const phone = phoneOf(from) ?? phoneOf(info.SenderAlt) ?? phoneOf(info.Sender)
  const lid = lidOf(from) ?? lidOf(info.Sender) ?? lidOf(info.SenderAlt)
  if (!phone && !lid) return { kind: 'ignored', reason: 'NO_SENDER' }
  const name = typeof info.PushName === 'string' ? info.PushName.replace(/[<>&]/g, '').trim().split(/\s+/)[0]?.slice(0, 40) || '' : ''
  // Con teléfono conocido la identidad es el teléfono (igual que con Meta); el LID solo si no hay teléfono.
  const sender: Sender = { businessUserId: phone ? null : `waha-lid:${lid}`, phone, key: phone ?? `waha-lid:${lid}`, name }

  const base = {
    provider: 'waha' as const, channelId: session, sessionId: session, messageId, sender, receivedAt, text: '',
    trace: { ...(event.id ? { eventId: String(event.id).slice(0, 80) } : {}), ...(trace.requestId ? { requestId: trace.requestId.slice(0, 80) } : {}) },
  }
  // Un álbum llega como un mensaje vacío que anuncia N fotos y luego cada foto por separado.
  if (message.albumMessage) return { kind: 'ignored', reason: 'ALBUM_HEADER' }
  if (message.reactionMessage || message.protocolMessage || message.pollUpdateMessage) return { kind: 'ignored', reason: 'NOT_A_MESSAGE' }

  const context = message.imageMessage?.contextInfo ?? message.documentMessage?.contextInfo ?? message.audioMessage?.contextInfo ?? message.extendedTextMessage?.contextInfo ?? {}
  const forwarded = context.isForwarded === true || Number(context.forwardingScore || 0) > 0
  const albumRaw = message.messageContextInfo?.messageAssociation?.parentMessageKey?.ID
  const albumId = typeof albumRaw === 'string' && /^[A-Za-z0-9]{6,64}$/.test(albumRaw) ? albumRaw : undefined
  const caption = typeof p.body === 'string' && p.body.trim() ? p.body.trim().slice(0, 1000) : undefined

  if (p.hasMedia) {
    const mime = String(p.media?.mimetype || '').toLowerCase()
    const ref = mediaRef(p.media?.url, session)
    // Archivo no descargado por WAHA (tipo no permitido o error): el motor responde que no puede usarlo.
    if (!ref) return { kind: 'message', inbound: { ...base, kind: 'other', forwarded } }
    if (message.imageMessage || /^image\/(jpeg|png|webp)/.test(mime)) {
      const image = message.imageMessage ?? {}
      return { kind: 'message', inbound: {
        ...base, kind: 'image', forwarded, ...(albumId ? { albumId } : {}), ...(caption ? { caption } : {}),
        media: {
          ref, mimeType: mime.split(';')[0]!,
          ...(base64ToHex(image.fileSHA256) ? { sha256: base64ToHex(image.fileSHA256) } : {}),
          ...(Number(image.fileLength) > 0 ? { size: Number(image.fileLength) } : {}),
          ...(Number(image.width) > 0 ? { width: Number(image.width), height: Number(image.height) } : {}),
        },
      } }
    }
    if (message.audioMessage || mime.startsWith('audio/')) {
      return { kind: 'message', inbound: { ...base, kind: 'audio', forwarded, media: { ref, mimeType: mime.split(';')[0]!, voice: message.audioMessage?.PTT === true || /ogg|opus/.test(mime) } } }
    }
    if (message.documentMessage || p.media?.filename) {
      const filename = String(p.media?.filename || message.documentMessage?.fileName || 'archivo').replace(/[\r\n]/g, ' ').slice(0, 200)
      return { kind: 'message', inbound: { ...base, kind: 'document', forwarded, ...(caption ? { caption } : {}), media: { ref, mimeType: mime.split(';')[0]!, filename } } }
    }
    return { kind: 'message', inbound: { ...base, kind: 'other', forwarded } }
  }
  const text = typeof p.body === 'string' ? p.body.trim().slice(0, 4000) : ''
  if (text) return { kind: 'message', inbound: { ...base, kind: 'text', text, forwarded } }
  return { kind: 'message', inbound: { ...base, kind: 'other', forwarded } }
}

// ───────────────────────── Llamadas al gateway ─────────────────────────

export class WahaApiError extends Error {
  constructor(public code: string, public status: number) { super(`WAHA_API_${code}`) }
}

function gatewayBase(env: Partial<Bindings>): string {
  const url = String(env.WAHA_API_URL || '').replace(/\/+$/, '')
  // Solo HTTPS (túnel o dominio propio). http únicamente en pruebas locales.
  if (!/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(url) && !(env.ENVIRONMENT === 'test' && /^http:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(url))) throw new WahaApiError('NOT_CONFIGURED', 0)
  return url
}

function headers(env: Partial<Bindings>, json = true): Record<string, string> {
  return {
    'X-Api-Key': String(env.WAHA_API_KEY || ''),
    'X-Gateway-Token': String(env.WAHA_GATEWAY_TOKEN || ''),
    Accept: 'application/json',
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  }
}

/** Destino de la respuesta: el mismo chat que escribió (teléfono o LID). */
export function wahaChatId(sender: Pick<Sender, 'phone' | 'businessUserId'>): string {
  if (sender.phone) return `${sender.phone}@c.us`
  const lid = sender.businessUserId?.startsWith('waha-lid:') ? sender.businessUserId.slice('waha-lid:'.length) : ''
  if (!/^\d{1,30}$/.test(lid)) throw new WahaApiError('NO_RECIPIENT', 0)
  return `${lid}@lid`
}

async function post(env: Partial<Bindings>, path: string, body: Record<string, unknown>, timeout = 15_000): Promise<Record<string, any>> {
  if (!wahaConfigured(env)) throw new WahaApiError('NOT_CONFIGURED', 0)
  const response = await fetch(`${gatewayBase(env)}${path}`, { method: 'POST', headers: headers(env), body: JSON.stringify({ session: wahaSession(env), ...body }), signal: AbortSignal.timeout(timeout) })
  // Never surface the response text: only the HTTP status goes to logs and the message record.
  if (!response.ok) throw new WahaApiError(String(response.status), response.status)
  return await response.json().catch(() => ({})) as Record<string, any>
}

/** Envía un texto. Devuelve el id del mensaje que asignó WhatsApp. */
export async function sendWahaText(env: Partial<Bindings>, to: Pick<Sender, 'phone' | 'businessUserId'>, text: string): Promise<string> {
  const result = await post(env, '/api/sendText', { chatId: wahaChatId(to), text, linkPreview: false })
  const id = typeof result.id === 'string' ? result.id : typeof result.key?.id === 'string' ? result.key.id : typeof result._data?.ID === 'string' ? result._data.ID : null
  return `waha:${(id || crypto.randomUUID()).slice(0, 180)}`
}

/** Envía una imagen (bytes propios, nunca una URL externa) con un pie corto. */
export async function sendWahaImage(env: Partial<Bindings>, to: Pick<Sender, 'phone' | 'businessUserId'>, image: { bytes: Uint8Array; mimeType: string }, caption = ''): Promise<string> {
  if (!/^image\/(jpeg|png|webp)$/.test(image.mimeType) || image.bytes.byteLength > 5 * 1024 * 1024) throw new WahaApiError('IMAGE_INVALID', 0)
  let binary = ''
  for (let index = 0; index < image.bytes.length; index += 0x8000) binary += String.fromCharCode(...image.bytes.subarray(index, index + 0x8000))
  const extension = image.mimeType === 'image/png' ? 'png' : image.mimeType === 'image/webp' ? 'webp' : 'jpg'
  const result = await post(env, '/api/sendImage', {
    chatId: wahaChatId(to), caption: caption.slice(0, 900),
    file: { mimetype: image.mimeType, filename: `producto.${extension}`, data: btoa(binary) },
  }, 30_000)
  const id = typeof result.id === 'string' ? result.id : typeof result.key?.id === 'string' ? result.key.id : null
  return `waha:${(id || crypto.randomUUID()).slice(0, 180)}`
}

/** Marca el chat como leído y muestra "escribiendo…" (cosmético; los fallos no detienen la respuesta). */
export async function wahaSeenAndTyping(env: Partial<Bindings>, to: Pick<Sender, 'phone' | 'businessUserId'>, messageId: string): Promise<void> {
  const chatId = wahaChatId(to)
  await post(env, '/api/sendSeen', { chatId, messageIds: [messageId] }, 5_000).catch(() => undefined)
  await post(env, '/api/startTyping', { chatId }, 5_000).catch(() => undefined)
}

export async function wahaStopTyping(env: Partial<Bindings>, to: Pick<Sender, 'phone' | 'businessUserId'>): Promise<void> {
  await post(env, '/api/stopTyping', { chatId: wahaChatId(to) }, 5_000).catch(() => undefined)
}

/** Descarga un archivo recibido por su ruta en WAHA (sesión del asistente), con límite estricto de tamaño. */
export async function downloadWahaMedia(env: Partial<Bindings>, ref: string, maxBytes: number): Promise<{ bytes: Uint8Array; mimeType: string }> {
  if (!wahaConfigured(env)) throw new Error('WAHA_NOT_CONFIGURED')
  const match = /^([A-Za-z0-9_-]{1,64})\/([A-Za-z0-9@._-]{1,200})$/.exec(ref)
  if (!match || match[1] !== wahaSession(env) || match[2]!.includes('..')) throw new Error('WAHA_MEDIA_REF_INVALID')
  const response = await fetch(`${gatewayBase(env)}/api/files/${match[1]}/${encodeURIComponent(match[2]!).replace(/%40/g, '@')}`, { headers: headers(env, false), signal: AbortSignal.timeout(30_000) })
  if (response.status === 404) throw new Error('WAHA_MEDIA_EXPIRED')
  if (!response.ok || !response.body) throw new Error('WAHA_MEDIA_DOWNLOAD_FAILED')
  if (Number(response.headers.get('content-length') || 0) > maxBytes) throw new Error('WAHA_MEDIA_TOO_LARGE')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const result = await reader.read()
    if (result.done) break
    total += result.value.byteLength
    if (total > maxBytes) { await reader.cancel(); throw new Error('WAHA_MEDIA_TOO_LARGE') }
    chunks.push(result.value)
  }
  if (!total) throw new Error('WAHA_MEDIA_EMPTY')
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return { bytes, mimeType: String(response.headers.get('content-type') || '').split(';')[0]!.trim().toLowerCase() }
}

/** Estado de la sesión del asistente según WAHA (para el reporte del superadministrador). */
export async function wahaSessionStatus(env: Partial<Bindings>): Promise<{ status: string; phoneEnding: string | null } | null> {
  if (!wahaConfigured(env)) return null
  const response = await fetch(`${gatewayBase(env)}/api/sessions/${wahaSession(env)}`, { headers: headers(env, false), signal: AbortSignal.timeout(8_000) }).catch(() => null)
  if (!response?.ok) return { status: response ? `HTTP_${response.status}` : 'UNREACHABLE', phoneEnding: null }
  const body = await response.json().catch(() => ({})) as { status?: string; me?: { id?: string } }
  const me = phoneOf(body.me?.id)
  return { status: String(body.status || 'UNKNOWN').slice(0, 40), phoneEnding: me ? me.slice(-4) : null }
}
