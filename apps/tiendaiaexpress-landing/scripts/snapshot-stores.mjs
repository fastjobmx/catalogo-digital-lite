// Read-only screenshots of the public stores listed in src/content/stores.ts (the landing's
// "Negocios que ya tienen su tienda" section). Opens each public URL, waits for it to settle and
// captures the first screen. Nothing is clicked, sent or stored in the stores.
// Usage: node scripts/snapshot-stores.mjs muy-parcero luz-magica ...
// Output: scripts/.stores/<slug>.png, then `python scripts/optimize_stores.py` writes src/assets/stores/*.webp
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { chromiumPath } from './browser.mjs'

const APP = (process.env.VITE_APP_URL || 'https://app.tiendiaexpres.com').replace(/\/+$/, '')
const slugs = process.argv.slice(2).filter((s) => /^[a-z0-9-]{3,40}$/.test(s))
if (!slugs.length) throw new Error('Indicá al menos una dirección de tienda (slug).')

const OUT = new URL('./.stores/', import.meta.url)
await mkdir(OUT, { recursive: true })
const browser = await chromium.launch({ executablePath: chromiumPath() })
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, locale: 'es-CO' })
for (const slug of slugs) {
  const page = await context.newPage()
  const res = await page.goto(`${APP}/t/${slug}`, { waitUntil: 'networkidle' })
  if (!res || res.status() !== 200) { console.warn(slug, 'respondió', res?.status()); await page.close(); continue }
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(1200)
  await page.screenshot({ path: fileURLToPath(new URL(`${slug}.png`, OUT)) })
  console.log('ok', slug, await page.title())
  await page.close()
}
await browser.close()
