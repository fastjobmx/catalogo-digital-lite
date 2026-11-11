import { describe, expect, it } from 'vitest'
import { autoLevels, measureQuality, outputFormat, planGeometry, suggestOperation } from './photoEdit'

const rgba = (width: number, height: number, fill: (x: number, y: number) => number) => {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const v = fill(x, y); data.set([v, v, v, 255], (y * width + x) * 4) }
  return data
}
const checker = (x: number, y: number) => (((x >> 2) + (y >> 2)) % 2 ? 230 : 40)

describe('edición convencional en el navegador', () => {
  it('recorta al centro, encuadra sin recortar y solo reduce (nunca amplía)', () => {
    expect(planGeometry('cuadrado', 2000, 1000)).toMatchObject({ canvas: [1000, 1000], source: [500, 0, 1000, 1000] })
    expect(planGeometry('cuadrado', 4000, 3000).canvas).toEqual([1080, 1080])
    expect(planGeometry('encuadre_blanco', 2000, 1000)).toMatchObject({ canvas: [1080, 1080], target: [0, 270, 1080, 540], background: '#FFFFFF' })
    expect(planGeometry('redimensionar', 3200, 1600).canvas).toEqual([1600, 800])
    expect(planGeometry('redimensionar', 800, 600).canvas).toEqual([800, 600])
    expect(planGeometry('auto_luz', 800, 600).canvas).toEqual([800, 600])
    expect(planGeometry('convertir_jpg', 500, 500).background).toBe('#FFFFFF')
  })

  it('elige el formato de salida de cada operación', () => {
    expect(outputFormat('comprimir', 'image/png').type).toBe('image/webp')
    expect(outputFormat('convertir_jpg', 'image/webp').type).toBe('image/jpeg')
    expect(outputFormat('cuadrado', 'image/png').type).toBe('image/png')
  })

  it('el ajuste de luz estira una foto apagada y deja quieta una que ya está bien', () => {
    const dull = rgba(20, 20, (x) => 80 + x * 3)
    autoLevels(dull)
    expect(dull[0]).toBeLessThan(10)
    expect(dull[19 * 4]).toBeGreaterThan(245)
    const fine = rgba(20, 20, (x) => Math.round(x * 13.4))
    const before = [...fine]
    autoLevels(fine)
    expect([...fine]).toEqual(before)
  })
})

describe('análisis de calidad', () => {
  it('detecta fotos oscuras, sin contraste, borrosas, pequeñas y no cuadradas', () => {
    const dark = measureQuality(rgba(64, 64, () => 30), 64, 64, { width: 600, height: 400 })
    expect(dark.issues.map((issue) => issue.code)).toEqual(['baja_resolucion', 'oscura', 'poco_contraste', 'borrosa', 'no_cuadrada'])
    expect(suggestOperation(dark)?.operation).toBe('auto_luz')
    const good = measureQuality(rgba(64, 64, checker), 64, 64, { width: 1200, height: 1200 })
    expect(good.issues).toEqual([])
    expect(suggestOperation(good)).toBeNull()
    const wide = measureQuality(rgba(64, 64, checker), 64, 64, { width: 1600, height: 900 })
    expect(suggestOperation(wide)?.operation).toBe('encuadre_blanco')
  })
})
