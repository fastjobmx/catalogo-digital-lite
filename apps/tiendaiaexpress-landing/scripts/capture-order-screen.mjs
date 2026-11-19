// Renders the order-message screen (src/components/ui/OrderMessage, the platform's exact format with an
// example customer) to an image, so the WebGL phone can show it: node scripts/capture-order-screen.mjs <url> <out.png>
import { chromium } from '@playwright/test'
import { chromiumPath } from './browser.mjs'
const [url, out] = process.argv.slice(2)
const b = await chromium.launch({ executablePath: chromiumPath() })
const p = await b.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2, reducedMotion: 'reduce' })
await p.goto(url, { waitUntil: 'networkidle' })
const screen = p.locator('#comprar .v2-journey-step').nth(2).locator('.v2-journey-phone > div').first()
await screen.evaluate((el) => { [...el.children].filter((c) => c.getAttribute('aria-hidden') === 'true' && c.className.includes('pointer-events-none')).forEach((c) => { c.style.display = 'none' }); el.style.borderRadius = '0' })
await screen.screenshot({ path: out })
await b.close()
console.log('ok')
