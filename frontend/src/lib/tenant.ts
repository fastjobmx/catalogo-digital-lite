// ============================================
// Tienda activa (multitienda)
// ============================================
// Cada tienda de la plataforma vive bajo /t/<dirección>. La tienda principal
// (SneakerHub) sigue en la raíz. El backend valida siempre el acceso: este
// valor solo indica qué tienda pide el navegador.

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9]|-(?!-)){1,38}[a-z0-9]$/

export function detectTenantSlug(pathname: string): string | null {
  const match = pathname.match(/^\/t\/([^/?#]+)/)
  if (!match) return null
  const slug = decodeURIComponent(match[1]!).toLowerCase()
  return SLUG_PATTERN.test(slug) ? slug : null
}

const currentPath = typeof window !== 'undefined' ? window.location.pathname : '/'

/** Dirección de la tienda abierta en esta pestaña (null = tienda principal). */
export const TENANT_SLUG: string | null = detectTenantSlug(currentPath)

// Neutral title until the store configuration loads (never the primary store's brand).
if (TENANT_SLUG && typeof document !== 'undefined') {
  document.title = TENANT_SLUG.split('-').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}

/** Base del router: todas las rutas internas quedan bajo /t/<dirección>. */
export const ROUTER_BASENAME: string | undefined = TENANT_SLUG ? `/t/${TENANT_SLUG}` : undefined

/** Ruta absoluta (fuera del router) hacia una tienda concreta. */
export function tenantPath(slug: string | null | undefined, path = '/'): string {
  const suffix = path.startsWith('/') ? path : `/${path}`
  return slug ? `/t/${slug}${suffix === '/' ? '' : suffix}` : suffix
}

/** Cabeceras que identifican la tienda ante la API. */
export function tenantHeaders(slug: string | null = TENANT_SLUG): Record<string, string> {
  return slug ? { 'X-Store-Slug': slug } : {}
}
