// Real desktop capture of the SneakerHub cart for the showcase's "Carrito" tab.
// Opens the public product page, picks a size with stock and adds one unit IN THE HEADLESS
// BROWSER ONLY (local cart: no checkout, nothing is sent to the store), then opens the cart.
// Usage: node scripts/snapshot-desktop-cart.mjs   →  scripts/.snapshot/desktop-cart.png
// Then:  python scripts/optimize_images.py (or the one-off conversion in the commit) for the .webp files.
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { chromiumPath } from './browser.mjs'

const STORE = (process.env.VITE_APP_URL || 'https://app.tiendiaexpres.com').replace(/\/+$/, '')
const SKU = process.argv[2] || 'KINETIK-06'
const OUT = new URL('./.snapshot/', import.meta.url)
await mkdir(OUT, { recursive: true })

const product = await (await fetch(`${STORE}/api/products/${encodeURIComponent(SKU)}`)).json().catch(() => null)
const size = product?.variants?.find((v) => v.isActive && v.stock > 0)?.size

const browser = await chromium.launch({ executablePath: chromiumPath() })
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'es-CO' })).newPage()
await page.goto(`${STORE}/product/${encodeURIComponent(SKU)}`, { waitUntil: 'networkidle' })
await page.evaluate(() => document.fonts.ready)
if (size) await page.getByRole('button', { name: new RegExp(`^\\s*${size}\\s*$`) }).first().click().catch(() => {})
await page.getByRole('button', { name: /agregar|añadir/i }).first().click()
await page.waitForTimeout(1200)
if (!(await page.getByRole('dialog').count())) await page.getByRole('button', { name: /abrir carrito|carrito/i }).first().click().catch(() => {})
await page.waitForTimeout(1200)
await page.screenshot({ path: fileURLToPath(new URL('desktop-cart.png', OUT)) })
console.log('ok', SKU, size ?? '(sin talla)', 'diálogo:', await page.getByRole('dialog').count())
await browser.close()
