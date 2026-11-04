import { createHash } from 'node:crypto'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Runs before first paint: picks the cinematic or the still layout without layout shift.
const MOTION_SCRIPT = "document.documentElement.classList.add(window.matchMedia('(prefers-reduced-motion: reduce)').matches?'still':'motion')"

/**
 * One switch (VITE_ALLOW_INDEXING) drives every indexing signal so they never contradict:
 *  - false: <meta robots noindex>, X-Robots-Tag noindex, robots.txt allows crawling (so the
 *           noindex can be read), no canonical, no sitemap.
 *  - true:  <meta robots index>, canonical + og:url = VITE_SITE_URL, sitemap.xml listed in robots.txt.
 */
function seo(siteUrl: string, allowIndexing: boolean): Plugin {
  const scriptHash = createHash('sha256').update(MOTION_SCRIPT).digest('base64')
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'sha256-${scriptHash}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
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
      const fonts = Object.keys(ctx.bundle ?? {}).filter((f) => /(space-grotesk|manrope)-latin-wght-normal.*\.woff2$/.test(f))
      const preload = fonts.map((f) => `<link rel="preload" href="/${f}" as="font" type="font/woff2" crossorigin />`).join('\n    ')
      html = html.replace('</title>', `</title>\n    ${preload}`)
      const robots = allowIndexing ? 'index, follow, max-image-preview:large' : 'noindex, nofollow'
      const canonical = allowIndexing ? `<link rel="canonical" href="${siteUrl}/" />\n    <meta property="og:url" content="${siteUrl}/" />` : ''
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
          source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${siteUrl}/</loc><lastmod>${today}</lastmod></url>\n</urlset>\n`,
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
      ].join('\n')
      this.emitFile({ type: 'asset', fileName: '_headers', source: headers })
    },
  }
}

export default defineConfig(({ mode, isSsrBuild }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const siteUrl = (env.VITE_SITE_URL || 'https://mostralopues.pages.dev').replace(/\/+$/, '')
  const allowIndexing = env.VITE_ALLOW_INDEXING === 'true'
  return {
    plugins: [react(), tailwindcss(), ...(isSsrBuild ? [] : [seo(siteUrl, allowIndexing)])],
    define: { __SITE_URL__: JSON.stringify(siteUrl) },
    server: { port: 4317, strictPort: true },
    build: {
      target: 'es2022',
      assetsInlineLimit: 2048,
      chunkSizeWarningLimit: 900,
    },
  }
})
