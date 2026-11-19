// WebGL evidence, second set: the buyer's journey (desktop) and the finale: node scripts/webgl-shots-2.mjs <url> <outDir>
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from '@playwright/test'
import { chromiumPath } from './browser.mjs'

const [url, out] = process.argv.slice(2)
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ executablePath: chromiumPath() })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference' })
await page.goto(`${url}${url.includes('?') ? '&' : '?'}force3d`, { waitUntil: 'networkidle' })
const toJourney = (f) => page.evaluate((f) => { const ol = document.querySelector('#comprar ol'); const r = ol.getBoundingClientRect(); window.scrollTo(0, r.top + scrollY - innerHeight + (innerHeight + r.height) * f) }, f)
await toJourney(0.2)
await page.waitForSelector('#comprar.has-3d', { timeout: 20000 })
for (const [f, n] of [[0.12, '01-llegando'], [0.3, '02-abriendo'], [0.5, '03-abanico'], [0.7, '04-de-frente']]) {
  await toJourney(f); await page.waitForTimeout(1300)
  await page.screenshot({ path: join(out, `1440-recorrido-${n}.jpg`), type: 'jpeg', quality: 82 })
}
const toFinale = (p) => page.evaluate((p) => { const f = document.querySelector('.v2-finale'); window.scrollTo(0, f.offsetTop + (f.offsetHeight - innerHeight) * p) }, p)
await toFinale(0.05)
await page.waitForSelector('.v2-finale-3d[data-ready]', { timeout: 20000 })
for (const [p, n] of [[0.1, '01'], [0.35, '02'], [0.6, '03'], [1, '04']]) {
  await toFinale(p); await page.waitForTimeout(1300)
  await page.screenshot({ path: join(out, `1440-final-3d-${n}.jpg`), type: 'jpeg', quality: 82 })
}
await browser.close()
console.log('ok')
