// «Tu tienda en 3 pasos» and the footer: node scripts/steps-shots.mjs <url> <outDir>
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from '@playwright/test'
import { chromiumPath } from './browser.mjs'
const [url, out] = process.argv.slice(2)
await mkdir(out, { recursive: true })
const b = await chromium.launch({ executablePath: chromiumPath() })
for (const [w, h, m] of [[1440, 900, false], [390, 844, true]]) {
  const p = await b.newPage({ viewport: { width: w, height: h }, isMobile: m, hasTouch: m, reducedMotion: 'no-preference' })
  await p.goto(url, { waitUntil: 'networkidle' })
  await p.addStyleTag({ content: 'html{scroll-behavior:auto!important}' })
  await p.evaluate(() => document.querySelectorAll('img[loading=lazy]').forEach((i) => { i.loading = 'eager' }))
  const go = (sel, f) => p.evaluate(([sel, f]) => { const el = document.querySelector(sel); const r = el.getBoundingClientRect(); window.scrollTo({ top: r.top + scrollY - innerHeight + (innerHeight + r.height) * f, behavior: 'instant' }) }, [sel, f])
  await go('#empieza ol', 0.25); await p.waitForTimeout(2500)
  await p.screenshot({ path: join(out, `${w}-pasos-entrando.jpg`), type: 'jpeg', quality: 82 })
  await go('#empieza ol', 0.55); await p.waitForTimeout(1500)
  if (!m) { const r = await p.locator('#empieza .v2-step-card').nth(1).boundingBox(); await p.mouse.move(r.x + r.width * 0.8, r.y + r.height * 0.3); await p.waitForTimeout(900) }
  await p.screenshot({ path: join(out, `${w}-pasos.jpg`), type: 'jpeg', quality: 82 })
  await p.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' })); await p.waitForTimeout(1200)
  await p.screenshot({ path: join(out, `${w}-pie.jpg`), type: 'jpeg', quality: 82 })
  await p.close()
}
await b.close(); console.log('ok')
