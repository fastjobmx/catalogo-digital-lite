import { describe, expect, it } from 'vitest'
import { detectDelimiter, parseCsv } from './csv'
import { buildProducts, detectMapping, parseMoney, parseQuantity } from './mapping'
import { pdfLines } from './readers'

describe('CSV', () => {
  it('reads quotes, escaped quotes, line breaks and semicolons', () => {
    const text = 'Código;Nombre;Precio\r\nA-1;"Tocador ""Imperia""";"1.250.000"\r\nA-2;"Espejo\nredondo";90000\r\n;;\r\n'
    expect(detectDelimiter(text)).toBe(';')
    expect(parseCsv(text)).toEqual([['Código', 'Nombre', 'Precio'], ['A-1', 'Tocador "Imperia"', '1.250.000'], ['A-2', 'Espejo redondo', '90000']])
  })

  it('keeps formulas as plain text', () => {
    expect(parseCsv('nombre,precio\n=1+1,=SUM(A1)\n')).toEqual([['nombre', 'precio'], ['=1+1', '=SUM(A1)']])
  })
})

describe('numbers', () => {
  it('parses prices in common Colombian formats and rejects the rest', () => {
    expect(parseMoney('$ 1.250.000')).toBe(1250000)
    expect(parseMoney('1,250,000')).toBe(1250000)
    expect(parseMoney('125000')).toBe(125000)
    expect(parseMoney('1.250,50')).toBe(1251)
    expect(parseMoney('89.90')).toBe(90)
    expect(parseMoney('COP 45.000')).toBe(45000)
    expect(parseMoney('Consultar')).toBeNull()
    expect(parseMoney('-5000')).toBeNull()
    expect(parseMoney('1.2.3')).toBeNull()
  })

  it('parses whole quantities only', () => {
    expect(parseQuantity('12')).toBe(12)
    expect(parseQuantity('1.200')).toBe(1200)
    expect(parseQuantity('3,0')).toBe(3)
    expect(parseQuantity('2.5')).toBe(25)
    expect(parseQuantity('muchos')).toBeNull()
  })
})

describe('mapping and grouping', () => {
  const rows = [
    ['CATÁLOGO 2026'],
    ['Referencia', 'Producto', 'Color', 'Valor', 'Existencias', 'Categoría'],
    ['LM-1', 'Tocador Imperia', 'Blanco', '$ 1.200.000', '5', 'Tocadores'],
    ['LM-1', 'Tocador Imperia', 'Negro', '$ 1.250.000', '', 'Tocadores'],
    ['LM-1', 'Tocador Imperia', 'Blanco', '$ 1.200.000', '2', 'Tocadores'],
    ['', 'Espejo sin código', '', '90000', 'x', ''],
    ['LM-2', '', '', '1000', '1', ''],
  ]

  it('finds the header below a title row', () => {
    expect(detectMapping(rows)).toEqual({ headerRow: 1, mapping: { sku: 0, name: 1, color: 2, price: 3, stock: 4, category: 5 } })
  })

  it('groups variants, keeps their own price and never invents missing data', () => {
    const { headerRow, mapping } = detectMapping(rows)
    const { products, issues } = buildProducts(rows, headerRow, mapping, { generateSku: false, defaultStock: null })
    expect(products).toHaveLength(1)
    expect(products[0]!.product).toEqual({
      sku: 'LM-1', name: 'Tocador Imperia', description: null, category: 'Tocadores', price: 1200000,
      variants: [{ color: 'Blanco', size: null, stock: 5, price: null }, { color: 'Negro', size: null, stock: null, price: 1250000 }],
    })
    expect(issues.map((issue) => issue.row)).toEqual([5, 6, 7])
  })

  it('creates internal codes and default stock only when the store asks for them', () => {
    const { headerRow, mapping } = detectMapping(rows)
    const { products } = buildProducts(rows, headerRow, mapping, { generateSku: true, defaultStock: 50 })
    expect(products.map((item) => [item.product.sku, item.generated])).toEqual([['LM-1', false], ['IMP-ESPEJO-SIN-CODIGO', true]])
    expect(products[0]!.product.variants[1]!.stock).toBe(50)
  })
})

describe('PDF text layout', () => {
  it('splits lines by height and cells by wide gaps', () => {
    const item = (str: string, x: number, y: number, width = str.length * 5) => ({ str, x, y, width, height: 10 })
    expect(pdfLines([
      item('Precio', 300, 700), item('Producto', 50, 700),
      item('Tocador', 50, 680), item('Imperia', 88, 680.5), item('$1.200.000', 300, 680),
    ])).toEqual([['Producto', 'Precio'], ['Tocador Imperia', '$1.200.000']])
  })
})
