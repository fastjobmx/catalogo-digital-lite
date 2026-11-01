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
  customerName?: string
  customerPhone?: string
  deliveryInfo?: string
}): string {
  const lines: string[] = ['*Nuevo pedido*', '']

  if (input.customerName) lines.push(`*Cliente:* ${input.customerName}`)
  if (input.customerPhone) lines.push(`*Teléfono:* ${input.customerPhone}`)
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
      '',
    )
  })

  lines.push(`*TOTAL: ${total.toLocaleString('es-CO')} ${input.currency}*`, '')
  if (input.deliveryInfo) {
    lines.push(`*Entrega:* ${input.deliveryInfo}`, '')
  }
  lines.push('_El pedido se envía cuando confirmes el mensaje en WhatsApp._')
  return lines.join('\n')
}
