/** Motor fotográfico del Estudio Creativo.
 *
 * Nivel A (convencional): recorte, encuadre, tamaño, compresión y formato. Se hace en el navegador del
 *   comerciante, sin IA y sin créditos; el servidor solo guarda el resultado en la biblioteca.
 * Nivel B (packshot) y C (composición premium): modelo de imagen elegido por el enrutador, detrás del
 *   interruptor de IA de la tienda, su presupuesto mensual y los créditos (ai/credits.ts).
 *
 * Las instrucciones son textos fijos de la plataforma: el comerciante elige una operación, nunca escribe el
 * prompt. El original no se modifica y cada resultado queda «pendiente» hasta que el comercio lo aprueba. */
import type { Env } from '../index'
import { creditSummary, runWithCredits, validIdempotencyKey, type AiCreditFeature } from '../ai/credits'
import { geminiFailureCode, UNTRUSTED_CONTENT_RULE } from '../ai/geminiClient'
import { editPhotoWithInstruction } from '../ai/imageStudio'
import { estimateCostMicros } from '../ai/usage'
import { buildCatalog, routeTask } from './aiRouter'
import { CreativeError } from './brandKit'
import type { CreativeContext, CreativeJob } from './contracts'
import { fromBase64, sniffImageType, toBase64 } from './imageInfo'
import { cancelBatch, claimJob, creativeJobService, finishJob, listBatchJobs, MAX_ACTIVE_JOBS_PER_STORE } from './jobs'
import { assetLibrary, type CreativeAsset } from './library'

export type PhotoLevel = 'A' | 'B' | 'C'
export interface PhotoOperation {
  level: PhotoLevel
  label: string
  description: string
  runsIn: 'navegador' | 'ia'
  /** false = aún no se ofrece; `note` explica por qué, sin prometer fechas. */
  available: boolean
  note?: string
  instruction?: string
}

export const PHOTO_LEVELS: Record<PhotoLevel, { label: string; description: string; feature: AiCreditFeature | null }> = {
  A: { label: 'Edición convencional', description: 'Recorte, encuadre, tamaño, compresión y formato. Sin IA y sin costo.', feature: null },
  B: { label: 'Packshot inteligente', description: 'Fondo limpio, luz de estudio y sombra natural con IA.', feature: 'foto_packshot' },
  C: { label: 'Composición premium', description: 'El producto en un escenario comercial o publicitario con IA.', feature: 'foto_premium' },
}

export const PHOTO_OPERATIONS: Record<string, PhotoOperation> = {
  // ---- Nivel A: se ejecuta en el navegador (frontend/src/lib/photoEdit.ts) ----
  cuadrado: { level: 'A', runsIn: 'navegador', available: true, label: 'Recorte cuadrado', description: 'Recorta al centro en formato 1:1.' },
  encuadre_blanco: { level: 'A', runsIn: 'navegador', available: true, label: 'Encuadre sobre blanco', description: 'Centra la foto completa en un lienzo cuadrado blanco, sin recortarla.' },
  redimensionar: { level: 'A', runsIn: 'navegador', available: true, label: 'Redimensionar', description: 'Reduce el lado mayor a 1600 px.' },
  comprimir: { level: 'A', runsIn: 'navegador', available: true, label: 'Comprimir (WebP)', description: 'Convierte a WebP para que la tienda cargue más rápido.' },
  convertir_jpg: { level: 'A', runsIn: 'navegador', available: true, label: 'Convertir a JPG', description: 'Formato compatible con cualquier red social.' },
  auto_luz: { level: 'A', runsIn: 'navegador', available: true, label: 'Ajuste básico de luz', description: 'Corrige brillo y contraste de forma automática.' },
  // ---- Nivel B: packshot ----
  fondo_blanco: {
    level: 'B', runsIn: 'ia', available: true, label: 'Fondo blanco', description: 'El producto sobre blanco puro, con sombra suave.',
    instruction: 'Coloca el producto sobre un fondo blanco puro y uniforme de estudio, con una sombra suave y natural debajo. Elimina el fondo original y cualquier objeto que no sea parte del producto.',
  },
  iluminacion_estudio: {
    level: 'B', runsIn: 'ia', available: true, label: 'Iluminación de estudio', description: 'Mejora luz, nitidez y balance de blancos; mismo fondo.',
    instruction: 'Mejora la iluminación como en un estudio fotográfico: luz suave y pareja, nitidez y balance de blancos correctos. Conserva el mismo fondo y el mismo encuadre.',
  },
  sombra_natural: {
    level: 'B', runsIn: 'ia', available: true, label: 'Fondo neutro con sombra natural', description: 'Fondo gris claro de estudio y sombra realista.',
    instruction: 'Coloca el producto sobre un fondo neutro de estudio, gris muy claro con un degradado suave, y agrega una sombra de contacto natural y realista debajo.',
  },
  quitar_objetos: {
    level: 'B', runsIn: 'ia', available: true, label: 'Quitar objetos ajenos', description: 'Retira manos, soportes u objetos que no son el producto.',
    instruction: 'Retira de la imagen las manos, soportes, cables, etiquetas de precio sueltas y cualquier objeto que no forme parte del producto, rellenando el fondo de forma natural. Conserva el fondo y el encuadre originales.',
  },
  corregir_perspectiva: {
    level: 'B', runsIn: 'ia', available: true, label: 'Corregir perspectiva', description: 'Endereza el producto cuando la foto está inclinada. No siempre es fiable: revisa el resultado.',
    instruction: 'Endereza la fotografía para que el producto se vea de frente y nivelado, corrigiendo la inclinación de la cámara. Si la corrección obligara a inventar partes que no se ven, no la hagas y devuelve la imagen con el mismo encuadre.',
  },
  fondo_transparente: {
    level: 'B', runsIn: 'ia', available: false, label: 'Fondo transparente', description: 'Producto recortado en PNG sin fondo.',
    note: 'El modelo de imagen configurado no entrega transparencia real. Usa «Fondo blanco» mientras tanto.',
  },
  // ---- Nivel C: composición premium ----
  fondo_publicitario: {
    level: 'C', runsIn: 'ia', available: true, label: 'Fondo publicitario', description: 'Fondo de color con degradado y luz de anuncio.',
    instruction: 'Presenta el producto como en un anuncio: fondo liso de un color que armonice con el producto, con degradado suave, luz dirigida y sombra definida. Sin textos ni otros objetos.',
  },
  escenario_comercial: {
    level: 'C', runsIn: 'ia', available: true, label: 'Escenario comercial', description: 'Sobre una superficie real (mesa, repisa) con ambiente desenfocado.',
    instruction: 'Coloca el producto sobre una superficie realista y limpia (mesa o repisa) con un ambiente interior luminoso y desenfocado al fondo. El producto es el protagonista y ocupa el centro.',
  },
  en_local: {
    level: 'C', runsIn: 'ia', available: true, label: 'Presentación en local', description: 'Exhibido en la vitrina o estantería de una tienda.',
    instruction: 'Muestra el producto exhibido en la vitrina o estantería de una tienda física ordenada y bien iluminada, con el fondo ligeramente desenfocado. No agregues letreros, precios ni marcas.',
  },
  editorial: {
    level: 'C', runsIn: 'ia', available: true, label: 'Luz y sombra editorial', description: 'Luz lateral dramática y sombras marcadas, estilo revista.',
    instruction: 'Fotografía editorial del producto: luz lateral cálida, sombras marcadas y alargadas, fondo de un solo tono. Estilo de revista, sin textos.',
  },
  escena_categoria: {
    level: 'C', runsIn: 'ia', available: true, label: 'Escena según la categoría', description: 'Un ambiente acorde con la categoría del producto en tu tienda.',
    instruction: 'Presenta el producto en un ambiente realista y coherente con su categoría{categoria}. El producto es el protagonista; el entorno acompaña sin taparlo y sin incluir otros productos a la venta.',
  },
  modelo_virtual: {
    level: 'C', runsIn: 'ia', available: false, label: 'Modelo virtual o maniquí', description: 'El producto puesto en un maniquí o modelo adulto.',
    note: 'Todavía no se ofrece: vestir un producto en una persona generada puede alterar su forma, talla y caída.',
  },
}

export const MAX_BATCH_ITEMS = 50

/** Reglas de fidelidad para B y C: el fondo y la luz pueden cambiar; el producto, nunca. */
const FIDELITY_RULES = [
  'Eres un retocador de fotografía de producto para una tienda en línea.',
  'El producto es intocable: conserva exactamente su forma, proporciones, colores, materiales, texturas, costuras, estampados, etiquetas, textos, marcas y logotipos visibles.',
  'No inventes partes que no se ven, no cambies el color ni el modelo del producto, no agregues ni quites logotipos, y no agregues textos, precios, sellos ni marcas de agua.',
  'Mantén el producto en la misma posición, ángulo, tamaño relativo y encuadre de la foto original: no lo gires, no lo voltees ni lo reubiques.',
  'Si el borde de la foto corta el producto, déjalo cortado en el mismo lugar: no completes ni dibujes las partes que quedan fuera de la imagen.',
  'La luz nueva no debe cambiar el color real del producto: un producto blanco sigue viéndose blanco.',
  'Solo puedes cambiar lo que la instrucción pide sobre el fondo, la luz, la sombra o el entorno.',
  'Devuelve una sola imagen fotorrealista del mismo producto.',
  UNTRUSTED_CONTENT_RULE,
]

/** Códigos de fallo estables que el panel traduce. */
const GATE_ERROR: Record<string, string> = {
  ai_unavailable: 'AI_UNAVAILABLE', disabled: 'AI_DISABLED', feature_disabled: 'FEATURE_PAUSED', budget_exhausted: 'BUDGET_EXHAUSTED',
  store_unavailable: 'STORE_UNAVAILABLE', platform_cap: 'PLATFORM_CAP', no_credits: 'NO_CREDITS', duplicate: 'DUPLICATE',
}

type EngineEnv = Env['Bindings']
const systemCtx = (storeId: number, actor: string): CreativeContext => ({ storeId, actor, role: 'owner' })

function operation(key: unknown): PhotoOperation & { key: string } {
  if (typeof key !== 'string' || !Object.hasOwn(PHOTO_OPERATIONS, key)) throw new CreativeError('INVALID_OPERATION', 'Elige un tipo de mejora válido')
  return { key, ...PHOTO_OPERATIONS[key]! }
}

/** Modelo para el nivel: B prioriza costo, C prioriza calidad (usa lo más sencillo que cumple). */
function modelFor(env: EngineEnv, level: PhotoLevel) {
  const decision = routeTask(buildCatalog(env), { task: 'edicion_foto', prefer: level === 'C' ? 'calidad' : 'costo' }, { GEMINI_API_KEY: Boolean(env.GEMINI_API_KEY) })
  return decision.ok && decision.entry.provider === 'gemini' ? decision.entry : null
}

async function unitCost(db: D1Database, feature: AiCreditFeature) {
  const row = await db.prepare('SELECT credits, enabled FROM ai_credit_costs WHERE feature = ?').bind(feature).first<{ credits: number; enabled: number }>()
  return { configured: Boolean(row), credits: Number(row?.credits || 0), enabled: row ? Boolean(row.enabled) : true }
}

/** Lo que el panel necesita para ofrecer operaciones con honestidad: disponibilidad y precio por foto. */
export async function photoCatalog(env: EngineEnv, storeId: number) {
  const store = await env.DB.prepare('SELECT ai_enabled FROM stores WHERE id = ?').bind(storeId).first<{ ai_enabled: number }>()
  const aiEnabled = Boolean(store?.ai_enabled) && Boolean(env.GEMINI_API_KEY)
  const levels = await Promise.all((Object.keys(PHOTO_LEVELS) as PhotoLevel[]).map(async (level) => {
    const info = PHOTO_LEVELS[level]
    const cost = info.feature ? await unitCost(env.DB, info.feature) : null
    const model = info.feature ? modelFor(env, level) : null
    return {
      level, label: info.label, description: info.description,
      available: !info.feature || (aiEnabled && Boolean(model) && cost!.enabled),
      // null = la plataforma aún no fijó un precio en créditos (usa el límite mensual del plan).
      creditsPerPhoto: info.feature ? (cost!.configured ? cost!.credits : null) : 0,
    }
  }))
  const operations = Object.entries(PHOTO_OPERATIONS).map(([key, op]) => ({ key, level: op.level, label: op.label, description: op.description, runsIn: op.runsIn, available: op.available, note: op.note ?? null }))
  return { aiEnabled, levels, operations, maxBatchItems: MAX_BATCH_ITEMS, balance: (await creditSummary(env.DB, storeId)).balance }
}

export async function quotePhotoBatch(env: EngineEnv, ctx: CreativeContext, operationKey: unknown, count: unknown) {
  const op = operation(operationKey)
  const items = Number(count)
  if (!Number.isInteger(items) || items < 1 || items > MAX_BATCH_ITEMS) throw new CreativeError('INVALID_COUNT', `Elige entre 1 y ${MAX_BATCH_ITEMS} fotos`)
  if (!op.available) throw new CreativeError('OPERATION_UNAVAILABLE', op.note || 'Esta mejora todavía no está disponible', 409)
  const feature = PHOTO_LEVELS[op.level].feature
  const cost = feature ? await unitCost(env.DB, feature) : { configured: true, credits: 0, enabled: true }
  const total = cost.credits * items
  const balance = (await creditSummary(env.DB, ctx.storeId)).balance
  return {
    operation: op.key, level: op.level, runsIn: op.runsIn, count: items,
    creditsPerPhoto: cost.credits, priceConfigured: cost.configured, totalCredits: total, balance,
    enough: balance >= total, paused: !cost.enabled,
  }
}

type BatchItemInput = { productId?: unknown; imageUrl?: unknown; assetId?: unknown; telegramBatchId?: unknown; telegramItemId?: unknown }

/** Crea un lote: un trabajo por foto. Las fotos que no se pueden tomar se informan sin tumbar el resto. */
export async function createPhotoBatch(env: EngineEnv, ctx: CreativeContext, body: { operation?: unknown; items?: unknown; confirmCredits?: unknown }, key: string) {
  if (!validIdempotencyKey(key) || key.length > 80) throw new CreativeError('INVALID_IDEMPOTENCY_KEY', 'Falta el encabezado Idempotency-Key')
  const existing = await listBatchJobs(env.DB, ctx.storeId, key)
  if (existing.length) return { ...(await photoBatchStatus(env, ctx, key)), replayed: true, skipped: [] as Array<{ index: number; code: string; message: string }> }
  const op = operation(body.operation)
  if (op.runsIn !== 'ia') throw new CreativeError('BROWSER_OPERATION', 'La edición convencional se hace en el navegador y no crea trabajos')
  const items = Array.isArray(body.items) ? body.items as BatchItemInput[] : []
  const quote = await quotePhotoBatch(env, ctx, op.key, items.length)
  if (quote.paused) throw new CreativeError('FEATURE_PAUSED', 'Esta función de IA está pausada por la plataforma.', 409)
  if (!env.GEMINI_API_KEY || !modelFor(env, op.level)) throw new CreativeError('AI_UNAVAILABLE', 'La IA de imágenes todavía no está activada en esta plataforma.', 409)
  // Confirmación explícita del costo que el comercio vio en pantalla.
  if (Number(body.confirmCredits) !== quote.totalCredits) throw new CreativeError('CONFIRMATION_REQUIRED', 'Confirma el costo del lote antes de empezar', 409)
  if (!quote.enough) throw new CreativeError('NO_CREDITS', `Este lote cuesta ${quote.totalCredits} créditos y tienes ${quote.balance}. Pide una recarga en «Créditos IA» o elige menos fotos.`, 409)
  const queued = await env.DB.prepare(`SELECT COUNT(*) AS n FROM creative_jobs WHERE store_id = ? AND status IN ('pendiente', 'en_proceso')`).bind(ctx.storeId).first<{ n: number }>()
  if (Number(queued?.n || 0) + items.length > MAX_ACTIVE_JOBS_PER_STORE) throw new CreativeError('TOO_MANY_JOBS', 'Tu tienda tiene demasiados trabajos en cola. Espera a que terminen.', 429)

  const library = assetLibrary(env.DB, env.ASSETS)
  const jobs = creativeJobService(env.DB)
  const skipped: Array<{ index: number; code: string; message: string }> = []
  const seen = new Set<string>()
  for (const [index, item] of items.entries()) {
    try {
      let asset: CreativeAsset | null
      if (item?.assetId) {
        asset = await library.get(ctx, item.assetId)
        if (!asset || asset.role !== 'original' || !asset.hasFile) throw new CreativeError('ASSET_NOT_FOUND', 'Recurso no encontrado', 404)
      } else if (item?.telegramBatchId) asset = (await library.importTelegramItem(ctx, item.telegramBatchId, item.telegramItemId)).asset
      else asset = (await library.importProductImage(ctx, item?.productId, item?.imageUrl)).asset
      if (seen.has(asset.id)) throw new CreativeError('DUPLICATE_PHOTO', 'Esta foto ya está en el lote')
      seen.add(asset.id)
      await jobs.create(ctx, { kind: 'foto', idempotencyKey: `${key}:${index}`, batchId: key, input: { operation: op.key, level: op.level, assetId: asset.id, productId: asset.productId } })
    } catch (error) {
      if (!(error instanceof CreativeError)) throw error
      skipped.push({ index, code: error.code, message: error.message })
    }
  }
  if (seen.size) await env.DB.prepare(`INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id) VALUES ('creative_batch_created', 'creative_job', ?, ?, ?, 'admin', ?)`)
    .bind(key, JSON.stringify({ operation: op.key, jobs: seen.size, skipped: skipped.length, creditsPerPhoto: quote.creditsPerPhoto }), ctx.actor, ctx.storeId).run()
  return { ...(await photoBatchStatus(env, ctx, key)), replayed: false, skipped }
}

export async function photoBatchStatus(env: EngineEnv, ctx: CreativeContext, batchId: string) {
  const jobs = validIdempotencyKey(batchId) ? await listBatchJobs(env.DB, ctx.storeId, batchId) : []
  const counts = { pendiente: 0, en_proceso: 0, completado: 0, fallido: 0, cancelado: 0 }
  for (const job of jobs) counts[job.status]++
  return {
    batchId, total: jobs.length, counts, done: jobs.length > 0 && counts.pendiente + counts.en_proceso === 0,
    creditsCharged: jobs.reduce((sum, job) => sum + Number(job.result?.credits || 0), 0),
    jobs: jobs.map((job) => ({
      id: job.id, status: job.status, errorCode: job.errorCode, attempts: job.attempts, operation: String(job.input.operation || ''),
      sourceAssetId: String(job.input.assetId || ''), productId: typeof job.input.productId === 'number' ? job.input.productId : null,
      resultAssetId: typeof job.result?.assetId === 'string' ? job.result.assetId : null, credits: Number(job.result?.credits || 0),
    })),
  }
}

export const cancelPhotoBatch = (env: EngineEnv, ctx: CreativeContext, batchId: string) => cancelBatch(env.DB, ctx, batchId)

/** Ejecuta un trabajo de foto. Devuelve null si no se pudo tomar (ya no está pendiente o la tienda está ocupada). */
export async function runPhotoJob(env: EngineEnv, storeId: number, jobId: string, fetcher: typeof fetch = fetch): Promise<CreativeJob | null> {
  const job = await claimJob(env.DB, storeId, jobId)
  if (!job) return null
  const ctx = systemCtx(storeId, job.requestedBy)
  const jobs = creativeJobService(env.DB)
  const fail = async (errorCode: string, model?: string | null) => {
    await finishJob(env.DB, storeId, job.id, { status: 'fallido', errorCode, provider: model ? 'gemini' : null, model: model ?? null })
    return (await jobs.get(ctx, job.id))!
  }
  try {
    if (job.kind !== 'foto') return await fail('UNSUPPORTED_KIND')
    const op = PHOTO_OPERATIONS[String(job.input.operation)]
    const feature = op ? PHOTO_LEVELS[op.level].feature : null
    if (!op || !op.available || !op.instruction || !feature) return await fail('OPERATION_UNAVAILABLE')
    const library = assetLibrary(env.DB, env.ASSETS)
    const source = await library.readBytes(storeId, String(job.input.assetId))
    if (!source || source.row.role !== 'original') return await fail('ORIGINAL_NOT_FOUND')
    const entry = modelFor(env, op.level)
    if (!entry) return await fail('AI_UNAVAILABLE')
    let instruction = op.instruction
    if (instruction.includes('{categoria}')) {
      const category = source.row.productId ? await env.DB.prepare('SELECT c.name FROM products p JOIN categories c ON c.id = p.category_id WHERE p.id = ? AND p.store_id = ?').bind(source.row.productId, storeId).first<{ name: string }>() : null
      const name = (category?.name || '').replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 40)
      instruction = instruction.replace('{categoria}', name ? ` («${name}»)` : '')
    }
    // El modelo de imagen tiene su propio precio de salida para el presupuesto mensual.
    const pricing = { ...env, GEMINI_PRICE_OUTPUT_MICROS_PER_MTOK: env.GEMINI_IMAGE_PRICE_OUTPUT_MICROS_PER_MTOK || env.GEMINI_PRICE_OUTPUT_MICROS_PER_MTOK }
    const cost = await unitCost(env.DB, feature)
    const run = await runWithCredits(env.DB, pricing, { storeId, feature, key: `job:${job.id}:${job.attempts}`, actor: job.requestedBy }, async () => {
      const output = await editPhotoWithInstruction(env, fetcher, { mimeType: source.contentType, data: toBase64(source.bytes) }, instruction, entry.model, FIDELITY_RULES)
      const bytes = fromBase64(output.image.data)
      if (!sniffImageType(bytes)) throw Object.assign(new Error('Invalid image output'), { failure: 'INVALID_OUTPUT', usage: output.usage })
      // Guardar dentro de la reserva: si falla el guardado, los créditos se devuelven.
      const asset = await library.saveResult(ctx, {
        sourceId: source.row.id, bytes, level: op.level, operation: String(job.input.operation), model: output.model,
        credits: cost.credits, costMicros: estimateCostMicros(pricing, output.usage), jobId: job.id, origin: 'ia',
      })
      return { usage: output.usage, model: output.model, asset }
    })
    if (!run.ok) {
      if (run.reason === 'error') {
        const code = geminiFailureCode(run.error)
        console.error('Photo job failed:', code)
        return await fail(code, entry.model)
      }
      return await fail(GATE_ERROR[run.reason] || 'AI_BLOCKED', entry.model)
    }
    await finishJob(env.DB, storeId, job.id, { status: 'completado', provider: 'gemini', model: run.value.model, result: { assetId: run.value.asset.id, credits: run.charged, costMicros: run.value.asset.costMicros } })
    return (await jobs.get(ctx, job.id))!
  } catch (error) {
    console.error('Photo job crashed:', error instanceof Error ? error.message : 'unknown')
    return await fail('INTERNAL_ERROR')
  }
}

/** Segundo plano (cron): avanza los trabajos pendientes más antiguos aunque el panel esté cerrado. */
export async function processPendingPhotoJobs(env: EngineEnv, limit = 4): Promise<number> {
  if (!env.GEMINI_API_KEY || !env.ASSETS) return 0
  const { results } = await env.DB.prepare(`SELECT id, store_id AS storeId FROM creative_jobs WHERE kind = 'foto' AND status = 'pendiente' ORDER BY created_at LIMIT ?`).bind(limit).all<{ id: string; storeId: number }>()
  let processed = 0
  for (const row of results || []) if (await runPhotoJob(env, row.storeId, row.id)) processed++
  return processed
}
