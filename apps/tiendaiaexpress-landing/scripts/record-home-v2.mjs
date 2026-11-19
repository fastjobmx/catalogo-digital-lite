// Motion evidence for the Home V2 preview: a short .webm per viewport (Playwright recordVideo, uses the
// ffmpeg already cached by Playwright) plus timestamped frames of the hero/demo.
// Usage: node scripts/record-home-v2.mjs <url> <outDir>
import { mkdir, rename, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from '@playwright/test'
import { chromiumPath } from './browser.mjs'

const [url = 'http://localhost:4321/home-v2', out = 'docs/home-v2-capturas/fase-e'] = process.argv.slice(2)
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ executablePath: chromiumPath() })

const VIEWPORTS = [
  { name: 'desktop-1440', width: 1440, height: 900 },
  { name: 'mobile-390', width: 390, height: 844, mobile: true },
]
const FRAMES_MS = [0, 400, 900, 1500, 2500, 3500, 4500, 6000, 7500]

for (const vp of VIEWPORTS) {
  const videoDir = join(out, `video-${vp.name}`)
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    isMobile: Boolean(vp.mobile), hasTouch: Boolean(vp.mobile), deviceScaleFactor: 1,
    recordVideo: { dir: videoDir, size: { width: vp.width, height: vp.height } },
  })
  const page = await ctx.newPage()
  const t0 = Date.now()
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  const target = page.locator('#inicio')
  for (const at of FRAMES_MS) {
    const wait = at - (Date.now() - t0)
    if (wait > 0) await page.waitForTimeout(wait)
    const stage = await page.locator('figure[aria-labelledby="demo-caption"]').getAttribute('data-stage').catch(() => null)
    await target.screenshot({ path: join(out, `${vp.name}-t${String(Date.now() - t0).padStart(5, '0')}ms-stage${stage ?? 'na'}.jpg`), type: 'jpeg', quality: 70 })
  }
  // Explicit play («Ver el cambio»): the sequence runs in place, the page does not move.
  const playBtn = page.getByRole('button', { name: 'Ver el cambio' })
  if (await playBtn.count()) { await playBtn.click(); await page.waitForTimeout(5600) }
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(700)
  // Natural scroll through the page: the story is driven by the scroll, then the other scenes.
  await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 180) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 190)) } })
  const admin = page.locator('#administracion')
  await admin.scrollIntoViewIfNeeded()
  await page.waitForTimeout(600)
  const tabs = admin.getByRole('tab')
  for (let i = 0; i < (await tabs.count()); i++) { await tabs.nth(i).click(); await page.waitForTimeout(700) }
  await page.waitForTimeout(500)
  await ctx.close()
  const files = await readdir(videoDir)
  const webm = files.find((f) => f.endsWith('.webm'))
  if (webm) await rename(join(videoDir, webm), join(out, `${vp.name}.webm`))
}
await browser.close()
console.log('ok', out)
