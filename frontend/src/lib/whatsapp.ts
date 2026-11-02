import type { CartItem } from '../contexts/CartContext'

/**
 * Construye el enlace de WhatsApp con un teléfono normalizado.
 * Devuelve null si no hay un número utilizable: nunca inventamos contactos.
 */
export function whatsappLink(phone: string | null | undefined, message?: string): string | null {
  const digits = (phone || '').replace(/[^0-9]/g, '')
  if (digits.length < 7) return null
  const query = message ? `?text=${encodeURIComponent(message)}` : ''
  return `https://wa.me/${digits}${query}`
}

export function buildWhatsAppOrderMessage(input: {
  items: CartItem[]
  currency: string
  storeName?: string
  orderDisplayId?: string
  date?: string
  customerName?: string
  customerPhone?: string
  customerEmail?: string
  customerCity?: string
  deliveryAddress?: string
  deliveryInfo?: string
  paymentMethod?: string
  customerNotes?: string
}): string {
  const lines: string[] = [`*Solicitud de pedido · ${input.storeName || 'Tienda'}*`]
  if (input.orderDisplayId) lines.push(`*Pedido:* ${input.orderDisplayId}`)
  if (input.date) lines.push(`*Fecha:* ${input.date}`)
  lines.push('')

  if (input.customerName) lines.push(`*Cliente:* ${input.customerName}`)
  if (input.customerPhone) lines.push(`*Teléfono:* ${input.customerPhone}`)
  if (input.customerEmail) lines.push(`*Correo:* ${input.customerEmail}`)
  if (input.customerCity) lines.push(`*Ciudad:* ${input.customerCity}`)
  if (input.deliveryAddress) lines.push(`*Dirección:* ${input.deliveryAddress}`)
  if (input.customerName || input.customerPhone) lines.push('')

  lines.push('*Productos:*')
  let total = 0

  input.items.forEach((item, index) => {
    const variantInfo = [item.size, item.color].filter(Boolean).join(' / ')
    const variantText = variantInfo ? ` (${variantInfo})` : ''
    const lineTotal = item.price * item.quantity
    total += lineTotal
    lines.push(
      `${index + 1}. *${item.name}*${variantText}`,
      `   SKU: ${item.sku}`,
      `   Cantidad: ${item.quantity} × ${item.price.toLocaleString('es-CO')} = ${lineTotal.toLocaleString('es-CO')}`,
    )
    if (item.image) {
      const imageUrl = /^https:\/\//i.test(item.image) ? item.image : new URL(item.image, window.location.origin).href
      lines.push(`   Foto: ${imageUrl}`)
    }
    lines.push('')
  })

  lines.push(`*Subtotal:* ${total.toLocaleString('es-CO')} ${input.currency}`, '*Envío:* Por cotizar')
  if (input.paymentMethod) lines.push(`*Medio de pago preferido:* ${input.paymentMethod}`)
  if (input.customerNotes) lines.push(`*Observaciones:* ${input.customerNotes}`)
  if (input.deliveryInfo && !input.deliveryAddress) lines.push(`*Entrega:* ${input.deliveryInfo}`)
  lines.push('', '_Solicitud registrada. El envío se confirma con la tienda. Este mensaje no se ha enviado hasta que pulses Enviar en WhatsApp._')
  return lines.join('\n')
}

export async function getCheckoutIdempotencyKey(fingerprint: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fingerprint))
  const shortHash = [...new Uint8Array(hash)].slice(0, 12).map((byte) => byte.toString(16).padStart(2, '0')).join('')
  const keyName = `sneakerhub-order-key:${shortHash}`
  const existing = sessionStorage.getItem(keyName)
  if (existing) return existing
  const key = crypto.randomUUID()
  sessionStorage.setItem(keyName, key)
  return key
}
