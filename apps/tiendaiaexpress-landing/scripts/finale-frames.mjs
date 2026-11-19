// Frames of the 3D finale (scroll-scrubbed product turn): node scripts/finale-frames.mjs <url> <outDir>
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from '@playwright/test'
import { chromiumPath } from './browser.mjs'

const [url, out] = process.argv.slice(2)
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ executablePath: chromiumPath() })
for (const vp of [{ w: 1440, h: 900 }, { w: 390, h: 844, m: true }]) {
  const page = await browser.newPage({ viewport: { width: vp.w, height: vp.h }, isMobile: Boolean(vp.m), hasTouch: Boolean(vp.m), reducedMotion: 'no-preference' })
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.evaluate(() => { const f = document.querySelector('.v2-finale'); window.scrollTo(0, f.offsetTop - innerHeight) })
  await page.waitForSelector('.v2-finale[data-video="ready"]', { timeout: 15000 })
  for (const p of [0, 0.25, 0.5, 0.75, 1]) {
    await page.evaluate((p) => { const f = document.querySelector('.v2-finale'); window.scrollTo(0, f.offsetTop + (f.offsetHeight - innerHeight) * p) }, p)
    await page.waitForTimeout(250)
    await page.evaluate(() => new Promise((r) => { const v = document.querySelector('.v2-finale video'); if (!v.seeking) r(); else v.addEventListener('seeked', r, { once: true }) }))
    await page.waitForTimeout(250)
    await page.screenshot({ path: join(out, `${vp.w}-final-p${String(p * 100).padStart(3, '0')}.jpg`), type: 'jpeg', quality: 82 })
  }
  await page.close()
}
await browser.close()
console.log('ok')
