// Evidence for the 3D layer (Fase H · profundidad): node scripts/depth-shots.mjs <url> <outDir>
// Motion on. Frames of the hero tilt (0 → settled), the phone fan, the curved stores wall and a tilted tile
// (desktop 1440×900), the cover flow on a phone (390×844), and a .webm of one continuous scroll.
import { mkdir, readdir, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from '@playwright/test'
import { chromiumPath } from './browser.mjs'

const [url, out] = process.argv.slice(2)
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ executablePath: chromiumPath() })
const shot = (page, name) => page.screenshot({ path: join(out, `${name}.jpg`), type: 'jpeg', quality: 82 })
const settle = (page, ms = 700) => page.waitForTimeout(ms)
const toProgress = (page, t) => page.evaluate((t) => { const el = document.querySelector('#inicio'); window.scrollTo(0, el.offsetTop + (el.offsetHeight - innerHeight) * t) }, t)
const toEl = (page, sel, offset = 0) => page.evaluate(([sel, offset]) => { const el = document.querySelector(sel); window.scrollTo(0, el.getBoundingClientRect().top + scrollY - offset) }, [sel, offset])
const lazy = (page) => page.evaluate(() => document.querySelectorAll('img[loading=lazy]').forEach((i) => { i.loading = 'eager' }))

// Desktop frames
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference' })
  await page.goto(url, { waitUntil: 'networkidle' })
  await lazy(page)
  await settle(page, 1400)
  await shot(page, '1440-01-hero-inclinado')
  await page.mouse.move(1180, 560)
  await settle(page, 1300)
  await shot(page, '1440-02-hero-puntero')
  for (const [t, n] of [[0.08, '03-hero-levantando'], [0.2, '04-hero-plano'], [1, '05-hero-final-producto-al-frente']]) { await toProgress(page, t); await settle(page); await shot(page, `1440-${n}`) }
  await toEl(page, '#comprar ol', 980); await settle(page); await shot(page, '1440-06-abanico-entrando')
  await toEl(page, '#comprar ol', 520); await settle(page); await shot(page, '1440-07-abanico-abierto')
  await toEl(page, '#tiendas ul', 900); await settle(page, 1200); await shot(page, '1440-08-pared-curva-entrando')
  await toEl(page, '#tiendas ul', 380); await settle(page, 900); await shot(page, '1440-09-pared-curva-asentada')
  await toEl(page, '#funciones ul', 140); await settle(page)
  const tile = page.locator('#funciones ul > li').nth(1)
  const box = await tile.boundingBox()
  await page.mouse.move(box.x + box.width * 0.85, box.y + box.height * 0.2)
  await settle(page, 900)
  await shot(page, '1440-10-baldosa-inclinada')
  await page.close()
}
// Phone: cover flow in the horizontal rows
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'no-preference' })
  await page.goto(url, { waitUntil: 'networkidle' })
  await lazy(page)
  await settle(page, 1400)
  await shot(page, '390-01-hero')
  await toEl(page, '#comprar ol', 160); await settle(page)
  await page.evaluate(() => { const ol = document.querySelector('#comprar ol'); ol.scrollLeft = ol.scrollWidth * 0.18 })
  await settle(page); await shot(page, '390-02-coverflow-cliente')
  await toEl(page, '#tiendas ul', 160); await settle(page)
  await page.evaluate(() => { const ul = document.querySelector('#tiendas ul'); ul.scrollLeft = ul.scrollWidth * 0.3 })
  await settle(page); await shot(page, '390-03-coverflow-tiendas')
  await page.close()
}
// Video: one continuous scroll at 1440×900
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference', recordVideo: { dir: out, size: { width: 1440, height: 900 } } })
  const page = await ctx.newPage()
  await page.goto(url, { waitUntil: 'networkidle' })
  await lazy(page)
  await settle(page, 1600)
  const end = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)
  for (let y = 0; y < end; y += 18) { await page.evaluate((y) => window.scrollTo(0, y), y); await page.waitForTimeout(16) }
  await settle(page, 600)
  await ctx.close()
  const webm = (await readdir(out)).find((f) => f.endsWith('.webm') && !f.startsWith('1440'))
  if (webm) await rename(join(out, webm), join(out, '1440-recorrido-3d.webm'))
}
await browser.close()
console.log('ok')
