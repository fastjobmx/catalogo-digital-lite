import { PRIMARY_STORE_ID } from '../tenancy/stores'

const ASSET_PREFIX = '/api/assets/'

/** Store-scoped R2 key prefix for new uploads. */
export function storeAssetPrefix(storeId: number): string {
  return `stores/${storeId}/`
}

/** True when an asset URL may be referenced by the given store. External HTTPS
 * images keep working; R2 assets under stores/<id>/ must match the store and
 * legacy un-prefixed keys belong to the primary store only. */
export function assetUrlBelongsToStore(value: string, storeId: number): boolean {
  const source = value.trim()
  const path = source.startsWith('http') ? safePath(source) : source
  if (path === null) return false
  const index = path.indexOf(ASSET_PREFIX)
  if (index !== 0) return true
  const key = path.slice(ASSET_PREFIX.length).split(/[?#]/, 1)[0] || ''
  if (key.split('/').includes('..') || key.startsWith('telegram-drafts/')) return false
  const scoped = key.match(/^stores\/(\d+)\//)
  if (scoped) return Number(scoped[1]) === storeId
  return storeId === PRIMARY_STORE_ID
}

function safePath(url: string): string | null {
  try {
    const parsed = new URL(url)
    // Absolute URLs pointing at our own asset route are validated like relative ones.
    return parsed.pathname.startsWith(ASSET_PREFIX) ? parsed.pathname : ''
  } catch {
    return null
  }
}

/** Collects every string found in a JSON-like value (theme configuration, arrays). */
export function collectStrings(value: unknown, output: string[] = [], depth = 0): string[] {
  if (depth > 8) return output
  if (typeof value === 'string') output.push(value)
  else if (Array.isArray(value)) for (const item of value) collectStrings(item, output, depth + 1)
  else if (value && typeof value === 'object') for (const item of Object.values(value)) collectStrings(item, output, depth + 1)
  return output
}

export function findForeignAssetUrl(values: unknown, storeId: number): string | null {
  for (const candidate of collectStrings(values)) {
    let parsed: unknown = candidate
    if (candidate.startsWith('{') || candidate.startsWith('[')) {
      try { parsed = JSON.parse(candidate) } catch { parsed = candidate }
    }
    for (const value of typeof parsed === 'string' ? [parsed] : collectStrings(parsed)) {
      if ((value.includes(ASSET_PREFIX)) && !assetUrlBelongsToStore(value, storeId)) return value
    }
  }
  return null
}
