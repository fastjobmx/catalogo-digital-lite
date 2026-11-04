import { describe, expect, it } from 'vitest'
import { contrastRatio, palettesFromPixels } from './logoPalette'

describe('logo palette recommendations', () => {
  it('creates three options from sampled artwork and keeps text and buttons readable', () => {
    const pixels = new Uint8ClampedArray(64 * 4)
    for (let index = 0; index < pixels.length; index += 4) pixels.set([21, 61, 112, 255], index)
    const options = palettesFromPixels(pixels)

    expect(options.map((option) => option.id)).toEqual(['faithful', 'balanced', 'vibrant'])
    for (const option of options) {
      expect(contrastRatio(option.palette.text, option.palette.background)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(option.palette.textMuted, option.palette.surface)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(option.palette.primary, option.palette.background)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(option.palette.button, option.palette.buttonText)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('keeps monochrome logos neutral instead of inventing a red brand color', () => {
    const pixels = new Uint8ClampedArray(64 * 4)
    for (let index = 0; index < pixels.length; index += 4) pixels.set([28, 28, 28, 255], index)
    expect(palettesFromPixels(pixels)[0]?.palette.primary).toBe('#30343B')
  })
})
