import { describe, expect, it } from 'vitest'
import { createTelegramProductDraft, mergeGeminiProductFields, missingProductDraftFields, parseProductDraftFieldReply } from './telegramProductDraft'

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
      { size: '38', color: 'negro', stock: 2 },
      { size: '39', color: 'negro', stock: 2 },
      { size: '40', color: 'negro', stock: 2 },
    ])
  })
})
