// Read-only snapshot of the AUTHORIZED real stores (src/content/stores.ts) for the landing:
//  - public catalogue data (GET /api/store, /api/products, /api/categories with X-Store-Slug);
//  - the original product photos listed in PICKS (no third-party brand marks, no licensed characters);
//  - the first screen of each store on a phone (390 × 844).
// Nothing is clicked, sent or stored in the stores.
// Output: scripts/.stores/real/, then `python scripts/optimize_real.py` writes src/assets/real/
// and src/content/realStores.json.
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { chromiumPath } from './browser.mjs'

const APP = (process.env.VITE_APP_URL || 'https://app.tiendiaexpres.com').replace(/\/+$/, '')
const PICKS = {
  'luz-magica': ['LM-005', 'LM-007', 'LM-117', 'LM-105', 'LM-139', 'LM-054'],
  'muy-parcero': ['ZAP-NEG-3012', 'CAM-NEG-7116', 'PLA-BLA-6934'],
  // Pilot Equipment: no product photos on the landing (owner's decision, 2026-11-14); captures only.
  'pilot-equipment': [],
  // Photos carry third-party brand marks (Levi's, Polo, Diesel); shown at the owner's explicit request (2026-11-14).
  'imperio-nova': ['PAN-AZU-9886', 'JEA-AZU-4526', 'TG-29C4ADBA-992'],
  // Bouquets only: no licensed plush characters, no photos taken from other accounts or with people's notes. Prices are provisional.
  'el-palacio-de-las-flores': ['PF-06', 'PF-09', 'PF-14', 'PF-58'],
  // Own-brand pieces only (Undergold, Clemont); no Hugo Boss, Psycho Bunny, etc. Prices are provisional.
  'altogramaje-twin': ['AG-0630', 'AG-0639', 'AG-0578', 'AG-0541'],
}
const OUT = new URL('./.stores/real/', import.meta.url)
await mkdir(OUT, { recursive: true })
const get = async (slug, path, json = true) => {
  const res = await fetch(`${APP}${path}`, { headers: { 'X-Store-Slug': slug } })
  if (!res.ok) throw new Error(`${slug}${path} → ${res.status}`)
  return json ? res.json() : Buffer.from(await res.arrayBuffer())
}

const data = { capturedAt: new Date().toISOString(), stores: {} }
for (const [slug, skus] of Object.entries(PICKS)) {
  const [store, products, categories] = await Promise.all([get(slug, '/api/store'), get(slug, '/api/products'), get(slug, '/api/categories')])
  const chosen = skus.map((sku) => products.find((p) => p.sku === sku)).filter((p) => p?.imageUrls?.length)
  for (const p of chosen) await writeFile(new URL(`${slug}--${p.sku}.img`, OUT), await get(slug, p.imageUrls[0], false))
  data.stores[slug] = {
    name: store.name, slogan: store.slogan, businessType: store.businessType,
    productCount: products.length, categoryCount: categories.length,
    products: chosen.map((p) => ({ sku: p.sku, name: p.name.trim(), price: p.price, compareAtPrice: p.compareAtPrice ?? null, category: p.categoryName })),
  }
}
await writeFile(new URL('data.json', OUT), JSON.stringify(data, null, 2))

const browser = await chromium.launch({ executablePath: chromiumPath() })
const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'es-CO' })
for (const slug of Object.keys(PICKS)) {
  const page = await mobile.newPage()
  await page.goto(`${APP}/t/${slug}`, { waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(1500)
  await page.screenshot({ path: fileURLToPath(new URL(`${slug}--mobile.png`, OUT)) })
  const card = page.locator('a[href*="/product"]').first()
  if (await card.count()) { await card.scrollIntoViewIfNeeded(); await page.evaluate(() => window.scrollBy(0, -110)); await page.waitForTimeout(900); await page.screenshot({ path: fileURLToPath(new URL(`${slug}--mobile-catalog.png`, OUT)) }) }
  await page.close()
}
await browser.close()
console.log('ok', Object.entries(data.stores).map(([s, v]) => `${s}: ${v.productCount} productos, ${v.products.length} fotos`).join(' · '))
