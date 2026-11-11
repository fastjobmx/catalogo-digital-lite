/** Enrutador de IA del Estudio Creativo.
 *
 * Separa las tareas (análisis de texto, análisis visual, edición fotográfica, generación de imagen, generación
 * de video y render convencional) de los proveedores/modelos que las resuelven, y elige uno por costo, calidad,
 * resolución, latencia, disponibilidad y límites. Es una función pura sobre un catálogo: no llama a ningún
 * proveedor y no cambia los flujos existentes (gemini.ts, imageStudio.ts siguen usando GEMINI_MODEL y
 * GEMINI_IMAGE_MODEL tal como hoy).
 *
 * El catálogo por defecto se arma solo con lo que la instalación ya tiene configurado (Gemini). Se puede ampliar
 * con la variable CREATIVE_AI_MODELS (JSON, sin secretos) cuando se conecte otro proveedor o modelo. */
import type { Env } from '../index'

export type AiTask = 'texto' | 'vision' | 'edicion_foto' | 'imagen' | 'video' | 'render'
export const AI_TASKS: Record<AiTask, string> = {
  texto: 'Análisis de texto',
  vision: 'Análisis visual',
  edicion_foto: 'Edición fotográfica',
  imagen: 'Generación de imagen',
  video: 'Generación de video',
  render: 'Render convencional (plantillas, sin IA)',
}

export interface ModelEntry {
  provider: string
  model: string
  tasks: AiTask[]
  /** Credencial requerida en el Worker (nombre del secreto); el render convencional no requiere ninguna. */
  requiresSecret: string | null
  /** 1 (básica) a 3 (alta). Relativa dentro del catálogo, no una medición. */
  quality: 1 | 2 | 3
  /** 1 (rápida) a 3 (lenta). Relativa dentro del catálogo. */
  latency: 1 | 2 | 3
  /** Costo estimado por unidad en micro-USD, si la instalación lo configuró. null = desconocido. */
  unitCostMicros: number | null
  /** Lado mayor en píxeles que el modelo entrega, si se conoce. null = desconocido. */
  maxResolution: number | null
  /** Trabajos simultáneos permitidos por la plataforma para este modelo. */
  maxConcurrent: number
  enabled: boolean
}

export interface RouteRequest {
  task: AiTask
  prefer?: 'costo' | 'calidad' | 'latencia'
  minResolution?: number
  maxUnitCostMicros?: number
  allowPreview?: boolean
}

export type RouteDecision =
  | { ok: true; entry: ModelEntry; alternatives: ModelEntry[] }
  | { ok: false; reason: 'sin_modelo' | 'sin_credencial' | 'descontinuado' | 'requisitos'; detail: string }

/** Identificadores apagados o en retiro según la documentación oficial de Gemini API (consultada 2026-11-10).
 * Un modelo que coincida nunca se elige, aunque esté configurado. */
export const RETIRED_MODELS: RegExp[] = [
  /^imagen-4\.0-generate/, /^gemini-2\.0-flash/, /^gemini-3-pro-preview$/, /^gemini-3\.1-flash-lite-preview$/,
  /^gemini-2\.5-flash$/, /^gemini-2\.5-pro$/, /^gemini-2\.5-computer-use/, /^veo-3\.1-.*preview$/, /^gemini-omni-flash-preview$/, /^gemini-robotics-er-1\.6/,
]
export const isRetiredModel = (model: string) => RETIRED_MODELS.some((pattern) => pattern.test(model))
export const isPreviewModel = (model: string) => /-preview|-exp\b|-exp-/.test(model)

const cleanModel = (value: string | undefined) => (value || '').replace(/[^a-zA-Z0-9._-]/g, '')
const tier = (model: string): 1 | 2 | 3 => (/-pro\b|-pro-/.test(model) ? 3 : /lite/.test(model) ? 1 : 2)


/** Catálogo efectivo de la instalación: Gemini configurado + entradas extra de CREATIVE_AI_MODELS. */
export function buildCatalog(env: Partial<Env['Bindings']> & { CREATIVE_AI_MODELS?: string }): ModelEntry[] {
  const catalog: ModelEntry[] = []
  const textModel = cleanModel(env.GEMINI_MODEL) || 'gemini-3.8-flash'
  catalog.push({
    provider: 'gemini', model: textModel, tasks: ['texto', 'vision'], requiresSecret: 'GEMINI_API_KEY',
    quality: tier(textModel), latency: (4 - tier(textModel)) as 1 | 2 | 3, unitCostMicros: null, maxResolution: null, maxConcurrent: 4, enabled: true,
  })
  const imageModel = cleanModel(env.GEMINI_IMAGE_MODEL)
  if (imageModel) {
    catalog.push({
      provider: 'gemini', model: imageModel, tasks: ['edicion_foto', 'imagen'], requiresSecret: 'GEMINI_API_KEY',
      // GEMINI_IMAGE_PRICE_OUTPUT_MICROS_PER_MTOK es precio por millón de tokens, no por imagen: el costo
      // por unidad queda desconocido hasta medirlo con trabajos reales (ai_usage_events).
      quality: tier(imageModel), latency: 2, unitCostMicros: null,
      maxResolution: null, maxConcurrent: 2, enabled: true,
    })
  }
  // Video generativo: solo si la instalación configuró GEMINI_VIDEO_MODEL (no hay modelo por defecto).
  const videoModel = cleanModel((env as { GEMINI_VIDEO_MODEL?: string }).GEMINI_VIDEO_MODEL)
  if (videoModel) {
    catalog.push({ provider: 'gemini', model: videoModel, tasks: ['video'], requiresSecret: 'GEMINI_API_KEY', quality: tier(videoModel), latency: 3, unitCostMicros: null, maxResolution: 1280, maxConcurrent: 1, enabled: true })
  }
  // Render convencional (plantillas): composición determinista en el navegador del comercio, sin IA ni costo.
  catalog.push({ provider: 'navegador', model: 'render-plantillas', tasks: ['render'], requiresSecret: null, quality: 2, latency: 1, unitCostMicros: 0, maxResolution: 1920, maxConcurrent: 4, enabled: true })
  for (const extra of parseExtraModels(env.CREATIVE_AI_MODELS)) catalog.push(extra)
  return catalog
}

/** Entradas adicionales en JSON. Se ignoran las mal formadas; nunca contienen claves (solo el nombre del secreto). */
export function parseExtraModels(raw: string | undefined): ModelEntry[] {
  if (!raw) return []
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return [] }
  if (!Array.isArray(parsed)) return []
  const tasks = new Set(Object.keys(AI_TASKS))
  const level = (v: unknown, d: 1 | 2 | 3) => (v === 1 || v === 2 || v === 3 ? v : d)
  return parsed.flatMap((item): ModelEntry[] => {
    if (!item || typeof item !== 'object') return []
    const e = item as Record<string, unknown>
    const provider = cleanModel(String(e.provider || ''))
    const model = cleanModel(String(e.model || ''))
    const entryTasks = Array.isArray(e.tasks) ? e.tasks.filter((t): t is AiTask => typeof t === 'string' && tasks.has(t)) : []
    if (!provider || !model || !entryTasks.length) return []
    const secret = typeof e.requiresSecret === 'string' && /^[A-Z][A-Z0-9_]{2,60}$/.test(e.requiresSecret) ? e.requiresSecret : null
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null)
    return [{
      provider, model, tasks: entryTasks, requiresSecret: secret, quality: level(e.quality, 2), latency: level(e.latency, 2),
      unitCostMicros: num(e.unitCostMicros), maxResolution: num(e.maxResolution), maxConcurrent: Math.max(1, Math.min(20, Number(e.maxConcurrent) || 1)), enabled: e.enabled !== false,
    }]
  })
}

/** Elige el modelo para una tarea. `secrets` indica qué credenciales existen (sin exponer sus valores). */
export function routeTask(catalog: ModelEntry[], request: RouteRequest, secrets: Record<string, boolean>): RouteDecision {
  const forTask = catalog.filter((entry) => entry.tasks.includes(request.task) && entry.enabled)
  if (!forTask.length) return { ok: false, reason: 'sin_modelo', detail: `No hay un modelo configurado para: ${AI_TASKS[request.task]}` }
  const current = forTask.filter((entry) => !isRetiredModel(entry.model) && (request.allowPreview || !isPreviewModel(entry.model)))
  if (!current.length) return { ok: false, reason: 'descontinuado', detail: 'Los modelos configurados están descontinuados o solo en vista previa' }
  const reachable = current.filter((entry) => !entry.requiresSecret || secrets[entry.requiresSecret])
  if (!reachable.length) return { ok: false, reason: 'sin_credencial', detail: 'Falta la credencial del proveedor en el Worker' }
  const fits = reachable.filter((entry) =>
    (request.minResolution === undefined || (entry.maxResolution !== null && entry.maxResolution >= request.minResolution))
    && (request.maxUnitCostMicros === undefined || (entry.unitCostMicros !== null && entry.unitCostMicros <= request.maxUnitCostMicros)))
  if (!fits.length) return { ok: false, reason: 'requisitos', detail: 'Ningún modelo cumple la resolución o el costo pedidos' }
  const prefer = request.prefer || 'calidad'
  const cost = (e: ModelEntry) => e.unitCostMicros ?? Number.MAX_SAFE_INTEGER
  const sorted = [...fits].sort((a, b) =>
    prefer === 'costo' ? cost(a) - cost(b) || a.latency - b.latency
      : prefer === 'latencia' ? a.latency - b.latency || cost(a) - cost(b)
        : b.quality - a.quality || a.latency - b.latency)
  return { ok: true, entry: sorted[0]!, alternatives: sorted.slice(1) }
}

/** Resumen sin secretos para el panel: qué tareas tienen hoy un modelo utilizable. */
export function taskAvailability(env: Partial<Env['Bindings']> & { CREATIVE_AI_MODELS?: string }) {
  const catalog = buildCatalog(env)
  const secrets: Record<string, boolean> = { GEMINI_API_KEY: Boolean(env.GEMINI_API_KEY) }
  for (const entry of catalog) if (entry.requiresSecret && !(entry.requiresSecret in secrets)) secrets[entry.requiresSecret] = Boolean((env as Record<string, unknown>)[entry.requiresSecret])
  return (Object.keys(AI_TASKS) as AiTask[]).map((task) => {
    const decision = routeTask(catalog, { task }, secrets)
    return { task, label: AI_TASKS[task], available: decision.ok, provider: decision.ok ? decision.entry.provider : null, model: decision.ok ? decision.entry.model : null, reason: decision.ok ? null : decision.reason }
  })
}
