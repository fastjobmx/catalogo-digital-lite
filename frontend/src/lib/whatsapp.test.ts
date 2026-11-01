import { describe, it, expect } from 'vitest'
import { buildWhatsAppOrderMessage } from './whatsapp'
import type { CartItem } from '../contexts/CartContext'

const items: CartItem[] = [
  {
    productId: '1',
    variantId: '5',
    sku: 'RBK-2514-42',
    name: 'Reebok Classic Leather',
    price: 189900,
    image: null,
    size: '42',
    quantity: 2,
  },
  {
    productId: '2',
    sku: 'ACC-MED-3PK',
    name: 'Medias Deportivas x3',
    price: 29900,
    image: null,
    quantity: 1,
  },
]

describe('buildWhatsAppOrderMessage', () => {
  it('incluye encabezado, productos, SKU, variante y cantidades', () => {
    const msg = buildWhatsAppOrderMessage({ items, currency: 'COP' })
    expect(msg).toContain('*Nuevo pedido*')
    expect(msg).toContain('Reebok Classic Leather')
    expect(msg).toContain('RBK-2514-42')
    expect(msg).toContain('(42)')
    expect(msg).toContain('Cantidad: 2')
    expect(msg).toContain('Medias Deportivas x3')
  })

  it('calcula el total de la orden y respeta la moneda', () => {
    const msg = buildWhatsAppOrderMessage({ items, currency: 'COP' })
    // 189900 * 2 + 29900 = 409700
    expect(msg).toContain('409.700')
    expect(msg).toContain('COP')
    expect(msg).toContain('*TOTAL')
  })

  it('agrega datos del cliente y de entrega si existen', () => {
    const msg = buildWhatsAppOrderMessage({
      items,
      currency: 'COP',
      customerName: 'Ana',
      customerPhone: '3001112233',
      deliveryInfo: 'Envío a Bogotá',
    })
    expect(msg).toContain('*Cliente:* Ana')
    expect(msg).toContain('*Teléfono:* 3001112233')
    expect(msg).toContain('*Entrega:* Envío a Bogotá')
  })

  it('omite los datos del cliente cuando no se envían', () => {
    const msg = buildWhatsAppOrderMessage({ items, currency: 'COP' })
    expect(msg).not.toContain('*Cliente:*')
    expect(msg).not.toContain('*Entrega:*')
  })
})
