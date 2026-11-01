import { describe, it, expect } from 'vitest'
import { interpretCommand } from './interpreter'

describe('interpretCommand - interprete local determinista', () => {
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

  it('traduce cambio de WhatsApp a la acción update_whatsapp', () => {
    const r = interpretCommand('Cambia mi whatsapp a 3001112233')
    expect(r.action).toBe('update_whatsapp')
    expect(r.params.whatsappPhone).toBe('3001112233')
    expect(r.needsConfirmation).toBe(true)
  })

  it('detecta el color primario en hexadecimal', () => {
    const r = interpretCommand('Cambia el color primario a #FF0000')
    expect(r.action).toBe('update_store_colors')
    expect(r.params.primaryColor).toBe('#FF0000')
  })

  it('pide el color si no se indica hex', () => {
    const r = interpretCommand('Cambia el color primario')
    expect(r.action).toBe('update_store_colors')
    expect(r.missing).toContain('primaryColor')
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
