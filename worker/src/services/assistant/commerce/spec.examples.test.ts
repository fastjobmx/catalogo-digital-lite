/** The merchant phrases of the product specification, parsed into structured intents (no AI, no database). */
import { describe, expect, it } from 'vitest'
import { parseCommerce } from './parse'
import { ambiguousAmount, numberWordsToDigits, parseMoney } from './language'

const stocks = (intent: any) => (intent?.lines || []).map((line: any) => `${line.size}:${line.quantity}`)

describe('size and quantity layouts', () => {
  it('range with the same quantity for each size', () => {
    const intent: any = parseCommerce('Llegaron tenis blancos de la 38 a la 42, tres de cada talla')
    expect(intent).toMatchObject({ kind: 'stock', mode: 'add' })
    expect(stocks(intent)).toEqual(['38:3', '39:3', '40:3', '41:3', '42:3'])
  })

  it('different quantity per size, sizes first', () => {
    const intent: any = parseCommerce('Llegaron jean azul 28 dos unidades, 30 cinco y 32 una')
    expect(stocks(intent)).toEqual(['28:2', '30:5', '32:1'])
    expect(intent.product).toBe('jean')
  })

  it('letter sizes followed by their quantity', () => {
    const intent: any = parseCommerce('Llegaron camisas negras M 5, L 8, XL 3')
    expect(stocks(intent)).toEqual(['M:5', 'L:8', 'XL:3'])
    expect(intent.lines.every((line: any) => line.color === 'Negro')).toBe(true)
  })

  it('quantity first, total and spoken sizes', () => {
    const intent: any = parseCommerce('Me llegaron doce pares de tenis blancos, cuatro talla treinta y ocho, cuatro treinta y nueve y cuatro cuarenta, referencia AD223')
    expect(intent).toMatchObject({ kind: 'stock', mode: 'add', total: 12 })
    expect(stocks(intent)).toEqual(['38:4', '39:4', '40:4'])
    expect(intent.product).toBe('tenis AD223')
  })

  it('keeps every line when a size has no quantity of its own', () => {
    const intent: any = parseCommerce('Llegaron 10 camisetas negras talla M y 8 talla L')
    expect(stocks(intent).sort()).toEqual(['L:8', 'M:10'])
    expect(intent.total).toBeNull()
  })

  it('still reads the total when the sizes add up', () => {
    const intent: any = parseCommerce('Me llegaron 10 camisetas, 4 M y 3 L')
    expect(intent).toMatchObject({ total: 10 })
    expect(stocks(intent)).toEqual(['M:4', 'L:3'])
  })
})

describe('creating a product from one sentence', () => {
  it('reference, sizes, units per size and price', () => {
    const intent: any = parseCommerce('Agrega unos tenis Nike blancos, referencia NK203, tallas 38, 39 y 40, cinco pares de cada una, precio 180 mil pesos')
    expect(intent).toMatchObject({ kind: 'create_product', brand: 'Nike', color: 'Blanco', sku: 'NK203', price: 180000, priceAsk: null })
    expect(intent.name).toBe('Tenis Nike blancos')
    expect(intent.stocks).toEqual([{ size: '38', quantity: 5 }, { size: '39', quantity: 5 }, { size: '40', quantity: 5 }])
  })

  it('a size with its units and no price yet', () => {
    const intent: any = parseCommerce('Agrega una camiseta azul talla M, 5 unidades')
    expect(intent).toMatchObject({ kind: 'create_product', color: 'Azul', price: null, sku: null })
    expect(intent.stocks).toEqual([{ size: 'M', quantity: 5 }])
    expect(intent.name).toBe('Camiseta azul')
  })

  it('without an article "agrega" is a restock, not a new product', () => {
    expect(parseCommerce('agrega 3 negras talla 38')).toMatchObject({ kind: 'stock', mode: 'add' })
  })

  it('a bare small price is asked, never assumed', () => {
    const intent: any = parseCommerce('Créame unos tenis Nike blancos talla 38, precio 180')
    expect(intent).toMatchObject({ kind: 'create_product', price: null, priceAsk: 180 })
    expect(parseCommerce('ponle el precio en 180')).toMatchObject({ kind: 'price_clarify', amount: 180, mode: 'set' })
  })
})

describe('numbers and prices in words', () => {
  it('reads "ciento ochenta mil" as 180.000 (not 80.000)', () => {
    expect(parseMoney('ciento ochenta mil')).toBe(180000)
    expect(parseMoney('ochenta mil')).toBe(80000)
    expect(parseMoney('treinta y cinco mil')).toBe(35000)
    expect(parseMoney('doscientos cincuenta mil pesos')).toBe(250000)
    expect(parseMoney('80mil')).toBe(80000)
    expect(parseMoney('180')).toBeNull()
  })

  it('only the compound spoken form becomes digits', () => {
    expect(numberWordsToDigits('treinta y ocho y cuarenta y dos')).toBe('38 y 42')
    expect(numberWordsToDigits('una camiseta')).toBe('una camiseta')
  })

  it('detects ambiguous prices only when the currency scale is unclear', () => {
    expect(ambiguousAmount('precio 180')).toBe(180)
    expect(ambiguousAmount('precio 180 mil')).toBeNull()
    expect(ambiguousAmount('precio $180.000')).toBeNull()
    expect(ambiguousAmount('cinco pares a 38')).toBe(38)
    expect(ambiguousAmount('5 unidades talla 38')).toBeNull()
  })
})
