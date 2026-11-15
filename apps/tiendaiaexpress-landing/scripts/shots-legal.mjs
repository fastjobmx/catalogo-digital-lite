// Responsive captures of the legal pages served by scripts/serve.mjs on :4320 (npm run build:official first).
// Usage: node scripts/shots-legal.mjs docs/capturas-legal [pagina,pagina]
import { chromium } from '@playwright/test'
import { chromiumPath } from './browser.mjs'

const out = process.argv[2]
const pages = process.argv[3] ? process.argv[3].split(',') : ['terminos-y-condiciones', 'servicios-adicionales']
const sections = { 'servicios-adicionales': ['paquetes', 'catalogo', 'dominios', 'proceso', 'preguntas-servicios'] }
const b = await chromium.launch({ executablePath: chromiumPath() })
const issues = []
for (const [label, vp, mobile] of [['movil', { width: 390, height: 844 }, true], ['tablet', { width: 820, height: 1180 }, true], ['escritorio', { width: 1440, height: 900 }, false]]) {
  const ctx = await b.newContext({ reducedMotion: 'reduce', viewport: vp, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, locale: 'es-CO' })
  for (const page of pages) {
    const p = await ctx.newPage()
    await p.goto(`http://localhost:4320/${page}`, { waitUntil: 'networkidle' })
    await p.evaluate(() => document.fonts.ready)
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth)
    if (overflow > 0) issues.push(`${label} ${page}: desborde horizontal ${overflow}px`)
    await p.screenshot({ path: `${out}/${page}--${label}.png` })
    for (const id of sections[page] || []) {
      await p.evaluate((i) => document.getElementById(i).scrollIntoView({ behavior: 'instant' }), id)
      await p.waitForTimeout(400)
      await p.screenshot({ path: `${out}/${page}--${id}--${label}.png` })
    }
    await p.close()
  }
  await ctx.close()
}
await b.close()
console.log(issues.length ? issues.join('\n') : 'sin desbordes horizontales')
