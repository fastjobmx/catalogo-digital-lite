export function isIndependentInstallation(): boolean {
  return import.meta.env.VITE_INDEPENDENT_INSTALLATION === 'true'
}

export function storeStorageKey(key: string): string {
  const slug = String(import.meta.env.VITE_STORE_SLUG || '').trim().toLowerCase()
  return slug ? `catalogo-lite:${slug}:${key}` : key
}
