// Home V2 prototype (/home-v2). Only exists in a preview build:
//   VITE_HOME_V2=preview npm run build:official && node scripts/serve.mjs 4321
//   BASE_URL=http://localhost:4321 VITE_APP_URL=https://app.tiendiaexpres.com npx playwright test home-v2
// Against an official build (no /home-v2) every test is skipped. The V2 as the home page (test URL build):
//   npm run build:home-v2 && node scripts/serve.mjs 4323
//   BASE_URL=http://localhost:4323 HOME_V2_PATH=/ VITE_APP_URL=https://app.tiendiaexpres.com npx playwright test home-v2
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

const APP = (process.env.VITE_APP_URL || 'https://catalogo-digital-ia.catalogo-lite-worker.workers.dev').replace(/\/+$/, '')
const TRIAL = `${APP}/registro`
const ADMIN = `${APP}/admin/login`
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
const URL = process.env.HOME_V2_PATH || '/home-v2'

test.beforeEach(async ({ request }) => {
  const res = await request.get(URL)
  test.skip(res.status() !== 200, 'Not a preview build: /home-v2 is not part of this artefact')
})

/** Every request the page makes must stay on the local origin (no backend, no third parties). */
function watchRequests(page: Page) {
  const external: string[] = []
  page.on('request', (req) => {
    const url = new globalThis.URL(req.url())
    if (url.protocol.startsWith('http') && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') external.push(req.url())
  })
  return external
}

test.describe('home v2', () => {
  test('is prerendered, noindex, with one h1 and no console errors', async ({ page, request }) => {
    const raw = await (await request.get(URL)).text()
    expect(raw).toContain('<meta name="robots" content="noindex, nofollow" />')
    expect(raw).not.toContain('rel="canonical"')
    expect(raw).toContain('Bajo tu control.')
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
    await page.goto(URL)
    await expect(page.locator('h1:visible')).toHaveCount(1)
    await expect(page.locator('h1')).toHaveText('Tu tienda. Bajo tu control.')
    await page.waitForTimeout(1500)
    expect(errors).toEqual([])
  })

  // Hero + story: ONE product stage driven by the scroll (Fase G). No autoplay; «Ver el cambio» plays it.
  const hs = (page: Page) => page.locator('#inicio')
  /** Scrolls to progress t (0…1) of the story; the story uses the first STORY_SHARE of the sticky track and
   * the rest is the portal into the light scenes (HeroStory.tsx). */
  const STORY_SHARE = 0.72
  const scrollTo = (page: Page, t: number, portal = 0) => page.evaluate(([t, portal, share]) => {
    const el = document.querySelector<HTMLElement>('#inicio')!
    window.scrollTo(0, el.offsetTop + (el.offsetHeight - window.innerHeight) * (t * share + portal * (1 - share)))
  }, [t, portal, STORY_SHARE])

  test('first viewport: headline, CTA and the price that will change are visible without scrolling', async ({ page }) => {
    await page.goto(URL)
    await expect(page.getByRole('link', { name: /Crear mi tienda gratis/ }).first()).toBeInViewport()
    const m = await page.evaluate(() => {
      const vh = innerHeight
      const store = document.querySelector('.hs-store')!.getBoundingClientRect()
      const price = document.querySelector('.hs-card.is-target .hs-price')!.getBoundingClientRect()
      return { productShare: (vh - Math.max(0, store.top)) / vh, priceBottom: price.bottom, vh }
    })
    expect(m.productShare).toBeGreaterThanOrEqual(0.4)
    expect(m.priceBottom).toBeLessThanOrEqual(m.vh)
    await expect(hs(page)).toHaveAttribute('data-stage-key', 'pedido')
  })

  test('scroll drives the story both ways: request → summary → confirmation → updated price', async ({ page }) => {
    const external = watchRequests(page)
    await page.goto(URL)
    await scrollTo(page, 0.32)
    await expect(hs(page)).toHaveAttribute('data-stage-key', 'escribiendo')
    await expect(hs(page)).toHaveAttribute('data-moment', '0')
    await scrollTo(page, 0.55)
    await expect(hs(page)).toHaveAttribute('data-stage-key', 'resumen')
    await scrollTo(page, 0.66)
    await expect(hs(page)).toHaveAttribute('data-stage-key', 'confirmado')
    await expect(hs(page)).toHaveAttribute('data-moment', '1')
    await scrollTo(page, 1)
    await expect(hs(page)).toHaveAttribute('data-stage-key', 'tienda')
    await expect(hs(page)).toHaveAttribute('data-moment', '2')
    await expect(page.locator('.hs-card.is-target .v2-price[data-updated="true"] .v2-price-new')).toHaveText('$ 199.900')
    await expect(page.locator('.hs-card.is-target').getByText('Actualizado', { exact: true })).toBeVisible()
    // Reversible: back to the top brings the request state back.
    await scrollTo(page, 0)
    await expect(hs(page)).toHaveAttribute('data-stage-key', 'pedido')
    expect(external).toEqual([])
  })

  test('«Ver el cambio» plays the sequence once without moving the page; a wheel gives control back', async ({ page }) => {
    // ?no3d: the fake clock of this test and the deferred WebGL loading do not mix; the story is the same.
    await page.clock.install()
    await page.goto(`${URL}?no3d`)
    await page.getByRole('button', { name: 'Ver el cambio' }).click()
    // Measured after the click (Playwright may scroll the button into view to click it).
    const before = await page.evaluate(() => window.scrollY)
    await expect(hs(page)).toHaveAttribute('data-playing', 'true')
    await page.clock.runFor(5200)
    await expect(hs(page)).toHaveAttribute('data-stage-key', 'tienda')
    await expect(hs(page)).toHaveAttribute('data-playing', 'false')
    expect(await page.evaluate(() => window.scrollY)).toBe(before)
    await expect(page.getByRole('button', { name: 'Repetir el cambio' })).toBeVisible()
    // Nothing plays by itself: after a long wait at the top, a fresh load stays on the request.
    await page.goto(`${URL}?no3d`)
    await page.clock.runFor(20_000)
    await expect(hs(page)).toHaveAttribute('data-stage-key', 'pedido')
  })

  test('«Ver cómo funciona» plays the story in place (motion) and is a plain link to the steps (no JS)', async ({ page, browser }) => {
    await page.clock.install()
    await page.goto(URL)
    await page.locator('#inicio').getByRole('link', { name: 'Ver cómo funciona' }).click()
    await expect(hs(page)).toHaveAttribute('data-playing', 'true')
    const ctx = await browser.newContext({ javaScriptEnabled: false })
    const noJs = await ctx.newPage()
    await noJs.goto(URL)
    await expect(noJs.locator('#inicio').getByRole('link', { name: 'Ver cómo funciona' })).toHaveAttribute('href', '#como-funciona')
    await expect(noJs.locator('#como-funciona ol > li')).toHaveCount(3)
    await expect(noJs.locator('#como-funciona')).toBeVisible()
    await ctx.close()
  })

  test('reduced motion: a still stage, the three moments as visible text, no animation', async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: 'reduce' })
    const page = await ctx.newPage()
    await page.goto(URL)
    await expect(page.locator('html')).toHaveClass(/still/)
    await expect(page.locator('#como-funciona')).toBeVisible()
    for (const t of ['Un mensaje.', 'Lo confirmas.', 'Tu tienda, actualizada.']) await expect(page.locator('#como-funciona').getByRole('heading', { level: 3, name: t })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Ver el cambio' })).toBeHidden()
    const animated = await page.$$eval('.v2-enter, .v2-enter-stage', (els) => els.filter((el) => getComputedStyle(el).animationName !== 'none').length)
    expect(animated).toBe(0)
    const hidden = await page.$$eval('[data-v2-item]', (els) => els.filter((el) => getComputedStyle(el).opacity !== '1').length)
    expect(hidden).toBe(0)
    await ctx.close()
  })

  test('the stage has no neon violet or cyan glows', async ({ page }) => {
    await page.goto(URL)
    const glows = await page.locator('#inicio *').evaluateAll((els) => els.filter((el) => /rgba?\((197, 42, 241|18, 220, 231)/.test(getComputedStyle(el).boxShadow + getComputedStyle(el).backgroundImage)).length)
    expect(glows).toBe(0)
  })

  test('header: one trial button and one panel link; every in-page link has its target', async ({ page }) => {
    await page.goto(URL)
    const header = page.locator('#root > header')
    await expect(header.locator(`a[href="${TRIAL}"]`)).toHaveCount(1)
    await expect(header.locator(`a[href="${ADMIN}"]`)).toHaveCount(1)
    for (const id of ['inicio', 'como-funciona', 'funciones', 'estudio', 'tiendas', 'administracion', 'planes', 'condiciones', 'preguntas', 'contacto']) await expect(page.locator(`#${id}`)).toHaveCount(1)
    const anchors = await page.locator('a[href^="#"]').evaluateAll((as) => [...new Set(as.map((a) => a.getAttribute('href')!.slice(1)).filter(Boolean))])
    for (const id of anchors) expect(await page.locator(`[id="${id}"]`).count(), `#${id}`).toBe(1)
    await expect(page.locator('#inicio').getByRole('link', { name: /Crear mi tienda gratis/ })).toHaveAttribute('href', TRIAL)
    await expect(page.locator('#inicio').getByRole('link', { name: 'Ver cómo funciona' })).toHaveAttribute('href', '#como-funciona')
  })

  test('the CSP lets the scrubbed 3D clips play from memory (blob: media)', async ({ request }) => {
    // scripts/serve.mjs drops the CSP locally, so the deployed header is checked in the file itself.
    const headers = await (await request.get('/_headers')).text()
    expect(headers).toContain("media-src 'self' blob:")
  })

  test('copy: buyer vs owner, no invented promises, plans unchanged, no voseo', async ({ request }) => {
    const raw = await (await request.get(URL)).text()
    const text = raw.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ')
    expect(text).toContain('Tus clientes no hablan con el asistente')
    expect(text).toContain('Sin tarjeta de crédito')
    for (const banned of ['24/7', 'ilimitad', 'siempre disponible', 'garantizad']) expect(text.toLowerCase(), banned).not.toContain(banned)
    // Round-the-clock only for Telegram (owner decision 2026-11-19); WhatsApp in office hours, never a set schedule.
    for (const m of text.matchAll(/24 horas/g)) expect(text.slice(Math.max(0, m.index! - 60), m.index!), 'las 24 horas solo para Telegram').toContain('Telegram')
    expect(text).toContain('en horario de oficina')
    // Plans come from plans.ts: same prices, the team from Negocio and one AI quota for both channels.
    for (const price of ['$59.900', '$99.900', '$169.900', 'Varios administradores con roles', 'Asistente en WhatsApp y Telegram: hasta 500 mensajes IA al mes, entre los dos canales']) expect(text).toContain(price)
    const voseo = text.match(/(?<![\p{L}])(vos|tenés|querés|podés|sabés|hacés|vendés|creá|mostrá|administrá|escribí|mirá|probalo|armá|cambiá|cargá)(?![\p{L}])/giu)
    expect(voseo ?? []).toEqual([])
  })

  test('only public store URLs in "Tiendas reales"', async ({ page }) => {
    await page.goto(URL)
    const links = await page.locator('#tiendas a[href^="http"]').evaluateAll((as) => as.map((a) => a.getAttribute('href')!))
    expect(links.length).toBeGreaterThan(0)
    for (const href of links) expect(href.startsWith(`${APP}/t/`), href).toBe(true)
    expect(links).not.toContain(`${APP}/t/sneakerhub-premium`)
  })

  test('no horizontal overflow at 360, 390, 768 and 1440 px', async ({ browser }) => {
    for (const width of [360, 390, 768, 1440]) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 } })
      const page = await ctx.newPage()
      await page.goto(URL)
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(overflow, `${width}px`).toBeLessThanOrEqual(0)
      await ctx.close()
    }
  })

  test('phones lay the page out at the device width (no zoomed-out page), with and without motion', async ({ browser }) => {
    for (const reducedMotion of ['reduce', 'no-preference'] as const) {
      for (const width of [360, 390]) {
        const ctx = await browser.newContext({ viewport: { width, height: 800 }, isMobile: true, hasTouch: true, reducedMotion })
        const page = await ctx.newPage()
        await page.goto(URL)
        expect(await page.evaluate(() => innerWidth), `${width}px ${reducedMotion}`).toBe(width)
        await ctx.close()
      }
    }
  })

  test('plans: the billing switch updates every card; phones get a plan selector', async ({ page }) => {
    await page.goto(URL)
    const plansSection = page.locator('#planes')
    await plansSection.locator('input[value="anual"]').check({ force: true })
    await expect(plansSection.getByText('Ahorras')).toHaveCount(3)
    await expect(plansSection.locator('#plan-card-negocio')).toContainText('999.000')
    await plansSection.locator('input[value="mensual"]').check({ force: true })
    await expect(plansSection.locator('#plan-card-negocio')).toContainText('99.900')
    const selector = plansSection.getByRole('group', { name: 'Ir a un plan' })
    if (await selector.isVisible()) {
      await selector.getByRole('button', { name: 'Mayorista' }).click()
      await expect(selector.getByRole('button', { name: 'Mayorista' })).toHaveAttribute('aria-current', 'true')
    }
  })

  test('real 3D (WebGL): the hero space and the stores ring start without errors; never with reduced motion', async ({ browser, page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
    const ctx = await browser.newContext({ reducedMotion: 'reduce' })
    const still = await ctx.newPage()
    await still.goto(`${URL}?force3d`)
    await still.waitForTimeout(2500)
    await expect(still.locator('.hs-world canvas, .v2-ring canvas')).toHaveCount(0)
    await ctx.close()
    await page.goto(URL)
    const webgl = await page.evaluate(() => Boolean(document.createElement('canvas').getContext('webgl2')))
    test.skip(!webgl, 'No WebGL2 in this browser')
    await page.goto(`${URL}?force3d`)
    await expect(page.locator('.hs-world')).toHaveAttribute('data-ready', 'true', { timeout: 20000 })
    await page.locator('.v2-ring').scrollIntoViewIfNeeded()
    await expect(page.locator('#tiendas')).toHaveClass(/has-ring/, { timeout: 20000 })
    await expect(page.locator('#tiendas').getByRole('link', { name: /Ver tienda|Captura real/ }).first()).toBeVisible()
    expect(errors).toEqual([])
  })

  test('phones: the bottom action bar shows after the hero and hides at the form; conditions fold and open', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
    const page = await ctx.newPage()
    await page.goto(URL)
    await page.addStyleTag({ content: 'html{scroll-behavior:auto!important}' })
    const bar = page.locator('.v2-mobile-cta')
    await expect(bar).toHaveAttribute('data-show', 'false')
    const go = (sel: string) => page.evaluate((sel) => { const el = document.querySelector(sel)!; window.scrollTo({ top: el.getBoundingClientRect().top + scrollY + 200, behavior: 'instant' }) }, sel)
    await go('#planes')
    await expect(bar).toHaveAttribute('data-show', 'true')
    await expect(bar.getByRole('link', { name: /Crear mi tienda gratis/ })).toHaveAttribute('href', TRIAL)
    await go('#contacto')
    await expect(bar).toHaveAttribute('data-show', 'false')
    const more = page.getByRole('button', { name: 'Ver todas las condiciones' })
    await expect(more).toBeAttached()
    await more.evaluate((b: HTMLButtonElement) => b.click())
    await expect(more).toHaveCount(0)
    await expect(page.locator('#condiciones')).toContainText('Cambios de precio')
    await ctx.close()
  })

  test('axe: no WCAG 2.2 A/AA violations', async ({ page }) => {
    await page.goto(URL)
    await page.waitForTimeout(5000) // let the simulation finish
    const results = await new AxeBuilder({ page }).withTags(WCAG).analyze()
    expect(results.violations.map((v) => `${v.id} (${v.nodes.length}): ${v.nodes.slice(0, 3).map((n) => n.target).join(' | ')}`)).toEqual([])
  })

  test('skip link first, and the mobile menu traps and returns focus', async ({ page }, info) => {
    await page.goto(URL)
    await page.keyboard.press('Tab')
    await expect(page.getByRole('link', { name: 'Saltar al contenido' })).toBeFocused()
    if (info.project.name !== 'mobile') return
    await page.getByRole('button', { name: 'Abrir menú' }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog', { name: 'Menú' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Menú' })).toBeHidden()
    await expect(page.getByRole('button', { name: 'Abrir menú' })).toBeFocused()
  })
  test('hero: content is there without JavaScript, and the entrance is short with JavaScript', async ({ browser, page }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false })
    const noJs = await ctx.newPage()
    await noJs.goto(URL)
    await expect(noJs.locator('h1')).toBeVisible()
    await expect(noJs.locator('#inicio').getByRole('link', { name: /Crear mi tienda gratis/ })).toBeVisible()
    const hiddenNoJs = await noJs.$$eval('[data-v2-item]', (els) => els.filter((el) => getComputedStyle(el).opacity !== '1').length)
    expect(hiddenNoJs).toBe(0)
    await ctx.close()
    await page.goto(URL)
    const timings = await page.$$eval('.v2-enter, .v2-enter-stage', (els) => els.map((el) => { const s = getComputedStyle(el); return parseFloat(s.animationDelay) + parseFloat(s.animationDuration) }))
    expect(timings.length).toBeGreaterThan(4)
    expect(Math.max(...timings)).toBeLessThanOrEqual(1.5)
  })

  test('sections reveal once when scrolled into view', async ({ page }) => {
    await page.goto(URL)
    const group = page.locator('#tiendas [data-v2-reveal]')
    await expect(group).not.toHaveClass(/is-in/)
    await group.scrollIntoViewIfNeeded()
    await expect(group).toHaveClass(/is-in/)
    await expect.poll(() => group.locator('[data-v2-item]').last().evaluate((el) => getComputedStyle(el).opacity)).toBe('1')
  })

  test('administration bento: the four real operations at a glance, each with its roles; no shipping labels', async ({ page }) => {
    await page.goto(URL)
    const admin = page.locator('#administracion')
    await admin.scrollIntoViewIfNeeded()
    const cards = admin.getByRole('list', { name: 'Qué puedes hacer por chat' }).getByRole('article')
    await expect(cards).toHaveCount(4)
    for (const text of ['Resumen del cambio', 'Entrada de existencias', 'Borrador del producto', 'Consultar no cambia nada']) await expect(admin).toContainText(text)
    await expect(admin.getByText('Pueden hacerlo:')).toHaveCount(4)
    await expect(admin).not.toContainText('guía')
    await expect(admin).toContainText('Tus clientes no hablan con el asistente.')
  })

  // Depth (Fase H · 3D): CSS 3D only with motion; flat and still otherwise.
  test('3D: the hero stage starts tilted and stands flat once the story begins; flat with reduced motion', async ({ browser, page }) => {
    const tilt = (p: Page) => p.locator('.hs-tilt').evaluate((el) => getComputedStyle(el).transform)
    await page.goto(URL)
    expect(await tilt(page)).toMatch(/^matrix3d/)
    await scrollTo(page, 0.25)
    await expect.poll(() => tilt(page)).toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\)|matrix3d\(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1\))$/)
    const ctx = await browser.newContext({ reducedMotion: 'reduce' })
    const still = await ctx.newPage()
    await still.goto(URL)
    expect(await tilt(still)).toBe('none')
    expect(await still.locator('.v2-collage-link').first().evaluate((el) => getComputedStyle(el).transform)).toBe('none')
    await ctx.close()
  })

  test('portal: after the story the camera enters the store and the page turns white; the product turns by the scroll', async ({ page }) => {
    await page.goto(URL)
    await expect(page.locator('#inicio')).toHaveAttribute('data-turn', 'ready', { timeout: 15000 })
    const turn = page.locator('.hs-turn')
    await scrollTo(page, 0.85)
    const early = await turn.evaluate((v: HTMLVideoElement) => v.currentTime)
    await scrollTo(page, 1, 0.5)
    await expect.poll(() => turn.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(early + 1)
    expect(await turn.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true)
    await scrollTo(page, 1, 1)
    await expect.poll(() => page.locator('.hs-veil').evaluate((el) => getComputedStyle(el).opacity)).toBe('1')
    await scrollTo(page, 1, 0)
    await expect.poll(() => page.locator('.hs-veil').evaluate((el) => getComputedStyle(el).opacity)).toBe('0')
    await expect(hs(page)).toHaveAttribute('data-stage-key', 'tienda')
  })

  test('finale: the product turn is scrubbed by the scroll, never plays by itself, loads late and stays local', async ({ page }) => {
    const external = watchRequests(page)
    await page.goto(URL)
    const video = page.locator('.v2-finale video')
    expect(await video.evaluate((v: HTMLVideoElement) => v.currentSrc)).toBe('') // not loaded at the top of the page
    const toFinale = (p: number) => page.evaluate((p) => { const f = document.querySelector<HTMLElement>('.v2-finale')!; window.scrollTo(0, f.offsetTop + (f.offsetHeight - innerHeight) * p) }, p)
    await page.evaluate(() => { const f = document.querySelector<HTMLElement>('.v2-finale')!; window.scrollTo(0, f.offsetTop - innerHeight) })
    await expect(page.locator('.v2-finale')).toHaveAttribute('data-video', 'ready', { timeout: 15000 })
    await toFinale(0.6)
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(3)
    await toFinale(0.1)
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeLessThan(1.5)
    expect(await video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true)
    await toFinale(1)
    await expect(page.locator('#cierre-title')).toBeInViewport()
    await expect(page.locator('#cierre-title')).toHaveText('Tu tienda.Bajo tu control.')
    await expect(page.locator('.v2-finale').getByText('Imagen generada con IA')).toBeVisible()
    expect(external).toEqual([])
  })

  test('finale without motion: still image and call to action, no clip; keyboard focus never lands on hidden text', async ({ browser, page }) => {
    const ctx = await browser.newContext({ reducedMotion: 'reduce' })
    const still = await ctx.newPage()
    await still.goto(URL)
    const cta = still.locator('.v2-finale').getByRole('link', { name: /Crear mi tienda gratis/ })
    await cta.scrollIntoViewIfNeeded()
    await expect(cta).toBeVisible()
    await still.waitForTimeout(500)
    expect(await still.locator('.v2-finale video').evaluate((v: HTMLVideoElement) => v.currentSrc)).toBe('')
    await ctx.close()
    await page.goto(URL)
    await page.locator('.v2-finale').getByRole('link', { name: /Crear mi tienda gratis/ }).focus()
    expect(await page.locator('.v2-finale-copy').evaluate((el) => getComputedStyle(el).opacity)).toBe('1')
  })
})
