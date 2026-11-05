import { defineConfig, devices } from '@playwright/test'
import { chromiumPath } from './scripts/browser.mjs'

// Runs against a local build: `npm run build && node scripts/serve.mjs` (port 4318), or BASE_URL.
const executablePath = chromiumPath()
export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  reporter: [['list']],
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:4318',
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, launchOptions: executablePath ? { executablePath } : {} } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, launchOptions: executablePath ? { executablePath } : {} } },
  ],
})
