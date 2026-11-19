// First-viewport and scroll-position screenshots of a page: node scripts/viewport-shots.mjs <url> <outDir> <label> [selectors...]
// Without selectors: the first viewport at 1440×900 and 390×844. With selectors: each one scrolled to the top of the viewport.
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from '@playwright/test'
import { chromiumPath } from './browser.mjs'

const [url, out, label = 'shot', ...selectors] = process.argv.slice(2)
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ executablePath: chromiumPath() })
for (const vp of [{ w: 1440, h: 900 }, { w: 1366, h: 768 }, { w: 768, h: 1024 }, { w: 390, h: 844, m: true }, { w: 360, h: 780, m: true }]) {
  if (!selectors.length && ![1440, 390].includes(vp.w)) continue
  const page = await browser.newPage({ viewport: { width: vp.w, height: vp.h }, isMobile: Boolean(vp.m), hasTouch: Boolean(vp.m), reducedMotion: process.env.MOTION ? 'no-preference' : 'reduce' })
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForTimeout(300)
  if (!selectors.length) { await page.screenshot({ path: join(out, `${label}-${vp.w}-viewport.jpg`), type: 'jpeg', quality: 80 }); await page.close(); continue }
  for (const sel of selectors) {
    const el = page.locator(sel).first()
    if (!(await el.count())) continue
    await el.evaluate((node) => window.scrollTo(0, node.getBoundingClientRect().top + window.scrollY))
    await page.waitForTimeout(250)
    await page.screenshot({ path: join(out, `${label}-${vp.w}-${sel.replace(/[^a-z0-9-]+/gi, '')}.jpg`), type: 'jpeg', quality: 80 })
  }
  await page.close()
}
await browser.close()
console.log('ok')
