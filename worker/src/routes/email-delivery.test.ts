/** Email engine: transient retries, suppression list, paused categories, signed provider webhooks,
 * retention, DNS checks and the superadmin overview. */
import { beforeEach, describe, expect, it } from 'vitest'
import worker from '../index'
import { createHarness, superadminToken, type Harness } from '../testing/harness'
import { purgeEmailLogs, sendEmail } from '../email/send'
import { checkSenderDns, pollDeliveryStatus, senderDomain, verifySvixSignature } from '../email/webhooks'

const SECRET_BYTES = 'c2VjcmV0by1kZS1wcnVlYmEtcGFyYS13ZWJob29rcw=='
const SECRET = `whsec_${SECRET_BYTES}`
const noSleep = async () => {}

let h: Harness
let calls: Array<{ key: string | null; body: any }>
let answers: number[]

const fetcher = (async (_url: string, init?: RequestInit) => {
  calls.push({ key: new Headers(init?.headers).get('Idempotency-Key'), body: JSON.parse(String(init?.body)) })
  const status = answers.shift() ?? 200
  return status === 200 ? new Response(JSON.stringify({ id: `re_${calls.length}` })) : new Response('{}', { status })
}) as unknown as typeof fetch

beforeEach(() => {
  h = createHarness({ EMAIL_PROVIDER: 'resend', EMAIL_FROM: 'Tienda IA Express <no-responder@tiendas.test>', RESEND_API_KEY: 'test-key', EMAIL_REPLY_TO: 'soporte@tiendas.test', RESEND_WEBHOOK_SECRET: SECRET })
  calls = []
  answers = []
})

const welcome = (to: string, key: string) => ({ template: { key: 'welcome' as const }, to, purpose: 'welcome', requestedBy: 'test', idempotencyKey: key, values: { nombre_usuario: 'Ana', correo_usuario: to, nombre_comercio: 'Tienda', enlace_panel: 'https://tiendas.test/admin/login' } })
const json = async (response: Response) => response.json() as Promise<any>

async function sign(id: string, timestamp: number, body: string) {
  const key = await crypto.subtle.importKey('raw', Uint8Array.from(atob(SECRET_BYTES), (c) => c.charCodeAt(0)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${body}`)))
  return `v1,${btoa(String.fromCharCode(...mac))}`
}

async function webhook(id: string, event: unknown, options: { badSignature?: boolean } = {}) {
  const body = JSON.stringify(event)
  const timestamp = Math.floor(Date.now() / 1000)
  const signature = options.badSignature ? 'v1,AAAA' : await sign(id, timestamp, body)
  return worker.fetch(new Request('https://api.test/api/email/webhooks/resend', { method: 'POST', body, headers: { 'Content-Type': 'application/json', 'svix-id': id, 'svix-timestamp': String(timestamp), 'svix-signature': signature } }), h.env, { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext)
}

describe('delivery engine', () => {
  it('retries transient provider errors with the same idempotency key and records the attempts', async () => {
    answers = [503, 429, 200]
    const result = await sendEmail(h.db, h.env, welcome('ana@correo.test', 'welcome:1'), fetcher, noSleep)
    expect(result.status).toBe('enviado')
    expect(calls).toHaveLength(3)
    expect(new Set(calls.map((call) => call.key))).toEqual(new Set(['welcome:1']))
    expect(calls[0]!.body).toMatchObject({ reply_to: 'soporte@tiendas.test', tags: [{ name: 'proposito', value: 'welcome' }] })
    expect(h.db.query<any>('SELECT status, attempts, provider_message_id FROM email_messages')).toEqual([{ status: 'enviado', attempts: 3, provider_message_id: 're_3' }])
  })

  it('does not retry permanent errors and never sends the same message twice', async () => {
    answers = [422]
    expect((await sendEmail(h.db, h.env, welcome('ana@correo.test', 'welcome:2'), fetcher, noSleep)).status).toBe('fallido')
    expect(calls).toHaveLength(1)
    const again = await sendEmail(h.db, h.env, welcome('ana@correo.test', 'welcome:2'), fetcher, noSleep)
    expect(again.replayed).toBe(true)
    expect(calls).toHaveLength(1)
  })

  it('never contacts a suppressed address', async () => {
    h.db.query("INSERT INTO email_suppressions (email, reason, source, created_by) VALUES ('rebota@correo.test', 'rebote', 'resend', 'test')")
    expect((await sendEmail(h.db, h.env, welcome('REBOTA@correo.test', 'welcome:3'), fetcher, noSleep)).status).toBe('fallido')
    expect(calls).toHaveLength(0)
    expect(h.db.query<any>('SELECT error_code FROM email_messages')).toEqual([{ error_code: 'SUPPRESSED' }])
  })

  it('pauses non-essential categories but never security emails', async () => {
    const token = await superadminToken()
    const paused = await h.request('/api/platform/email/categories/bienvenida', { method: 'POST', token, body: { enabled: false } })
    expect(paused.status).toBe(200)
    expect((await json(paused)).items.find((item: any) => item.key === 'bienvenida').enabled).toBe(false)
    expect((await sendEmail(h.db, h.env, welcome('ana@correo.test', 'welcome:4'), fetcher, noSleep)).status).toBe('omitido')
    expect(calls).toHaveLength(0)
    expect(h.db.query('SELECT COUNT(*) AS n FROM email_messages')).toEqual([{ n: 0 }])
    expect((await h.request('/api/platform/email/categories/seguridad', { method: 'POST', token, body: { enabled: false } })).status).toBe(400)
    expect((await h.request('/api/platform/email/categories/bienvenida', { method: 'POST', body: { enabled: true } })).status).toBe(401)
  })
})

describe('provider webhooks', () => {
  it('rejects unsigned, badly signed or stale calls, and answers 503 without a secret', async () => {
    expect(await verifySvixSignature(SECRET, { id: 'msg_1', timestamp: '1', signature: await sign('msg_1', 1, '{}') }, '{}')).toBe(false)
    expect((await webhook('evt_1', { type: 'email.delivered' }, { badSignature: true })).status).toBe(401)
    h.env.RESEND_WEBHOOK_SECRET = undefined
    expect((await webhook('evt_2', { type: 'email.delivered' })).status).toBe(503)
  })

  it('records delivery, suppresses permanent bounces, ignores duplicates and never hides a bounce', async () => {
    await sendEmail(h.db, h.env, welcome('ana@correo.test', 'welcome:5'), fetcher, noSleep)
    expect((await webhook('evt_a', { type: 'email.delivered', data: { email_id: 're_1' } })).status).toBe(200)
    expect(h.db.query<any>('SELECT delivery_status FROM email_messages')).toEqual([{ delivery_status: 'entregado' }])
    await webhook('evt_b', { type: 'email.bounced', data: { email_id: 're_1', bounce: { type: 'Permanent' } } })
    expect(h.db.query<any>('SELECT email, reason FROM email_suppressions')).toEqual([{ email: 'ana@correo.test', reason: 'rebote' }])
    await webhook('evt_c', { type: 'email.delivery_delayed', data: { email_id: 're_1' } })
    expect(h.db.query<any>('SELECT delivery_status FROM email_messages')).toEqual([{ delivery_status: 'rebotado' }])
    expect(await json(await webhook('evt_c', { type: 'email.delivery_delayed', data: { email_id: 're_1' } }))).toMatchObject({ duplicate: true })
    expect(h.db.query('SELECT COUNT(*) AS n FROM email_events')).toEqual([{ n: 3 }])
    // Stored events carry no content: only identifiers and the type.
    expect(JSON.stringify(h.db.query('SELECT * FROM email_events'))).not.toMatch(/ana@correo/)
  })

  it('a transient bounce does not suppress the address', async () => {
    await sendEmail(h.db, h.env, welcome('ana@correo.test', 'welcome:6'), fetcher, noSleep)
    await webhook('evt_t', { type: 'email.bounced', data: { email_id: 're_1', bounce: { type: 'Transient' } } })
    expect(h.db.query('SELECT COUNT(*) AS n FROM email_suppressions')).toEqual([{ n: 0 }])
  })
})

describe('supervision and retention', () => {
  it('shows counters, failure alerts for access emails and lets the superadmin lift a suppression', async () => {
    answers = [422]
    await sendEmail(h.db, h.env, { ...welcome('ana@correo.test', 'reset:1'), template: { key: 'password_reset' }, purpose: 'password_reset', values: { enlace_recuperacion: 'https://tiendas.test/x' } }, fetcher, noSleep)
    h.db.query("INSERT INTO email_suppressions (email, reason, source, created_by) VALUES ('queja@correo.test', 'queja', 'resend', 'test')")
    const token = await superadminToken()
    const overview = await json(await h.request('/api/platform/email/overview', { token }))
    expect(overview.totals).toMatchObject({ total: 1, failed: 1, accepted: 0 })
    expect(overview.suppressed).toBe(1)
    expect(overview.alerts).toEqual([expect.objectContaining({ purpose: 'password_reset', count: 1 })])
    const status = await json(await h.request('/api/platform/email/status', { token }))
    expect(status).toMatchObject({ replyTo: 'soporte@tiendas.test', webhookConfigured: true })
    expect(JSON.stringify(status)).not.toContain('test-key')
    expect((await h.request('/api/platform/email/suppressions/remove', { method: 'POST', token, body: { email: 'queja@correo.test' } })).status).toBe(200)
    expect((await h.request('/api/platform/email/suppressions/remove', { method: 'POST', token, body: { email: 'queja@correo.test' } })).status).toBe(404)
  })

  it('deletes history older than the retention window', async () => {
    await sendEmail(h.db, h.env, welcome('ana@correo.test', 'welcome:old'), fetcher, noSleep)
    await sendEmail(h.db, h.env, welcome('ana@correo.test', 'welcome:new'), fetcher, noSleep)
    h.db.query("UPDATE email_messages SET created_at = datetime('now', '-200 days') WHERE idempotency_key = 'welcome:old'")
    expect(await purgeEmailLogs(h.db, h.env)).toMatchObject({ messages: 1 })
    expect(h.db.query<any>('SELECT idempotency_key FROM email_messages')).toEqual([{ idempotency_key: 'welcome:new' }])
  })
})

describe('sender DNS check', () => {
  it('reads SPF, DKIM, DMARC and MX of the sender domain and flags duplicated SPF', async () => {
    expect(senderDomain('Tienda IA Express <no-responder@envios.tiendiaexpres.com>')).toBe('envios.tiendiaexpres.com')
    const records: Record<string, Array<{ type: number; data: string }>> = {
      'resend._domainkey.tiendas.test|TXT': [{ type: 16, data: '"p=MIGfMA0"' }],
      'send.tiendas.test|TXT': [{ type: 16, data: '"v=spf1 include:amazonses.com ~all"' }],
      'send.tiendas.test|MX': [{ type: 15, data: '10 feedback-smtp.us-east-1.amazonses.com.' }],
      '_dmarc.tiendas.test|TXT': [{ type: 16, data: '"v=DMARC1; p=none; rua=mailto:dmarc@tiendas.test"' }],
      'tiendas.test|TXT': [{ type: 16, data: '"v=spf1 -all"' }, { type: 16, data: '"v=spf1 include:otro ~all"' }],
    }
    const dns = (async (url: string) => {
      const query = new URL(url).searchParams
      return new Response(JSON.stringify({ Answer: records[`${query.get('name')}|${query.get('type')}`] || [] }))
    }) as unknown as typeof fetch
    const { domain, checks } = await checkSenderDns(h.env, dns)
    expect(domain).toBe('tiendas.test')
    const by = Object.fromEntries(checks.map((check) => [check.name, check.status]))
    expect(by).toMatchObject({ DKIM: 'ok', SPF: 'ok', 'MX de rebotes': 'ok', DMARC: 'revisar', 'SPF de tiendas.test': 'revisar' })
    const missing = await checkSenderDns({ EMAIL_FROM: 'x <a@vacio.test>' }, (async () => new Response('{}')) as unknown as typeof fetch)
    expect(missing.checks.every((check) => check.status === 'falta')).toBe(true)
  })
})

describe('delivery follow-up without webhook', () => {
  it('asks the provider for the last event once, records delivery and ignores repeats', async () => {
    await sendEmail(h.db, h.env, welcome('ana@correo.test', 'welcome:poll'), fetcher, noSleep)
    const asked: string[] = []
    const provider = (async (url: string, init?: RequestInit) => {
      asked.push(`${init?.method || 'GET'} ${url}`)
      return new Response(JSON.stringify({ id: 're_1', last_event: 'delivered' }))
    }) as unknown as typeof fetch
    expect(await pollDeliveryStatus(h.db, h.env, provider)).toEqual({ checked: 1, updated: 1 })
    expect(asked).toEqual(['GET https://api.resend.com/emails/re_1'])
    expect(h.db.query<any>('SELECT delivery_status FROM email_messages')).toEqual([{ delivery_status: 'entregado' }])
    // Delivered messages are not asked again.
    expect(await pollDeliveryStatus(h.db, h.env, provider)).toEqual({ checked: 0, updated: 0 })
    expect(await pollDeliveryStatus(h.db, { ...h.env, EMAIL_PROVIDER: undefined }, provider)).toEqual({ checked: 0, updated: 0 })
  })

  it('keeps waiting while the provider only reports "sent"', async () => {
    await sendEmail(h.db, h.env, welcome('ana@correo.test', 'welcome:poll2'), fetcher, noSleep)
    const provider = (async () => new Response(JSON.stringify({ last_event: 'sent' }))) as unknown as typeof fetch
    expect(await pollDeliveryStatus(h.db, h.env, provider)).toEqual({ checked: 1, updated: 0 })
    expect(h.db.query<any>('SELECT delivery_status FROM email_messages')).toEqual([{ delivery_status: null }])
  })
})
