import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/** Legal pages: one HTML file each at the root of dist/, served by Cloudflare Pages without ".html". */
const LEGAL_PAGES = ['terminos-y-condiciones', 'servicios-adicionales']

// Runs before first paint: picks the cinematic or the still layout without layout shift.
const MOTION_SCRIPT = "document.documentElement.classList.add(window.matchMedia('(prefers-reduced-motion: reduce)').matches?'still':'motion')"

/**
 * One switch (VITE_ALLOW_INDEXING) drives every indexing signal so they never contradict:
 *  - false: <meta robots noindex>, X-Robots-Tag noindex, robots.txt allows crawling (so the
 *           noindex can be read), no canonical, no sitemap.
 *  - true:  <meta robots index>, canonical + og:url = VITE_SITE_URL, sitemap.xml listed in robots.txt.
 */
function seo(siteUrl: string, allowIndexing: boolean, noindexHosts: string[]): Plugin {
  const scriptHash = createHash('sha256').update(MOTION_SCRIPT).digest('base64')
  const csp = [
    "default-src 'self'",
    // Cloudflare Web Analytics (injected by Pages): the beacon script and the endpoint it reports to.
    `script-src 'self' 'sha256-${scriptHash}' https://static.cloudflareinsights.com`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self' https://cloudflareinsights.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; ')
  return {
    name: 'mostralopues-seo',
    transformIndexHtml(html, ctx) {
      // Preload the two Latin variable fonts used above the fold (avoids layout shift on swap).
      const fonts = Object.keys(ctx.bundle ?? {}).filter((f) => /(plus-jakarta-sans|manrope)-latin-wght-normal.*\.woff2$/.test(f))
      const preload = fonts.map((f) => `<link rel="preload" href="/${f}" as="font" type="font/woff2" crossorigin />`).join('\n    ')
      html = html.replace('</title>', `</title>\n    ${preload}`)
      const robots = allowIndexing ? 'index, follow, max-image-preview:large' : 'noindex, nofollow'
      // Permanent URL of each page: "/" for the home page, "/terminos-y-condiciones" for terminos-y-condiciones.html.
      const file = ctx.path.replace(/^\//, '')
      const path = file === 'index.html' || file === '' ? '/' : `/${file.replace(/\.html$/, '')}`
      const canonical = allowIndexing ? `<link rel="canonical" href="${siteUrl}${path}" />\n    <meta property="og:url" content="${siteUrl}${path}" />` : ''
      return html
        .replace('%MOTION_SCRIPT%', MOTION_SCRIPT)
        .replace('%ROBOTS%', robots)
        .replace('%CANONICAL%', canonical)
        .replaceAll('%SITE_URL%', siteUrl)
    },
    generateBundle() {
      const robotsTxt = allowIndexing
        ? `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}/sitemap.xml\n`
        : 'User-agent: *\nAllow: /\n# Pre-launch: every page sends "noindex". Set VITE_ALLOW_INDEXING=true at the official launch.\n'
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: robotsTxt })
      if (allowIndexing) {
        const today = new Date().toISOString().slice(0, 10)
        this.emitFile({
          type: 'asset',
          fileName: 'sitemap.xml',
          source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${['/', ...LEGAL_PAGES.map((p) => `/${p}`)].map((u) => `  <url><loc>${siteUrl}${u}</loc><lastmod>${today}</lastmod></url>`).join('\n')}\n</urlset>\n`,
        })
      }
      const headers = [
        '/*',
        '  X-Content-Type-Options: nosniff',
        '  Referrer-Policy: strict-origin-when-cross-origin',
        '  X-Frame-Options: DENY',
        '  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()',
        '  Cross-Origin-Opener-Policy: same-origin',
        '  Strict-Transport-Security: max-age=31536000',
        `  Content-Security-Policy: ${csp}`,
        ...(allowIndexing ? [] : ['  X-Robots-Tag: noindex, nofollow']),
        '',
        '/assets/*',
        '  Cache-Control: public, max-age=31536000, immutable',
        '',
        // Alternate hostnames that serve the same files (www, *.pages.dev) are never indexed: only the canonical one.
        ...noindexHosts.flatMap((host) => [`https://${host}/*`, '  X-Robots-Tag: noindex, nofollow', '']),
      ].join('\n')
      this.emitFile({ type: 'asset', fileName: '_headers', source: headers })
    },
  }
}

export default defineConfig(({ mode, isSsrBuild }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const siteUrl = (env.VITE_SITE_URL || 'https://tiendaiaexpress.pages.dev').replace(/\/+$/, '')
  const allowIndexing = env.VITE_ALLOW_INDEXING === 'true'
  const noindexHosts = (env.VITE_NOINDEX_HOSTS || '').split(',').map((host) => host.trim().toLowerCase()).filter((host) => /^[a-z0-9.-]+$/.test(host))
  // Platform app (stores, panel, trial). Technical hostname until the official domain is verified.
  const appUrl = (env.VITE_APP_URL || 'https://catalogo-digital-ia.catalogo-lite-worker.workers.dev').replace(/\/+$/, '')
  return {
    plugins: [react(), tailwindcss(), ...(isSsrBuild ? [] : [seo(siteUrl, allowIndexing, noindexHosts)])],
    define: { __SITE_URL__: JSON.stringify(siteUrl), __APP_URL__: JSON.stringify(appUrl) },
    server: { port: 4317, strictPort: true },
    build: {
      target: 'es2022',
      // Fonts are never inlined as data: URIs (the CSP allows font-src 'self' only).
      assetsInlineLimit: (file: string, content: Buffer) => !/\.woff2?$/.test(file) && content.length < 2048,
      chunkSizeWarningLimit: 900,
      rollupOptions: isSsrBuild ? undefined : {
        input: Object.fromEntries([['index', resolve(__dirname, 'index.html')], ...LEGAL_PAGES.map((p) => [p, resolve(__dirname, `${p}.html`)])]),
      },
    },
  }
})
