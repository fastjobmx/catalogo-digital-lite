import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHarness, createStoreUser, superadminToken, stubTelegram, userToken, type Harness } from '../../testing/harness'
import { sha256Hex } from '../platformUsers'
import { parseAdminIds } from './maintenance'

const MASTER_TOKEN = '111:master-token-value'
const ASSISTANT_TOKEN = '222:assistant-token-value'
const SECRET = 'master-webhook-secret-value'
let h: Harness

const BOT_IDS: Record<string, { id: number; username: string }> = {
  [MASTER_TOKEN]: { id: 111, username: 'PlataformaMaestroBot' },
  [ASSISTANT_TOKEN]: { id: 222, username: 'SneakerHubAdmin_bot' },
}

function telegramApi() {
  return stubTelegram((url) => {
    const [, token, method] = url.match(/\/bot([^/]+)\/(\w+)$/) || []
    const bot = BOT_IDS[token!]
    if (!bot) return new Response(JSON.stringify({ ok: false, description: 'Unauthorized' }), { status: 401 })
    if (method === 'getMe') return new Response(JSON.stringify({ ok: true, result: { id: bot.id, is_bot: true, username: bot.username } }))
    if (method === 'getWebhookInfo') {
      return new Response(JSON.stringify({ ok: true, result: bot.id === 222
        ? { url: 'https://api.test/api/telegram/webhook', pending_update_count: 0, allowed_updates: ['message', 'callback_query'] }
        : { url: '', pending_update_count: 0 } }))
    }
    return undefined
  })
}

async function mintCode(scope: string, options: { expiresIn?: number } = {}): Promise<string> {
  const code = `code${crypto.randomUUID().replace(/-/g, '')}`
  await h.db.prepare(`INSERT INTO platform_operations (operation_id, chat_id, actor, action, params_json, summary, expires_at) VALUES (?, ?, 'operator:test', 'maintenance', ?, 'test', unixepoch() + ?)`)
    .bind(`maint-${await sha256Hex(code)}`, `maintenance:${scope}:${code.slice(4, 12)}`, JSON.stringify({ scope }), options.expiresIn ?? 600).run()
  return code
}

const post = (path: string, headers: Record<string, string> = {}, token?: string) => h.request(`/api/master/maintenance/${path}`, { method: 'POST', headers, token })

beforeEach(() => {
  h = createHarness({ MASTER_BOT_TOKEN: MASTER_TOKEN, MASTER_WEBHOOK_SECRET: SECRET, MASTER_ADMIN_TELEGRAM_IDS: '9001', TELEGRAM_BOT_TOKEN: ASSISTANT_TOKEN })
})
afterEach(() => vi.unstubAllGlobals())

describe('master maintenance authorization', () => {
  it('rejects anonymous callers and store users, and accepts the platform superadmin', async () => {
    telegramApi()
    expect((await post('status')).status).toBe(401)
    expect((await post('status', { 'X-Maintenance-Code': 'short' })).status).toBe(401)
    const ownerId = await createStoreUser(h.db, { email: 'duena@tienda.test', storeId: 1, role: 'owner' })
    expect((await post('status', {}, await userToken(ownerId, 'duena@tienda.test'))).status).toBe(403)
    expect((await post('status', {}, await superadminToken())).status).toBe(200)
  })

  it('accepts a one-time code once, only for its scope and before it expires', async () => {
    const telegram = telegramApi()
    const code = await mintCode('status')
    expect((await post('webhook', { 'X-Maintenance-Code': code })).status).toBe(403)
    expect((await post('status', { 'X-Maintenance-Code': code })).status).toBe(200)
    expect((await post('status', { 'X-Maintenance-Code': code })).status).toBe(403)
    const expired = await mintCode('status', { expiresIn: -1 })
    expect((await post('status', { 'X-Maintenance-Code': expired })).status).toBe(403)
    expect(h.db.query(`SELECT code, detail FROM platform_events WHERE source = 'master_maintenance'`)).toEqual([{ code: 'STATUS_CHECKED', detail: 'operator:test' }])
    expect(telegram.calls.some((call) => call.method === 'setWebhook')).toBe(false)
  })
})

describe('master maintenance status', () => {
  it('reports both bots identities and webhooks without revealing tokens, secret or admin ids', async () => {
    const telegram = telegramApi()
    const response = await post('status', { 'X-Maintenance-Code': await mintCode('status') })
    const text = await response.text()
    for (const value of [MASTER_TOKEN, ASSISTANT_TOKEN, SECRET, '9001', 'master-token-value']) expect(text).not.toContain(value)
    expect(JSON.parse(text).data).toEqual({
      master: {
        configured: true,
        bot: { id: 111, username: 'PlataformaMaestroBot', isBot: true },
        webhook: { url: null, pendingUpdates: 0, lastError: null, lastErrorAt: null, allowedUpdates: null },
        secretConfigured: true, adminIdsValid: 1, adminIdsInvalid: 0,
        expectedWebhookUrl: 'https://api.test/api/master/webhook', webhookMatches: false,
        sameTokenAsAssistant: false, sameBotAsAssistant: false,
      },
      assistant: {
        configured: true,
        bot: { id: 222, username: 'SneakerHubAdmin_bot', isBot: true },
        webhook: { url: 'https://api.test/api/telegram/webhook', pendingUpdates: 0, lastError: null, lastErrorAt: null, allowedUpdates: ['message', 'callback_query'] },
      },
    })
    // Read-only: only identity and webhook info were requested.
    expect([...new Set(telegram.calls.map((call) => call.method))].sort()).toEqual(['getMe', 'getWebhookInfo'])
  })

  it('does not echo provider errors when a token is rejected', async () => {
    h = createHarness({ MASTER_BOT_TOKEN: '333:revoked', MASTER_WEBHOOK_SECRET: SECRET, MASTER_ADMIN_TELEGRAM_IDS: '9001', TELEGRAM_BOT_TOKEN: ASSISTANT_TOKEN })
    telegramApi()
    const body = await (await post('status', {}, await superadminToken())).json() as any
    expect(body.data.master).toMatchObject({ configured: true, bot: null, error: 'TELEGRAM_GETME_FAILED' })
    expect(JSON.stringify(body)).not.toContain('revoked')
  })
})

describe('master webhook registration', () => {
  it('registers only the master bot webhook with its own secret and the expected updates', async () => {
    const telegram = telegramApi()
    const response = await post('webhook', { 'X-Maintenance-Code': await mintCode('register_webhook') })
    expect(response.status).toBe(200)
    const setWebhook = telegram.calls.filter((call) => call.method === 'setWebhook')
    expect(setWebhook).toHaveLength(1)
    expect(setWebhook[0]!.url).toContain(`/bot${MASTER_TOKEN}/setWebhook`)
    expect(setWebhook[0]!.body).toEqual({ url: 'https://api.test/api/master/webhook', secret_token: SECRET, allowed_updates: ['message', 'callback_query'] })
    const text = JSON.stringify(await response.json())
    expect(text).not.toContain(SECRET)
    expect(text).not.toContain(MASTER_TOKEN)
    expect(h.db.query(`SELECT code FROM platform_events WHERE source = 'master_maintenance'`)).toEqual([{ code: 'WEBHOOK_REGISTERED' }])
  })

  it('refuses to touch a store assistant bot', async () => {
    h = createHarness({ MASTER_BOT_TOKEN: ASSISTANT_TOKEN, MASTER_WEBHOOK_SECRET: SECRET, MASTER_ADMIN_TELEGRAM_IDS: '9001', TELEGRAM_BOT_TOKEN: ASSISTANT_TOKEN })
    const telegram = telegramApi()
    const response = await post('webhook', {}, await superadminToken())
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ success: false, refused: 'MASTER_BOT_IS_STORE_ASSISTANT' })
    expect(telegram.calls.some((call) => call.method === 'setWebhook')).toBe(false)
  })

  it('refuses without valid admin ids or a strong secret', async () => {
    h = createHarness({ MASTER_BOT_TOKEN: MASTER_TOKEN, MASTER_WEBHOOK_SECRET: 'short', MASTER_ADMIN_TELEGRAM_IDS: '9001', TELEGRAM_BOT_TOKEN: ASSISTANT_TOKEN })
    let telegram = telegramApi()
    expect(await (await post('webhook', {}, await superadminToken())).json()).toMatchObject({ refused: 'MASTER_WEBHOOK_SECRET_MISSING_OR_SHORT' })
    h = createHarness({ MASTER_BOT_TOKEN: MASTER_TOKEN, MASTER_WEBHOOK_SECRET: SECRET, MASTER_ADMIN_TELEGRAM_IDS: 'yo', TELEGRAM_BOT_TOKEN: ASSISTANT_TOKEN })
    telegram = telegramApi()
    expect(await (await post('webhook', {}, await superadminToken())).json()).toMatchObject({ refused: 'MASTER_ADMIN_TELEGRAM_IDS_INVALID' })
    expect(telegram.calls.some((call) => call.method === 'setWebhook')).toBe(false)
  })

  it('no longer exposes the old GET setup route', async () => {
    telegramApi()
    expect((await h.request('/api/master/setup', { token: await superadminToken() })).status).toBe(404)
  })
})

describe('parseAdminIds', () => {
  it('keeps numeric ids only and counts the rest', () => {
    expect(parseAdminIds(' 12345, 67890;12345  abc 1 ')).toEqual({ valid: ['12345', '67890'], invalid: 2 })
    expect(parseAdminIds(undefined)).toEqual({ valid: [], invalid: 0 })
  })
})
