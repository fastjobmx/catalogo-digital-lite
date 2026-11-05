import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { callbackUpdate, createHarness, createStoreUser, seedCatalog, seedStore, stubTelegram, textUpdate, type Harness } from '../../testing/harness'
import { processTelegramUpdate, linkTelegramAccount } from '../telegram'
import { createAccessToken } from '../platformUsers'
import { provisionStore } from '../provisioning'

type Button = { text: string; callback_data?: string; url?: string }
const OWNER = 7001
let h: Harness
let tiendaA: number
let tiendaB: number
let ownerUserId: number

const send = (update: unknown) => processTelegramUpdate(update as never, h.env, h.db)
const buttons = (telegram: ReturnType<typeof stubTelegram>) => ((telegram.lastMarkup()?.inline_keyboard || []) as Button[][]).flat()
const priceOf = (storeId: number, sku: string) => h.db.query<{ price: number }>('SELECT price FROM products WHERE store_id = ? AND sku = ?', storeId, sku)[0]?.price

beforeEach(async () => {
  h = createHarness({ TELEGRAM_BOT_TOKEN: 'bot-token', PUBLIC_STORE_BASE_URL: 'https://tiendas.test' })
  tiendaA = await seedStore(h.db, { slug: 'tienda-a', name: 'Tienda A', status: 'active' })
  tiendaB = await seedStore(h.db, { slug: 'tienda-b', name: 'Tienda B', status: 'active' })
  // Both stores existed before onboarding: keep the normal greeting in these tests.
  h.db.query('INSERT INTO store_onboarding_legacy_stores (store_id) VALUES (?), (?)', tiendaA, tiendaB)
  ownerUserId = await createStoreUser(h.db, { email: 'duena@a.test', storeId: tiendaA, role: 'owner', telegramUserId: String(OWNER) })
  await seedCatalog(h.db, tiendaA, { products: [{ sku: 'ABC123', name: 'Bolso de A', price: 50000, variants: [{ size: 'Única', stock: 5 }] }] })
  await seedCatalog(h.db, tiendaB, { products: [{ sku: 'ABC123', name: 'Gorra de B', price: 30000, variants: [{ size: 'Única', stock: 2 }] }] })
})
afterEach(() => vi.unstubAllGlobals())

const addOwnerToB = () => h.db.query("INSERT INTO store_memberships (store_id, user_id, role) VALUES (?, ?, 'owner')", tiendaB, ownerUserId)

describe('one Telegram account, several stores', () => {
  it('1. with a single store uses it automatically and explains how to link another', async () => {
    const telegram = stubTelegram()
    await send(textUpdate(OWNER, '/tiendas'))
    expect(telegram.messages().at(-1)).toContain('administras solo <b>Tienda A</b>')
    expect(buttons(telegram).map((b) => b.text)).toContain('⚙️ Administrar accesos')
    await send(callbackUpdate(OWNER, 'm:access'))
    expect(telegram.messages().at(-1)).toContain('/link')
  })

  it('2. with two stores shows a picker built only from real memberships', async () => {
    addOwnerToB()
    const ajena = await seedStore(h.db, { slug: 'ajena', name: 'Tienda Ajena', status: 'active' })
    const telegram = stubTelegram()
    await send(textUpdate(OWNER, 'hola'))
    expect(telegram.messages()[0]).toContain('tiendas que puedes administrar')
    const labels = buttons(telegram).map((b) => b.text).join('|')
    expect(labels).toContain('Tienda A')
    expect(labels).toContain('Tienda B')
    expect(labels).not.toContain('Tienda Ajena')
    expect(buttons(telegram).some((b) => b.callback_data === `s:select:${ajena}`)).toBe(false)
  })

  it('3-4. switches store, names it in the menu and keeps it on the next messages', async () => {
    addOwnerToB()
    const telegram = stubTelegram()
    await send(callbackUpdate(OWNER, `s:select:${tiendaA}`))
    await send(textUpdate(OWNER, '/cambiar_tienda'))
    expect(telegram.messages().at(-1)).toContain('🏪 Tienda actual: <b>Tienda A</b>')
    await send(callbackUpdate(OWNER, `s:select:${tiendaB}`))
    expect(telegram.messages().at(-1)).toContain('¡Perfecto! Ahora estás administrando <b>Tienda B</b>')
    expect(buttons(telegram).map((b) => b.text)).toEqual(['➕ Agregar producto', '📦 Inventario', '🛒 Pedidos', '🎨 Mi tienda', '🔄 Cambiar tienda', '✨ Asistente IA', '🔐 Contraseña del panel'])
    await send(textUpdate(OWNER, '/menu'))
    expect(telegram.messages().at(-1)).toContain('🏪 Tienda actual: <b>Tienda B</b>')
    await send(textUpdate(OWNER, '/inventario'))
    expect(telegram.messages().at(-1)).toContain('Gorra de B')
    expect(telegram.messages().at(-1)).not.toContain('Bolso de A')
    expect(h.db.query('SELECT active_store_id FROM telegram_sessions WHERE telegram_user_id = ?', String(OWNER))).toEqual([{ active_store_id: tiendaB }])
  })

  it('5. Gemini only receives the data of the active store after a switch', async () => {
    addOwnerToB()
    h.env.GEMINI_API_KEY = 'test-key'
    const geminiBodies: string[] = []
    stubTelegram((url, body) => {
      if (!url.includes('generativelanguage.googleapis.com')) return undefined
      geminiBodies.push(JSON.stringify(body))
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ action: 'ask_ai', params: { question: 'x' }, missing: [], summary: '', needsConfirmation: false, answer: 'Listo' }) }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } }))
    })
    await send(callbackUpdate(OWNER, `s:select:${tiendaA}`))
    await send(callbackUpdate(OWNER, `s:select:${tiendaB}`))
    await send(callbackUpdate(OWNER, 'm:ask_ai'))
    await send(textUpdate(OWNER, '¿Qué producto me conviene promocionar esta semana?'))
    expect(geminiBodies.length).toBeGreaterThan(0)
    const sent = geminiBodies.join('\n')
    expect(sent).toContain('Tienda B')
    expect(sent).not.toContain('Bolso de A')
    expect(sent).not.toContain('Tienda A')
  })

  it('6. the same SKU in two stores is resolved only inside the active store', async () => {
    addOwnerToB()
    const telegram = stubTelegram()
    await send(callbackUpdate(OWNER, `s:select:${tiendaB}`))
    await send(textUpdate(OWNER, 'Cambia el precio de ABC123 a 35.000'))
    expect(telegram.messages().at(-1)).toContain('Gorra de B')
    await send(callbackUpdate(OWNER, buttons(telegram).find((b) => /Confirmar/.test(b.text))!.callback_data!))
    expect(priceOf(tiendaB, 'ABC123')).toBe(35000)
    expect(priceOf(tiendaA, 'ABC123')).toBe(50000)

    h.db.query("DELETE FROM products WHERE store_id = ? AND sku = 'ABC123'", tiendaB)
    await send(textUpdate(OWNER, 'Cambia el precio de ABC123 a 1.000'))
    expect(telegram.messages().at(-1)).toContain('No encontré el producto ABC123')
    expect(priceOf(tiendaA, 'ABC123')).toBe(50000)
  })

  it('7. a store switch cancels pending changes of the previous store; old confirmations do nothing', async () => {
    addOwnerToB()
    const telegram = stubTelegram()
    await send(callbackUpdate(OWNER, `s:select:${tiendaA}`))
    await send(textUpdate(OWNER, 'Cambia el precio de ABC123 a 99.000'))
    const oldConfirm = buttons(telegram).find((b) => /Confirmar/.test(b.text))!.callback_data!
    await send(callbackUpdate(OWNER, `s:select:${tiendaB}`))
    expect(telegram.messages().at(-1)).toContain('Cancelé 1 cambio(s) pendiente(s)')
    await send(callbackUpdate(OWNER, oldConfirm))
    await send(callbackUpdate(OWNER, `s:select:${tiendaA}`))
    await send(callbackUpdate(OWNER, oldConfirm))
    expect(priceOf(tiendaA, 'ABC123')).toBe(50000)
    expect(priceOf(tiendaB, 'ABC123')).toBe(30000)
    expect(h.db.query("SELECT status FROM telegram_operations WHERE store_id = ? AND action = 'update_price'", tiendaA)).toEqual([{ status: 'cancelled' }])
  })

  it('8. a user cannot select or see a store without membership', async () => {
    const telegram = stubTelegram()
    await send(callbackUpdate(OWNER, `s:select:${tiendaB}`))
    await send(textUpdate(OWNER, '/inventario'))
    expect(telegram.messages().join('\n')).not.toContain('Gorra de B')
    expect(h.db.query('SELECT active_store_id FROM telegram_sessions WHERE telegram_user_id = ?', String(OWNER))).toEqual([{ active_store_id: tiendaA }])

    const stranger = stubTelegram()
    await send(callbackUpdate(9999, `s:select:${tiendaA}`))
    await send(textUpdate(9999, '/inventario'))
    expect(stranger.messages().join('\n')).not.toContain('Bolso de A')
  })

  it('9. revoking access removes the store from the next message on', async () => {
    addOwnerToB()
    const telegram = stubTelegram()
    await send(callbackUpdate(OWNER, `s:select:${tiendaB}`))
    h.db.query("UPDATE store_memberships SET status = 'revoked' WHERE store_id = ? AND user_id = ?", tiendaB, ownerUserId)
    await send(textUpdate(OWNER, '/inventario'))
    expect(telegram.messages().at(-1)).toContain('Bolso de A')
    expect(telegram.messages().at(-1)).not.toContain('Gorra de B')
    await send(callbackUpdate(OWNER, `s:select:${tiendaB}`))
    expect(telegram.messages().at(-1)).toContain('No tienes acceso a esa tienda')
  })

  it('10. a one-time code of a new store adds a membership to the existing Telegram account', async () => {
    const newOwner = await createStoreUser(h.db, { email: 'otro-correo@b.test', storeId: tiendaB, role: 'owner', status: 'invited' })
    const code = await createAccessToken(h.db, { userId: newOwner, storeId: tiendaB, purpose: 'telegram_link', ttlSeconds: 600, createdBy: 'test' })
    const result = await linkTelegramAccount(OWNER, code, h.db)
    expect(result.success).toBe(true)
    expect(result.message).toContain('Tienda B')
    expect(h.db.query('SELECT store_id, role, status FROM store_memberships WHERE user_id = ? ORDER BY store_id', ownerUserId))
      .toEqual([{ store_id: tiendaA, role: 'owner', status: 'active' }, { store_id: tiendaB, role: 'owner', status: 'active' }])
    expect(h.db.query('SELECT COUNT(*) AS n FROM platform_users WHERE telegram_user_id = ?', String(OWNER))).toEqual([{ n: 1 }])
    // The same code cannot be reused, and it never lowers an existing role.
    expect((await linkTelegramAccount(OWNER, code, h.db)).success).toBe(false)
  })

  it('10b. the master provisioning reuses the account of an existing Telegram owner', async () => {
    const before = h.db.query<{ n: number }>('SELECT COUNT(*) AS n FROM platform_users')[0]!.n
    const result = await provisionStore(h.db, h.env, { name: 'Tienda Nueva', businessType: 'Ropa', template: 'moderno', ownerTelegramId: String(OWNER), planCode: 'basico' } as never, { requestKey: 'test-reuse-owner-1', actor: 'test' })
    expect(result.status).toBe('completed')
    expect(h.db.query<{ n: number }>('SELECT COUNT(*) AS n FROM platform_users')[0]!.n).toBe(before)
    const stores = h.db.query<{ name: string }>("SELECT s.name FROM store_memberships m JOIN stores s ON s.id = m.store_id WHERE m.user_id = ? AND m.status = 'active' ORDER BY s.id", ownerUserId)
    expect(stores.map((row) => row.name)).toEqual(['Tienda A', 'Tienda Nueva'])
    expect(result.telegramLinkCode ?? null).toBeNull()
  })

  it('11. the legacy owner keeps the primary store (SneakerHub) when another store is linked', async () => {
    h.env.TELEGRAM_OWNER_ID = '7002'
    const primaryBefore = h.db.query('SELECT * FROM store_config WHERE id = 1')
    const productsBefore = h.db.query('SELECT * FROM products WHERE store_id = 1')
    const invited = await createStoreUser(h.db, { email: 'nueva@b.test', storeId: tiendaB, role: 'owner', status: 'invited' })
    const code = await createAccessToken(h.db, { userId: invited, storeId: tiendaB, purpose: 'telegram_link', ttlSeconds: 600, createdBy: 'test' })
    expect((await linkTelegramAccount(7002, code, h.db)).success).toBe(true)
    const telegram = stubTelegram()
    await send(textUpdate(7002, '/tiendas'))
    const labels = buttons(telegram).map((b) => b.text).join('|')
    expect(labels).toContain('Tienda B')
    expect(buttons(telegram).some((b) => b.callback_data === 's:select:1')).toBe(true)
    await send(callbackUpdate(7002, 's:select:1'))
    expect(telegram.messages().at(-1)).toContain('Ahora estás administrando')
    expect(h.db.query('SELECT * FROM store_config WHERE id = 1')).toEqual(primaryBefore)
    expect(h.db.query('SELECT * FROM products WHERE store_id = 1')).toEqual(productsBefore)
  })

  it('12. buttons from another store are never applied to the active store', async () => {
    addOwnerToB()
    const telegram = stubTelegram()
    await send(callbackUpdate(OWNER, `s:select:${tiendaB}`))
    const themeB = h.db.query('SELECT theme_config, primary_color FROM store_config WHERE id = ?', tiendaB)
    const templateB = h.db.query('SELECT template FROM stores WHERE id = ?', tiendaB)
    await send(callbackUpdate(OWNER, `tpl:${tiendaA}:apply:urban`))
    await send(callbackUpdate(OWNER, `pal:${tiendaA}:1D4ED8:balanced`))
    await send(callbackUpdate(OWNER, `ob:${tiendaA}:template:urban`))
    expect(telegram.messages().at(-1)).toContain('otra tienda')
    expect(h.db.query('SELECT theme_config, primary_color FROM store_config WHERE id = ?', tiendaB)).toEqual(themeB)
    expect(h.db.query('SELECT template FROM stores WHERE id = ?', tiendaB)).toEqual(templateB)
    expect(h.db.query('SELECT template FROM stores WHERE id = ?', tiendaA)).not.toEqual([{ template: 'urban' }])
    expect(h.db.query("SELECT COUNT(*) AS n FROM telegram_operations WHERE status = 'pending'")).toEqual([{ n: 0 }])
  })

  it('does not serve administrative data in group chats', async () => {
    const telegram = stubTelegram()
    const update = textUpdate(OWNER, '/inventario') as { message: { chat: { id: number; type: string } } }
    update.message.chat = { id: -100123, type: 'group' }
    await send(update)
    expect(telegram.messages()).toEqual([])
  })
})
