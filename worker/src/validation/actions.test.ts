import { describe, it, expect } from 'vitest'
import { actionSchemas, ACTION_NAMES, parseActionPayload } from './actions'

describe('actionSchemas / parseActionPayload', () => {
  it('expone las 20 acciones deterministas del agente', () => {
    expect(ACTION_NAMES.length).toBe(20)
    expect(ACTION_NAMES).toContain('create_product')
    expect(ACTION_NAMES).toContain('update_stock')
    expect(ACTION_NAMES).toContain('get_inventory')
  })

  it('rechaza acciones no permitidas (no hay SQL libre)', () => {
    const result = parseActionPayload({ action: 'run_sql', params: { sql: 'DROP TABLE products' } })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toContain('Acción no permitida')
    }
  })

  it('rechaza payloads sin campo action', () => {
    const result = parseActionPayload({ params: {} })
    expect(result.success).toBe(false)
  })

  it('acepta un create_product válido con inventario por variante', () => {
    const result = parseActionPayload({
      action: 'create_product',
      params: {
        sku: 'RBK-2514',
        name: 'Reebok Classic Leather',
        price: 189900,
        variants: [
          { sku: 'RBK-2514-38', name: 'Talla 38', size: '38', stock: 20 },
          { sku: 'RBK-2514-39', name: 'Talla 39', size: '39', stock: 20 },
        ],
      },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.action).toBe('create_product')
    }
  })

  it('rechaza create_product sin variantes (min 1)', () => {
    const parsed = actionSchemas.create_product.safeParse({
      sku: 'X',
      name: 'Producto',
      price: 1000,
      variants: [],
    })
    expect(parsed.success).toBe(false)
  })

  it('rechaza stock negativo', () => {
    const parsed = actionSchemas.update_stock.safeParse({ sku: 'X', size: '38', stock: -5 })
    expect(parsed.success).toBe(false)
  })

  it('requires a specific variant size for stock changes', () => {
    expect(actionSchemas.update_stock.safeParse({ sku: 'X', stock: 6 }).success).toBe(false)
    expect(actionSchemas.update_stock.safeParse({ sku: 'X', size: '38', stock: 6 }).success).toBe(true)
  })

  it('valida el formato hexadecimal de los colores de marca', () => {
    expect(actionSchemas.update_store_colors.safeParse({ primaryColor: '#0057FF' }).success).toBe(true)
    expect(actionSchemas.update_store_colors.safeParse({ primaryColor: 'azul' }).success).toBe(false)
  })

  it('rechaza precios no enteros (evita valores inventados con decimales)', () => {
    const parsed = actionSchemas.update_price.safeParse({ sku: 'X', price: 10.5 })
    expect(parsed.success).toBe(false)
  })

  it('limita set_featured_products a 20 SKUs', () => {
    const many = Array.from({ length: 21 }, (_, i) => `SKU-${i}`)
    expect(actionSchemas.set_featured_products.safeParse({ skus: many }).success).toBe(false)
  })
})
