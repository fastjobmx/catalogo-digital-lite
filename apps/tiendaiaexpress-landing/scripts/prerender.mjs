// Injects the server-rendered page into dist/index.html (fast first paint, crawlable content)
// and writes dist/404.html. Run by `npm run build` after the client and SSR builds.
import { readFile, writeFile, rm } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

const dist = resolve('dist')
const { render } = await import(pathToFileURL(resolve('dist-ssr/entry-server.js')).href)
const template = await readFile(resolve(dist, 'index.html'), 'utf8')
if (!template.includes('<!--app-html-->')) throw new Error('placeholder <!--app-html--> not found')
// Function replacer: the page contains prices with "$", which a string replacement would interpret.
const appHtml = render()
const html = template.replace('<!--app-html-->', () => appHtml)
await writeFile(resolve(dist, 'index.html'), html)

const notFound = template
  .replace(/<title>[^<]*<\/title>/, '<title>Página no encontrada · TiendIA Exprés</title>')
  .replace(/<meta name="robots" content="[^"]*" \/>/, '<meta name="robots" content="noindex, nofollow" />')
  .replace(/<link rel="canonical"[^>]*>\s*/, '')
  .replace(/<script type="module"[^>]*><\/script>/, '')
  .replace('<div id="root"><!--app-html--></div>', `<main style="min-height:100svh;display:grid;place-items:center;padding:2rem;font-family:system-ui,sans-serif;background:#0b0b13;color:#fafafd;text-align:center"><div><p style="font-size:4rem;font-weight:800;margin:0">404</p><p style="font-size:1.25rem">Esta página no existe.</p><p><a href="/" style="display:inline-block;margin-top:1rem;padding:.9rem 1.6rem;border-radius:999px;background:#d9ff14;color:#0b0b13;font-weight:700;text-decoration:none">Volver al inicio</a></p></div></main>`)
await writeFile(resolve(dist, '404.html'), notFound)
await rm(resolve('dist-ssr'), { recursive: true, force: true })
console.log('prerender ok:', Math.round(html.length / 1024), 'KB index.html')
