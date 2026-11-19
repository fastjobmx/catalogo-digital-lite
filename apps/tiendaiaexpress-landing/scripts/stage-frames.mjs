// Frames of the hero/story stage at given scroll progress (motion mode): node scripts/stage-frames.mjs <url> <outDir> [widths…]
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from '@playwright/test'
import { chromiumPath } from './browser.mjs'

const [url, out, ...ws] = process.argv.slice(2)
await mkdir(out, { recursive: true })
const sizes = { 1440: [1440, 900], 1366: [1366, 768], 1280: [1280, 800], 768: [768, 1024], 390: [390, 844], 360: [360, 780] }
const b = await chromium.launch({ executablePath: chromiumPath() })
for (const w of (ws.length ? ws : ['1440', '390'])) {
  const [vw, vh] = sizes[w]
  const mobile = vw < 768
  const p = await b.newPage({ viewport: { width: vw, height: vh }, isMobile: mobile, hasTouch: mobile })
  await p.goto(url, { waitUntil: 'networkidle' })
  await p.waitForTimeout(1400)
  for (const [label, t] of [['0-hero', 0], ['1-mensaje', 0.32], ['2-confirmacion', 0.66], ['3-resultado', 1]]) {
    await p.evaluate((t) => { const el = document.querySelector('#inicio'); const travel = el.offsetHeight - innerHeight; window.scrollTo(0, el.offsetTop + travel * t) }, t)
    await p.waitForTimeout(900)
    const key = await p.locator('#inicio').getAttribute('data-stage-key')
    await p.screenshot({ path: join(out, `${w}-${label}-${key}.jpg`), type: 'jpeg', quality: 80 })
  }
  await p.close()
}
await b.close()
console.log('ok')
