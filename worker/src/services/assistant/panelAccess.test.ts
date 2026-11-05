import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { callbackUpdate, createHarness, createStoreUser, seedStore, stubTelegram, textUpdate, type Harness } from '../../testing/harness'
import { processTelegramUpdate } from '../telegram'

const TG = 7001
let h: Harness

beforeEach(async () => {
  h = createHarness({ TELEGRAM_BOT_TOKEN: 'bot-token' })
  const store = await seedStore(h.db, { slug: 'luz', name: 'Luz' })
  await createStoreUser(h.db, { email: 'admin@luz.co', password: 'ClaveVieja123', storeId: store, role: 'admin', telegramUserId: String(TG) })
})
afterEach(() => vi.unstubAllGlobals())

const send = (update: unknown) => processTelegramUpdate(update as never, h.env, h.db)
const resetButton = (telegram: ReturnType<typeof stubTelegram>) => telegram.calls
  .flatMap((call) => (call.body.reply_markup?.inline_keyboard || []).flat())
  .find((button: { url?: string }) => /\/restablecer\?token=/.test(button.url || '')) as { text: string; url: string } | undefined

describe('«🔐 Contraseña del panel» in the store assistant', () => {
  it('is offered in the main menu and sends a single-use reset button to this same chat', async () => {
    const menu = stubTelegram()
    await send(textUpdate(TG, '/menu'))
    expect((menu.lastMarkup()?.inline_keyboard || []).flat().map((button) => button.text)).toContain('🔐 Contraseña del panel')
    vi.unstubAllGlobals()

    const telegram = stubTelegram()
    await send(callbackUpdate(TG, 'm:panel_password'))
    const button = resetButton(telegram)
    expect(button?.text).toBe('🔐 Crear contraseña nueva')
    expect(telegram.calls.filter((call) => call.method === 'sendMessage').every((call) => Number(call.body.chat_id) === TG)).toBe(true)
    // The link only travels inside the button, never in a message text.
    expect(telegram.messages().join('\n')).not.toMatch(/restablecer\?token=/)
    expect(telegram.messages().join('\n')).toMatch(/Crear contraseña nueva/)

    const token = decodeURIComponent(new URL(button!.url).searchParams.get('token') || '')
    expect((await h.request('/api/auth/password-reset', { method: 'POST', body: { token, password: 'ClaveNueva2026' } })).status).toBe(200)
    expect((await h.request('/api/admin/login', { method: 'POST', body: { email: 'admin@luz.co', password: 'ClaveNueva2026' } })).status).toBe(200)
  })

  it('does not send twice in two minutes, also with the /clave command', async () => {
    stubTelegram()
    await send(callbackUpdate(TG, 'm:panel_password'))
    vi.unstubAllGlobals()
    const telegram = stubTelegram()
    await send(textUpdate(TG, '/clave'))
    expect(resetButton(telegram)).toBeUndefined()
    expect(telegram.messages().join('\n')).toMatch(/hace menos de 2 minutos/)
  })
})
