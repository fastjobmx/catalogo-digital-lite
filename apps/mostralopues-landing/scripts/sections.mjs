// Visual QA: one screenshot per section (normal viewport), at the given widths.
// Usage: node scripts/sections.mjs [--w=1440,390]
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { chromiumPath } from './browser.mjs'

const base = process.argv.find((a) => a.startsWith('http')) || 'http://localhost:4317/'
const widths = process.argv.find((a) => a.startsWith('--w='))?.slice(4).split(',').map(Number) || [1440, 390]
const heights = { 360: 740, 390: 844, 768: 1024, 1024: 768, 1440: 900, 1920: 1080 }
const out = new URL('../tests/screens/', import.meta.url)
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ executablePath: chromiumPath() })
for (const width of widths) {
  const mobile = width < 768
  const ctx = await browser.newContext({ viewport: { width, height: heights[width] || 900 }, isMobile: mobile, hasTouch: mobile })
  const page = await ctx.newPage()
  await page.goto(base, { waitUntil: 'networkidle' })
  const sections = await page.evaluate(() => [...document.querySelectorAll('main > section, footer')].slice(1).map((s, i) => s.id || s.getAttribute('aria-labelledby') || `s${i}`))
  for (const [i, name] of sections.entries()) {
    const loc = page.locator('main > section, footer').nth(i + 1)
    await loc.scrollIntoViewIfNeeded()
    await page.waitForTimeout(name.startsWith('asistente') ? 7000 : 900)
    await page.evaluate(() => document.querySelector('header')?.style.setProperty('visibility', 'hidden'))
    await loc.screenshot({ path: fileURLToPath(new URL(`sec-${width}-${String(i).padStart(2, '0')}-${name}.png`, out)) })
    await page.evaluate(() => document.querySelector('header')?.style.removeProperty('visibility'))
  }
  await ctx.close()
}
await browser.close()
console.log('ok')
