import { THEME_PRESETS, type PaletteConfig, type ThemeConfig } from '../types/theme'
import { contrastRatio } from './logoPalette'

/** Order of the ten colors in `?palette=` (hex without '#', separated by '-'). */
export const PREVIEW_PALETTE_KEYS: Array<keyof PaletteConfig> = [
  'background', 'surface', 'text', 'textMuted', 'border', 'primary', 'secondary', 'accent', 'button', 'buttonText',
]

export interface PreviewOverride { palette?: PaletteConfig; template?: string }

/** Reads an unsaved preview request. Invalid or illegible values are ignored. */
export function parsePreviewOverride(search: string): PreviewOverride | null {
  const params = new URLSearchParams(search)
  const result: PreviewOverride = {}
  const rawPalette = params.get('palette')
  if (rawPalette) {
    const parts = rawPalette.split('-')
    if (parts.length === PREVIEW_PALETTE_KEYS.length && parts.every((part) => /^[0-9a-f]{6}$/i.test(part))) {
      const palette = Object.fromEntries(PREVIEW_PALETTE_KEYS.map((key, index) => [key, `#${parts[index]!.toUpperCase()}`])) as unknown as PaletteConfig
      if (contrastRatio(palette.text, palette.background) >= 4.5 && contrastRatio(palette.buttonText, palette.button) >= 4.5) result.palette = palette
    }
  }
  const template = params.get('template')
  if (template && THEME_PRESETS.some((preset) => preset.template === template)) result.template = template
  return result.palette || result.template ? result : null
}

/** Template keeps the current colors (as the assistant does); a palette replaces them. */
export function applyPreviewOverride(theme: ThemeConfig, override: PreviewOverride): ThemeConfig {
  const preset = override.template ? THEME_PRESETS.find((item) => item.template === override.template) : undefined
  const palette = override.palette || theme.style.palette
  return {
    ...theme,
    template: override.template || theme.template,
    style: {
      ...theme.style,
      ...(preset ? {
        typography: { ...preset.typography },
        radius: preset.radius,
        buttonStyle: preset.buttonStyle,
        cardStyle: preset.cardStyle,
      } : {}),
      palette: { ...palette },
      darkMode: contrastRatio(palette.background, '#000000') < contrastRatio(palette.background, '#FFFFFF'),
    },
  }
}
