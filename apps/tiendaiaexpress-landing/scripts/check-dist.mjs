// Pre-publish check of dist/: required files, indexing signals consistent, no secrets or
// references to the platform's private infrastructure.
import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

const dist = 'dist'
const problems = []
for (const f of ['index.html', '404.html', 'robots.txt', '_headers', 'og.png', 'favicon-32.png']) {
  if (!(await stat(join(dist, f)).catch(() => null))) problems.push(`missing ${f}`)
}
const html = await readFile(join(dist, 'index.html'), 'utf8')
const headers = await readFile(join(dist, '_headers'), 'utf8')
const robots = await readFile(join(dist, 'robots.txt'), 'utf8')
const noindex = html.includes('content="noindex, nofollow"')
// Only the block for every path (/*) applies to the canonical host; absolute https:// blocks are alternate hosts.
const mainBlock = headers.replace(/\r/g, '').split(/\n(?=\S)/).find((block) => block.startsWith('/*')) || ''
if (noindex !== mainBlock.includes('X-Robots-Tag: noindex')) problems.push('meta robots and X-Robots-Tag disagree')
if (noindex && (html.includes('rel="canonical"') || robots.includes('Sitemap'))) problems.push('noindex with canonical or sitemap')
// Prerendered = the page heading already has its text in the HTML (not only an empty root for the client).
if (!/<h1[^>]*>[\s\S]{1,4000}?<\/h1>/.test(html) || /<div id="root">\s*<\/div>/.test(html)) problems.push('index.html is not prerendered')
const files = []
const walk = async (dir) => { for (const e of await readdir(dir, { withFileTypes: true })) e.isDirectory() ? await walk(join(dir, e.name)) : files.push(join(dir, e.name)) }
await walk(dist)
for (const f of files.filter((f) => /\.(js|html|css|txt|json)$/.test(f))) {
  const text = await readFile(f, 'utf8')
  if (/catalogo-lite-api|TELEGRAM_BOT_TOKEN|GEMINI_API_KEY|JWT_SECRET|ADMIN_PASSWORD/.test(text)) problems.push(`suspicious reference in ${f}`)
}
const og = html.match(/property="og:image" content="([^"]+)"/)?.[1]
console.log(`${files.length} files · og:image ${og} · ${noindex ? 'noindex' : 'indexable'}`)
if (problems.length) { console.error(problems.join('\n')); process.exit(1) }
console.log('dist ok')
