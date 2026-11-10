// Live destination check (network). Run before publishing: npx playwright test links --project=desktop
import { expect, test } from '@playwright/test'
// Platform app URL the site was built with (VITE_APP_URL), same default as vite.config.ts.
const APP = (process.env.VITE_APP_URL || 'https://catalogo-digital-ia.catalogo-lite-worker.workers.dev').replace(/\/+$/, '')

test.describe.configure({ mode: 'serial' })

const MUST_WORK = [
  `${APP}/`,
  `${APP}/admin/login`,
  `${APP}/prueba`,
]
// Social networks often answer bots with redirects to a login page or 4xx: reported, not asserted.
const REPORT_ONLY = [
  'https://wa.me/573506912734',
  'https://www.facebook.com/tiendiaexpres/',
  'https://www.instagram.com/tiendiaexpres/',
  'https://www.tiktok.com/@tiendiaexpres',
]

test('demo store and admin login answer 200', async ({ request }) => {
  for (const url of MUST_WORK) expect((await request.get(url)).status(), url).toBe(200)
})

test('contact and social destinations (report)', async ({ page }) => {
  for (const url of REPORT_ONLY) {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => null)
    const title = await page.title().catch(() => '')
    console.log(`${response?.status() ?? 'no response'}  ${url}  →  ${page.url()}  «${title.slice(0, 70)}»`)
  }
})
