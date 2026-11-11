/** Sizes and units said or typed in everyday words while a product draft asks for its inventory (real chat failures). */
import { describe, expect, it } from 'vitest'
import { createTelegramProductDraft, parseProductDraftFieldReply } from './telegramProductDraft'

const draft = { ...createTelegramProductDraft(), defaultColor: 'Blanco' }
const read = (text: string) => {
  const result = parseProductDraftFieldReply('variants', text, draft, 'COP') as { draft?: { variants: Array<{ size: string; stock: number }> }; error?: string }
  return result.error ? `ERROR ${result.error.slice(0, 40)}` : result.draft!.variants.map((variant) => `${variant.size}:${variant.stock}`).join(' ')
}

describe('draft inventory reply in everyday language', () => {
  it.each([
    ['Talla 30, 32, 34 y 36, cinco unidades cada una', '30:5 32:5 34:5 36:5'],
    ['Talla 30, 32, 34 y 36, cinco unidades cada una.', '30:5 32:5 34:5 36:5'],
    ['son tallas 30, 32, 34 y talla 36 en 5 unidades cada una', '30:5 32:5 34:5 36:5'],
    ['tallas 30, 32, 34 y 36, 5 de cada una', '30:5 32:5 34:5 36:5'],
    ['sí, de otra forma, tallas 30 y 32 con 5 unidades cada una', '30:5 32:5'],
    ['M 5, L 8', 'M:5 L:8'],
    ['38:3, 39:2', '38:3 39:2'],
  ])('%s', (text, expected) => { expect(read(text)).toBe(expected) })

  it('still asks, never guesses, when the units are missing', () => {
    expect(read('tallas 36 a 40')).toMatch(/^ERROR/)
  })
})
