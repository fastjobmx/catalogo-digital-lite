/**
 * WhatsApp Business Platform (Cloud API oficial de Meta): firma de webhooks, envío de mensajes y
 * descarga de archivos. Nada aquí conoce tiendas ni productos; solo habla con Graph API.
 */
import type { Env } from '../index'

type Bindings = Env['Bindings']

export const DEFAULT_GRAPH_VERSION = 'v26.0'
/** Meta entrega cargas de hasta 3 MB. */
export const MAX_WEBHOOK_BYTES = 3 * 1024 * 1024
export const WHATSAPP_IMAGE_LIMIT = 5 * 1024 * 1024
export const WHATSAPP_AUDIO_LIMIT = 16 * 1024 * 1024
/** El token de acceso solo se envía a hosts de Meta. Ampliable con WHATSAPP_MEDIA_HOSTS (sufijos separados por coma). */
const DEFAULT_MEDIA_HOSTS = ['fbsbx.com', 'facebook.com', 'fbcdn.net', 'whatsapp.net', 'whatsapp.com']

export function whatsappEnabled(env: Partial<Bindings>): boolean {
  return String(env.WHATSAPP_ADMIN_BOT_ENABLED || '').toLowerCase() === 'true'
}

export function whatsappConfigured(env: Partial<Bindings>): boolean {
  return Boolean(env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID && env.WHATSAPP_APP_SECRET)
}

function graphBase(env: Partial<Bindings>): string {
  const version = /^v\d{1,3}\.\d{1,2}$/.test(env.WHATSAPP_GRAPH_VERSION || '') ? env.WHATSAPP_GRAPH_VERSION! : DEFAULT_GRAPH_VERSION
  return `https://graph.facebook.com/${version}`
}

export function constantTimeEqual(a: string, b: string): boolean {
  let difference = a.length ^ b.length
  const length = Math.max(a.length, b.length)
  for (let i = 0; i < length; i++) difference |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  return difference === 0
}

/** X-Hub-Signature-256: HMAC-SHA256 del cuerpo original (bytes tal como llegaron) con el App Secret. */
export async function verifyWebhookSignature(rawBody: ArrayBuffer, header: string | null | undefined, appSecret: string): Promise<boolean> {
  const match = /^sha256=([0-9a-f]{64})$/i.exec((header || '').trim())
  if (!match || !appSecret) return false
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, rawBody))
  const expected = [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return constantTimeEqual(expected, match[1]!.toLowerCase())
}

/** Destinatario: el teléfono cuando Meta lo entregó; si no, el identificador de usuario (BSUID). */
export type Recipient = { phone?: string | null; businessUserId?: string | null }

export class WhatsAppApiError extends Error {
  constructor(public code: string, public status: number) { super(`WHATSAPP_API_${code}`) }
}

export async function sendWhatsApp(env: Partial<Bindings>, to: Recipient, message: Record<string, unknown>): Promise<string> {
  if (!env.WHATSAPP_ACCESS_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) throw new WhatsAppApiError('NOT_CONFIGURED', 0)
  const target = to.phone ? { to: to.phone } : to.businessUserId ? { recipient: to.businessUserId } : null
  if (!target) throw new WhatsAppApiError('NO_RECIPIENT', 0)
  const response = await fetch(`${graphBase(env)}/${encodeURIComponent(env.WHATSAPP_PHONE_NUMBER_ID)}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}` },
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', ...target, ...message }),
    signal: AbortSignal.timeout(15_000),
  })
  const body = await response.json().catch(() => ({})) as { messages?: Array<{ id?: string }>; error?: { code?: number } }
  // Never surface the response text: only Meta's numeric code goes to logs and the message record.
  if (!response.ok) throw new WhatsAppApiError(String(body.error?.code ?? response.status), response.status)
  const id = body.messages?.[0]?.id
  if (!id) throw new WhatsAppApiError('NO_MESSAGE_ID', response.status)
  return id
}

/** Marca el mensaje como leído y muestra "escribiendo…" (cosmético). */
export async function markReadAndTyping(env: Partial<Bindings>, messageId: string): Promise<void> {
  if (!env.WHATSAPP_ACCESS_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) return
  await fetch(`${graphBase(env)}/${encodeURIComponent(env.WHATSAPP_PHONE_NUMBER_ID)}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}` },
    body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: messageId, typing_indicator: { type: 'text' } }),
    signal: AbortSignal.timeout(5_000),
  })
}

function allowedMediaHost(env: Partial<Bindings>, url: string): boolean {
  let parsed: URL
  try { parsed = new URL(url) } catch { return false }
  if (parsed.protocol !== 'https:') return false
  const extra = String(env.WHATSAPP_MEDIA_HOSTS || '').split(',').map((host) => host.trim().toLowerCase()).filter(Boolean)
  return [...DEFAULT_MEDIA_HOSTS, ...extra].some((suffix) => parsed.hostname === suffix || parsed.hostname.endsWith(`.${suffix}`))
}

/** Descarga un archivo recibido: metadatos por la API oficial y luego el binario, con límite estricto de tamaño. */
export async function downloadWhatsAppMedia(env: Partial<Bindings>, mediaId: string, maxBytes: number): Promise<{ bytes: Uint8Array; mimeType: string }> {
  if (!env.WHATSAPP_ACCESS_TOKEN) throw new Error('WHATSAPP_NOT_CONFIGURED')
  if (!/^[A-Za-z0-9_.-]{1,128}$/.test(mediaId)) throw new Error('WHATSAPP_MEDIA_ID_INVALID')
  const headers = { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`, 'User-Agent': 'TiendIA-Expres/1.0' }
  const metaResponse = await fetch(`${graphBase(env)}/${mediaId}`, { headers, signal: AbortSignal.timeout(10_000) })
  if (!metaResponse.ok) throw new Error('WHATSAPP_MEDIA_METADATA_FAILED')
  const meta = await metaResponse.json() as { url?: string; mime_type?: string; file_size?: number }
  if (!meta.url || !allowedMediaHost(env, meta.url)) throw new Error('WHATSAPP_MEDIA_URL_INVALID')
  if (meta.file_size && Number(meta.file_size) > maxBytes) throw new Error('WHATSAPP_MEDIA_TOO_LARGE')
  const response = await fetch(meta.url, { headers, signal: AbortSignal.timeout(30_000) })
  if (!response.ok || !response.body) throw new Error('WHATSAPP_MEDIA_DOWNLOAD_FAILED')
  if (Number(response.headers.get('content-length') || 0) > maxBytes) throw new Error('WHATSAPP_MEDIA_TOO_LARGE')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const result = await reader.read()
    if (result.done) break
    total += result.value.byteLength
    if (total > maxBytes) { await reader.cancel(); throw new Error('WHATSAPP_MEDIA_TOO_LARGE') }
    chunks.push(result.value)
  }
  if (!total) throw new Error('WHATSAPP_MEDIA_EMPTY')
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return { bytes, mimeType: String(meta.mime_type || '').split(';')[0]!.trim().toLowerCase() }
}

/** Duración de un audio OGG/Opus leída de su última página (Meta no la informa en el webhook). */
export function oggOpusSeconds(bytes: Uint8Array): number | undefined {
  for (let i = bytes.length - 27; i >= 0; i--) {
    if (bytes[i] !== 0x4f || bytes[i + 1] !== 0x67 || bytes[i + 2] !== 0x67 || bytes[i + 3] !== 0x53) continue
    let granule = 0
    for (let b = 7; b >= 0; b--) granule = granule * 256 + bytes[i + 6 + b]!
    // 0xFFFFFFFFFFFFFFFF means "no packet ends on this page".
    if (!Number.isFinite(granule) || granule <= 0 || granule > 48_000 * 86_400) return undefined
    return granule / 48_000
  }
  return undefined
}
