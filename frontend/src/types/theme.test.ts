import { describe, expect, it } from 'vitest'
import { DEFAULT_THEME, mergeTheme } from './theme'

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
