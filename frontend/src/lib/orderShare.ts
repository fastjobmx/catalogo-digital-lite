// Sharing the real main photo of the ordered products from the buyer's phone (Web Share API).
//
// What this can and cannot do (kept honest in the UI):
//  - The browser opens the system share sheet; the buyer picks the app (WhatsApp) and the chat.
//    The store's chat cannot be preselected, and nothing is sent automatically.
//  - `navigator.share()` resolving only means the sheet handed the files to another app. It is not
//    proof that the message was sent, so the order is never marked as sent.
//  - Some apps drop the text when it travels with images, so the text is also copied to the
//    clipboard and the buyer can paste it.
//  - The photos are the products' real main photos, downloaded from the store as they are. WebP and
//    AVIF are re-encoded to JPEG (same pixels, no editing) because some apps treat WebP as stickers.
import { recordOrderWhatsAppEvent } from '../services/api'

export const MAX_SHARED_PHOTOS = 5

export type PhotoSource = { name: string; imageUrl: string | null | undefined }
export type BuyerWhatsAppAction = 'whatsapp_abierto' | 'foto_compartida' | 'foto_cancelada' | 'foto_no_disponible'

type ShareNavigator = Navigator & {
  canShare?: (data?: ShareData) => boolean
  share?: (data?: ShareData) => Promise<void>
}

/** True when this browser can share image files (feature detection, no prompt shown). */
export function canSharePhotos(nav: ShareNavigator | undefined = typeof navigator === 'undefined' ? undefined : navigator): boolean {
  if (!nav || typeof nav.share !== 'function' || typeof nav.canShare !== 'function' || typeof File === 'undefined') return false
  try {
    return nav.canShare({ files: [new File([new Uint8Array([0xff, 0xd8, 0xff])], 'prueba.jpg', { type: 'image/jpeg' })] })
  } catch {
    return false
  }
}

/** One photo per distinct product, in order, at most MAX_SHARED_PHOTOS (the text keeps every item). */
export function photoSources(items: PhotoSource[]): { name: string; url: string }[] {
  const seen = new Set<string>()
  const out: { name: string; url: string }[] = []
  for (const item of items) {
    const url = item.imageUrl?.trim()
    if (!url || seen.has(url)) continue
    seen.add(url)
    out.push({ name: item.name, url })
    if (out.length === MAX_SHARED_PHOTOS) break
  }
  return out
}

export function photoFileName(productName: string, index: number): string {
  const base = productName.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'producto'
  return `${index + 1}-${base}.jpg`
}

export async function toShareableBlob(blob: Blob): Promise<Blob> {
  if (blob.type === 'image/jpeg' || blob.type === 'image/png') return blob
  // WebP/AVIF → JPEG with the same pixels (no resizing, no editing).
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('canvas')
  context.fillStyle = '#ffffff' // transparent areas become white, as in a JPEG
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(bitmap, 0, 0)
  bitmap.close?.()
  return new Promise((resolve, reject) => canvas.toBlob((out) => (out ? resolve(out) : reject(new Error('jpeg'))), 'image/jpeg', 0.92))
}

/**
 * Downloads the photos BEFORE the buyer taps "share": Safari only allows `navigator.share()` inside
 * the tap itself, so the files must already be in memory. Photos that fail are skipped.
 */
export async function preparePhotoFiles(items: PhotoSource[], origin = window.location.origin): Promise<File[]> {
  const files: File[] = []
  for (const [index, source] of photoSources(items).entries()) {
    try {
      const url = new URL(source.url, origin)
      if (url.origin !== origin) continue // only the store's own files
      const response = await fetch(url.href, { credentials: 'omit' })
      if (!response.ok) continue
      const blob = await toShareableBlob(await response.blob())
      files.push(new File([blob], photoFileName(source.name, index), { type: blob.type || 'image/jpeg' }))
    } catch {
      /* this photo is left out; the text still lists the product */
    }
  }
  return files
}

export type ShareResult = 'shared' | 'cancelled' | 'unsupported' | 'failed'

/** Must be called directly from the tap handler (user activation). */
export async function sharePhotos(files: File[], text: string, title: string, nav: ShareNavigator = navigator): Promise<ShareResult> {
  const data: ShareData = { files, text, title }
  if (!files.length || typeof nav.share !== 'function' || !nav.canShare?.(data)) return 'unsupported'
  // Started before share() and not awaited, so the tap still counts as user activation for share().
  void nav.clipboard?.writeText(text).catch(() => undefined)
  try {
    await nav.share(data)
    return 'shared'
  } catch (error) {
    return error instanceof DOMException && error.name === 'AbortError' ? 'cancelled' : 'failed'
  }
}

/** Order history entry (an attempt, never a delivery). Failures are ignored: it must not block the buyer. */
export function recordBuyerAction(displayId: string, checkoutKey: string, action: BuyerWhatsAppAction, photos?: number): void {
  void recordOrderWhatsAppEvent({ displayId, checkoutKey, action, ...(photos ? { photos } : {}) }).catch(() => undefined)
}
