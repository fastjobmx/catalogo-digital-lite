/** Accounts activated with a hand-delivered link get a verification email, so password recovery and notices can
 * reach them; existing unconfirmed accounts get ONE catch-up verification email. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHarness, createStoreUser, seedStore, superadminToken, type Harness } from '../testing/harness'
import { backfillEmailVerification } from '../services/userAccess'

let h: Harness
let sent: Array<{ to: string; subject: string; text: string }>
const json = async (response: Response) => response.json() as Promise<any>
const q = <T = any>(sql: string, ...params: unknown[]) => h.db.query<T>(sql, ...params)
const linkIn = (text: string, path: string) => text.match(new RegExp(`https://[^\\s"<]+/${path}\\?token=[^\\s"<&]+`))?.[0] ?? null
const tokenOf = (link: string) => decodeURIComponent(new URL(link).searchParams.get('token') || '')

beforeEach(() => {
  h = createHarness({ EMAIL_PROVIDER: 'resend', EMAIL_FROM: 'TiendIA Exprés <notificaciones@tiendas.test>', RESEND_API_KEY: 'test-key', EMAIL_REPLY_TO: 'soporte@tiendas.test' })
  sent = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).startsWith('https://api.resend.com/emails')) {
      const body = JSON.parse(String(init?.body))
      sent.push({ to: body.to[0], subject: body.subject, text: body.text })
      return new Response(JSON.stringify({ id: `msg_${sent.length}` }))
    }
    return new Response('{}', { status: 404 })
  }))
})
afterEach(() => vi.unstubAllGlobals())

describe('activation with a hand-delivered link', () => {
  it('sends a verification email; confirming it unlocks password recovery by email', async () => {
    const store = await seedStore(h.db, { slug: 'flores', name: 'Flores' })
    const userId = await createStoreUser(h.db, { email: 'ana@flores.co', storeId: store, role: 'owner', status: 'invited' })
    const access = await json(await h.request('/api/platform/stores/flores/access', { method: 'POST', token: await superadminToken() }))
    const activated = await h.request('/api/auth/activate', { method: 'POST', body: { token: tokenOf(access.activationUrl), password: 'ClaveSegura123' } })
    expect(activated.status).toBe(200)
    // Not verified (the link was delivered by hand) → a verification email, never a link that grants access.
    expect(q('SELECT email_verified_at FROM platform_users WHERE id = ?', userId)).toEqual([{ email_verified_at: null }])
    const verification = sent.find((mail) => mail.to === 'ana@flores.co' && linkIn(mail.text, 'verificar-correo'))
    expect(verification).toBeTruthy()
    // Before confirming, a password reset by email does not go out.
    await h.request('/api/auth/password-reset/request', { method: 'POST', body: { email: 'ana@flores.co' } })
    expect(sent.filter((mail) => linkIn(mail.text, 'restablecer'))).toHaveLength(0)
    const confirm = await h.request('/api/auth/verify-email', { method: 'POST', body: { token: tokenOf(linkIn(verification!.text, 'verificar-correo')!) } })
    expect(confirm.status).toBe(200)
    expect(q('SELECT email_verified_at IS NOT NULL AS v FROM platform_users WHERE id = ?', userId)).toEqual([{ v: 1 }])
    h.db.query('DELETE FROM admin_login_rate_limits')
    await h.request('/api/auth/password-reset/request', { method: 'POST', body: { email: 'ana@flores.co' } })
    expect(sent.filter((mail) => linkIn(mail.text, 'restablecer'))).toHaveLength(1)
  })
})

describe('one-time catch-up of unconfirmed addresses', () => {
  it('is off by default, then sends ONE verification email per activated unconfirmed account', async () => {
    const store = await seedStore(h.db, { slug: 'tienda', name: 'Tienda' })
    const pending = await createStoreUser(h.db, { email: 'sin@verificar.co', password: 'ClaveSegura123', storeId: store, role: 'owner' })
    const verified = await createStoreUser(h.db, { email: 'ya@verificado.co', password: 'ClaveSegura123', storeId: store, role: 'admin' })
    h.db.query("UPDATE platform_users SET email_verified_at = datetime('now') WHERE id = ?", verified)
    await createStoreUser(h.db, { email: 'nunca@activo.co', storeId: store, role: 'operator', status: 'invited' })
    expect(await backfillEmailVerification(h.db, h.env)).toEqual({ sent: 0, skipped: 0 })
    expect(sent).toHaveLength(0)
    h.env.EMAIL_VERIFICATION_BACKFILL = 'true'
    expect(await backfillEmailVerification(h.db, h.env)).toEqual({ sent: 1, skipped: 0 })
    expect(sent.map((mail) => mail.to)).toEqual(['sin@verificar.co'])
    expect(linkIn(sent[0]!.text, 'verificar-correo')).toBeTruthy()
    expect(sent[0]!.text).not.toMatch(/restablecer|activar\?token/)
    // Never twice.
    expect(await backfillEmailVerification(h.db, h.env)).toEqual({ sent: 0, skipped: 0 })
    expect(sent).toHaveLength(1)
    expect(pending).toBeGreaterThan(0)
  })
})
