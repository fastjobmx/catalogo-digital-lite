/** Re-reads catalog prices and stock before an order is registered (cart drawer and checkout page). */
import type { CartItem } from '../contexts/CartContext'
import type { ProductApi } from '../services/api'

export const CART_CHANGED_MESSAGE = 'El precio o el stock cambió. Revisa el carrito actualizado y vuelve a intentarlo.'

/** Returns the cart refreshed with current catalog data and whether the buyer must review it
 * (a product disappeared, ran out, changed price or name, or has less stock than requested). */
export function revalidateItems(items: CartItem[], products: ProductApi[]): { items: CartItem[]; needsReview: boolean } {
  let needsReview = false
  const next: CartItem[] = items.map((item) => {
    const product = products.find((candidate) =>
      String(candidate.id) === item.productId
      || candidate.sku === item.productSku
      || item.sku === candidate.sku
      || item.sku.startsWith(`${candidate.sku}-`),
    )
    const variant = product?.variants.find((candidate) =>
      candidate.isActive !== false
      && (String(candidate.id) === item.variantId || candidate.sku === item.sku),
    )
    if (!product || !variant) {
      needsReview = true
      return { ...item, availableStock: 0 }
    }

    const availableStock = Math.max(0, variant.stock)
    const quantity = availableStock > 0 ? Math.min(item.quantity, availableStock) : item.quantity
    const price = variant.priceOverride ?? product.price
    if (quantity !== item.quantity || availableStock === 0 || price !== item.price || product.name !== item.name) needsReview = true
    return {
      ...item,
      productId: String(product.id),
      productSku: product.sku,
      variantId: String(variant.id),
      sku: variant.sku,
      name: product.name,
      price,
      compareAtPrice: product.compareAtPrice ?? undefined,
      image: product.imageUrls[0] ?? item.image,
      size: variant.size ?? undefined,
      color: variant.color ?? undefined,
      availableStock,
      quantity,
    }
  })
  return { items: next, needsReview }
}
