// Quick element screenshots for review: node scripts/shot.mjs <url> <outDir> <width> <selector...>
import { mkdir } from 'node:fs/promises'
import { chromium } from '@playwright/test'
import { chromiumPath } from './browser.mjs'

const [base, out, width, ...selectors] = process.argv.slice(2)
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ executablePath: chromiumPath() })
const mobile = Number(width) < 768
const page = await browser.newPage({ viewport: { width: Number(width), height: mobile ? 844 : 900 }, reducedMotion: 'reduce', isMobile: mobile, hasTouch: mobile })
await page.goto(base, { waitUntil: 'networkidle' })
await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 40)) } window.scrollTo(0, 0) })
await page.waitForTimeout(300)
await page.addStyleTag({ content: '#root > header{visibility:hidden}' })
for (const sel of selectors) {
  const name = sel.replace(/[^a-z0-9-]+/gi, '_')
  await page.locator(sel).first().screenshot({ path: `${out}/${width}-${name}.jpg`, type: 'jpeg', quality: 80 })
}
await browser.close()
console.log('ok')
