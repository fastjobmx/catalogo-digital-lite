/** From a mini-store trial to a real store. There is no online payment: the visitor (holder of the
 * private edit token) asks to activate it with a plan and contact details; the platform confirms the
 * plan through the usual commercial contact and converts it. The conversion reuses the normal store
 * creation (idempotent per trial), copies the design, logo, photos and products, and leaves the store
 * as a draft: publishing and orders start only when the platform activates it as for any other store.
 * The owner's account is the existing one (activation link of one use; opening it from the email
 * verifies the address). */
import type { Env } from '../index'
import { provisionStore, ProvisioningError } from './provisioning'
import { createCatalogProduct } from './business'
import { setStoreLogo } from './platform'
import { sendInvitation } from './userAccess'
import { emailConfig, isEmail } from '../email/send'
import { storeAssetPrefix } from '../lib/assets'
import { isTrialOwner, removeTrialAssets, TrialError, trialInternals } from './trials'
import { TRIAL_TO_STORE_TEMPLATE } from './trialSettings'

/** The plans shown on the commercial site (no prices are published) and the platform plan they map to. */
export const TRIAL_PLAN_CHOICES = {
  lite: { label: 'Catálogo Lite', planCode: 'basico' },
  ia: { label: 'Catálogo IA', planCode: 'profesional' },
  medida: { label: 'Soluciones a medida', planCode: 'premium' },
} as const
export type TrialPlanChoice = keyof typeof TRIAL_PLAN_CHOICES

const PENDING_RETENTION_DAYS = 14
const clean = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '')

type ConversionRow = {
  id: number; trial_id: string; code: string; plan_choice: TrialPlanChoice; contact_name: string; contact_email: string; contact_phone: string | null
  status: 'pendiente' | 'convertida' | 'descartada'; store_id: number | null; plan_code: string | null; result_json: string | null; handled_by: string | null; created_at: string; updated_at: string
}

const iso = (value: string | null) => (value ? `${value.replace(' ', 'T')}Z` : null)
const publicRequest = (row: ConversionRow) => ({
  code: row.code, status: row.status, planChoice: row.plan_choice, planLabel: TRIAL_PLAN_CHOICES[row.plan_choice]?.label || row.plan_choice,
  createdAt: iso(row.created_at),
})

function newCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  return `TIE-${[...bytes].map((byte) => alphabet[byte % alphabet.length]).join('')}`
}

async function ownerTrial(db: D1Database, id: string, token: string | undefined) {
  const row = await trialInternals.loadRow(db, id)
  if (!(await isTrialOwner(row, token))) throw new TrialError('TRIAL_FORBIDDEN', 'Solo quien creó la prueba puede pedir su activación', 401)
  return row
}

/** Owner: current activation request of this trial (or null). */
export async function getActivationRequest(db: D1Database, id: string, token: string | undefined) {
  const trial = await ownerTrial(db, id, token)
  const row = await db.prepare('SELECT * FROM trial_conversions WHERE trial_id = ?').bind(trial.id).first<ConversionRow>()
  return { request: row ? publicRequest(row) : null }
}

/** Owner: asks to activate the trial as a store. One request per trial (it can be corrected while pending).
 * Works while the trial is active and also after it expired, until its files are deleted. */
export async function requestActivation(db: D1Database, id: string, token: string | undefined, body: Record<string, unknown>) {
  const trial = await ownerTrial(db, id, token)
  const state = trialInternals.phase(trial)
  if (state === 'eliminada') throw new TrialError('TRIAL_GONE', 'Esta prueba ya se borró', 410)
  const existing = await db.prepare('SELECT * FROM trial_conversions WHERE trial_id = ?').bind(trial.id).first<ConversionRow>()
  if (existing?.status === 'convertida' || state === 'convertida') throw new TrialError('TRIAL_CONVERTED', 'Esta prueba ya se convirtió en una tienda', 409)
  const planChoice = String(body.planChoice || '') as TrialPlanChoice
  if (!(planChoice in TRIAL_PLAN_CHOICES)) throw new TrialError('INVALID_PLAN', 'Elige un plan')
  const name = clean(body.name, 120)
  if (name.length < 2) throw new TrialError('INVALID_CONTACT', 'Escribe tu nombre')
  const email = clean(body.email, 254).toLowerCase()
  if (!isEmail(email)) throw new TrialError('INVALID_CONTACT', 'Escribe un correo válido: allí recibirás el acceso a tu panel')
  const phoneRaw = clean(body.phone, 30).replace(/[\s().-]/g, '')
  if (phoneRaw && !/^\+[1-9]\d{7,14}$/.test(phoneRaw)) throw new TrialError('INVALID_CONTACT', 'Escribe el WhatsApp con el código del país, por ejemplo +57 300 000 0000')
  if (body.consent !== true) throw new TrialError('CONSENT_REQUIRED', 'Acepta que te contactemos para activar tu tienda')
  const phone = phoneRaw || null
  if (existing) {
    await db.prepare(`UPDATE trial_conversions SET plan_choice = ?, contact_name = ?, contact_email = ?, contact_phone = ?, status = 'pendiente', updated_at = datetime('now') WHERE id = ? AND status <> 'convertida'`)
      .bind(planChoice, name, email, phone, existing.id).run()
  } else {
    let created = false
    for (let attempt = 0; attempt < 5 && !created; attempt++) {
      const result = await db.prepare(`INSERT INTO trial_conversions (trial_id, code, plan_choice, contact_name, contact_email, contact_phone) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`)
        .bind(trial.id, newCode(), planChoice, name, email, phone).run()
      created = Number(result.meta.changes || 0) > 0
      if (!created && await db.prepare('SELECT 1 FROM trial_conversions WHERE trial_id = ?').bind(trial.id).first()) break // a parallel request won
    }
  }
  // A pending request keeps the trial (read-only) until the platform answers, even after it expires.
  await db.prepare(`UPDATE trial_sessions SET retain_until = MAX(COALESCE(retain_until, expires_at), datetime('now', '+${PENDING_RETENTION_DAYS} days')), updated_at = datetime('now') WHERE id = ?`).bind(trial.id).run()
  const row = await db.prepare('SELECT * FROM trial_conversions WHERE trial_id = ?').bind(trial.id).first<ConversionRow>()
  await db.prepare(`INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id) VALUES ('trial_activation_requested', 'trial', ?, ?, 'visitor', 'api', NULL)`)
    .bind(row!.code, JSON.stringify({ planChoice })).run()
  return { request: publicRequest(row!) }
}

/** Superadmin: real metrics from the trial rows (no estimates). */
export async function trialMetrics(db: D1Database) {
  const totals = await db.prepare(
    `SELECT COUNT(*) AS created,
            SUM(CASE WHEN created_at >= datetime('now', '-7 days') THEN 1 ELSE 0 END) AS last7,
            SUM(CASE WHEN status = 'activa' AND expires_at > datetime('now') THEN 1 ELSE 0 END) AS active,
            SUM(CASE WHEN status = 'activa' AND expires_at <= datetime('now') THEN 1 ELSE 0 END) AS expired,
            SUM(CASE WHEN status = 'eliminada' THEN 1 ELSE 0 END) AS deleted,
            SUM(CASE WHEN status = 'convertida' THEN 1 ELSE 0 END) AS converted,
            ROUND(AVG(product_count), 1) AS avgProducts,
            SUM(CASE WHEN product_count = 0 THEN 1 ELSE 0 END) AS withoutProducts
     FROM trial_sessions`,
  ).first<Record<string, number | null>>()
  const templates = await db.prepare('SELECT template, COUNT(*) AS n FROM trial_sessions GROUP BY template ORDER BY n DESC').all<{ template: string; n: number }>()
  const products = await db.prepare('SELECT product_count AS products, COUNT(*) AS n FROM trial_sessions GROUP BY product_count ORDER BY product_count').all<{ products: number; n: number }>()
  const orders = await db.prepare(`SELECT COUNT(*) AS n, COUNT(DISTINCT trial_id) AS trials, COALESCE(SUM(total), 0) AS amount FROM trial_orders`).first<{ n: number; trials: number; amount: number }>()
  const requests = await db.prepare(`SELECT status, COUNT(*) AS n FROM trial_conversions GROUP BY status`).all<{ status: string; n: number }>()
  const byStatus = Object.fromEntries((requests.results || []).map((row) => [row.status, Number(row.n)]))
  const created = Number(totals?.created || 0)
  const converted = Number(totals?.converted || 0)
  return {
    created, last7Days: Number(totals?.last7 || 0), active: Number(totals?.active || 0), expired: Number(totals?.expired || 0),
    deleted: Number(totals?.deleted || 0), converted, avgProducts: Number(totals?.avgProducts || 0), withoutProducts: Number(totals?.withoutProducts || 0),
    orders: { count: Number(orders?.n || 0), trialsWithOrders: Number(orders?.trials || 0), amount: Number(orders?.amount || 0) },
    conversionRate: created ? Math.round((converted / created) * 1000) / 10 : 0,
    templates: (templates.results || []).map((row) => ({ template: row.template, count: Number(row.n) })),
    productCounts: (products.results || []).map((row) => ({ products: Number(row.products), count: Number(row.n) })),
    requests: { pending: byStatus.pendiente || 0, converted: byStatus.convertida || 0, discarded: byStatus.descartada || 0, total: Object.values(byStatus).reduce((sum, n) => sum + n, 0) },
  }
}

/** Superadmin: activation requests with their trial (contact data is visible only to the platform). */
export async function listActivationRequests(db: D1Database, filter: { status?: string } = {}) {
  const status = ['pendiente', 'convertida', 'descartada'].includes(String(filter.status)) ? String(filter.status) : null
  const { results } = await db.prepare(
    `SELECT c.*, t.business_name AS businessName, t.template, t.product_count AS productCount, t.status AS trialStatus, t.expires_at AS expiresAt, t.retain_until AS retainUntil,
            s.slug AS storeSlug, s.name AS storeName, s.status AS storeStatus
     FROM trial_conversions c JOIN trial_sessions t ON t.id = c.trial_id LEFT JOIN stores s ON s.id = c.store_id
     ${status ? 'WHERE c.status = ?' : ''} ORDER BY CASE c.status WHEN 'pendiente' THEN 0 ELSE 1 END, c.created_at DESC LIMIT 200`,
  ).bind(...(status ? [status] : [])).all<ConversionRow & Record<string, unknown>>()
  return (results || []).map((row) => ({
    id: row.id, code: row.code, status: row.status, planChoice: row.plan_choice, planLabel: TRIAL_PLAN_CHOICES[row.plan_choice]?.label || row.plan_choice,
    suggestedPlanCode: TRIAL_PLAN_CHOICES[row.plan_choice]?.planCode || 'basico', planCode: row.plan_code,
    contact: { name: row.contact_name, email: row.contact_email, phone: row.contact_phone },
    trial: {
      id: row.trial_id, businessName: row.businessName, template: row.template, productCount: Number(row.productCount || 0), status: row.trialStatus,
      expiresAt: iso(row.expiresAt as string), deleteAfter: iso((row.retainUntil || row.expiresAt) as string),
    },
    store: row.store_id ? { id: row.store_id, slug: row.storeSlug, name: row.storeName, status: row.storeStatus } : null,
    result: row.result_json ? JSON.parse(row.result_json) : null,
    handledBy: row.handled_by, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
  }))
}

export class ConversionError extends Error {
  constructor(readonly code: string, message: string, readonly status: 400 | 404 | 409 = 400) { super(message) }
}

async function copyTrialImage(bucket: R2Bucket, trialId: string, url: string | null, storeId: number, folder: 'products' | 'store') {
  const file = url?.split('/').pop()
  if (!file || !/^[0-9a-f-]{36}\.(?:jpeg|png|webp)$/.test(file)) return null
  const object = await bucket.get(`trials/${trialId}/${file}`)
  if (!object) return null
  const bytes = new Uint8Array(await object.arrayBuffer())
  const contentType = object.httpMetadata?.contentType || `image/${file.split('.').pop()}`
  return { bytes, contentType, extension: file.split('.').pop()!, key: `${storeAssetPrefix(storeId)}${folder}/trial-${file}` }
}

/**
 * Superadmin: converts a trial into a draft store owned by the requester's email. Idempotent: the
 * store creation uses the key `trial-<id>`, products use fixed SKUs (PRUEBA-1…) that are skipped when
 * they already exist, and a converted request returns its stored result. One-time access links are
 * returned only by the run that creates them and are never stored.
 */
export async function convertTrial(db: D1Database, env: Env['Bindings'], conversionId: number, body: { planCode?: unknown }, actor: string) {
  const request = await db.prepare('SELECT * FROM trial_conversions WHERE id = ?').bind(conversionId).first<ConversionRow>()
  if (!request) throw new ConversionError('REQUEST_NOT_FOUND', 'La solicitud no existe', 404)
  if (request.status === 'convertida' && request.result_json) return { ...JSON.parse(request.result_json), replayed: true, activationUrl: null, telegramDeepLink: null }
  if (request.status === 'descartada') throw new ConversionError('REQUEST_DISCARDED', 'La solicitud fue descartada', 409)
  const trial = await trialInternals.loadRow(db, request.trial_id)
  const state = trialInternals.phase(trial)
  if (state === 'eliminada') throw new ConversionError('TRIAL_GONE', 'La prueba ya se borró: no hay datos que convertir', 409)
  if (!env.ASSETS) throw new ConversionError('STORAGE_UNAVAILABLE', 'El almacenamiento no está disponible', 409)
  const content = trialInternals.parseContent(trial.content_json)
  const planCode = typeof body.planCode === 'string' && body.planCode ? body.planCode : TRIAL_PLAN_CHOICES[request.plan_choice]?.planCode || 'basico'
  const template = TRIAL_TO_STORE_TEMPLATE[trialInternals.templateOf(trial.template)]

  let result
  try {
    result = await provisionStore(db, env, {
      name: trial.business_name, businessType: 'Tienda en línea', template: template as never,
      primaryColor: content.colors.primary, accentColor: content.colors.accent,
      ownerEmail: request.contact_email, ownerName: request.contact_name, planCode,
      ...((content.whatsapp || request.contact_phone) ? { whatsapp: (content.whatsapp || request.contact_phone)! } : {}),
    }, { requestKey: `trial-${trial.id}`, actor })
  } catch (error) {
    if (error instanceof ProvisioningError) throw new ConversionError(error.code, error.message, error.code === 'TELEGRAM_IN_USE' ? 409 : 400)
    throw error
  }
  if (result.status !== 'completed' || !result.storeId) throw new ConversionError('PROVISIONING_PENDING', 'La tienda todavía se está creando. Intenta de nuevo en un minuto.', 409)
  const storeId = result.storeId
  const context = { actor, source: 'admin' as const, storeId }

  // Logo (only if the new store has none) and products with their photos.
  if (content.logoUrl) {
    const logo = await copyTrialImage(env.ASSETS, trial.id, content.logoUrl, storeId, 'store')
    if (logo) await setStoreLogo(db, env.ASSETS, storeId, logo, actor, { replace: false })
  }
  const imported: string[] = []
  const skipped: Array<{ name: string; reason: string }> = []
  for (const [index, product] of content.products.entries()) {
    const sku = `PRUEBA-${index + 1}`
    if (product.price === null) { skipped.push({ name: product.name, reason: 'Sin precio' }); continue }
    if (await db.prepare('SELECT 1 FROM products WHERE store_id = ? AND sku = ?').bind(storeId, sku).first()) { imported.push(sku); continue }
    const image = await copyTrialImage(env.ASSETS, trial.id, product.imageUrl, storeId, 'products')
    if (image) await env.ASSETS.put(image.key, image.bytes, { httpMetadata: { contentType: image.contentType }, customMetadata: { storeId: String(storeId), source: 'trial' } })
    try {
      await createCatalogProduct(db, { sku, name: product.name, description: product.description, price: product.price, imageUrls: image ? [`/api/assets/${image.key}`] : [] }, context)
      imported.push(sku)
    } catch (error) {
      const code = error instanceof Error ? error.message : ''
      if (code === 'SKU_ALREADY_EXISTS') imported.push(sku)
      else skipped.push({ name: product.name, reason: code === 'PLAN_PRODUCT_LIMIT' ? 'Supera el límite de productos del plan' : 'No se pudo guardar' })
    }
  }

  // Owner access: by email when configured (opening it verifies the address); otherwise the one-time
  // link from the store creation is returned once, to send it privately to the requester.
  let delivery: 'email' | 'manual' | 'existing' = 'existing'
  let activationUrl = result.activationUrl ?? null
  if (activationUrl || !result.replayed) {
    const owner = await db.prepare(
      `SELECT u.id, u.email, u.display_name AS displayName, u.password_hash IS NOT NULL AS hasPassword FROM store_memberships m JOIN platform_users u ON u.id = m.user_id WHERE m.store_id = ? AND m.role = 'owner' AND m.status = 'active' LIMIT 1`,
    ).bind(storeId).first<{ id: number; email: string; displayName: string | null; hasPassword: number }>()
    if (owner && !owner.hasPassword) {
      if (emailConfig(env).configured) {
        const sent = await sendInvitation(db, env, { userId: owner.id, email: owner.email, displayName: owner.displayName || request.contact_name, storeId, slug: result.slug!, storeName: trial.business_name }, actor)
        delivery = sent.delivery
        activationUrl = sent.activationUrl
      } else {
        delivery = activationUrl ? 'manual' : 'existing'
      }
    }
  }

  const stored = {
    storeId, slug: result.slug, name: trial.business_name, storeStatus: 'draft', publicUrl: result.publicUrl, adminUrl: result.adminUrl,
    planCode, imported: imported.length, skipped, delivery,
  }
  await db.batch([
    db.prepare(`UPDATE trial_conversions SET status = 'convertida', store_id = ?, plan_code = ?, result_json = ?, handled_by = ?, updated_at = datetime('now') WHERE id = ?`)
      .bind(storeId, planCode, JSON.stringify(stored), actor, request.id),
    db.prepare(`UPDATE trial_sessions SET status = 'convertida', converted_store_id = ?, content_json = '{}', updated_at = datetime('now') WHERE id = ?`).bind(storeId, trial.id),
    db.prepare('DELETE FROM trial_orders WHERE trial_id = ?').bind(trial.id),
    db.prepare(`INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id) VALUES ('trial_converted', 'trial', ?, ?, ?, 'platform', ?)`)
      .bind(request.code, JSON.stringify({ imported: imported.length, skipped: skipped.length, planCode }), actor, storeId),
  ])
  // The photos now live in the store: the temporary copies are deleted.
  await removeTrialAssets(env.ASSETS, trial.id)
  return { ...stored, replayed: false, activationUrl: delivery === 'manual' ? activationUrl : null, telegramDeepLink: result.telegramDeepLink ?? null }
}

/** Superadmin: closes a request without converting (the trial follows its normal expiry). */
export async function discardActivationRequest(db: D1Database, conversionId: number, actor: string) {
  const row = await db.prepare(`UPDATE trial_conversions SET status = 'descartada', handled_by = ?, updated_at = datetime('now') WHERE id = ? AND status = 'pendiente' RETURNING trial_id, code`).bind(actor, conversionId).first<{ trial_id: string; code: string }>()
  if (!row) throw new ConversionError('REQUEST_NOT_PENDING', 'La solicitud no está pendiente', 409)
  await db.prepare(`UPDATE trial_sessions SET retain_until = MIN(COALESCE(retain_until, expires_at), MAX(expires_at, datetime('now', '+1 day'))) WHERE id = ? AND status = 'activa'`).bind(row.trial_id).run()
  await db.prepare(`INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id) VALUES ('trial_request_discarded', 'trial', ?, '{}', ?, 'platform', NULL)`).bind(row.code, actor).run()
  return { discarded: true }
}
