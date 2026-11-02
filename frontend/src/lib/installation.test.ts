import { afterEach, describe, expect, it, vi } from 'vitest'
import { isIndependentInstallation, storeStorageKey } from './installation'

afterEach(() => vi.unstubAllEnvs())

describe('installation scope', () => {
  it('preserves template keys when there is no store slug', () => {
    vi.stubEnv('VITE_STORE_SLUG', '')
    expect(storeStorageKey('catalogo-lite-cart')).toBe('catalogo-lite-cart')
  })

  it('scopes browser state and marks independent installations', () => {
    vi.stubEnv('VITE_STORE_SLUG', 'patitas-felices')
    vi.stubEnv('VITE_INDEPENDENT_INSTALLATION', 'true')
    expect(storeStorageKey('catalogo-lite-cart')).toBe('catalogo-lite:patitas-felices:catalogo-lite-cart')
    expect(isIndependentInstallation()).toBe(true)
  })
})
