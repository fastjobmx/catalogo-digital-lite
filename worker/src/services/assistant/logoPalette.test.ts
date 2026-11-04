import { describe, expect, it } from 'vitest'
import { createPng } from '../../../test/sqliteD1'
import { palettesFromPng } from './logoPalette'

describe('logo palette extraction', () => {
  it('extracts three deterministic, accessible palettes from a PNG', async () => {
    const bytes = createPng(320, 240, [21, 61, 112])
    const first = await palettesFromPng(bytes)
    const second = await palettesFromPng(bytes)

    expect(first).toHaveLength(3)
    expect(first).toEqual(second)
    expect(first?.map((palette) => palette.id)).toEqual(['faithful', 'balanced', 'vibrant'])
    expect(first?.every((palette) => palette.palette.primary !== '#FFFFFF' && palette.palette.buttonText === '#FFFFFF')).toBe(true)
    expect(first?.[0]?.palette.primary).toMatch(/^#[0-9A-F]{6}$/)
  })

  it('uses a neutral fallback for monochrome artwork and rejects unsupported decodes', async () => {
    const monochrome = await palettesFromPng(createPng(160, 160, [28, 28, 28]))
    expect(monochrome).toHaveLength(3)
    expect(monochrome?.[0]?.palette.primary).toBe('#30343B')
    expect(await palettesFromPng(new Uint8Array([1, 2, 3, 4]))).toBeNull()
  })
})
