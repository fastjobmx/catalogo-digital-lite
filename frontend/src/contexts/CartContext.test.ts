import { describe, expect, it } from 'vitest'
import { loadCartFromStorage, swapCartVariant, type CartItem } from './CartContext'

const storedItem: CartItem = {
  productId: '7',
  sku: 'TEST-001',
  name: 'Artículo de prueba',
  price: 12500,
  image: null,
  quantity: 2,
}

describe('cart persistence hydration', () => {
  it('hydrates a saved cart synchronously before provider persistence effects', () => {
    const storage = { getItem: () => JSON.stringify([storedItem]) }
    expect(loadCartFromStorage(storage)).toEqual([storedItem])
  })

  it('starts empty for missing, malformed or non-array storage', () => {
    expect(loadCartFromStorage({ getItem: () => null })).toEqual([])
    expect(loadCartFromStorage({ getItem: () => '{broken' })).toEqual([])
    expect(loadCartFromStorage({ getItem: () => JSON.stringify({ sku: 'TEST-001' }) })).toEqual([])
  })
})

describe('changing the size of a cart line', () => {
  const line = (variantId: string, size: string, quantity: number, availableStock = 5): CartItem => ({ productId: '7', variantId, sku: `T-${size}`, name: 'Tenis', price: 100, image: null, size, quantity, availableStock })
  const next = (variantId: string, size: string, availableStock: number) => { const { quantity: _q, ...rest } = line(variantId, size, 1, availableStock); return rest }
  const other: CartItem = { productId: '9', variantId: '90', sku: 'G', name: 'Gorra', price: 50, image: null, quantity: 1 }

  it('keeps the line in place with its quantity', () => {
    const result = swapCartVariant([line('1', '38', 2), other], '7', '1', next('2', '40', 5))
    expect(result.map((item) => [item.variantId, item.size, item.quantity])).toEqual([['2', '40', 2], ['90', undefined, 1]])
  })

  it('caps the quantity at the new size stock and refuses a sold-out size', () => {
    expect(swapCartVariant([line('1', '38', 4)], '7', '1', next('2', '40', 2))[0]!.quantity).toBe(2)
    const cart = [line('1', '38', 1)]
    expect(swapCartVariant(cart, '7', '1', next('2', '40', 0))).toBe(cart)
  })

  it('merges with the same size already in the cart', () => {
    const result = swapCartVariant([line('1', '38', 2), line('2', '40', 1)], '7', '1', next('2', '40', 5))
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ variantId: '2', quantity: 3 })
  })
})
