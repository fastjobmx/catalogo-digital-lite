import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { callbackUpdate, createHarness, createStoreUser, seedStore, stubTelegram, superadminToken, textUpdate, type Harness } from '../testing/harness'
import { createAccessToken } from '../services/platformUsers'

const SECRET = 'webhook-secret-for-tests'
const OWNER = 12345
let h: Harness

beforeEach(() => {
  h = createHarness({ TELEGRAM_BOT_TOKEN: 'store-bot-token', TELEGRAM_WEBHOOK_SECRET: SECRET, TELEGRAM_OWNER_ID: String(OWNER) })
})
afterEach(() => vi.unstubAllGlobals())

const deliver = (update: unknown, secret = SECRET) => h.request('/api/telegram/webhook', { method: 'POST', body: update, headers: secret ? { 'X-Telegram-Bot-Api-Secret-Token': secret } : {} })

describe('Telegram webhook security and request controls', () => {
  it('registers the webhook only for the platform superadmin, with callbacks and the secret', async () => {
    const telegram = stubTelegram()
    expect((await h.request('/api/telegram/setup')).status).toBe(401)
    const response = await h.request('/api/telegram/setup', { token: await superadminToken() })
    expect(response.status).toBe(200)
    expect(telegram.calls[0]?.body).toMatchObject({ allowed_updates: ['message', 'callback_query'], secret_token: SECRET })
  })

  it('fails closed when the webhook secret is absent or incorrect', async () => {
    stubTelegram()
    expect((await deliver(textUpdate(OWNER, 'hola'), '')).status).toBe(403)
    expect((await deliver(textUpdate(OWNER, 'hola'), 'wrong')).status).toBe(403)
  })

  it('accepts the linked numeric owner and deduplicates a repeated update', async () => {
    const telegram = stubTelegram()
    const update = callbackUpdate(OWNER, 'm:menu')
    expect(await (await deliver(update)).json()).toEqual({ ok: true })
    expect(await (await deliver(update)).json()).toMatchObject({ duplicate: true })
    expect(telegram.messages()).toHaveLength(1)
  })

  it('silently acknowledges unknown users and only explains how to link on /start', async () => {
    const telegram = stubTelegram()
    expect(await (await deliver(textUpdate(999, 'muéstrame el inventario'))).json()).toMatchObject({ rejected: true })
    expect(telegram.messages()).toHaveLength(0)
    await deliver(textUpdate(999, '/start'))
    expect(telegram.messages()[0]).toContain('/link')
    expect(telegram.messages()[0]).not.toContain('SneakerHub')
  })

  it('drops rate-limited updates while acknowledging them', async () => {
    stubTelegram()
    for (let index = 0; index < 20; index++) await deliver(textUpdate(OWNER, 'hola'))
    expect(await (await deliver(textUpdate(OWNER, 'hola'))).json()).toMatchObject({ rate_limited: true })
  })

  it('links a store user with a one-time code (also via t.me deep link) and refuses reuse', async () => {
    const telegram = stubTelegram()
    const store = await seedStore(h.db, { slug: 'moda-urbana', name: 'Moda Urbana' })
    const userId = await createStoreUser(h.db, { email: 'duena@moda.test', storeId: store, role: 'owner', status: 'invited' })
    const code = await createAccessToken(h.db, { userId, storeId: store, purpose: 'telegram_link', ttlSeconds: 600, createdBy: 'test' })
    await deliver(textUpdate(777, `/start link_${code.replaceAll('-', '')}`))
    expect(telegram.messages().at(-1)).toContain('Moda Urbana')
    expect(h.db.query('SELECT telegram_user_id, status FROM platform_users WHERE id = ?', userId)).toEqual([{ telegram_user_id: '777', status: 'active' }])
    await deliver(textUpdate(888, `/link ${code}`))
    expect(telegram.messages().at(-1)).toContain('no es válido')
    // The linked user now reaches the assistant of their store.
    await deliver(textUpdate(777, 'hola'))
    expect(telegram.messages().at(-1)).toContain('Moda Urbana')
  })

  it('keeps the legacy one-time owner link for the primary store', async () => {
    h = createHarness({ TELEGRAM_BOT_TOKEN: 'store-bot-token', TELEGRAM_WEBHOOK_SECRET: SECRET })
    const telegram = stubTelegram()
    h.db.query("UPDATE store_config SET telegram_link_code = 'legacy-code-0001', telegram_link_expires_at = datetime('now', '+5 minutes') WHERE id = 1")
    await deliver(textUpdate(4242, '/link legacy-code-0001'))
    expect(telegram.messages().at(-1)).toContain('vinculada')
    expect(h.db.query('SELECT telegram_owner_id FROM store_config WHERE id = 1')).toEqual([{ telegram_owner_id: '4242' }])
  })
})
