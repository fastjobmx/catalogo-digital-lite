/** Real free trial. A trial is an ordinary platform store (same registry, panel, catalogue, orders and
 * audit) with temporary rights kept in store_trials: 7 days, 7 products, no AI. Choosing a plan never
 * creates another store: once the platform verifies the payment, the SAME store gets the plan's rights in
 * one idempotent transaction. Nothing is copied, moved or deleted.
 *
 *   sign-up → store in draft + one-time link by email (confirms the address and sets the password)
 *           → trial starts (store published, 7 days) → notices at 3 days, 1 day and at the end
 *           → plan request (pending invoice) → payment verified by the platform → same store on the plan
 *
 * Links and tokens are never stored or logged in clear; answers to the public never reveal whether an
 * address already has an account. */
import type { Env } from '../index'
import { provisionStore } from './provisioning'
import { createAccessToken, findUserByEmail, markTokenDelivery, normalizeEmail, sha256Hex } from './platformUsers'
import { isSuperadminEmail } from './auth'
import { isEmail, sendEmail } from '../email/send'
import { platformBoldOffered } from './planPayments'
import { adminStoreUrl, getStoreBySlug, isTrialExpired, publicStoreUrl } from '../tenancy/stores'

/** Free trial (decided by the owner on 2026-11-15): 14 days and up to 20 products. The platform can extend up to 30 days. */
export const TRIAL_DAYS = 14
export const TRIAL_PRODUCTS = 20
/** Proposed recoverable retention after the trial ends (subject to the legal policy). Nothing is deleted. */
export const TRIAL_RETENTION_DAYS = 30
export const TRIAL_TERMS_VERSION = 'v1.2'
export const SIGNUP_LINK_TTL_SECONDS = 72 * 3600
export const SIGNUP_PER_IP_HOUR = 3
export const RESEND_PER_IP_HOUR = 10
export const RESEND_COOLDOWN_SECONDS = 120
export const SIGNUPS_PER_DAY = 200
export const MAX_EXTENSION_DAYS = 30
/** Plans offered from the trial (the commercial plans of tiendiaexpres.com). Editable in platform_settings. */
export const DEFAULT_UPGRADE_PLANS = ['emprendedor', 'negocio', 'mayorista']
const UPGRADE_PLANS_SETTING = 'trial_upgrade_plans'

export class TrialFlowError extends Error {
  constructor(readonly code: string, message: string, readonly status: 400 | 403 | 404 | 409 | 410 | 429 | 503 = 400) { super(message) }
}

/** Throwaway inbox providers: a trial needs an address the merchant keeps. */
const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.net', 'sharklasers.com', '10minutemail.com', '10minutemail.net', 'yopmail.com', 'yopmail.net',
  'tempmail.com', 'temp-mail.org', 'temp-mail.io', 'getnada.com', 'trashmail.com', 'dispostable.com', 'maildrop.cc', 'throwawaymail.com', 'fakeinbox.com',
  'mintemail.com', 'emailondeck.com', 'mohmal.com', 'tempail.com', 'tempr.email', 'moakt.com', 'mailnesia.com', 'mytemp.email', 'spamgourmet.com',
])

const clean = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '')
const iso = (value: string | null | undefined) => (value ? `${value.replace(' ', 'T')}Z` : null)
const cop = (amount: number, currency = 'COP') => `$${new Intl.NumberFormat('es-CO').format(amount)} ${currency}`
const longDate = (value: string | null) => (value ? new Date(iso(value)!).toLocaleDateString('es-CO', { timeZone: 'America/Bogota', day: 'numeric', month: 'long', year: 'numeric' }) : '')
export const cycleLabel = (cycle: string) => (cycle === 'anual' ? 'Anual (sin pago inicial adicional)' : 'Mensual (incluye el pago inicial)')

async function audit(db: D1Database, action: string, storeId: number | null, entityId: string, payload: unknown, actor: string, source = 'api') {
  await db.prepare(`INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id) VALUES (?, 'trial', ?, ?, ?, ?, ?)`)
    .bind(action, entityId, JSON.stringify(payload), actor.slice(0, 160), source, storeId).run()
}

async function event(db: D1Database, storeId: number | null, level: 'info' | 'warning' | 'error', code: string, detail: string) {
  await db.prepare(`INSERT INTO platform_events (store_id, level, source, code, detail) VALUES (?, ?, 'trial', ?, ?)`).bind(storeId, level, code, detail.slice(0, 300)).run()
}

/** Hourly counter (shared table with the old trial). Returns false once the limit is passed. */
async function withinHourlyLimit(db: D1Database, key: string, limit: number): Promise<boolean> {
  const window = Math.floor(Date.now() / 3_600_000)
  const row = await db.prepare(
    `INSERT INTO trial_rate_limits (rate_key, window_start, hits) VALUES (?, ?, 1)
     ON CONFLICT(rate_key, window_start) DO UPDATE SET hits = hits + 1 RETURNING hits`,
  ).bind(key, window).first<{ hits: number }>()
  return Number(row?.hits || 0) <= limit
}

async function verifyTurnstile(env: Partial<Env['Bindings']>, token: unknown, ip: string, fetcher: typeof fetch): Promise<boolean> {
  if (!env.TURNSTILE_SECRET_KEY) return true
  if (typeof token !== 'string' || token.length < 10 || token.length > 4096) return false
  try {
    const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token, remoteip: ip })
    const response = await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body })
    const result = await response.json() as { success?: boolean }
    return result.success === true
  } catch { return false }
}

type OwnerRow = { userId: number; email: string; displayName: string; verified: number }
async function storeOwner(db: D1Database, storeId: number): Promise<OwnerRow | null> {
  return db.prepare(
    `SELECT u.id AS userId, u.email, u.display_name AS displayName, u.email_verified_at IS NOT NULL AS verified
     FROM store_memberships m JOIN platform_users u ON u.id = m.user_id
     WHERE m.store_id = ? AND m.role = 'owner' AND m.status = 'active' AND u.email IS NOT NULL AND u.status <> 'disabled'
     ORDER BY m.created_at LIMIT 1`,
  ).bind(storeId).first<OwnerRow>()
}

const firstName = (owner: { displayName?: string | null; email: string }) => (owner.displayName || '').split(' ')[0] || owner.email.split('@')[0]!

// ---- sign-up -------------------------------------------------------------------------------------

export type SignupResult = { ok: true }
/** The answer to the browser is always the same, whatever happened to the address. */
const SIGNUP_OK: SignupResult = { ok: true }

/** Emails the one-time link that confirms the address, sets the password and starts the trial. */
async function sendSignupLink(db: D1Database, env: Partial<Env['Bindings']>, input: { userId: number; email: string; displayName: string; storeId: number; slug: string; storeName: string }, actor: string) {
  const token = await createAccessToken(db, { userId: input.userId, storeId: input.storeId, purpose: 'activation', ttlSeconds: SIGNUP_LINK_TTL_SECONDS, createdBy: actor })
  const link = `${adminStoreUrl(env.PUBLIC_STORE_BASE_URL, { id: input.storeId, slug: input.slug })}/activar?token=${encodeURIComponent(token)}`
  const sent = await sendEmail(db, env, {
    template: { key: 'trial_signup' }, to: input.email, purpose: 'trial_signup', storeId: input.storeId, userId: input.userId, requestedBy: actor,
    idempotencyKey: `trial_signup:${await sha256Hex(`email:${token}`)}`,
    values: {
      nombre_usuario: firstName(input), correo_usuario: input.email, nombre_comercio: input.storeName, vence_en: '72 horas',
      enlace_activacion: link, dias_restantes: String(TRIAL_DAYS), limite_productos: String(TRIAL_PRODUCTS),
    },
  })
  // Opening a link that arrived by email proves the address (the activation then marks it verified).
  await markTokenDelivery(db, token, 'activation', sent.status === 'enviado' ? 'email' : 'manual')
  if (sent.status !== 'enviado') await event(db, input.storeId, 'warning', 'TRIAL_SIGNUP_EMAIL_NOT_SENT', `estado ${sent.status}`)
  return sent.status
}

/** Pending trial (not confirmed yet) of an account, if any. */
async function pendingTrialOf(db: D1Database, userId: number) {
  return db.prepare(
    `SELECT s.id AS storeId, s.slug, s.name AS storeName FROM store_trials t JOIN stores s ON s.id = t.store_id
     JOIN store_memberships m ON m.store_id = s.id AND m.user_id = ? AND m.role = 'owner' AND m.status = 'active'
     WHERE t.status = 'pendiente' ORDER BY t.created_at DESC LIMIT 1`,
  ).bind(userId).first<{ storeId: number; slug: string; storeName: string }>()
}

export async function signupTrial(db: D1Database, env: Partial<Env['Bindings']>, body: Record<string, unknown>, ip: string, fetcher: typeof fetch = fetch): Promise<SignupResult> {
  if (String(env.TRIAL_SIGNUP_ENABLED || '').toLowerCase() === 'false') throw new TrialFlowError('SIGNUP_DISABLED', 'El registro de pruebas está pausado. Escríbenos por WhatsApp.', 503)
  const ipHash = await sha256Hex(`signup-ip:${ip}`)
  // Bots fill every field; people never see this one.
  if (clean(body.website, 200)) {
    await event(db, null, 'warning', 'TRIAL_SIGNUP_HONEYPOT', ipHash.slice(0, 16))
    return SIGNUP_OK
  }
  const businessName = clean(body.businessName, 80)
  if (businessName.length < 2) throw new TrialFlowError('INVALID_NAME', 'Escribe el nombre de tu negocio.')
  const email = normalizeEmail(body.email)
  if (!email || !isEmail(email)) throw new TrialFlowError('INVALID_EMAIL', 'Escribe un correo válido: allí te enviaremos el enlace para entrar.')
  if (DISPOSABLE_DOMAINS.has(email.split('@')[1]!)) throw new TrialFlowError('INVALID_EMAIL', 'Usa un correo que revises siempre: los correos temporales no reciben los avisos de tu tienda.')
  if (body.acceptTerms !== true) throw new TrialFlowError('TERMS_REQUIRED', 'Acepta los términos y condiciones para crear tu tienda.')
  const ownerName = clean(body.ownerName, 120)
  const whatsappRaw = clean(body.whatsapp, 30).replace(/[\s().-]/g, '')
  if (whatsappRaw && !/^\+[1-9]\d{7,14}$/.test(whatsappRaw)) throw new TrialFlowError('INVALID_WHATSAPP', 'Escribe el WhatsApp con el código del país, por ejemplo +57 300 000 0000.')
  const businessType = clean(body.businessType, 120) || 'Tienda'
  if (!(await verifyTurnstile(env, body.turnstileToken, ip, fetcher))) throw new TrialFlowError('CAPTCHA_FAILED', 'No pudimos comprobar que eres una persona. Recarga la página e intenta de nuevo.', 403)
  if (!(await withinHourlyLimit(db, `signup:${ipHash}`, SIGNUP_PER_IP_HOUR))) throw new TrialFlowError('RATE_LIMITED', 'Hiciste varios registros seguidos. Intenta de nuevo en una hora.', 429)

  // The platform's own address never gets a trial; the answer stays the same.
  if (isSuperadminEmail(email, env as Env['Bindings'])) return SIGNUP_OK
  const emailHash = await sha256Hex(`trial-email:${email}`)
  const existing = await findUserByEmail(db, email)
  if (existing) {
    if (existing.status === 'disabled') return SIGNUP_OK
    // Same person signing up again before confirming: a fresh link for the same store (no second store).
    const pending = await pendingTrialOf(db, existing.id)
    if (pending) {
      await resendIfAllowed(db, env, { userId: existing.id, email: existing.email, displayName: existing.display_name, ...pending })
      return SIGNUP_OK
    }
    // Existing account: a notice by email (no link that grants access), at most once per hour.
    const panel = await firstPanelUrl(db, env, existing.id)
    if (panel) {
      await sendEmail(db, env, {
        template: { key: 'signup_existing' }, to: existing.email, purpose: 'signup_existing', userId: existing.id, requestedBy: 'signup',
        idempotencyKey: `signup_existing:${existing.id}:${Math.floor(Date.now() / 3_600_000)}`, values: { correo_usuario: existing.email, enlace_panel: panel },
      }).catch(() => null)
    }
    return SIGNUP_OK
  }
  if (await db.prepare('SELECT 1 AS hit FROM store_trials WHERE email_hash = ?').bind(emailHash).first()) return SIGNUP_OK
  const today = await db.prepare(`SELECT COUNT(*) AS n FROM store_trials WHERE created_at >= datetime('now', '-1 day')`).first<{ n: number }>()
  if (Number(today?.n || 0) >= SIGNUPS_PER_DAY) throw new TrialFlowError('DAILY_LIMIT', 'Hoy recibimos muchos registros. Intenta de nuevo mañana o escríbenos por WhatsApp.', 503)

  // The normal store creation, in trial mode. The request key makes retries resume the same store.
  const result = await provisionStore(db, env, {
    name: businessName, businessType, template: 'moderno', ownerEmail: email, ownerName: ownerName || undefined,
    whatsapp: whatsappRaw || undefined, planCode: 'prueba',
  }, { requestKey: `trial-signup-${emailHash.slice(0, 40)}`, actor: 'signup', trial: true })
  if (result.status !== 'completed' || !result.storeId) {
    await event(db, result.storeId ?? null, 'error', 'TRIAL_SIGNUP_FAILED', result.errorCode || result.status)
    if (result.status === 'running') return SIGNUP_OK
    throw new TrialFlowError('SIGNUP_FAILED', 'No pudimos crear tu tienda en este momento. Intenta de nuevo en unos minutos.', 503)
  }
  await db.prepare(
    `INSERT OR IGNORE INTO store_trials (store_id, status, email_hash, signup_ip_hash, product_limit, duration_days, terms_version) VALUES (?, 'pendiente', ?, ?, ?, ?, ?)`,
  ).bind(result.storeId, emailHash, ipHash, TRIAL_PRODUCTS, TRIAL_DAYS, TRIAL_TERMS_VERSION).run()
  await audit(db, 'trial_signup', result.storeId, String(result.storeId), { termsVersion: TRIAL_TERMS_VERSION, whatsapp: Boolean(whatsappRaw) }, 'signup')
  await event(db, result.storeId, 'info', 'TRIAL_SIGNUP', result.slug || '')
  const user = await findUserByEmail(db, email)
  // The store exists even if the email fails: the person can ask for the link again (resend), safely.
  if (user) await sendSignupLink(db, env, { userId: user.id, email, displayName: ownerName, storeId: result.storeId, slug: result.slug!, storeName: businessName }, 'signup')
  return SIGNUP_OK
}

async function firstPanelUrl(db: D1Database, env: Partial<Env['Bindings']>, userId: number): Promise<string | null> {
  const store = await db.prepare(
    `SELECT s.id, s.slug FROM store_memberships m JOIN stores s ON s.id = m.store_id WHERE m.user_id = ? AND m.status = 'active' AND s.status <> 'cancelled' ORDER BY m.created_at LIMIT 1`,
  ).bind(userId).first<{ id: number; slug: string }>()
  const url = store ? `${adminStoreUrl(env.PUBLIC_STORE_BASE_URL, store)}/login` : null
  return url && url.startsWith('https://') ? url : null
}

async function resendIfAllowed(db: D1Database, env: Partial<Env['Bindings']>, input: { userId: number; email: string; displayName: string; storeId: number; slug: string; storeName: string }) {
  const recent = await db.prepare(`SELECT COUNT(*) AS n FROM email_messages WHERE user_id = ? AND purpose = 'trial_signup' AND created_at >= datetime('now', ?)`)
    .bind(input.userId, `-${RESEND_COOLDOWN_SECONDS} seconds`).first<{ n: number }>()
  if (Number(recent?.n || 0) > 0) return 'cooldown'
  await audit(db, 'trial_link_resent', input.storeId, String(input.userId), {}, 'signup')
  return sendSignupLink(db, env, input, 'signup')
}

/** Public: sends the confirmation link again. Same answer whether or not the address has a pending trial. */
export async function resendTrialLink(db: D1Database, env: Partial<Env['Bindings']>, rawEmail: unknown, ip: string): Promise<SignupResult> {
  const ipHash = await sha256Hex(`signup-ip:${ip}`)
  if (!(await withinHourlyLimit(db, `signup-resend:${ipHash}`, RESEND_PER_IP_HOUR))) throw new TrialFlowError('RATE_LIMITED', 'Pediste varios enlaces seguidos. Intenta de nuevo en una hora.', 429)
  const email = normalizeEmail(rawEmail)
  if (!email) throw new TrialFlowError('INVALID_EMAIL', 'Escribe el correo con el que creaste tu tienda.')
  const user = await findUserByEmail(db, email)
  if (!user || user.status === 'disabled' || user.password_hash) return SIGNUP_OK
  const pending = await pendingTrialOf(db, user.id)
  if (pending) await resendIfAllowed(db, env, { userId: user.id, email: user.email, displayName: user.display_name, ...pending })
  return SIGNUP_OK
}

// ---- start (after the email is confirmed) ----------------------------------------------------------

/** Called after a successful account activation. Starts the 7 days and publishes the store, once. */
export async function startTrialAfterActivation(db: D1Database, storeId: number, actor: string): Promise<{ started: boolean; expiresAt: string | null }> {
  const row = await db.prepare(
    `UPDATE store_trials SET status = 'activa', started_at = datetime('now'),
       expires_at = datetime('now', '+' || duration_days || ' days'),
       retain_until = datetime('now', '+' || (duration_days + ${TRIAL_RETENTION_DAYS}) || ' days'), updated_at = datetime('now')
     WHERE store_id = ? AND status = 'pendiente' RETURNING expires_at AS expiresAt`,
  ).bind(storeId).first<{ expiresAt: string }>()
  if (!row) return { started: false, expiresAt: null }
  await db.batch([
    db.prepare(`UPDATE stores SET status = CASE WHEN status = 'draft' THEN 'active' ELSE status END, activated_at = COALESCE(activated_at, datetime('now')),
      trial_ends_at = ?, updated_at = datetime('now') WHERE id = ?`).bind(row.expiresAt, storeId),
    db.prepare(`INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id) VALUES ('trial_started', 'trial', ?, ?, ?, 'api', ?)`)
      .bind(String(storeId), JSON.stringify({ expiresAt: row.expiresAt }), actor.slice(0, 160), storeId),
  ])
  return { started: true, expiresAt: row.expiresAt }
}

export async function sendTrialWelcome(db: D1Database, env: Partial<Env['Bindings']>, storeId: number) {
  const store = await db.prepare('SELECT s.id, s.slug, s.name, t.expires_at AS expiresAt, t.product_limit AS productLimit, t.duration_days AS days FROM stores s JOIN store_trials t ON t.store_id = s.id WHERE s.id = ?')
    .bind(storeId).first<{ id: number; slug: string; name: string; expiresAt: string; productLimit: number; days: number }>()
  const owner = await storeOwner(db, storeId)
  const panel = store ? `${adminStoreUrl(env.PUBLIC_STORE_BASE_URL, store)}/login` : ''
  if (!store || !owner || !panel.startsWith('https://')) return null
  return sendEmail(db, env, {
    template: { key: 'trial_welcome' }, to: owner.email, purpose: 'trial_welcome', storeId, userId: owner.userId, requestedBy: 'system', idempotencyKey: `trial_welcome:${storeId}`,
    values: {
      nombre_usuario: firstName(owner), correo_usuario: owner.email, nombre_comercio: store.name, enlace_panel: panel,
      enlace_tienda: publicStoreUrl(env.PUBLIC_STORE_BASE_URL, store), dias_restantes: String(store.days), fecha_vencimiento: longDate(store.expiresAt), limite_productos: String(store.productLimit),
    },
  }).catch(() => null)
}

// ---- status for the store panel ---------------------------------------------------------------------

export async function upgradePlans(db: D1Database) {
  const setting = await db.prepare('SELECT value_json FROM platform_settings WHERE key = ?').bind(UPGRADE_PLANS_SETTING).first<{ value_json: string }>()
  let codes = DEFAULT_UPGRADE_PLANS
  try { if (setting) codes = (JSON.parse(setting.value_json) as unknown[]).filter((code): code is string => typeof code === 'string').slice(0, 10) } catch { codes = DEFAULT_UPGRADE_PLANS }
  if (!codes.length) return []
  const { results } = await db.prepare(
    `SELECT code, name, setup_price AS setupPrice, monthly_price AS monthlyPrice, annual_price AS annualPrice, currency,
            CASE WHEN products_unlimited = 1 THEN NULL ELSE max_products END AS maxProducts, features_json AS features, sort_order AS sortOrder
     FROM plans WHERE code IN (${codes.map(() => '?').join(', ')}) AND code NOT IN ('prueba', 'legacy') ORDER BY sort_order`,
  ).bind(...codes).all<{ code: string; name: string; setupPrice: number; monthlyPrice: number; annualPrice: number; currency: string; maxProducts: number | null; features: string; sortOrder: number }>()
  return (results || []).map((plan) => {
    let features: string[] = []
    try { features = JSON.parse(plan.features) as string[] } catch { features = [] }
    return { ...plan, features, amounts: { mensual: plan.setupPrice + plan.monthlyPrice, anual: plan.annualPrice } }
  })
}

const IMPORTANT_PURPOSES = ['trial_signup', 'trial_welcome', 'welcome', 'trial_expiring', 'trial_ended', 'plan_requested', 'plan_activated', 'password_reset', 'password_changed', 'email_verification']

type TrialRow = { store_id: number; status: string; product_limit: number; duration_days: number; started_at: string | null; expires_at: string | null; retain_until: string | null; extended_days: number; converted_at: string | null; converted_plan_code: string | null; created_at: string }

export function effectiveTrialStatus(row: Pick<TrialRow, 'status' | 'expires_at'>, now = Date.now()): string {
  if (row.status === 'activa' && row.expires_at && Date.parse(iso(row.expires_at)!) <= now) return 'vencida'
  return row.status
}

export async function getTrialStatus(db: D1Database, storeId: number) {
  const row = await db.prepare('SELECT * FROM store_trials WHERE store_id = ?').bind(storeId).first<TrialRow>()
  if (!row) return { trial: null }
  const status = effectiveTrialStatus(row)
  const msLeft = row.expires_at ? Date.parse(iso(row.expires_at)!) - Date.now() : null
  const [products, owner, requests, messages] = await Promise.all([
    db.prepare('SELECT COUNT(*) AS n FROM products WHERE store_id = ? AND is_archived = 0').bind(storeId).first<{ n: number }>(),
    storeOwner(db, storeId),
    db.prepare(`SELECT r.code, r.plan_code AS planCode, p.name AS planName, r.billing_cycle AS cycle, r.amount, r.currency, r.status, r.created_at AS createdAt, r.activated_at AS activatedAt
      FROM store_plan_requests r LEFT JOIN plans p ON p.code = r.plan_code WHERE r.store_id = ? ORDER BY r.id DESC LIMIT 5`).bind(storeId).all<Record<string, unknown>>(),
    db.prepare(`SELECT purpose, subject, status, delivery_status AS deliveryStatus, created_at AS createdAt FROM email_messages
      WHERE store_id = ? AND purpose IN (${IMPORTANT_PURPOSES.map(() => '?').join(', ')}) ORDER BY id DESC LIMIT 12`).bind(storeId, ...IMPORTANT_PURPOSES).all<Record<string, unknown>>(),
  ])
  const history = (requests.results || []).map((request) => ({ ...request, status: String(request.status), createdAt: iso(String(request.createdAt)), activatedAt: iso(request.activatedAt as string | null) }))
  return {
    trial: {
      status, startedAt: iso(row.started_at), expiresAt: iso(row.expires_at), retainUntil: iso(row.retain_until),
      daysLeft: msLeft === null ? null : Math.max(0, Math.ceil(msLeft / 86_400_000)), hoursLeft: msLeft === null ? null : Math.max(0, Math.floor(msLeft / 3_600_000)),
      productLimit: row.product_limit, productCount: Number(products?.n || 0), durationDays: row.duration_days, extendedDays: row.extended_days,
      convertedAt: iso(row.converted_at), convertedPlanCode: row.converted_plan_code,
      emailVerified: Boolean(owner?.verified), ownerEmail: owner?.email ?? null,
      openRequest: history.find((request) => request.status === 'pendiente_pago') ?? null,
      requests: history,
      messages: (messages.results || []).map((message) => ({ ...message, createdAt: iso(String(message.createdAt)) })),
    },
    plans: status === 'convertida' ? [] : await upgradePlans(db),
    ai: { included: false, note: 'Las funciones de IA, los créditos premium y las integraciones experimentales se habilitan con un plan pagado.' },
  }
}

// ---- plan request (from the store panel) -------------------------------------------------------------

/** How the merchant pays the plan: online with the platform's Bold account when it is configured (live), else sales. */
function paymentInstructions(env: Partial<Env['Bindings']>): string {
  return platformBoldOffered(env)
    ? 'Paga en línea desde tu panel, en «Activar mi tienda», con tarjeta, PSE o Nequi a través de Bold. Tu plan se activa en cuanto Bold aprueba el pago; mientras tanto tu tienda sigue como está.'
    : 'Nuestro equipo de ventas te escribirá con los datos de pago. Tu plan se activa cuando confirmemos el pago; mientras tanto tu tienda sigue como está.'
}

type RequestRow = { id: number; store_id: number; code: string; plan_code: string; billing_cycle: string; amount: number; currency: string; invoice_id: number | null; status: string; requested_by: string; payment_reference: string | null; verified_by: string | null; activation_op: string | null; activated_at: string | null; created_at: string }

function requestCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return `ACT-${[...crypto.getRandomValues(new Uint8Array(6))].map((byte) => alphabet[byte % alphabet.length]).join('')}`
}

const publicRequest = (row: RequestRow, planName: string) => ({
  code: row.code, planCode: row.plan_code, planName, cycle: row.billing_cycle, amount: row.amount, currency: row.currency, status: row.status, createdAt: iso(row.created_at),
})

async function cancelRequest(db: D1Database, row: RequestRow, reason: string, actor: string) {
  await db.batch([
    db.prepare(`UPDATE store_plan_requests SET status = 'cancelada', cancelled_reason = ?, updated_at = datetime('now') WHERE id = ? AND status = 'pendiente_pago'`).bind(reason.slice(0, 200), row.id),
    db.prepare(`UPDATE store_invoices SET status = 'anulada', updated_at = datetime('now') WHERE id = ? AND status = 'pendiente'`).bind(row.invoice_id ?? 0),
    db.prepare(`INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id) VALUES ('plan_request_cancelled', 'plan_request', ?, ?, ?, 'api', ?)`)
      .bind(row.code, JSON.stringify({ reason }), actor.slice(0, 160), row.store_id),
  ])
}

/** Owner: asks for a plan. Creates a pending invoice; the plan is NOT enabled until the payment is verified. */
export async function requestPlan(db: D1Database, env: Partial<Env['Bindings']>, storeId: number, body: Record<string, unknown>, actor: string) {
  const trial = await db.prepare('SELECT status FROM store_trials WHERE store_id = ?').bind(storeId).first<{ status: string }>()
  if (!trial) throw new TrialFlowError('NOT_A_TRIAL', 'Esta tienda ya tiene un plan. Para cambiarlo, escribe a ventas.', 409)
  if (trial.status === 'convertida') throw new TrialFlowError('ALREADY_CONVERTED', 'Tu tienda ya está activa con un plan.', 409)
  if (trial.status === 'pendiente') throw new TrialFlowError('EMAIL_NOT_CONFIRMED', 'Confirma tu correo antes de contratar.', 409)
  const planCode = clean(body.planCode, 40)
  const cycle = body.cycle === 'anual' ? 'anual' : body.cycle === 'mensual' ? 'mensual' : null
  if (!cycle) throw new TrialFlowError('INVALID_CYCLE', 'Elige pago mensual o anual.')
  const plan = (await upgradePlans(db)).find((item) => item.code === planCode)
  if (!plan) throw new TrialFlowError('INVALID_PLAN', 'Elige uno de los planes disponibles.')
  const amount = plan.amounts[cycle]
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new TrialFlowError('PLAN_NOT_PRICED', 'Ese plan todavía no tiene precio publicado. Escríbenos por WhatsApp.', 409)

  const open = await db.prepare(`SELECT * FROM store_plan_requests WHERE store_id = ? AND status = 'pendiente_pago'`).bind(storeId).first<RequestRow>()
  if (open && open.plan_code === plan.code && open.billing_cycle === cycle) return { request: publicRequest(open, plan.name), replayed: true }
  if (open) await cancelRequest(db, open, 'reemplazada por otra solicitud', actor)

  const code = requestCode()
  const concept = `Activación plan ${plan.name} (${cycle}) · ${code}`
  const period = new Date().toISOString().slice(0, 7)
  try {
    await db.batch([
      db.prepare(`INSERT INTO store_plan_requests (store_id, code, plan_code, billing_cycle, amount, currency, requested_by) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(storeId, code, plan.code, cycle, amount, plan.currency, actor.slice(0, 160)),
      db.prepare(`INSERT INTO store_invoices (store_id, service_id, period, concept, amount, currency, status, due_date, created_by) VALUES (?, NULL, ?, ?, ?, ?, 'pendiente', date('now', '+7 days'), ?)`)
        .bind(storeId, period, concept, amount, plan.currency, actor.slice(0, 160)),
      db.prepare(`UPDATE store_plan_requests SET invoice_id = (SELECT id FROM store_invoices WHERE store_id = ? AND concept = ? ORDER BY id DESC LIMIT 1) WHERE code = ?`).bind(storeId, concept, code),
      db.prepare(`INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id) VALUES ('plan_requested', 'plan_request', ?, ?, ?, 'admin', ?)`)
        .bind(code, JSON.stringify({ plan: plan.code, cycle, amount }), actor.slice(0, 160), storeId),
    ])
  } catch (error) {
    // A parallel click already opened a request: answer with that one.
    if (error instanceof Error && /unique constraint/i.test(error.message)) {
      const winner = await db.prepare(`SELECT * FROM store_plan_requests WHERE store_id = ? AND status = 'pendiente_pago'`).bind(storeId).first<RequestRow>()
      if (winner) return { request: publicRequest(winner, plan.name), replayed: true }
    }
    throw error
  }
  const row = (await db.prepare('SELECT * FROM store_plan_requests WHERE code = ?').bind(code).first<RequestRow>())!
  const store = await db.prepare('SELECT name FROM stores WHERE id = ?').bind(storeId).first<{ name: string }>()
  const owner = await storeOwner(db, storeId)
  if (owner && store) {
    await sendEmail(db, env, {
      template: { key: 'plan_requested' }, to: owner.email, purpose: 'plan_requested', storeId, userId: owner.userId, requestedBy: actor, idempotencyKey: `plan_requested:${row.id}`,
      values: { nombre_usuario: firstName(owner), correo_usuario: owner.email, nombre_comercio: store.name, nombre_plan: plan.name, codigo_solicitud: code, valor_plan: cop(amount, plan.currency), ciclo_pago: cycleLabel(cycle), instrucciones_pago: paymentInstructions(env) },
    }).catch(() => null)
  }
  await event(db, storeId, 'info', 'PLAN_REQUESTED', `${code} ${plan.code} ${cycle}`)
  return { request: publicRequest(row, plan.name), replayed: false }
}

// ---- activation after the payment is verified (platform) ---------------------------------------------

/** Superadmin (or the existing "invoice paid" step): enables the plan on the SAME store. One transaction:
 * request → activada, invoice → pagada, store → plan rights (trial limits removed), trial → convertida and
 * audit. Recurring charges stay with the existing invoice generator (plan monthly price), which skips the month
 * already paid here and the 12 months of an annual payment. Every statement is guarded by this run's operation id, so a retry or a parallel call
 * changes nothing twice. Products, photos, orders, settings and the store id/slug are never touched. */
export async function activatePlanRequest(db: D1Database, env: Partial<Env['Bindings']>, selector: { id?: number; invoiceId?: number }, input: { actor: string; paymentReference: string }) {
  const row = selector.id
    ? await db.prepare('SELECT * FROM store_plan_requests WHERE id = ?').bind(selector.id).first<RequestRow>()
    : await db.prepare('SELECT * FROM store_plan_requests WHERE invoice_id = ? ORDER BY id DESC LIMIT 1').bind(selector.invoiceId ?? 0).first<RequestRow>()
  if (!row) throw new TrialFlowError('REQUEST_NOT_FOUND', 'No encontré esa contratación.', 404)
  if (row.status === 'activada') return { status: 'activada', replayed: true, storeId: row.store_id, planCode: row.plan_code, code: row.code }
  if (row.status !== 'pendiente_pago') throw new TrialFlowError('REQUEST_NOT_PENDING', 'Esa contratación fue cancelada.', 409)
  const reference = clean(input.paymentReference, 120)
  if (reference.length < 3) throw new TrialFlowError('PAYMENT_REFERENCE_REQUIRED', 'Escribe la referencia del pago verificado (comprobante, transferencia o factura).')
  const plan = await db.prepare('SELECT code, name, ai_monthly_budget_micros AS budget, setup_price AS setup, monthly_price AS monthly, annual_price AS annual, currency FROM plans WHERE code = ?')
    .bind(row.plan_code).first<{ code: string; name: string; budget: number; setup: number; monthly: number; annual: number; currency: string }>()
  if (!plan) throw new TrialFlowError('PLAN_NOT_FOUND', 'El plan de esa contratación ya no existe.', 409)
  const op = crypto.randomUUID()
  const mine = `EXISTS (SELECT 1 FROM store_plan_requests WHERE id = ${Number(row.id)} AND activation_op = ?)`
  const actor = input.actor.slice(0, 160)
  await db.batch([
    db.prepare(`UPDATE store_plan_requests SET status = 'activada', activation_op = ?, verified_by = ?, payment_reference = ?, activated_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ? AND status = 'pendiente_pago'`).bind(op, actor, reference, row.id),
    db.prepare(`UPDATE store_invoices SET status = 'pagada', paid_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND status = 'pendiente' AND ${mine}`).bind(row.invoice_id ?? 0, op),
    db.prepare(`UPDATE stores SET plan_code = ?, ai_monthly_budget_micros = ?, ai_enabled = ?, trial_ends_at = NULL,
        status = CASE WHEN status IN ('draft', 'active') THEN 'active' ELSE status END, activated_at = COALESCE(activated_at, datetime('now')), updated_at = datetime('now')
      WHERE id = ? AND ${mine}`).bind(plan.code, plan.budget, plan.budget > 0 ? 1 : 0, row.store_id, op),
    db.prepare(`UPDATE store_trials SET status = 'convertida', converted_at = datetime('now'), converted_plan_code = ?, updated_at = datetime('now') WHERE store_id = ? AND status <> 'convertida' AND ${mine}`)
      .bind(plan.code, row.store_id, op),
    db.prepare(`INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id)
      SELECT 'plan_activated', 'plan_request', ?, ?, ?, 'platform', ? WHERE ${mine}`)
      .bind(row.code, JSON.stringify({ plan: plan.code, cycle: row.billing_cycle, invoiceId: row.invoice_id, paymentReference: reference }), actor, row.store_id, op),
    db.prepare(`INSERT INTO platform_events (store_id, level, source, code, detail) SELECT ?, 'info', 'trial', 'PLAN_ACTIVATED', ? WHERE ${mine}`).bind(row.store_id, `${row.code} ${plan.code}`, op),
  ])
  const after = await db.prepare('SELECT status, activation_op FROM store_plan_requests WHERE id = ?').bind(row.id).first<{ status: string; activation_op: string | null }>()
  if (after?.activation_op !== op) {
    if (after?.status === 'activada') return { status: 'activada', replayed: true, storeId: row.store_id, planCode: row.plan_code, code: row.code }
    throw new TrialFlowError('REQUEST_NOT_PENDING', 'Esa contratación ya no está pendiente.', 409)
  }
  const store = await db.prepare('SELECT id, slug, name FROM stores WHERE id = ?').bind(row.store_id).first<{ id: number; slug: string; name: string }>()
  const owner = await storeOwner(db, row.store_id)
  const panel = store ? `${adminStoreUrl(env.PUBLIC_STORE_BASE_URL, store)}/login` : ''
  if (store && owner && panel.startsWith('https://')) {
    await sendEmail(db, env, {
      template: { key: 'plan_activated' }, to: owner.email, purpose: 'plan_activated', storeId: store.id, userId: owner.userId, requestedBy: actor, idempotencyKey: `plan_activated:${row.id}`,
      values: { nombre_usuario: firstName(owner), correo_usuario: owner.email, nombre_comercio: store.name, nombre_plan: plan.name, codigo_solicitud: row.code, ciclo_pago: cycleLabel(row.billing_cycle), enlace_tienda: publicStoreUrl(env.PUBLIC_STORE_BASE_URL, store), enlace_panel: panel },
    }).catch(() => null)
  }
  return { status: 'activada', replayed: false, storeId: row.store_id, planCode: plan.code, code: row.code }
}

/** Superadmin: cancels a pending request (its invoice is voided). The store keeps its trial as it was. */
export async function cancelPlanRequestById(db: D1Database, id: number, reason: string, actor: string) {
  const row = await db.prepare('SELECT * FROM store_plan_requests WHERE id = ?').bind(id).first<RequestRow>()
  if (!row) throw new TrialFlowError('REQUEST_NOT_FOUND', 'No encontré esa contratación.', 404)
  if (row.status !== 'pendiente_pago') throw new TrialFlowError('REQUEST_NOT_PENDING', 'Esa contratación ya no está pendiente.', 409)
  await cancelRequest(db, row, clean(reason, 200) || 'cancelada por la plataforma', actor)
  return { status: 'cancelada' }
}

// ---- lifecycle (scheduled) ------------------------------------------------------------------------------

/** Every scheduled run: notices 3 days and 1 day before the end, and the end itself. Each notice is claimed
 * once in the database before sending (and the email has its own idempotency key), so overlapping runs never
 * send it twice. Nothing is deleted: the data stays, the store just stops being public and taking orders. */
export async function processTrialLifecycle(db: D1Database, env: Partial<Env['Bindings']>, limit = 25) {
  let sent = 0
  const notify = async (storeId: number, key: 'trial_expiring' | 'trial_ended', marker: string, daysLeft: number) => {
    const store = await db.prepare('SELECT s.id, s.slug, s.name, t.expires_at AS expiresAt FROM stores s JOIN store_trials t ON t.store_id = s.id WHERE s.id = ?').bind(storeId).first<{ id: number; slug: string; name: string; expiresAt: string }>()
    const owner = await storeOwner(db, storeId)
    if (!store || !owner) return
    const plans = `${adminStoreUrl(env.PUBLIC_STORE_BASE_URL, store)}/activar-tienda`
    const result = await sendEmail(db, env, {
      template: { key }, to: owner.email, purpose: key, storeId, userId: owner.userId, requestedBy: 'system', idempotencyKey: `${key}:${storeId}:${marker}`,
      values: { nombre_usuario: firstName(owner), correo_usuario: owner.email, nombre_comercio: store.name, dias_restantes: String(daysLeft), fecha_vencimiento: longDate(store.expiresAt), enlace_planes: plans },
    }).catch(() => null)
    if (result) sent += 1
  }
  for (const [days, column] of [[1, 'notice_1d_at'], [3, 'notice_3d_at']] as const) {
    const { results } = await db.prepare(
      `SELECT store_id AS storeId, expires_at AS expiresAt, CAST(((julianday(expires_at) - julianday('now')) * 86400) AS INTEGER) AS secondsLeft FROM store_trials
       WHERE status = 'activa' AND ${column} IS NULL AND expires_at > datetime('now') AND expires_at <= datetime('now', '+${days} days')
         AND (${days} = 1 OR expires_at > datetime('now', '+1 days')) ORDER BY expires_at LIMIT ?`,
    ).bind(limit).all<{ storeId: number; expiresAt: string; secondsLeft: number }>()
    for (const row of results || []) {
      const claim = await db.prepare(`UPDATE store_trials SET ${column} = datetime('now'), updated_at = datetime('now') WHERE store_id = ? AND ${column} IS NULL AND status = 'activa' RETURNING store_id`).bind(row.storeId).first()
      if (claim) await notify(row.storeId, 'trial_expiring', `${days}d:${row.expiresAt}`, Math.max(1, Math.ceil(Number(row.secondsLeft) / 86_400)))
    }
  }
  const { results: ended } = await db.prepare(`SELECT store_id AS storeId, expires_at AS expiresAt FROM store_trials WHERE status = 'activa' AND expires_at <= datetime('now') ORDER BY expires_at LIMIT ?`).bind(limit).all<{ storeId: number; expiresAt: string }>()
  for (const row of ended || []) {
    const claim = await db.prepare(`UPDATE store_trials SET status = 'vencida', notice_end_at = COALESCE(notice_end_at, datetime('now')), updated_at = datetime('now') WHERE store_id = ? AND status = 'activa' AND expires_at <= datetime('now') RETURNING store_id`).bind(row.storeId).first()
    if (!claim) continue
    await audit(db, 'trial_expired', row.storeId, String(row.storeId), { expiresAt: row.expiresAt }, 'system', 'scheduler')
    await notify(row.storeId, 'trial_ended', `end:${row.expiresAt}`, 0)
  }
  return { sent, ended: (ended || []).length }
}

// ---- platform (superadmin) ----------------------------------------------------------------------------

/** Superadmin only, always audited: adds days to a trial (also reopens one that ended). */
export async function extendTrial(db: D1Database, slug: string, body: Record<string, unknown>, actor: string) {
  const days = Number(body.days)
  const reason = clean(body.reason, 300)
  if (!Number.isInteger(days) || days < 1 || days > 14) throw new TrialFlowError('INVALID_DAYS', 'Extiende entre 1 y 14 días.')
  if (reason.length < 5) throw new TrialFlowError('REASON_REQUIRED', 'Escribe el motivo de la extensión (queda en la auditoría).')
  const store = await getStoreBySlug(db, slug)
  if (!store) throw new TrialFlowError('STORE_NOT_FOUND', 'No encontré esa tienda.', 404)
  const trial = await db.prepare('SELECT * FROM store_trials WHERE store_id = ?').bind(store.id).first<TrialRow>()
  if (!trial) throw new TrialFlowError('NOT_A_TRIAL', 'Esa tienda no está en prueba.', 409)
  if (trial.status === 'convertida' || trial.status === 'pendiente') throw new TrialFlowError('NOT_EXTENDABLE', trial.status === 'pendiente' ? 'La prueba empieza cuando la persona confirma su correo.' : 'Esa tienda ya tiene un plan.', 409)
  if (trial.extended_days + days > MAX_EXTENSION_DAYS) throw new TrialFlowError('EXTENSION_LIMIT', `Una prueba se puede extender como máximo ${MAX_EXTENSION_DAYS} días en total.`, 409)
  const row = await db.prepare(
    `UPDATE store_trials SET status = 'activa', extended_days = extended_days + ?,
       expires_at = datetime(MAX(expires_at, datetime('now')), '+' || ? || ' days'),
       retain_until = datetime(MAX(expires_at, datetime('now')), '+' || (? + ${TRIAL_RETENTION_DAYS}) || ' days'),
       notice_3d_at = NULL, notice_1d_at = NULL, notice_end_at = NULL, updated_at = datetime('now')
     WHERE store_id = ? AND status IN ('activa', 'vencida') RETURNING expires_at AS expiresAt`,
  ).bind(days, days, days, store.id).first<{ expiresAt: string }>()
  if (!row) throw new TrialFlowError('NOT_EXTENDABLE', 'No se pudo extender la prueba.', 409)
  await db.batch([
    db.prepare(`UPDATE stores SET trial_ends_at = ?, updated_at = datetime('now') WHERE id = ?`).bind(row.expiresAt, store.id),
    db.prepare(`INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id) VALUES ('trial_extended', 'trial', ?, ?, ?, 'platform', ?)`)
      .bind(String(store.id), JSON.stringify({ days, reason, from: trial.expires_at, to: row.expiresAt }), actor.slice(0, 160), store.id),
  ])
  return { slug: store.slug, expiresAt: iso(row.expiresAt), extendedDays: trial.extended_days + days }
}

export async function listTrialStores(db: D1Database, filter: { status?: string } = {}) {
  const { results } = await db.prepare(
    `SELECT s.id, s.slug, s.name, s.status AS storeStatus, s.plan_code AS planCode, t.status, t.started_at AS startedAt, t.expires_at AS expiresAt,
            t.retain_until AS retainUntil, t.extended_days AS extendedDays, t.converted_at AS convertedAt, t.converted_plan_code AS convertedPlanCode, t.created_at AS createdAt,
            (SELECT COUNT(*) FROM products p WHERE p.store_id = s.id AND p.is_archived = 0) AS products,
            (SELECT COUNT(*) FROM orders o WHERE o.store_id = s.id) AS orders,
            (SELECT u.email FROM store_memberships m JOIN platform_users u ON u.id = m.user_id WHERE m.store_id = s.id AND m.role = 'owner' AND m.status = 'active' LIMIT 1) AS ownerEmail,
            (SELECT u.email_verified_at IS NOT NULL FROM store_memberships m JOIN platform_users u ON u.id = m.user_id WHERE m.store_id = s.id AND m.role = 'owner' AND m.status = 'active' LIMIT 1) AS ownerVerified,
            (SELECT r.code || '|' || r.plan_code || '|' || r.billing_cycle || '|' || r.amount || '|' || r.id FROM store_plan_requests r WHERE r.store_id = s.id AND r.status = 'pendiente_pago' LIMIT 1) AS openRequest,
            (SELECT e.purpose || '|' || e.status || '|' || COALESCE(e.delivery_status, '') || '|' || e.created_at FROM email_messages e WHERE e.store_id = s.id ORDER BY e.id DESC LIMIT 1) AS lastEmail
     FROM store_trials t JOIN stores s ON s.id = t.store_id ORDER BY t.created_at DESC LIMIT 500`,
  ).all<Record<string, any>>()
  const now = Date.now()
  const items = (results || []).map((row) => {
    const status = effectiveTrialStatus({ status: row.status, expires_at: row.expiresAt }, now)
    const [code, planCode, cycle, amount, id] = row.openRequest ? String(row.openRequest).split('|') : []
    const [purpose, emailStatus, delivery, emailAt] = row.lastEmail ? String(row.lastEmail).split('|') : []
    const msLeft = row.expiresAt ? Date.parse(iso(row.expiresAt)!) - now : null
    return {
      id: row.id, slug: row.slug, name: row.name, storeStatus: row.storeStatus, planCode: row.planCode, status,
      startedAt: iso(row.startedAt), expiresAt: iso(row.expiresAt), retainUntil: iso(row.retainUntil), createdAt: iso(row.createdAt),
      daysLeft: msLeft === null ? null : Math.max(0, Math.ceil(msLeft / 86_400_000)), extendedDays: row.extendedDays,
      retentionReached: Boolean(row.retainUntil && Date.parse(iso(row.retainUntil)!) <= now && status === 'vencida'),
      convertedAt: iso(row.convertedAt), convertedPlanCode: row.convertedPlanCode, products: row.products, orders: row.orders,
      ownerEmail: row.ownerEmail, ownerVerified: Boolean(row.ownerVerified),
      openRequest: code ? { id: Number(id), code, planCode, cycle, amount: Number(amount) } : null,
      lastEmail: purpose ? { purpose, status: emailStatus, deliveryStatus: delivery || null, createdAt: iso(emailAt) } : null,
    }
  })
  const wanted = filter.status
  return wanted === 'por_vencer' ? items.filter((item) => item.status === 'activa' && item.daysLeft !== null && item.daysLeft <= 3)
    : wanted ? items.filter((item) => item.status === wanted) : items
}

export async function trialStoreMetrics(db: D1Database) {
  const items = await listTrialStores(db)
  const count = (status: string) => items.filter((item) => item.status === status).length
  const started = items.filter((item) => item.startedAt).length
  const converted = count('convertida')
  const emails = await db.prepare(
    `SELECT status, delivery_status AS delivery, COUNT(*) AS n FROM email_messages
     WHERE purpose IN ('trial_signup', 'trial_welcome', 'trial_expiring', 'trial_ended', 'plan_requested', 'plan_activated') AND created_at >= datetime('now', '-30 days')
     GROUP BY status, delivery_status`,
  ).all<{ status: string; delivery: string | null; n: number }>()
  const pendingPayments = await db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS amount FROM store_plan_requests WHERE status = 'pendiente_pago'`).first<{ n: number; amount: number }>()
  return {
    total: items.length, pendingEmail: count('pendiente'), active: count('activa'), expired: count('vencida'), converted, started,
    expiringSoon: items.filter((item) => item.status === 'activa' && item.daysLeft !== null && item.daysLeft <= 3).length,
    conversionRate: started ? Math.round((converted / started) * 1000) / 10 : 0,
    pendingPayments: { count: Number(pendingPayments?.n || 0), amount: Number(pendingPayments?.amount || 0) },
    emails: (emails.results || []).map((row) => ({ status: row.status, delivery: row.delivery, count: Number(row.n) })),
  }
}

export async function listPlanRequests(db: D1Database, filter: { status?: string } = {}) {
  const status = ['pendiente_pago', 'activada', 'cancelada'].includes(filter.status || '') ? filter.status! : null
  const { results } = await db.prepare(
    `SELECT r.id, r.code, r.status, r.plan_code AS planCode, p.name AS planName, r.billing_cycle AS cycle, r.amount, r.currency, r.invoice_id AS invoiceId,
            i.status AS invoiceStatus, r.requested_by AS requestedBy, r.payment_reference AS paymentReference, r.verified_by AS verifiedBy,
            r.activated_at AS activatedAt, r.cancelled_reason AS cancelledReason, r.created_at AS createdAt, s.slug, s.name AS storeName
     FROM store_plan_requests r JOIN stores s ON s.id = r.store_id LEFT JOIN plans p ON p.code = r.plan_code LEFT JOIN store_invoices i ON i.id = r.invoice_id
     WHERE (? IS NULL OR r.status = ?) ORDER BY r.id DESC LIMIT 200`,
  ).bind(status, status).all<Record<string, any>>()
  return (results || []).map((row) => ({ ...row, createdAt: iso(row.createdAt), activatedAt: iso(row.activatedAt) }))
}

/** Things that need a person: payments waiting too long, inconsistent states and emails that did not arrive. */
export async function activationIncidents(db: D1Database) {
  const incidents: Array<{ kind: string; slug: string | null; detail: string; at: string | null }> = []
  const waiting = await db.prepare(`SELECT r.code, s.slug, r.created_at AS at FROM store_plan_requests r JOIN stores s ON s.id = r.store_id WHERE r.status = 'pendiente_pago' AND r.created_at <= datetime('now', '-48 hours')`).all<{ code: string; slug: string; at: string }>()
  for (const row of waiting.results || []) incidents.push({ kind: 'pago_sin_verificar', slug: row.slug, detail: `${row.code}: más de 48 horas esperando la verificación del pago`, at: iso(row.at) })
  const paidNotActive = await db.prepare(`SELECT r.code, s.slug FROM store_plan_requests r JOIN stores s ON s.id = r.store_id JOIN store_invoices i ON i.id = r.invoice_id WHERE r.status = 'pendiente_pago' AND i.status = 'pagada'`).all<{ code: string; slug: string }>()
  for (const row of paidNotActive.results || []) incidents.push({ kind: 'factura_pagada_sin_activar', slug: row.slug, detail: `${row.code}: la factura figura pagada pero el plan no se activó`, at: null })
  const mismatch = await db.prepare(`SELECT s.slug FROM store_trials t JOIN stores s ON s.id = t.store_id WHERE (t.status = 'activa' AND s.trial_ends_at IS NULL) OR (t.status = 'convertida' AND (s.trial_ends_at IS NOT NULL OR s.plan_code = 'prueba'))`).all<{ slug: string }>()
  for (const row of mismatch.results || []) incidents.push({ kind: 'estado_inconsistente', slug: row.slug, detail: 'El estado de la prueba y el de la tienda no coinciden', at: null })
  const failed = await db.prepare(
    `SELECT s.slug, e.purpose, COALESCE(e.delivery_status, e.status) AS state, e.created_at AS at FROM email_messages e JOIN stores s ON s.id = e.store_id
     WHERE e.purpose IN ('trial_signup', 'trial_welcome', 'trial_expiring', 'trial_ended', 'plan_requested', 'plan_activated')
       AND (e.status IN ('fallido', 'no_configurado') OR e.delivery_status IN ('rebotado', 'queja', 'fallido')) AND e.created_at >= datetime('now', '-30 days')
     ORDER BY e.id DESC LIMIT 50`,
  ).all<{ slug: string; purpose: string; state: string; at: string }>()
  for (const row of failed.results || []) incidents.push({ kind: 'correo_no_entregado', slug: row.slug, detail: `${row.purpose}: ${row.state}`, at: iso(row.at) })
  const unconfirmed = await db.prepare(`SELECT s.slug, t.created_at AS at FROM store_trials t JOIN stores s ON s.id = t.store_id WHERE t.status = 'pendiente' AND t.created_at <= datetime('now', '-72 hours') LIMIT 50`).all<{ slug: string; at: string }>()
  for (const row of unconfirmed.results || []) incidents.push({ kind: 'correo_sin_confirmar', slug: row.slug, detail: 'Registro sin confirmar después de 72 horas', at: iso(row.at) })
  return incidents
}

export { isTrialExpired }
