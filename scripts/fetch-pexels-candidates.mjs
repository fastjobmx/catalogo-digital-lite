// Descarga miniaturas de candidatas de Pexels para elegir fotografías de producto.
// Uso: node scripts/fetch-pexels-candidates.mjs
import fs from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const QUERIES = [
  'shoe white background',
  'sneaker product',
  'running shoe',
  'basketball shoe',
  'boots white background',
  'backpack white background',
  'cap white background',
  'bag white background',
  'bottle white background',
  'socks white background',
]

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
const OUT = path.resolve('.tmp/candidates')
await fs.mkdir(OUT, { recursive: true })

for (const q of QUERIES) {
  const dir = path.join(OUT, q.replace(/[^a-z0-9]+/gi, '-').toLowerCase())
  await fs.mkdir(dir, { recursive: true })
  const html = execFileSync('curl.exe', ['-sSL', '-A', UA, '--max-time', '45', `https://www.pexels.com/search/${encodeURIComponent(q)}/`], { maxBuffer: 40 * 1024 * 1024 }).toString('utf8')
  const ids = [...new Set([...html.matchAll(/images\.pexels\.com\/photos\/(\d+)\//g)].map((m) => m[1]))].slice(0, 12)
  for (const id of ids) {
    const dest = path.join(dir, `${id}.jpg`)
    try {
      await fs.access(dest)
    } catch {
      execFileSync('curl.exe', ['-sSL', '-A', UA, '--max-time', '60', '-o', dest,
        `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=600`], { maxBuffer: 1024 * 1024 })
    }
  }
  console.log(q, ids.join(','))
}
