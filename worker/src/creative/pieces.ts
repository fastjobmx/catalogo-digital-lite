/** Piezas comerciales (creative_pieces): imágenes, carruseles y videos hechos con productos reales.
 *
 * Modo convencional: el panel compone la pieza en el navegador con capas gráficas (foto, nombre, precio,
 * etiqueta, logo) usando el plan que arma este servicio; aquí se valida, se guarda en privado y queda
 * «pendiente» hasta que el comercio la aprueba. Sin IA y sin créditos.
 * Modo video_ia: lo crea creative/videoEngine.ts.
 *
 * La misma configuración (huella) no se genera dos veces: si ya existe una pieza reutilizable, se devuelve. */
import type { Env } from '../index'
import { validIdempotencyKey } from '../ai/credits'
import { CreativeError } from './brandKit'
import type { CreativeContext } from './contracts'
import { imageDimensions, sha256Hex, sniffImageType } from './imageInfo'
import { parseDesign } from './designOptions'
import {
  CREATIVE_FORMATS, CREATIVE_TEMPLATES, defaultCopy, isFormat, isTemplate, loadFacts, manualCopy, templateBadge, templateEligibility,
  type CreativeCopy, type CreativeFacts, type FormatKey, type PieceKind, type TemplateDef, type TemplateKey,
} from './templates'

export const MAX_PIECES_PER_STORE = 1000
export const MAX_IMAGE_BYTES = 6 * 1024 * 1024
export const MAX_VIDEO_BYTES = 40 * 1024 * 1024
export const MAX_SLIDES = 10
export const QUALITIES = {
  estandar: { label: 'Estándar', scale: 1, description: 'Tamaño recomendado para redes. Archivo liviano.' },
  alta: { label: 'Alta', scale: 1, description: 'Imagen sin pérdida (PNG) o video con más detalle. Archivo más pesado.' },
} as const
export type Quality = keyof typeof QUALITIES
/** Los videos convencionales se exportan a 720 px de lado menor (estándar) o al tamaño completo (alta). */
export const VIDEO_SHORT_SIDE: Record<Quality, number> = { estandar: 720, alta: 1080 }

export type PieceStatus = 'pendiente' | 'aprobado' | 'rechazado'
export type PieceFile = { key: string; contentType: string; bytes: number; width: number | null; height: number | null; durationMs: number | null }
type Row = {
  id: string; store_id: number; kind: PieceKind; mode: 'convencional' | 'video_ia'; template: string; format: string; product_ids_json: string
  copy_json: string; spec_json: string; spec_hash: string; status: PieceStatus; files_json: string; model: string | null; credits: number
  cost_micros: number; job_id: string | null; campaign_id: number | null; created_by: string; reviewed_by: string | null; created_at: string; updated_at: string
  campaign_name?: string | null
}

const parse = <T>(raw: string, fallback: T): T => { try { return JSON.parse(raw) as T } catch { return fallback } }
const validId = (id: unknown): id is string => typeof id === 'string' && /^[0-9a-f-]{36}$/.test(id)

function toPiece(row: Row) {
  const files = parse<PieceFile[]>(row.files_json, [])
  return {
    id: row.id, kind: row.kind, mode: row.mode, template: row.template, format: row.format, productIds: parse<number[]>(row.product_ids_json, []),
    copy: parse<CreativeCopy | Record<string, never>>(row.copy_json, {}), spec: parse<Record<string, unknown>>(row.spec_json, {}), status: row.status,
    files: files.map((file, index) => ({ index, contentType: file.contentType, bytes: file.bytes, width: file.width, height: file.height, durationMs: file.durationMs })),
    model: row.model, credits: row.credits, costMicros: row.cost_micros, jobId: row.job_id, campaignId: row.campaign_id, campaignName: row.campaign_name ?? null,
    createdBy: row.created_by, reviewedBy: row.reviewed_by, createdAt: row.created_at, updatedAt: row.updated_at,
  }
}
export type CreativePiece = ReturnType<typeof toPiece>

const SELECT = `SELECT p.*, c.name AS campaign_name FROM creative_pieces p LEFT JOIN campaigns c ON c.id = p.campaign_id AND c.store_id = p.store_id`

/** Tipo real de un video según sus bytes (MP4/MOV: caja «ftyp»; WebM: cabecera EBML). */
export function sniffVideoType(bytes: Uint8Array): 'video/mp4' | 'video/webm' | null {
  if (bytes.length > 12 && String.fromCharCode(bytes[4]!, bytes[5]!, bytes[6]!, bytes[7]!) === 'ftyp') return 'video/mp4'
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'video/webm'
  return null
}

export async function specHash(spec: unknown): Promise<string> {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value as object).sort().map((key) => [key, canonical((value as Record<string, unknown>)[key])])) : value
  return sha256Hex(new TextEncoder().encode(JSON.stringify(canonical(spec))))
}

type PlanInput = { kind?: unknown; template?: unknown; format?: unknown; productIds?: unknown; quality?: unknown; seconds?: unknown; copy?: unknown; design?: unknown }

export function pieceService(env: Env['Bindings']) {
  const db = env.DB
  const storage = () => { if (!env.ASSETS) throw new CreativeError('STORAGE_UNAVAILABLE', 'El almacenamiento no está disponible', 409); return env.ASSETS }
  const find = async (storeId: number, id: unknown) => validId(id) ? db.prepare(`${SELECT} WHERE p.id = ? AND p.store_id = ?`).bind(id, storeId).first<Row>() : null
  const need = async (storeId: number, id: unknown) => {
    const row = await find(storeId, id)
    if (!row) throw new CreativeError('PIECE_NOT_FOUND', 'Pieza no encontrada', 404)
    return row
  }
  const audit = (ctx: CreativeContext, action: string, id: string, payload: unknown = {}) => db.prepare(
    `INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id) VALUES (?, 'creative_piece', ?, ?, ?, 'admin', ?)`,
  ).bind(action, id, JSON.stringify(payload), ctx.actor, ctx.storeId).run()
  const deleteFiles = async (files: PieceFile[]) => { for (const file of files) await storage().delete(file.key).catch(() => undefined) }

  function ids(value: unknown): number[] {
    if (!Array.isArray(value)) return []
    const list = value.map(Number)
    if (list.some((id) => !Number.isSafeInteger(id) || id <= 0) || new Set(list).size !== list.length || list.length > 6) throw new CreativeError('INVALID_PRODUCTS', 'Elige productos válidos, sin repetir')
    return list
  }

  /** Valida la selección y arma todo lo que el panel necesita para componer: datos reales, etiqueta, textos y costo. */
  async function plan(ctx: CreativeContext, input: PlanInput) {
    if (input.kind !== 'imagen' && input.kind !== 'carrusel' && input.kind !== 'video') throw new CreativeError('INVALID_KIND', 'Elige el tipo de contenido')
    if (!isTemplate(input.template)) throw new CreativeError('INVALID_TEMPLATE', 'Elige una plantilla válida')
    if (!isFormat(input.format)) throw new CreativeError('INVALID_FORMAT', 'Elige un formato válido')
    const kind: PieceKind = input.kind
    const template: TemplateKey = input.template
    const format: FormatKey = input.format
    const def: TemplateDef = CREATIVE_TEMPLATES[template]
    if (!def.kinds.includes(kind)) throw new CreativeError('KIND_NOT_ALLOWED', `«${def.label}» no se ofrece como ${kind}`)
    if (kind === 'video' && !CREATIVE_FORMATS[format].video) throw new CreativeError('FORMAT_NOT_ALLOWED', 'Ese formato es solo para imágenes')
    const quality: Quality = input.quality === 'alta' ? 'alta' : 'estandar'
    const seconds = kind === 'video' ? Number(input.seconds ?? def.seconds[0]) : null
    if (seconds !== null && !def.seconds.includes(seconds)) throw new CreativeError('INVALID_DURATION', `Elige una duración de ${def.seconds.join(', ')} segundos`)
    const design = parseDesign(input.design, template)
    const facts = await loadFacts(env, ctx, ids(input.productIds))
    const eligibility = templateEligibility(template, facts, Boolean(facts.brand.name && facts.brand.slogan))
    if (!eligibility.ok) throw new CreativeError('TEMPLATE_NOT_ELIGIBLE', eligibility.reason || 'Esta plantilla no aplica a la selección', 409)
    const withoutPhoto = facts.products.find((product) => !product.images.length)
    if (withoutPhoto) throw new CreativeError('PRODUCT_WITHOUT_PHOTO', `«${withoutPhoto.name}» no tiene fotos. Agrégale una foto primero.`, 409)
    const base = defaultCopy(template, facts)
    const copy = input.copy === undefined || input.copy === null ? base : manualCopy(input.copy, base, facts, template)
    const size = CREATIVE_FORMATS[format]
    const slides = kind === 'carrusel' ? facts.products.length : 1
    const spec = {
      version: design ? 2 : 1, kind, mode: 'convencional' as const, template, format, quality, seconds, productIds: facts.products.map((product) => product.id),
      width: size.width, height: size.height, slides,
      // Capas verificadas: lo que la pieza afirma, tal como se dibuja.
      badge: templateBadge(template, facts),
      products: facts.products.map((product) => ({
        id: product.id, name: product.name, priceText: product.priceText, compareAtText: template === 'oferta_aprobada' ? product.compareAtText : null, image: product.images[0] ?? null, beforeAfter: template === 'antes_despues' ? product.beforeAfter : null,
        // Motor de diseño: datos reales adicionales (la referencia solo se dibuja si el comercio la pide).
        ...(design ? { reference: product.sku || null, category: product.category, discountPercent: template === 'oferta_aprobada' ? product.discountPercent : null, gallery: product.images.slice(0, 3) } : {}),
      })),
      brand: { name: facts.brand.name, slogan: facts.brand.slogan, logoUrl: facts.brand.logoUrl, colors: facts.brand.colors, font: facts.brand.font },
      storeUrl: template === 'invitacion_catalogo' ? facts.store.url : null,
      copy: { headline: copy.headline, description: copy.description, benefits: copy.benefits, cta: copy.cta },
      ...(design ? { design } : {}),
    }
    const hash = await specHash(spec)
    const existing = await db.prepare(`${SELECT} WHERE p.store_id = ? AND p.spec_hash = ? AND p.status <> 'rechazado' AND p.files_json <> '[]' ORDER BY p.created_at DESC LIMIT 1`).bind(ctx.storeId, hash).first<Row>()
    return {
      spec, specHash: hash, copy, defaultCopy: base, facts,
      // Costo separado por tipo de trabajo. La composición convencional no usa IA ni créditos.
      cost: { composicionConvencional: 0, imagenGenerativa: 0, videoGenerativo: 0, total: 0 },
      reusable: existing ? toPiece(existing) : null,
    }
  }

  return {
    plan,

    /** Guarda la pieza compuesta en el navegador. El servidor recalcula el plan: no confía en la huella del cliente. */
    async create(ctx: CreativeContext, input: PlanInput & { replaces?: unknown; durationMs?: unknown }, files: unknown[], key: string) {
      if (!validIdempotencyKey(key)) throw new CreativeError('INVALID_IDEMPOTENCY_KEY', 'Falta el encabezado Idempotency-Key')
      const replayed = await db.prepare(`${SELECT} WHERE p.store_id = ? AND p.idempotency_key = ?`).bind(ctx.storeId, key).first<Row>()
      if (replayed) return { piece: toPiece(replayed), replayed: true, reused: false }
      const planned = await plan(ctx, input)
      if (planned.reusable && !input.replaces) return { piece: planned.reusable, replayed: false, reused: true }
      const { spec } = planned
      const uploads = files.filter((file): file is File => file instanceof File)
      if (uploads.length !== spec.slides || uploads.length > MAX_SLIDES) throw new CreativeError('INVALID_FILES', spec.kind === 'carrusel' ? `El carrusel debe traer ${spec.slides} imágenes` : 'Falta el archivo de la pieza')
      const count = await db.prepare(`SELECT COUNT(*) AS n FROM creative_pieces WHERE store_id = ? AND status <> 'rechazado'`).bind(ctx.storeId).first<{ n: number }>()
      if (Number(count?.n || 0) >= MAX_PIECES_PER_STORE) throw new CreativeError('LIBRARY_FULL', 'Llegaste al límite de piezas guardadas. Rechaza las que ya no uses.', 409)
      const checked: Array<{ bytes: Uint8Array; contentType: string; width: number | null; height: number | null; durationMs: number | null }> = []
      for (const file of uploads) {
        const bytes = new Uint8Array(await file.arrayBuffer())
        if (spec.kind === 'video') {
          const type = sniffVideoType(bytes)
          if (!type) throw new CreativeError('INVALID_VIDEO', 'El video debe ser MP4 o WebM')
          if (bytes.length > MAX_VIDEO_BYTES) throw new CreativeError('VIDEO_TOO_LARGE', 'El video pesa más de 40 MB')
          const durationMs = Number(input.durationMs)
          const expected = (spec.seconds || 0) * 1000
          if (!Number.isFinite(durationMs) || Math.abs(durationMs - expected) > 1500) throw new CreativeError('INVALID_DURATION', 'La duración del video no coincide con la plantilla')
          const short = VIDEO_SHORT_SIDE[spec.quality]
          const scale = short / Math.min(spec.width, spec.height)
          checked.push({ bytes, contentType: type, width: Math.round(spec.width * scale / 2) * 2, height: Math.round(spec.height * scale / 2) * 2, durationMs: Math.round(durationMs) })
        } else {
          const type = sniffImageType(bytes)
          if (!type) throw new CreativeError('INVALID_IMAGE', 'La imagen debe ser JPG, PNG o WebP')
          if (bytes.length > MAX_IMAGE_BYTES) throw new CreativeError('IMAGE_TOO_LARGE', 'La imagen pesa más de 6 MB')
          const dimensions = imageDimensions(bytes)
          // La resolución es la del formato elegido, exacta.
          if (!dimensions || dimensions.width !== spec.width || dimensions.height !== spec.height) throw new CreativeError('INVALID_RESOLUTION', `La imagen debe medir ${spec.width} × ${spec.height} px`)
          checked.push({ bytes, contentType: type, width: dimensions.width, height: dimensions.height, durationMs: null })
        }
      }
      const id = crypto.randomUUID()
      const stored: PieceFile[] = []
      for (const [index, file] of checked.entries()) {
        const extension = file.contentType === 'video/mp4' ? 'mp4' : file.contentType === 'video/webm' ? 'webm' : file.contentType === 'image/png' ? 'png' : file.contentType === 'image/webp' ? 'webp' : 'jpg'
        const objectKey = `creative-private/stores/${ctx.storeId}/pieces/${id}-${index + 1}.${extension}`
        await storage().put(objectKey, file.bytes, { httpMetadata: { contentType: file.contentType }, customMetadata: { storeId: String(ctx.storeId), pieceId: id } })
        stored.push({ key: objectKey, contentType: file.contentType, bytes: file.bytes.length, width: file.width, height: file.height, durationMs: file.durationMs })
      }
      const inserted = await db.prepare(
        `INSERT OR IGNORE INTO creative_pieces (id, store_id, kind, mode, template, format, product_ids_json, copy_json, spec_json, spec_hash, files_json, idempotency_key, created_by)
         VALUES (?, ?, ?, 'convencional', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(id, ctx.storeId, spec.kind, spec.template, spec.format, JSON.stringify(spec.productIds), JSON.stringify(planned.copy), JSON.stringify(spec), planned.specHash, JSON.stringify(stored), key, ctx.actor.slice(0, 160)).run()
      if (!inserted.meta?.changes) {
        await deleteFiles(stored)
        const raced = await db.prepare(`${SELECT} WHERE p.store_id = ? AND p.idempotency_key = ?`).bind(ctx.storeId, key).first<Row>()
        return { piece: toPiece(raced!), replayed: true, reused: false }
      }
      // «Editar texto»: la versión nueva sustituye a la anterior si seguía pendiente.
      if (validId(input.replaces)) {
        const previous = await find(ctx.storeId, input.replaces)
        if (previous && previous.status === 'pendiente' && previous.mode === 'convencional') {
          await db.prepare(`UPDATE creative_pieces SET status = 'rechazado', files_json = '[]', reviewed_by = ?, updated_at = datetime('now') WHERE id = ? AND store_id = ? AND status = 'pendiente'`).bind(ctx.actor.slice(0, 160), previous.id, ctx.storeId).run()
          await deleteFiles(parse<PieceFile[]>(previous.files_json, []))
        }
      }
      await audit(ctx, 'creative_piece_created', id, { kind: spec.kind, template: spec.template, format: spec.format })
      return { piece: toPiece((await find(ctx.storeId, id))!), replayed: false, reused: false }
    },

    /** Registra un video generativo ya producido por el motor (creative/videoEngine.ts). */
    async saveGenerated(ctx: CreativeContext, input: { spec: Record<string, unknown>; specHash: string; template: string; format: string; productIds: number[]; bytes: Uint8Array; contentType: 'video/mp4' | 'video/webm'; width: number; height: number; durationMs: number; model: string; credits: number; costMicros: number; jobId: string }) {
      const id = crypto.randomUUID()
      const objectKey = `creative-private/stores/${ctx.storeId}/pieces/${id}-1.${input.contentType === 'video/mp4' ? 'mp4' : 'webm'}`
      await storage().put(objectKey, input.bytes, { httpMetadata: { contentType: input.contentType }, customMetadata: { storeId: String(ctx.storeId), pieceId: id } })
      const files: PieceFile[] = [{ key: objectKey, contentType: input.contentType, bytes: input.bytes.length, width: input.width, height: input.height, durationMs: input.durationMs }]
      try {
        await db.prepare(
          `INSERT INTO creative_pieces (id, store_id, kind, mode, template, format, product_ids_json, spec_json, spec_hash, files_json, model, credits, cost_micros, job_id, idempotency_key, created_by)
           VALUES (?, ?, 'video', 'video_ia', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(id, ctx.storeId, input.template, input.format, JSON.stringify(input.productIds), JSON.stringify(input.spec), input.specHash, JSON.stringify(files), input.model, input.credits, input.costMicros, input.jobId, `job:${input.jobId}`, ctx.actor.slice(0, 160)).run()
      } catch (error) { await deleteFiles(files); throw error }
      return toPiece((await find(ctx.storeId, id))!)
    },

    async findReusable(storeId: number, hash: string) {
      const row = await db.prepare(`${SELECT} WHERE p.store_id = ? AND p.spec_hash = ? AND p.status <> 'rechazado' AND p.files_json <> '[]' ORDER BY p.created_at DESC LIMIT 1`).bind(storeId, hash).first<Row>()
      return row ? toPiece(row) : null
    },

    async get(ctx: CreativeContext, id: unknown) {
      const row = await find(ctx.storeId, id)
      return row ? toPiece(row) : null
    },

    async list(ctx: CreativeContext, filter: { status?: string; kind?: string; campaignId?: number; limit?: number } = {}) {
      const where = ['p.store_id = ?']
      const binds: unknown[] = [ctx.storeId]
      if (filter.status === 'pendiente' || filter.status === 'aprobado' || filter.status === 'rechazado') { where.push('p.status = ?'); binds.push(filter.status) } else where.push(`p.status <> 'rechazado'`)
      if (filter.kind === 'imagen' || filter.kind === 'carrusel' || filter.kind === 'video') { where.push('p.kind = ?'); binds.push(filter.kind) }
      if (filter.campaignId && Number.isSafeInteger(filter.campaignId)) { where.push('p.campaign_id = ?'); binds.push(filter.campaignId) }
      const limit = Math.min(Math.max(1, Number(filter.limit) || 60), 100)
      const { results } = await db.prepare(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY p.created_at DESC, p.id LIMIT ?`).bind(...binds, limit).all<Row>()
      return (results || []).map(toPiece)
    },

    /** Archivo privado de la pieza: solo para la tienda dueña, con sesión. */
    async readFile(ctx: CreativeContext, id: unknown, index: number) {
      const row = await need(ctx.storeId, id)
      const file = parse<PieceFile[]>(row.files_json, [])[index]
      const object = file ? await storage().get(file.key) : null
      if (!file || !object) throw new CreativeError('PIECE_NOT_FOUND', 'Pieza no encontrada', 404)
      return { body: object.body, contentType: file.contentType, bytes: file.bytes, name: `${row.template}-${row.format}-${row.id.slice(0, 8)}${parse<PieceFile[]>(row.files_json, []).length > 1 ? `-${index + 1}` : ''}.${file.key.split('.').pop()}` }
    },

    async review(ctx: CreativeContext, id: unknown, decision: 'aprobado' | 'rechazado') {
      const row = await need(ctx.storeId, id)
      if (row.status === decision) return toPiece(row)
      if (row.status === 'rechazado') throw new CreativeError('PIECE_REJECTED', 'Esta pieza ya fue rechazada', 409)
      const clear = decision === 'rechazado'
      const updated = await db.prepare(
        `UPDATE creative_pieces SET status = ?, reviewed_by = ?, updated_at = datetime('now')${clear ? `, files_json = '[]', campaign_id = NULL` : ''} WHERE id = ? AND store_id = ? AND status = ?`,
      ).bind(decision, ctx.actor.slice(0, 160), row.id, ctx.storeId, row.status).run()
      if (updated.meta?.changes && clear) await deleteFiles(parse<PieceFile[]>(row.files_json, []))
      await audit(ctx, decision === 'aprobado' ? 'creative_piece_approved' : 'creative_piece_rejected', row.id, { template: row.template })
      return toPiece((await find(ctx.storeId, row.id))!)
    },

    /** Asocia una pieza aprobada a una campaña existente de la tienda (tabla campaigns), o la desasocia con null. */
    async attachCampaign(ctx: CreativeContext, id: unknown, campaignId: unknown) {
      const row = await need(ctx.storeId, id)
      if (row.status !== 'aprobado') throw new CreativeError('PIECE_NOT_APPROVED', 'Aprueba la pieza antes de asociarla a una campaña', 409)
      let target: number | null = null
      if (campaignId !== null && campaignId !== undefined && campaignId !== '') {
        const campaign = await db.prepare('SELECT id, status FROM campaigns WHERE id = ? AND store_id = ?').bind(Number(campaignId) || 0, ctx.storeId).first<{ id: number; status: string }>()
        if (!campaign) throw new CreativeError('CAMPAIGN_NOT_FOUND', 'Campaña no encontrada', 404)
        if (campaign.status === 'cancelada') throw new CreativeError('CAMPAIGN_CANCELLED', 'Esa campaña está cancelada', 409)
        target = campaign.id
      }
      await db.prepare(`UPDATE creative_pieces SET campaign_id = ?, updated_at = datetime('now') WHERE id = ? AND store_id = ?`).bind(target, row.id, ctx.storeId).run()
      await audit(ctx, 'creative_piece_campaign', row.id, { campaignId: target })
      return toPiece((await find(ctx.storeId, row.id))!)
    },

    async campaigns(ctx: CreativeContext) {
      const { results } = await db.prepare(`SELECT id, name, status FROM campaigns WHERE store_id = ? AND status <> 'cancelada' ORDER BY id DESC LIMIT 50`).bind(ctx.storeId).all<{ id: number; name: string; status: string }>()
      return results || []
    },
  }
}

export type { CreativeFacts }
