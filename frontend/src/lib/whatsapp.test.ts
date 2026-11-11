import { describe, it, expect, vi } from 'vitest'
import { buildWhatsAppOrderMessage, productPageUrl } from './whatsapp'
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

  it('uses the short product page link (link preview with the real photo) instead of the long photo URL', () => {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin: 'https://app.example' } } })
    const linked = [1, 2].map((n) => ({
      productId: String(n), sku: `SH-${n}-42`, name: `Tenis ${n}`, price: 1000, image: `/api/assets/SH-${n}.jpg`, quantity: 1,
      productUrl: productPageUrl(`SH-${n}`, 'mi-tienda', 'https://app.example'),
    }))
    const message = buildWhatsAppOrderMessage({ items: linked, currency: 'COP', storeName: 'Mi tienda', orderDisplayId: 'PED-20261111-ABCDEF12' })
    expect(message).toContain('Ver producto: https://app.example/t/mi-tienda/producto/SH-1')
    expect(message).toContain('Ver producto: https://app.example/t/mi-tienda/producto/SH-2')
    expect(message).not.toContain('/api/assets/')
    expect(message).toContain('*Tenis 1*')
    expect(message).toContain('*Tenis 2*')
  })

  it('builds product links for the main store and for /t/<slug> stores', () => {
    expect(productPageUrl('KINETIK-06', null, 'https://app.example')).toBe('https://app.example/producto/KINETIK-06')
    expect(productPageUrl('LM 139/A', 'luz-magica', 'https://app.example')).toBe('https://app.example/t/luz-magica/producto/LM%20139%2FA')
    expect(productPageUrl(undefined, 'luz-magica', 'https://app.example')).toBeNull()
  })

  it('does not invent a photo for products without one', () => {
    const item: CartItem = { productId: '1', sku: 'SH-1', name: 'Sin foto', price: 1, image: null, quantity: 1 }
    const message = buildWhatsAppOrderMessage({ items: [item], currency: 'COP', storeName: 'Tienda' })
    expect(message).not.toContain('Foto:')
  })
})

describe('WhatsApp navigation strategy', () => {
  it('uses the same tab on phones and in-app browsers, a new tab on desktop', async () => {
    const { shouldOpenWhatsAppInSameTab } = await import('./whatsapp')
    expect(shouldOpenWhatsAppInSameTab('Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 Chrome/141 Mobile Safari/537.36', false)).toBe(true)
    expect(shouldOpenWhatsAppInSameTab('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Instagram 350.0', false)).toBe(true)
    expect(shouldOpenWhatsAppInSameTab('Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 [FBAN/EMA;FBAV/400.0]', false)).toBe(true)
    expect(shouldOpenWhatsAppInSameTab('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/145 Safari/537.36', false)).toBe(false)
    expect(shouldOpenWhatsAppInSameTab('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15', true)).toBe(true)
  })

  it('redirects the prepared tab, or this tab when there is none or it was closed', async () => {
    const { goToWhatsApp } = await import('./whatsapp')
    const here = { location: { href: 'https://tienda.test/t/luz' } }
    vi.stubGlobal('window', here)
    const url = 'https://wa.me/573242117323?text=hola'
    const tab = { closed: false, opener: {} as unknown, location: { href: 'about:blank' } } as unknown as Window
    expect(goToWhatsApp(url, tab)).toBe('tab')
    expect(tab.location.href).toBe(url)
    expect(tab.opener).toBeNull()
    expect(here.location.href).toBe('https://tienda.test/t/luz')
    expect(goToWhatsApp(url, null)).toBe('same')
    expect(here.location.href).toBe(url)
    here.location.href = 'https://tienda.test/t/luz'
    expect(goToWhatsApp(url, { closed: true } as unknown as Window)).toBe('same')
    expect(here.location.href).toBe(url)
    vi.unstubAllGlobals()
  })
})
