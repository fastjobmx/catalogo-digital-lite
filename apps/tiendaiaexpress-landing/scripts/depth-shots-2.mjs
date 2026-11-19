// Evidence for the second 3D round: node scripts/depth-shots-2.mjs <url> <outDir>
// Hero product turn and portal, administration deck, stacked plans and the stores scene (1440 and 390).
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from '@playwright/test'
import { chromiumPath } from './browser.mjs'

const [url, out] = process.argv.slice(2)
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ executablePath: chromiumPath() })
const SHARE = 0.72
const story = (page, t, portal = 0) => page.evaluate(([t, portal, share]) => { const el = document.querySelector('#inicio'); window.scrollTo(0, el.offsetTop + (el.offsetHeight - innerHeight) * (t * share + portal * (1 - share))) }, [t, portal, SHARE])
const seeked = (page, sel) => page.evaluate((sel) => new Promise((r) => { const v = document.querySelector(sel); if (!v || !v.seeking) r(); else v.addEventListener('seeked', r, { once: true }) }), sel)
const toEl = (page, sel, offset) => page.evaluate(([sel, offset]) => { const el = document.querySelector(sel); window.scrollTo(0, el.getBoundingClientRect().top + scrollY - offset) }, [sel, offset])

for (const vp of [{ w: 1440, h: 900 }, { w: 390, h: 844, m: true }]) {
  const page = await browser.newPage({ viewport: { width: vp.w, height: vp.h }, isMobile: Boolean(vp.m), hasTouch: Boolean(vp.m), reducedMotion: 'no-preference' })
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.evaluate(() => document.querySelectorAll('img[loading=lazy]').forEach((i) => { i.loading = 'eager' }))
  await page.waitForSelector('#inicio[data-turn="ready"]', { timeout: 15000 })
  const shot = async (name) => { await page.waitForTimeout(350); await page.screenshot({ path: join(out, `${vp.w}-${name}.jpg`), type: 'jpeg', quality: 82 }) }
  for (const [t, p, name] of [[0.9, 0, '11-producto-sale'], [1, 0.3, '12-producto-gira'], [1, 0.55, '13-portal-entrando'], [1, 0.8, '14-portal-blanco']]) {
    await story(page, t, p); await page.waitForTimeout(300); await seeked(page, '.hs-turn'); await shot(name)
  }
  await story(page, 1, 1); await page.waitForTimeout(200); await page.mouse.wheel(0, 300); await page.waitForTimeout(500); await shot('15-despues-del-portal')
  await toEl(page, '#op-panel', vp.m ? 120 : 220); await page.waitForTimeout(500)
  if (!vp.m) { const b = await page.locator('#op-panel').boundingBox(); await page.mouse.move(b.x + b.width * 0.8, b.y + b.height * 0.3) }
  await page.locator('#op-tab-existencias').click(); await page.waitForTimeout(160); await shot('16-admin-mazo-entrando')
  await page.waitForTimeout(800); await shot('17-admin-mazo')
  await toEl(page, '.v2-plans', vp.h * 0.85); await page.waitForTimeout(400); await shot('18-planes-subiendo')
  await toEl(page, '.v2-plans', 140); await page.waitForTimeout(400); await shot('19-planes')
  await toEl(page, '.v2-stores-head', vp.h * 0.6); await page.waitForTimeout(1500); await seeked(page, '.v2-stores-scene video'); await shot('20-tiendas-escena')
  await toEl(page, '.v2-stores-head', 120); await page.waitForTimeout(500); await seeked(page, '.v2-stores-scene video'); await shot('21-tiendas-escena-avanzada')
  await page.close()
}
await browser.close()
console.log('ok')
