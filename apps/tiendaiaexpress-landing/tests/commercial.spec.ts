// Plans, comparator, WhatsApp messages, structured data, real stores and accessibility (axe + keyboard).
// Run against a local build: npm run build:official && node scripts/serve.mjs, then
// VITE_APP_URL=https://app.tiendiaexpres.com npx playwright test commercial
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

const APP = (process.env.VITE_APP_URL || 'https://catalogo-digital-ia.catalogo-lite-worker.workers.dev').replace(/\/+$/, '')
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

const card = (page: Page, name: string) => page.locator('#planes article').filter({ has: page.getByRole('heading', { name, exact: true }) })
const chooseAnnual = (page: Page) => page.locator('#planes label').filter({ hasText: 'Pago anual' }).click()

test.describe('plans and prices', () => {
  test('the prerendered HTML has the three plans and prices, and no old or promotional plan', async ({ request }) => {
    const raw = await (await request.get('/')).text()
    for (const text of ['Emprendedor', 'Negocio', 'Mayorista', '$59.900', '$149.000 COP', '$99.900', '$199.000 COP', '$169.900', '$299.000 COP', '$599.000 COP', '$999.000 COP', '$1.699.000 COP']) expect(raw, text).toContain(text)
    for (const text of ['Catálogo Lite', 'Catálogo IA', 'Soluciones a medida', 'Promocional', 'primeros 20', 'promoción de lanzamiento', 'en definición', 'Más vendido', 'más elegido']) expect(raw.toLowerCase(), text).not.toContain(text.toLowerCase())
  })

  test('no plan is advertised as unlimited', async ({ page }) => {
    await page.goto('/#planes')
    expect((await page.locator('#planes').innerText()).toLowerCase()).not.toContain('ilimitad')
  })

  test('the monthly/annual switch shows the verified figures', async ({ page }) => {
    await page.goto('/#planes')
    await expect(card(page, 'Emprendedor')).toContainText('Total del primer año: $867.800 COP')
    await expect(card(page, 'Negocio')).toContainText('Total del primer año: $1.397.800 COP')
    await expect(card(page, 'Mayorista')).toContainText('Total del primer año: $2.337.800 COP')
    await chooseAnnual(page)
    await expect(page.getByRole('radio', { name: 'Pago anual' })).toBeChecked()
    await expect(card(page, 'Emprendedor')).toContainText('Ahorras $268.800 COP')
    await expect(card(page, 'Negocio')).toContainText('Ahorras $398.800 COP')
    await expect(card(page, 'Mayorista')).toContainText('Ahorras $638.800 COP')
    await expect(card(page, 'Mayorista')).toContainText('sin pago inicial adicional')
  })

  test('each plan button opens WhatsApp naming the plan and the billing', async ({ page }) => {
    await page.goto('/#planes')
    const text = async () => new URL((await card(page, 'Negocio').locator('a[href^="https://wa.me/573506912734"]').getAttribute('href'))!).searchParams.get('text')!
    expect(await text()).toContain('plan Negocio de TiendIA Exprés con pago mensual')
    await chooseAnnual(page)
    expect(await text()).toContain('plan Negocio de TiendIA Exprés con pago anual ($999.000 COP al año')
  })

  test('"Solicitar con el formulario" fills the plan and billing in the contact form', async ({ page }) => {
    await page.goto('/#planes')
    await chooseAnnual(page)
    await card(page, 'Mayorista').getByRole('link', { name: 'Solicitar con el formulario' }).click()
    await expect(page.getByLabel('Plan de interés')).toHaveValue('Mayorista')
    await expect(page.getByLabel('Modalidad de pago')).toHaveValue('Pago anual')
  })

  test('JSON-LD offers match the published prices and contain no ratings or reviews', async ({ page }) => {
    await page.goto('/')
    const blocks = await page.$$eval('script[type="application/ld+json"]', (s) => s.map((x) => JSON.parse(x.textContent || '{}')))
    expect(blocks).toHaveLength(1)
    expect(JSON.stringify(blocks)).not.toMatch(/aggregateRating|review/i)
    const app = blocks[0]['@graph'].find((n: { '@type': string }) => n['@type'] === 'SoftwareApplication')
    const prices = app.offers.map((o: { price: number }) => o.price).sort((a: number, b: number) => a - b)
    expect(prices).toEqual([59900, 99900, 169900, 599000, 999000, 1699000])
  })
})

test.describe('whatsapp message tab', () => {
  test('shows the order message with the real format and labels the example customer', async ({ page }) => {
    await page.goto('/#demo')
    await page.getByRole('tab', { name: 'Mensaje de WhatsApp' }).click()
    const panel = page.locator('#showcase-panel')
    for (const text of ['Solicitud de pedido · SneakerHub Premium', 'PED-20261111-7F3A92C1', 'Kinetik Aero Carbon', 'SKU: KINETIK-06-40', 'Cantidad: 1 × 389.900 = 389.900', 'Subtotal: 389.900 COP', 'Envío: Por cotizar', `Ver producto: ${APP}/producto/KINETIK-06`]) await expect(panel, text).toContainText(text)
    await expect(panel).not.toContainText('seed-images')
    await expect(panel.getByRole('img', { name: /Vista previa del enlace/ })).toBeVisible()
    await expect(page.locator('#demo')).toContainText('el cliente y su dirección son de ejemplo')
    await page.waitForTimeout(800) // fade-in finished before measuring contrast
    const results = await new AxeBuilder({ page }).include('#demo').withTags(WCAG).analyze()
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target).join(' | ')}`)).toEqual([])
  })
})

test.describe('real stores', () => {
  // SneakerHub Premium is the demo store, not a merchant: it left "Tiendas reales" on 2026-11-13.
  test('only public store URLs are linked, without the demo store', async ({ page }) => {
    await page.goto('/#tiendas')
    const links = await page.locator('#tiendas a[href^="http"]').evaluateAll((as) => as.map((a) => a.getAttribute('href')!))
    expect(links).not.toContain(`${APP}/t/sneakerhub-premium`)
    expect(links).toContain(`${APP}/t/altogramaje-twin`)
    // Only public stores, plus the free trial invitation at the end of the section.
    for (const href of links) expect(href.startsWith(`${APP}/t/`) || href === `${APP}/prueba`, href).toBe(true)
  })
})

test.describe('accessibility', () => {
  test('axe: no WCAG 2.2 A/AA violations on the whole page', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(1200)
    const results = await new AxeBuilder({ page }).withTags(WCAG).analyze()
    expect(results.violations.map((v) => `${v.id} (${v.nodes.length}): ${v.nodes.slice(0, 3).map((n) => n.target).join(' | ')}`)).toEqual([])
  })

  test('axe: annual prices with reduced motion', async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: 'reduce' })
    const page = await ctx.newPage()
    await page.goto('/#planes')
    await chooseAnnual(page)
    const results = await new AxeBuilder({ page }).include('#planes').withTags(WCAG).analyze()
    expect(results.violations.map((v) => v.id)).toEqual([])
    await ctx.close()
  })

  test('billing switch, demo tabs and FAQ work with the keyboard', async ({ page }) => {
    await page.goto('/#planes')
    await page.getByRole('radio', { name: 'Pago mensual' }).focus()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('radio', { name: 'Pago anual' })).toBeChecked()
    await expect(card(page, 'Negocio')).toContainText('Ahorras $398.800 COP')

    await page.getByRole('tab', { name: 'Inicio' }).focus()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('tab', { name: 'Producto' })).toBeFocused()
    await expect(page.getByRole('tab', { name: 'Producto' })).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('End')
    await expect(page.getByRole('tab', { name: 'Mensaje de WhatsApp' })).toBeFocused()
    await expect(page.locator('#showcase-panel')).toContainText('Solicitud de pedido · SneakerHub Premium')

    await page.locator('#preguntas summary').first().focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('#preguntas details').first()).toHaveAttribute('open', '')
  })

  test('the mobile menu keeps the close button in the focus cycle', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile', 'mobile menu only')
    await page.goto('/')
    await page.getByRole('button', { name: 'Abrir menú' }).click()
    await expect(page.getByRole('dialog', { name: 'Menú' })).toBeVisible()
    const close = page.getByRole('button', { name: 'Cerrar menú' })
    await expect(close).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('dialog', { name: 'Menú' }).getByRole('link').first()).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect(close).toBeFocused()
    await page.keyboard.press('Shift+Tab') // wraps to the last control of the menu, never behind it
    await expect(page.getByRole('dialog', { name: 'Menú' }).getByRole('link').last()).toBeFocused()
    await close.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog', { name: 'Menú' })).toBeHidden()
  })
})
