/** WAHA como proveedor alternativo de WhatsApp: firma HMAC-SHA512, normalización de los eventos reales de
 * GOWS (remitente @lid con teléfono en SenderAlt, álbumes, reenviados), vinculación, aislamiento, el mismo
 * motor de Telegram y los lotes de fotos agrupados por IA. WAHA y Gemini son dobles de prueba: esto NO
 * prueba entregas reales por WhatsApp. */
import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import worker from '../index'
import { createHarness, createStoreUser, seedCatalog, seedStore, userToken, type Harness } from '../testing/harness'
import { parseWahaEvent, verifyWahaSignature } from './waha'
import { maintainWhatsApp } from './processor'
import { _test as batchTest, consumeWhatsAppJobs } from './photoBatch'

const HMAC_KEY = 'clave-hmac-de-pruebas'
const GATEWAY = 'https://gateway.test'
const SESSION = 'tiendia'
const ANA_PHONE = '573001110001'
const ANA_LID = '111222333444555'
const INTRUSO_PHONE = '573009990009'
const context = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext

let h: Harness
let tienda: number
let otra: number
let anaId: number
let sent: Array<{ chatId: string; text: string }>
let images: Array<{ chatId: string; bytes: number; mimetype: string }>
let gatewayCalls: Array<{ path: string; headers: Record<string, string> }>
let files: Record<string, Uint8Array>
let geminiCalls: number
let groupingCalls: number
let grouping: (photos: number, request: any) => unknown
let sendStatus: number
let transcript: string
let counter = 0

const sign = (raw: string, key = HMAC_KEY) => createHmac('sha512', key).update(raw).digest('hex')
function post(payload: unknown, options: { signature?: string | null; algorithm?: string } = {}): Promise<Response> {
  const raw = typeof payload === 'string' ? payload : JSON.stringify(payload)
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Webhook-Hmac-Algorithm': options.algorithm ?? 'sha512', 'X-Webhook-Request-Id': `req-${++counter}` }
  const signature = options.signature === undefined ? sign(raw) : options.signature
  if (signature) headers['X-Webhook-Hmac'] = signature
  return Promise.resolve(worker.fetch(new Request('https://api.test/api/whatsapp/waha/webhook', { method: 'POST', headers, body: raw }), h.env, context))
}

/** Evento con la forma real que entrega GOWS (capturada en el entorno local con un número real). */
function event(payload: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  return { id: `evt_${++counter}`, timestamp: Date.now(), event: 'message', session: SESSION, me: { id: '573000009121@c.us', pushName: 'TiendIA' }, engine: 'GOWS', environment: { tier: 'CORE', version: '2026.10.1' }, payload, ...overrides }
}
function msg(from: { phone?: string; lid?: string }, body: string, extra: Record<string, unknown> = {}, message: Record<string, unknown> = { conversation: body }) {
  const jid = from.lid ? `${from.lid}@lid` : `${from.phone}@c.us`
  return event({
    id: `false_${jid}_${(++counter).toString(16).toUpperCase().padStart(20, 'A')}`, timestamp: Math.floor(Date.now() / 1000), from: jid, fromMe: false, source: 'app',
    to: '573000009121@c.us', body, hasMedia: false, media: null, ack: 1,
    _data: { Info: { Chat: jid, Sender: jid, IsFromMe: false, IsGroup: false, SenderAlt: from.phone ? `${from.phone}@s.whatsapp.net` : '', PushName: 'Ana Pruebas', Type: 'text' }, Message: message },
    ...extra,
  })
}
const say = (text: string, phone = ANA_PHONE) => post(msg({ phone, lid: phone === ANA_PHONE ? ANA_LID : undefined }, text))
function photo(file: string, options: { caption?: string; sha?: string; album?: string; forwarded?: boolean; phone?: string; mime?: string } = {}) {
  const phone = options.phone ?? ANA_PHONE
  return post(msg({ phone, lid: phone === ANA_PHONE ? ANA_LID : undefined }, options.caption ?? '', {
    hasMedia: true, media: { url: `http://localhost:3000/api/files/${SESSION}/${file}`, mimetype: options.mime ?? 'image/png', filename: null, error: null },
  }, {
    imageMessage: { mimetype: options.mime ?? 'image/png', caption: options.caption, fileSHA256: options.sha ?? Buffer.from(file.padEnd(32, 'x')).toString('base64'), fileLength: files[file]?.length ?? 1000, width: 400, height: 400,
      contextInfo: options.forwarded ? { isForwarded: true, forwardingScore: 1 } : {} },
    messageContextInfo: options.album ? { messageAssociation: { associationType: 1, parentMessageKey: { ID: options.album } } } : {},
  }))
}
const texts = () => sent.map((item) => item.text)
const last = () => texts().at(-1) || ''

async function linkCode(userId: number, email: string, store: string): Promise<string> {
  const response = await h.request('/api/whatsapp/link-code', { method: 'POST', token: await userToken(userId, email), store })
  expect(response.status).toBe(200)
  return (await response.json() as { code: string }).code
}
async function link(): Promise<void> {
  await say(`VINCULAR ${await linkCode(anaId, 'ana@pruebas.test', 'moda-wa')}`)
  expect(last()).toContain('vinculado')
  sent.length = 0
}

beforeEach(async () => {
  h = createHarness({
    WAHA_ENABLED: 'true', WAHA_API_URL: GATEWAY, WAHA_API_KEY: 'clave-sesion-limitada', WAHA_GATEWAY_TOKEN: 'token-gateway', WAHA_WEBHOOK_HMAC_KEY: HMAC_KEY, WAHA_SESSION: SESSION,
    WHATSAPP_ADMIN_BOT_ENABLED: 'true', WHATSAPP_PILOT_STORE_IDS: '*', TELEGRAM_BOT_TOKEN: 'bot-token', GEMINI_API_KEY: '', AI_MESSAGE_QUOTA_MODE: 'shadow',
  })
  tienda = await seedStore(h.db, { slug: 'moda-wa', name: 'Moda WA', status: 'active' })
  otra = await seedStore(h.db, { slug: 'otra-wa', name: 'Otra WA', status: 'active' })
  h.db.query('INSERT INTO store_onboarding_legacy_stores (store_id) VALUES (?), (?)', tienda, otra)
  anaId = await createStoreUser(h.db, { email: 'ana@pruebas.test', storeId: tienda, role: 'owner', telegramUserId: '7001' })
  await seedCatalog(h.db, tienda, { categories: [{ name: 'Calzado', slug: 'calzado' }], products: [
    { sku: 'SAN-1', name: 'Sandalias Guess', price: 80000, variants: [{ size: '38', color: 'Negro', stock: 1 }, { size: '39', color: 'Negro', stock: 2 }] },
  ] })
  await seedCatalog(h.db, otra, { products: [{ sku: 'AJENO-9', name: 'Tenis ajenos', price: 123456, variants: [{ size: '40', stock: 7 }] }] })
  sent = []
  images = []
  gatewayCalls = []
  files = {}
  geminiCalls = 0
  groupingCalls = 0
  sendStatus = 200
  transcript = 'llegaron tres pares más talla 38 de las sandalias'
  grouping = (photos) => ({ photos: Array.from({ length: photos }, (_, index) => ({ photo: index + 1, group: 1, isProduct: true })), groups: [{ group: 1, continuesPrevious: false, name: 'Tenis blancos urbanos', category: 'Calzado', colors: ['Blanco'], visibleBrand: '', description: 'Tenis blancos de suela gruesa.' }] })
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.startsWith(GATEWAY)) {
      const headers = init?.headers as Record<string, string>
      const path = url.slice(GATEWAY.length)
      gatewayCalls.push({ path, headers })
      if (path === '/api/sendText') {
        if (sendStatus !== 200) return new Response('{"error":"down"}', { status: sendStatus })
        const body = JSON.parse(String(init?.body))
        expect(body.session).toBe(SESSION)
        sent.push({ chatId: body.chatId, text: body.text })
        return new Response(JSON.stringify({ id: `true_${body.chatId}_OUT${++counter}` }))
      }
      if (path === '/api/sendImage') {
        const body = JSON.parse(String(init?.body))
        images.push({ chatId: body.chatId, bytes: Buffer.from(body.file.data, 'base64').length, mimetype: body.file.mimetype })
        return new Response(JSON.stringify({ id: `true_img_${++counter}` }))
      }
      if (/^\/api\/(sendSeen|startTyping|stopTyping)$/.test(path)) return new Response('{}')
      const file = /^\/api\/files\/tiendia\/(.+)$/.exec(path)?.[1]
      if (file) return files[file] ? new Response(files[file], { headers: { 'content-type': file.endsWith('.oga') ? 'audio/ogg' : 'image/png' } }) : new Response('', { status: 404 })
      return new Response('', { status: 404 })
    }
    if (url.includes('generativelanguage.googleapis.com')) {
      geminiCalls++
      const request = JSON.parse(String(init?.body))
      for (const part of request.contents?.[0]?.parts || []) {
        if (part.inlineData && Object.keys(part.inlineData).some((key) => !['mimeType', 'data'].includes(key))) {
          return new Response(JSON.stringify({ error: { status: 'INVALID_ARGUMENT', message: 'Invalid JSON payload received. Unknown name "seconds" at contents[0].parts[1].inline_data' } }), { status: 400 })
        }
      }
      const system = String(request.systemInstruction?.parts?.[0]?.text || '')
      if (request.contents?.[0]?.parts?.some((part: any) => part.inlineData?.mimeType === 'audio/ogg')) {
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ action: 'update_stock', params: { sku: 'SAN-1', size: '38', stock: 4 }, missing: [], summary: 'Sumar 3 a la 38', needsConfirmation: true, transcript }) }] } }], usageMetadata: { promptTokenCount: 400, candidatesTokenCount: 40 } }))
      }
      if (system.includes('Organizas fotografías')) {
        groupingCalls++
        const photos = request.contents[0].parts.filter((part: any) => part.inlineData).length
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(grouping(photos, request)) }] } }], usageMetadata: { promptTokenCount: 300 * photos, candidatesTokenCount: 80 } }))
      }
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ action: 'ask', params: {}, missing: [], summary: 'ok', needsConfirmation: false }) }] } }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10 } }))
    }
    if (url.includes('api.telegram.org')) return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }))
    throw new Error(`Llamada externa inesperada: ${url.split('?')[0]}`)
  }))
})
afterEach(() => vi.unstubAllGlobals())

describe('webhook de WAHA', () => {
  it('acepta solo la firma HMAC-SHA512 del cuerpo original con la clave configurada', async () => {
    const body = JSON.stringify(msg({ phone: ANA_PHONE }, 'hola'))
    expect((await post(body, { signature: null })).status).toBe(401)
    expect((await post(body, { signature: sign(body, 'otra-clave') })).status).toBe(401)
    expect((await post(body, { signature: sign(body).slice(0, 100) })).status).toBe(401)
    expect((await post(body.replace('hola', 'hol4'), { signature: sign(body) })).status).toBe(401)
    expect((await post(body, { algorithm: 'sha256' })).status).toBe(401)
    // The Meta signature header is not accepted here.
    const meta = await worker.fetch(new Request('https://api.test/api/whatsapp/waha/webhook', { method: 'POST', headers: { 'X-Hub-Signature-256': `sha256=${createHmac('sha256', HMAC_KEY).update(body).digest('hex')}` }, body }), h.env, context)
    expect(meta.status).toBe(401)
    expect(h.db.query('SELECT COUNT(*) AS n FROM whatsapp_messages')[0]).toEqual({ n: 0 })
    expect((await post(body)).status).toBe(200)
  })

  it('verifica la firma de un ejemplo calculado con openssl (hex sha512)', async () => {
    const raw = new TextEncoder().encode('{"event":"message"}')
    const hex = createHmac('sha512', 'k').update('{"event":"message"}').digest('hex')
    expect(await verifyWahaSignature(raw.buffer as ArrayBuffer, hex, 'sha512', 'k')).toBe(true)
    expect(await verifyWahaSignature(raw.buffer as ArrayBuffer, hex.toUpperCase(), 'SHA512', 'k')).toBe(true)
    expect(await verifyWahaSignature(raw.buffer as ArrayBuffer, hex, 'sha512', '')).toBe(false)
  })

  it('con WAHA apagado confirma la recepción y no procesa nada; sin clave responde 503', async () => {
    h.env.WAHA_ENABLED = 'false'
    const response = await say('hola')
    expect(await response.json()).toMatchObject({ disabled: true })
    expect(sent).toHaveLength(0)
    delete h.env.WAHA_WEBHOOK_HMAC_KEY
    expect((await say('hola')).status).toBe(503)
  })

  it('rechaza cargas excesivas', async () => {
    const huge = JSON.stringify(msg({ phone: ANA_PHONE }, 'x'.repeat(600 * 1024)))
    expect((await post(huge)).status).toBe(413)
  })

  it('ignora otra sesión, mensajes propios (sin bucles), grupos, canales, cabeceras de álbum y mensajes viejos', async () => {
    const reasons: string[] = []
    const check = async (payload: unknown) => reasons.push(String((await (await post(payload)).json() as { ignored?: string }).ignored))
    await check(msg({ phone: ANA_PHONE }, 'hola', {}, { conversation: 'hola' }) && { ...msg({ phone: ANA_PHONE }, 'hola'), session: 'otra' })
    await check(msg({ phone: ANA_PHONE }, 'eco', { fromMe: true }))
    await check(msg({ phone: ANA_PHONE }, 'grupo', { from: '1203630@g.us' }))
    await check(msg({ phone: ANA_PHONE }, 'canal', { from: '1203630@newsletter' }))
    await check(msg({ lid: ANA_LID, phone: ANA_PHONE }, '', {}, { albumMessage: { expectedImageCount: 3 } }))
    await check(msg({ phone: ANA_PHONE }, 'viejo', { timestamp: Math.floor(Date.now() / 1000) - 3600 }))
    await check(event({ status: 'WORKING' }, { event: 'message.any' }))
    expect(reasons).toEqual(['OTHER_SESSION', 'FROM_ME', 'NOT_PRIVATE', 'NOT_PRIVATE', 'ALBUM_HEADER', 'STALE', 'EVENT_NOT_HANDLED'])
    expect(sent).toHaveLength(0)
    expect(h.db.query('SELECT COUNT(*) AS n FROM whatsapp_messages')[0]).toEqual({ n: 0 })
  })

  it('un mensaje repetido por WAHA no se procesa dos veces', async () => {
    const payload = msg({ phone: INTRUSO_PHONE }, 'hola')
    await post(payload)
    expect(await (await post(payload)).json()).toMatchObject({ duplicate: true })
    expect(h.db.query("SELECT COUNT(*) AS n FROM whatsapp_messages WHERE direction = 'in' AND provider = 'waha'")[0]).toEqual({ n: 1 })
  })

  it('normaliza el remitente real de GOWS: LID en from y teléfono en SenderAlt; usa solo la ruta del archivo', () => {
    const parsed = parseWahaEvent(h.env, msg({ lid: ANA_LID, phone: ANA_PHONE }, 'Prueba 180 mil', {
      hasMedia: true, media: { url: 'http://evil.example/api/files/tiendia/ABC123.jpeg', mimetype: 'image/jpeg' },
    }, { imageMessage: { mimetype: 'image/jpeg', fileSHA256: Buffer.alloc(32, 7).toString('base64'), fileLength: 111378, width: 960, height: 1280, contextInfo: { isForwarded: true, forwardingScore: 1 } },
      messageContextInfo: { messageAssociation: { parentMessageKey: { ID: 'A594363D0ADF4E874B61A4A0B543C497' } } } }))
    expect(parsed.kind).toBe('message')
    if (parsed.kind !== 'message') return
    expect(parsed.inbound).toMatchObject({
      provider: 'waha', sessionId: SESSION, kind: 'image', caption: 'Prueba 180 mil', forwarded: true, albumId: 'A594363D0ADF4E874B61A4A0B543C497',
      sender: { phone: ANA_PHONE, businessUserId: null, key: ANA_PHONE },
      media: { ref: 'tiendia/ABC123.jpeg', mimeType: 'image/jpeg', size: 111378, sha256: '07'.repeat(32) },
    })
    // A file of another session is never downloaded.
    const foreign = parseWahaEvent(h.env, msg({ phone: ANA_PHONE }, '', { hasMedia: true, media: { url: 'http://localhost:3000/api/files/otra/X.jpeg', mimetype: 'image/jpeg' } }, { imageMessage: {} }))
    expect(foreign.kind === 'message' && foreign.inbound.kind).toBe('other')
    // Without a phone the LID is the identity, namespaced so it never collides with a Meta user id.
    const lidOnly = parseWahaEvent(h.env, msg({ lid: ANA_LID }, 'hola'))
    expect(lidOnly.kind === 'message' && lidOnly.inbound.sender).toMatchObject({ phone: null, businessUserId: `waha-lid:${ANA_LID}` })
  })

  it('registra el estado de la sesión (QR, conectada, caída) sin exponer el número completo', async () => {
    await post(event({ status: 'SCAN_QR_CODE' }, { event: 'session.status' }))
    await post(event({ status: 'WORKING' }, { event: 'session.status' }))
    await post(event({ status: 'FAILED' }, { event: 'session.status' }))
    expect(h.db.query("SELECT provider, session_name, status, phone_ending FROM whatsapp_channels")).toEqual([{ provider: 'waha', session_name: SESSION, status: 'FAILED', phone_ending: '9121' }])
    expect(h.db.query("SELECT level, detail FROM platform_events WHERE code = 'WAHA_SESSION_STATUS' ORDER BY id").map((row: any) => row.level)).toEqual(['warning', 'info', 'warning'])
  })
})

describe('conversación por WAHA con el motor común', () => {
  it('un número no vinculado solo recibe instrucciones, por el gateway con sus dos credenciales', async () => {
    await say('¿cuánto inventario hay?', INTRUSO_PHONE)
    expect(last()).toContain('VINCULAR')
    expect(sent[0]!.chatId).toBe(`${INTRUSO_PHONE}@c.us`)
    const call = gatewayCalls.find((item) => item.path === '/api/sendText')!
    expect(call.headers['X-Api-Key']).toBe('clave-sesion-limitada')
    expect(call.headers['X-Gateway-Token']).toBe('token-gateway')
    expect(h.db.query("SELECT provider, status FROM whatsapp_messages WHERE direction = 'out'")).toEqual([{ provider: 'waha', status: 'sent' }])
  })

  it('vincula con código de un solo uso y responde con menú numerado (sin botones interactivos)', async () => {
    await link()
    expect(h.db.query("SELECT phone, business_user_id FROM whatsapp_identities WHERE status = 'active'")).toEqual([{ phone: ANA_PHONE, business_user_id: null }])
    await say('menú')
    expect(last()).toMatch(/\n1\. /)
    expect(last()).toContain('Responde con el número')
  })

  it('protege entre comercios: otro número no administra la tienda y la tienda ajena no aparece', async () => {
    await link()
    await say('Cambia el precio de SAN-1 a 95 mil', INTRUSO_PHONE)
    expect(h.db.query('SELECT price FROM products WHERE sku = ? AND store_id = ?', 'SAN-1', tienda)).toEqual([{ price: 80000 }])
    await say('¿cuántas unidades quedan del AJENO-9?')
    expect(texts().join('\n')).not.toContain('123')
  })

  it('si WAHA no puede enviar, el mensaje queda como fallido y no se reintenta solo', async () => {
    sendStatus = 502
    await say('hola', INTRUSO_PHONE)
    expect(h.db.query("SELECT status, error_code FROM whatsapp_messages WHERE direction = 'in'")).toEqual([{ status: 'failed', error_code: 'WHATSAPP_SEND_502' }])
    expect(h.db.query("SELECT status, error_code FROM whatsapp_messages WHERE direction = 'out'")).toEqual([{ status: 'error', error_code: '502' }])
  })

  it('una nota de voz real de GOWS se transcribe (Gemini solo recibe mimeType y data)', async () => {
    await link()
    h.env.GEMINI_API_KEY = 'gemini-de-pruebas'
    h.db.query('UPDATE stores SET ai_enabled = 1, ai_monthly_budget_micros = 50000000 WHERE id = ?', tienda)
    const page = new Uint8Array(64)
    page.set([0x4f, 0x67, 0x67, 0x53])
    let rest = 48_000 * 6
    for (let i = 0; i < 8; i++) { page[6 + i] = rest % 256; rest = Math.floor(rest / 256) }
    files['VOZ1.oga'] = page
    await post(msg({ lid: ANA_LID, phone: ANA_PHONE }, '', {
      hasMedia: true, media: { url: `http://localhost:3000/api/files/${SESSION}/VOZ1.oga`, mimetype: 'audio/ogg; codecs=opus', filename: null, error: null },
    }, { audioMessage: { mimetype: 'audio/ogg; codecs=opus', PTT: true, seconds: 6 } }))
    expect(texts().join(' | ')).toContain('Entendí')
    expect(h.db.query("SELECT feature, status, channel FROM ai_usage_events WHERE feature = 'voz'")).toEqual([{ feature: 'voz', status: 'ok', channel: 'whatsapp_waha' }])
    expect(h.db.query("SELECT kind, audio_seconds FROM whatsapp_ai_ledger")).toEqual([{ kind: 'voice', audio_seconds: 6 }])
  })

  it('con lotes apagados, una foto entra al flujo de siempre (foto → borrador → confirmación)', async () => {
    await link()
    files['A1.png'] = await makePng(400, 400)
    await photo('A1.png', { caption: 'Agrega este producto: tenis rojos' })
    const pending = h.db.query<{ action: string; params_json: string }>("SELECT action, params_json FROM telegram_operations WHERE status = 'pending'")
    expect(pending.map((row) => row.action)).toEqual(['create_product'])
    expect(JSON.parse(pending[0]!.params_json).images).toHaveLength(1)
    expect(gatewayCalls.some((call) => call.path === '/api/files/tiendia/A1.png')).toBe(true)
  })
})

describe('lotes de fotos (WAHA)', () => {
  beforeEach(() => {
    h.env.WAHA_PHOTO_BATCH_ENABLED = 'true'
    h.env.GEMINI_API_KEY = 'gemini-de-pruebas'
    h.db.query('UPDATE stores SET ai_enabled = 1, ai_monthly_budget_micros = 50000000 WHERE id = ?', tienda)
  })
  const batch = () => h.db.query<any>('SELECT * FROM whatsapp_photo_batches ORDER BY rowid DESC LIMIT 1')[0]
  async function sendPhotos(count: number, options: { album?: string; prefix?: string } = {}): Promise<void> {
    for (let index = 0; index < count; index++) {
      const name = `${options.prefix ?? 'P'}${index}.png`
      files[name] = await makePng(400 + (index % 50), 400 + Math.floor(index / 50))
      await photo(name, { album: options.album })
    }
  }

  it('flujo completo: 8 fotos → un aviso → 3 productos → precio y tallas en una frase → confirmar → catálogo', async () => {
    await link()
    grouping = (photos) => ({
      photos: Array.from({ length: photos }, (_, index) => ({ photo: index + 1, group: index < 3 ? 1 : index < 6 ? 2 : 3, isProduct: true })),
      groups: [
        { group: 1, continuesPrevious: false, name: 'Tenis blancos urbanos', category: 'Calzado', colors: ['Blanco'], visibleBrand: '', description: 'Tenis blancos de suela gruesa.' },
        { group: 2, continuesPrevious: false, name: 'Sandalias de playa', category: 'Calzado', colors: ['Negro'], visibleBrand: '', description: 'Sandalias negras.' },
        { group: 3, continuesPrevious: false, name: 'Gorra deportiva', category: 'Accesorios', colors: ['Azul'], visibleBrand: 'Nike', description: 'Gorra azul.' },
      ],
    })
    await sendPhotos(8)
    // Eight photos, zero questions: nothing is said while photos arrive.
    expect(sent).toHaveLength(0)
    expect(batch()).toMatchObject({ photo_count: 8, status: 'grouping', analyzed_count: 8 })
    await say('listo')
    expect(texts().join(' | ')).toContain('He recibido 8 fotografías')
    expect(last()).toContain('He identificado *3 posibles productos*')
    expect(last()).toContain('Tenis blancos urbanos')
    expect(last()).toContain('1. ✅ Sí, preparar fichas')
    sent.length = 0

    await say('sí')
    expect(texts().join('\n')).toContain('Producto 1 de 3')
    expect(last()).toContain('precio')
    await say('180 mil, tallas 38 al 42, cinco de cada talla')
    expect(texts().join('\n')).toContain('5 variantes (25 u. en total)')
    // Nothing invented: the code is asked (a suggestion is offered), never assumed.
    if (/SKU/i.test(last())) await say('no')
    expect(last()).toContain('Vista previa')
    // The preview shows the product photo (WAHA sendImage with the merchant's own image bytes).
    expect(images.length).toBeGreaterThanOrEqual(1)
    expect(images[0]).toMatchObject({ chatId: `${ANA_PHONE}@c.us`, mimetype: 'image/png' })
    expect(h.db.query('SELECT COUNT(*) AS n FROM products WHERE store_id = ?', tienda)[0]).toEqual({ n: 1 })
    await say('Confirmar')
    const created = h.db.query<any>("SELECT id, name, price, image_urls FROM products WHERE store_id = ? AND name = 'Tenis blancos urbanos'", tienda)[0]
    expect(created).toMatchObject({ price: 180000 })
    expect(JSON.parse(created.image_urls)).toHaveLength(3)
    expect(h.db.query('SELECT size, stock FROM product_variants WHERE product_id = ? ORDER BY sort_order', created.id)).toEqual(['38', '39', '40', '41', '42'].map((size) => ({ size, stock: 5 })))
    expect(texts().join('\n')).toContain('Producto 2 de 3')

    await say('omitir')
    expect(texts().join('\n')).toContain('Producto 3 de 3')
    expect(texts().join('\n')).toContain('Veo la marca «Nike»')
    await say('cancelar lote')
    expect(batch()).toMatchObject({ status: 'cancelled', published_count: 1, skipped_count: 1 })
    expect(last()).toContain('siguen publicados')
    expect(h.db.query('SELECT COUNT(*) AS n FROM products WHERE store_id = ?', tienda)[0]).toEqual({ n: 2 })
    expect(h.db.query("SELECT COUNT(*) AS n FROM telegram_operations WHERE status = 'pending'")[0]).toEqual({ n: 0 })
    // Temporary photos of the batch are gone.
    expect((await h.env.ASSETS!.list({ prefix: 'whatsapp-batches/' })).objects).toHaveLength(0)
  })

  it('las fotos repetidas se cuentan aparte y no se descargan', async () => {
    await link()
    files['R1.png'] = await makePng(410, 410)
    await photo('R1.png', { sha: Buffer.alloc(32, 1).toString('base64') })
    await photo('R1.png', { sha: Buffer.alloc(32, 1).toString('base64') })
    await photo('R1.png', { sha: Buffer.alloc(32, 1).toString('base64') })
    expect(batch()).toMatchObject({ photo_count: 1, duplicate_count: 2 })
    expect(gatewayCalls.filter((call) => call.path === '/api/files/tiendia/R1.png')).toHaveLength(1)
    await say('listo')
    expect(last()).toContain('2 fotos repetidas no se tuvieron en cuenta')
  })

  it('varias fotos de un mismo producto quedan en un solo grupo; "une" y "quita" corrigen la agrupación', async () => {
    await link()
    grouping = (photos) => ({
      photos: Array.from({ length: photos }, (_, index) => ({ photo: index + 1, group: index + 1, isProduct: index !== photos - 1 })),
      groups: Array.from({ length: photos }, (_, index) => ({ group: index + 1, continuesPrevious: false, name: `Bolso ${index + 1}`, category: 'Bolsos', colors: [], visibleBrand: '', description: 'Bolso.' })),
    })
    await sendPhotos(4, { album: 'ALBUM00001' })
    await say('listo')
    expect(last()).toContain('3 posibles productos')
    expect(last()).toContain('1 imagen no parece un producto')
    await say('une 1 y 2')
    expect(last()).toContain('2 posibles productos')
    expect(last()).toMatch(/1\. \*Bolso 1\* \(2 fotos\)/)
    await say('quita 2')
    expect(last()).toContain('1 posible producto')
  })

  it('si la IA falla, cada álbum es un producto y nada se pierde', async () => {
    await link()
    grouping = () => { throw new Error('caída') }
    h.env.GEMINI_API_KEY = ''
    await sendPhotos(3, { album: 'ALBUMX0001', prefix: 'X' })
    await sendPhotos(2, { prefix: 'Y' })
    await say('listo')
    expect(last()).toContain('3 posibles productos')
    expect(last()).toContain('*Producto sin nombre* (3 fotos)')
  })

  it('20, 50 y 100 fotos: sin una pregunta por foto, analizadas por tandas y con costo de IA aparte de Telegram', async () => {
    await link()
    for (const total of [20, 50, 100]) {
      sent.length = 0
      groupingCalls = 0
      // Every 5 consecutive photos are one product (the model sees each chunk).
      grouping = (photos) => ({
        photos: Array.from({ length: photos }, (_, index) => ({ photo: index + 1, group: Math.floor(index / 5) + 1, isProduct: true })),
        groups: Array.from({ length: Math.ceil(photos / 5) }, (_, index) => ({ group: index + 1, continuesPrevious: false, name: `Producto ${index + 1}`, category: 'Calzado', colors: [], visibleBrand: '', description: 'Producto.' })),
      })
      await sendPhotos(total, { prefix: `L${total}-` })
      expect(sent).toHaveLength(0)
      await say('listo')
      const current = batch()
      expect(current.photo_count).toBe(total)
      expect(current.analyzed_count).toBe(total)
      expect(groupingCalls).toBe(Math.ceil(total / 8))
      // One notice and one summary for the whole batch.
      expect(sent.length).toBeLessThanOrEqual(3)
      expect(last()).toContain('posibles productos')
      await say('cancelar lote')
      // Each round is a separate minute for the anti-flood window.
      h.db.query('DELETE FROM whatsapp_throttles')
    }
    const usage = h.db.query<any>("SELECT channel, feature, COUNT(*) AS calls FROM ai_usage_events GROUP BY channel, feature")
    expect(usage).toEqual([{ channel: 'whatsapp_waha', feature: 'agrupar_fotos', calls: 3 + 7 + 13 }])
    // The store's monthly AI budget (Telegram / panel) is untouched.
    expect(h.db.query('SELECT COUNT(*) AS n FROM ai_usage_monthly')[0]).toEqual({ n: 0 })
  })

  it('respeta el máximo por lote y avisa una sola vez', async () => {
    await link()
    h.env.WAHA_PHOTO_BATCH_MAX = '5'
    await sendPhotos(8, { prefix: 'M' })
    expect(batch()).toMatchObject({ photo_count: 5, rejected_count: 3 })
    expect(texts().filter((text) => text.includes('máximo por lote'))).toHaveLength(1)
  })

  it('archivos que no son imagen válida se rechazan sin romper el lote', async () => {
    await link()
    files['malo.png'] = new TextEncoder().encode('<script>alert(1)</script>'.repeat(30))
    files['ok.png'] = await makePng(420, 420)
    await photo('malo.png')
    await photo('ok.png')
    expect(batch()).toMatchObject({ photo_count: 1, rejected_count: 1 })
  })

  it('lote sin resumen por un corte: la tarea programada lo termina; lotes abandonados se cancelan y se borran', async () => {
    await link()
    h.env.WAHA_PHOTO_QUIET_SECONDS = '0'
    await sendPhotos(2, { prefix: 'C' })
    h.db.query('UPDATE whatsapp_photo_batches SET last_photo_at = last_photo_at - 120')
    await maintainWhatsApp(h.env, h.env.DB)
    expect(batch().status).toBe('grouped')
    expect(last()).toContain('posible producto')
    h.db.query('UPDATE whatsapp_photo_batches SET updated_at = updated_at - 3 * 86400')
    await maintainWhatsApp(h.env, h.env.DB)
    expect(batch()).toMatchObject({ status: 'cancelled', error_code: 'EXPIRED' })
    expect((await h.env.ASSETS!.list({ prefix: 'whatsapp-batches/' })).objects).toHaveLength(0)
  })

  it('el lote es de una tienda: otro comerciante vinculado tiene su propio lote y no ve el ajeno', async () => {
    await link()
    const beto = await createStoreUser(h.db, { email: 'beto@pruebas.test', storeId: otra, role: 'owner' })
    await say(`VINCULAR ${await linkCode(beto, 'beto@pruebas.test', 'otra-wa')}`, INTRUSO_PHONE)
    await sendPhotos(2, { prefix: 'ANA' })
    files['BETO.png'] = await makePng(430, 430)
    await photo('BETO.png', { phone: INTRUSO_PHONE })
    const batches = h.db.query<any>('SELECT store_id, photo_count FROM whatsapp_photo_batches ORDER BY store_id')
    expect(batches).toEqual([{ store_id: tienda, photo_count: 2 }, { store_id: otra, photo_count: 1 }])
    await say('cancelar lote', INTRUSO_PHONE)
    expect(h.db.query<any>('SELECT status FROM whatsapp_photo_batches WHERE store_id = ?', tienda)[0].status).not.toBe('cancelled')
  })

  it('un resumen que no alcanzó a salir se envía con el siguiente mensaje del comerciante', async () => {
    await link()
    await sendPhotos(2, { prefix: 'Q' })
    await say('listo')
    expect(batch()).toMatchObject({ status: 'grouped' })
    expect(batch().receiving_notice_sent & 4).toBe(4)
    // Same state as a background step cut off after grouping and before the summary went out.
    h.db.query('UPDATE whatsapp_photo_batches SET receiving_notice_sent = receiving_notice_sent & ~4')
    sent.length = 0
    await say('hola')
    expect(last()).toContain('posible producto')
    expect(batch().receiving_notice_sent & 4).toBe(4)
  })

  it('fotos nuevas después del resumen reabren el lote y vuelven a avisar con el total nuevo', async () => {
    await link()
    await sendPhotos(2, { prefix: 'N' })
    await say('listo')
    expect(batch().status).toBe('grouped')
    sent.length = 0
    await sendPhotos(3, { prefix: 'NN' })
    expect(batch()).toMatchObject({ status: 'collecting', photo_count: 5 })
    await say('listo')
    expect(texts().join(' | ')).toContain('He recibido 5 fotografías')
    expect(last()).toContain('posible')
  })

  it('si WAHA está caído al enviar el resumen, el análisis queda guardado y el resumen sale al recuperarse', async () => {
    await link()
    h.env.WAHA_PHOTO_QUIET_SECONDS = '0'
    await sendPhotos(3, { prefix: 'D' })
    h.db.query('UPDATE whatsapp_photo_batches SET last_photo_at = last_photo_at - 120')
    sendStatus = 530
    await maintainWhatsApp(h.env, h.env.DB)
    expect(batch()).toMatchObject({ status: 'grouped', analyzed_count: 3 })
    expect(batch().receiving_notice_sent & 4).toBe(0)
    sendStatus = 200
    sent.length = 0
    h.db.query('UPDATE whatsapp_photo_batches SET updated_at = updated_at - 120')
    await maintainWhatsApp(h.env, h.env.DB)
    expect(last()).toContain('posible producto')
    expect(batch().receiving_notice_sent & 4).toBe(4)
  })

  it('la cola WHATSAPP_JOBS (opcional) ejecuta el paso y confirma el mensaje', async () => {
    await link()
    await sendPhotos(3, { prefix: 'J' })
    h.db.query('UPDATE whatsapp_photo_batches SET last_photo_at = last_photo_at - 60')
    const acked: string[] = []
    const message = (body: unknown) => ({ body, ack: () => acked.push('ack'), retry: () => acked.push('retry') })
    await consumeWhatsAppJobs({ messages: [message({ type: 'photo_batch_step', batchId: batch().id }), message({ type: 'otro' })] } as never, h.env)
    expect(acked).toEqual(['ack', 'ack'])
    expect(batch().status).toBe('grouped')
    expect(last()).toContain('posible producto')
  })

  it('con cola: ninguna IA en segundo plano, un solo trabajo por lote y nunca se pierde por un candado', async () => {
    await link()
    const jobs: Array<{ body: any; delay?: number }> = []
    h.env.WHATSAPP_JOBS = { send: async (body: unknown, options?: { delaySeconds?: number }) => { jobs.push({ body, delay: options?.delaySeconds }) } } as never
    await sendPhotos(20, { prefix: 'Z' })
    // Twenty photos: no AI call while they arrive (it would run inside waitUntil) and one job armed, not twenty.
    expect(groupingCalls).toBe(0)
    expect(jobs).toHaveLength(1)
    const run = async () => {
      const acked: string[] = []
      const job = jobs.shift()!
      await consumeWhatsAppJobs({ messages: [{ body: job.body, ack: () => acked.push('ack'), retry: () => acked.push('retry') }] } as never, h.env)
      return acked
    }
    // Photos still arriving: the full chunk is analysed, the job re-arms itself and nothing is said yet.
    expect(await run()).toEqual(['ack'])
    // In the queue the chunks are of 16 photos.
    expect(batch().analyzed_count).toBe(16)
    expect(jobs).toHaveLength(1)
    expect(sent).toHaveLength(0)
    // A lock left by a step that was cut off: the job is scheduled again, not dropped.
    h.db.query('UPDATE whatsapp_photo_batches SET lock_until = unixepoch() + 60, last_photo_at = last_photo_at - 60')
    expect(await run()).toEqual(['ack'])
    expect(jobs).toHaveLength(1)
    expect(jobs[0]!.delay).toBeGreaterThanOrEqual(60)
    h.db.query('UPDATE whatsapp_photo_batches SET lock_until = NULL')
    expect(await run()).toEqual(['ack'])
    expect(batch()).toMatchObject({ status: 'grouped', analyzed_count: 20 })
    expect(last()).toContain('He identificado')
    expect(jobs).toHaveLength(0)
  })

  it('lee precio y tallas escritos por el comerciante sin inventar nada', () => {
    const draft = { version: 1, stage: 'collecting', fields: {}, variants: [], images: [], primaryImageIndex: 0 } as any
    expect(batchTest.applyMerchantText(draft, 'Recarga del 20 al 33 $60.000')).toBe(true)
    expect(draft.fields.price).toBe(60000)
    expect(draft.variants).toEqual([])
    expect(batchTest.withoutBrand('Zapatillas deportivas Nike Dunk Low', 'Nike')).toBe('Zapatillas deportivas Dunk Low')
    expect(batchTest.withoutBrand('Zapatillas infantiles Coach', 'Coach')).toBe('Zapatillas infantiles')
    expect(batchTest.withoutBrand('Nike', 'Nike')).toBe('Nike')
    const plain = { version: 1, stage: 'collecting', fields: {}, variants: [], images: [], primaryImageIndex: 0 } as any
    expect(batchTest.applyMerchantText(plain, 'zapatos lindos 38')).toBe(false)
    expect(plain.fields.price).toBeUndefined()
  })
})

describe('capa multimedia sobre los lotes (WAHA): la descripción por voz o texto se asocia al producto correcto', () => {
  beforeEach(() => {
    h.env.WAHA_PHOTO_BATCH_ENABLED = 'true'
    h.env.GEMINI_API_KEY = 'gemini-de-pruebas'
    h.env.ASSISTANT_MEDIA_STORE_IDS = String(tienda)
    h.db.query('UPDATE stores SET ai_enabled = 1, ai_monthly_budget_micros = 50000000 WHERE id = ?', tienda)
  })
  const two = (photos: number) => ({
    photos: Array.from({ length: photos }, (_, index) => ({ photo: index + 1, group: index < 3 ? 1 : 2, isProduct: true })),
    groups: [
      { group: 1, continuesPrevious: false, name: 'Tenis blancos urbanos', category: 'Calzado', colors: ['Blanco'], visibleBrand: '', description: 'Tenis blancos de suela gruesa.' },
      { group: 2, continuesPrevious: false, name: 'Chanclas de playa', category: 'Calzado', colors: ['Negro'], visibleBrand: '', description: 'Chanclas negras.' },
    ],
  })
  async function sendPhotos(count: number, prefix = 'M'): Promise<void> {
    for (let index = 0; index < count; index++) {
      files[`${prefix}${index}.png`] = await makePng(400 + index, 400)
      await photo(`${prefix}${index}.png`)
    }
  }
  async function voice(text: string, name = `VOZ${++counter}.oga`): Promise<void> {
    transcript = text
    const page = new Uint8Array(64)
    page.set([0x4f, 0x67, 0x67, 0x53])
    let rest = 48_000 * 6
    for (let i = 0; i < 8; i++) { page[6 + i] = rest % 256; rest = Math.floor(rest / 256) }
    files[name] = page
    await post(msg({ lid: ANA_LID, phone: ANA_PHONE }, '', {
      hasMedia: true, media: { url: `http://localhost:3000/api/files/${SESSION}/${name}`, mimetype: 'audio/ogg; codecs=opus', filename: null, error: null },
    }, { audioMessage: { mimetype: 'audio/ogg; codecs=opus', PTT: true, seconds: 6 } }))
  }
  const captions = () => h.db.query<{ caption: string | null }>('SELECT caption FROM whatsapp_photo_items ORDER BY position, id').map((row) => row.caption)
  const catalog = () => JSON.stringify(h.db.query("SELECT p.store_id, p.sku, p.price, (SELECT group_concat(v.size || ':' || v.stock) FROM product_variants v WHERE v.product_id = p.id) AS v FROM products p ORDER BY p.id"))
  const draft = () => { const row = h.db.query<{ params_json: string }>("SELECT params_json FROM telegram_operations WHERE status = 'pending' AND action = 'create_product'")[0]; return row ? JSON.parse(row.params_json) : null }

  it('un producto en el lote + nota de voz: repite monto, tallas y cantidades, y al confirmar el borrador ya los trae', async () => {
    await link()
    const before = catalog()
    await sendPhotos(3)
    await say('listo')
    expect(last()).toContain('1 posible producto')
    sent.length = 0
    await voice('Estos son tenis rojos, del 38 al 42, cinco de cada talla, a ciento ochenta mil')
    const reply = texts().join('\n')
    expect(reply).toContain('Entendí')
    expect(reply).toMatch(/tallas 38 a 42, 5 de cada una \(25 en total\)/)
    expect(reply).toMatch(/180\.000/)
    expect(reply).toContain('las 3 fotos')
    expect(captions().filter(Boolean)).toHaveLength(1)
    expect(catalog()).toBe(before)
    await say('sí')
    expect(draft()).toMatchObject({ fields: { price: 180000 }, batch: { group: 0, total: 1 } })
    expect(draft().variants.map((variant: any) => `${variant.size}:${variant.stock}`).join(',')).toBe('38:5,39:5,40:5,41:5,42:5')
    expect(draft().images).toHaveLength(3)
    expect(catalog()).toBe(before)
  })

  it('nota de voz con dos productos abiertos: pregunta con opciones cortas y anota solo en el elegido', async () => {
    await link()
    grouping = two
    await sendPhotos(5)
    await say('listo')
    expect(last()).toContain('2 posibles productos')
    sent.length = 0
    await voice('son del 38 al 40, dos de cada talla, a 150 mil')
    expect(last()).toMatch(/¿A cuál producto del lote te refieres\?\n1\) Tenis blancos urbanos\n2\) Chanclas de playa/)
    expect(captions().filter(Boolean)).toHaveLength(0)
    await say('el 2')
    expect(last()).toContain('Chanclas de playa')
    expect(last()).toMatch(/150\.000/)
    // Only the first photo of the second product carries the description.
    expect(captions().map(Boolean)).toEqual([false, false, false, true, false])
  })

  it('si la descripción nombra el producto, va a ese sin preguntar', async () => {
    await link()
    grouping = two
    await sendPhotos(5)
    await say('listo')
    sent.length = 0
    await say('las chanclas del 36 al 38, dos de cada talla, a 40 mil')
    expect(last()).toContain('producto 2')
    expect(last()).not.toContain('¿A cuál')
    expect(captions().map(Boolean)).toEqual([false, false, false, true, false])
  })

  it('la descripción llega mientras las fotos se organizan: se guarda y se aplica con el resumen', async () => {
    await link()
    await sendPhotos(3)
    expect(sent).toHaveLength(0)
    await say('son tenis rojos, del 38 al 40, dos de cada talla, a 150 mil')
    await say('listo')
    await say('sí')
    expect(draft()).toMatchObject({ fields: { price: 150000 } })
    expect(draft().variants.map((variant: any) => `${variant.size}:${variant.stock}`).join(',')).toBe('38:2,39:2,40:2')
    expect(texts().join('\n')).not.toMatch(/¿Qué precio deseas colocar\?/)
  })

  it('el lote es de una tienda y de un chat: otro comerciante no puede describir ni escribir el lote ajeno', async () => {
    await link()
    await sendPhotos(3)
    await say('listo')
    const intruso = await createStoreUser(h.db, { email: 'intruso@pruebas.test', storeId: otra, role: 'owner', telegramUserId: '7009' })
    h.env.ASSISTANT_MEDIA_STORE_IDS = '*'
    await say(`VINCULAR ${await linkCode(intruso, 'intruso@pruebas.test', 'otra-wa')}`, INTRUSO_PHONE)
    sent.length = 0
    await say('son tenis rojos, del 38 al 40, dos de cada talla, a 1 mil', INTRUSO_PHONE)
    expect(captions().filter(Boolean)).toHaveLength(0)
    expect(texts().join('\n')).not.toMatch(/Tenis blancos urbanos|las 3 fotos/)
  })

  it('con el interruptor multimedia apagado el lote se comporta como antes (la descripción no se anota)', async () => {
    h.env.ASSISTANT_MEDIA_STORE_IDS = ''
    await link()
    await sendPhotos(3)
    await say('listo')
    sent.length = 0
    await voice('Estos son tenis rojos, del 38 al 42, cinco de cada talla, a ciento ochenta mil')
    expect(captions().filter(Boolean)).toHaveLength(0)
    expect(texts().join('\n')).not.toContain('Listo, entendí')
  })
})

async function makePng(width: number, height: number): Promise<Uint8Array> {
  const raw = new Uint8Array(height * (width * 4 + 1))
  const compressed = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer())
  const chunk = (name: string, body: Uint8Array) => { const type = new TextEncoder().encode(name); return concat(u32(body.length), type, body, u32(crc32(concat(type, body)))) }
  return concat(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', concat(u32(width), u32(height), new Uint8Array([8, 6, 0, 0, 0]))), chunk('IDAT', compressed), chunk('IEND', new Uint8Array()))
}
function u32(value: number): Uint8Array { return new Uint8Array([value >>> 24, value >>> 16, value >>> 8, value]) }
function concat(...items: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(items.reduce((total, item) => total + item.length, 0))
  let offset = 0
  for (const item of items) { result.set(item, offset); offset += item.length }
  return result
}
function crc32(bytes: Uint8Array): number {
  let crc = ~0
  for (const byte of bytes) { crc ^= byte; for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)) }
  return ~crc >>> 0
}
