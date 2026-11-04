// Visual QA: screenshots of the local build at the required widths.
// Usage: node scripts/screens.mjs [baseUrl] [--full] [--story]
//   default: first viewport at every width; --full: full page; --story: frames of the cinematic story.
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { chromiumPath } from './browser.mjs'

const base = process.argv.find((a) => a.startsWith('http')) || 'http://localhost:4317/'
const full = process.argv.includes('--full')
const storyFrames = process.argv.includes('--story')
const only = process.argv.find((a) => a.startsWith('--w='))?.slice(4).split(',').map(Number)
const widths = only || [360, 390, 768, 1024, 1440, 1920]
const heights = { 360: 740, 390: 844, 768: 1024, 1024: 768, 1440: 900, 1920: 1080 }
const out = new URL('../tests/screens/', import.meta.url)
await mkdir(out, { recursive: true })

const browser = await chromium.launch({ executablePath: chromiumPath(), args: ['--headless=new'] })
const errors = []
for (const width of widths) {
  const mobile = width < 768
  const ctx = await browser.newContext({ viewport: { width, height: heights[width] || 900 }, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(`${width}: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${width} console: ${m.text()}`) })
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2600)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  if (overflow > 0) errors.push(`${width}: horizontal overflow ${overflow}px`)
  // Content clipped by an overflow-hidden ancestor does not scroll the page: look for it too.
  const clipped = await page.evaluate(() => {
    const vw = window.innerWidth
    return [...document.querySelectorAll('main p, main h1, main h2, main h3, main button, main a, main input, main textarea, footer p, footer a')]
      .filter((el) => !el.closest('.story-sticky, [aria-hidden="true"], .sr-only'))
      .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.right > vw + 1 || r.left < -1) })
      .slice(0, 5).map((el) => `${el.tagName.toLowerCase()} "${(el.textContent || '').trim().slice(0, 40)}"`)
  })
  if (clipped.length) errors.push(`${width}: content outside the viewport: ${clipped.join(' | ')}`)
  if (storyFrames) {
    const trackHeight = await page.evaluate(() => document.querySelector('.story-track')?.getBoundingClientRect().height || 0)
    const top = await page.evaluate(() => document.querySelector('.story-track')?.getBoundingClientRect().top + window.scrollY)
    const scrollable = trackHeight - (heights[width] || 900)
    for (const p of [0, 0.08, 0.2, 0.3, 0.38, 0.55, 0.62, 0.85]) {
      await page.evaluate((y) => window.scrollTo(0, y), Math.round(top + scrollable * p))
      await page.waitForTimeout(1300)
      await page.screenshot({ path: fileURLToPath(new URL(`story-${width}-${String(Math.round(p * 100)).padStart(3, '0')}.png`, out)) })
    }
  } else {
    if (full) {
      // Walk the page so scroll-driven pieces settle, then capture.
      const h = await page.evaluate(() => document.body.scrollHeight)
      for (let y = 0; y < h; y += 700) { await page.evaluate((v) => window.scrollTo(0, v), y); await page.waitForTimeout(120) }
      await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(800)
    }
    await page.screenshot({ path: fileURLToPath(new URL(`home-${width}${full ? '-full' : ''}.png`, out)), fullPage: full })
  }
  await ctx.close()
}
await browser.close()
console.log(errors.length ? `ISSUES:\n${errors.join('\n')}` : 'no console errors, no horizontal overflow')
