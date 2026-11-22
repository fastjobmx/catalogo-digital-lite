import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import { buildWhatsAppOrderMessage } from '../lib/whatsapp'
import { storeStorageKey } from '../lib/installation'

export interface CartItem {
  productId: string
  productSku?: string
  variantId?: string
  sku: string
  name: string
  price: number
  compareAtPrice?: number
  image: string | null
  size?: string
  color?: string
  availableStock?: number
  quantity: number
}

interface CartContextValue {
  items: CartItem[]
  addItem: (item: Omit<CartItem, 'quantity'>, quantity?: number) => void
  removeItem: (productId: string, variantId?: string) => void
  updateQuantity: (productId: string, variantId: string | undefined, quantity: number) => void
  /** Swaps an item to another variant of the same product (size/color), keeping its place in the cart. */
  changeVariant: (productId: string, fromVariantId: string | undefined, next: Omit<CartItem, 'quantity'>) => void
  clearCart: () => void
  syncItems: (items: CartItem[]) => void
  totalItems: number
  subtotal: number
  generateWhatsAppOrder: (customerName?: string, deliveryInfo?: string) => string
}

const CartContext = createContext<CartContextValue | undefined>(undefined)

const CART_STORAGE_KEY = storeStorageKey('catalogo-lite-cart')

export function loadCartFromStorage(storage?: Pick<Storage, 'getItem'>): CartItem[] {
  try {
    const stored = storage ? storage.getItem(CART_STORAGE_KEY) : localStorage.getItem(CART_STORAGE_KEY)
    if (!stored) return []
    const parsed: unknown = JSON.parse(stored)
    return Array.isArray(parsed) ? parsed as CartItem[] : []
  } catch {
    return []
  }
}

/** Moves a cart line to another variant of the same product, in place. If that variant was already in the cart the
 * two lines become one; the quantity never exceeds the new variant's stock, and a sold-out variant is refused. */
export function swapCartVariant(prev: CartItem[], productId: string, fromVariantId: string | undefined, next: Omit<CartItem, 'quantity'>): CartItem[] {
  const index = prev.findIndex(i => i.productId === productId && i.variantId === fromVariantId)
  const current = prev[index]
  if (!current || next.variantId === fromVariantId) return prev
  const limit = next.availableStock ?? Number.POSITIVE_INFINITY
  if (limit < 1) return prev
  const duplicate = prev.findIndex(i => i.productId === next.productId && i.variantId === next.variantId)
  if (duplicate >= 0) {
    const merged = { ...prev[duplicate]!, ...next, quantity: Math.min(limit, prev[duplicate]!.quantity + current.quantity) }
    return prev.flatMap((item, i) => (i === index ? [merged] : i === duplicate ? [] : [item]))
  }
  return prev.map((item, i) => (i === index ? { ...next, quantity: Math.min(limit, current.quantity) } : item))
}

export function CartProvider({ children }: { children: ReactNode }) {
  // Hydrate before the persistence effect runs, so an initial [] cannot erase a saved cart.
  const [items, setItems] = useState<CartItem[]>(loadCartFromStorage)

  // Persist cart to localStorage on changes
  useEffect(() => {
    try {
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items))
    } catch {
      // Ignore storage errors
    }
  }, [items])

  const addItem = (item: Omit<CartItem, 'quantity'>, quantity = 1) => {
    setItems(prev => {
      const existingIndex = prev.findIndex(
        i => i.productId === item.productId && i.variantId === item.variantId
      )
      const limit = item.availableStock
      if (limit !== undefined && limit < 1) return prev

      if (existingIndex >= 0) {
        const updated = [...prev]
        const existing = updated[existingIndex]
        if (existing) {
          updated[existingIndex] = {
            ...existing,
            ...item,
            quantity: Math.min(limit ?? Number.POSITIVE_INFINITY, existing.quantity + quantity),
          }
        }
        return updated
      }

      return [...prev, { ...item, quantity: Math.min(limit ?? Number.POSITIVE_INFINITY, quantity) }]
    })
  }

  const removeItem = (productId: string, variantId?: string) => {
    setItems(prev =>
      prev.filter(i => !(i.productId === productId && i.variantId === variantId))
    )
  }

  const updateQuantity = (productId: string, variantId: string | undefined, quantity: number) => {
    if (quantity <= 0) {
      removeItem(productId, variantId)
      return
    }

    setItems(prev => prev.flatMap(i => {
      if (i.productId !== productId || i.variantId !== variantId) return [i]
      if (i.availableStock !== undefined && i.availableStock < 1) return []
      return [{ ...i, quantity: Math.min(i.availableStock ?? Number.POSITIVE_INFINITY, quantity) }]
    }))
  }

  const changeVariant = (productId: string, fromVariantId: string | undefined, next: Omit<CartItem, 'quantity'>) => {
    setItems(prev => swapCartVariant(prev, productId, fromVariantId, next))
  }

  const clearCart = () => setItems([])
  const syncItems = (nextItems: CartItem[]) => setItems(nextItems)

  const totalItems = items.reduce((sum, item) => sum + item.quantity, 0)

  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0)

  const generateWhatsAppOrder = (customerName?: string, deliveryInfo?: string): string => {
    return encodeURIComponent(
      buildWhatsAppOrderMessage({
        items,
        currency: 'COP',
        customerName,
        deliveryInfo,
      }),
    )
  }

  return (
    <CartContext.Provider
      value={{
        items,
        addItem,
        removeItem,
        updateQuantity,
        changeVariant,
        clearCart,
        syncItems,
        totalItems,
        subtotal,
        generateWhatsAppOrder,
      }}
    >
      {children}
    </CartContext.Provider>
  )
}

export function useCart() {
  const context = useContext(CartContext)
  if (!context) throw new Error('useCart must be used within CartProvider')
  return context
}
