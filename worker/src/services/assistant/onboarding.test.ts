import { afterEach, describe, expect, it, vi } from 'vitest'
import { callbackUpdate, createHarness, createStoreUser, seedStore, stubTelegram, textUpdate } from '../../testing/harness'
import { processTelegramUpdate } from '../telegram'

const callbackFor = (telegram: ReturnType<typeof stubTelegram>, pattern: RegExp) =>
  telegram.lastMarkup()?.inline_keyboard.flat().find((button) => pattern.test(button.text))?.callback_data

afterEach(() => vi.unstubAllGlobals())

describe('persistent owner onboarding', () => {
  it('welcomes a new owner after store selection and persists progress by store and Telegram user', async () => {
    const h = createHarness({ TELEGRAM_BOT_TOKEN: 'test-token', PUBLIC_STORE_BASE_URL: 'https://catalog.test' })
    const storeId = await seedStore(h.db, { slug: 'moda-nueva', name: 'Moda Nueva' })
    await createStoreUser(h.db, { email: 'maria@example.test', storeId, role: 'owner', telegramUserId: '30101' })
    const telegram = stubTelegram()

    await processTelegramUpdate(textUpdate(30101, '/start', 'María'), h.env, h.db)

    expect(telegram.messages().join('\n')).toContain('¡Hola, María!')
    expect(telegram.messages().join('\n')).toContain('Moda Nueva')
    expect(telegram.lastMarkup()?.inline_keyboard.flat().map((button) => button.text)).toContain('🚀 Configurar mi tienda')
    expect(JSON.stringify(telegram.lastMarkup())).toContain('/admin/store-preview')
    const progress = await h.db.prepare('SELECT status, step FROM store_onboardings WHERE store_id = ? AND telegram_user_id = ?').bind(storeId, '30101').first<{ status: string; step: string }>()
    expect(progress).toEqual({ status: 'in_progress', step: 'welcome' })
  })

  it('does not change the normal greeting for existing owners', async () => {
    const h = createHarness({ TELEGRAM_BOT_TOKEN: 'test-token' })
    await createStoreUser(h.db, { email: 'old-owner@example.test', storeId: 1, role: 'owner', telegramUserId: '30102' })
    const telegram = stubTelegram()

    await processTelegramUpdate(textUpdate(30102, '/start'), h.env, h.db)

    expect(telegram.messages().join('\n')).toContain('¿Qué hacemos hoy?')
    expect(telegram.messages().join('\n')).not.toContain('está casi lista')
    expect(await h.db.prepare('SELECT 1 FROM store_onboardings WHERE store_id = 1 AND telegram_user_id = ?').bind('30102').first()).toBeNull()
  })

  it('resumes saved progress and applies palette/template changes without touching products', async () => {
    const h = createHarness({ TELEGRAM_BOT_TOKEN: 'test-token' })
    const storeId = await seedStore(h.db, { slug: 'tienda-resume', name: 'Tienda Resume' })
    await createStoreUser(h.db, { email: 'resume@example.test', storeId, role: 'owner', telegramUserId: '30103' })
    const telegram = stubTelegram()
    await processTelegramUpdate(textUpdate(30103, '/start'), h.env, h.db)
    await processTelegramUpdate(callbackUpdate(30103, callbackFor(telegram, /Configurar mi tienda/)!), h.env, h.db)
    await processTelegramUpdate(callbackUpdate(30103, callbackFor(telegram, /Continuar$/)!), h.env, h.db)
    await processTelegramUpdate(callbackUpdate(30103, callbackFor(telegram, /Subir logo después/)!), h.env, h.db)
    const colors = callbackFor(telegram, /Continuar después/)
    expect(colors).toContain(`ob:${storeId}:later`)
    await processTelegramUpdate(callbackUpdate(30103, `ob:${storeId}:later`), h.env, h.db)
    await processTelegramUpdate(textUpdate(30103, '/continuar'), h.env, h.db)
    expect(telegram.messages().at(-1)).toContain('combinaciones')

    await processTelegramUpdate(callbackUpdate(30103, `ob:${storeId}:colors:balanced`), h.env, h.db)
    await processTelegramUpdate(callbackUpdate(30103, `ob:${storeId}:template:tech`), h.env, h.db)
    await processTelegramUpdate(callbackUpdate(30103, `ob:${storeId}:banner:use`), h.env, h.db)
    await processTelegramUpdate(callbackUpdate(30103, `ob:${storeId}:product:later`), h.env, h.db)

    const saved = await h.db.prepare(
      `SELECT s.template, c.theme_config, (SELECT COUNT(*) FROM products WHERE store_id = s.id) AS products
       FROM stores s JOIN store_config c ON c.id = s.id WHERE s.id = ?`,
    ).bind(storeId).first<{ template: string; theme_config: string; products: number }>()
    expect(saved?.template).toBe('tech')
    expect(JSON.parse(saved!.theme_config).template).toBe('tech')
    expect(saved?.products).toBe(0)
    const progress = await h.db.prepare('SELECT step, status FROM store_onboardings WHERE store_id = ? AND telegram_user_id = ?').bind(storeId, '30103').first<{ step: string; status: string }>()
    expect(progress).toEqual({ step: 'review', status: 'in_progress' })
  })

  it('rejects a callback that belongs to another store in a multi-store account', async () => {
    const h = createHarness({ TELEGRAM_BOT_TOKEN: 'test-token' })
    const first = await seedStore(h.db, { slug: 'tienda-uno', name: 'Tienda Uno' })
    const second = await seedStore(h.db, { slug: 'tienda-dos', name: 'Tienda Dos' })
    const userId = await createStoreUser(h.db, { email: 'multi@example.test', storeId: first, role: 'owner', telegramUserId: '30104' })
    await h.db.prepare("INSERT INTO store_memberships (store_id, user_id, role, created_by) VALUES (?, ?, 'owner', 'test')").bind(second, userId).run()
    const telegram = stubTelegram()

    await processTelegramUpdate(callbackUpdate(30104, `s:select:${first}`), h.env, h.db)
    await processTelegramUpdate(callbackUpdate(30104, `ob:${second}:start`), h.env, h.db)

    expect(telegram.messages().join('\n')).toContain('pertenece a otra tienda')
    expect(await h.db.prepare('SELECT 1 FROM store_onboardings WHERE store_id = ?').bind(second).first()).toBeNull()
  })

  it('lets the owner return to the previous step without losing the saved stage', async () => {
    const h = createHarness({ TELEGRAM_BOT_TOKEN: 'test-token' })
    const storeId = await seedStore(h.db, { slug: 'tienda-atras', name: 'Tienda Atrás' })
    await createStoreUser(h.db, { email: 'back@example.test', storeId, role: 'owner', telegramUserId: '30105' })
    const telegram = stubTelegram()
    await processTelegramUpdate(textUpdate(30105, '/start'), h.env, h.db)
    await processTelegramUpdate(callbackUpdate(30105, `ob:${storeId}:start`), h.env, h.db)
    await processTelegramUpdate(callbackUpdate(30105, `ob:${storeId}:business:continue`), h.env, h.db)
    await processTelegramUpdate(callbackUpdate(30105, `ob:${storeId}:back`), h.env, h.db)

    const progress = await h.db.prepare('SELECT step FROM store_onboardings WHERE store_id = ? AND telegram_user_id = ?').bind(storeId, '30105').first<{ step: string }>()
    expect(progress?.step).toBe('business')
    expect(telegram.messages().at(-1)).toContain('Revisemos los datos que ya tenemos')
  })

  it('records an activation request for administrators without activating the draft store', async () => {
    const h = createHarness({ TELEGRAM_BOT_TOKEN: 'test-token' })
    const storeId = await seedStore(h.db, { slug: 'tienda-revision', name: 'Tienda Revisión', status: 'draft' })
    await createStoreUser(h.db, { email: 'review@example.test', storeId, role: 'owner', telegramUserId: '30106' })
    const telegram = stubTelegram()
    await processTelegramUpdate(textUpdate(30106, '/start'), h.env, h.db)
    await h.db.prepare("UPDATE store_onboardings SET step = 'review', version = version + 1 WHERE store_id = ? AND telegram_user_id = ?").bind(storeId, '30106').run()
    await processTelegramUpdate(callbackUpdate(30106, `ob:${storeId}:review:request`), h.env, h.db)

    expect(h.db.query('SELECT status FROM stores WHERE id = ?', storeId)).toEqual([{ status: 'draft' }])
    expect(h.db.query('SELECT status FROM store_activation_requests WHERE store_id = ?', storeId)).toEqual([{ status: 'pending' }])
    expect(telegram.messages().at(-1)).toContain('La tienda seguirá privada')
  })

  it('allows only one concurrent palette write for the same onboarding version', async () => {
    const h = createHarness({ TELEGRAM_BOT_TOKEN: 'test-token' })
    const storeId = await seedStore(h.db, { slug: 'tienda-concurrencia', name: 'Tienda Concurrencia' })
    await createStoreUser(h.db, { email: 'race@example.test', storeId, role: 'owner', telegramUserId: '30107' })
    stubTelegram()
    await processTelegramUpdate(textUpdate(30107, '/start'), h.env, h.db)
    await processTelegramUpdate(callbackUpdate(30107, `ob:${storeId}:start`), h.env, h.db)
    await processTelegramUpdate(callbackUpdate(30107, `ob:${storeId}:business:continue`), h.env, h.db)
    await processTelegramUpdate(callbackUpdate(30107, `ob:${storeId}:logo:name`), h.env, h.db)

    await Promise.all([
      processTelegramUpdate(callbackUpdate(30107, `ob:${storeId}:colors:faithful`), h.env, h.db),
      processTelegramUpdate(callbackUpdate(30107, `ob:${storeId}:colors:balanced`), h.env, h.db),
    ])

    expect(h.db.query("SELECT COUNT(*) AS n FROM audit_log WHERE store_id = ? AND action = 'store_updated'", storeId)).toEqual([{ n: 1 }])
    expect(h.db.query('SELECT step FROM store_onboardings WHERE store_id = ? AND telegram_user_id = ?', storeId, '30107')).toEqual([{ step: 'template' }])
  })
})
