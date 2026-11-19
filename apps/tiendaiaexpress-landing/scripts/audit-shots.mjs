// Visual audit of the whole V2 page: node scripts/audit-shots.mjs <url> <outDir> [widths...]
// Motion on. For each width: the hero story at key positions (and the portal), then one screenshot per
// screenful down the rest of the page, so nothing is skipped.
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from '@playwright/test'
import { chromiumPath } from './browser.mjs'

const [url, out, ...ws] = process.argv.slice(2)
const widths = (ws.length ? ws : ['390', '360', '1440']).map(Number)
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ executablePath: chromiumPath() })
const SHARE = 0.72
for (const w of widths) {
  const h = w >= 1024 ? 900 : w >= 700 ? 1024 : w <= 360 ? 780 : 844
  const mobile = w < 700
  const page = await browser.newPage({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, reducedMotion: 'no-preference' })
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.evaluate(() => document.querySelectorAll('img[loading=lazy]').forEach((i) => { i.loading = 'eager' }))
  await page.waitForTimeout(1500)
  const shot = (name) => page.screenshot({ path: join(out, `${w}-${name}.jpg`), type: 'jpeg', quality: 78 })
  const story = (t, p = 0) => page.evaluate(([t, p, s]) => { const el = document.querySelector('#inicio'); window.scrollTo(0, el.offsetTop + (el.offsetHeight - innerHeight) * (t * s + p * (1 - s))) }, [t, p, SHARE])
  let n = 0
  const tag = () => String(++n).padStart(2, '0')
  for (const [t, p] of [[0, 0], [0.2, 0], [0.35, 0], [0.58, 0], [0.9, 0], [1, 0.4], [1, 0.75]]) { await story(t, p); await page.waitForTimeout(450); await shot(`${tag()}-hero-t${t}-p${p}`) }
  const start = await page.evaluate(() => { const el = document.querySelector('#inicio'); return el.offsetTop + el.offsetHeight })
  const end = await page.evaluate(() => document.documentElement.scrollHeight)
  for (let y = start; y < end; y += Math.round(h * 0.85)) {
    await page.evaluate((y) => window.scrollTo(0, y), y)
    await page.waitForTimeout(450)
    await shot(`${tag()}-y${y}`)
  }
  await page.close()
}
await browser.close()
console.log('ok')
