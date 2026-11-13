import { describe, expect, it } from 'vitest'
import { BRAND_PALETTES, DEFAULT_THEME, mergeTheme, resetThemeDesign, THEME_PRESETS } from './theme'
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
  it('keeps all 14 template families and 13 ready-to-use palettes available', () => {
    expect(THEME_PRESETS).toHaveLength(14)
    expect(BRAND_PALETTES).toHaveLength(13)
    expect(new Set(THEME_PRESETS.map((preset) => preset.template)).size).toBe(14)
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

describe('resetThemeDesign («Restaurar diseño» in Appearance)', () => {
  const store = mergeTheme({
    template: 'premium',
    style: { ...DEFAULT_THEME.style, radius: 'pill', darkMode: true },
    header: { ...DEFAULT_THEME.header, topbarText: 'Envíos a toda Colombia' },
    hero: { ...DEFAULT_THEME.hero, title: 'EL ESTILO SE LLEVA PUESTO', imageUrl: '/api/assets/stores/5/store/hero.jpg', align: 'center', height: 'compact', overlayOpacity: 10 },
    promo: { ...DEFAULT_THEME.promo, title: 'Emprende con nosotros' },
    footer: { ...DEFAULT_THEME.footer, aboutText: 'Imperio Nova, Bogotá' },
    featuredSkus: ['JEA-1'],
  })

  it('resets template, style, sections and hero layout to the factory design', () => {
    const reset = resetThemeDesign(store)
    expect(reset.template).toBe(DEFAULT_THEME.template)
    expect(reset.style).toEqual(DEFAULT_THEME.style)
    expect(reset.sections).toEqual(DEFAULT_THEME.sections)
    expect([reset.hero.align, reset.hero.height, reset.hero.overlayOpacity]).toEqual([DEFAULT_THEME.hero.align, DEFAULT_THEME.hero.height, DEFAULT_THEME.hero.overlayOpacity])
  })

  it('keeps the store copy and images instead of the demo store ones', () => {
    const reset = resetThemeDesign(store)
    expect(reset.hero.title).toBe('EL ESTILO SE LLEVA PUESTO')
    expect(reset.hero.imageUrl).toBe('/api/assets/stores/5/store/hero.jpg')
    expect(reset.header.topbarText).toBe('Envíos a toda Colombia')
    expect(reset.promo.title).toBe('Emprende con nosotros')
    expect(reset.footer.aboutText).toBe('Imperio Nova, Bogotá')
    expect(reset.featuredSkus).toEqual(['JEA-1'])
    expect(JSON.stringify(reset)).not.toContain('El par que define')
  })

  it('does not share objects with DEFAULT_THEME', () => {
    const reset = resetThemeDesign(store)
    reset.style.palette.primary = '#000001'
    expect(DEFAULT_THEME.style.palette.primary).not.toBe('#000001')
  })
})
