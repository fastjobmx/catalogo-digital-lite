import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

// Legal pages (Terms and Conditions v1.2 and the add-on services). Served as /<page> like Cloudflare Pages.
const PAGES = [
  { path: '/terminos-y-condiciones', h1: 'Términos y Condiciones de Uso y Contratación', raw: 'Términos y Condiciones de Uso y Contratación' },
  { path: '/servicios-adicionales', h1: 'Tu negocio merece ir más allá.', raw: 'Elige lo que tu negocio necesita' },
]

test.describe('legal pages', () => {
  for (const { path, h1, raw: inHtml } of PAGES) {
    test(`${path}: prerendered, one h1, no console errors and no WCAG A/AA violations`, async ({ page, request }) => {
      const raw = await (await request.get(path)).text()
      expect(raw).toContain(inHtml) // indexable HTML before any JS
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(e.message))
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
      await page.goto(path)
      await expect(page.locator('h1')).toHaveText(h1)
      await expect(page.locator('h1')).toHaveCount(1)
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0)
      const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
      expect(axe.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([])
      expect(errors).toEqual([])
    })

    test(`${path}: the footer links both legal pages and sends section anchors to the home page`, async ({ page }) => {
      await page.goto(path)
      const footer = page.locator('footer')
      await expect(footer.locator('a[href="/terminos-y-condiciones"]')).toHaveCount(1)
      await expect(footer.locator('a[href="/servicios-adicionales"]')).toHaveCount(1)
      await expect(footer.locator('a[href="/#planes"]')).toHaveCount(1)
      await expect(footer.locator('a[href^="#"]:not([href="#inicio"])')).toHaveCount(0)
    })
  }

  test('the home page footer links the legal pages', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('footer a[href="/terminos-y-condiciones"]')).toHaveCount(1)
    await expect(page.locator('footer a[href="/servicios-adicionales"]')).toHaveCount(1)
  })

  test('terms: version and date, index anchors that exist, and no pending identification fields', async ({ page }) => {
    await page.goto('/terminos-y-condiciones')
    await expect(page.getByText('Versión 1.2').first()).toBeVisible()
    await expect(page.locator('time[datetime="2026-11-14"]')).toHaveCount(1)
    await expect(page.locator('#historial-versiones + ul li')).toHaveCount(2)
    // v1.2: launch prices confirmed, the same as the services catalogue.
    const doc = page.locator('.legal-doc')
    for (const text of ['$99.000 COP por el primer año', 'Precio: $79.000 COP por tienda', 'Precio: $179.000 COP', 'Precio: $129.000 COP mensuales']) await expect(doc).toContainText(text)
    await expect(doc).not.toContainText('— propuesto')
    const ids = await page.locator('.legal-toc a').evaluateAll((as) => as.map((a) => a.getAttribute('href')!.slice(1)))
    expect(ids.length).toBeGreaterThan(37)
    for (const id of new Set(ids)) await expect(page.locator(`[id="${id}"]`)).toHaveCount(1)
    const text = await page.locator('main').innerText()
    expect(text).not.toMatch(/\[PENDIENTE|\bNIT\b|Raz[oó]n social|D[IÍ]AS Y HORAS|Borrador/i)
    await expect(page.locator('a[href="mailto:soporte@tiendiaexpres.com"]').first()).toBeVisible()
    await expect(page.locator('a[href="mailto:ventas@tiendiaexpres.com"]').first()).toBeVisible()
  })

  test('services: 50 contractable services, all confirmed, + 4 upcoming, quotes by e-mail, no payments', async ({ page }) => {
    await page.goto('/servicios-adicionales')
    const cards = page.locator('#catalogo ul').first().locator(':scope > li')
    await expect(cards).toHaveCount(50)
    await expect(page.locator('#catalogo')).toContainText('50 de 50 servicios')
    // Launch prices confirmed by the owner on 2026-11-14: every contractable service and package.
    await expect(page.locator('#catalogo article', { hasText: 'Precio confirmado' })).toHaveCount(50)
    await expect(page.locator('main')).not.toContainText('Precio propuesto')
    await expect(page.locator('#paquetes article', { hasText: 'Precio confirmado' })).toHaveCount(3)
    await expect(page.locator('#catalogo article', { hasText: 'Renovación de dominio estándar' })).toContainText('$120.000')
    // Upcoming services cannot be quoted.
    const upcoming = page.locator('#catalogo li', { hasText: 'Próximamente' })
    await expect(upcoming).toHaveCount(4)
    await expect(upcoming.locator('a')).toHaveCount(0)
    // Every quote goes to ventas@ by e-mail; nothing to pay on the page.
    const hrefs = await page.locator('#catalogo a, #paquetes a').evaluateAll((as) => as.map((a) => a.getAttribute('href')!))
    for (const h of hrefs) expect(h.startsWith('mailto:ventas@tiendiaexpres.com'), h).toBe(true)
    await expect(page.locator('form, [href*="checkout"], [href*="pago"]')).toHaveCount(0)
    await expect(page.locator('main')).toContainText('soporte@tiendiaexpres.com')
  })

  test('services: search and category filters narrow the catalogue', async ({ page }) => {
    await page.goto('/servicios-adicionales')
    await page.getByRole('button', { name: 'SEO', exact: true }).click()
    await expect(page.getByRole('button', { name: 'SEO', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('#catalogo')).toContainText('6 de 50 servicios')
    await page.getByRole('button', { name: 'Todos' }).click()
    await page.getByLabel('Buscar por nombre o necesidad').fill('logotipo')
    await expect(page.locator('#catalogo')).toContainText('2 de 50 servicios')
    await expect(page.locator('#catalogo article').first()).toContainText('Diseño de logotipo')
    await page.getByLabel('Buscar por nombre o necesidad').fill('zzzz')
    await expect(page.locator('#catalogo')).toContainText('No encontramos ese servicio')
  })

  test('services: services that resemble a plan feature explain what the plan already includes', async ({ page }) => {
    await page.goto('/servicios-adicionales')
    for (const name of ['Carga asistida de 50 productos', 'Diseño de pieza publicitaria', 'Personalización avanzada de tienda']) {
      await expect(page.locator('#catalogo article', { hasText: name })).toContainText(/tu plan/i)
    }
    await expect(page.locator('main')).toContainText('No se garantizan posiciones')
  })
})
