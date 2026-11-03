import { afterEach, describe, expect, it, vi } from 'vitest'
import { detectTenantSlug, tenantHeaders, tenantPath } from './tenant'
import { storeStorageKeyFor } from './installation'

afterEach(() => vi.unstubAllGlobals())

describe('multi-store routing', () => {
  it('detects the store from /t/<slug> and ignores invalid or reserved-looking paths', () => {
    expect(detectTenantSlug('/t/moda-urbana')).toBe('moda-urbana')
    expect(detectTenantSlug('/t/moda-urbana/producto/ABC123')).toBe('moda-urbana')
    expect(detectTenantSlug('/t/Moda-Urbana/admin')).toBe('moda-urbana')
    expect(detectTenantSlug('/')).toBeNull()
    expect(detectTenantSlug('/category/running')).toBeNull()
    expect(detectTenantSlug('/t/a')).toBeNull()
    expect(detectTenantSlug('/t/../admin')).toBeNull()
    expect(detectTenantSlug('/t/mal--slug')).toBeNull()
  })

  it('builds links and headers for a store without leaking the primary store', () => {
    expect(tenantPath('moda-urbana', '/admin')).toBe('/t/moda-urbana/admin')
    expect(tenantPath(null, '/admin')).toBe('/admin')
    expect(tenantHeaders('moda-urbana')).toEqual({ 'X-Store-Slug': 'moda-urbana' })
    expect(tenantHeaders(null)).toEqual({})
  })

  it('keeps carts and sessions of different stores in separate storage keys', () => {
    expect(storeStorageKeyFor('moda-urbana', 'cart')).toBe('catalogo-lite:t:moda-urbana:cart')
    expect(storeStorageKeyFor('pixel', 'cart')).not.toBe(storeStorageKeyFor('moda-urbana', 'cart'))
    expect(storeStorageKeyFor(null, 'cart')).toBe('cart')
  })
})
