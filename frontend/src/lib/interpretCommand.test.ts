import { describe, it, expect } from 'vitest'
import { interpretCommand } from './interpretCommand'

describe('interpretCommand (simulador local del panel)', () => {
  it('marca siempre las propuestas como simuladas', () => {
    const r = interpretCommand('cambia el whatsapp a 3001112233')
    expect(r.simulated).toBe(true)
    expect(r.action).toBe('update_whatsapp')
  })

  it('no inventa datos: reporta campos faltantes', () => {
    const r = interpretCommand('agrega producto referencia ZP-100')
    expect(r.action).toBe('create_product')
    expect(r.missing).toEqual(expect.arrayContaining(['price', 'stock']))
  })

  it('genera variantes por rango de tallas', () => {
    const r = interpretCommand('agrega producto Reebok referencia RBK-2514 precio 189900 stock 20 desde 38 hasta 44')
    expect(r.action).toBe('create_product')
    const variants = r.params.variants as Array<{ size: string }>
    expect(variants).toHaveLength(7)
    expect(variants[0]?.size).toBe('38')
    expect(variants[6]?.size).toBe('44')
  })

  it('devuelve unknown cuando no reconoce el comando', () => {
    expect(interpretCommand('texto cualquiera').action).toBe('unknown')
  })
})
