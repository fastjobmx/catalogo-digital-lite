import { expect, test } from '@playwright/test'

const DEMO = 'https://catalogo-digital-ia.catalogo-lite-worker.workers.dev/'
const ADMIN = 'https://catalogo-digital-ia.catalogo-lite-worker.workers.dev/admin/login'

test.describe('page', () => {
  test('loads without console errors, with one h1 and prerendered content', async ({ page, request }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
    const raw = await (await request.get('/')).text()
    expect(raw).toContain('Si no lo') // content is in the HTML before any JS
    await page.goto('/')
    await expect(page).toHaveTitle(/MOSTRALO PUES!/)
    await expect(page.locator('h1:visible')).toHaveCount(1)
    await page.waitForTimeout(1500)
    expect(errors).toEqual([])
  })

  test('pre-launch indexing signals are consistent (noindex everywhere, no canonical, no sitemap)', async ({ page, request }) => {
    await page.goto('/')
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow')
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0)
    const robots = await (await request.get('/robots.txt')).text()
    expect(robots).toContain('Allow: /')
    expect(robots).not.toContain('Sitemap')
    expect((await request.get('/sitemap.xml')).status()).toBe(404)
    const headers = (await request.get('/')).headers()
    expect(headers['x-robots-tag']).toBe('noindex, nofollow')
    expect(headers['x-content-type-options']).toBe('nosniff')
  })

  test('every in-page link points to an existing section', async ({ page }) => {
    await page.goto('/')
    const hrefs = await page.$$eval('a[href^="#"]', (as) => [...new Set(as.map((a) => a.getAttribute('href')!))])
    for (const href of hrefs) expect(await page.locator(href).count(), href).toBe(1)
  })

  test('external links open in a new tab safely and use the configured destinations', async ({ page }) => {
    await page.goto('/')
    const external = await page.$$eval('a[href^="http"]', (as) => as.map((a) => ({ href: a.getAttribute('href')!, target: a.getAttribute('target'), rel: a.getAttribute('rel') || '' })))
    expect(external.length).toBeGreaterThan(5)
    for (const link of external) {
      expect(link.target, link.href).toBe('_blank')
      expect(link.rel, link.href).toContain('noopener')
    }
    const hrefs = external.map((l) => l.href)
    expect(hrefs).toContain(DEMO)
    expect(hrefs).toContain(ADMIN)
    expect(hrefs.some((h) => h.startsWith('https://wa.me/573506912734'))).toBe(true)
    for (const social of ['https://www.facebook.com/mostralopues/', 'https://www.instagram.com/mostralopues/', 'https://www.tiktok.com/@mostralopues']) expect(hrefs).toContain(social)
  })

  test('every image has an alt attribute', async ({ page }) => {
    await page.goto('/')
    expect(await page.locator('img:not([alt])').count()).toBe(0)
  })

  test('reduced motion shows the still layout with all three acts', async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: 'reduce' })
    const page = await ctx.newPage()
    await page.goto('/')
    await expect(page.locator('html')).toHaveClass(/still/)
    for (const verb of ['Mostrá', 'Organizá', 'Vendé']) await expect(page.locator('.still-only').getByText(verb, { exact: true })).toBeVisible()
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('.story-sticky')!).position)).not.toBe('sticky')
    await ctx.close()
  })
})

test.describe('contact form', () => {
  test('shows field errors and does not open WhatsApp when empty', async ({ page }) => {
    await page.goto('/#contacto')
    await page.evaluate(() => { (window as unknown as { __opened: string[] }).__opened = []; window.open = ((u: string) => { (window as unknown as { __opened: string[] }).__opened.push(u); return null }) as typeof window.open })
    await page.waitForTimeout(2600)
    await page.getByRole('button', { name: /preparar en whatsapp/i }).click()
    await expect(page.getByText('Escribí tu nombre.')).toBeVisible()
    await expect(page.getByText('Contanos qué vendés.')).toBeVisible()
    expect(await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened.length)).toBe(0)
  })

  test('prepares the WhatsApp message and tells the person they still have to send it', async ({ page }) => {
    await page.goto('/#contacto')
    await page.evaluate(() => { (window as unknown as { __opened: string[] }).__opened = []; window.open = ((u: string) => { (window as unknown as { __opened: string[] }).__opened.push(u); return { opener: null } as unknown as Window }) as typeof window.open })
    await page.getByLabel('Tu nombre').fill('Ana Prueba')
    await page.getByLabel('Nombre del negocio').fill('Tienda de prueba')
    await page.getByLabel('Ciudad').fill('Medellín')
    await page.getByLabel('¿Qué vendés?').fill('Ropa deportiva')
    await page.getByLabel('Plan de interés').selectOption('Catálogo IA')
    await page.waitForTimeout(2600) // anti-spam minimum fill time
    await page.getByRole('button', { name: /preparar en whatsapp/i }).click()
    await expect(page.getByText(/Recordá tocar «Enviar» en WhatsApp/)).toBeVisible()
    const opened = await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened)
    expect(opened).toHaveLength(1)
    const url = new URL(opened[0])
    expect(url.origin + url.pathname).toBe('https://wa.me/573506912734')
    const text = url.searchParams.get('text')!
    expect(text).toContain('Nombre: Ana Prueba')
    expect(text).toContain('Plan de interés: Catálogo IA')
  })

  test('a filled honeypot blocks the submission', async ({ page }) => {
    await page.goto('/#contacto')
    await page.evaluate(() => { (window as unknown as { __opened: string[] }).__opened = []; window.open = ((u: string) => { (window as unknown as { __opened: string[] }).__opened.push(u); return null }) as typeof window.open })
    await page.locator('#f-web').evaluate((el: HTMLInputElement) => { el.value = 'spam' })
    await page.getByLabel('Tu nombre').fill('Bot')
    await page.waitForTimeout(2600)
    await page.getByRole('button', { name: /preparar en whatsapp/i }).click()
    expect(await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened.length)).toBe(0)
  })
})

test.describe('keyboard', () => {
  test('skip link is the first stop and the mobile menu traps and returns focus', async ({ page }, info) => {
    await page.goto('/')
    await page.keyboard.press('Tab')
    await expect(page.getByRole('link', { name: 'Saltar al contenido' })).toBeFocused()
    if (info.project.name !== 'mobile') return
    const toggle = page.getByRole('button', { name: 'Abrir menú' })
    await toggle.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog', { name: 'Menú' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Menú' })).toBeHidden()
    await expect(page.getByRole('button', { name: 'Abrir menú' })).toBeFocused()
  })
})
