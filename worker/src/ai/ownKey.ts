/** A store's own Gemini API key ("Mi API").
 *
 * - Stored only encrypted: AES-256-GCM (WebCrypto), random 96-bit IV, additional data «store:<id>|gemini|v<n>», so a
 *   row copied to another store cannot be decrypted. The master key is the Worker secret AI_KEYS_MASTER_KEY (32 bytes,
 *   base64), never in the database. Rotation: AI_KEYS_MASTER_KEY_V<n> + AI_KEYS_MASTER_KEY_VERSION.
 * - Never returned to the browser after saving: the API answers only a hint («AIza…AB12») and the state.
 * - Validated without spending tokens: listing the models available to that key.
 * - Used only for the store that owns it, only for the uses its owner enabled, and never replaced silently by the
 *   platform key: if it fails, the platform key is used only when the owner switched that on.
 * - Logs and events carry codes, never the key.
 */
import type { Env } from '../index'
import { geminiModel } from './geminiClient'
import { studioModel } from './imageStudio'
import { BUYER_DATA_FEATURES } from './privacy'

type Bindings = Partial<Env['Bindings']>

export type OwnKeyUse = 'assistant' | 'studio'
export type OwnKeyStatus = 'activa' | 'invalida' | 'sin_cuota' | 'sin_permiso'

export class OwnKeyError extends Error {
  constructor(readonly code: string, message: string, readonly status: 400 | 403 | 404 | 409 | 502 | 503 = 400) { super(message) }
}

/** Studio / Factory operations; everything else is the assistant. */
const STUDIO_FEATURES = new Set(['estudio_imagen', 'foto_packshot', 'foto_premium', 'video_ia_segundo', 'creativo_texto', 'prueba_mejora_foto'])
export const useFor = (feature: string, kind: 'text' | 'image' | 'video' = 'text'): OwnKeyUse => kind !== 'text' || STUDIO_FEATURES.has(feature) ? 'studio' : 'assistant'

const KEY_SHAPE = /^[A-Za-z0-9_-]{30,80}$/
export const hintOf = (key: string) => `${key.slice(0, 4)}…${key.slice(-4)}`

// ---- encryption ------------------------------------------------------------------

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
const unb64 = (text: string) => Uint8Array.from(atob(text), (char) => char.charCodeAt(0))

function masterSecret(env: Bindings, version: number): string | null {
  const record = env as Record<string, unknown>
  const value = version === 1 ? record.AI_KEYS_MASTER_KEY : record[`AI_KEYS_MASTER_KEY_V${version}`]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function currentKeyVersion(env: Bindings): number {
  const version = Number((env as Record<string, unknown>).AI_KEYS_MASTER_KEY_VERSION || 1)
  return Number.isInteger(version) && version >= 1 ? version : 1
}

export const vaultAvailable = (env: Bindings) => Boolean(masterSecret(env, currentKeyVersion(env)))

async function masterKey(env: Bindings, version: number): Promise<CryptoKey> {
  const secret = masterSecret(env, version)
  if (!secret) throw new OwnKeyError('VAULT_UNAVAILABLE', 'La conexión de API propia no está habilitada en esta plataforma.', 503)
  let raw: Uint8Array
  try { raw = unb64(secret) } catch { raw = new Uint8Array() }
  if (raw.length !== 32) throw new OwnKeyError('VAULT_MISCONFIGURED', 'La conexión de API propia no está habilitada en esta plataforma.', 503)
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

const aad = (storeId: number, version: number, purpose = 'gemini') => new TextEncoder().encode(`store:${storeId}|${purpose}|v${version}`)

export async function encryptApiKey(env: Bindings, storeId: number, apiKey: string): Promise<{ ciphertext: string; iv: string; version: number }> {
  const version = currentKeyVersion(env)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(storeId, version) }, await masterKey(env, version), new TextEncoder().encode(apiKey))
  return { ciphertext: b64(new Uint8Array(sealed)), iv: b64(iv), version }
}

export async function decryptApiKey(env: Bindings, storeId: number, row: { ciphertext: string; iv: string; key_version: number }): Promise<string> {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(row.iv), additionalData: aad(storeId, row.key_version) }, await masterKey(env, row.key_version), unb64(row.ciphertext))
  return new TextDecoder().decode(plain)
}

/** Same vault for other per-store secrets (e.g. a payment gateway key). The purpose is bound into the additional
 * data, so a ciphertext saved for one purpose or store can never be opened as another. */
export async function encryptStoreSecret(env: Bindings, storeId: number, purpose: string, value: string): Promise<{ ciphertext: string; iv: string; version: number }> {
  const version = currentKeyVersion(env)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(storeId, version, purpose) }, await masterKey(env, version), new TextEncoder().encode(value))
  return { ciphertext: b64(new Uint8Array(sealed)), iv: b64(iv), version }
}

export async function decryptStoreSecret(env: Bindings, storeId: number, purpose: string, row: { ciphertext: string; iv: string; key_version: number }): Promise<string> {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(row.iv), additionalData: aad(storeId, row.key_version, purpose) }, await masterKey(env, row.key_version), unb64(row.ciphertext))
  return new TextDecoder().decode(plain)
}

// ---- validation --------------------------------------------------------------------

export type Validation = { status: OwnKeyStatus; modelsOk: string[]; errorCode: string | null; imageListed?: boolean }

/** Lists the models the key can use (free: no tokens). Needs the text model for the assistant and the image model
 * for the studio. Throws only when Google itself is unavailable (nothing is saved then). */
export async function validateGeminiKey(env: Bindings, fetcher: typeof fetch, apiKey: string, uses: { assistant: boolean; studio: boolean }): Promise<Validation> {
  let response: Response
  try {
    response = await fetcher('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', { headers: { 'x-goog-api-key': apiKey } })
  } catch {
    throw new OwnKeyError('PROVIDER_UNAVAILABLE', 'No pudimos comunicarnos con Google para validar la clave. Inténtalo en unos minutos.', 502)
  }
  if (!response.ok) {
    const status = statusFromHttp(response.status, await response.text().catch(() => ''))
    if (!status) throw new OwnKeyError('PROVIDER_UNAVAILABLE', 'Google no respondió bien al validar la clave. Inténtalo en unos minutos.', 502)
    return { status, modelsOk: [], errorCode: `HTTP_${response.status}` }
  }
  const body = await response.json().catch(() => ({})) as { models?: Array<{ name?: string }> }
  const available = new Set((body.models || []).map((model) => String(model.name || '').replace(/^models\//, '')))
  const needed = [...(uses.assistant ? [geminiModel(env)] : []), ...(uses.studio && studioModel(env) ? [studioModel(env)!] : [])]
  const modelsOk = needed.filter((model) => available.has(model))
  const imageListed = Boolean(studioModel(env) && available.has(studioModel(env)!))
  if (modelsOk.length < needed.length) return { status: 'sin_permiso', modelsOk, errorCode: 'MODEL_NOT_AVAILABLE', imageListed }
  // Optional: the assistant's light model (ASSISTANT_FAST_MODEL). Recorded when the key can use it, never required.
  const fast = uses.assistant ? fastAssistantModel(env) : null
  if (fast && available.has(fast) && !modelsOk.includes(fast)) modelsOk.push(fast)
  return { status: 'activa', modelsOk, errorCode: null, imageListed }
}

/** The assistant's light model for short classifications, when the platform configured one. */
export function fastAssistantModel(env: Bindings): string | null {
  const model = String((env as Record<string, unknown>).ASSISTANT_FAST_MODEL || '').replace(/[^a-zA-Z0-9._-]/g, '')
  return model || null
}

/** True when the store pays the assistant with its own key but that key was never verified for `model`. A call with
 * that model would then go out on the platform key (billed to the plan) behind the owner's back, so callers that
 * have an alternative (the planner's fast path) must skip it. */
export async function ownKeyMissesModel(db: D1Database, env: Bindings, storeId: number, use: OwnKeyUse, model: string): Promise<boolean> {
  if (!vaultAvailable(env)) return false
  try {
    const row = await db.prepare('SELECT use_assistant, use_studio, models_ok FROM store_ai_keys WHERE store_id = ?').bind(storeId)
      .first<{ use_assistant: number; use_studio: number; models_ok: string }>()
    if (!row || !(use === 'assistant' ? row.use_assistant : row.use_studio)) return false
    return !(JSON.parse(row.models_ok || '[]') as string[]).includes(model)
  } catch {
    // Unknown: skip the optional path rather than risk billing the plan for a store that pays with its own key.
    return true
  }
}

/** Key state from an HTTP error of Google, or null when it is a service problem (not the key's fault). */
export function statusFromHttp(status: number, body: string): OwnKeyStatus | null {
  if (status === 429) return 'sin_cuota'
  if (status === 401 || (status === 400 && /API_KEY_INVALID|API key not valid|INVALID_ARGUMENT/i.test(body))) return 'invalida'
  if (status === 403) return /billing|BILLING/i.test(body) ? 'sin_cuota' : 'sin_permiso'
  return null
}

/** Google offers no documented way to verify a project's tier with only an API key (models.list and the error
 * replies do not report it; the tier is shown in Google AI Studio → Projects → «Billing Tier»). So the tier is never
 * inferred: the owner confirms the free tier, or the platform verifies billing from evidence and records who and when. */
export type OwnKeyTier = 'no_verificada' | 'gratuita_confirmada' | 'facturacion_verificada'
export type ImageCapability = 'sin_verificar' | 'disponible' | 'no_disponible'
export type BuyerDataPolicy = 'preguntar' | 'plan' | 'bloquear'
export const TIER_LABELS: Record<OwnKeyTier, string> = {
  no_verificada: 'No verificada',
  gratuita_confirmada: 'Gratuita (confirmada por el propietario)',
  facturacion_verificada: 'Facturación verificada por TiendIA',
}
/** Observations from real calls. They are shown as hints and never change the tier. */
export const SIGNAL_LABELS: Record<string, string> = {
  imagen_generada: 'Generó una imagen (las imágenes no tienen nivel gratuito; es un indicio, no una verificación)',
  limite_gratuito_observado: 'Google respondió con un límite que menciona el nivel gratuito (indicio, no verificación)',
  pago_requerido: 'Google respondió «pago requerido» (saldo prepago agotado o sin facturación)',
}
export const AI_STUDIO_TIER_STEPS = [
  'Entra a aistudio.google.com con la cuenta dueña de la clave.',
  'Abre «Projects» (Proyectos) en el menú.',
  'Busca el proyecto de tu clave y mira la columna «Billing Tier»: «Free» = gratuito; «Tier 1» o superior = con facturación.',
  'También puedes ver el saldo en «Billing» y los límites en «Rate limit».',
]

/** What Google said when it refused or limited a call, in plain terms (never the key). */
export type ProviderErrorDetail = { http: number; status: string | null; quotaMetric: string | null; quotaValue: string | null; retryAfter: string | null; freeTier: boolean }

export function parseProviderError(http: number, body: string): ProviderErrorDetail {
  let parsed: { error?: { status?: string; details?: Array<{ violations?: Array<{ quotaMetric?: string; quotaValue?: string }>; retryDelay?: string }> } } = {}
  try { parsed = JSON.parse(body) } catch { parsed = {} }
  const details = parsed.error?.details || []
  const violation = details.flatMap((detail) => detail.violations || [])[0]
  const metric = violation?.quotaMetric ? String(violation.quotaMetric).split('/').pop()!.slice(0, 80) : null
  return {
    http,
    status: parsed.error?.status ? String(parsed.error.status).slice(0, 40) : null,
    quotaMetric: metric,
    quotaValue: violation?.quotaValue ? String(violation.quotaValue).slice(0, 20) : null,
    retryAfter: details.find((detail) => detail.retryDelay)?.retryDelay?.slice(0, 20) ?? null,
    // Undocumented by Google: only used as a hint to word the message, never as a tier verification.
    freeTier: /free_tier/i.test(body),
  }
}

/** «Límite gratuito de solicitudes por minuto (15). Reintentar en 37s» */
export function describeProviderError(detail: ProviderErrorDetail | null): string | null {
  if (!detail) return null
  const metric = detail.quotaMetric || ''
  const what = /per_day|PerDay/i.test(metric) ? 'por día' : /per_minute|PerMinute/i.test(metric) ? 'por minuto' : ''
  const kind = /token/i.test(metric) ? 'tokens' : 'solicitudes'
  if (detail.http === 429) {
    const base = `Límite de cuota de Google (${kind}${what ? ` ${what}` : ''}${detail.freeTier ? ', el mensaje menciona el nivel gratuito' : ''})`
    return `${base}${detail.quotaValue ? `: ${detail.quotaValue}` : ''}${detail.retryAfter ? `. Google sugiere esperar ${detail.retryAfter}` : ''}.`
  }
  if (detail.http === 401 || detail.http === 400) return 'Google rechazó la clave (inválida o revocada).'
  if (detail.http === 402) return 'Google respondió «pago requerido»: el saldo prepago se agotó o el proyecto no tiene facturación.'
  if (detail.http === 403) return 'Google negó el acceso (permisos del proyecto o facturación).'
  return `Google respondió con el código ${detail.http}${detail.status ? ` (${detail.status})` : ''}.`
}

export const STATUS_LABELS: Record<OwnKeyStatus, string> = {
  activa: 'activa',
  invalida: 'clave inválida o revocada',
  sin_cuota: 'sin cuota o sin facturación activa',
  sin_permiso: 'sin acceso a los modelos que usa TiendIA',
}

// ---- storage -----------------------------------------------------------------------

type Row = {
  store_id: number; ciphertext: string; iv: string; key_version: number; hint: string; use_assistant: number; use_studio: number
  status: OwnKeyStatus; models_ok: string; fallback_to_platform: number; validated_at: string | null; last_error_code: string | null
  last_used_at: string | null; created_at: string; updated_at: string
  tier: OwnKeyTier; image_capability: ImageCapability; last_error_detail: string | null
  billing_declared_at: string | null; tier_verified_by: string | null; tier_verified_at: string | null; tier_note: string | null
  signals: string; buyer_data_policy: BuyerDataPolicy
}

async function event(db: D1Database, storeId: number, action: string, result: string, errorCode: string | null, actor: string) {
  await db.prepare('INSERT INTO store_ai_key_events (store_id, action, result, error_code, actor) VALUES (?, ?, ?, ?, ?)')
    .bind(storeId, action, result, errorCode, actor.slice(0, 160)).run()
}

const publicView = (row: Row | null, env: Bindings) => row
  ? {
      connected: true, hint: row.hint, status: row.status, statusLabel: STATUS_LABELS[row.status],
      useAssistant: Boolean(row.use_assistant), useStudio: Boolean(row.use_studio), fallbackToPlatform: Boolean(row.fallback_to_platform),
      modelsOk: JSON.parse(row.models_ok || '[]') as string[], validatedAt: row.validated_at, lastErrorCode: row.last_error_code,
      lastUsedAt: row.last_used_at, connectedAt: row.created_at, available: vaultAvailable(env),
      tier: row.tier, tierLabel: TIER_LABELS[row.tier],
      billingDeclaredAt: row.billing_declared_at, tierVerifiedAt: row.tier_verified_at,
      signals: (JSON.parse(row.signals || '[]') as string[]).map((code) => SIGNAL_LABELS[code] || code),
      buyerDataPolicy: row.buyer_data_policy,
      tierSteps: AI_STUDIO_TIER_STEPS,
      // What it can do for TiendIA today: text (assistant) is verified on connect; images only after a real generation.
      capabilities: {
        text: (JSON.parse(row.models_ok || '[]') as string[]).some((model) => !/image/.test(model)),
        images: row.image_capability,
        buyerData: row.tier === 'facturacion_verificada',
      },
      lastErrorText: describeProviderError(row.last_error_detail ? JSON.parse(row.last_error_detail) as ProviderErrorDetail : null),
    }
  : { connected: false, available: vaultAvailable(env) }

export async function ownKeyStatus(db: D1Database, env: Bindings, storeId: number) {
  const row = await db.prepare('SELECT * FROM store_ai_keys WHERE store_id = ?').bind(storeId).first<Row>()
  const usage = await db.prepare(
    `SELECT COUNT(*) AS calls FROM ai_spend_reservations WHERE store_id = ? AND billing_source = 'own_key' AND status = 'settled' AND created_at >= datetime('now', 'start of month')`,
  ).bind(storeId).first<{ calls: number }>()
  const history = (await db.prepare('SELECT action, result, error_code AS errorCode, created_at AS createdAt FROM store_ai_key_events WHERE store_id = ? ORDER BY id DESC LIMIT 10').bind(storeId).all()).results || []
  return { ...publicView(row, env), callsThisMonth: Number(usage?.calls || 0), history }
}

const flag = (value: unknown, fallback: boolean) => value === undefined ? fallback : value === true
function usesFrom(body: { useAssistant?: unknown; useStudio?: unknown }, current?: { assistant: boolean; studio: boolean }) {
  const uses = { assistant: flag(body.useAssistant, current?.assistant ?? true), studio: flag(body.useStudio, current?.studio ?? false) }
  if (!uses.assistant && !uses.studio) throw new OwnKeyError('NO_USE', 'Elige al menos un uso: asistente o Estudio IA.')
  return uses
}

/** Connects (or replaces) the key. Validates first; nothing is saved unless the key works for the chosen uses. */
export async function connectOwnKey(db: D1Database, env: Bindings, fetcher: typeof fetch, storeId: number, body: { apiKey?: unknown; useAssistant?: unknown; useStudio?: unknown; fallbackToPlatform?: unknown }, actor: string) {
  if (!vaultAvailable(env)) throw new OwnKeyError('VAULT_UNAVAILABLE', 'La conexión de API propia no está habilitada en esta plataforma.', 503)
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : ''
  if (!KEY_SHAPE.test(apiKey)) throw new OwnKeyError('INVALID_KEY_FORMAT', 'Eso no parece una clave de API de Gemini. Cópiala completa desde Google AI Studio.')
  const existing = await db.prepare('SELECT use_assistant, use_studio, fallback_to_platform FROM store_ai_keys WHERE store_id = ?').bind(storeId).first<{ use_assistant: number; use_studio: number; fallback_to_platform: number }>()
  const uses = usesFrom(body, existing ? { assistant: Boolean(existing.use_assistant), studio: Boolean(existing.use_studio) } : undefined)
  const action = existing ? 'reemplazar' : 'conectar'
  const validation = await validateGeminiKey(env, fetcher, apiKey, uses)
  if (validation.status !== 'activa') {
    await event(db, storeId, action, validation.status, validation.errorCode, actor)
    throw new OwnKeyError(`KEY_${validation.status.toUpperCase()}`, `No guardamos la clave: Google respondió que está ${STATUS_LABELS[validation.status]}.`, 409)
  }
  const sealed = await encryptApiKey(env, storeId, apiKey)
  const fallback = flag(body.fallbackToPlatform, Boolean(existing?.fallback_to_platform)) ? 1 : 0
  await db.prepare(
    `INSERT INTO store_ai_keys (store_id, ciphertext, iv, key_version, hint, use_assistant, use_studio, status, models_ok, fallback_to_platform, validated_at, last_error_code, created_by, image_capability)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'activa', ?8, ?9, datetime('now'), NULL, ?10, ?11)
     ON CONFLICT(store_id) DO UPDATE SET ciphertext = excluded.ciphertext, iv = excluded.iv, key_version = excluded.key_version, hint = excluded.hint,
       use_assistant = excluded.use_assistant, use_studio = excluded.use_studio, status = 'activa', models_ok = excluded.models_ok,
       fallback_to_platform = excluded.fallback_to_platform, validated_at = excluded.validated_at, last_error_code = NULL, updated_at = datetime('now'),
       tier = 'no_verificada', billing_declared_at = NULL, tier_verified_by = NULL, tier_verified_at = NULL, tier_note = NULL, signals = '[]',
       image_capability = excluded.image_capability, last_error_detail = NULL`,
  ).bind(storeId, sealed.ciphertext, sealed.iv, sealed.version, hintOf(apiKey), uses.assistant ? 1 : 0, uses.studio ? 1 : 0, JSON.stringify(validation.modelsOk), fallback, actor.slice(0, 160), validation.imageListed ? 'sin_verificar' : 'no_disponible').run()
  await event(db, storeId, action, 'activa', null, actor)
  await audit(db, storeId, `ai_own_key_${action === 'conectar' ? 'connected' : 'replaced'}`, { hint: hintOf(apiKey), uses, fallback: Boolean(fallback) }, actor)
  return ownKeyStatus(db, env, storeId)
}

/** Validates the stored key again (free) and updates its state. */
export async function revalidateOwnKey(db: D1Database, env: Bindings, fetcher: typeof fetch, storeId: number, actor: string) {
  const row = await db.prepare('SELECT * FROM store_ai_keys WHERE store_id = ?').bind(storeId).first<Row>()
  if (!row) throw new OwnKeyError('KEY_NOT_FOUND', 'No hay una API propia conectada.', 404)
  const apiKey = await decryptApiKey(env, storeId, row)
  const validation = await validateGeminiKey(env, fetcher, apiKey, { assistant: Boolean(row.use_assistant), studio: Boolean(row.use_studio) })
  await db.prepare(`UPDATE store_ai_keys SET status = ?, models_ok = ?, validated_at = datetime('now'), last_error_code = ?, updated_at = datetime('now') WHERE store_id = ?`)
    .bind(validation.status, JSON.stringify(validation.modelsOk), validation.errorCode, storeId).run()
  await event(db, storeId, 'validar', validation.status, validation.errorCode, actor)
  return ownKeyStatus(db, env, storeId)
}

/** Changes the uses or the fallback. Enabling the studio checks the image model again. */
export async function updateOwnKeyUses(db: D1Database, env: Bindings, fetcher: typeof fetch, storeId: number, body: { useAssistant?: unknown; useStudio?: unknown; fallbackToPlatform?: unknown }, actor: string) {
  const row = await db.prepare('SELECT * FROM store_ai_keys WHERE store_id = ?').bind(storeId).first<Row>()
  if (!row) throw new OwnKeyError('KEY_NOT_FOUND', 'No hay una API propia conectada.', 404)
  const uses = usesFrom(body, { assistant: Boolean(row.use_assistant), studio: Boolean(row.use_studio) })
  const fallback = flag(body.fallbackToPlatform, Boolean(row.fallback_to_platform)) ? 1 : 0
  const validation = await validateGeminiKey(env, fetcher, await decryptApiKey(env, storeId, row), uses)
  // Turning on a use the key has no model for (typically the Studio on a text-only key) changes nothing: before, it
  // saved the new uses and marked the whole key «sin_permiso», which also stopped the assistant that was working.
  const enabling = (uses.assistant && !row.use_assistant) || (uses.studio && !row.use_studio)
  if (enabling && validation.errorCode === 'MODEL_NOT_AVAILABLE') {
    await event(db, storeId, 'cambiar_usos', 'rechazado', validation.errorCode, actor)
    throw new OwnKeyError('KEY_MODEL_NOT_AVAILABLE', `No activamos ese uso: tu clave no tiene acceso al modelo que necesita${uses.studio && !row.use_studio ? ' (el de imágenes del Estudio IA)' : ''}. Tu configuración anterior sigue igual.`, 409)
  }
  await db.prepare(
    `UPDATE store_ai_keys SET use_assistant = ?, use_studio = ?, fallback_to_platform = ?, status = ?, models_ok = ?, validated_at = datetime('now'), last_error_code = ?, updated_at = datetime('now') WHERE store_id = ?`,
  ).bind(uses.assistant ? 1 : 0, uses.studio ? 1 : 0, fallback, validation.status, JSON.stringify(validation.modelsOk), validation.errorCode, storeId).run()
  await event(db, storeId, 'cambiar_usos', validation.status, validation.errorCode, actor)
  await audit(db, storeId, 'ai_own_key_uses_changed', { uses, fallback: Boolean(fallback) }, actor)
  return ownKeyStatus(db, env, storeId)
}

export async function disconnectOwnKey(db: D1Database, env: Bindings, storeId: number, actor: string) {
  const removed = await db.prepare('DELETE FROM store_ai_keys WHERE store_id = ? RETURNING hint').bind(storeId).first<{ hint: string }>()
  if (!removed) throw new OwnKeyError('KEY_NOT_FOUND', 'No hay una API propia conectada.', 404)
  await event(db, storeId, 'desconectar', 'ok', null, actor)
  await audit(db, storeId, 'ai_own_key_disconnected', { hint: removed.hint }, actor)
  return ownKeyStatus(db, env, storeId)
}

async function audit(db: D1Database, storeId: number, action: string, payload: unknown, actor: string) {
  await db.prepare(`INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id) VALUES (?, 'store_ai_key', ?, ?, ?, 'admin', ?)`)
    .bind(action, String(storeId), JSON.stringify(payload), actor.slice(0, 160), storeId).run()
}

// ---- use by the spend guard -------------------------------------------------------

export type ResolvedOwnKey = { apiKey: string; fallbackToPlatform: boolean; status: OwnKeyStatus; tier: OwnKeyTier; buyerDataPolicy: BuyerDataPolicy }

/** The store's own key for this use and model, or null when it does not apply (not connected, use off, model not
 * verified for that key). A key in an error state still resolves (so the failure is reported, not hidden). */
export async function resolveOwnKey(db: D1Database, env: Bindings, storeId: number, use: OwnKeyUse, model: string, _feature = ''): Promise<ResolvedOwnKey | null> {
  if (!vaultAvailable(env)) return null
  const row = await db.prepare('SELECT * FROM store_ai_keys WHERE store_id = ?').bind(storeId).first<Row>().catch(() => null)
  if (!row || !(use === 'assistant' ? row.use_assistant : row.use_studio)) return null
  // Not compatible: this key cannot generate images (Google refused them before). The operation is not sent to it.
  if (/image/.test(model) && row.image_capability === 'no_disponible') return null
  const models = JSON.parse(row.models_ok || '[]') as string[]
  if (row.status === 'activa' && !models.includes(model)) return null
  try {
    return { apiKey: await decryptApiKey(env, storeId, row), fallbackToPlatform: Boolean(row.fallback_to_platform), status: row.status, tier: row.tier, buyerDataPolicy: row.buyer_data_policy }
  } catch {
    console.error('Own AI key could not be decrypted for a store (vault mismatch)')
    return null
  }
}

/** True when an operation of this feature would be paid with the store's own key (decided before credits are held). */
export async function ownKeyCovers(db: D1Database, env: Bindings, storeId: number, feature: string, kind: 'text' | 'image' | 'video'): Promise<boolean> {
  const model = kind === 'text' ? geminiModel(env) : studioModel(env) || ''
  const key = await resolveOwnKey(db, env, storeId, useFor(feature, kind), model, feature)
  // Operations that carry buyers' data by nature never waive credits for an unverified key: the guard will not send them there.
  if (key && BUYER_DATA_FEATURES.has(feature) && key.tier !== 'facturacion_verificada') return false
  return Boolean(key && key.status === 'activa')
}

export async function markOwnKeyResult(
  db: D1Database, storeId: number,
  outcome: { ok: true; kind?: 'text' | 'image' | 'video' } | { ok: false; status: OwnKeyStatus; code: string; kind?: 'text' | 'image' | 'video'; detail?: ProviderErrorDetail },
) {
  if (outcome.ok) {
    // A call that works proves the key is usable again (for example after the owner enabled billing). A generated
    // image proves the image capability; billing stays unverified (only a hint is recorded).
    const image = outcome.kind === 'image'
    await db.prepare(
      `UPDATE store_ai_keys SET last_used_at = datetime('now'), status = 'activa', last_error_code = NULL, last_error_detail = NULL
         ${image ? ", image_capability = 'disponible'" : ''} WHERE store_id = ?`,
    ).bind(storeId).run().catch(() => undefined)
    if (image) await addSignal(db, storeId, 'imagen_generada')
    return
  }
  const detail = outcome.detail ?? null
  const imageRefused = outcome.kind === 'image' && (outcome.status === 'sin_cuota' || outcome.status === 'sin_permiso')
  await db.prepare(
    `UPDATE store_ai_keys SET status = ?, last_error_code = ?, last_error_detail = ?, updated_at = datetime('now')
       ${imageRefused ? ", image_capability = 'no_disponible'" : ''} WHERE store_id = ?`,
  ).bind(outcome.status, outcome.code, detail ? JSON.stringify(detail) : null, storeId).run().catch(() => undefined)
  if (detail?.freeTier) await addSignal(db, storeId, 'limite_gratuito_observado')
  if (detail?.http === 402) await addSignal(db, storeId, 'pago_requerido')
  await event(db, storeId, 'uso', outcome.status, outcome.code, 'system').catch(() => undefined)
}

async function addSignal(db: D1Database, storeId: number, code: string) {
  await db.prepare(
    `UPDATE store_ai_keys SET signals = json_insert(signals, '$[#]', ?1) WHERE store_id = ?2 AND NOT EXISTS (SELECT 1 FROM json_each(signals) WHERE value = ?1)`,
  ).bind(code, storeId).run().catch(() => undefined)
}

// ---- tier declarations and verification ------------------------------------------

/** The owner states what AI Studio shows for the key's project. «gratuita» is confirmed by that statement; «facturacion»
 * only records the declaration and asks the platform to verify it (it never becomes «verified» by itself). */
export async function declareOwnKeyTier(db: D1Database, env: Bindings, storeId: number, body: { tier?: unknown }, actor: string) {
  const row = await db.prepare('SELECT tier FROM store_ai_keys WHERE store_id = ?').bind(storeId).first<{ tier: OwnKeyTier }>()
  if (!row) throw new OwnKeyError('KEY_NOT_FOUND', 'No hay una API propia conectada.', 404)
  if (body.tier === 'gratuita') {
    await db.prepare(`UPDATE store_ai_keys SET tier = 'gratuita_confirmada', billing_declared_at = NULL, tier_verified_by = ?, tier_verified_at = datetime('now'), tier_note = 'Confirmada por el propietario', updated_at = datetime('now') WHERE store_id = ?`)
      .bind(actor.slice(0, 160), storeId).run()
    await event(db, storeId, 'nivel_gratuito_confirmado', 'ok', null, actor)
  } else if (body.tier === 'facturacion') {
    await db.prepare(`UPDATE store_ai_keys SET billing_declared_at = datetime('now'), tier = CASE WHEN tier = 'facturacion_verificada' THEN tier ELSE 'no_verificada' END, updated_at = datetime('now') WHERE store_id = ?`)
      .bind(storeId).run()
    await event(db, storeId, 'facturacion_declarada', 'pendiente', null, actor)
    await db.prepare(`INSERT INTO platform_events (store_id, level, source, code, detail) VALUES (?, 'info', 'ai', 'OWN_KEY_BILLING_DECLARED', 'El propietario declaró facturación en su API propia: revisar evidencia de AI Studio')`).bind(storeId).run()
  } else {
    throw new OwnKeyError('INVALID_TIER', 'Indica «gratuita» o «facturacion».')
  }
  return ownKeyStatus(db, env, storeId)
}

/** Platform (superadmin) records the result of reviewing the evidence (AI Studio → Projects → Billing Tier). */
export async function verifyOwnKeyTier(db: D1Database, env: Bindings, storeId: number, body: { verified?: unknown; note?: unknown }, actor: string) {
  const note = typeof body.note === 'string' ? body.note.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 300) : ''
  if (!note) throw new OwnKeyError('NOTE_REQUIRED', 'Escribe qué evidencia revisaste (por ejemplo, captura de «Billing Tier: Tier 1»).')
  const tier: OwnKeyTier = body.verified === true ? 'facturacion_verificada' : 'no_verificada'
  const updated = await db.prepare(`UPDATE store_ai_keys SET tier = ?, tier_verified_by = ?, tier_verified_at = datetime('now'), tier_note = ?, updated_at = datetime('now') WHERE store_id = ? RETURNING store_id`)
    .bind(tier, actor.slice(0, 160), note, storeId).first()
  if (!updated) throw new OwnKeyError('KEY_NOT_FOUND', 'Esa tienda no tiene API propia conectada.', 404)
  await event(db, storeId, tier === 'facturacion_verificada' ? 'facturacion_verificada' : 'facturacion_no_verificada', 'ok', null, actor)
  await audit(db, storeId, 'ai_own_key_tier_verified', { tier, note }, actor)
  return ownKeyStatus(db, env, storeId)
}

/** Owner's explicit choice for tasks with buyers' data when the key has no verified billing. */
export async function setBuyerDataPolicy(db: D1Database, env: Bindings, storeId: number, body: { policy?: unknown }, actor: string) {
  if (body.policy !== 'plan' && body.policy !== 'bloquear' && body.policy !== 'preguntar') throw new OwnKeyError('INVALID_POLICY', 'Elige «plan» o «bloquear».')
  const updated = await db.prepare(`UPDATE store_ai_keys SET buyer_data_policy = ?, updated_at = datetime('now') WHERE store_id = ? RETURNING store_id`).bind(body.policy, storeId).first()
  if (!updated) throw new OwnKeyError('KEY_NOT_FOUND', 'No hay una API propia conectada.', 404)
  await event(db, storeId, 'politica_datos_compradores', String(body.policy), null, actor)
  await audit(db, storeId, 'ai_own_key_buyer_data_policy', { policy: body.policy }, actor)
  return ownKeyStatus(db, env, storeId)
}
