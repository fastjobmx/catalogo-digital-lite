import { describe, it, expect } from 'vitest'
import { interpretCommand } from './interpreter'

describe('interpretCommand - interprete local determinista', () => {
  it('interprets exact-SKU product name and description edits without inventing identifiers', () => {
    expect(interpretCommand('Cambia el nombre de DEMO-FOTO-2026 a Zapatillas KINETIK Premium')).toMatchObject({
      action: 'update_product', params: { sku: 'DEMO-FOTO-2026', name: 'Zapatillas KINETIK Premium' }, needsConfirmation: true,
    })
    expect(interpretCommand('Cambia la descripción de DEMO-FOTO-2026 a Tenis para correr')).toMatchObject({
      action: 'update_product', params: { sku: 'DEMO-FOTO-2026', description: 'Tenis para correr' }, needsConfirmation: true,
    })
    expect(interpretCommand('Cambia el nombre de producto a Nuevo')).toMatchObject({ action: 'ask' })
  })

  it('interpreta un alta con rango de tallas e inventario por variante', () => {
    const r = interpretCommand(
      'Agrega producto Reebok referencia RBK-2514 precio 189900 stock 20 tallas desde 38 hasta 44',
    )
    expect(r.action).toBe('create_product')
    expect(r.simulated).toBe(true)
    expect(r.needsConfirmation).toBe(true)
    expect(r.missing).toEqual([])

    const variants = r.params.variants as Array<{ size: string; stock: number }>
    expect(variants).toHaveLength(7)
    expect(variants[0]).toMatchObject({ size: '38', stock: 20 })
    expect(variants[6]).toMatchObject({ size: '44', stock: 20 })
  })

  it('NO inventa precios: si falta el precio reporta el campo faltante', () => {
    const r = interpretCommand('Agrega producto Reebok referencia RBK-2514 stock 20')
    expect(r.action).toBe('create_product')
    expect(r.missing).toContain('price')
    expect(r.params).not.toHaveProperty('price')
  })

  it('NO inventa stock: si falta el stock lo reporta y no crea variantes', () => {
    const r = interpretCommand('Agrega producto Zapatilla referencia ZP-100 precio 120000')
    expect(r.action).toBe('create_product')
    expect(r.missing).toContain('stock')
    expect(r.params.variants).toEqual([])
  })

  it('interprets an explicit Spanish stock-by-size command without Gemini', () => {
    const r = interpretCommand('Fija en 5 unidades la existencia de la referencia TEST-TRN-001 para talla 39.')
    expect(r).toMatchObject({
      action: 'update_stock',
      params: { sku: 'TEST-TRN-001', size: '39', stock: 5 },
      missing: [],
      needsConfirmation: true,
    })
  })

  it('interprets proposed stock changes phrased with the infinitive cambiar', () => {
    for (const size of ['38', '39']) {
      const r = interpretCommand(`Propón cambiar el stock de TEST-TRN-001 talla ${size} a 15 unidades.`)
      expect(r).toMatchObject({
        action: 'update_stock',
        params: { sku: 'TEST-TRN-001', size, stock: 15 },
        missing: [],
        needsConfirmation: true,
      })
    }
  })

  it('asks for missing stock fields instead of inventing them', () => {
    const r = interpretCommand('Fija el stock de la referencia TEST-TRN-001 para talla 39.')
    expect(r.action).toBe('ask')
    expect(r.missing).toContain('cantidad de unidades')
    expect(r.needsConfirmation).toBe(false)
  })

  it('traduce WhatsApp internacional y pide aclaración si falta el país', () => {
    const r = interpretCommand('Cambia mi WhatsApp a +57 350 691 2734')
    expect(r.action).toBe('update_whatsapp')
    expect(r.params.whatsappPhone).toBe('+573506912734')
    expect(r.needsConfirmation).toBe(true)
    expect(interpretCommand('Cambia mi WhatsApp a 3506912734').action).toBe('ask')
  })

  it('detecta el color primario en hexadecimal', () => {
    const r = interpretCommand('Cambia el color primario a #FF0000')
    expect(r.action).toBe('update_store_colors')
    expect(r.params.primaryColor).toBe('#FF0000')
  })

  it('pide el color si no se indica hex', () => {
    const r = interpretCommand('Cambia el color primario')
    expect(r.action).toBe('ask')
    expect(r.missing).toContain('color principal inequívoco o hexadecimal')
  })

  it('interpreta nombres y títulos comerciales por separado', () => {
    expect(interpretCommand('Cambia el nombre de mi tienda a EROS SHOP')).toMatchObject({
      action: 'update_store_name', params: { name: 'EROS SHOP' }, needsConfirmation: true,
    })
    expect(interpretCommand('Cambia el título de portada a Viste a tu manera')).toMatchObject({
      action: 'update_hero_title', params: { title: 'Viste a tu manera' }, needsConfirmation: true,
    })
    expect(interpretCommand('Quiero mi tienda azul oscuro')).toMatchObject({
      action: 'update_store_colors', params: { primaryColor: '#153D70' }, needsConfirmation: true,
    })
  })

  it('mapea consultas de inventario y productos', () => {
    expect(interpretCommand('cuánto inventario tengo').action).toBe('get_inventory')
    expect(interpretCommand('lista productos').action).toBe('get_products')
  })

  it('acepta un payload JSON tipado válido', () => {
    const r = interpretCommand('{"action":"get_store_configuration","params":{}}')
    expect(r.action).toBe('get_store_configuration')
  })

  it('devuelve unknown para texto no reconocido (sin ejecutar nada)', () => {
    const r = interpretCommand('hola buenos días')
    expect(r.action).toBe('unknown')
    expect(r.needsConfirmation).toBe(false)
  })
})
