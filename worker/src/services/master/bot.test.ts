import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPng } from '../../../test/sqliteD1'
import { callbackUpdate, createHarness, createStoreUser, photoUpdate, seedStore, stubTelegram, textUpdate, type Harness } from '../../testing/harness'
import { detectMasterIntent, parseColors, parseOwner } from './bot'

const ADMIN = 9001
const SECRET = 'master-webhook-secret'
let h: Harness

beforeEach(() => {
  h = createHarness({ MASTER_BOT_TOKEN: 'master-token', MASTER_WEBHOOK_SECRET: SECRET, MASTER_ADMIN_TELEGRAM_IDS: `${ADMIN}, 9002`, TELEGRAM_BOT_USERNAME: 'TiendasAsistenteBot' })
})
afterEach(() => vi.unstubAllGlobals())

const deliver = (update: unknown, secret = SECRET) => h.request('/api/master/webhook', { method: 'POST', body: update, headers: secret ? { 'X-Telegram-Bot-Api-Secret-Token': secret } : {} })
const say = (text: string) => deliver(textUpdate(ADMIN, text))
const tap = (data: string) => deliver(callbackUpdate(ADMIN, data))
/** Telegram stub that also serves an image for getFile downloads (logo uploads). */
const stubWithImages = (png = createPng(512, 512)) => stubTelegram((url) => {
  if (url.includes('/getFile')) return new Response(JSON.stringify({ ok: true, result: { file_path: 'photos/logo.png', file_size: png.byteLength } }))
  if (url.includes('/file/bot')) return new Response(png, { headers: { 'content-length': String(png.byteLength) } })
  return undefined
})
const button = (telegram: ReturnType<typeof stubTelegram>, label: RegExp) => (telegram.lastMarkup()?.inline_keyboard || []).flat().find((item) => label.test(item.text))?.callback_data

describe('master bot access', () => {
  it('requires its own webhook secret and ignores non-admin users without replying', async () => {
    const telegram = stubTelegram()
    expect((await deliver(textUpdate(ADMIN, '/start'), 'wrong')).status).toBe(403)
    expect(await (await deliver(textUpdate(1234, '/tiendas'))).json()).toMatchObject({ rejected: true })
    expect(telegram.messages()).toHaveLength(0)
    await say('/start')
    expect(telegram.messages()[0]).toContain('bot maestro')
    expect((telegram.lastMarkup()?.inline_keyboard || []).flat().map((item) => item.text)).toEqual([
      '➕ Crear nueva tienda', '🏪 Ver mis tiendas', '👤 Administrar propietarios', '⚙️ Configuración de plataforma', '📊 Estadísticas', '✨ Ayuda con IA',
    ])
  })

  it('never lets an unauthorized account start, confirm or change anything', async () => {
    const telegram = stubTelegram()
    await seedStore(h.db, { slug: 'moda-urbana', name: 'Moda Urbana' })
    const intruder = 4444
    for (const update of [
      textUpdate(intruder, '/crear_tienda Tienda Falsa'), textUpdate(intruder, 'suspende moda-urbana'), textUpdate(intruder, '/suspender moda-urbana'),
      callbackUpdate(intruder, 'mt:create'), callbackUpdate(intruder, 'mt:wz:create'), callbackUpdate(intruder, 'mt:suspend:moda-urbana'), callbackUpdate(intruder, 'mt:config'),
    ]) {
      expect(await (await deliver(update)).json()).toMatchObject({ rejected: true })
    }
    // Group chats, or a message forwarded by an admin into another chat, are ignored too.
    const group = textUpdate(ADMIN, '/crear_tienda')
    group.message.chat = { id: -100123, type: 'group' as 'private' }
    await deliver(group)
    expect(telegram.messages()).toHaveLength(0)
    expect(h.db.query('SELECT COUNT(*) AS n FROM platform_conversations')).toEqual([{ n: 0 }])
    expect(h.db.query('SELECT COUNT(*) AS n FROM platform_operations')).toEqual([{ n: 0 }])
    expect(h.db.query("SELECT status FROM stores WHERE slug = 'moda-urbana'")).toEqual([{ status: 'active' }])
  })

  it('accepts admin ids separated by commas, semicolons or spaces', async () => {
    h = createHarness({ MASTER_BOT_TOKEN: 'master-token', MASTER_WEBHOOK_SECRET: SECRET, MASTER_ADMIN_TELEGRAM_IDS: ' 9001;9002  9003 ,abc' })
    const telegram = stubTelegram()
    await deliver(textUpdate(9003, '/menu'))
    expect(telegram.messages()).toHaveLength(1)
    expect(await (await deliver(textUpdate(123, '/menu'))).json()).toMatchObject({ rejected: true })
  })

  it('deduplicates updates in its own ledger, independent from the store assistant', async () => {
    const telegram = stubTelegram()
    const update = textUpdate(ADMIN, '/resumen')
    h.db.query('INSERT INTO processed_updates (update_id) VALUES (?)', update.update_id)
    await deliver(update)
    expect(await (await deliver(update)).json()).toMatchObject({ duplicate: true })
    expect(telegram.messages()).toHaveLength(1)
  })
})

describe('/crear_tienda guided flow', () => {
  it('asks the requested questions in order, shows a summary and delivers the store without internal data', async () => {
    const telegram = stubWithImages()
    await say('/crear_tienda')
    expect(telegram.messages().at(-1)).toContain('¿Cómo se llama el negocio?')
    await say('Moda Urbana')
    expect(telegram.messages().at(-1)).toContain('¿Qué tipo de comercio es?')
    await say('Ropa y accesorios')
    expect(telegram.messages().at(-1)).toContain('¿Quién es el propietario?')
    await say('Laura Ríos, duena@modaurbana.test')
    expect(telegram.messages().at(-1)).toContain('WhatsApp comercial')
    await say('+57 300 123 4567')
    expect(telegram.messages().at(-1)).toContain('plantilla visual')
    expect((telegram.lastMarkup()?.inline_keyboard || []).flat().map((item) => item.text)).toEqual(expect.arrayContaining(['Minimalista', 'Moderno', 'Premium', 'Personalizado', 'Urban', 'Editorial']))
    await tap('mt:wz:style:premium')
    expect(telegram.messages().at(-1)).toContain('colores principales')
    await say('azul oscuro y dorado')
    expect(telegram.messages().at(-1)).toContain('logotipo')
    await say('no tengo')
    expect(telegram.messages().at(-1)).toContain('Envíame el logotipo como imagen')
    await deliver(photoUpdate(ADMIN, 'logo-file-id'))
    expect(telegram.messages().at(-1)).toContain('plan')
    await tap('mt:wz:plan:profesional')
    const summary = telegram.messages().at(-1)!
    expect(summary).toContain('Resumen de la nueva tienda')
    expect(summary).toContain('https://tiendas.test/t/moda-urbana')
    expect(summary).toContain('Laura Ríos · duena@modaurbana.test')
    expect(summary).toContain('Premium · colores: #153D70 y #B08D57')
    expect(summary).toContain('Logotipo: ✅ recibido')
    expect(summary).toContain('Plan: Profesional')
    expect((telegram.lastMarkup()?.inline_keyboard || []).flat().map((item) => item.text)).toEqual(['✅ Crear tienda', '✏️ Modificar información', '✖ Cancelar'])
    expect(h.db.query("SELECT COUNT(*) AS n FROM stores WHERE slug = 'moda-urbana'")).toEqual([{ n: 0 }])

    await tap('mt:wz:create')
    const delivered = telegram.messages().at(-1)!
    expect(delivered).toContain('¡Tienda creada!')
    expect(delivered).toContain('Moda Urbana')
    expect(delivered).toContain('Dirección pública: https://tiendas.test/t/moda-urbana')
    expect(delivered).toContain('Estado: 📝 Borrador')
    expect(delivered).toContain('https://tiendas.test/t/moda-urbana/admin/activar?token=')
    expect(delivered).toContain('https://t.me/TiendasAsistenteBot?start=link_')
    expect(delivered).toContain('Cómo administrarla')
    expect(delivered).toContain('Logotipo aplicado')
    const store = h.db.query<any>("SELECT id, status, template FROM stores WHERE slug = 'moda-urbana'")[0]
    // No infrastructure details: no internal ids, job ids or provider names.
    // Random one-time codes and links may contain "R2" or "D1" by chance: check only the prose.
    const prose = delivered.replace(/<code>[^<]*<\/code>/g, '').replace(/https?:\/\/\S+/g, '')
    for (const internal of [`#${store.id}`, 'job', 'D1', 'R2', 'Worker', 'provisioning']) expect(prose).not.toContain(internal)
    expect(store).toMatchObject({ status: 'draft', template: 'premium' })
    const config = h.db.query<any>('SELECT primary_color, accent_color, logo_url FROM store_config WHERE id = ?', store.id)[0]
    expect(config).toMatchObject({ primary_color: '#153D70', accent_color: '#B08D57' })
    expect(config.logo_url).toMatch(new RegExp(`^/api/assets/stores/${store.id}/store/logo-[0-9a-f-]{36}\\.png$`))
    expect(await h.assets.get(config.logo_url.replace('/api/assets/', ''))).not.toBeNull()
    expect(h.db.query("SELECT display_name, email FROM platform_users WHERE email = 'duena@modaurbana.test'")).toEqual([{ display_name: 'Laura Ríos', email: 'duena@modaurbana.test' }])
    expect(h.db.query('SELECT action FROM audit_log WHERE store_id = ? ORDER BY id', store.id).map((row: any) => row.action)).toEqual(['store_provisioned', 'store_logo_set'])

    // A delayed second tap on the same summary does not create a second store.
    await h.db.prepare(`INSERT INTO platform_conversations (chat_id, flow, step, data_json, expires_at) VALUES (?, 'create_store', 'summary', ?, unixepoch() + 600)`)
      .bind(String(ADMIN), JSON.stringify({ name: 'Moda Urbana', slug: 'moda-urbana', businessType: 'Ropa y accesorios', ownerName: 'Laura Ríos', ownerEmail: 'duena@modaurbana.test', whatsapp: '+573001234567', template: 'premium', primaryColor: '#153D70', accentColor: '#B08D57', logoFileId: 'logo-file-id', planCode: 'profesional', editing: true })).run()
    await tap('mt:wz:create')
    expect(telegram.messages().at(-1)).toContain('no se duplicó')
    expect(telegram.messages().at(-1)).not.toContain('activar?token=')
    expect(h.db.query("SELECT COUNT(*) AS n FROM stores WHERE slug LIKE 'moda-urbana%'")).toEqual([{ n: 1 }])
    expect(h.db.query("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'store_logo_set'")).toEqual([{ n: 1 }])
  })

  it('rejects an unusable logo and keeps asking, without creating anything', async () => {
    const telegram = stubWithImages(createPng(64, 64))
    await h.db.prepare(`INSERT INTO platform_conversations (chat_id, flow, step, data_json, expires_at) VALUES (?, 'create_store', 'logo', '{"name":"Velas Luz","slug":"velas-luz"}', unixepoch() + 600)`).bind(String(ADMIN)).run()
    await deliver(photoUpdate(ADMIN, 'tiny-logo'))
    expect(telegram.messages().at(-1)).toContain('No pude usar esa imagen')
    expect(h.db.query<any>('SELECT step FROM platform_conversations')[0].step).toBe('logo')
    expect(h.db.query("SELECT COUNT(*) AS n FROM stores WHERE slug = 'velas-luz'")).toEqual([{ n: 0 }])
  })

  it('lets the operator skip optional steps, edit a field from the summary and cancel at any time', async () => {
    const telegram = stubTelegram()
    await say('crea una tienda llamada Pixel Accesorios')
    expect(telegram.messages().at(-1)).toContain('Pixel Accesorios')
    await say('Accesorios para celulares')
    await say('8811223344')
    await tap('mt:wz:skipwa')
    await tap('mt:wz:style:moderno')
    await tap('mt:wz:skipcolor')
    await tap('mt:wz:skiplogo')
    await tap('mt:wz:plan:basico')
    expect(telegram.messages().at(-1)).toContain('colores: los de la plantilla')
    expect(telegram.messages().at(-1)).toContain('Telegram 8811223344')
    await tap('mt:wz:edit')
    expect((telegram.lastMarkup()?.inline_keyboard || []).flat().map((item) => item.text)).toEqual(expect.arrayContaining(['Colores', 'Logotipo', 'Tipo de comercio']))
    await tap('mt:wz:field:slug')
    await say('pixel')
    expect(telegram.messages().at(-1)).toContain('https://tiendas.test/t/pixel')
    await tap('mt:wz:field:color')
    await say('#0F766E')
    expect(telegram.messages().at(-1)).toContain('colores: #0F766E')
    await tap('mt:wz:cancel')
    expect(telegram.messages().at(-1)).toContain('No se creó ninguna tienda')
    expect(h.db.query("SELECT COUNT(*) AS n FROM stores WHERE slug = 'pixel'")).toEqual([{ n: 0 }])
  })

  it('opens from the menu button and /cancelar leaves no records behind', async () => {
    const telegram = stubTelegram()
    const before = h.db.query<{ n: number }>('SELECT COUNT(*) AS n FROM stores')[0]!.n
    await tap('mt:create')
    expect(telegram.messages().at(-1)).toContain('¿Cómo se llama el negocio?')
    await say('Tienda de Prueba')
    await say('Velas artesanales')
    await say('/cancelar')
    expect(telegram.messages().at(-1)).toContain('No se aplicó ningún cambio')
    expect(h.db.query('SELECT COUNT(*) AS n FROM stores')).toEqual([{ n: before }])
    for (const table of ['platform_conversations', 'provisioning_jobs', 'platform_users', 'store_memberships', 'user_access_tokens']) {
      expect(h.db.query(`SELECT COUNT(*) AS n FROM ${table}`)).toEqual([{ n: 0 }])
    }
    // After cancelling, plain text is no longer taken as a wizard answer.
    await say('Ropa')
    expect(h.db.query('SELECT COUNT(*) AS n FROM platform_conversations')).toEqual([{ n: 0 }])
  })
})

describe('wizard answer parsing', () => {
  it('reads one or two brand colors and the owner name with contact', () => {
    expect(parseColors('azul oscuro y dorado')).toEqual(['#153D70', '#B08D57'])
    expect(parseColors('#153d70, 0f766e')).toEqual(['#153D70', '#0F766E'])
    expect(parseColors('verde')).toEqual(['#237A57'])
    expect(parseColors('década')).toEqual([])
    expect(parseOwner('María Gómez maria@correo.com')).toEqual({ name: 'María Gómez', email: 'maria@correo.com' })
    expect(parseOwner('correo: Pedro@Tienda.co, telegram 123456789')).toEqual({ email: 'pedro@tienda.co', telegramId: '123456789' })
    expect(parseOwner('Ana')).toBeNull()
  })
})

describe('master menu sections', () => {
  it('lists owners without exposing access codes and shows the platform configuration without secrets', async () => {
    const telegram = stubTelegram()
    const withOwner = await seedStore(h.db, { slug: 'moda-urbana', name: 'Moda Urbana' })
    await seedStore(h.db, { slug: 'pixel', name: 'Pixel' })
    await createStoreUser(h.db, { email: 'duena@modaurbana.test', storeId: withOwner, role: 'owner', status: 'invited' })
    await tap('mt:owners')
    const owners = telegram.messages().at(-1)!
    expect(owners).toContain('duena@modaurbana.test · Telegram pendiente · panel sin activar')
    expect(owners).toMatch(/Pixel<\/b> · <code>pixel<\/code>\n {3}<i>sin propietario asignado/)
    expect(button(telegram, /Nuevos accesos · Moda Urbana/)).toBe('mt:access:moda-urbana')
    expect(button(telegram, /Pixel/)).toBeUndefined()

    await tap('mt:config')
    const config = telegram.messages().at(-1)!
    expect(config).toContain('Configuración de la plataforma')
    expect(config).toContain('@TiendasAsistenteBot')
    expect(config).toContain('Administradores de este bot: 2')
    expect(config).toMatch(/Básico|basico/)
    for (const secret of ['master-token', SECRET, String(ADMIN)]) expect(config).not.toContain(secret)

    await tap('mt:summary')
    expect(telegram.messages().at(-1)).toContain('Resumen de la plataforma')
    expect(button(telegram, /Salud técnica/)).toBe('mt:health')
  })

  it('answers one question with AI from platform facts only, without owner contact data', async () => {
    h = createHarness({ MASTER_BOT_TOKEN: 'master-token', MASTER_WEBHOOK_SECRET: SECRET, MASTER_ADMIN_TELEGRAM_IDS: String(ADMIN), GEMINI_API_KEY: 'gemini-test' })
    const storeId = await seedStore(h.db, { slug: 'moda-urbana', name: 'Moda Urbana' })
    await createStoreUser(h.db, { email: 'duena@modaurbana.test', storeId, role: 'owner' })
    const telegram = stubTelegram((url) => url.includes('generativelanguage.googleapis.com')
      ? new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ answer: 'Tienes 1 tienda activa: Moda Urbana.' }) }] } }], usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 40 } }))
      : undefined)
    await tap('mt:ask')
    expect(telegram.messages().at(-1)).toContain('Ayuda con IA')
    await say('¿Qué tiendas tengo funcionando?')
    expect(telegram.messages().at(-1)).toContain('Tienes 1 tienda activa: Moda Urbana.')
    const prompt = JSON.stringify(telegram.calls.find((call) => call.url.includes('generativelanguage'))!.body)
    expect(prompt).toContain('moda-urbana')
    expect(prompt).not.toContain('duena@modaurbana.test')
    expect(h.db.query("SELECT COUNT(*) AS n FROM platform_events WHERE code = 'GEMINI_USAGE'")).toEqual([{ n: 1 }])
    // The question mode lasts for one answer; orders still require confirmation.
    expect(h.db.query('SELECT COUNT(*) AS n FROM platform_conversations')).toEqual([{ n: 0 }])
    await tap('mt:ask')
    await say('suspende moda-urbana')
    expect(telegram.messages().at(-1)).toContain('Confirma esta operación')
    expect(h.db.query("SELECT status FROM stores WHERE slug = 'moda-urbana'")).toEqual([{ status: 'active' }])
  })

  it('falls back to the command list when AI is not configured', async () => {
    const telegram = stubTelegram()
    await say('/pregunta ¿cómo cambio el plan de una tienda?')
    expect(telegram.messages().at(-1)).toContain('La IA no está configurada')
    expect(telegram.messages().at(-1)).toContain('/plan')
    expect(telegram.calls.some((call) => call.url.includes('generativelanguage'))).toBe(false)
  })
})

describe('store administration from the master bot', () => {
  it('suspends a store from natural language only after confirmation, and audits it', async () => {
    const telegram = stubTelegram()
    await seedStore(h.db, { slug: 'moda-urbana', name: 'Moda Urbana' })
    await say('suspende moda-urbana por falta de pago')
    expect(telegram.messages().at(-1)).toContain('Confirma esta operación')
    expect(h.db.query("SELECT status FROM stores WHERE slug = 'moda-urbana'")).toEqual([{ status: 'active' }])
    await tap(button(telegram, /Confirmar/)!)
    expect(h.db.query("SELECT status, suspended_reason FROM stores WHERE slug = 'moda-urbana'")).toEqual([{ status: 'suspended', suspended_reason: 'falta de pago' }])
    expect(h.db.query("SELECT performed_by FROM audit_log WHERE action = 'store_status_changed'")).toEqual([{ performed_by: `master:${ADMIN}` }])
  })

  it('sets AI limits and plans with confirmation and lists stores with their status', async () => {
    const telegram = stubTelegram()
    await seedStore(h.db, { slug: 'moda-urbana', name: 'Moda Urbana' })
    await say('/limite_ia moda-urbana 5')
    await tap(button(telegram, /Confirmar/)!)
    expect(h.db.query("SELECT ai_monthly_budget_micros, ai_enabled FROM stores WHERE slug = 'moda-urbana'")).toEqual([{ ai_monthly_budget_micros: 5000000, ai_enabled: 1 }])
    await say('/plan moda-urbana premium')
    await tap(button(telegram, /Confirmar/)!)
    expect(h.db.query("SELECT plan_code FROM stores WHERE slug = 'moda-urbana'")).toEqual([{ plan_code: 'premium' }])
    await say('/tiendas')
    expect(telegram.messages().at(-1)).toContain('Moda Urbana')
    await say('/tienda moda-urbana')
    expect(telegram.messages().at(-1)).toContain('Salud')
    await say('/resumen')
    expect(telegram.messages().at(-1)).toContain('Resumen de la plataforma')
  })

  it('refuses invalid transitions with a clear message and leaves the store unchanged', async () => {
    const telegram = stubTelegram()
    await say('/suspender 1')
    expect(telegram.messages().at(-1)).toMatch(/Confirma|No encontré/)
    await say('/plan no-existe premium')
    expect(telegram.messages().at(-1)).toContain('No encontré la tienda')
  })
})

describe('master natural language', () => {
  it('understands common administrative requests deterministically', () => {
    expect(detectMasterIntent('Crea una tienda llamada Moda Urbana')).toEqual({ action: 'create_store', name: 'Moda Urbana' })
    expect(detectMasterIntent('suspende la tienda moda-urbana por falta de pago')).toEqual({ action: 'suspend_store', store: 'moda-urbana', reason: 'falta de pago' })
    expect(detectMasterIntent('activa moda-urbana')).toEqual({ action: 'activate_store', store: 'moda-urbana' })
    expect(detectMasterIntent('sube el límite de IA de moda-urbana a 5 dólares')).toEqual({ action: 'set_ai_budget', store: 'moda-urbana', budgetUsd: 5 })
    expect(detectMasterIntent('cambia el plan de moda-urbana a premium')).toEqual({ action: 'set_plan', store: 'moda-urbana', plan: 'premium' })
    expect(detectMasterIntent('muéstrame las tiendas activas')).toEqual({ action: 'list_stores', status: 'activas' })
    expect(detectMasterIntent('¿cuántas tiendas tengo?')).toEqual({ action: 'summary' })
  })
})

describe('owner access delivery', () => {
  it('names the shared assistant with a one-tap link even when TELEGRAM_BOT_USERNAME is not configured', async () => {
    h = createHarness({ MASTER_BOT_TOKEN: 'master-token', MASTER_WEBHOOK_SECRET: SECRET, MASTER_ADMIN_TELEGRAM_IDS: String(ADMIN), TELEGRAM_BOT_TOKEN: 'assistant-token' })
    const telegram = stubTelegram((url) => url.includes('/botassistant-token/getMe') ? new Response(JSON.stringify({ ok: true, result: { id: 1, is_bot: true, username: 'AsistenteTiendasBot' } })) : undefined)
    const storeId = await seedStore(h.db, { slug: 'moda-urbana', name: 'Moda Urbana' })
    await createStoreUser(h.db, { email: 'duena@modaurbana.test', storeId, role: 'owner', status: 'invited' })
    await say('/acceso moda-urbana')
    await tap(button(telegram, /Confirmar/)!)
    const text = telegram.messages().at(-1)!
    expect(text).toContain('https://t.me/AsistenteTiendasBot?start=link_')
    expect(text).toContain('/t/moda-urbana/admin/activar?token=')
  })
})
