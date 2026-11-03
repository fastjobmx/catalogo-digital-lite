import { describe, expect, it } from 'vitest'
import { createTestDatabase } from '../../test/sqliteD1'
import { createStoreUser, seedStore } from '../testing/harness'
import { createAccessToken } from './platformUsers'
import { linkTelegramAccount } from './telegram'

describe('one-time Telegram account linking', () => {
  it('consumes the expiring legacy link code in the same conditional write', async () => {
    const db = createTestDatabase()
    db.query("UPDATE store_config SET telegram_link_code = 'one-time-code', telegram_link_expires_at = datetime('now', '+5 minutes') WHERE id = 1")
    expect((await linkTelegramAccount(123, 'one-time-code', db)).success).toBe(true)
    expect((await linkTelegramAccount(456, 'one-time-code', db)).success).toBe(false)
    expect(db.query('SELECT telegram_owner_id, telegram_link_code FROM store_config WHERE id = 1')).toEqual([{ telegram_owner_id: '123', telegram_link_code: null }])
  })

  it('rejects an expired code', async () => {
    const db = createTestDatabase()
    db.query("UPDATE store_config SET telegram_link_code = 'old-code-0001', telegram_link_expires_at = datetime('now', '-1 minute') WHERE id = 1")
    expect((await linkTelegramAccount(123, 'old-code-0001', db)).success).toBe(false)
  })

  it('does not let one Telegram account take over another user', async () => {
    const db = createTestDatabase()
    const store = await seedStore(db, { slug: 'moda-urbana', name: 'Moda Urbana' })
    await createStoreUser(db, { email: 'a@moda.test', storeId: store, role: 'owner', telegramUserId: '555' })
    const other = await createStoreUser(db, { email: 'b@moda.test', storeId: store, role: 'admin', status: 'invited' })
    const code = await createAccessToken(db, { userId: other, storeId: store, purpose: 'telegram_link', ttlSeconds: 600, createdBy: 'test' })
    const result = await linkTelegramAccount(555, code, db)
    expect(result.success).toBe(false)
    expect(db.query('SELECT telegram_user_id FROM platform_users WHERE id = ?', other)).toEqual([{ telegram_user_id: null }])
  })
})
