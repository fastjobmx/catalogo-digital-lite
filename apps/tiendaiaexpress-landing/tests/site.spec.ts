import { expect, test } from '@playwright/test'
// Platform app URL the site was built with (VITE_APP_URL), same default as vite.config.ts.
const APP = (process.env.VITE_APP_URL || 'https://catalogo-digital-ia.catalogo-lite-worker.workers.dev').replace(/\/+$/, '')

const DEMO = `${APP}/`
const ADMIN = `${APP}/admin/login`
const TRIAL = `${APP}/prueba`

test.describe('page', () => {
  test('loads without console errors, with one h1 and prerendered content', async ({ page, request }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
    const raw = await (await request.get('/')).text()
    expect(raw).toContain('Tu tienda') // content is in the HTML before any JS
    await page.goto('/')
    await expect(page).toHaveTitle(/TiendIA Exprés/)
    await expect(page.locator('h1:visible')).toHaveCount(1)
    await page.waitForTimeout(1500)
    expect(errors).toEqual([])
  })

  // The build decides (VITE_ALLOW_INDEXING): every signal must agree with the meta robots tag.
  test('indexing signals are consistent (pre-launch: noindex everywhere; official: canonical + sitemap)', async ({ page, request }) => {
    const raw = await (await request.get('/')).text()
    const indexable = raw.includes('content="index, follow')
    await page.goto('/')
    const robots = await (await request.get('/robots.txt')).text()
    expect(robots).toContain('Allow: /')
    const headers = (await request.get('/')).headers()
    expect(headers['x-content-type-options']).toBe('nosniff')
    if (indexable) {
      const canonical = await page.locator('link[rel="canonical"]').getAttribute('href')
      expect(canonical).toMatch(/^https:\/\/[^/]+\/$/)
      await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', canonical!)
      expect(robots).toContain(`Sitemap: ${canonical}sitemap.xml`)
      const sitemap = await (await request.get('/sitemap.xml')).text()
      expect(sitemap).toContain(`<loc>${canonical}</loc>`)
      expect(headers['x-robots-tag']).toBeUndefined()
    } else {
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow')
      await expect(page.locator('link[rel="canonical"]')).toHaveCount(0)
      expect(robots).not.toContain('Sitemap')
      expect((await request.get('/sitemap.xml')).status()).toBe(404)
      expect(headers['x-robots-tag']).toBe('noindex, nofollow')
    }
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
    expect(hrefs).toContain(TRIAL)
    expect(hrefs.some((h) => h.startsWith('https://wa.me/573506912734'))).toBe(true)
    for (const social of ['https://www.facebook.com/tiendiaexpres/', 'https://www.instagram.com/tiendiaexpres/', 'https://www.tiktok.com/@tiendiaexpres']) expect(hrefs).toContain(social)
  })

  test('every image has an alt attribute', async ({ page }) => {
    await page.goto('/')
    expect(await page.locator('img:not([alt])').count()).toBe(0)
  })

  test('reduced motion shows every section without entrance animations', async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: 'reduce' })
    const page = await ctx.newPage()
    await page.goto('/')
    await expect(page.locator('html')).toHaveClass(/still/)
    for (const step of ['Sube tus productos', 'Comparte tu enlace', 'Recibe pedidos por WhatsApp']) await expect(page.locator('#como-funciona').getByRole('heading', { name: step })).toBeVisible()
    const hidden = await page.$$eval('[data-reveal], .hero-in', (els) => els.filter((el) => getComputedStyle(el).opacity !== '1').length)
    expect(hidden).toBe(0)
    await ctx.close()
  })

  test('the header has one trial button and one panel link, and every section of the menu exists', async ({ page }) => {
    await page.goto('/')
    const header = page.locator('#root > header')
    await expect(header.locator(`a[href="${TRIAL}"]`)).toHaveCount(1)
    await expect(header.locator(`a[href="${ADMIN}"]`)).toHaveCount(1)
    for (const id of ['inicio', 'funciones', 'como-funciona', 'tiendas', 'demo', 'estudio', 'administracion', 'planes', 'preguntas', 'contacto']) await expect(page.locator(`#${id}`)).toHaveCount(1)
  })

  test('copy uses Colombian "tú" (no voseo) and the trial conditions of the live /prueba page', async ({ request }) => {
    const raw = await (await request.get('/')).text()
    const text = raw.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ')
    const voseo = text.match(/(?<![\p{L}])(vos|tenés|querés|podés|sabés|hacés|vendés|creá|mostrá|administrá|organizá|vendé|subís|compartís|elegí|escribí|contanos|escribinos|mirá|explorá|probalo|armá|pagás|ahorrás|recordá|revisá|consultá|solicitá|descubrí|conocé|empezá|cambiá|cargá|sumá|seguí|importá|mejorá|pidás)(?![\p{L}])/giu)
    expect(voseo ?? []).toEqual([])
    expect(text).toContain('Sin correo ni contraseña')
    expect(text).not.toMatch(/48 horas|sin registrarte|12 productos/i)
  })
})

test.describe('contact form', () => {
  test('shows field errors and does not open WhatsApp when empty', async ({ page }) => {
    await page.goto('/#contacto')
    await page.evaluate(() => { (window as unknown as { __opened: string[] }).__opened = []; window.open = ((u: string) => { (window as unknown as { __opened: string[] }).__opened.push(u); return null }) as typeof window.open })
    await page.waitForTimeout(2600)
    await page.getByRole('button', { name: /preparar en whatsapp/i }).click()
    await expect(page.getByText('Escribe tu nombre.')).toBeVisible()
    await expect(page.getByText('Cuéntanos qué vendes.')).toBeVisible()
    expect(await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened.length)).toBe(0)
  })

  test('prepares the WhatsApp message and tells the person they still have to send it', async ({ page }) => {
    await page.goto('/#contacto')
    await page.evaluate(() => { (window as unknown as { __opened: string[] }).__opened = []; window.open = ((u: string) => { (window as unknown as { __opened: string[] }).__opened.push(u); return { opener: null } as unknown as Window }) as typeof window.open })
    await page.getByLabel('Tu nombre').fill('Ana Prueba')
    await page.getByLabel('Nombre del negocio').fill('Tienda de prueba')
    await page.getByLabel('Ciudad').fill('Medellín')
    await page.getByLabel('¿Qué vendes?').fill('Ropa deportiva')
    await page.getByLabel('Plan de interés').selectOption('Negocio')
    await page.getByLabel('Modalidad de pago').selectOption('Pago anual')
    await page.waitForTimeout(2600) // anti-spam minimum fill time
    await page.getByRole('button', { name: /preparar en whatsapp/i }).click()
    await expect(page.getByText(/Recuerda tocar «Enviar» en WhatsApp/)).toBeVisible()
    const opened = await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened)
    expect(opened).toHaveLength(1)
    const url = new URL(opened[0])
    expect(url.origin + url.pathname).toBe('https://wa.me/573506912734')
    const text = url.searchParams.get('text')!
    expect(text).toContain('Nombre: Ana Prueba')
    expect(text).toContain('Plan de interés: Negocio')
    expect(text).toContain('Modalidad de pago: Pago anual')
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
