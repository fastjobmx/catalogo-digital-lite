import { describe, expect, it } from 'vitest'
// @ts-expect-error plain JavaScript Worker module
import { buildMeta, classifyPath } from './worker.js'

const ORIGIN = 'https://catalogo-digital-ia.catalogo-lite-worker.workers.dev'
const LUZ = { name: 'Luz Mágica', description: 'Tocadores Hollywood y espejos.', logoUrl: '/api/assets/stores/4/store/logo.jpg', coverImageUrl: '/api/assets/stores/4/store/banner.jpg', faviconUrl: '/api/assets/stores/4/store/favicon.png' }

describe('share metadata', () => {
  it('recognises private, trial, store and product pages, with or without /t/<slug>', () => {
    expect(classifyPath('/admin/login')).toMatchObject({ kind: 'private', slug: null })
    expect(classifyPath('/t/luz-magica/admin/usuarios')).toMatchObject({ kind: 'private', slug: 'luz-magica' })
    expect(classifyPath('/plataforma/correos')).toMatchObject({ kind: 'private' })
    expect(classifyPath('/prueba/abc')).toMatchObject({ kind: 'trial' })
    expect(classifyPath('/t/luz-magica/')).toMatchObject({ kind: 'store', slug: 'luz-magica', sku: null })
    expect(classifyPath('/t/luz-magica/product/LM-005')).toMatchObject({ kind: 'store', slug: 'luz-magica', sku: 'LM-005' })
    expect(classifyPath('/')).toMatchObject({ kind: 'store', slug: null })
  })

  it('private and trial pages use the platform identity and are noindex', () => {
    const login = buildMeta('private', ORIGIN, `${ORIGIN}/t/luz-magica/admin/login`, LUZ, null)
    expect(login).toMatchObject({ title: 'Tienda IA Express | Acceso al panel administrativo', siteName: 'Tienda IA Express', robots: 'noindex, nofollow', image: `${ORIGIN}/brand/tiendaiaexpress/og.png` })
    expect(buildMeta('trial', ORIGIN, `${ORIGIN}/prueba`, null, null).robots).toBe('noindex, nofollow')
  })

  it('each catalogue keeps its own name, description and images; products use their own photo', () => {
    const store = buildMeta('store', ORIGIN, `${ORIGIN}/t/luz-magica/`, LUZ, null)
    expect(store).toMatchObject({ title: 'Luz Mágica', siteName: 'Luz Mágica', description: 'Tocadores Hollywood y espejos.', image: `${ORIGIN}/api/assets/stores/4/store/banner.jpg`, robots: null })
    expect(JSON.stringify(store)).not.toMatch(/Tienda IA Express|SneakerHub/)
    const product = buildMeta('store', ORIGIN, `${ORIGIN}/t/luz-magica/product/LM-005`, LUZ, { name: 'Tocador Imperia', price: 1050000, description: 'Tocador Hollywood', imageUrls: ['/api/assets/stores/4/products/luz-005-1.webp'] })
    expect(product.title).toBe('Tocador Imperia | Luz Mágica')
    expect(product.description).toContain('1.050.000')
    expect(product.image).toBe(`${ORIGIN}/api/assets/stores/4/products/luz-005-1.webp`)
    expect(buildMeta('store', ORIGIN, `${ORIGIN}/`, { name: 'SneakerHub Premium', description: 'Sneakers' }, null).title).toBe('SneakerHub Premium')
  })
})
