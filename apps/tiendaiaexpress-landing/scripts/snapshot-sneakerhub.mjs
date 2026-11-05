// Read-only snapshot of the public SneakerHub pilot store for the landing page.
// - Reads public catalogue data (GET /api/products, /api/categories, /api/store).
// - Takes real screenshots of the live store (mobile and desktop).
// - Adds one product to the cart IN THE HEADLESS BROWSER ONLY (local cart, no checkout,
//   nothing is sent to the store).
// Output: scripts/.snapshot/ (raw), then `python scripts/optimize_images.py` writes the
// optimised files used by the site and src/content/sneakerhub.json.
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { chromiumPath } from './browser.mjs'

const STORE = 'https://catalogo-digital-ia.catalogo-lite-worker.workers.dev'
const OUT = new URL('./.snapshot/', import.meta.url)
await mkdir(OUT, { recursive: true })

const get = async (path) => {
  const res = await fetch(`${STORE}${path}`)
  if (!res.ok) throw new Error(`${path} → ${res.status}`)
  return res.json()
}

const [products, categories, store] = await Promise.all([get('/api/products'), get('/api/categories'), get('/api/store')])
const featured = products.filter((p) => p.isFeatured && p.imageUrls?.length)
const pick = ['Kinetik Aero Carbon', 'Nord Drift High', 'Astral Wave Runner', 'Tera Trail GTX', 'Vanta Court Low', 'Nord Field Backpack']
const chosen = pick.map((name) => featured.find((p) => p.name === name)).filter(Boolean)

for (const product of chosen) {
  const res = await fetch(`${STORE}${product.imageUrls[0]}`)
  const buffer = Buffer.from(await res.arrayBuffer())
  await writeFile(new URL(`product-${product.sku}.img`, OUT), buffer)
}

await writeFile(new URL('data.json', OUT), JSON.stringify({
  capturedAt: new Date().toISOString(),
  storeUrl: STORE,
  store: { name: store.name, slogan: store.slogan, description: store.description, businessType: store.businessType },
  categories: categories.map((c) => ({ name: c.name, slug: c.slug, count: c.product_count })),
  productCount: products.length,
  products: chosen.map((p) => ({
    sku: p.sku, name: p.name, brand: p.brand, price: p.price, category: p.categoryName,
    sizes: p.variants.filter((v) => v.isActive).map((v) => v.size),
    url: `${STORE}/product/${encodeURIComponent(p.sku)}`,
  })),
}, null, 2))

const browser = await chromium.launch({ executablePath: chromiumPath() })
const shot = async (page, name, opts = {}) => page.screenshot({ path: fileURLToPath(new URL(`${name}.png`, OUT)), ...opts })
const settle = async (page) => { await page.waitForLoadState('networkidle'); await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(900) }

// Mobile (390 × 844, 2x)
const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'es-CO' })
const m = await mobile.newPage()
await m.goto(STORE); await settle(m)
await shot(m, 'mobile-home')
const grid = m.locator('a[href*="/product/"]').first()
await grid.scrollIntoViewIfNeeded(); await m.evaluate(() => window.scrollBy(0, -90)); await m.waitForTimeout(700)
await shot(m, 'mobile-catalog')
const hero = chosen[0]
await m.goto(`${STORE}/product/${encodeURIComponent(hero.sku)}`); await settle(m)
await shot(m, 'mobile-product')
const size = hero.variants.find((v) => v.isActive && v.stock > 0)
if (size) await m.getByRole('button', { name: new RegExp(`^\\s*${size.size}\\s*$`) }).first().click().catch(() => {})
await m.getByRole('button', { name: /agregar|añadir/i }).first().click()
await m.waitForTimeout(1200)
if (!(await m.getByRole('dialog').count())) await m.getByRole('button', { name: /abrir carrito/i }).first().click().catch(() => {})
await m.waitForTimeout(1000)
await shot(m, 'mobile-cart')

// Desktop (1440 × 900)
const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'es-CO' })
const d = await desktop.newPage()
await d.goto(STORE); await settle(d)
await shot(d, 'desktop-home')
await d.goto(`${STORE}/product/${encodeURIComponent(hero.sku)}`); await settle(d)
await shot(d, 'desktop-product')
await browser.close()
console.log('snapshot ok:', chosen.map((p) => p.name).join(', '))
