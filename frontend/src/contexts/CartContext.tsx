import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import { buildWhatsAppOrderMessage } from '../lib/whatsapp'

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
  clearCart: () => void
  syncItems: (items: CartItem[]) => void
  totalItems: number
  subtotal: number
  generateWhatsAppOrder: (customerName?: string, deliveryInfo?: string) => string
}

const CartContext = createContext<CartContextValue | undefined>(undefined)

const CART_STORAGE_KEY = 'catalogo-lite-cart'

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([])

  // Load cart from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(CART_STORAGE_KEY)
      if (stored) {
        setItems(JSON.parse(stored))
      }
    } catch {
      // Ignore parse errors, start with empty cart
    }
  }, [])

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
