/** Generación por lotes: muchas piezas de muchos productos, una a la vez, en el equipo del comerciante.
 *
 * - Las fotos de un producto se cargan una sola vez (reducidas a 1600 px) para todas sus piezas y se liberan
 *   al pasar al siguiente producto: la memoria no crece con el tamaño del lote.
 * - Cada pieza pasa el control de calidad; si una composición falla, se prueba la siguiente del estilo.
 * - Reintenta los errores pasajeros (red, servidor); no reintenta los de datos (producto sin foto, etc.).
 * - Se puede cancelar en cualquier momento: lo ya generado sigue disponible en el ZIP.
 * - El ZIP se divide si supera el tamaño máximo (por defecto 1,5 GB), para no agotar la memoria del navegador. */
import type { PlanSpec } from './scene'
import { exportImages, exportVideo, loadImages, prepareDesign, releaseImages, sceneFor, type AssetLoader, type ImageMap, type OutputType } from './render'
import type { DesignContext } from './design/compose'
import { styleLayouts } from './design/compose'
import { ensureFonts } from './design/fonts'
import { checkScene } from './design/qa'
import { styleFonts } from './design/styles'
import { ZipWriter } from './zip'

export interface BatchJob { productId: number; productName: string; reference: string | null; format: string; kind: 'imagen' | 'video'; style: string }
export type BatchStatus = 'pendiente' | 'generando' | 'listo' | 'omitido' | 'error' | 'cancelado'
export interface BatchItem { job: BatchJob; status: BatchStatus; file?: string; layout?: string; bytes?: number; ms?: number; attempts?: number; message?: string; warnings?: number }
export interface BatchState {
  total: number; done: number; ok: number; failed: number; skipped: number
  current: string | null; items: BatchItem[]; zipBytes: number; zips: number; startedAt: number; elapsedMs: number
  /** Memoria de JavaScript en uso (solo Chrome y Edge la informan). */ heapMB: number | null
}
export interface BatchOptions {
  jobs: BatchJob[]
  /** Plan con los datos verificados por el servidor para un trabajo. */
  plan: (job: BatchJob) => Promise<PlanSpec>
  loadAsset: AssetLoader
  output?: OutputType | null
  music?: boolean
  signal?: AbortSignal
  retries?: number
  maxZipBytes?: number
  onProgress?: (state: BatchState) => void
  /** Cada ZIP terminado (si el lote se divide, se llama varias veces). */
  onZip?: (zip: Blob, index: number) => void
}

const safe = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'pieza'
const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError'
/** Errores de datos (4xx): reintentar no los arregla. */
const permanent = (error: unknown) => typeof (error as { status?: unknown })?.status === 'number' && (error as { status: number }).status >= 400 && (error as { status: number }).status < 500
const heap = () => { const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory; return memory ? Math.round(memory.usedJSHeapSize / 1048576) : null }
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function withRetries<T>(task: () => Promise<T>, retries: number, signal?: AbortSignal): Promise<{ value: T; attempts: number }> {
  let attempt = 0
  for (;;) {
    attempt++
    try { return { value: await task(), attempts: attempt } } catch (error) {
      if (isAbort(error) || permanent(error) || attempt > retries || signal?.aborted) throw error
      await pause(400 * attempt)
    }
  }
}

/** Primera composición del estilo que pasa el control de calidad en todas sus diapositivas. */
function chooseLayout(spec: PlanSpec, design: DesignContext): { spec: PlanSpec; warnings: number } | null {
  const style = spec.design!.style
  const order = [spec.design!.layout, ...styleLayouts(style).filter((layout) => layout !== spec.design!.layout)]
  for (const layout of order) {
    const candidate = { ...spec, design: { ...spec.design!, layout } }
    const reports = Array.from({ length: candidate.slides }, (_, slide) => checkScene(sceneFor(candidate, slide, design), candidate, slide, design))
    if (reports.every((report) => report.ok)) return { spec: candidate, warnings: reports.reduce((sum, report) => sum + report.warnings, 0) }
  }
  return null
}

export async function runBatch(options: BatchOptions): Promise<{ state: BatchState; zip: Blob | null }> {
  const retries = options.retries ?? 2
  const maxZip = options.maxZipBytes ?? 1.5 * 1024 ** 3
  const state: BatchState = { total: options.jobs.length, done: 0, ok: 0, failed: 0, skipped: 0, current: null, items: options.jobs.map((job) => ({ job, status: 'pendiente' })), zipBytes: 0, zips: 0, startedAt: Date.now(), elapsedMs: 0, heapMB: heap() }
  const emit = () => { state.elapsedMs = Date.now() - state.startedAt; state.heapMB = heap(); options.onProgress?.({ ...state, items: [...state.items] }) }
  let zip = new ZipWriter()
  const summary: string[] = ['producto;referencia;formato;tipo;estilo;composicion;archivo;estado;detalle']
  const flush = (final: boolean) => {
    if (!zip.count && !final) return
    if (final) {
      const csv = new Blob(['﻿' + summary.join('\n')], { type: 'text/csv' })
      return zip.add('resumen.csv', csv).then(() => { state.zips++; options.onZip?.(zip.finish(), state.zips) })
    }
    state.zips++
    options.onZip?.(zip.finish(), state.zips)
    zip = new ZipWriter()
    return Promise.resolve()
  }

  let loaded: { productId: number; image: string | null; images: ImageMap; design: DesignContext } | null = null
  const release = () => { if (loaded) { releaseImages(loaded.images); loaded = null } }

  try {
    for (const [index, item] of state.items.entries()) {
      if (options.signal?.aborted) { for (const rest of state.items.slice(index)) rest.status = 'cancelado'; break }
      const { job } = item
      item.status = 'generando'
      state.current = `${job.productName} · ${job.format}`
      emit()
      const started = performance.now()
      try {
        const planned = await withRetries(() => options.plan(job), retries, options.signal)
        let spec = planned.value
        const image = spec.products[0]?.image ?? null
        if (!loaded || loaded.productId !== job.productId || loaded.image !== image) {
          release()
          const result = await withRetries(() => loadImages(spec, options.loadAsset), retries, options.signal)
          const prepared = await prepareDesign(spec, result.value.images)
          loaded = { productId: job.productId, image, images: result.value.images, design: prepared.design }
        }
        await ensureFonts(styleFonts(job.style))
        const chosen = chooseLayout(spec, loaded.design)
        if (!chosen) {
          item.status = 'omitido'
          item.message = 'Ninguna composición del estilo pasó el control de calidad con esta foto.'
          state.skipped++
        } else {
          spec = chosen.spec
          const ext = spec.kind === 'video' ? 'mp4' : (options.output ?? (spec.quality === 'alta' ? 'png' : 'jpeg')).replace('jpeg', 'jpg')
          const folder = `${safe(job.reference || String(job.productId))}-${safe(job.productName)}`
          const base = `${folder}/${job.format}-${job.kind}-${safe(job.style)}-${spec.design!.layout}`
          const blobs = spec.kind === 'video'
            ? [(await exportVideo(spec, loaded.images, 'Inter', () => undefined, loaded.design, { music: options.music, signal: options.signal })).blob]
            : await exportImages(spec, loaded.images, 'Inter', loaded.design, options.output ?? null)
          let bytes = 0
          for (const [n, blob] of blobs.entries()) {
            const realExt = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : blob.type === 'video/mp4' ? 'mp4' : blob.type === 'video/webm' ? 'webm' : ext
            item.file = await zip.add(`${base}${blobs.length > 1 ? `-${n + 1}` : ''}.${realExt}`, blob)
            bytes += blob.size
          }
          item.status = 'listo'
          item.layout = spec.design!.layout
          item.bytes = bytes
          item.warnings = chosen.warnings
          item.attempts = planned.attempts
          state.ok++
          if (zip.size > maxZip) await flush(false)
        }
      } catch (error) {
        if (isAbort(error)) { item.status = 'cancelado'; for (const rest of state.items.slice(index + 1)) rest.status = 'cancelado'; break }
        item.status = 'error'
        item.message = error instanceof Error ? error.message : 'Error desconocido'
        state.failed++
      }
      item.ms = Math.round(performance.now() - started)
      summary.push([job.productName, job.reference ?? '', job.format, job.kind, job.style, item.layout ?? '', item.file ?? '', item.status, (item.message ?? '').replace(/;/g, ',')].map((cell) => `"${String(cell).replace(/"/g, "'")}"`).join(';'))
      state.done++
      emit()
      // Ceder el hilo entre piezas: la interfaz sigue respondiendo durante lotes largos.
      await pause(0)
    }
  } finally {
    release()
  }
  state.current = null
  const hasFiles = state.ok > 0
  let last: Blob | null = null
  if (hasFiles) {
    const previous = options.onZip
    options.onZip = (blob, n) => { last = blob; previous?.(blob, n) }
    await flush(true)
  }
  for (const item of state.items) if (item.status === 'pendiente' || item.status === 'generando') item.status = 'cancelado'
  emit()
  return { state, zip: last }
}
