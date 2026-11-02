import { describe, expect, it } from 'vitest'
import { DEFAULT_THEME } from '../types/theme'
import { normalizeStoreTheme } from './storeTheme'

describe('normalizeStoreTheme', () => {
  it('repairs legacy independent themes without bringing back template copy', () => {
    const theme = normalizeStoreTheme({ hero: { title: 'Patitas Felices' } }, 'Patitas Felices', true)

    expect(theme.cta).toEqual({
      eyebrow: 'Explora',
      title: 'Descubre el catálogo de Patitas Felices.',
      description: 'Explora los productos disponibles y contacta al comercio para resolver tus dudas.',
      primaryLabel: 'Explorar catálogo',
    })
  })

  it('preserves the master template CTA while merging an older theme', () => {
    const theme = normalizeStoreTheme({ hero: { title: 'El par' } }, 'SneakerHub Premium', false)

    expect(theme.cta).toEqual(DEFAULT_THEME.cta)
  })

  it('fills partial preset CTA values from neutral independent defaults', () => {
    const theme = normalizeStoreTheme({ cta: { eyebrow: 'Mascotas' } }, 'Patitas Felices', true)

    expect(theme.cta.eyebrow).toBe('Mascotas')
    expect(theme.cta.title).toContain('Patitas Felices')
    expect(theme.cta.title).not.toContain('par')
  })

  it('uses the selected installation preset when older D1 theme data has no CTA', () => {
    const theme = normalizeStoreTheme(
      { hero: { title: 'Patitas Felices' } },
      'Patitas Felices',
      true,
      {},
      { eyebrow: 'Cuidado cercano', title: 'Bienestar para cada patita.' },
    )

    expect(theme.cta.eyebrow).toBe('Cuidado cercano')
    expect(theme.cta.title).toBe('Bienestar para cada patita.')
    expect(theme.cta.description).toBe('Explora los productos disponibles y contacta al comercio para resolver tus dudas.')
  })
})
