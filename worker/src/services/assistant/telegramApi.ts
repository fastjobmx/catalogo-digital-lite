const TELEGRAM_API_BASE = 'https://api.telegram.org'

export interface TelegramUser {
  id: number
  first_name: string
  last_name?: string
  username?: string
}

export interface TelegramMessage {
  message_id: number
  from?: TelegramUser
  chat: { id: number; type: 'private' | 'group' | 'supergroup' | 'channel'; title?: string }
  date: number
  text?: string
  caption?: string
  media_group_id?: string
  voice?: { file_id: string; duration: number; mime_type?: string; file_size?: number }
  audio?: { file_id: string; duration: number; mime_type?: string; file_size?: number; file_name?: string }
  photo?: Array<{ file_id: string; file_unique_id?: string; width?: number; height?: number; file_size?: number }>
  document?: { file_id: string; file_unique_id?: string; file_name?: string; mime_type?: string; file_size?: number }
}

export interface TelegramCallbackQuery {
  id: string
  from: TelegramUser
  message?: TelegramMessage
  data?: string
}

export interface TelegramUpdate {
  update_id: number
  message?: TelegramMessage
  callback_query?: TelegramCallbackQuery
}

export interface TelegramSendMessageResponse {
  ok: boolean
  result: { message_id: number }
}

export type InlineKeyboard = { inline_keyboard: Array<Array<{ text: string; callback_data?: string; url?: string }>> }

export async function sendTelegramMessage(
  botToken: string,
  chatId: number | string,
  text: string,
  parseMode: 'HTML' | 'Markdown' = 'HTML',
  replyMarkup?: Record<string, unknown>,
): Promise<TelegramSendMessageResponse> {
  const response = await fetch(`${TELEGRAM_API_BASE}/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: text.slice(0, 4000),
      parse_mode: parseMode,
      disable_web_page_preview: true,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    }),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({ description: 'Unknown error' }))
    throw new Error(`Telegram API error: ${(error as { description?: string }).description || response.status}`)
  }
  return response.json() as Promise<TelegramSendMessageResponse>
}

export async function sendTelegramPhoto(botToken: string, chatId: number | string, photo: string, caption: string, replyMarkup?: Record<string, unknown>): Promise<void> {
  const response = await fetch(`${TELEGRAM_API_BASE}/bot${botToken}/sendPhoto`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, photo, caption: caption.slice(0, 1024), parse_mode: 'HTML', ...(replyMarkup ? { reply_markup: replyMarkup } : {}) }),
  })
  if (!response.ok) throw new Error('Telegram photo preview failed')
}

export async function answerCallback(botToken: string, callbackId: string, text?: string): Promise<void> {
  const response = await fetch(`${TELEGRAM_API_BASE}/bot${botToken}/answerCallbackQuery`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackId, ...(text ? { text: text.slice(0, 180) } : {}) }),
  })
  if (!response.ok) throw new Error('Telegram callback acknowledgement failed')
}

/** Shows "typing…" while a slower step (AI, uploads) runs. Failures are ignored. */
export async function sendChatAction(botToken: string, chatId: number | string, action: 'typing' | 'upload_photo' = 'typing'): Promise<void> {
  try {
    await fetch(`${TELEGRAM_API_BASE}/bot${botToken}/sendChatAction`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, action }),
    })
  } catch { /* cosmetic only */ }
}

function isSafeTelegramPath(path: string): boolean {
  return path.length <= 512 && !path.startsWith('/') && !path.split('/').some((part) => !part || part === '.' || part === '..') && /^[a-zA-Z0-9._/-]+$/.test(path)
}

/** Downloads a Telegram file with a strict size bound. */
export async function downloadTelegramFile(botToken: string, fileId: string, maxBytes: number, allowedPath?: RegExp): Promise<{ bytes: Uint8Array; path: string }> {
  const fileResponse = await fetch(`${TELEGRAM_API_BASE}/bot${botToken}/getFile?file_id=${encodeURIComponent(fileId)}`, { signal: AbortSignal.timeout(10000) })
  if (!fileResponse.ok) throw new Error('TELEGRAM_GET_FILE_FAILED')
  const fileInfo = await fileResponse.json() as { ok?: boolean; result?: { file_path?: string; file_size?: number } }
  const path = fileInfo.result?.file_path
  if (!fileInfo.ok || !path || !isSafeTelegramPath(path) || (allowedPath && !allowedPath.test(path))) throw new Error('TELEGRAM_FILE_METADATA_INVALID')
  if (fileInfo.result?.file_size && fileInfo.result.file_size > maxBytes) throw new Error('TELEGRAM_FILE_TOO_LARGE')
  const response = await fetch(`${TELEGRAM_API_BASE}/file/bot${botToken}/${path.split('/').map(encodeURIComponent).join('/')}`, { signal: AbortSignal.timeout(15000) })
  if (!response.ok || !response.body) throw new Error('TELEGRAM_FILE_DOWNLOAD_FAILED')
  if (Number(response.headers.get('content-length') || 0) > maxBytes) throw new Error('TELEGRAM_FILE_TOO_LARGE')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const result = await reader.read()
    if (result.done) break
    total += result.value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new Error('TELEGRAM_FILE_TOO_LARGE')
    }
    chunks.push(result.value)
  }
  if (!total) throw new Error('TELEGRAM_FILE_EMPTY')
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return { bytes, path }
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + 0x8000, bytes.length)))
  return btoa(binary)
}

export async function downloadTelegramVoice(botToken: string, fileId: string): Promise<{ mimeType: 'audio/ogg'; data: string }> {
  let bytes: Uint8Array
  try {
    bytes = (await downloadTelegramFile(botToken, fileId, 10 * 1024 * 1024, /\.(?:oga|ogg)$/i)).bytes
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    if (code === 'TELEGRAM_FILE_METADATA_INVALID') throw new Error('Invalid Telegram file metadata')
    if (code === 'TELEGRAM_FILE_TOO_LARGE') throw new Error('Voice file too large')
    throw error
  }
  if (bytes[0] !== 0x4f || bytes[1] !== 0x67 || bytes[2] !== 0x67 || bytes[3] !== 0x53) throw new Error('Telegram voice is not an OGG stream')
  return { mimeType: 'audio/ogg', data: bytesToBase64(bytes) }
}
