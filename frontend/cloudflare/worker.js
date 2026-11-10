// Frontend Worker of the Tienda IA Express platform (Workers Static Assets; technical name catalogo-digital-ia).
// - /api/* is forwarded to the backend Worker through a service binding.
// - HTML pages get the right metadata before any JavaScript runs, so links shared on WhatsApp,
//   Facebook or search engines show the correct identity:
//     · each public catalogue keeps its own name, description, logo and images;
//     · private screens (panel, platform, trial) show Tienda IA Express and are noindex.
// - Stores or products that do not exist answer HTTP 404 (noindex), never a "soft 404".
// - /robots.txt, /sitemap.xml and /sitemaps/* are generated from the public catalogue data.
// - Optional canonical host (vars CANONICAL_ORIGIN + REDIRECT_TO_CANONICAL): when set, canonical URLs use it
//   and, if redirection is enabled, other hostnames answer 301 to it (API calls are never redirected).
// Static files (JS, CSS, images, fonts) are served directly from the asset storage.

const PLATFORM = {
  name: 'Tienda IA Express',
  title: 'Tienda IA Express | Acceso al panel administrativo',
  description: 'Accede al panel de administración de tu tienda digital en Tienda IA Express.',
  trialTitle: 'Tienda IA Express | Prueba tu catálogo sin registro',
  trialDescription: 'Vista previa temporal de tu catálogo. No está publicada.',
  notFoundTitle: 'Página no encontrada',
  notFoundDescription: 'Esta tienda o este producto no existe o ya no está disponible.',
  image: '/brand/tiendaiaexpress/og.png',
  favicon: '/brand/tiendaiaexpress/favicon-32.png',
}
const NOINDEX = 'noindex, nofollow'

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const clip = (value, max) => { const text = String(value || '').replace(/\s+/g, ' ').trim(); return text.length > max ? `${text.slice(0, max - 1)}…` : text }

/** Canonical origin: the configured one (e.g. https://app.example.com) or the request's own origin. */
export function canonicalOrigin(env, requestOrigin) {
  const configured = String(env?.CANONICAL_ORIGIN || '').trim().replace(/\/+$/, '')
  return /^https:\/\/[a-z0-9.-]+$/i.test(configured) ? configured : requestOrigin
}

/** 301 target when the request reached a non-canonical host (only if explicitly enabled). Null = serve normally. */
export function canonicalRedirect(env, url, method) {
  if (String(env?.REDIRECT_TO_CANONICAL || '') !== 'true') return null
  const origin = canonicalOrigin(env, url.origin)
  if (origin === url.origin || (method !== 'GET' && method !== 'HEAD')) return null
  // The API keeps answering on every host: old clients, Telegram buttons and image URLs stay valid.
  if (url.pathname.startsWith('/api/')) return null
  return `${origin}${url.pathname}${url.search}`
}

/** Splits /t/<slug>/rest and recognises the private areas. */
export function classifyPath(pathname) {
  const tenant = pathname.match(/^\/t\/([a-z0-9][a-z0-9-]{1,39})(\/.*)?$/)
  const slug = tenant ? tenant[1] : null
  const rest = tenant ? (tenant[2] || '/') : pathname
  if (/^\/(admin|plataforma)(\/|$)/.test(rest)) return { kind: 'private', slug, rest }
  if (/^\/prueba(\/|$)/.test(rest)) return { kind: 'trial', slug, rest }
  // Internal search results are useful to visitors but not to search engines.
  if (/^\/search(\/|$)/.test(rest)) return { kind: 'search', slug, rest }
  const product = rest.match(/^\/(?:product|producto)\/([^/?#]+)/)
  let sku = null
  if (product) { try { sku = decodeURIComponent(product[1]) } catch { sku = product[1] } }
  return { kind: 'store', slug, rest, sku }
}

/** Canonical path: one spelling per page (/producto/, no trailing slash except the root). */
export function canonicalPath(pathname) {
  const normalized = pathname.replace(/\/product\//, '/producto/').replace(/\/+$/, '')
  return normalized || '/'
}

/** Calls the backend; status 0 means it could not be reached (never treated as "not found"). */
async function apiJson(env, origin, path, slug) {
  if (!env.API) return { status: 0, body: null }
  try {
    const response = await env.API.fetch(new Request(origin + path, { headers: slug ? { 'X-Store-Slug': slug } : {} }))
    return { status: response.status, body: response.ok ? await response.json() : null }
  } catch { return { status: 0, body: null } }
}

/** Metadata for one page (pure data, tested separately). */
export function buildMeta(kind, origin, url, store, product) {
  const abs = (path) => (!path ? null : /^https:\/\//.test(path) ? path : origin + (path.startsWith('/') ? path : `/${path}`))
  if (kind === 'missing') {
    return { title: PLATFORM.notFoundTitle, description: PLATFORM.notFoundDescription, siteName: store ? clip(store.name, 80) : PLATFORM.name, image: null, favicon: null, url: null, robots: NOINDEX, type: 'website' }
  }
  if (kind === 'private' || kind === 'trial' || !store) {
    return {
      title: kind === 'trial' ? PLATFORM.trialTitle : PLATFORM.title,
      description: kind === 'trial' ? PLATFORM.trialDescription : PLATFORM.description,
      siteName: PLATFORM.name, image: abs(PLATFORM.image), favicon: PLATFORM.favicon, url, robots: NOINDEX, type: 'website',
    }
  }
  const storeName = clip(store.name, 80) || 'Tienda'
  const storeDescription = clip(store.description || store.slogan || store.themeConfig?.hero?.subtitle || `Catálogo de ${storeName}`, 200)
  const storeImage = abs(store.coverImageUrl || store.themeConfig?.hero?.imageUrl || store.logoUrl)
  if (product) {
    const price = Number(product.price) > 0 ? ` · $ ${Number(product.price).toLocaleString('es-CO')}` : ''
    return {
      title: `${clip(product.name, 90)} | ${storeName}`,
      description: clip(`${product.description || product.name}${price}`, 200),
      siteName: storeName, image: abs((product.imageUrls || [])[0]) || storeImage, favicon: store.faviconUrl || store.logoUrl || null, url, robots: null, type: 'product',
    }
  }
  const robots = kind === 'search' ? 'noindex, follow' : null
  return { title: kind === 'search' ? `Buscar | ${storeName}` : storeName, description: storeDescription, siteName: storeName, image: storeImage, favicon: store.faviconUrl || store.logoUrl || null, url, robots, type: 'website' }
}

/**
 * Structured data (schema.org JSON-LD) built only from what the page shows: no ratings, reviews or
 * invented values. Offers appear only with a real price and currency; availability only when stock is known.
 */
export function buildJsonLd(origin, storeUrl, pageUrl, store, product) {
  if (!store) return null
  const abs = (path) => (!path ? undefined : /^https:\/\//.test(path) ? path : origin + (path.startsWith('/') ? path : `/${path}`))
  const storeName = clip(store.name, 80) || 'Tienda'
  const storeNode = {
    '@type': 'OnlineStore', '@id': `${storeUrl}#tienda`, name: storeName, url: storeUrl,
    description: clip(store.description || store.slogan, 300) || undefined,
    logo: abs(store.logoUrl), image: abs(store.coverImageUrl || store.logoUrl),
  }
  if (!product) return { '@context': 'https://schema.org', ...storeNode }
  const images = (product.imageUrls || []).map(abs).filter(Boolean).slice(0, 10)
  const node = {
    '@type': 'Product', name: clip(product.name, 150), description: clip(product.description, 500) || undefined,
    sku: product.sku || undefined, image: images.length ? images : undefined,
    brand: product.brand ? { '@type': 'Brand', name: clip(product.brand, 80) } : undefined,
    url: pageUrl,
  }
  const price = Number(product.price)
  const currency = /^[A-Z]{3}$/.test(String(store.currency || '')) ? store.currency : null
  if (price > 0 && currency) {
    const variants = Array.isArray(product.variants) ? product.variants.filter((variant) => variant && variant.isActive !== false) : []
    const inStock = variants.some((variant) => Number(variant.stock) > 0)
    node.offers = {
      '@type': 'Offer', price: String(price), priceCurrency: currency, url: pageUrl,
      availability: inStock ? 'https://schema.org/InStock' : undefined,
      seller: { '@id': `${storeUrl}#tienda` },
    }
  }
  const breadcrumb = {
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: storeName, item: storeUrl },
      { '@type': 'ListItem', position: 2, name: clip(product.name, 150), item: pageUrl },
    ],
  }
  return { '@context': 'https://schema.org', '@graph': [storeNode, node, breadcrumb] }
}

/** JSON inside <script>: "<" is escaped so the content can never close the tag. */
const jsonLdTag = (data) => `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`

function headTags(meta, jsonLd) {
  const tags = [
    ['property', 'og:type', meta.type], ['property', 'og:site_name', meta.siteName], ['property', 'og:title', meta.title],
    ['property', 'og:description', meta.description], ['property', 'og:locale', 'es_CO'],
    ['name', 'twitter:card', meta.image ? 'summary_large_image' : 'summary'], ['name', 'twitter:title', meta.title], ['name', 'twitter:description', meta.description],
  ]
  if (meta.url) tags.push(['property', 'og:url', meta.url])
  if (meta.image) tags.push(['property', 'og:image', meta.image], ['name', 'twitter:image', meta.image])
  if (meta.robots) tags.push(['name', 'robots', meta.robots])
  const out = tags.map(([attr, key, value]) => `<meta ${attr}="${key}" content="${escapeHtml(value)}" />`)
  // Canonical only on indexable pages, pointing at the canonical host.
  if (!meta.robots && meta.url) out.push(`<link rel="canonical" href="${escapeHtml(meta.url)}" />`)
  if (jsonLd && !meta.robots) out.push(jsonLdTag(jsonLd))
  return out.join('\n    ')
}

async function withMeta(request, response, env) {
  const url = new URL(request.url)
  const origin = canonicalOrigin(env, url.origin)
  const page = classifyPath(url.pathname)
  let store = null
  let product = null
  let missing = false
  if (page.kind === 'store' || page.kind === 'search') {
    const storeResult = await apiJson(env, url.origin, '/api/store', page.slug)
    store = storeResult.body
    // Only an explicit 404 from the API means "does not exist"; an unreachable API keeps the normal page.
    if (storeResult.status === 404) missing = true
    if (store && page.sku) {
      const productResult = await apiJson(env, url.origin, `/api/products/${encodeURIComponent(page.sku)}`, page.slug)
      product = productResult.body
      if (productResult.status === 404) missing = true
    }
  }
  const pageUrl = `${origin}${canonicalPath(url.pathname)}`
  const storePath = page.slug ? `/t/${page.slug}` : '/'
  const meta = buildMeta(missing ? 'missing' : page.kind, origin, pageUrl, store, product)
  const jsonLd = !missing && page.kind === 'store' && store ? buildJsonLd(origin, `${origin}${storePath}`, pageUrl, store, product) : null
  const headers = new Headers(response.headers)
  if (meta.robots) headers.set('X-Robots-Tag', meta.robots)
  // A draft store answers 404 to visitors; its team still sees the private preview (the app checks the session).
  if (missing) headers.set('Cache-Control', 'no-store')
  return new HTMLRewriter()
    .on('title', { element(el) { el.setInnerContent(meta.title) } })
    .on('meta[name="description"]', { element(el) { el.setAttribute('content', meta.description) } })
    .on('link[rel="icon"]', { element(el) { if (meta.favicon) el.setAttribute('href', meta.favicon) } })
    .on('head', { element(el) { el.append(`\n    ${headTags(meta, jsonLd)}\n  `, { html: true }) } })
    .transform(new Response(response.body, { status: missing ? 404 : response.status, statusText: missing ? 'Not Found' : response.statusText, headers }))
}

// ---- robots.txt and sitemaps -------------------------------------------------------------------

/** robots.txt: private pages are excluded with noindex (meta + header), so they stay crawlable to read it. */
export function robotsTxt(origin) {
  return [
    'User-agent: *',
    'Allow: /',
    'Allow: /api/assets/',
    'Disallow: /api/',
    '',
    `Sitemap: ${origin}/sitemap.xml`,
    '',
  ].join('\n')
}

const xmlEscape = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]))

export function urlsetXml(origin, items) {
  const urls = items.map((item) => `  <url><loc>${xmlEscape(origin + item.path)}</loc>${item.lastmod ? `<lastmod>${xmlEscape(item.lastmod)}</lastmod>` : ''}</url>`)
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`
}

/** Sitemap index: one file for the stores and one per store for its products (scales to thousands of stores). */
export function sitemapIndexXml(origin, stores) {
  const entries = [`  <sitemap><loc>${xmlEscape(`${origin}/sitemaps/tiendas.xml`)}</loc></sitemap>`]
  for (const store of stores) {
    entries.push(`  <sitemap><loc>${xmlEscape(`${origin}/sitemaps/productos/${store.slug}.xml`)}</loc>${store.lastmod ? `<lastmod>${xmlEscape(store.lastmod)}</lastmod>` : ''}</sitemap>`)
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join('\n')}\n</sitemapindex>\n`
}

const textResponse = (body, type, status = 200) => new Response(body, { status, headers: { 'Content-Type': type, 'Cache-Control': status === 200 ? 'public, max-age=3600' : 'no-store' } })
const XML = 'application/xml; charset=utf-8'

async function seoFile(url, env) {
  const origin = canonicalOrigin(env, url.origin)
  if (url.pathname === '/robots.txt') return textResponse(robotsTxt(origin), 'text/plain; charset=utf-8')
  if (url.pathname === '/sitemap.xml') {
    const { status, body } = await apiJson(env, url.origin, '/api/seo/stores', null)
    if (status !== 200 || !body) return textResponse('Sitemap temporarily unavailable', 'text/plain; charset=utf-8', 503)
    return textResponse(sitemapIndexXml(origin, body.items || []), XML)
  }
  if (url.pathname === '/sitemaps/tiendas.xml') {
    const { status, body } = await apiJson(env, url.origin, '/api/seo/stores', null)
    if (status !== 200 || !body) return textResponse('Sitemap temporarily unavailable', 'text/plain; charset=utf-8', 503)
    return textResponse(urlsetXml(origin, body.items || []), XML)
  }
  const products = url.pathname.match(/^\/sitemaps\/productos\/([a-z0-9][a-z0-9-]{1,39})\.xml$/)
  if (products) {
    const { status, body } = await apiJson(env, url.origin, `/api/seo/stores/${products[1]}/products`, null)
    if (status === 404) return textResponse('Not found', 'text/plain; charset=utf-8', 404)
    if (status !== 200 || !body) return textResponse('Sitemap temporarily unavailable', 'text/plain; charset=utf-8', 503)
    return textResponse(urlsetXml(origin, body.items || []), XML)
  }
  if (url.pathname.startsWith('/sitemaps/')) return textResponse('Not found', 'text/plain; charset=utf-8', 404)
  return null
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const redirect = canonicalRedirect(env, url, request.method)
    if (redirect) return Response.redirect(redirect, 301)
    if (url.pathname.startsWith('/api/')) {
      if (!env.API) return new Response('API binding not configured', { status: 503 })
      return env.API.fetch(request)
    }
    if (request.method === 'GET' || request.method === 'HEAD') {
      const file = await seoFile(url, env)
      if (file) return file
    }
    const response = await env.ASSETS.fetch(request)
    const isHtml = (response.headers.get('content-type') || '').includes('text/html')
    if ((request.method !== 'GET' && request.method !== 'HEAD') || !isHtml) return response
    return withMeta(request, response, env)
  },
}
