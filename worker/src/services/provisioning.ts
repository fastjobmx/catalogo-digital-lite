import { z } from 'zod'
import type { Env } from '../index'
import { getStoreBySlug, isValidSlug, publicStoreUrl, adminStoreUrl, slugify } from '../tenancy/stores'
import { buildTheme, businessProfile, TEMPLATE_KEYS, templatePalette, type TemplateKey } from './templates'
import { createAccessToken, ensureUser, normalizeEmail, upsertMembership } from './platformUsers'
import { isSuperadminEmail } from './auth'

export const provisionInputSchema = z.object({
  name: z.string().trim().min(2).max(80),
  slug: z.string().trim().toLowerCase().optional(),
  businessType: z.string().trim().min(2).max(120),
  template: z.enum(TEMPLATE_KEYS).default('moderno'),
  primaryColor: z.string().trim().regex(/^#?[0-9a-fA-F]{6}$/).optional(),
  accentColor: z.string().trim().regex(/^#?[0-9a-fA-F]{6}$/).optional(),
  description: z.string().trim().max(300).optional(),
  whatsapp: z.string().trim().max(20).optional().refine((value) => !value || /^\+[1-9]\d{7,14}$/.test(value.replace(/[\s().-]/g, '')), 'WhatsApp debe incluir +código de país'),
  ownerName: z.string().trim().max(120).optional(),
  ownerEmail: z.string().trim().max(254).optional(),
  ownerTelegramId: z.string().trim().regex(/^\d{4,15}$/).optional(),
  planCode: z.string().trim().max(40).default('basico'),
  currency: z.string().trim().regex(/^[A-Z]{3}$/).default('COP'),
  country: z.string().trim().regex(/^[A-Z]{2}$/).default('CO'),
})
export type ProvisionInput = z.input<typeof provisionInputSchema>

export type ProvisionStep = { key: string; label: string; status: 'ok' | 'error' | 'skipped'; detail?: string }

export type ProvisionResult = {
  jobId: string
  status: 'completed' | 'failed' | 'running'
  storeId?: number
  slug?: string
  name?: string
  storeStatus?: string
  publicUrl?: string
  adminUrl?: string
  /** One-time secrets: returned only by the run that created them, never stored in clear. */
  activationUrl?: string | null
  telegramLinkCode?: string | null
  telegramDeepLink?: string | null
  steps: ProvisionStep[]
  errorCode?: string
  replayed?: boolean
}

const STEP_LABELS: Record<string, string> = {
  validate: 'Validar datos',
  reserve: 'Generar identificador único',
  store: 'Crear registro de la tienda',
  config: 'Configuración independiente',
  template: 'Aplicar plantilla e identidad visual',
  categories: 'Categorías iniciales',
  plan: 'Plan, servicios y límite de IA',
  owner: 'Registrar propietario',
  access: 'Acceso administrativo y Telegram',
  verify: 'Verificar funcionamiento',
}

export class ProvisioningError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
  }
}

/** Proposes an available slug from a commercial name. */
export async function suggestSlug(db: D1Database, name: string): Promise<string> {
  const base = slugify(name) || 'tienda'
  const root = isValidSlug(base) ? base : `tienda-${base}`.slice(0, 40).replace(/-+$/, '')
  for (let index = 0; index < 20; index++) {
    const candidate = index === 0 ? root : `${root.slice(0, 36)}-${index + 1}`
    if (isValidSlug(candidate) && !await getStoreBySlug(db, candidate)) return candidate
  }
  return `${root.slice(0, 30)}-${crypto.randomUUID().slice(0, 6)}`
}

type JobRow = { id: string; status: string; store_id: number | null; slug: string; steps_json: string; result_json: string | null; error_code: string | null; attempts: number; input_json: string; updated_at: string }

/**
 * Creates a store inside the shared multi-tenant platform. The request key makes
 * the process idempotent: retrying with the same key resumes the same job and
 * never creates a second store. A store is reported as created only after the
 * verification step passes.
 */
export async function provisionStore(
  db: D1Database,
  env: Partial<Env['Bindings']>,
  rawInput: ProvisionInput,
  options: { requestKey: string; actor: string },
): Promise<ProvisionResult> {
  if (!/^[\w.:-]{8,120}$/.test(options.requestKey)) throw new ProvisioningError('INVALID_REQUEST_KEY', 'La clave de la solicitud no es válida.')
  const parsed = provisionInputSchema.safeParse(rawInput)
  if (!parsed.success) throw new ProvisioningError('INVALID_INPUT', parsed.error.issues.map((issue) => issue.message).join(', '))
  const input = parsed.data
  const ownerEmail = input.ownerEmail ? normalizeEmail(input.ownerEmail) : null
  if (input.ownerEmail && !ownerEmail) throw new ProvisioningError('INVALID_OWNER_EMAIL', 'El correo del propietario no es válido.')
  if (ownerEmail && isSuperadminEmail(ownerEmail, env as Env['Bindings'])) throw new ProvisioningError('RESERVED_EMAIL', 'Ese correo está reservado para la administración de la plataforma.')
  if (!ownerEmail && !input.ownerTelegramId) throw new ProvisioningError('OWNER_REQUIRED', 'Indica el correo o el ID de Telegram del propietario.')
  const plan = await db.prepare('SELECT code, name, ai_monthly_budget_micros, setup_price, monthly_price, currency, features_json FROM plans WHERE code = ? AND is_active = 1')
    .bind(input.planCode).first<{ code: string; name: string; ai_monthly_budget_micros: number; setup_price: number; monthly_price: number; currency: string; features_json: string }>()
  if (!plan) throw new ProvisioningError('PLAN_NOT_FOUND', 'El plan indicado no existe.')

  // 1. Reserve the job (idempotency anchor).
  let job = await db.prepare('SELECT * FROM provisioning_jobs WHERE request_key = ?').bind(options.requestKey).first<JobRow>()
  if (job?.status === 'completed' && job.result_json) {
    return { ...JSON.parse(job.result_json) as ProvisionResult, replayed: true, activationUrl: null, telegramLinkCode: null, telegramDeepLink: null }
  }
  if (job?.status === 'running' && Date.now() - Date.parse(`${job.updated_at.replace(' ', 'T')}Z`) < 60_000) {
    return { jobId: job.id, status: 'running', steps: JSON.parse(job.steps_json) as ProvisionStep[] }
  }
  const slug = job?.slug || (input.slug ? input.slug : await suggestSlug(db, input.name))
  if (!isValidSlug(slug)) throw new ProvisioningError('INVALID_SLUG', 'La dirección de la tienda solo puede tener letras minúsculas, números y guiones (3 a 40).')
  if (!job) {
    const jobId = crypto.randomUUID()
    try {
      await db.prepare(
        `INSERT INTO provisioning_jobs (id, request_key, slug, status, current_step, input_json, created_by, attempts) VALUES (?, ?, ?, 'running', 'reserve', ?, ?, 1)`,
      ).bind(jobId, options.requestKey, slug, JSON.stringify({ ...input, ownerEmail }), options.actor).run()
    } catch (error) {
      if (error instanceof Error && /unique constraint/i.test(error.message)) return provisionStore(db, env, rawInput, options)
      throw error
    }
    job = await db.prepare('SELECT * FROM provisioning_jobs WHERE id = ?').bind(jobId).first<JobRow>()
  } else {
    await db.prepare(`UPDATE provisioning_jobs SET status = 'running', attempts = attempts + 1, error_code = NULL, updated_at = datetime('now') WHERE id = ?`).bind(job.id).run()
  }
  const jobId = job!.id
  const steps: ProvisionStep[] = []
  const mark = async (key: string, status: ProvisionStep['status'], detail?: string) => {
    steps.push({ key, label: STEP_LABELS[key] || key, status, ...(detail ? { detail } : {}) })
    await db.prepare(`UPDATE provisioning_jobs SET current_step = ?, steps_json = ?, updated_at = datetime('now') WHERE id = ?`).bind(key, JSON.stringify(steps), jobId).run()
  }

  let storeId = job!.store_id ?? null
  try {
    await mark('validate', 'ok')
    // 2. Store registry row. The unique slug prevents duplicate stores.
    if (!storeId) {
      const existing = await getStoreBySlug(db, slug)
      if (existing) throw new ProvisioningError('SLUG_TAKEN', `La dirección “${slug}” ya está en uso.`)
      await db.batch([
        db.prepare(
          `INSERT INTO stores (slug, name, status, plan_code, template, business_type, ai_enabled, ai_monthly_budget_micros, created_by)
           VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?)`,
        ).bind(slug, input.name, plan.code, input.template, input.businessType, plan.ai_monthly_budget_micros > 0 ? 1 : 0, plan.ai_monthly_budget_micros, options.actor),
        db.prepare(`UPDATE provisioning_jobs SET store_id = (SELECT id FROM stores WHERE slug = ?), updated_at = datetime('now') WHERE id = ?`).bind(slug, jobId),
      ])
      storeId = (await db.prepare('SELECT store_id FROM provisioning_jobs WHERE id = ?').bind(jobId).first<{ store_id: number }>())!.store_id
    }
    await mark('reserve', 'ok', slug)
    await mark('store', 'ok', `#${storeId}`)

    // 3–4. Independent configuration with the selected template.
    const palette = templatePalette(input.template as TemplateKey, input.primaryColor, input.accentColor)
    const theme = buildTheme({ template: input.template as TemplateKey, name: input.name, businessType: input.businessType, description: input.description, primaryColor: input.primaryColor, accentColor: input.accentColor })
    const whatsapp = input.whatsapp ? input.whatsapp.replace(/[\s().-]/g, '') : ''
    await db.prepare(
      `INSERT OR IGNORE INTO store_config (id, name, description, business_type, primary_color, secondary_color, accent_color, button_color,
         whatsapp_phone, whatsapp_orders, currency, country, theme_config, default_whatsapp_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(storeId, input.name, input.description || '', input.businessType, palette.primary, palette.secondary, palette.accent, palette.button,
      whatsapp, whatsapp || null, input.currency, input.country, JSON.stringify(theme), `¡Hola ${input.name}! Quiero hacer un pedido:`).run()
    await mark('config', 'ok')
    await mark('template', 'ok', input.template)

    // 5. Starter categories (unique per store, so retries do not duplicate them).
    const profile = businessProfile(input.businessType)
    await db.batch(profile.categories.map((name, index) => db.prepare(
      'INSERT OR IGNORE INTO categories (store_id, name, slug, sort_order) VALUES (?, ?, ?, ?)',
    ).bind(storeId, name, slugify(name), index)))
    await mark('categories', 'ok', profile.categories.join(', '))

    // 6. Plan services (no real charges are created).
    const features = JSON.parse(plan.features_json || '[]') as string[]
    const services: Array<[string, string, number]> = [['instalacion', 'unico', plan.setup_price]]
    if (plan.monthly_price > 0) services.push(['mantenimiento_mensual', 'mensual', plan.monthly_price])
    if (features.includes('asistente_ia')) services.push(['asistente_ia', 'mensual', 0])
    for (const [code, billing, price] of services) {
      await db.prepare(
        `INSERT INTO store_services (store_id, service_code, billing, price, currency, status, created_by)
         SELECT ?, ?, ?, ?, ?, 'pendiente', ? WHERE NOT EXISTS (SELECT 1 FROM store_services WHERE store_id = ? AND service_code = ?)`,
      ).bind(storeId, code, billing, price, plan.currency, options.actor, storeId, code).run()
    }
    await mark('plan', 'ok', `${plan.name} · IA ${plan.ai_monthly_budget_micros > 0 ? 'activa' : 'no incluida'}`)

    // 7. Owner and role.
    const ownerId = await ensureUser(db, { email: ownerEmail, displayName: input.ownerName, createdBy: options.actor })
    if (input.ownerTelegramId) {
      const other = await db.prepare('SELECT id FROM platform_users WHERE telegram_user_id = ? AND id <> ?').bind(input.ownerTelegramId, ownerId).first()
      if (other) throw new ProvisioningError('TELEGRAM_IN_USE', 'Ese Telegram ya está vinculado a otro usuario.')
      await db.prepare(`UPDATE platform_users SET telegram_user_id = ?, status = 'active', updated_at = datetime('now') WHERE id = ?`).bind(input.ownerTelegramId, ownerId).run()
    }
    await upsertMembership(db, { storeId: storeId!, userId: ownerId, role: 'owner', createdBy: options.actor })
    await mark('owner', 'ok', ownerEmail || `Telegram ${input.ownerTelegramId}`)

    // 8. One-time access: activation link (web) and Telegram link code.
    const store = { id: storeId!, slug }
    const ownerRow = await db.prepare('SELECT password_hash, telegram_user_id FROM platform_users WHERE id = ?').bind(ownerId).first<{ password_hash: string | null; telegram_user_id: string | null }>()
    let activationUrl: string | null = null
    if (ownerEmail && !ownerRow?.password_hash) {
      const token = await createAccessToken(db, { userId: ownerId, storeId: storeId!, purpose: 'activation', ttlSeconds: 72 * 3600, createdBy: options.actor })
      activationUrl = `${adminStoreUrl(env.PUBLIC_STORE_BASE_URL, store)}/activar?token=${encodeURIComponent(token)}`
    }
    let telegramLinkCode: string | null = null
    if (!ownerRow?.telegram_user_id) {
      telegramLinkCode = await createAccessToken(db, { userId: ownerId, storeId: storeId!, purpose: 'telegram_link', ttlSeconds: 72 * 3600, createdBy: options.actor })
    }
    const username = env.TELEGRAM_BOT_USERNAME?.replace(/^@/, '')
    const telegramDeepLink = telegramLinkCode && username ? `https://t.me/${username}?start=link_${telegramLinkCode.replaceAll('-', '')}` : null
    await mark('access', 'ok', [activationUrl ? 'enlace de activación' : null, telegramLinkCode ? 'código de Telegram' : 'Telegram ya vinculado'].filter(Boolean).join(' · '))

    // 9. Verification: the store must resolve and expose its own empty catalog.
    const checks = await verifyStore(db, storeId!)
    const failed = checks.filter((check) => !check.ok && check.key !== 'whatsapp')
    if (failed.length) throw new ProvisioningError('VERIFICATION_FAILED', `Falló la verificación: ${failed.map((check) => check.label).join(', ')}`)
    await mark('verify', 'ok', checks.map((check) => check.label).join(' · '))

    const result: ProvisionResult = {
      jobId, status: 'completed', storeId: storeId!, slug, name: input.name, storeStatus: 'draft',
      publicUrl: publicStoreUrl(env.PUBLIC_STORE_BASE_URL, store), adminUrl: adminStoreUrl(env.PUBLIC_STORE_BASE_URL, store), steps,
    }
    await db.batch([
      db.prepare(`UPDATE provisioning_jobs SET status = 'completed', result_json = ?, steps_json = ?, completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
        .bind(JSON.stringify(result), JSON.stringify(steps), jobId),
      db.prepare(`INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id) VALUES ('store_provisioned', 'store', ?, ?, ?, 'platform', ?)`)
        .bind(String(storeId), JSON.stringify({ jobId, slug, template: input.template, plan: plan.code }), options.actor, storeId),
      db.prepare(`INSERT INTO platform_events (store_id, level, source, code, detail) VALUES (?, 'info', 'provisioning', 'STORE_PROVISIONED', ?)`).bind(storeId, slug),
    ])
    return { ...result, activationUrl, telegramLinkCode, telegramDeepLink }
  } catch (error) {
    const code = error instanceof ProvisioningError ? error.code : 'UNEXPECTED_ERROR'
    const lastKey = Object.keys(STEP_LABELS).find((key) => !steps.some((step) => step.key === key)) || 'verify'
    steps.push({ key: lastKey, label: STEP_LABELS[lastKey] || lastKey, status: 'error', detail: error instanceof ProvisioningError ? error.message : 'Error interno registrado' })
    console.error('Store provisioning failed:', code, error instanceof Error ? error.message : 'unknown')
    await db.batch([
      db.prepare(`UPDATE provisioning_jobs SET status = 'failed', error_code = ?, steps_json = ?, updated_at = datetime('now') WHERE id = ?`).bind(code, JSON.stringify(steps), jobId),
      db.prepare(`INSERT INTO platform_events (store_id, level, source, code, detail) VALUES (?, 'error', 'provisioning', ?, ?)`).bind(storeId, code, `${slug}: ${error instanceof Error ? error.message.slice(0, 180) : 'unknown'}`),
    ])
    if (error instanceof ProvisioningError) return { jobId, status: 'failed', storeId: storeId ?? undefined, slug, steps, errorCode: code }
    throw error
  }
}

export type HealthCheck = { key: string; label: string; ok: boolean; detail?: string }

/** Checks that a store is reachable and internally consistent. */
export async function verifyStore(db: D1Database, storeId: number): Promise<HealthCheck[]> {
  const store = await db.prepare('SELECT id, slug, status FROM stores WHERE id = ?').bind(storeId).first<{ id: number; slug: string; status: string }>()
  const config = await db.prepare('SELECT name, whatsapp_phone, theme_config FROM store_config WHERE id = ?').bind(storeId).first<{ name: string; whatsapp_phone: string; theme_config: string }>()
  const resolved = store ? await getStoreBySlug(db, store.slug) : null
  const categories = await db.prepare('SELECT COUNT(*) AS n FROM categories WHERE store_id = ? AND is_active = 1').bind(storeId).first<{ n: number }>()
  const owners = await db.prepare(`SELECT COUNT(*) AS n FROM store_memberships WHERE store_id = ? AND role = 'owner' AND status = 'active'`).bind(storeId).first<{ n: number }>()
  const foreign = await db.prepare(
    `SELECT COUNT(*) AS n FROM products p JOIN categories c ON c.id = p.category_id WHERE (p.store_id = ? OR c.store_id = ?) AND p.store_id <> c.store_id`,
  ).bind(storeId, storeId).first<{ n: number }>()
  let themeOk = false
  try { themeOk = Boolean(config?.theme_config && typeof JSON.parse(config.theme_config) === 'object') } catch { themeOk = false }
  return [
    { key: 'registry', label: 'Registro y dirección', ok: Boolean(store && resolved?.id === storeId), detail: store?.slug },
    { key: 'config', label: 'Configuración', ok: Boolean(config?.name) },
    { key: 'theme', label: 'Plantilla visual', ok: themeOk },
    { key: 'categories', label: 'Categorías', ok: Number(categories?.n || 0) > 0, detail: String(categories?.n || 0) },
    { key: 'owner', label: 'Propietario', ok: Number(owners?.n || 0) > 0 },
    { key: 'isolation', label: 'Aislamiento de datos', ok: Number(foreign?.n || 0) === 0 },
    { key: 'whatsapp', label: 'WhatsApp de pedidos', ok: Boolean(config?.whatsapp_phone), detail: config?.whatsapp_phone ? 'configurado' : 'pendiente' },
  ]
}
