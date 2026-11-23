import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import worker from '../index'
import { createHarness, createStoreUser, seedStore, type Harness } from '../testing/harness'
import { integritySignature, webhookSignature } from '../services/bold'

const IDENTITY = 'platform_identity_KEY_123456789'
const SECRET = 'platform_secret_KEY_abcdef'
const ORIGIN = 'https://tiendas.test'
const MAIL = { EMAIL_PROVIDER: 'resend', EMAIL_FROM: 'TiendIA Exprés <notificaciones@tiendas.test>', RESEND_API_KEY: 'test-key' }

let h: Harness
let sent: Array<{ to: string; subject: string; text: string }>
const json = async (response: Response) => response.json() as Promise<any>
const q = <T = any>(sql: string, ...params: unknown[]) => h.db.query<T>(sql, ...params)

function setup(extra: Record<string, string> = {}) {
  h = createHarness({ ...MAIL, PLATFORM_BOLD_IDENTITY_KEY: IDENTITY, PLATFORM_BOLD_SECRET_KEY: SECRET, PLATFORM_BOLD_MODE: 'live', ...extra })
  sent = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).startsWith('https://api.resend.com/emails')) {
      const body = JSON.parse(String(init?.body))
      sent.push({ to: body.to[0], subject: body.subject, text: body.text })
      return new Response(JSON.stringify({ id: `msg_${sent.length}` }))
    }
    return new Response(JSON.stringify({ payment_status: 'NO_TRANSACTION_FOUND' }))
  }))
}
afterEach(() => vi.unstubAllGlobals())

const buyer = { businessName: 'Flores de Ana', email: 'ana@flores.co', ownerName: 'Ana Pérez', whatsapp: '+573001112233', acceptTerms: true }
const purchase = (extra: Record<string, unknown> = {}, n = 7) => h.request('/api/signup/purchase', {
  method: 'POST', headers: { Origin: ORIGIN, 'CF-Connecting-IP': `198.51.100.${n}` },
  body: { ...buyer, planCode: 'emprendedor', cycle: 'mensual', returnUrl: `${ORIGIN}/contratar`, ...extra },
})
async function sendWebhook(payload: unknown) {
  const raw = JSON.stringify(payload)
  const tasks: Promise<unknown>[] = []
  const response = await worker.fetch(new Request('https://api.test/api/payments/bold/webhook', { method: 'POST', body: raw, headers: { 'Content-Type': 'application/json', 'x-bold-signature': await webhookSignature(raw, SECRET) } }), h.env, { waitUntil(task: Promise<unknown>) { tasks.push(task) }, passThroughOnException() {}, props: {} } as unknown as ExecutionContext)
  await Promise.all(tasks)
  return response
}
const approve = (reference: string, total: number) => sendWebhook({ id: `evt-${reference}`, type: 'SALE_APPROVED', subject: 'pay-1', data: { payment_id: 'TX-COMPRA-1', payment_method: 'PSE', metadata: { reference }, amount: { total, currency: 'COP' } } })
const storeOf = () => q<{ id: number; slug: string; plan_code: string; status: string; trial: string }>(`SELECT s.id, s.slug, s.plan_code, s.status, t.status AS trial FROM stores s JOIN store_trials t ON t.store_id = s.id JOIN store_memberships m ON m.store_id = s.id JOIN platform_users u ON u.id = m.user_id WHERE u.email = 'ana@flores.co'`)[0]

describe('buying a plan from the landing, without the free trial', () => {
  beforeEach(() => setup())

  it('lists the plans with their first payment and says online payment is available', async () => {
    const body = await json(await h.request('/api/signup/plans'))
    expect(body.onlinePayment).toEqual({ mode: 'live' })
    expect(body.plans.find((plan: any) => plan.code === 'emprendedor')).toMatchObject({ amounts: { mensual: 208900 } })
  })

  it('creates the store and the plan request and opens Bold for the exact amount, with no trial emails', async () => {
    const response = await purchase()
    expect(response.status).toBe(201)
    const button = await json(response)
    expect(button).toMatchObject({ apiKey: IDENTITY, amount: 208900, currency: 'COP', mode: 'live', redirectionUrl: `${ORIGIN}/contratar`, storeName: 'Flores de Ana', email: 'ana@flores.co' })
    expect(button.signature).toBe(await integritySignature(button.reference, 208900, 'COP', SECRET))
    expect(storeOf()).toMatchObject({ plan_code: 'prueba', trial: 'pendiente' })
    expect(q(`SELECT plan_code, billing_cycle, status FROM store_plan_requests`)).toEqual([{ plan_code: 'emprendedor', billing_cycle: 'mensual', status: 'pendiente_pago' }])
    expect(sent).toEqual([])
  })

  it('when Bold approves, the plan is active and the buyer gets the link to create the password and enter', async () => {
    const button = await json(await purchase())
    await approve(button.reference, 208900)
    expect(storeOf()).toMatchObject({ plan_code: 'emprendedor', status: 'active', trial: 'convertida' })
    expect(sent.map((mail) => mail.subject)).toEqual(['Pago confirmado: crea tu contraseña y entra a Flores de Ana'])
    const link = sent[0]!.text.match(/https:\/\/[^\s]+\/admin\/activar\?token=[^\s&]+/)![0]
    const activated = await h.request('/api/auth/activate', { method: 'POST', body: { token: decodeURIComponent(new URL(link).searchParams.get('token')!), password: 'ClaveSegura123' } })
    expect(activated.status).toBe(200)
    // Entering does not start a trial: the store keeps its plan; the welcome email names it.
    expect(storeOf()).toMatchObject({ plan_code: 'emprendedor', trial: 'convertida' })
    expect(sent.at(-1)!.subject).toContain('bienvenida')
    // Back from Bold: the reference and the email of the purchase tell the result.
    const status = await json(await h.request('/api/signup/purchase/status', { method: 'POST', body: { reference: button.reference, email: 'ANA@flores.co' } }))
    expect(status).toMatchObject({ attemptStatus: 'aprobado', planActive: true, planName: 'Emprendedor' })
    expect((await h.request('/api/signup/purchase/status', { method: 'POST', body: { reference: button.reference, email: 'otro@correo.co' } })).status).toBe(404)
  })

  it('an existing account is sent to its panel; an unpaid purchase can still become a normal trial', async () => {
    const store = await seedStore(h.db, { slug: 'ya-existe', name: 'Ya existe' })
    await createStoreUser(h.db, { email: 'dueno@ya.co', password: 'ClaveSegura123', storeId: store, role: 'owner' })
    const existing = await purchase({ email: 'dueno@ya.co' }, 8)
    expect(existing.status).toBe(409)
    expect((await json(existing)).code).toBe('ACCOUNT_EXISTS')

    await purchase()
    const again = await purchase({ cycle: 'anual' })
    expect(again.status).toBe(201)
    expect(q(`SELECT COUNT(*) AS n FROM stores WHERE name = 'Flores de Ana'`)).toEqual([{ n: 1 }])
    expect(q(`SELECT billing_cycle, status FROM store_plan_requests ORDER BY id`)).toEqual([{ billing_cycle: 'mensual', status: 'cancelada' }, { billing_cycle: 'anual', status: 'pendiente_pago' }])
    // Never paid: signing up for the free trial with the same email sends the usual confirmation link.
    await h.request('/api/signup', { method: 'POST', headers: { 'CF-Connecting-IP': '198.51.100.9' }, body: { ...buyer } })
    expect(sent.some((mail) => /Confirma tu correo/.test(mail.subject))).toBe(true)
  })

  it('refuses invalid plans, missing terms and foreign return addresses', async () => {
    expect((await json(await purchase({ planCode: 'premium-falso' }))).code).toBe('INVALID_PLAN')
    expect((await json(await purchase({ acceptTerms: false }))).code).toBe('TERMS_REQUIRED')
    expect((await purchase({ returnUrl: 'https://evil.test/' })).status).toBe(400)
  })
})

describe('without online payment', () => {
  it('nothing is created and the landing is told to use the other ways', async () => {
    setup({ PLATFORM_BOLD_MODE: 'test' })
    expect((await json(await h.request('/api/signup/plans'))).onlinePayment).toBeNull()
    expect((await json(await purchase())).code).toBe('ONLINE_PAYMENT_UNAVAILABLE')
    expect(q(`SELECT COUNT(*) AS n FROM store_trials`)).toEqual([{ n: 0 }])
  })
})
