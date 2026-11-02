import { describe, expect, it } from 'vitest'
import { loadCartFromStorage, type CartItem } from './CartContext'

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
