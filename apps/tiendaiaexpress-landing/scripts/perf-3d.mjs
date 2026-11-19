// Frame-time measurement of the V2 3D scenes: node scripts/perf-3d.mjs <url>
// For each profile (desktop; phone emulation with 4x CPU throttling) it scrolls through the page and
// records frame intervals (rAF) and long tasks. Indicative only (headless Chromium on this machine).
import { chromium } from '@playwright/test'
import { chromiumPath } from './browser.mjs'

const [url] = process.argv.slice(2)
const browser = await chromium.launch({ executablePath: chromiumPath() })
for (const prof of [{ name: 'escritorio 1440', w: 1440, h: 900 }, { name: 'móvil 390 · CPU x4', w: 390, h: 844, m: true, cpu: 4 }]) {
  const ctx = await browser.newContext({ viewport: { width: prof.w, height: prof.h }, isMobile: !!prof.m, hasTouch: !!prof.m, reducedMotion: 'no-preference' })
  const page = await ctx.newPage()
  if (prof.cpu) { const cdp = await ctx.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: prof.cpu }) }
  await page.goto(`${url}?force3d`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(3500)
  const res = await page.evaluate(async () => {
    const frames = []; const longs = []
    new PerformanceObserver((l) => l.getEntries().forEach((e) => longs.push(e.duration))).observe({ type: 'longtask', buffered: false })
    let last = performance.now(); let run = true
    const tick = (t) => { frames.push(t - last); last = t; if (run) requestAnimationFrame(tick) }
    requestAnimationFrame(tick)
    const H = document.documentElement.scrollHeight - innerHeight
    for (let y = 0; y < H; y += 40) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 16)) }
    run = false
    frames.sort((a, b) => a - b)
    const pct = (p) => frames[Math.floor(frames.length * p)]
    return { frames: frames.length, p50: pct(0.5), p95: pct(0.95), over33: frames.filter((f) => f > 33.4).length, longTasks: longs.length, longest: Math.max(0, ...longs), canvases: document.querySelectorAll('canvas').length }
  })
  console.log(prof.name, JSON.stringify(res, (k, v) => (typeof v === 'number' ? Math.round(v * 10) / 10 : v)))
  await ctx.close()
}
await browser.close()
