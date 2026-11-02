import { describe, it, expect } from 'vitest'
import { buildWhatsAppOrderMessage } from './whatsapp'
import type { CartItem } from '../contexts/CartContext'

const items: CartItem[] = [
  { productId: '1', variantId: '5', sku: 'RBK-2514-42', name: 'Reebok Classic Leather', price: 189900, image: null, size: '42', quantity: 2 },
  { productId: '2', sku: 'ACC-MED-3PK', name: 'Medias Deportivas x3', price: 29900, image: null, quantity: 1 },
]

describe('buildWhatsAppOrderMessage', () => {
  it('incluye encabezado, productos, SKU, variante y cantidades', () => {
    const msg = buildWhatsAppOrderMessage({ items, currency: 'COP' })
    expect(msg).toContain('*Solicitud de pedido')
    expect(msg).toContain('Reebok Classic Leather')
    expect(msg).toContain('RBK-2514-42')
    expect(msg).toContain('(42)')
    expect(msg).toContain('Cantidad: 2')
    expect(msg).toContain('Medias Deportivas x3')
  })

  it('calcula el subtotal de la orden y respeta la moneda', () => {
    const msg = buildWhatsAppOrderMessage({ items, currency: 'COP' })
    expect(msg).toContain('409.700')
    expect(msg).toContain('COP')
    expect(msg).toContain('*Subtotal:*')
    expect(msg).toContain('*Envío:* Por cotizar')
  })

  it('agrega datos del cliente y de entrega si existen', () => {
    const msg = buildWhatsAppOrderMessage({ items, currency: 'COP', customerName: 'Ana', customerPhone: '3001112233', deliveryInfo: 'Envío a Bogotá' })
    expect(msg).toContain('*Cliente:* Ana')
    expect(msg).toContain('*Teléfono:* 3001112233')
    expect(msg).toContain('*Entrega:* Envío a Bogotá')
  })

  it('omite los datos del cliente cuando no se envían', () => {
    const msg = buildWhatsAppOrderMessage({ items, currency: 'COP' })
    expect(msg).not.toContain('*Cliente:*')
    expect(msg).not.toContain('*Entrega:*')
  })

  it('includes dynamic store/order identity and every product photo as a public link', () => {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin: 'https://preview.example' } } })
    const illustrated: CartItem[] = [1, 2, 3].map((n) => ({
      productId: String(n), variantId: String(n * 10), sku: `SH-${n}`, name: `Tenis ${n}`, price: 100000 * n,
      image: `/api/assets/SH-${n}.jpg`, size: String(40 + n), color: n === 1 ? 'Negro' : 'Blanco', quantity: 1,
    }))
    const message = buildWhatsAppOrderMessage({ items: illustrated, currency: 'COP', storeName: 'Tienda Prueba', orderDisplayId: 'PED-20261102-ABCD', date: '02/11/2026' })
    expect(message).toContain('Tienda Prueba')
    expect(message).toContain('PED-20261102-ABCD')
    expect(message.match(/Foto: https:\/\/preview\.example\/api\/assets\/SH-[123]\.jpg/g)).toHaveLength(3)
    expect(message).toContain('no se ha enviado hasta que pulses Enviar')
  })

  it('does not invent a photo for products without one', () => {
    const item: CartItem = { productId: '1', sku: 'SH-1', name: 'Sin foto', price: 1, image: null, quantity: 1 }
    const message = buildWhatsAppOrderMessage({ items: [item], currency: 'COP', storeName: 'Tienda' })
    expect(message).not.toContain('Foto:')
  })
})
