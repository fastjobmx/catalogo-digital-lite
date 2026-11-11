/** Brand Kit por comercio. Solo guarda lo que el comercio escribe: nada se rellena con datos inventados.
 * El logo y el color de Apariencia (store_config) se muestran como sugerencia, pero no se copian solos. */
import { assetUrlBelongsToStore } from '../lib/assets'
import type { BrandKit, BrandKitPatch, BrandKitService, CreativeContext } from './contracts'

export class CreativeError extends Error {
  constructor(readonly code: string, message: string, readonly status: 400 | 403 | 404 | 409 | 429 = 400) { super(message) }
}

/** Tipografías permitidas (seguras para web y para el render de plantillas). */
export const ALLOWED_FONTS = ['Inter', 'Poppins', 'Montserrat', 'Roboto', 'Open Sans', 'Lato', 'Playfair Display', 'Merriweather', 'Oswald', 'Bebas Neue'] as const
export const VISUAL_STYLES = {
  minimalista: 'Minimalista',
  premium: 'Premium / elegante',
  urbano: 'Urbano',
  colorido: 'Colorido y alegre',
  natural: 'Natural / orgánico',
  tecnologico: 'Tecnológico',
  artesanal: 'Artesanal',
  juvenil: 'Juvenil',
} as const
export const TONES = {
  cercano: 'Cercano y amable',
  profesional: 'Profesional',
  divertido: 'Divertido',
  inspirador: 'Inspirador',
  directo: 'Directo y claro',
  lujo: 'Exclusivo',
} as const

const LIMITS = { brandName: 80, slogan: 140, targetAudience: 400, colors: 6, fonts: 3, visualStyles: 5, favoriteTemplates: 12 }

type Row = {
  brand_name: string | null; slogan: string | null; tone: string | null; target_audience: string | null; logo_url: string | null
  colors_json: string; fonts_json: string; visual_styles_json: string; favorite_templates_json: string
  revision: number; updated_by: string; updated_at: string
}

const parseList = (raw: string | null | undefined): string[] => {
  try { const value = JSON.parse(raw || '[]'); return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [] } catch { return [] }
}

const EMPTY: BrandKit = { brandName: null, slogan: null, tone: null, targetAudience: null, logoUrl: null, colors: [], fonts: [], visualStyles: [], favoriteTemplates: [], revision: 0, updatedBy: null, updatedAt: null }

function fromRow(row: Row | null): BrandKit {
  if (!row) return { ...EMPTY }
  return {
    brandName: row.brand_name, slogan: row.slogan, tone: row.tone, targetAudience: row.target_audience, logoUrl: row.logo_url,
    colors: parseList(row.colors_json), fonts: parseList(row.fonts_json), visualStyles: parseList(row.visual_styles_json),
    favoriteTemplates: parseList(row.favorite_templates_json), revision: row.revision, updatedBy: row.updated_by, updatedAt: row.updated_at,
  }
}

function text(value: unknown, field: string, max: number): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw new CreativeError('INVALID_FIELD', `${field} debe ser texto`)
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  if (clean.length > max) throw new CreativeError('INVALID_FIELD', `${field} admite hasta ${max} caracteres`)
  return clean || null
}

function list(value: unknown, field: string, max: number, accept: (item: string) => boolean): string[] {
  if (value === null || value === undefined) return []
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new CreativeError('INVALID_FIELD', `${field} debe ser una lista`)
  const unique = [...new Set(value as string[])]
  if (unique.length > max) throw new CreativeError('INVALID_FIELD', `${field} admite hasta ${max} elementos`)
  const bad = unique.find((item) => !accept(item))
  if (bad !== undefined) throw new CreativeError('INVALID_FIELD', `${field} tiene un valor no permitido`)
  return unique
}

/** Valida un parche sobre el kit actual; los campos omitidos se conservan. */
export function validateBrandKitPatch(storeId: number, current: BrandKit, patch: Record<string, unknown>): Omit<BrandKit, 'revision' | 'updatedBy' | 'updatedAt'> {
  const has = (key: string) => Object.hasOwn(patch, key)
  let logoUrl = current.logoUrl
  if (has('logoUrl')) {
    logoUrl = text(patch.logoUrl, 'logoUrl', 600)
    if (logoUrl) {
      const relative = logoUrl.startsWith('/api/assets/')
      if (!relative && !/^https:\/\//.test(logoUrl)) throw new CreativeError('INVALID_LOGO', 'El logo debe ser una imagen subida a la tienda o una dirección https')
      if (!assetUrlBelongsToStore(logoUrl, storeId)) throw new CreativeError('ASSET_NOT_OWNED', 'El logo pertenece a otra tienda', 400)
    }
  }
  const tone = has('tone') ? text(patch.tone, 'tone', 40) : current.tone
  if (tone && !Object.hasOwn(TONES, tone)) throw new CreativeError('INVALID_FIELD', 'tone tiene un valor no permitido')
  return {
    brandName: has('brandName') ? text(patch.brandName, 'brandName', LIMITS.brandName) : current.brandName,
    slogan: has('slogan') ? text(patch.slogan, 'slogan', LIMITS.slogan) : current.slogan,
    tone,
    targetAudience: has('targetAudience') ? text(patch.targetAudience, 'targetAudience', LIMITS.targetAudience) : current.targetAudience,
    logoUrl,
    colors: has('colors') ? list(patch.colors, 'colors', LIMITS.colors, (c) => /^#[0-9a-fA-F]{6}$/.test(c)).map((c) => c.toUpperCase()) : current.colors,
    fonts: has('fonts') ? list(patch.fonts, 'fonts', LIMITS.fonts, (f) => (ALLOWED_FONTS as readonly string[]).includes(f)) : current.fonts,
    visualStyles: has('visualStyles') ? list(patch.visualStyles, 'visualStyles', LIMITS.visualStyles, (s) => Object.hasOwn(VISUAL_STYLES, s)) : current.visualStyles,
    // Aún no hay catálogo de plantillas creativas: se aceptan claves con formato seguro, sin inventar plantillas.
    favoriteTemplates: has('favoriteTemplates') ? list(patch.favoriteTemplates, 'favoriteTemplates', LIMITS.favoriteTemplates, (t) => /^[a-z0-9][a-z0-9_-]{1,40}$/.test(t)) : current.favoriteTemplates,
  }
}

async function audit(db: D1Database, ctx: CreativeContext, action: string, payload: unknown) {
  await db.prepare(`INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id) VALUES (?, 'creative', ?, ?, ?, 'admin', ?)`)
    .bind(action, String(ctx.storeId), JSON.stringify(payload), ctx.actor, ctx.storeId).run()
}

export function brandKitService(db: D1Database): BrandKitService {
  const read = async (storeId: number) => fromRow(await db.prepare('SELECT * FROM brand_kits WHERE store_id = ?').bind(storeId).first<Row>())
  return {
    get: (ctx) => read(ctx.storeId),
    async update(ctx, patch: BrandKitPatch) {
      const current = await read(ctx.storeId)
      if (patch.revision !== undefined && patch.revision !== current.revision) {
        throw new CreativeError('REVISION_CONFLICT', 'Alguien más cambió el Brand Kit. Recarga la página para ver la última versión.', 409)
      }
      const next = validateBrandKitPatch(ctx.storeId, current, patch as Record<string, unknown>)
      const values = [next.brandName, next.slogan, next.tone, next.targetAudience, next.logoUrl, JSON.stringify(next.colors), JSON.stringify(next.fonts), JSON.stringify(next.visualStyles), JSON.stringify(next.favoriteTemplates), ctx.actor.slice(0, 160)]
      let changes = 0
      if (current.revision === 0) {
        const result = await db.prepare(
          `INSERT OR IGNORE INTO brand_kits (store_id, brand_name, slogan, tone, target_audience, logo_url, colors_json, fonts_json, visual_styles_json, favorite_templates_json, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(ctx.storeId, ...values).run()
        changes = Number(result.meta?.changes || 0)
      } else {
        const result = await db.prepare(
          `UPDATE brand_kits SET brand_name = ?, slogan = ?, tone = ?, target_audience = ?, logo_url = ?, colors_json = ?, fonts_json = ?, visual_styles_json = ?,
             favorite_templates_json = ?, updated_by = ?, revision = revision + 1, updated_at = datetime('now')
           WHERE store_id = ? AND revision = ?`,
        ).bind(...values, ctx.storeId, current.revision).run()
        changes = Number(result.meta?.changes || 0)
      }
      if (!changes) throw new CreativeError('REVISION_CONFLICT', 'Alguien más cambió el Brand Kit. Recarga la página para ver la última versión.', 409)
      const saved = await read(ctx.storeId)
      await audit(db, ctx, 'brand_kit_updated', { revision: saved.revision, fields: Object.keys(patch).filter((k) => k !== 'revision') })
      return saved
    },
  }
}

/** Datos ya existentes de Apariencia, para sugerirlos (el comercio decide si los usa). */
export async function storeAppearanceHints(db: D1Database, storeId: number) {
  const row = await db.prepare('SELECT name, logo_url AS logoUrl, primary_color AS primaryColor FROM store_config WHERE id = ?').bind(storeId).first<{ name: string | null; logoUrl: string | null; primaryColor: string | null }>()
  return { name: row?.name ?? null, logoUrl: row?.logoUrl ?? null, primaryColor: row?.primaryColor ?? null }
}
