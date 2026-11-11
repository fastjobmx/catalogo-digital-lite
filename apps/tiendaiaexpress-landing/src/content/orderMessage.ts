// Example of the WhatsApp order message the store sends to the merchant.
// The format mirrors the platform's real builder (frontend/src/lib/whatsapp.ts →
// buildWhatsAppOrderMessage) and the order number format (worker/src/routes/orders.ts →
// generateDisplayId: PED-YYYYMMDD-XXXXXXXX). Product, size, SKU, price and photo are the real
// SneakerHub data (public API, 2026-11-11); the customer is an example and the page says so.
// If the platform's message format changes, update this file too.
import { site } from '../config/site'

const product = {
  name: 'Kinetik Aero Carbon',
  size: '40',
  sku: 'KINETIK-06-40',
  price: 389_900,
  quantity: 1,
  photo: `${site.appUrl}/seed-images/sneakerhub/KINETIK-06.jpg`,
}

const money = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')
const lineTotal = product.price * product.quantity

/** Message lines exactly as WhatsApp receives them (WhatsApp formatting: *bold*, _italics_). */
export const orderMessageLines: string[] = [
  '*Solicitud de pedido · SneakerHub Premium*',
  '*Pedido:* PED-20261111-7F3A92C1',
  '*Fecha:* 11/11/2026, 10:32:15 a. m.',
  '',
  '*Cliente:* Ana Gómez',
  '*Teléfono:* +57 300 000 0000',
  '*Ciudad:* Medellín',
  '*Dirección:* Calle 10 # 40-20, apto 301',
  '',
  '*Productos:*',
  `1. *${product.name}* (${product.size})`,
  `   SKU: ${product.sku}`,
  `   Cantidad: ${product.quantity} × ${money(product.price)} = ${money(lineTotal)}`,
  `   Foto: ${product.photo}`,
  '',
  `*Subtotal:* ${money(lineTotal)} COP`,
  '*Envío:* Por cotizar',
  '*Medio de pago preferido:* Transferencia',
  '',
  '_Solicitud registrada. El envío se confirma con la tienda. Este mensaje no se ha enviado hasta que pulses Enviar en WhatsApp._',
]

export const orderCustomer = 'Ana Gómez'
export const orderTime = '10:32 a. m.'
