// Frontend Worker of the Tienda IA Express platform (Workers Static Assets; technical name catalogo-digital-ia).
// - /api/* is forwarded to the backend Worker through a service binding.
// - HTML pages get the right metadata before any JavaScript runs, so links shared on WhatsApp,
//   Facebook or search engines show the correct identity:
//     · each public catalogue keeps its own name, description, logo and images;
//     · private screens (panel, platform, trial) show Tienda IA Express and are noindex.
// Static files (JS, CSS, images, fonts) are served directly from the asset storage.

const PLATFORM = {
  name: 'Tienda IA Express',
  title: 'Tienda IA Express | Acceso al panel administrativo',
  description: 'Accede al panel de administración de tu tienda digital en Tienda IA Express.',
  trialTitle: 'Tienda IA Express | Prueba tu catálogo sin registro',
  trialDescription: 'Vista previa temporal de tu catálogo. No está publicada.',
  image: '/brand/tiendaiaexpress/og.png',
  favicon: '/brand/tiendaiaexpress/favicon-32.png',
}

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const clip = (value, max) => { const text = String(value || '').replace(/\s+/g, ' ').trim(); return text.length > max ? `${text.slice(0, max - 1)}…` : text }

/** Splits /t/<slug>/rest and recognises the private areas. */
export function classifyPath(pathname) {
  const tenant = pathname.match(/^\/t\/([a-z0-9][a-z0-9-]{1,39})(\/.*)?$/)
  const slug = tenant ? tenant[1] : null
  const rest = tenant ? (tenant[2] || '/') : pathname
  if (/^\/(admin|plataforma)(\/|$)/.test(rest)) return { kind: 'private', slug, rest }
  if (/^\/prueba(\/|$)/.test(rest)) return { kind: 'trial', slug, rest }
  const product = rest.match(/^\/(?:product|producto)\/([^/?#]+)/)
  return { kind: 'store', slug, rest, sku: product ? decodeURIComponent(product[1]) : null }
}

async function apiJson(env, origin, path, slug) {
  if (!env.API) return null
  try {
    const response = await env.API.fetch(new Request(origin + path, { headers: slug ? { 'X-Store-Slug': slug } : {} }))
    return response.ok ? await response.json() : null
  } catch { return null }
}

/** Metadata for one page (pure data, tested separately). */
export function buildMeta(kind, origin, url, store, product) {
  const abs = (path) => (!path ? null : /^https:\/\//.test(path) ? path : origin + (path.startsWith('/') ? path : `/${path}`))
  if (kind === 'private' || kind === 'trial' || !store) {
    return {
      title: kind === 'trial' ? PLATFORM.trialTitle : PLATFORM.title,
      description: kind === 'trial' ? PLATFORM.trialDescription : PLATFORM.description,
      siteName: PLATFORM.name, image: abs(PLATFORM.image), favicon: PLATFORM.favicon, url, robots: 'noindex, nofollow', type: 'website',
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
  return { title: storeName, description: storeDescription, siteName: storeName, image: storeImage, favicon: store.faviconUrl || store.logoUrl || null, url, robots: null, type: 'website' }
}

function headTags(meta) {
  const tags = [
    ['property', 'og:type', meta.type], ['property', 'og:site_name', meta.siteName], ['property', 'og:title', meta.title],
    ['property', 'og:description', meta.description], ['property', 'og:url', meta.url], ['property', 'og:locale', 'es_CO'],
    ['name', 'twitter:card', meta.image ? 'summary_large_image' : 'summary'], ['name', 'twitter:title', meta.title], ['name', 'twitter:description', meta.description],
  ]
  if (meta.image) tags.push(['property', 'og:image', meta.image], ['name', 'twitter:image', meta.image])
  if (meta.robots) tags.push(['name', 'robots', meta.robots])
  return tags.map(([attr, key, value]) => `<meta ${attr}="${key}" content="${escapeHtml(value)}" />`).join('\n    ')
}

async function withMeta(request, response, env) {
  const url = new URL(request.url)
  const page = classifyPath(url.pathname)
  let store = null
  let product = null
  if (page.kind === 'store') {
    store = await apiJson(env, url.origin, '/api/store', page.slug)
    if (store && page.sku) product = await apiJson(env, url.origin, `/api/products/${encodeURIComponent(page.sku)}`, page.slug)
  }
  const meta = buildMeta(page.kind, url.origin, `${url.origin}${url.pathname}`, store, product)
  const headers = new Headers(response.headers)
  if (meta.robots) headers.set('X-Robots-Tag', meta.robots)
  return new HTMLRewriter()
    .on('title', { element(el) { el.setInnerContent(meta.title) } })
    .on('meta[name="description"]', { element(el) { el.setAttribute('content', meta.description) } })
    .on('link[rel="icon"]', { element(el) { if (meta.favicon) el.setAttribute('href', meta.favicon) } })
    .on('head', { element(el) { el.append(`\n    ${headTags(meta)}\n  `, { html: true }) } })
    .transform(new Response(response.body, { status: response.status, statusText: response.statusText, headers }))
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/')) {
      if (!env.API) return new Response('API binding not configured', { status: 503 })
      return env.API.fetch(request)
    }
    const response = await env.ASSETS.fetch(request)
    const isHtml = (response.headers.get('content-type') || '').includes('text/html')
    if ((request.method !== 'GET' && request.method !== 'HEAD') || !isHtml) return response
    return withMeta(request, response, env)
  },
}
