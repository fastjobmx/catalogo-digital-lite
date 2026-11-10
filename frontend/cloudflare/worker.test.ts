import { describe, expect, it } from 'vitest'
// @ts-expect-error plain JavaScript Worker module
import worker, { buildJsonLd, buildMeta, canonicalOrigin, canonicalPath, canonicalRedirect, classifyPath, robotsTxt, sitemapIndexXml, urlsetXml } from './worker.js'

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

describe('search-engine signals', () => {
  it('uses the configured canonical origin only when it is a valid https origin', () => {
    expect(canonicalOrigin({ CANONICAL_ORIGIN: 'https://app.ejemplo.com/' }, ORIGIN)).toBe('https://app.ejemplo.com')
    expect(canonicalOrigin({ CANONICAL_ORIGIN: 'http://inseguro.com' }, ORIGIN)).toBe(ORIGIN)
    expect(canonicalOrigin({}, ORIGIN)).toBe(ORIGIN)
  })

  it('redirects to the canonical host only when enabled, never the API or non-GET requests', () => {
    const env = { CANONICAL_ORIGIN: 'https://app.ejemplo.com', REDIRECT_TO_CANONICAL: 'true' }
    expect(canonicalRedirect(env, new URL(`${ORIGIN}/t/luz-magica/producto/LM-5?utm_source=x`), 'GET')).toBe('https://app.ejemplo.com/t/luz-magica/producto/LM-5?utm_source=x')
    expect(canonicalRedirect(env, new URL(`${ORIGIN}/api/assets/a.jpg`), 'GET')).toBeNull()
    expect(canonicalRedirect(env, new URL(`${ORIGIN}/admin/login`), 'POST')).toBeNull()
    expect(canonicalRedirect(env, new URL('https://app.ejemplo.com/'), 'GET')).toBeNull()
    expect(canonicalRedirect({ CANONICAL_ORIGIN: 'https://app.ejemplo.com' }, new URL(`${ORIGIN}/`), 'GET')).toBeNull()
  })

  it('normalises canonical paths and marks search results noindex', () => {
    expect(canonicalPath('/t/luz-magica/')).toBe('/t/luz-magica')
    expect(canonicalPath('/t/luz-magica/product/LM-5')).toBe('/t/luz-magica/producto/LM-5')
    expect(canonicalPath('/')).toBe('/')
    expect(classifyPath('/t/luz-magica/search')).toMatchObject({ kind: 'search', slug: 'luz-magica' })
    expect(buildMeta('search', ORIGIN, `${ORIGIN}/t/luz-magica/search`, LUZ, null).robots).toBe('noindex, follow')
    expect(buildMeta('missing', ORIGIN, null, null, null)).toMatchObject({ robots: 'noindex, nofollow', title: 'Página no encontrada' })
  })

  it('builds JSON-LD from real data only: no ratings, offers only with price and currency', () => {
    const store = buildJsonLd(ORIGIN, `${ORIGIN}/t/luz-magica`, `${ORIGIN}/t/luz-magica`, LUZ, null)
    expect(store).toMatchObject({ '@type': 'OnlineStore', name: 'Luz Mágica', logo: `${ORIGIN}/api/assets/stores/4/store/logo.jpg` })
    const withCurrency = { ...LUZ, currency: 'COP' }
    const product = { name: 'Tocador <Imperia>', sku: 'LM-005', price: 1050000, description: 'Tocador', imageUrls: ['/api/assets/x.webp'], variants: [{ stock: 2, isActive: true }] }
    const graph = buildJsonLd(ORIGIN, `${ORIGIN}/t/luz-magica`, `${ORIGIN}/t/luz-magica/producto/LM-005`, withCurrency, product)['@graph']
    expect(graph[1].offers).toMatchObject({ price: '1050000', priceCurrency: 'COP', availability: 'https://schema.org/InStock' })
    expect(graph[2]['@type']).toBe('BreadcrumbList')
    expect(JSON.stringify(graph)).not.toMatch(/aggregateRating|review/i)
    const noStock = buildJsonLd(ORIGIN, 's', 'p', withCurrency, { ...product, variants: [{ stock: 0 }] })['@graph'][1]
    expect(noStock.offers.availability).toBeUndefined()
    expect(buildJsonLd(ORIGIN, 's', 'p', LUZ, product)['@graph'][1].offers).toBeUndefined()
    expect(buildJsonLd(ORIGIN, 's', 'p', withCurrency, { ...product, price: 0 })['@graph'][1].offers).toBeUndefined()
  })

  it('writes robots.txt and sitemaps with escaped absolute URLs', () => {
    expect(robotsTxt('https://app.ejemplo.com')).toContain('Sitemap: https://app.ejemplo.com/sitemap.xml')
    expect(robotsTxt(ORIGIN)).toContain('Disallow: /api/')
    const index = sitemapIndexXml('https://app.ejemplo.com', [{ slug: 'luz-magica', lastmod: '2026-11-01' }])
    expect(index).toContain('<loc>https://app.ejemplo.com/sitemaps/tiendas.xml</loc>')
    expect(index).toContain('<loc>https://app.ejemplo.com/sitemaps/productos/luz-magica.xml</loc><lastmod>2026-11-01</lastmod>')
    expect(urlsetXml('https://a.co', [{ path: '/t/x/producto/A&B', lastmod: null }])).toContain('<loc>https://a.co/t/x/producto/A&amp;B</loc>')
  })
})

describe('page responses', () => {
  const html = '<!doctype html><html><head><title>x</title><meta name="description" content="x" /><link rel="icon" href="/f.png" /></head><body></body></html>'
  const assets = { fetch: async () => new Response(html, { headers: { 'content-type': 'text/html' } }) }
  const api = (routes: Record<string, [number, unknown]>) => ({
    fetch: async (request: Request) => {
      const url = new URL(request.url)
      const key = `${request.headers.get('X-Store-Slug') || ''}${url.pathname}`
      const [status, body] = routes[key] || [404, { error: 'nf' }]
      return new Response(JSON.stringify(body), { status })
    },
  })
  const hasRewriter = typeof (globalThis as any).HTMLRewriter !== 'undefined'

  it('serves robots.txt and the sitemap index from the API data', async () => {
    const env = { ASSETS: assets, API: api({ '/api/seo/stores': [200, { items: [{ slug: 'luz-magica', path: '/t/luz-magica', lastmod: null }] }] }), CANONICAL_ORIGIN: 'https://app.ejemplo.com' }
    const robots = await worker.fetch(new Request(`${ORIGIN}/robots.txt`), env)
    expect(robots.headers.get('content-type')).toContain('text/plain')
    expect(await robots.text()).toContain('Sitemap: https://app.ejemplo.com/sitemap.xml')
    const index = await worker.fetch(new Request(`${ORIGIN}/sitemap.xml`), env)
    expect(index.headers.get('content-type')).toContain('xml')
    expect(await index.text()).toContain('/sitemaps/productos/luz-magica.xml')
    const stores = await (await worker.fetch(new Request(`${ORIGIN}/sitemaps/tiendas.xml`), env)).text()
    expect(stores).toContain('<loc>https://app.ejemplo.com/t/luz-magica</loc>')
    expect((await worker.fetch(new Request(`${ORIGIN}/sitemaps/productos/no-existe.xml`), env)).status).toBe(404)
    expect((await worker.fetch(new Request(`${ORIGIN}/sitemap.xml`), { ASSETS: assets })).status).toBe(503)
  })

  it.runIf(hasRewriter)('answers 404 for a store that does not exist', async () => {
    const response = await worker.fetch(new Request(`${ORIGIN}/t/no-existe`), { ASSETS: assets, API: api({}) })
    expect(response.status).toBe(404)
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow')
  })
})
