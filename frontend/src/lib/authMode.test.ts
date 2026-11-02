import { describe, expect, it } from 'vitest'
import { isOfflineDemoAuthEnabled } from './authMode'

describe('offline demo authentication', () => {
  it('is disabled by default and in production', () => {
    expect(isOfflineDemoAuthEnabled(true, undefined)).toBe(false)
    expect(isOfflineDemoAuthEnabled(true, 'false')).toBe(false)
    expect(isOfflineDemoAuthEnabled(false, 'true')).toBe(false)
  })

  it('requires an explicit development flag', () => {
    expect(isOfflineDemoAuthEnabled(true, 'true')).toBe(true)
  })
})
