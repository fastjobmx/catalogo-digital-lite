import { describe, it, expect } from 'vitest'
import { formatMoney, discountPercent, slugify } from './format'

describe('formatMoney', () => {
  it('formatea en pesos colombianos sin decimales', () => {
    const out = formatMoney(189900, 'COP')
    expect(out).toContain('189')
    expect(out).toContain('900')
    expect(out).not.toContain(',00')
  })

  it('respeta la moneda configurada', () => {
    expect(formatMoney(10, 'USD')).toContain('10')
  })
})

describe('discountPercent', () => {
  it('calcula el porcentaje de descuento redondeado', () => {
    expect(discountPercent(189900, 229900)).toBe(17)
  })

  it('devuelve null si no hay precio de comparación', () => {
    expect(discountPercent(189900)).toBeNull()
    expect(discountPercent(189900, null)).toBeNull()
  })

  it('devuelve null si el precio de comparación no es mayor', () => {
    expect(discountPercent(100, 100)).toBeNull()
    expect(discountPercent(100, 50)).toBeNull()
  })
})

describe('slugify', () => {
  it('genera slugs sin acentos ni espacios', () => {
    expect(slugify('Tenis Running')).toBe('tenis-running')
    expect(slugify('Zapatos Niño')).toBe('zapatos-nino')
  })

  it('elimina símbolos y guiones sobrantes', () => {
    expect(slugify('  Ofertas & Promos!  ')).toBe('ofertas-promos')
  })
})
