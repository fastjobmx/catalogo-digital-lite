import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEMO_CATEGORIES, DEMO_PRODUCTS } from './demoCatalog'

const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../public')

describe('catálogo demo SneakerHub', () => {
  it('conserva los 18 productos activos esperados sin SKU duplicados', () => {
    expect(DEMO_PRODUCTS).toHaveLength(18)
    expect(DEMO_PRODUCTS.every((product) => product.isActive !== false)).toBe(true)
    expect(new Set(DEMO_PRODUCTS.map((product) => product.sku)).size).toBe(18)
    expect(DEMO_CATEGORIES).toHaveLength(5)
  })

  it('resuelve cada fotografía principal a JPEG original y WebP ligero', () => {
    for (const product of DEMO_PRODUCTS) {
      expect(product.imageUrls.length, `${product.sku} no tiene foto`).toBeGreaterThan(0)
      for (const url of product.imageUrls) {
        expect(url, `${product.sku}: ${url}`).toMatch(/^\/seed-images\/sneakerhub\/.+\.jpg$/)
        const file = resolve(publicDir, url.slice(1))
        expect(existsSync(file), `${product.sku}: falta ${file}`).toBe(true)
        const bytes = readFileSync(file)
        expect(bytes[0]).toBe(0xff)
        expect(bytes[1]).toBe(0xd8)
        expect(bytes.length).toBeGreaterThan(10_000)
        const webp = file.replace(/\.jpg$/i, '.webp')
        expect(existsSync(webp), `${product.sku}: falta variante WebP ${webp}`).toBe(true)
        const webpBytes = readFileSync(webp)
        expect(webpBytes.subarray(0, 4).toString()).toBe('RIFF')
        expect(webpBytes.subarray(8, 12).toString()).toBe('WEBP')
        expect(webpBytes.length).toBeLessThan(bytes.length)
      }
    }
  })
})
