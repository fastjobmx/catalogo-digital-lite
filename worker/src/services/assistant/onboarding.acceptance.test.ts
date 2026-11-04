import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPng } from '../../../test/sqliteD1'
import { callbackUpdate, createHarness, createStoreUser, photoUpdate, seedCatalog, seedStore, stubTelegram, textUpdate } from '../../testing/harness'
import { processTelegramUpdate } from '../telegram'
import { detectIntent } from './intents'
import { contrastRatio, isLegiblePalette, namedColor, palettesFromColors, previewPaletteParam } from './logoPalette'

type Button = { text: string; callback_data?: string; url?: string }

/** Telegram stub that also serves a downloadable image for getFile. */
function stubWithImage(image: Uint8Array) {
  return stubTelegram((url) => {
    if (url.includes('/getFile')) return new Response(JSON.stringify({ ok: true, result: { file_path: 'photos/logo.png', file_size: image.byteLength } }))
    if (url.includes('/file/bot')) return new Response(image, { headers: { 'content-length': String(image.byteLength) } })
    return undefined
  })
}
const buttons = (telegram: ReturnType<typeof stubTelegram>) => ((telegram.lastMarkup()?.inline_keyboard || []) as Button[][]).flat()

async function newOwner(slug: string, telegramUserId: number, status = 'draft') {
  const h = createHarness({ TELEGRAM_BOT_TOKEN: 'test-token', PUBLIC_STORE_BASE_URL: 'https://catalog.test' })
  const storeId = await seedStore(h.db, { slug, name: 'Moda Urbana', status })
  await createStoreUser(h.db, { email: `${slug}@example.test`, storeId, role: 'owner', telegramUserId: String(telegramUserId) })
  const send = (update: unknown) => processTelegramUpdate(update as never, h.env, h.db)
  return { h, storeId, send }
}

async function goToLogoStep(send: (update: unknown) => Promise<unknown>, user: number, storeId: number) {
  await send(textUpdate(user, '/start', 'María'))
  await send(callbackUpdate(user, `ob:${storeId}:start`))
  await send(callbackUpdate(user, `ob:${storeId}:business:ok`))
}

afterEach(() => vi.unstubAllGlobals())

describe('3.1 acceptance: logo, colors and templates', () => {
  it('processes a valid PNG logo: palettes from the logo, confirmation, R2 key of the store and next step', async () => {
    const { h, storeId, send } = await newOwner('logo-valido', 40101)
    const telegram = stubWithImage(createPng(320, 240, [21, 61, 112]))
    await goToLogoStep(send, 40101, storeId)
    await send(callbackUpdate(40101, `ob:${storeId}:logo:upload`))
    await send(photoUpdate(40101, 'logo-file'))

    expect(telegram.messages().at(-1)).toContain('Este sería tu nuevo logotipo')
    const state = JSON.parse(h.db.query<{ state_json: string }>('SELECT state_json FROM store_onboardings WHERE store_id = ?', storeId)[0]!.state_json)
    expect(state.colorFallback).toBeUndefined()
    expect(state.colorOptions.map((option: { id: string }) => option.id)).toEqual(['faithful', 'balanced', 'vibrant'])
    expect(state.colorOptions.every((option: { palette: never }) => isLegiblePalette(option.palette))).toBe(true)

    await send(callbackUpdate(40101, buttons(telegram).find((button) => /Confirmar|Sí/.test(button.text))!.callback_data!))
    const logo = h.db.query<{ logo_url: string }>('SELECT logo_url FROM store_config WHERE id = ?', storeId)[0]!.logo_url
    expect(logo).toMatch(new RegExp(`^/api/assets/stores/${storeId}/store/logo-`))
    expect(h.db.query<{ step: string }>('SELECT step FROM store_onboardings WHERE store_id = ?', storeId)[0]!.step).toBe('colors')
    const colorButtons = buttons(telegram)
    expect(colorButtons.filter((button) => button.url?.includes('/store-preview?palette='))).toHaveLength(3)
  })

  it('rejects an invalid logo with a clear message and keeps the step', async () => {
    const { h, storeId, send } = await newOwner('logo-invalido', 40102)
    const telegram = stubWithImage(createPng(40, 40, [200, 30, 30]))
    await goToLogoStep(send, 40102, storeId)
    await send(callbackUpdate(40102, `ob:${storeId}:logo:upload`))
    await send(photoUpdate(40102, 'tiny-logo'))

    expect(telegram.messages().at(-1)).toContain('No pude usar esa imagen')
    expect(h.db.query<{ logo_url: string | null }>('SELECT logo_url FROM store_config WHERE id = ?', storeId)[0]!.logo_url ?? null).toBeNull()
    expect(h.db.query<{ step: string }>('SELECT step FROM store_onboardings WHERE store_id = ?', storeId)[0]!.step).toBe('logo')
    expect(h.db.query('SELECT COUNT(*) AS n FROM telegram_operations WHERE store_id = ?', storeId)).toEqual([{ n: 0 }])
  })

  it('shows "tonos azules" with real previews and applies a full palette only after confirmation', async () => {
    const { h, storeId, send } = await newOwner('tonos-azules', 40103, 'active')
    const telegram = stubTelegram()
    await h.db.prepare("INSERT INTO store_onboarding_legacy_stores (store_id) VALUES (?)").bind(storeId).run()

    await send(textUpdate(40103, 'Muéstrame cómo quedaría mi tienda en tonos azules'))
    expect(telegram.messages().at(-1)).toContain('tonos azules')
    const options = buttons(telegram).filter((button) => button.callback_data?.startsWith('pal:'))
    expect(options).toHaveLength(3)
    expect(buttons(telegram).filter((button) => button.url?.startsWith('https://catalog.test/t/tonos-azules/admin/store-preview?palette='))).toHaveLength(3)
    expect(h.db.query('SELECT COUNT(*) AS n FROM audit_log WHERE store_id = ?', storeId)).toEqual([{ n: 0 }])

    await send(callbackUpdate(40103, options[1]!.callback_data!))
    expect(telegram.messages().at(-1)).toContain('Paleta completa')
    const before = h.db.query<{ primary_color: string }>('SELECT primary_color FROM store_config WHERE id = ?', storeId)[0]!
    await send(callbackUpdate(40103, buttons(telegram).find((button) => /Confirmar|Sí/.test(button.text))!.callback_data!))

    const saved = h.db.query<{ primary_color: string; accent_color: string; theme_config: string }>('SELECT primary_color, accent_color, theme_config FROM store_config WHERE id = ?', storeId)[0]!
    const palette = JSON.parse(saved.theme_config).style.palette
    expect(saved.primary_color).not.toBe(before.primary_color)
    expect(palette.primary).toBe(saved.primary_color)
    expect(palette.accent).toBe(saved.accent_color)
    expect(isLegiblePalette(palette)).toBe(true)
    expect(telegram.messages().at(-1)).toContain('paleta ya está aplicada')
  })

  it('applies a template after confirmation, keeping colors and products, and stays after reload', async () => {
    const { h, storeId, send } = await newOwner('plantilla-guardada', 40104, 'active')
    await h.db.prepare("INSERT INTO store_onboarding_legacy_stores (store_id) VALUES (?)").bind(storeId).run()
    await seedCatalog(h.db, storeId, { products: [{ sku: 'TPL-1', name: 'Bolso', price: 50000, variants: [{ size: 'Única', stock: 3 }] }] })
    await h.db.prepare("UPDATE store_config SET theme_config = ? WHERE id = ?").bind(JSON.stringify({ style: { palette: { background: '#FAFAF8', primary: '#1D4ED8' } }, hero: { title: 'Hola' } }), storeId).run()
    const telegram = stubTelegram()

    await send(textUpdate(40104, '¿Cómo cambio la plantilla de mi tienda?'))
    expect(buttons(telegram).filter((button) => button.url?.includes('store-preview?template='))).toHaveLength(13)
    await send(callbackUpdate(40104, 'tpl:pick:editorial'))
    expect(h.db.query<{ template: string }>('SELECT template FROM stores WHERE id = ?', storeId)[0]!.template).not.toBe('editorial')
    await send(callbackUpdate(40104, 'tpl:apply:editorial'))

    const response = await h.request('/api/store', { store: 'plantilla-guardada' })
    const body = await response.json() as { themeConfig: { template: string; style: { palette: { primary: string }; darkMode: boolean; typography: { fontDisplay: string } }; hero: { title: string } } }
    expect(body.themeConfig.template).toBe('editorial')
    expect(body.themeConfig.style.palette.primary).toBe('#1D4ED8')
    expect(body.themeConfig.style.darkMode).toBe(false)
    expect(body.themeConfig.style.typography.fontDisplay).toBe('Playfair Display')
    expect(body.themeConfig.hero.title).toBe('Hola')
    expect(h.db.query('SELECT COUNT(*) AS n FROM products WHERE store_id = ?', storeId)).toEqual([{ n: 1 }])
    expect(h.db.query("SELECT COUNT(*) AS n FROM audit_log WHERE store_id = ? AND action = 'store_template_updated'", storeId)).toEqual([{ n: 1 }])
  })

  it('never changes another store through palette or template buttons', async () => {
    const { h, storeId, send } = await newOwner('tienda-propia', 40105, 'active')
    const other = await seedStore(h.db, { slug: 'tienda-ajena', name: 'Tienda Ajena', status: 'active' })
    const otherBefore = h.db.query('SELECT theme_config, primary_color FROM store_config WHERE id = ?', other)
    stubTelegram()
    await send(callbackUpdate(40105, 'tpl:apply:urban'))
    await send(callbackUpdate(40105, `ob:${other}:template:urban`))

    expect(h.db.query<{ template: string }>('SELECT template FROM stores WHERE id = ?', storeId)[0]!.template).toBe('urban')
    expect(h.db.query<{ template: string }>('SELECT template FROM stores WHERE id = ?', other)[0]!.template).not.toBe('urban')
    expect(h.db.query('SELECT theme_config, primary_color FROM store_config WHERE id = ?', other)).toEqual(otherBefore)
  })

  it('does not let an operator change colors or templates', async () => {
    const h = createHarness({ TELEGRAM_BOT_TOKEN: 'test-token' })
    const storeId = await seedStore(h.db, { slug: 'tienda-operador', name: 'Tienda Operador', status: 'active' })
    await createStoreUser(h.db, { email: 'op@example.test', storeId, role: 'operator', telegramUserId: '40106' })
    const telegram = stubTelegram()
    await processTelegramUpdate(callbackUpdate(40106, 'tpl:apply:urban') as never, h.env, h.db)
    await processTelegramUpdate(textUpdate(40106, 'Quiero cambiar los colores de mi tienda') as never, h.env, h.db)

    expect(telegram.messages().join('\n')).toContain('Tu rol no permite')
    expect(h.db.query<{ template: string }>('SELECT template FROM stores WHERE id = ?', storeId)[0]!.template).not.toBe('urban')
  })
})

describe('3.1 acceptance: guided help and products', () => {
  it('answers /ayuda with help for the current step and resumes it', async () => {
    const { storeId, send } = await newOwner('ayuda-paso', 40107)
    const telegram = stubTelegram()
    await goToLogoStep(send, 40107, storeId)
    await send(textUpdate(40107, '/ayuda'))
    expect(telegram.messages().at(-1)).toContain('Ayuda de este paso')
    expect(telegram.messages().at(-1)).toContain('logotipo')
    await send(callbackUpdate(40107, `ob:${storeId}:resume_step`))
    expect(telegram.messages().at(-1)).toContain('personalidad a tu tienda')
  })

  it('starts the guided product flow for "Quiero subir cinco productos" without inventing data', async () => {
    const { send } = await newOwner('cinco-productos', 40108, 'active')
    const telegram = stubTelegram()
    await send(textUpdate(40108, 'Quiero subir cinco productos'))
    const replies = telegram.messages().join('\n')
    expect(replies).toContain('5 productos')
    expect(replies).toContain('fotografías')
  })

  it('understands owner questions about colors, photos and templates', () => {
    expect(detectIntent('¿Cómo cambio los colores de mi tienda?')).toEqual({ kind: 'palette_ideas' })
    expect(detectIntent('Muéstrame cómo quedaría mi tienda en tonos azules')).toEqual({ kind: 'palette_ideas' })
    expect(detectIntent('¿Puedo cambiar la foto principal?')).toEqual({ kind: 'change_store_image', target: 'banner' })
    expect(detectIntent('Quiero subir cinco productos')).toEqual({ kind: 'start_product', hint: '', count: 5 })
    expect(detectIntent('¿Cómo cambio la plantilla de mi tienda?')).toEqual({ kind: 'template_ideas' })
    expect(detectIntent('Cambia el color principal a #112233')).not.toEqual({ kind: 'palette_ideas' })
  })
})

describe('3.1 acceptance: palettes', () => {
  it('builds legible palettes for every named color and encodes previews', () => {
    for (const word of ['azul', 'verde', 'rojo', 'rosa', 'morado', 'naranja', 'dorado', 'café', 'beige', 'negro', 'turquesa', 'vinotinto']) {
      const color = namedColor(`tonos ${word}`)
      expect(color, word).not.toBeNull()
      const options = palettesFromColors(color!.hex)!
      expect(options, word).toHaveLength(3)
      for (const option of options) {
        expect(isLegiblePalette(option.palette), `${word} ${option.id}`).toBe(true)
        expect(previewPaletteParam(option.palette)).toMatch(/^([0-9A-F]{6}-){9}[0-9A-F]{6}$/)
      }
    }
    expect(isLegiblePalette({ background: '#FFFFFF', surface: '#FFFFFF', text: '#EEEEEE', textMuted: '#DDDDDD', border: '#EEEEEE', primary: '#FAFAFA', secondary: '#FFFFFF', accent: '#FFFFFF', button: '#FFFF00', buttonText: '#FFFFFF' })).toBe(false)
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 0)
  })
})

describe('3.1 acceptance: environments without a public URL', () => {
  it('drops relative link buttons instead of failing the whole Telegram message', async () => {
    const h = createHarness({ TELEGRAM_BOT_TOKEN: 'test-token', PUBLIC_STORE_BASE_URL: '' })
    const storeId = await seedStore(h.db, { slug: 'sin-url', name: 'Sin URL' })
    await createStoreUser(h.db, { email: 'sin-url@example.test', storeId, role: 'owner', telegramUserId: '40109' })
    const telegram = stubTelegram()
    await processTelegramUpdate(textUpdate(40109, '/start') as never, h.env, h.db)
    const markup = JSON.stringify(telegram.lastMarkup())
    expect(markup).toContain('Configurar mi tienda')
    expect(markup).not.toContain('"url":"/')
  })
})
