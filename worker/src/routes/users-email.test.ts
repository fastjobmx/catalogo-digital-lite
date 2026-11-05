import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHarness, createStoreUser, seedStore, superadminToken, userToken, type Harness } from '../testing/harness'

let h: Harness
let storeA: number
let storeB: number
let admin: string
let ownerA: string
let ownerAId: number
let ownerB: string
let memberId: number
let sent: Array<{ to: string; subject: string; html: string; text: string; idempotencyKey: string | null }>
let providerFails = false

const json = async (response: Response) => response.json() as Promise<any>
const linkIn = (text: string, path: string) => text.match(new RegExp(`https://[^\\s"<]+${path}\\?token=[^\\s"<&]+`))?.[0] ?? null
const tokenOf = (link: string) => decodeURIComponent(new URL(link).searchParams.get('token') || '')
const forgot = (email: string, ip = '203.0.113.10') => h.request('/api/auth/password-reset/request', { method: 'POST', body: { email }, headers: { 'CF-Connecting-IP': ip } })
const verifyDirectly = (userId: number) => h.db.sqlite.exec(`UPDATE platform_users SET email_verified_at = datetime('now') WHERE id = ${userId}`)

beforeEach(async () => {
  h = createHarness({ EMAIL_PROVIDER: 'resend', EMAIL_FROM: 'MOSTRALO PUES! <no-responder@mostralopues.test>', RESEND_API_KEY: 'test-key', EMAIL_TEST_RECIPIENTS: 'pruebas@mostralopues.test' })
  admin = await superadminToken()
  storeA = await seedStore(h.db, { slug: 'tienda-a', name: 'Tienda A' })
  storeB = await seedStore(h.db, { slug: 'tienda-b', name: 'Tienda B' })
  ownerAId = await createStoreUser(h.db, { email: 'duena@tienda-a.co', password: 'ClaveSegura123', storeId: storeA, role: 'owner' })
  ownerA = await userToken(ownerAId, 'duena@tienda-a.co')
  ownerB = await userToken(await createStoreUser(h.db, { email: 'dueno@tienda-b.co', password: 'ClaveSegura123', storeId: storeB, role: 'owner' }), 'dueno@tienda-b.co')
  memberId = await createStoreUser(h.db, { email: 'vendedor@tienda-a.co', password: 'ClaveVieja123', storeId: storeA, role: 'admin' })
  sent = []
  providerFails = false
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).startsWith('https://api.resend.com/')) {
      if (providerFails) return new Response('{"message":"down"}', { status: 503 })
      const body = JSON.parse(String(init?.body))
      sent.push({ to: body.to[0], subject: body.subject, html: body.html, text: body.text, idempotencyKey: new Headers(init?.headers).get('Idempotency-Key') })
      return new Response(JSON.stringify({ id: `msg_${sent.length}` }))
    }
    return new Response('{}', { status: 404 })
  }))
})
afterEach(() => vi.unstubAllGlobals())

describe('password recovery by email', () => {
  it('answers the same for unknown, unverified and verified accounts, and emails only verified addresses', async () => {
    const unknown = await json(await forgot('nadie@tienda-a.co'))
    const unverified = await json(await forgot('vendedor@tienda-a.co', '203.0.113.11'))
    expect(unknown).toEqual(unverified)
    expect(sent).toHaveLength(0)
    verifyDirectly(memberId)
    const verified = await json(await forgot('vendedor@tienda-a.co', '203.0.113.12'))
    expect(verified).toEqual(unknown)
    expect(sent).toHaveLength(1)
    expect(sent[0]!.to).toBe('vendedor@tienda-a.co')
    expect(sent[0]!.subject).toContain('MOSTRALO PUES!')
    expect(sent[0]!.html).toContain('Crear nueva contraseña')
    expect(sent[0]!.html).toContain('60 minutos')
    expect(sent[0]!.html).not.toMatch(/ClaveVieja/)
    expect(linkIn(sent[0]!.text, '/restablecer')).toMatch(/^https:\/\/tiendas\.test\/t\/tienda-a\/admin\/restablecer\?token=/)
  })

  it('changes the password once, rejects reuse and expiry, and ends older sessions', async () => {
    verifyDirectly(memberId)
    const oldSession = await userToken(memberId, 'vendedor@tienda-a.co')
    expect((await h.request('/api/admin/session', { token: oldSession, store: 'tienda-a' })).status).toBe(200)
    await forgot('vendedor@tienda-a.co')
    const token = tokenOf(linkIn(sent[0]!.text, '/restablecer')!)
    const done = await h.request('/api/auth/password-reset', { method: 'POST', body: { token, password: 'ClaveNueva2026' } })
    expect(done.status).toBe(200)
    const fresh = (await json(done)).token
    expect((await h.request('/api/auth/password-reset', { method: 'POST', body: { token, password: 'OtraClave2026x' } })).status).toBe(404)
    expect((await h.request('/api/admin/session', { token: oldSession, store: 'tienda-a' })).status).toBe(401)
    expect((await h.request('/api/admin/session', { token: fresh, store: 'tienda-a' })).status).toBe(200)
    const login = await h.request('/api/admin/login', { method: 'POST', body: { email: 'vendedor@tienda-a.co', password: 'ClaveNueva2026' } })
    expect(login.status).toBe(200)

    await forgot('vendedor@tienda-a.co', '203.0.113.20')
    const expiring = tokenOf(linkIn(sent[1]!.text, '/restablecer')!)
    h.db.sqlite.exec(`UPDATE user_access_tokens SET expires_at = unixepoch() - 1 WHERE purpose = 'password_reset' AND used_at IS NULL`)
    expect((await h.request('/api/auth/password-reset', { method: 'POST', body: { token: expiring, password: 'ClaveNueva2027' } })).status).toBe(404)
  })

  it('records provider failures, never stores links or tokens, and keeps the generic answer', async () => {
    verifyDirectly(memberId)
    providerFails = true
    expect((await forgot('vendedor@tienda-a.co')).status).toBe(200)
    expect(h.db.query<any>("SELECT status, error_code FROM email_messages")).toEqual([{ status: 'fallido', error_code: 'HTTP_503' }])
    expect(h.db.query("SELECT COUNT(*) AS n FROM user_access_tokens WHERE purpose = 'password_reset' AND used_at IS NULL")).toEqual([{ n: 0 }])
    const stored = JSON.stringify([h.db.query('SELECT * FROM email_messages'), h.db.query('SELECT payload FROM audit_log')])
    expect(stored).not.toMatch(/restablecer\?token=/)
  })

  it('records "not configured" instead of pretending to send', async () => {
    h.env.RESEND_API_KEY = undefined
    verifyDirectly(memberId)
    await forgot('vendedor@tienda-a.co')
    expect(sent).toHaveLength(0)
    expect(h.db.query<any>('SELECT status FROM email_messages')).toEqual([{ status: 'no_configurado' }])
  })
})

describe('users and access (per store)', () => {
  it('lists only this store\'s members without hashes or tokens', async () => {
    const list = await json(await h.request('/api/admin/users', { token: ownerA, store: 'tienda-a' }))
    expect(list.items.map((item: any) => item.email).sort()).toEqual(['duena@tienda-a.co', 'vendedor@tienda-a.co'])
    expect(list.items[0]).toMatchObject({ role: 'owner', status: 'activo', emailVerified: false })
    expect(JSON.stringify(list)).not.toMatch(/pbkdf2|password_hash|token/i)
    expect((await h.request('/api/admin/users', { token: ownerB, store: 'tienda-a' })).status).toBe(403)
  })

  it('sends the same reset from the panel and only reports the channel and time', async () => {
    verifyDirectly(memberId)
    const response = await h.request(`/api/admin/users/${memberId}/password-reset`, { method: 'POST', token: ownerA, store: 'tienda-a' })
    expect(response.status).toBe(200)
    const body = await json(response)
    expect(body).toMatchObject({ delivery: 'email' })
    expect(JSON.stringify(body)).not.toMatch(/token|restablecer|http/)
    expect(sent).toHaveLength(1)
    expect((await h.request(`/api/admin/users/${memberId}/password-reset`, { method: 'POST', token: ownerA, store: 'tienda-a' })).status).toBe(429)
    const list = await json(await h.request('/api/admin/users', { token: ownerA, store: 'tienda-a' }))
    expect(list.items.find((item: any) => item.id === memberId).lastPasswordReset).toMatchObject({ channel: 'email' })
    expect(h.db.query<any>("SELECT payload FROM audit_log WHERE action = 'password_reset_issued'")[0].payload).toBe('{"channel":"email"}')
  })

  it('never lets another store or a lower role manage members', async () => {
    expect((await h.request(`/api/admin/users/${memberId}/password-reset`, { method: 'POST', token: ownerB, store: 'tienda-b' })).status).toBe(404)
    expect((await h.request(`/api/admin/users/${memberId}/password-reset`, { method: 'POST', token: ownerB, store: 'tienda-a' })).status).toBe(403)
    const member = await userToken(memberId, 'vendedor@tienda-a.co')
    expect((await h.request(`/api/admin/users/${ownerAId}/password-reset`, { method: 'POST', token: member, store: 'tienda-a' })).status).toBe(403)
    expect((await h.request(`/api/admin/users/${ownerAId}/access`, { method: 'POST', token: member, store: 'tienda-a', body: { active: false } })).status).toBe(403)
  })

  it('deactivates and reactivates access to this store only, never the owner or oneself', async () => {
    h.db.sqlite.exec(`INSERT INTO store_memberships (store_id, user_id, role, status, created_by) VALUES (${storeB}, ${memberId}, 'operator', 'active', 'test')`)
    expect((await h.request(`/api/admin/users/${memberId}/access`, { method: 'POST', token: ownerA, store: 'tienda-a', body: { active: false } })).status).toBe(200)
    const member = await userToken(memberId, 'vendedor@tienda-a.co')
    expect((await h.request('/api/admin/session', { token: member, store: 'tienda-a' })).status).toBe(403)
    expect((await h.request('/api/admin/session', { token: member, store: 'tienda-b' })).status).toBe(200)
    expect((await h.request(`/api/admin/users/${ownerAId}/access`, { method: 'POST', token: admin, store: 'tienda-a', body: { active: false } })).status).toBe(409)
    expect((await h.request(`/api/admin/users/${memberId}/access`, { method: 'POST', token: ownerA, store: 'tienda-a', body: { active: true } })).status).toBe(200)
    expect(h.db.query<any>("SELECT action FROM audit_log WHERE action LIKE 'member_access_%' ORDER BY id").map((row) => row.action)).toEqual(['member_access_disabled', 'member_access_enabled'])
  })

  it('invites by email; opening the emailed invitation verifies the address and sends a welcome', async () => {
    const invited = await h.request('/api/admin/team', { method: 'POST', token: ownerA, store: 'tienda-a', body: { email: 'nueva@tienda-a.co', role: 'operator', displayName: 'Nueva' } })
    expect(await json(invited)).toMatchObject({ delivery: 'email', activationUrl: null })
    expect(sent[0]!.subject).toBe('Te invitaron a administrar Tienda A')
    const userId = (h.db.query<any>("SELECT id FROM platform_users WHERE email = 'nueva@tienda-a.co'")[0]).id
    expect((await h.request(`/api/admin/users/${userId}/invitation`, { method: 'POST', token: ownerA, store: 'tienda-a' })).status).toBe(200)
    expect(sent).toHaveLength(2)
    const first = tokenOf(linkIn(sent[0]!.text, '/activar')!)
    expect((await h.request('/api/auth/activate', { method: 'POST', body: { token: first, password: 'ClaveNueva2026' } })).status).toBe(404)
    const latest = tokenOf(linkIn(sent[1]!.text, '/activar')!)
    expect((await h.request('/api/auth/activate', { method: 'POST', body: { token: latest, password: 'ClaveNueva2026' } })).status).toBe(200)
    expect(h.db.query<any>(`SELECT email_verified_at IS NOT NULL AS verified FROM platform_users WHERE id = ${userId}`)).toEqual([{ verified: 1 }])
    expect(sent[2]!.subject).toBe('Tu cuenta de Tienda A ya está activa')
    expect((await h.request(`/api/admin/users/${userId}/invitation`, { method: 'POST', token: ownerA, store: 'tienda-a' })).status).toBe(409)
  })

  it('without email configured, the invitation keeps the previous private-link behaviour', async () => {
    h.env.RESEND_API_KEY = undefined
    const invited = await json(await h.request('/api/admin/team', { method: 'POST', token: ownerA, store: 'tienda-a', body: { email: 'otra@tienda-a.co', role: 'operator' } }))
    expect(invited.delivery).toBe('manual')
    expect(invited.activationUrl).toMatch(/\/activar\?token=/)
  })

  it('verifies an email with a single-use link that grants no access', async () => {
    const asked = await h.request(`/api/admin/users/${memberId}/verify-email`, { method: 'POST', token: ownerA, store: 'tienda-a' })
    expect(await json(asked)).toMatchObject({ status: 'enviado' })
    const token = tokenOf(linkIn(sent[0]!.text, '/verificar-correo')!)
    const confirmed = await json(await h.request('/api/auth/verify-email', { method: 'POST', body: { token } }))
    expect(confirmed).toEqual({ verified: true })
    expect(confirmed).not.toHaveProperty('token')
    expect((await h.request('/api/auth/verify-email', { method: 'POST', body: { token } })).status).toBe(404)
    expect(h.db.query<any>(`SELECT email_verified_at IS NOT NULL AS v FROM platform_users WHERE id = ${memberId}`)).toEqual([{ v: 1 }])
    expect((await h.request(`/api/admin/users/${memberId}/verify-email`, { method: 'POST', token: ownerA, store: 'tienda-a' })).status).toBe(409)
  })
})

describe('email templates (superadmin)', () => {
  const create = (body: Record<string, unknown>, token = admin) => h.request('/api/platform/email/templates', { method: 'POST', token, body })

  it('starts with the five system templates and lists the variables each one can use', async () => {
    const list = await json(await h.request('/api/platform/email/templates', { token: admin }))
    expect(list.items.map((item: any) => item.systemKey)).toEqual(['password_reset', 'invitation', 'welcome', 'admin_notice', 'email_verification'])
    const reset = list.items[0]
    expect(reset.variables.map((v: any) => v.key)).toContain('enlace_recuperacion')
    expect(list.items[3].variables.map((v: any) => v.key)).not.toContain('enlace_recuperacion')
    expect((await h.request('/api/platform/email/templates', { token: ownerA })).status).toBe(403)
  })

  it('creates, sanitizes, edits, duplicates and toggles templates, and audits it', async () => {
    const resetId = (await json(await h.request('/api/platform/email/templates', { token: admin }))).items[0].id
    const created = await json(await create({ name: 'Aviso de pago', subject: 'Hola {{nombre_usuario}}', html: '<p onclick="x()">Hola {{nombre_usuario}}</p><script>alert(1)</script><a href="javascript:alert(1)">x</a><a href="https://ejemplo.com">ok</a>', text: 'Hola {{nombre_usuario}}' }))
    expect(created.html).not.toMatch(/script|onclick|javascript:/i)
    expect(created.html).toContain('href="https://ejemplo.com"')
    expect((await create({ name: 'X', subject: 'X', html: '{{clave_secreta}}', text: 'x' })).status).toBe(400)
    expect((await create({ name: 'X', subject: 'X', html: '<a href="{{enlace_recuperacion}}">x</a>', text: 'x' })).status).toBe(400)
    const updated = await json(await h.request(`/api/platform/email/templates/${created.id}`, { method: 'PUT', token: admin, body: { ...created, subject: 'Pago recibido' } }))
    expect(updated.subject).toBe('Pago recibido')
    const copy = await json(await h.request(`/api/platform/email/templates/${resetId}/duplicate`, { method: 'POST', token: admin }))
    expect(copy).toMatchObject({ name: 'Recuperación de contraseña (copia)', system: false })
    expect(copy.html).not.toContain('enlace_recuperacion')
    expect((await h.request(`/api/platform/email/templates/${created.id}/status`, { method: 'POST', token: admin, body: { active: false } })).status).toBe(200)
    expect((await h.request(`/api/platform/email/templates/${resetId}/status`, { method: 'POST', token: admin, body: { active: false } })).status).toBe(400)
    const system = await json(await h.request('/api/platform/email/templates', { token: admin }))
    const reset = system.items[0]
    expect((await h.request(`/api/platform/email/templates/${reset.id}`, { method: 'PUT', token: admin, body: { ...reset, html: '<p>sin enlace</p>' } })).status).toBe(400)
    expect(h.db.query<any>("SELECT action FROM audit_log WHERE entity_type = 'email_template' ORDER BY id").map((row) => row.action))
      .toEqual(['email_template_created', 'email_template_updated', 'email_template_created', 'email_template_disabled'])
  })

  it('previews with sample data and sends tests only to authorised addresses, once per key', async () => {
    const preview = await json(await h.request('/api/platform/email/templates/1/preview', { method: 'POST', token: admin, body: {} }))
    expect(preview.html).toContain('Laura Gómez')
    expect(preview.html).toContain('https://ejemplo.invalid/enlace-de-muestra-sin-validez')
    const draft = await json(await h.request('/api/platform/email/templates/1/preview', { method: 'POST', token: admin, body: { draft: { name: 'x', subject: 'Nuevo asunto {{nombre_comercio}}', html: '<p>{{enlace_recuperacion}}</p>', text: '{{enlace_recuperacion}}' } } }))
    expect(draft.subject).toBe('Nuevo asunto Luz Mágica')
    const test = (to: string, key = 'prueba-0001') => h.request('/api/platform/email/templates/1/test', { method: 'POST', token: admin, headers: { 'Idempotency-Key': key }, body: { to } })
    expect((await test('cliente@desconocido.com')).status).toBe(400)
    expect(await json(await test('pruebas@mostralopues.test'))).toMatchObject({ status: 'enviado', replayed: false })
    expect(await json(await test('pruebas@mostralopues.test'))).toMatchObject({ replayed: true })
    expect(sent).toHaveLength(1)
    expect(sent[0]!.html).toContain('ejemplo.invalid')
    const history = await json(await h.request('/api/platform/email/messages', { token: admin }))
    expect(history.items[0]).toMatchObject({ purpose: 'test', status: 'enviado', toEmail: 'pruebas@mostralopues.test' })
    expect(await json(await h.request('/api/platform/email/status', { token: admin }))).toMatchObject({ configured: true, provider: 'resend' })
  })
})

describe('owner regularization', () => {
  it('lists stores without a verified owner and requires a recorded identity check', async () => {
    const list = await json(await h.request('/api/platform/owners/unverified', { token: admin }))
    expect(list.items.map((item: any) => item.slug)).toEqual(expect.arrayContaining(['tienda-a', 'tienda-b']))
    const regularize = (body: Record<string, unknown>) => h.request('/api/platform/stores/tienda-a/owner-regularization', { method: 'POST', token: admin, body })
    expect((await regularize({ email: 'propietaria@tienda-a.co' })).status).toBe(400)
    expect((await regularize({ email: 'propietaria@tienda-a.co', identityMethod: 'videollamada', evidence: 'Videollamada 5/11 con cédula' })).status).toBe(400)
    const done = await json(await regularize({ email: 'propietaria@tienda-a.co', name: 'Propietaria', identityMethod: 'videollamada', evidence: 'Videollamada 5/11 con cédula y RUT', confirm: true }))
    expect(done.invitation).toMatchObject({ delivery: 'email', activationUrl: null })
    expect(sent[0]!.to).toBe('propietaria@tienda-a.co')
    const audit = h.db.query<any>("SELECT payload FROM audit_log WHERE action = 'owner_regularization'")[0]
    expect(JSON.parse(audit.payload)).toMatchObject({ identityMethod: 'videollamada' })
    expect((await h.request('/api/platform/stores/tienda-a/owner-regularization', { method: 'POST', token: ownerA, body: {} })).status).toBe(403)
  })
})

describe('master bot reset', () => {
  it('never returns the link', async () => {
    const { adminPasswordReset } = await import('../services/passwordReset')
    verifyDirectly(memberId)
    const result = await adminPasswordReset(h.db, h.env, 'vendedor@tienda-a.co', 'superadmin')
    expect(result).toEqual({ email: 'vendedor@tienda-a.co', delivery: 'email' })
  })
})
