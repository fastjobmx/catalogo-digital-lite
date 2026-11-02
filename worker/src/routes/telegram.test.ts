import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import type { Env } from '../index'
import telegramRoutes from './telegram'

const SECRET = 'webhook-secret-for-tests'

function createApp(options: { owner?: string | null; count?: number; duplicate?: boolean } = {}) {
  const writes: string[] = []
  const db = {
    prepare(sql: string) {
      return {
        bind() { return this },
        async first() {
          if (sql.includes('SELECT telegram_owner_id')) return options.owner ? { telegram_owner_id: options.owner } : null
          if (sql.includes('RETURNING request_count')) return { request_count: options.count ?? 1 }
          return null
        },
        async run() {
          writes.push(sql)
          if (sql.includes('INSERT INTO processed_updates') && options.duplicate) throw new Error('UNIQUE constraint failed: processed_updates.update_id')
          return { meta: { changes: 1 } }
        },
      }
    },
  }
  const app = new Hono<Env>()
  app.route('/api/telegram', telegramRoutes)
  const env = {
    DB: db,
    TELEGRAM_BOT_TOKEN: 'mock-token',
    TELEGRAM_WEBHOOK_SECRET: SECRET,
    TELEGRAM_OWNER_ID: undefined,
  } as unknown as Env['Bindings']
  return { app, env, writes }
}

function request(app: Hono<Env>, env: Env['Bindings'], secret?: string, userId = 123) {
  return app.request('/api/telegram/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(secret ? { 'X-Telegram-Bot-Api-Secret-Token': secret } : {}) },
    body: JSON.stringify({ update_id: 10, message: { from: { id: userId }, chat: { id: userId, type: 'private' }, text: '/start' } }),
  }, env)
}

describe('Telegram webhook security and request controls', () => {
  it('fails closed when the webhook secret is absent or incorrect', async () => {
    const { app, env, writes } = createApp({ owner: '123' })
    expect((await request(app, env)).status).toBe(403)
    expect((await request(app, env, 'wrong')).status).toBe(403)
    expect(writes).toHaveLength(0)
  })

  it('acknowledges and silently ignores users other than the configured numeric owner', async () => {
    const { app, env, writes } = createApp({ owner: '123' })
    const response = await request(app, env, SECRET, 456)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ ok: true, rejected: true })
    expect(writes).toHaveLength(0)
  })

  it('acknowledges and drops rate-limited updates and ignores an already processed update', async () => {
    const limited = createApp({ owner: '123', count: 21 })
    const limitedResponse = await request(limited.app, limited.env, SECRET)
    expect(limitedResponse.status).toBe(200)
    await expect(limitedResponse.json()).resolves.toMatchObject({ ok: true, rate_limited: true })
    const duplicate = createApp({ owner: '123', count: 1, duplicate: true })
    const response = await request(duplicate.app, duplicate.env, SECRET)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ duplicate: true })
  })
})
