// WebGL evidence: node scripts/webgl-shots.mjs <url> <outDir>  (adds ?force3d: headless Chromium renders
// WebGL in software, which the site normally skips). Hero at rest and flying in, the stores ring turning.
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from '@playwright/test'
import { chromiumPath } from './browser.mjs'

const [url, out] = process.argv.slice(2)
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ executablePath: chromiumPath(), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
for (const [w, h, m] of [[1440, 900, false], [390, 844, true]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, isMobile: m, hasTouch: m, reducedMotion: 'no-preference' })
  await page.goto(`${url}${url.includes('?') ? '&' : '?'}force3d`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.hs-world[data-ready]', { timeout: 20000 })
  await page.waitForTimeout(2600)
  if (!m) { await page.mouse.move(w * 0.8, h * 0.3); await page.waitForTimeout(900) }
  await page.screenshot({ path: join(out, `${w}-mundo-01-reposo.jpg`), type: 'jpeg', quality: 82 })
  await page.evaluate(() => { const el = document.querySelector('#inicio'); window.scrollTo(0, el.offsetTop + (el.offsetHeight - innerHeight) * 0.72 * 0.12) })
  await page.waitForTimeout(1200)
  await page.screenshot({ path: join(out, `${w}-mundo-02-entrando.jpg`), type: 'jpeg', quality: 82 })
  await page.evaluate(() => { const el = document.querySelector('.v2-ring'); window.scrollTo(0, el.getBoundingClientRect().top + scrollY - innerHeight * 0.55) })
  await page.waitForSelector('#tiendas.has-ring', { timeout: 20000 })
  await page.waitForTimeout(1600)
  await page.screenshot({ path: join(out, `${w}-anillo-01.jpg`), type: 'jpeg', quality: 82 })
  await page.evaluate(() => window.scrollBy(0, innerHeight * 0.35))
  await page.waitForTimeout(1600)
  await page.screenshot({ path: join(out, `${w}-anillo-02.jpg`), type: 'jpeg', quality: 82 })
  await page.close()
}
await browser.close()
console.log('ok')
