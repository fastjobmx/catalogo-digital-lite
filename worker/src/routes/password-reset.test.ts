import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHarness, createStoreUser, seedStore, stubTelegram, type Harness } from '../testing/harness'
import { adminPasswordReset } from '../services/passwordReset'

let h: Harness
let storeId: number

const request = (email: string, ip = '203.0.113.10') => h.request('/api/auth/password-reset/request', { method: 'POST', body: { email }, headers: { 'CF-Connecting-IP': ip } })
const linkFrom = (telegram: ReturnType<typeof stubTelegram>) => {
  const call = telegram.calls.find((item) => item.method === 'sendMessage')
  const url = call?.body.reply_markup?.inline_keyboard?.[0]?.[0]?.url as string | undefined
  return url ? new URL(url).searchParams.get('token') : null
}

beforeEach(async () => {
  h = createHarness({ TELEGRAM_BOT_TOKEN: 'bot-token', PUBLIC_STORE_BASE_URL: 'https://tiendas.test' })
  storeId = await seedStore(h.db, { slug: 'moda-clave', name: 'Moda Clave', status: 'active' })
  await createStoreUser(h.db, { email: 'duena@clave.test', password: 'ClaveVieja123', storeId, role: 'owner', telegramUserId: '7301' })
})
afterEach(() => vi.unstubAllGlobals())

describe('password reset', () => {
  it('answers the same for unknown emails and sends nothing', async () => {
    const telegram = stubTelegram()
    const response = await request('nadie@clave.test')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(telegram.calls).toHaveLength(0)
    expect(h.db.query("SELECT COUNT(*) AS n FROM user_access_tokens WHERE purpose = 'password_reset'")).toEqual([{ n: 0 }])
  })

  it('sends a single-use link to the linked Telegram and sets the new password', async () => {
    const telegram = stubTelegram()
    const response = await request('DUENA@clave.test')
    expect(await response.json()).toEqual({ ok: true })
    const call = telegram.calls.find((item) => item.method === 'sendMessage')!
    expect(call.body.chat_id).toBe(7301)
    expect(String(call.body.text)).toContain('du')
    expect(String(call.body.text)).not.toContain('duena@clave.test')
    const token = linkFrom(telegram)!
    expect(JSON.stringify(call.body.reply_markup)).toContain('https://tiendas.test/t/moda-clave/admin/restablecer?token=')
    expect(h.db.query("SELECT COUNT(*) AS n FROM user_access_tokens WHERE purpose = 'password_reset' AND token_hash = ?", token)).toEqual([{ n: 0 }])

    const info = await (await h.request(`/api/auth/password-reset?token=${encodeURIComponent(token)}`)).json() as { email: string; store: { slug: string } }
    expect(info.email).toMatch(/^du•+@clave\.test$/)
    expect(info.store.slug).toBe('moda-clave')

    expect((await h.request('/api/auth/password-reset', { method: 'POST', body: { token, password: 'corta' } })).status).toBe(400)
    const done = await h.request('/api/auth/password-reset', { method: 'POST', body: { token, password: 'ClaveNueva456' } })
    expect(done.status).toBe(200)
    expect(await done.json()).toMatchObject({ email: 'duena@clave.test', store: { slug: 'moda-clave' } })
    expect((await h.request('/api/auth/password-reset', { method: 'POST', body: { token, password: 'OtraClave789' } })).status).toBe(404)

    const login = (password: string) => h.request('/api/admin/login', { method: 'POST', body: { email: 'duena@clave.test', password } })
    expect((await login('ClaveNueva456')).status).toBe(200)
    expect((await login('ClaveVieja123')).status).toBe(401)
    expect(h.db.query("SELECT action FROM audit_log WHERE action LIKE 'password_reset%' ORDER BY id")).toEqual([{ action: 'password_reset_requested' }, { action: 'password_reset_completed' }])
  })

  it('a new request invalidates the previous link', async () => {
    const first = stubTelegram()
    await request('duena@clave.test')
    const oldToken = linkFrom(first)!
    vi.unstubAllGlobals()
    const second = stubTelegram()
    await request('duena@clave.test')
    const newToken = linkFrom(second)!
    expect((await h.request(`/api/auth/password-reset?token=${encodeURIComponent(oldToken)}`)).status).toBe(404)
    expect((await h.request(`/api/auth/password-reset?token=${encodeURIComponent(newToken)}`)).status).toBe(200)
  })

  it('records an undeliverable request when the account has no channel, and never hands the link to the superadmin', async () => {
    await createStoreUser(h.db, { email: 'sin-telegram@clave.test', password: 'ClaveVieja123', storeId, role: 'admin' })
    const telegram = stubTelegram()
    expect((await request('sin-telegram@clave.test')).status).toBe(200)
    expect(telegram.calls).toHaveLength(0)
    expect(h.db.query("SELECT action FROM audit_log WHERE action = 'password_reset_undeliverable'")).toEqual([{ action: 'password_reset_undeliverable' }])
    const issued = await adminPasswordReset(h.db, h.env, 'sin-telegram@clave.test', 'superadmin')
    expect(issued?.delivery).toBe('none')
    expect(issued).not.toHaveProperty('link')
    expect(JSON.stringify(issued)).not.toContain('restablecer')
    // An undeliverable link is cancelled at once: nothing usable is left behind.
    expect(h.db.query("SELECT COUNT(*) AS n FROM user_access_tokens WHERE purpose = 'password_reset' AND used_at IS NULL")).toEqual([{ n: 0 }])
    expect(await adminPasswordReset(h.db, h.env, 'nadie@clave.test', 'superadmin')).toBeNull()
  })

  it('rate limits repeated requests and invalid links', async () => {
    stubTelegram()
    const statuses: number[] = []
    for (let attempt = 0; attempt < 10; attempt++) statuses.push((await request('duena@clave.test', '198.51.100.7')).status)
    expect(statuses).toContain(429)
    for (let attempt = 0; attempt < 9; attempt++) await h.request('/api/auth/password-reset?token=token-falso-123456', { headers: { 'CF-Connecting-IP': '198.51.100.8' } })
    expect((await h.request('/api/auth/password-reset?token=token-falso-123456', { headers: { 'CF-Connecting-IP': '198.51.100.8' } })).status).toBe(429)
  })
})
