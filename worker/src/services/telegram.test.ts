import { describe, expect, it } from 'vitest'
import { linkTelegramAccount } from './telegram'

function mockDb(found: boolean) {
  let sqlSeen = ''
  let values: unknown[] = []
  const db = {
    prepare(sql: string) {
      sqlSeen = sql
      return {
        bind(...args: unknown[]) { values = args; return this },
        async first() { return found ? { telegram_owner_id: '123' } : null },
      }
    },
  }
  return { db: db as unknown as D1Database, get sql() { return sqlSeen }, get values() { return values } }
}

describe('one-time Telegram account linking', () => {
  it('consumes the expiring link code in the same conditional write', async () => {
    const mock = mockDb(true)
    const result = await linkTelegramAccount(123, 'one-time-code', mock.db)
    expect(result.success).toBe(true)
    expect(mock.sql).toContain('telegram_link_code = ?')
    expect(mock.sql).toContain('telegram_link_expires_at > datetime')
    expect(mock.values).toEqual(['123', 'one-time-code'])
  })

  it('rejects a code already consumed or expired', async () => {
    const result = await linkTelegramAccount(123, 'used-code', mockDb(false).db)
    expect(result.success).toBe(false)
  })
})
