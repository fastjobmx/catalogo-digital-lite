import { describe, expect, it } from 'vitest'
import { createTelegramProductDraft, inferColor, mergeGeminiProductFields, missingProductDraftFields, parseProductDraftFieldReply } from './telegramProductDraft'

describe('Telegram product draft validation', () => {
  it('does not invent fields and identifies required values', () => {
    const draft = createTelegramProductDraft()
    expect(missingProductDraftFields(draft)).toEqual(['name', 'sku', 'description', 'price', 'category', 'variants', 'photos'])
    expect(draft.fields).toEqual({})
    expect(draft.variants).toEqual([])
  })

  it('keeps only explicit Gemini product data and leaves missing stock unset', () => {
    const draft = mergeGeminiProductFields(createTelegramProductDraft(), {
      name: 'Zapatillas Kinetik', price: 250000, sizes: ['38', '39'], color: 'Negro',
    })
    expect(draft.fields.price).toBe(250000)
    expect(draft.variants).toEqual([{ size: '38', color: 'Negro' }, { size: '39', color: 'Negro' }])
    expect(missingProductDraftFields(draft)).toContain('variants')
    expect(draft.fields.sku).toBeUndefined()
  })

  it('parses explicit prices and per-variant stock without guessing', () => {
    const draft = createTelegramProductDraft()
    const price = parseProductDraftFieldReply('price', '$250.000 COP', draft)
    expect(price.draft.fields.price).toBe(250000)
    const variants = parseProductDraftFieldReply('variants', 'Negro talla 38:3, Negro talla 39:0', draft)
    expect(variants.draft.variants).toEqual([
      { size: '38', color: 'Negro', stock: 3 },
      { size: '39', color: 'Negro', stock: 0 },
    ])
    expect(parseProductDraftFieldReply('variants', 'talla 38', draft).error).toBeTruthy()
  })

  it('accepts a color, size list, and explicitly uniform stock in conversational form', () => {
    const draft = createTelegramProductDraft()
    const result = parseProductDraftFieldReply('variants', 'color: negro Tallas: 38, 39 y 40\nStock inicial: 2 unidades por talla', draft)
    expect(result.error).toBeUndefined()
    expect(result.draft.variants).toEqual([
      { size: '38', color: 'Negro', stock: 2 },
      { size: '39', color: 'Negro', stock: 2 },
      { size: '40', color: 'Negro', stock: 2 },
    ])
  })

  it('accepts the stock replies sent from Telegram in production (closing period, no color)', () => {
    const named = { ...createTelegramProductDraft(), fields: { name: 'Tenis deportivos negros' } }
    const withColor = parseProductDraftFieldReply('variants', 'negro talla 38:22, negro talla 39:21, negro talla 40:32, negro talla 41:23.', createTelegramProductDraft())
    expect(withColor.error).toBeUndefined()
    expect(withColor.draft.variants).toEqual([
      { size: '38', color: 'Negro', stock: 22 }, { size: '39', color: 'Negro', stock: 21 },
      { size: '40', color: 'Negro', stock: 32 }, { size: '41', color: 'Negro', stock: 23 },
    ])
    const fromName = parseProductDraftFieldReply('variants', '38:22, 39:21, 40:32, 41:23.', named)
    expect(fromName.draft.variants.map((variant) => variant.color)).toEqual(['Negro', 'Negro', 'Negro', 'Negro'])
    const noColor = parseProductDraftFieldReply('variants', '38:3, 39:2.', createTelegramProductDraft())
    expect(noColor.draft.variants).toEqual([{ size: '38', color: 'Único', stock: 3 }, { size: '39', color: 'Único', stock: 2 }])
    expect(parseProductDraftFieldReply('variants', '38:3 y 39:2', createTelegramProductDraft()).draft.variants).toHaveLength(2)
    expect(parseProductDraftFieldReply('variants', '38:3\n39:2 unidades', createTelegramProductDraft()).draft.variants).toHaveLength(2)
  })

  it('explains which fragment it could not read and keeps the draft unchanged', () => {
    const draft = createTelegramProductDraft()
    const result = parseProductDraftFieldReply('variants', '38:3, treinta y nueve', draft)
    expect(result.error).toContain('treinta')
    expect(result.draft).toBe(draft)
  })

  it('accepts a closing period in prices and codes and infers a single color from text', () => {
    const draft = createTelegramProductDraft()
    expect(parseProductDraftFieldReply('price', '209.000.', draft).draft.fields.price).toBe(209000)
    expect(parseProductDraftFieldReply('price', '180 mil pesos.', draft).draft.fields.price).toBe(180000)
    expect(parseProductDraftFieldReply('sku', 'código: ten-neg-01.', draft).draft.fields.sku).toBe('TEN-NEG-01')
    expect(inferColor('Tenis deportivos negros')).toBe('Negro')
    expect(inferColor('Tenis blanco y negro')).toBeUndefined()
  })
})

describe('letter sizes and size ranges (Muy Parcero, 2026-11-04)', () => {
  const variantsFor = (text: string) => {
    const draft = { ...createTelegramProductDraft(), defaultColor: 'Negro' }
    return parseProductDraftFieldReply('variants', text, draft)
  }

  it('reads clothing sizes written with letters, as the owner typed them', () => {
    const result = variantsFor('S:10, M:10, L:15, XL:20.')
    expect(result.error).toBeUndefined()
    expect(result.draft.variants).toEqual([
      { size: 'S', color: 'Negro', stock: 10 }, { size: 'M', color: 'Negro', stock: 10 },
      { size: 'L', color: 'Negro', stock: 15 }, { size: 'XL', color: 'Negro', stock: 20 },
    ])
    expect(variantsFor('xs:2; xxl:4 y 2xl:1').draft.variants.map((v) => v.size)).toEqual(['XS', 'XXL', 'XXL'])
    expect(variantsFor('Rojo talla M:3, Azul talla L:2').draft.variants).toEqual([{ size: 'M', color: 'Rojo', stock: 3 }, { size: 'L', color: 'Azul', stock: 2 }])
    expect(variantsFor('tallas S, M y L; stock 5 por talla').draft.variants.map((v) => `${v.size}:${v.stock}`)).toEqual(['S:5', 'M:5', 'L:5'])
  })

  it('asks for the units of each size instead of guessing a range', () => {
    const result = variantsFor('TENGO 20 DE LA TALLA S A LA XL')
    expect(result.draft.variants).toEqual([])
    expect(result.error).toContain('Entendí las tallas S, M, L, XL')
    expect(result.error).toContain('S:20, M:20, L:20, XL:20')
    expect(variantsFor('tallas 38 a 41').error).toContain('38:5, 39:5, 40:5, 41:5')
  })

  it('still rejects text that is not a size list and keeps numeric sizes working', () => {
    expect(variantsFor('Negro:3').error).toContain('No entendí')
    expect(variantsFor('38:3, 39:2').draft.variants.map((v) => `${v.size}:${v.stock}`)).toEqual(['38:3', '39:2'])
    expect(variantsFor('10').draft.variants).toEqual([{ size: 'Única', color: 'Negro', stock: 10 }])
  })
})
