import { TENANT_SLUG } from './tenant'

export function isIndependentInstallation(): boolean {
  return import.meta.env.VITE_INDEPENDENT_INSTALLATION === 'true'
}

/** Namespaces browser storage per store so carts and sessions never mix. */
export function storeStorageKey(key: string): string {
  return storeStorageKeyFor(TENANT_SLUG, key)
}

export function storeStorageKeyFor(tenantSlug: string | null, key: string): string {
  if (tenantSlug) return `catalogo-lite:t:${tenantSlug}:${key}`
  const slug = String(import.meta.env.VITE_STORE_SLUG || '').trim().toLowerCase()
  return slug ? `catalogo-lite:${slug}:${key}` : key
}
