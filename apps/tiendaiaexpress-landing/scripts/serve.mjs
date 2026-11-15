// Local static server that behaves like Cloudflare Workers Static Assets for measurement:
// brotli/gzip compression, the headers from dist/_headers, and 404.html for unknown paths.
// Usage: node scripts/serve.mjs [port]   (default 4318)
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { brotliCompressSync, gzipSync, constants } from 'node:zlib'
import { extname, join, normalize, resolve } from 'node:path'

const root = resolve('dist')
const port = Number(process.argv[2] || 4318)
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.svg': 'image/svg+xml' }
const compressible = new Set(['.html', '.js', '.css', '.json', '.txt', '.xml', '.svg'])

function parseHeaders(text) {
  const rules = []
  let current = null
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    if (!line.startsWith(' ')) { current = { pattern: line.trim(), headers: {} }; rules.push(current); continue }
    const i = line.indexOf(':')
    current.headers[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return rules
}
const rules = parseHeaders(await readFile(join(root, '_headers'), 'utf8').catch(() => ''))
const match = (pattern, path) => new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`).test(path)

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  let path = normalize(decodeURIComponent(url.pathname)).replace(/\\/g, '/')
  if (path.endsWith('/')) path += 'index.html'
  let file = join(root, path)
  let status = 200
  // Like Cloudflare Pages: "/terminos-y-condiciones" serves terminos-y-condiciones.html.
  if (!extname(path) && (await stat(`${file}.html`).then((s) => s.isFile()).catch(() => false))) file = `${file}.html`
  if (!file.startsWith(root) || !(await stat(file).then((s) => s.isFile()).catch(() => false))) { file = join(root, '404.html'); status = 404 }
  let body = await readFile(file)
  const ext = extname(file)
  const headers = { 'Content-Type': types[ext] || 'application/octet-stream', Vary: 'Accept-Encoding' }
  for (const rule of rules) if (match(rule.pattern, url.pathname)) Object.assign(headers, rule.headers)
  delete headers['Strict-Transport-Security']
  delete headers['Content-Security-Policy'] // upgrade-insecure-requests would break plain http locally
  const accept = req.headers['accept-encoding'] || ''
  if (compressible.has(ext)) {
    if (accept.includes('br')) { body = brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } }); headers['Content-Encoding'] = 'br' }
    else if (accept.includes('gzip')) { body = gzipSync(body); headers['Content-Encoding'] = 'gzip' }
  }
  res.writeHead(status, headers)
  res.end(body)
}).listen(port, () => console.log(`serving dist on http://localhost:${port}`))
