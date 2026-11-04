import { describe, expect, it } from 'vitest'
import { BRAND_PALETTES, DEFAULT_THEME, mergeTheme, THEME_PRESETS } from './theme'
import { contrastRatio } from '../lib/logoPalette'

describe('commercial closing section theme data', () => {
  it('preserves the master template copy and merges legacy themes safely', () => {
    const theme = mergeTheme({})
    expect(theme.cta).toEqual(DEFAULT_THEME.cta)
    expect(theme.cta.title).toContain('par')
  })

  it('keeps preset copy and fills omitted values without dropping the section', () => {
    const theme = mergeTheme({ cta: { eyebrow: 'Mascotas', title: 'Bienestar para cada patita.' } })
    expect(theme.cta.eyebrow).toBe('Mascotas')
    expect(theme.cta.title).toBe('Bienestar para cada patita.')
    expect(theme.cta.description).toBe(DEFAULT_THEME.cta.description)
    expect(theme.cta.primaryLabel).toBe(DEFAULT_THEME.cta.primaryLabel)
  })
})

describe('store template families and palettes', () => {
  it('keeps all 13 template families and 12 ready-to-use palettes available', () => {
    expect(THEME_PRESETS).toHaveLength(13)
    expect(BRAND_PALETTES).toHaveLength(12)
    expect(new Set(THEME_PRESETS.map((preset) => preset.template)).size).toBe(13)
  })

  it('preserves the selected template when reading a saved theme', () => {
    expect(mergeTheme({ template: 'editorial' }).template).toBe('editorial')
  })

  it('keeps primary copy and buttons readable across the palette catalog', () => {
    for (const preset of BRAND_PALETTES) {
      expect(contrastRatio(preset.palette.text, preset.palette.background), preset.name).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(preset.palette.text, preset.palette.surface), preset.name).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(preset.palette.textMuted, preset.palette.surface), preset.name).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(preset.palette.primary, preset.palette.background), preset.name).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(preset.palette.button, preset.palette.buttonText), preset.name).toBeGreaterThanOrEqual(4.5)
    }
  })
})
