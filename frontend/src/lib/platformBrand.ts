/** Single source of the platform's public identity (Tienda IA Express). Stores keep their own
 * name, logo and colours; this brand appears only in access, administration and attribution spaces.
 * Technical names (Workers, routes, database, variables) are intentionally unchanged. */
export const PLATFORM_BRAND = {
  name: 'Tienda IA Express',
  /** Stylised spelling used by the logo artwork and the catalogue attribution. */
  wordmark: 'TiendIA Exprés',
  slogan: 'Tu tienda online, más fácil.',
  siteUrl: 'https://tiendaiaexpress.pages.dev/',
  logo: '/brand/tiendaiaexpress/logo-720.webp',
  /** Real pixel size of the logo file, to reserve its space and avoid layout shift. */
  logoSize: { width: 720, height: 273 },
  icon: '/brand/tiendaiaexpress/icon-192.png',
  favicon: '/brand/tiendaiaexpress/favicon-32.png',
  colors: { forest: '#03301f', forestDeep: '#02200f', lime: '#cdf53f', violet: '#8a2ff5', ivory: '#f7f8f3' },
} as const

/** Analytics hook for the catalogue attribution link (no external service is loaded). */
export const ATTRIBUTION_EVENT = 'platform_attribution_click'

/** Attribution link with campaign parameters, so the commercial site can tell which catalogue sent the visit. */
export function attributionUrl(storeSlug: string | null | undefined): string {
  const url = new URL(PLATFORM_BRAND.siteUrl)
  url.searchParams.set('utm_source', 'catalogo')
  url.searchParams.set('utm_medium', 'atribucion')
  if (storeSlug) url.searchParams.set('utm_campaign', storeSlug.slice(0, 60))
  return url.toString()
}
