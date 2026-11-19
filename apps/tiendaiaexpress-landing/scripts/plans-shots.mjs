// Plans section evidence: node scripts/plans-shots.mjs <url> <outDir> <label>
// Full-section captures at 1440 and 390 (motion at rest), both billing modes, and the open comparator.
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from '@playwright/test'
import { chromiumPath } from './browser.mjs'

const [url, out, label = 'plans'] = process.argv.slice(2)
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ executablePath: chromiumPath() })
for (const [w, h, m] of [[1440, 900, false], [390, 844, true]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, isMobile: m, hasTouch: m, reducedMotion: 'no-preference' })
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.addStyleTag({ content: 'body > div > header, #root > header, header.fixed, header.sticky { visibility: hidden !important }' })
  const sec = page.locator('#planes')
  await sec.scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
  await sec.screenshot({ path: join(out, `${label}-${w}-mensual.jpg`), type: 'jpeg', quality: 80 })
  await page.waitForTimeout(1500)
  await page.locator('#planes input[value="anual"]').check({ force: true })
  await page.waitForTimeout(300)
  await sec.screenshot({ path: join(out, `${label}-${w}-anual.jpg`), type: 'jpeg', quality: 80 })
  await page.locator('#planes summary').first().click()
  await page.waitForTimeout(300)
  await sec.screenshot({ path: join(out, `${label}-${w}-comparador.jpg`), type: 'jpeg', quality: 80 })
  await page.close()
}
await browser.close()
console.log('ok')
