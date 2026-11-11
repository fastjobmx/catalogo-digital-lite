/** Mini-store trial settings, editable by the superadmin from the panel (no code changes). */

export const TRIAL_TEMPLATES = ['clasica', 'boutique', 'stories'] as const
export type TrialTemplate = typeof TRIAL_TEMPLATES[number]

/** Real store template used when a trial becomes a store. */
export const TRIAL_TO_STORE_TEMPLATE: Record<TrialTemplate, string> = { clasica: 'moderno', boutique: 'boutique', stories: 'stories' }

export type TrialSettings = {
  durationHours: number
  retentionHours: number
  maxProducts: number
  maxPhotoMb: number
  templates: TrialTemplate[]
  dailyLimit: number
  createPerIpHour: number
  /** Real orders by WhatsApp to the merchant's number (the trial needs a WhatsApp and prices). */
  ordersEnabled: boolean
  /** AI photo improvements (white background) each trial may use. 0 = not offered. */
  photoEnhancePerTrial: number
  /** AI photo improvements allowed per day across all trials (cost ceiling for the platform). */
  photoEnhanceDailyLimit: number
}

export const TRIAL_DEFAULTS: TrialSettings = {
  durationHours: 168,
  retentionHours: 72,
  maxProducts: 7,
  maxPhotoMb: 3,
  templates: ['clasica', 'boutique', 'stories'],
  dailyLimit: 300,
  createPerIpHour: 5,
  ordersEnabled: true,
  photoEnhancePerTrial: 0,
  photoEnhanceDailyLimit: 50,
}

const RANGES: Record<Exclude<keyof TrialSettings, 'templates' | 'ordersEnabled'>, [number, number]> = {
  durationHours: [1, 336],
  retentionHours: [0, 720],
  maxProducts: [1, 20],
  maxPhotoMb: [1, 5],
  dailyLimit: [1, 10000],
  createPerIpHour: [1, 100],
  photoEnhancePerTrial: [0, 20],
  photoEnhanceDailyLimit: [0, 5000],
}

export class SettingsError extends Error {
  constructor(readonly code: string, message: string) { super(message) }
}

export async function getTrialSettings(db: D1Database): Promise<TrialSettings> {
  const row = await db.prepare(`SELECT value_json FROM platform_settings WHERE key = 'trial'`).first<{ value_json: string }>()
  let stored: Partial<TrialSettings> = {}
  try { stored = row ? JSON.parse(row.value_json) as Partial<TrialSettings> : {} } catch { stored = {} }
  const merged = { ...TRIAL_DEFAULTS, ...stored }
  merged.templates = (merged.templates || []).filter((key): key is TrialTemplate => (TRIAL_TEMPLATES as readonly string[]).includes(key))
  if (!merged.templates.length) merged.templates = [...TRIAL_DEFAULTS.templates]
  return merged
}

export async function setTrialSettings(db: D1Database, body: Record<string, unknown>, actor: string): Promise<TrialSettings> {
  const next = await getTrialSettings(db)
  for (const [key, [min, max]] of Object.entries(RANGES) as Array<[keyof typeof RANGES, [number, number]]>) {
    if (body[key] === undefined) continue
    const value = Number(body[key])
    if (!Number.isInteger(value) || value < min || value > max) throw new SettingsError('INVALID_SETTING', `${key} debe ser un entero entre ${min} y ${max}`)
    next[key] = value
  }
  if (body.ordersEnabled !== undefined) {
    if (typeof body.ordersEnabled !== 'boolean') throw new SettingsError('INVALID_SETTING', 'ordersEnabled debe ser verdadero o falso')
    next.ordersEnabled = body.ordersEnabled
  }
  if (body.templates !== undefined) {
    const list = Array.isArray(body.templates) ? body.templates.filter((key): key is TrialTemplate => (TRIAL_TEMPLATES as readonly string[]).includes(String(key))) : []
    if (!list.length) throw new SettingsError('INVALID_SETTING', 'Deja al menos una plantilla disponible')
    next.templates = [...new Set(list)]
  }
  await db.batch([
    db.prepare(`INSERT INTO platform_settings (key, value_json, updated_by) VALUES ('trial', ?, ?)
                ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_by = excluded.updated_by, updated_at = datetime('now')`).bind(JSON.stringify(next), actor),
    db.prepare(`INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id) VALUES ('trial_settings_updated', 'platform', 'trial', ?, ?, 'platform', NULL)`).bind(JSON.stringify(next), actor),
  ])
  return next
}
