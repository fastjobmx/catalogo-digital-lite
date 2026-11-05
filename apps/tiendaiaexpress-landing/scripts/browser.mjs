// Chromium for local screenshots/tests. Uses PW_CHROMIUM, or a Chromium already cached by
// Playwright on this machine, or Playwright's own download (npx playwright install chromium).
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export function chromiumPath() {
  if (process.env.PW_CHROMIUM) return process.env.PW_CHROMIUM
  const cache = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'ms-playwright') : null
  if (!cache || !existsSync(cache)) return undefined
  const builds = readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()
  for (const build of builds) {
    const exe = join(cache, build, 'chrome-win64', 'chrome.exe')
    if (existsSync(exe)) return exe
  }
  return undefined
}
