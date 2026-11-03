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
