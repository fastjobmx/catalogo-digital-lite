/**
 * Formato interno común de un mensaje entrante de WhatsApp, sea cual sea el proveedor
 * (Meta Cloud API o WAHA). El procesador y el motor del asistente solo conocen esta forma.
 */
import type { Sender } from './identity'

export type WhatsAppProvider = 'meta' | 'waha'
export type InboundKind = 'text' | 'interactive' | 'image' | 'audio' | 'document' | 'other'

export type InboundMedia = {
  /** Referencia del proveedor para descargar el archivo (id de Meta o ruta de archivo de WAHA). */
  ref: string
  mimeType: string
  filename?: string
  voice?: boolean
  /** Huella del archivo que informa el proveedor (WAHA: fileSHA256), útil para duplicados sin descargar. */
  sha256?: string
  size?: number
  width?: number
  height?: number
}

export type NormalizedInbound = {
  provider: WhatsAppProvider
  /** Conexión que recibió el mensaje: phone_number_id (Meta) o nombre de sesión (WAHA). */
  channelId: string
  sessionId: string
  messageId: string
  sender: Sender
  kind: InboundKind
  /** Cuerpo de texto (solo mensajes de texto). */
  text: string
  /** Pie de foto o de documento. */
  caption?: string
  /** Identificador del botón o fila elegida. */
  tapped?: string
  media?: InboundMedia
  forwarded?: boolean
  /** Álbum al que pertenece la foto (WAHA: messageAssociation.parentMessageKey.ID). */
  albumId?: string
  /** Segundos Unix según el proveedor. */
  receivedAt: number
  trace: { eventId?: string; requestId?: string }
}

/** Mensaje de Meta tal como lo guardaba la versión anterior (filas en proceso durante un despliegue). */
export type MetaInboundMessage = {
  id?: string; type?: string; timestamp?: string; from?: string; from_user_id?: string
  text?: { body?: string }
  interactive?: { button_reply?: { id?: string }; list_reply?: { id?: string } }
  button?: { payload?: string }
  image?: { id?: string; caption?: string; mime_type?: string }
  audio?: { id?: string; mime_type?: string; voice?: boolean }
  document?: { id?: string; filename?: string; mime_type?: string; caption?: string }
}

export function fromMetaMessage(message: MetaInboundMessage, sender: Sender, channelId: string): NormalizedInbound {
  const base = {
    provider: 'meta' as const, channelId, sessionId: channelId, messageId: String(message.id || ''), sender,
    receivedAt: Number(message.timestamp || 0), trace: {}, text: '',
  }
  const tapped = message.interactive?.button_reply?.id || message.interactive?.list_reply?.id || message.button?.payload
  if (typeof tapped === 'string' && tapped) return { ...base, kind: 'interactive', tapped }
  if (message.type === 'text') return { ...base, kind: 'text', text: String(message.text?.body || '').trim().slice(0, 4000) }
  if (message.type === 'image' && message.image?.id) {
    return { ...base, kind: 'image', ...(message.image.caption ? { caption: message.image.caption.slice(0, 1000) } : {}), media: { ref: message.image.id, mimeType: String(message.image.mime_type || '') } }
  }
  if (message.type === 'audio' && message.audio?.id) {
    const mime = String(message.audio.mime_type || '')
    return { ...base, kind: 'audio', media: { ref: message.audio.id, mimeType: mime, voice: /ogg|opus/i.test(mime) } }
  }
  if (message.type === 'document' && message.document?.id) {
    return {
      ...base, kind: 'document', ...(message.document.caption ? { caption: message.document.caption.slice(0, 1000) } : {}),
      media: { ref: message.document.id, mimeType: String(message.document.mime_type || '').split(';')[0]!, filename: String(message.document.filename || 'archivo').slice(0, 200) },
    }
  }
  return { ...base, kind: 'other' }
}

/** Lee lo guardado en whatsapp_messages.payload_json: formato nuevo ({ v: 2, inbound }) o el anterior de Meta. */
export function readStoredInbound(json: string | null, fallbackChannel: string): NormalizedInbound | null {
  const parsed = JSON.parse(json || '{}') as { v?: number; inbound?: NormalizedInbound; message?: MetaInboundMessage; sender?: Sender }
  if (parsed.v === 2 && parsed.inbound) return parsed.inbound
  if (parsed.message && parsed.sender) return fromMetaMessage(parsed.message, parsed.sender, fallbackChannel)
  return null
}
