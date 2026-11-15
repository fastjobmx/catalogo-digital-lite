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

const aad = (storeId: number, version: number) => new TextEncoder().encode(`store:${storeId}|gemini|v${version}`)

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
  return { status: 'activa', modelsOk, errorCode: null, imageListed }
}

/** Key state from an HTTP error of Google, or null when it is a service problem (not the key's fault). */
export function statusFromHttp(status: number, body: string): OwnKeyStatus | null {
  if (status === 429) return 'sin_cuota'
  if (status === 401 || (status === 400 && /API_KEY_INVALID|API key not valid|INVALID_ARGUMENT/i.test(body))) return 'invalida'
  if (status === 403) return /billing|BILLING/i.test(body) ? 'sin_cuota' : 'sin_permiso'
  return null
}

export type OwnKeyTier = 'desconocido' | 'gratuito' | 'facturacion'
export type ImageCapability = 'sin_verificar' | 'disponible' | 'no_disponible'
export const TIER_LABELS: Record<OwnKeyTier, string> = {
  desconocido: 'sin confirmar',
  gratuito: 'nivel gratuito de Google',
  facturacion: 'con facturación activa',
}

/** Operations that carry buyers' personal data (names, phones, addresses in orders and shipping guides). They are
 * never sent to an own key unless that key is confirmed with billing: on Google's free tier the provider may use and
 * review the content to improve its products, which does not match our privacy commitment to buyers. */
export const BUYER_DATA_FEATURES = new Set(['pedidos', 'leer_guia_envio'])

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
    const base = detail.freeTier ? `Límite del nivel gratuito de Google (${kind}${what ? ` ${what}` : ''})` : `Límite de cuota de Google (${kind}${what ? ` ${what}` : ''})`
    return `${base}${detail.quotaValue ? `: ${detail.quotaValue}` : ''}${detail.retryAfter ? `. Google sugiere esperar ${detail.retryAfter}` : ''}.`
  }
  if (detail.http === 401 || detail.http === 400) return 'Google rechazó la clave (inválida o revocada).'
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
      // What it can do for TiendIA today: text (assistant) is verified on connect; images only after a real generation.
      capabilities: {
        text: (JSON.parse(row.models_ok || '[]') as string[]).some((model) => !/image/.test(model)),
        images: row.image_capability,
        buyerData: row.tier === 'facturacion',
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
       tier = 'desconocido', image_capability = excluded.image_capability, last_error_detail = NULL`,
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

export type ResolvedOwnKey = { apiKey: string; fallbackToPlatform: boolean; status: OwnKeyStatus }

/** The store's own key for this use and model, or null when it does not apply (not connected, use off, model not
 * verified for that key). A key in an error state still resolves (so the failure is reported, not hidden). */
export async function resolveOwnKey(db: D1Database, env: Bindings, storeId: number, use: OwnKeyUse, model: string, feature = ''): Promise<ResolvedOwnKey | null> {
  if (!vaultAvailable(env)) return null
  const row = await db.prepare('SELECT * FROM store_ai_keys WHERE store_id = ?').bind(storeId).first<Row>().catch(() => null)
  if (!row || !(use === 'assistant' ? row.use_assistant : row.use_studio)) return null
  // Not compatible: this key cannot generate images (Google refused them before). The operation is not sent to it.
  if (/image/.test(model) && row.image_capability === 'no_disponible') return null
  // Privacy: buyers' personal data only goes to an own key confirmed with billing (see BUYER_DATA_FEATURES).
  if (BUYER_DATA_FEATURES.has(feature) && row.tier !== 'facturacion') return null
  const models = JSON.parse(row.models_ok || '[]') as string[]
  if (row.status === 'activa' && !models.includes(model)) return null
  try {
    return { apiKey: await decryptApiKey(env, storeId, row), fallbackToPlatform: Boolean(row.fallback_to_platform), status: row.status }
  } catch {
    console.error('Own AI key could not be decrypted for a store (vault mismatch)')
    return null
  }
}

/** True when an operation of this feature would be paid with the store's own key (decided before credits are held). */
export async function ownKeyCovers(db: D1Database, env: Bindings, storeId: number, feature: string, kind: 'text' | 'image' | 'video'): Promise<boolean> {
  const model = kind === 'text' ? geminiModel(env) : studioModel(env) || ''
  const key = await resolveOwnKey(db, env, storeId, useFor(feature, kind), model, feature)
  return Boolean(key && key.status === 'activa')
}

export async function markOwnKeyResult(
  db: D1Database, storeId: number,
  outcome: { ok: true; kind?: 'text' | 'image' | 'video' } | { ok: false; status: OwnKeyStatus; code: string; kind?: 'text' | 'image' | 'video'; detail?: ProviderErrorDetail },
) {
  if (outcome.ok) {
    // A call that works proves the key is usable again (for example after the owner enabled billing). A generated
    // image proves both the image capability and billing (images have no free tier).
    const image = outcome.kind === 'image'
    await db.prepare(
      `UPDATE store_ai_keys SET last_used_at = datetime('now'), status = 'activa', last_error_code = NULL, last_error_detail = NULL
         ${image ? ", image_capability = 'disponible', tier = 'facturacion'" : ''} WHERE store_id = ?`,
    ).bind(storeId).run().catch(() => undefined)
    return
  }
  const detail = outcome.detail ?? null
  const imageRefused = outcome.kind === 'image' && (outcome.status === 'sin_cuota' || outcome.status === 'sin_permiso')
  await db.prepare(
    `UPDATE store_ai_keys SET status = ?, last_error_code = ?, last_error_detail = ?, updated_at = datetime('now')
       ${detail?.freeTier ? ", tier = 'gratuito'" : ''}${imageRefused ? ", image_capability = 'no_disponible'" : ''} WHERE store_id = ?`,
  ).bind(outcome.status, outcome.code, detail ? JSON.stringify(detail) : null, storeId).run().catch(() => undefined)
  await event(db, storeId, 'uso', outcome.status, outcome.code, 'system').catch(() => undefined)
}
