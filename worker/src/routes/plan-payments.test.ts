import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import worker from '../index'
import { createHarness, type Harness } from '../testing/harness'
import { integritySignature, webhookSignature } from '../services/bold'
import { reconcilePlanPayments } from '../services/planPayments'

const IDENTITY = 'platform_identity_KEY_123456789'
const SECRET = 'platform_secret_KEY_abcdef'
const ORIGIN = 'https://tiendas.test'
const MAIL = { EMAIL_PROVIDER: 'resend', EMAIL_FROM: 'TiendIA Exprés <notificaciones@tiendas.test>', RESEND_API_KEY: 'test-key' }

let h: Harness
let sent: Array<{ to: string; subject: string; text: string }>
let boldAnswer: Record<string, unknown>
const json = async (response: Response) => response.json() as Promise<any>
const q = <T = any>(sql: string, ...params: unknown[]) => h.db.query<T>(sql, ...params)

function setup(extra: Record<string, string> = {}) {
  h = createHarness({ ...MAIL, PLATFORM_BOLD_IDENTITY_KEY: IDENTITY, PLATFORM_BOLD_SECRET_KEY: SECRET, PLATFORM_BOLD_MODE: 'live', ...extra })
  sent = []
  boldAnswer = { payment_status: 'NO_TRANSACTION_FOUND' }
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).startsWith('https://api.resend.com/emails')) {
      const body = JSON.parse(String(init?.body))
      sent.push({ to: body.to[0], subject: body.subject, text: body.text })
      return new Response(JSON.stringify({ id: `msg_${sent.length}` }))
    }
    if (String(url).startsWith('https://payments.api.bold.co/v2/payment-voucher/')) {
      expect(new Headers(init?.headers).get('Authorization')).toBe(`x-api-key ${IDENTITY}`)
      return new Response(JSON.stringify(boldAnswer))
    }
    return new Response('{}', { status: 404 })
  }))
}

async function trialWithRequest() {
  const signup = await h.request('/api/signup', { method: 'POST', body: { acceptTerms: true, businessName: 'Flores de Ana', email: 'ana@flores.co', ownerName: 'Ana Pérez', whatsapp: '+57 300 111 2233' }, headers: { 'CF-Connecting-IP': '198.51.100.7' } })
  expect(signup.status).toBe(202)
  const store = q<{ id: number; slug: string }>(`SELECT s.id, s.slug FROM stores s JOIN store_memberships m ON m.store_id = s.id JOIN platform_users u ON u.id = m.user_id WHERE u.email = 'ana@flores.co'`)[0]!
  const mail = [...sent].reverse().find((item) => /Confirma tu correo/.test(item.subject))!
  const link = mail.text.match(/https:\/\/[^\s"<]+\/admin\/activar\?token=[^\s"<&]+/)![0]
  const activated = await json(await h.request('/api/auth/activate', { method: 'POST', body: { token: decodeURIComponent(new URL(link).searchParams.get('token')!), password: 'ClaveSegura123' } }))
  const token = activated.token as string
  const request = await json(await h.request('/api/admin/trial/plan-request', { method: 'POST', token, store: store.slug, body: { planCode: 'emprendedor', cycle: 'mensual' } }))
  return { store, token, request: request.request as { code: string; amount: number } }
}

const checkout = (token: string, slug: string, returnUrl = `${ORIGIN}/t/flores-de-ana/admin/activar-tienda`) =>
  h.request('/api/admin/trial/plan-payment', { method: 'POST', token, store: slug, headers: { Origin: ORIGIN }, body: { returnUrl } })

async function sendWebhook(payload: unknown, signature?: string) {
  const raw = JSON.stringify(payload)
  const tasks: Promise<unknown>[] = []
  const response = await worker.fetch(new Request('https://api.test/api/payments/bold/webhook', { method: 'POST', body: raw, headers: { 'Content-Type': 'application/json', 'x-bold-signature': signature ?? await webhookSignature(raw, SECRET) } }), h.env, { waitUntil(task: Promise<unknown>) { tasks.push(task) }, passThroughOnException() {}, props: {} } as unknown as ExecutionContext)
  await Promise.all(tasks)
  return response
}
const sale = (reference: string, total: number, id = 'evt-plan-1', type = 'SALE_APPROVED') => ({ id, type, subject: 'pay-9', data: { payment_id: 'TX-PLAN-9', payment_method: 'CARD_WEB', metadata: { reference }, amount: { total, currency: 'COP' } } })
const storeState = (id: number) => q<{ plan_code: string; trial_ends_at: string | null; trial: string; request: string }>(`SELECT s.plan_code, s.trial_ends_at, t.status AS trial, (SELECT status FROM store_plan_requests WHERE store_id = s.id ORDER BY id DESC LIMIT 1) AS request FROM stores s JOIN store_trials t ON t.store_id = s.id WHERE s.id = ?`, id)[0]!

afterEach(() => vi.unstubAllGlobals())

describe('paying the TiendIA plan with Bold (platform account)', () => {
  beforeEach(() => setup())

  it('the panel offers it, signs the exact amount of the open request and nothing else', async () => {
    const { store, token, request } = await trialWithRequest()
    const status = await json(await h.request('/api/admin/trial', { token, store: store.slug }))
    expect(status.onlinePayment).toEqual({ mode: 'live' })
    expect(JSON.stringify(status)).not.toContain(SECRET)
    const button = await json(await checkout(token, store.slug))
    expect(button).toMatchObject({ apiKey: IDENTITY, amount: request.amount, currency: 'COP', mode: 'live', redirectionUrl: `${ORIGIN}/t/flores-de-ana/admin/activar-tienda` })
    expect(button.reference.startsWith(`${request.code}-`)).toBe(true)
    expect(button.signature).toBe(await integritySignature(button.reference, request.amount, 'COP', SECRET))
    expect(JSON.stringify(button)).not.toContain(SECRET)
    // The «Contratación recibida» email points to the online payment.
    expect(sent.find((mail) => /Recibimos tu solicitud/.test(mail.subject))!.text).toContain('Paga en línea desde tu panel')
  })

  it('refuses foreign return addresses, other roles and stores without an open request', async () => {
    const { store, token } = await trialWithRequest()
    expect((await checkout(token, store.slug, 'https://evil.test/robar')).status).toBe(400)
    await h.db.prepare(`UPDATE store_plan_requests SET status = 'cancelada' WHERE store_id = ?`).bind(store.id).run()
    expect((await json(await checkout(token, store.slug))).code).toBe('NO_OPEN_REQUEST')
  })

  it('a signed approval for the exact amount activates the plan on the same store, once', async () => {
    const { store, token, request } = await trialWithRequest()
    const button = await json(await checkout(token, store.slug))
    expect(storeState(store.id)).toMatchObject({ trial: 'activa', request: 'pendiente_pago' })
    expect((await sendWebhook(sale(button.reference, request.amount))).status).toBe(200)
    expect(storeState(store.id)).toMatchObject({ plan_code: 'emprendedor', trial_ends_at: null, trial: 'convertida', request: 'activada' })
    expect(q<{ payment_reference: string; verified_by: string }>(`SELECT payment_reference, verified_by FROM store_plan_requests WHERE store_id = ?`, store.id)[0]).toEqual({ payment_reference: 'Bold TX-PLAN-9', verified_by: 'Bold' })
    expect(sent.filter((mail) => /Pago confirmado/.test(mail.subject))).toHaveLength(1)
    expect(await json(await sendWebhook(sale(button.reference, request.amount)))).toEqual({ result: 'duplicado' })
    // The owner coming back sees the state Bold confirmed.
    const back = await json(await h.request('/api/admin/trial/plan-payment/status', { method: 'POST', token, store: store.slug, body: { reference: button.reference } }))
    expect(back).toMatchObject({ attemptStatus: 'aprobado', outcome: 'plan_activado', planActive: true, planName: 'Emprendedor' })
  })

  it('a forged signature, a different amount or a store secret never activate a plan', async () => {
    const { store, token, request } = await trialWithRequest()
    const button = await json(await checkout(token, store.slug))
    expect((await sendWebhook(sale(button.reference, request.amount), 'f'.repeat(64))).status).toBe(401)
    expect((await sendWebhook(sale(button.reference, request.amount, 'evt-store'), await webhookSignature(JSON.stringify(sale(button.reference, request.amount, 'evt-store')), 'una_llave_de_tienda_123'))).status).toBe(401)
    await sendWebhook(sale(button.reference, 1000, 'evt-low'))
    expect(storeState(store.id)).toMatchObject({ trial: 'activa', request: 'pendiente_pago' })
    expect(q(`SELECT status FROM plan_payment_attempts`)).toEqual([{ status: 'monto_distinto' }])
    expect(q<{ code: string }>(`SELECT code FROM platform_events WHERE source = 'bold-plan'`).map((e) => e.code)).toContain('PLAN_PAYMENT_AMOUNT_MISMATCH')
  })

  it('a second approved payment is flagged as a duplicate to refund', async () => {
    const { store, token, request } = await trialWithRequest()
    const first = await json(await checkout(token, store.slug))
    const second = await json(await checkout(token, store.slug))
    await sendWebhook(sale(first.reference, request.amount, 'evt-a'))
    await sendWebhook(sale(second.reference, request.amount, 'evt-b'))
    expect(q(`SELECT outcome FROM plan_payment_attempts ORDER BY id`)).toEqual([{ outcome: 'plan_activado' }, { outcome: 'duplicado' }])
    expect(q<{ code: string }>(`SELECT code FROM platform_events WHERE source = 'bold-plan'`).map((e) => e.code)).toContain('PLAN_PAYMENT_DUPLICATE')
  })

  it('the cron confirms with Bold when the webhook never arrives', async () => {
    const { store, token, request } = await trialWithRequest()
    await checkout(token, store.slug)
    await h.db.prepare(`UPDATE plan_payment_attempts SET created_at = datetime('now', '-10 minutes')`).run()
    boldAnswer = { payment_status: 'APPROVED', total: request.amount, transaction_id: 'TX-CRON', payment_method: 'PSE' }
    expect(await reconcilePlanPayments(h.env, h.db)).toEqual({ checked: 1, changed: 1 })
    expect(storeState(store.id)).toMatchObject({ plan_code: 'emprendedor', trial: 'convertida' })
  })
})

describe('test keys never give a plan away', () => {
  it('in production with test keys the panel keeps the sales flow and a test approval does not activate', async () => {
    setup({ PLATFORM_BOLD_MODE: 'test' })
    const { store, token, request } = await trialWithRequest()
    expect((await json(await h.request('/api/admin/trial', { token, store: store.slug }))).onlinePayment).toBeNull()
    expect((await json(await checkout(token, store.slug))).code).toBe('ONLINE_PAYMENT_UNAVAILABLE')
    expect(sent.find((mail) => /Recibimos tu solicitud/.test(mail.subject))!.text).toContain('Nuestro equipo de ventas te escribirá')
    // Even an attempt created elsewhere and approved in test mode only leaves a note for the platform.
    await h.db.prepare(`INSERT INTO plan_payment_attempts (request_id, store_id, reference, amount, currency, mode, created_by) SELECT id, store_id, ?, amount, 'COP', 'test', 'x' FROM store_plan_requests WHERE store_id = ?`)
      .bind(`${request.code}-PRUEBA1`, store.id).run()
    await sendWebhook(sale(`${request.code}-PRUEBA1`, request.amount))
    expect(storeState(store.id)).toMatchObject({ trial: 'activa', request: 'pendiente_pago' })
    expect(q(`SELECT outcome FROM plan_payment_attempts`)).toEqual([{ outcome: 'prueba_sin_activar' }])
  })

  it('local/staging can allow test approvals to activate (explicit switch)', async () => {
    setup({ PLATFORM_BOLD_MODE: 'test', PLATFORM_BOLD_TEST_ACTIVATES: 'true' })
    const { store, token, request } = await trialWithRequest()
    const button = await json(await checkout(token, store.slug))
    expect(button.mode).toBe('test')
    await sendWebhook(sale(button.reference, request.amount))
    expect(storeState(store.id)).toMatchObject({ trial: 'convertida', request: 'activada' })
  })

  it('without platform keys nothing changes', async () => {
    h = createHarness({ ...MAIL })
    sent = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).startsWith('https://api.resend.com/emails')) { const body = JSON.parse(String(init?.body)); sent.push({ to: body.to[0], subject: body.subject, text: body.text }); return new Response('{"id":"m"}') }
      return new Response('{}', { status: 404 })
    }))
    const { store, token } = await trialWithRequest()
    expect((await json(await h.request('/api/admin/trial', { token, store: store.slug }))).onlinePayment).toBeNull()
    expect((await json(await checkout(token, store.slug))).code).toBe('ONLINE_PAYMENT_UNAVAILABLE')
  })
})
