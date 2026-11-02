import {
  DEFAULT_THEME,
  mergeTheme,
  type ClosingCtaConfig,
  type ThemeConfig,
  type ThemeFallbacks,
} from '../types/theme'

export function getClosingCtaDefaults(
  storeName: string,
  independent: boolean,
  presetCta: Partial<ClosingCtaConfig> | null = null,
): ClosingCtaConfig {
  const defaults: ClosingCtaConfig = independent ? {
    eyebrow: 'Explora',
    title: `Descubre el catálogo de ${storeName || 'tu tienda'}.`,
    description: 'Explora los productos disponibles y contacta al comercio para resolver tus dudas.',
    primaryLabel: 'Explorar catálogo',
  } : DEFAULT_THEME.cta

  return { ...defaults, ...(independent && presetCta ? presetCta : {}) }
}

export function normalizeStoreTheme(
  partial: unknown,
  storeName: string,
  independent: boolean,
  fallbacks: ThemeFallbacks = {},
  presetCta: Partial<ClosingCtaConfig> | null = null,
): ThemeConfig {
  const theme = mergeTheme(partial, fallbacks)
  const source = partial && typeof partial === 'object' ? partial as Partial<ThemeConfig> : {}
  theme.cta = {
    ...getClosingCtaDefaults(storeName, independent, presetCta),
    ...(source.cta && typeof source.cta === 'object' ? source.cta : {}),
  }
  return theme
}
