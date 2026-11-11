/** Estudio Creativo IA · contratos de servicio internos.
 *
 * Cada módulo es un servicio independiente con su propia interfaz; ninguno conoce la implementación de otro.
 * Todos reciben un `CreativeContext` cuyo storeId lo resolvió el backend (adminAuth), nunca el cliente, y
 * comparten los servicios existentes de comercios (stores/store_config), productos (products/product_variants),
 * créditos (ai/credits.ts) y consumo de IA (ai/usage.ts).
 *
 * Estado en la fase 1: solo BrandKitService y CreativeJobService están implementados (brandKit.ts, jobs.ts).
 * El resto son contratos para las fases siguientes; no hay generadores conectados. */
import type { EffectiveRole } from '../tenancy/access'
import type { AiTask } from './aiRouter'

/** Quién actúa y sobre qué tienda. Lo construye la ruta a partir de adminAuth. */
export interface CreativeContext {
  storeId: number
  actor: string
  role: EffectiveRole
}

/** Un recurso referenciado por URL de la propia tienda (/api/assets/stores/<id>/…) o por clave privada de R2. */
export type AssetRef = { kind: 'public_url'; url: string } | { kind: 'private_key'; key: string }

// ---- Brand Kit (implementado) --------------------------------------------------------------

export interface BrandKit {
  brandName: string | null
  slogan: string | null
  tone: string | null
  targetAudience: string | null
  logoUrl: string | null
  colors: string[]
  fonts: string[]
  visualStyles: string[]
  favoriteTemplates: string[]
  revision: number
  updatedBy: string | null
  updatedAt: string | null
}
export type BrandKitPatch = Partial<Omit<BrandKit, 'revision' | 'updatedBy' | 'updatedAt'>> & { revision?: number }

export interface BrandKitService {
  get(ctx: CreativeContext): Promise<BrandKit>
  update(ctx: CreativeContext, patch: BrandKitPatch): Promise<BrandKit>
}

// ---- Trabajos creativos (implementado) ----------------------------------------------------

export type CreativeJobKind = 'foto' | 'video' | 'creativo' | 'oportunidades' | 'campana' | 'analitica'
export type CreativeJobStatus = 'pendiente' | 'en_proceso' | 'completado' | 'fallido' | 'cancelado'

export interface CreativeJob {
  id: string
  kind: CreativeJobKind
  status: CreativeJobStatus
  input: Record<string, unknown>
  result: Record<string, unknown> | null
  errorCode: string | null
  provider: string | null
  model: string | null
  attempts: number
  requestedBy: string
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
}

export interface CreativeJobService {
  create(ctx: CreativeContext, input: { kind: CreativeJobKind; idempotencyKey: string; input: Record<string, unknown> }): Promise<{ job: CreativeJob; replayed: boolean }>
  get(ctx: CreativeContext, id: string): Promise<CreativeJob | null>
  list(ctx: CreativeContext, filter?: { status?: CreativeJobStatus; limit?: number }): Promise<CreativeJob[]>
  cancel(ctx: CreativeContext, id: string): Promise<CreativeJob>
}

// ---- Contratos de fases siguientes (sin implementación) ------------------------------------

/** Biblioteca de recursos: originales privados en R2 (creative-private/stores/<id>/…), derivados aprobados públicos. */
export interface AssetLibraryService {
  list(ctx: CreativeContext, filter: { productId?: number; tag?: string; cursor?: string }): Promise<{ items: Array<{ id: string; ref: AssetRef; mimeType: string; bytes: number; productId: number | null; createdAt: string }>; cursor: string | null }>
  importProductImages(ctx: CreativeContext, productId: number): Promise<number>
  signedRead(ctx: CreativeContext, assetId: string): Promise<{ url: string; expiresAt: string }>
  remove(ctx: CreativeContext, assetId: string): Promise<void>
}

/** Motor fotográfico: edición fiel del producto (fondo, luz, escena). Reutiliza ai/imageStudio.ts. */
export interface PhotoEngine {
  enqueue(ctx: CreativeContext, input: { productId: number; source: AssetRef; preset: string; idempotencyKey: string }): Promise<CreativeJob>
}

/** Motor de video: clips cortos a partir de fotos aprobadas del producto. */
export interface VideoEngine {
  enqueue(ctx: CreativeContext, input: { productId: number; sources: AssetRef[]; format: '9:16' | '1:1' | '16:9'; seconds: number; idempotencyKey: string }): Promise<CreativeJob>
}

/** Creativos publicitarios: piezas con textos y Brand Kit aplicados mediante plantillas (render convencional). */
export interface AdCreativeEngine {
  enqueue(ctx: CreativeContext, input: { productIds: number[]; templateKey: string; channel: string; idempotencyKey: string }): Promise<CreativeJob>
}

/** Oportunidades: sugerencias basadas solo en datos reales de la tienda (inventario, pedidos, visitas). */
export interface OpportunityEngine {
  scan(ctx: CreativeContext, idempotencyKey: string): Promise<CreativeJob>
  list(ctx: CreativeContext): Promise<Array<{ id: string; kind: string; productId: number | null; evidence: Record<string, number>; createdAt: string }>>
}

/** Campañas creativas. Debe convivir con la tabla campaigns existente (mensajes de WhatsApp con cupón). */
export interface CampaignEngine {
  draft(ctx: CreativeContext, input: { name: string; productIds: number[]; idempotencyKey: string }): Promise<{ campaignId: number }>
  attachContent(ctx: CreativeContext, campaignId: number, jobId: string): Promise<void>
}

/** Analítica comercial: lee pedidos/inventario existentes. Las visitas aún no se registran en la plataforma. */
export interface CommercialAnalyticsService {
  summary(ctx: CreativeContext, range: { from: string; to: string }): Promise<{ orders: number; revenue: number; visits: number | null }>
}

/** Aprobaciones: nada generado se publica sin la aprobación de un owner/admin de la tienda. */
export interface ApprovalService {
  request(ctx: CreativeContext, jobId: string): Promise<{ approvalId: string }>
  decide(ctx: CreativeContext, approvalId: string, decision: 'aprobado' | 'rechazado', note?: string): Promise<void>
}

/** Control de créditos: fachada sobre ai/credits.ts (ledger con reservas); no crea un segundo saldo. */
export interface CreativeCreditsService {
  quote(ctx: CreativeContext, task: AiTask, units: number): Promise<{ credits: number | null; feature: string }>
  reserve(ctx: CreativeContext, input: { feature: string; credits: number; idempotencyKey: string }): Promise<{ reservationId: number } | { blocked: string }>
  settle(reservationId: number, outcome: 'consumo' | 'liberacion'): Promise<boolean>
}
