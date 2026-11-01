// Descarga recursos fotográficos libres (Pexels) para la demo SneakerHub.
// Uso: node scripts/fetch-demo-assets.mjs [--force]
//
// - Usa curl (incluido en Windows 10+) porque el CDN de Pexels exige un
//   cliente HTTP con huella de navegador real.
// - No sobrescribe archivos ya descargados salvo con --force.
// - Registra origen, autor y licencia en .tmp/assets-manifest.json
//   (documentado después en docs/ASSETS_DEMO.md).
import fs from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const OUT_DIR = path.resolve('frontend/public/seed-images/sneakerhub')
const MANIFEST = path.resolve('.tmp/assets-manifest.json')
const FORCE = process.argv.includes('--force')
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'

const TARGETS = [
  { file: 'LUMEN-07.jpg', query: 'running shoes', kind: 'product', product: 'LUMEN-07 Lumen Pace Lite' },
  { file: 'TERA-08.jpg', query: 'trail running shoes', kind: 'product', product: 'TERA-08 Tera Trail GTX' },
  { file: 'ORBE-09.jpg', query: 'basketball shoes', kind: 'product', product: 'ORBE-09 Orbe Dunk Pro' },
  { file: 'ORBE-10.jpg', query: 'basketball sneakers', kind: 'product', product: 'ORBE-10 Orbe Tempo Mid' },
  { file: 'CIMA-11.jpg', query: 'basketball', kind: 'product', product: 'CIMA-11 Cima Rise Court' },
  { file: 'RUTA-12.jpg', query: 'canvas shoes', kind: 'product', product: 'RUTA-12 Ruta Canvas Classic' },
  { file: 'RUTA-13.jpg', query: 'slip on shoes', kind: 'product', product: 'RUTA-13 Ruta Slip-On' },
  { file: 'NORD-14.jpg', query: 'suede shoes', kind: 'product', product: 'NORD-14 Nord Suede Court' },
  { file: 'TERA-15.jpg', query: 'hiking boots', kind: 'product', product: 'TERA-15 Tera Alpine Boot' },
  { file: 'TERA-16.jpg', query: 'hiking shoes', kind: 'product', product: 'TERA-16 Tera Ridge Low' },
  { file: 'VOLTA-17.jpg', query: 'snow boots', kind: 'product', product: 'VOLTA-17 Volta Terra Hiker' },
  { file: 'VANTA-18.jpg', query: 'socks', kind: 'product', product: 'VANTA-18 Vanta Crew Socks' },
  { file: 'KINETIK-19.jpg', query: 'baseball cap', kind: 'product', product: 'KINETIK-19 Kinetik Sport Cap' },
  { file: 'RUTA-20.jpg', query: 'tote bag', kind: 'product', product: 'RUTA-20 Ruta Canvas Tote' },
  { file: 'VOLTA-21.jpg', query: 'water bottle', kind: 'product', product: 'VOLTA-21 Volta Insulated Bottle' },
  { file: 'NORD-22.jpg', query: 'backpack', kind: 'product', product: 'NORD-22 Nord Tech Backpack' },
  { file: 'hero-01.jpg', query: 'sneakers', kind: 'hero-desktop', product: 'Portada editorial (desktop)' },
  { file: 'hero-01-mobile.jpg', query: 'sneakers', kind: 'hero-mobile', product: 'Portada editorial (móvil)' },
  { file: 'promo-01.jpg', query: 'running', kind: 'promo', product: 'Banner editorial secundario' },
]

function curlText(url) {
  return execFileSync('curl.exe', ['-sSL', '-A', UA, '--max-time', '45', url], { maxBuffer: 40 * 1024 * 1024 }).toString('utf8')
}

function curlDownload(url, dest) {
  execFileSync('curl.exe', ['-sSL', '-A', UA, '--max-time', '90', '-o', dest, url], { maxBuffer: 1024 * 1024 })
}

let manifest = {}
try { manifest = JSON.parse(await fs.readFile(MANIFEST, 'utf8')) } catch { manifest = {} }

const searchCache = new Map()
async function searchIds(query) {
  if (searchCache.has(query)) return searchCache.get(query)
  const html = curlText(`https://www.pexels.com/search/${encodeURIComponent(query)}/`)
  const ids = [...new Set([...html.matchAll(/images\.pexels\.com\/photos\/(\d+)\//g)].map((m) => m[1]))]
  searchCache.set(query, ids)
  return ids
}

async function photoMeta(id) {
  try {
    const html = curlText(`https://www.pexels.com/photo/${id}/`)
    return { author: html.match(/og:title" content="Photo by ([^"]+?) on Pexels"/)?.[1] ?? '' }
  } catch {
    return { author: '' }
  }
}

await fs.mkdir(OUT_DIR, { recursive: true })
await fs.mkdir(path.dirname(MANIFEST), { recursive: true })

const used = new Set(Object.values(manifest).map((m) => m.photoId).filter(Boolean))

for (const target of TARGETS) {
  const dest = path.join(OUT_DIR, target.file)
  if (!FORCE) {
    try { await fs.access(dest); console.log('SKIP', target.file); continue } catch { /* descargar */ }
  }

  let candidates = []
  try { candidates = await searchIds(target.query) } catch (err) { console.warn('BÚSQUEDA FALLIDA', target.query, err.message) }
  const id = candidates.find((c) => !used.has(c)) ?? candidates[0]
  if (!id) { console.warn('SIN CANDIDATAS', target.file, target.query); continue }
  used.add(id)

  const params = target.kind === 'hero-desktop'
    ? 'auto=compress&cs=tinysrgb&w=2000&h=1100&fit=crop'
    : target.kind === 'hero-mobile'
      ? 'auto=compress&cs=tinysrgb&w=900&h=1200&fit=crop'
      : target.kind === 'promo'
        ? 'auto=compress&cs=tinysrgb&w=1800&h=1000&fit=crop'
        : 'auto=compress&cs=tinysrgb&w=1200'

  const src = `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?${params}`
  curlDownload(src, dest)
  const { size } = await fs.stat(dest)
  if (size < 20_000) { console.warn('ARCHIVO PEQUEÑO', target.file, size); await fs.unlink(dest); continue }
  const { author } = await photoMeta(id)

  manifest[target.file] = {
    product: target.product,
    kind: target.kind,
    photoId: id,
    author,
    source: `https://www.pexels.com/photo/${id}/`,
    license: 'Pexels License (uso comercial gratuito, sin atribución obligatoria)',
    downloadedAt: new Date().toISOString().slice(0, 10),
    bytes: size,
    query: target.query,
  }
  console.log('OK', target.file, `${Math.round(size / 1024)}KB`, author || `#${id}`, target.query)
  await fs.writeFile(MANIFEST, JSON.stringify(manifest, null, 2))
}

await fs.writeFile(MANIFEST, JSON.stringify(manifest, null, 2))
console.log(`\n${Object.keys(manifest).length} recursos registrados en .tmp/assets-manifest.json`)
