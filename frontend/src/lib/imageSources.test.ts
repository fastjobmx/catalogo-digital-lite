import { afterEach, describe, expect, it, vi } from 'vitest'
import { isImageDecoded, localWebpSource, resolveImageUrl, shouldFallbackToOriginal } from './imageSources'

describe('resolución de fotografías de producto', () => {
  afterEach(() => vi.unstubAllEnvs())
  it('convierte rutas locales relativas a rutas del sitio, sin depender de la ruta SKU', () => {
    expect(resolveImageUrl('seed-images/sneakerhub/KINETIK-06.jpg')).toBe('/seed-images/sneakerhub/KINETIK-06.jpg')
    expect(resolveImageUrl('/api/assets/products/kinetik-06.webp')).toBe('/api/assets/products/kinetik-06.webp')
  })

  it('acepta HTTPS y evita URL inseguras, traversal y valores vacíos', () => {
    expect(resolveImageUrl('https://cdn.example.com/shoe.jpg')).toBe('https://cdn.example.com/shoe.jpg')
    expect(resolveImageUrl('http://cdn.example.com/shoe.jpg')).toBeNull()
    expect(resolveImageUrl('../shoe.jpg')).toBeNull()
    expect(resolveImageUrl('  ')).toBeNull()
    expect(resolveImageUrl(null)).toBeNull()
  })

  it('resuelve los assets del Worker en el origen API configurado para una vista previa separada', () => {
    vi.stubEnv('VITE_API_URL', 'https://sneakerhub-staging.example.workers.dev')
    expect(resolveImageUrl('/api/assets/products/telegram/demo/1.png'))
      .toBe('https://sneakerhub-staging.example.workers.dev/api/assets/products/telegram/demo/1.png')
  })

  it('elige WebP solo para JPEG locales y conserva query/hash', () => {
    expect(localWebpSource('/seed-images/sneakerhub/KINETIK-06.jpg?v=2')).toBe('/seed-images/sneakerhub/KINETIK-06.webp?v=2')
    expect(localWebpSource('https://cdn.example.com/shoe.jpg')).toBeNull()
  })

  it('reintenta el JPEG original una sola vez si falla el WebP seleccionado', () => {
    const webp = '/seed-images/sneakerhub/ASTRAL-03.webp'
    expect(shouldFallbackToOriginal(`http://localhost:5173${webp}`, webp, true)).toBe(true)
    expect(shouldFallbackToOriginal('/seed-images/sneakerhub/ASTRAL-03.jpg', webp, true)).toBe(false)
    expect(shouldFallbackToOriginal(webp, webp, false)).toBe(false)
    expect(shouldFallbackToOriginal(webp, null, true)).toBe(false)
  })

  it('reconoce una imagen ya decodificada aunque onLoad haya ocurrido antes del efecto', () => {
    expect(isImageDecoded({ complete: true, naturalWidth: 1400 })).toBe(true)
    expect(isImageDecoded({ complete: true, naturalWidth: 0 })).toBe(false)
    expect(isImageDecoded({ complete: false, naturalWidth: 1400 })).toBe(false)
    expect(isImageDecoded(null)).toBe(false)
  })
})
