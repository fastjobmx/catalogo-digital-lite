// Screenshots of the landing for review (tests/screens/, not committed).
// Usage: node scripts/screens.mjs [baseUrl] [outDir]     default http://localhost:4318 tests/screens
// Reduced motion is requested so every section is visible without scrolling animations.
import { mkdir } from 'node:fs/promises'
import { chromium } from '@playwright/test'
import { chromiumPath } from './browser.mjs'

const base = process.argv[2] || 'http://localhost:4318'
const out = process.argv[3] || 'tests/screens'
await mkdir(out, { recursive: true })
const SECTIONS = ['inicio', 'funciones', 'como-funciona', 'tiendas', 'demo', 'estudio', 'administracion', 'planes', 'preguntas', 'contacto']
const VIEWPORTS = { desktop: { width: 1440, height: 900 }, tablet: { width: 820, height: 1180 }, mobile: { width: 390, height: 844 } }

const browser = await chromium.launch({ executablePath: chromiumPath() })
for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', locale: 'es-CO', isMobile: name === 'mobile', hasTouch: name !== 'desktop' })
  const page = await context.newPage()
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts.ready)
  // Lazy images: walk the page once so every capture has its pictures.
  await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)) } window.scrollTo(0, 0) })
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${out}/${name}-portada.png` })
  await page.screenshot({ path: `${out}/${name}-completa.jpg`, fullPage: true, type: 'jpeg', quality: 72 })
  await page.addStyleTag({ content: '#root > header{visibility:hidden}' })
  for (const id of SECTIONS) {
    const section = page.locator(`#${id}`)
    if (await section.count()) await section.screenshot({ path: `${out}/${name}-${id}.jpg`, type: 'jpeg', quality: 78 })
  }
  await page.addStyleTag({ content: '#root > header{visibility:visible}' })
  await page.evaluate(() => window.scrollTo(0, 0))
  if (name !== 'desktop') {
    const toggle = page.getByRole('button', { name: 'Abrir menú' })
    await page.waitForTimeout(300)
    if (await toggle.isVisible()) { await toggle.click({ timeout: 5000 }).then(() => page.waitForTimeout(500)).then(() => page.screenshot({ path: `${out}/${name}-menu.png` })).catch((e) => console.warn(name, 'menu:', e.message.slice(0, 120))) } else console.warn(name, 'menu toggle not visible')
  }
  await context.close()
}
await browser.close()
console.log('screens ok →', out)
