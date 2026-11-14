import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

// Legal pages (Terms and Conditions v1.1 and the add-on services). Served as /<page> like Cloudflare Pages.
const PAGES = [
  { path: '/terminos-y-condiciones', h1: 'Términos y Condiciones de Uso y Contratación' },
  { path: '/servicios-adicionales', h1: 'Servicios adicionales' },
]

test.describe('legal pages', () => {
  for (const { path, h1 } of PAGES) {
    test(`${path}: prerendered, one h1, no console errors and no WCAG A/AA violations`, async ({ page, request }) => {
      const raw = await (await request.get(path)).text()
      expect(raw).toContain(h1) // indexable HTML before any JS
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
    await expect(page.getByText('Versión 1.1').first()).toBeVisible()
    await expect(page.locator('time[datetime="2026-11-13"]')).toHaveCount(1)
    const ids = await page.locator('.legal-toc a').evaluateAll((as) => as.map((a) => a.getAttribute('href')!.slice(1)))
    expect(ids.length).toBeGreaterThan(37)
    for (const id of new Set(ids)) await expect(page.locator(`[id="${id}"]`)).toHaveCount(1)
    const text = await page.locator('main').innerText()
    expect(text).not.toMatch(/\[PENDIENTE|\bNIT\b|Raz[oó]n social|D[IÍ]AS Y HORAS|Borrador/i)
    await expect(page.locator('a[href="mailto:soporte@tiendiaexpres.com"]').first()).toBeVisible()
    await expect(page.locator('a[href="mailto:ventas@tiendiaexpres.com"]').first()).toBeVisible()
  })

  test('services: only the domain renewal is confirmed; SEO never promises rankings; no payment or checkout', async ({ page }) => {
    await page.goto('/servicios-adicionales')
    const confirmed = page.locator('#tarifario tr', { hasText: 'Precio confirmado' })
    await expect(confirmed).toHaveCount(1)
    await expect(confirmed).toContainText('Renovación anual de dominio estándar elegible')
    await expect(confirmed).toContainText('$120.000 COP')
    for (const name of ['SEO básico asistido', 'SEO avanzado, implementación inicial', 'SEO avanzado, optimización y seguimiento']) {
      await expect(page.locator('#tarifario tr', { hasText: name })).toContainText('Propuesto')
    }
    await expect(page.locator('#seo')).toContainText('Ningún servicio SEO garantiza aparecer en Google')
    await expect(page.locator('#seo')).not.toContainText(/garantizamos|primer lugar asegurado/i)
    await expect(page.locator('form, input[type="text"], [href*="checkout"], [href*="pago"]')).toHaveCount(0)
    for (const a of await page.locator('#seo a, #antes-de-contratar a').evaluateAll((as) => as.map((x) => x.getAttribute('href')!))) {
      expect(a.startsWith('mailto:ventas@tiendiaexpres.com'), a).toBe(true)
    }
  })
})
