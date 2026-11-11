/** Pintado y exportación de piezas comerciales en el navegador (Canvas 2D + WebCodecs).
 *
 * No usa IA ni servidores de render: el equipo del comerciante dibuja las capas de scene.ts y codifica el
 * archivo. Los videos se generan cuadro por cuadro con marcas de tiempo exactas (no en tiempo real), así que
 * el resultado no depende de la velocidad del equipo. */
import { ArrayBufferTarget, Muxer } from 'mp4-muxer'
import { resolveImageUrl } from '../imageSources'
import { VIDEO_FPS, buildScene, frameAt, frameCount, videoSize, type Layer, type PlanSpec } from './scene'

export type ImageMap = Map<string, ImageBitmap>
export type AssetLoader = (assetId: string) => Promise<Blob>

/** Todas las fuentes de imagen que usa el plan (fotos, antes/después y logo). */
export function specSources(spec: PlanSpec): string[] {
  const sources = new Set<string>()
  const slides = spec.kind === 'carrusel' || (spec.kind === 'video' && spec.products.length > 1) ? spec.products.length : 1
  for (let slide = 0; slide < slides; slide++) for (const layer of buildScene(spec, slide).layers) if (layer.type === 'image') sources.add(layer.src)
  return [...sources]
}

/** Carga las imágenes como mapas de bits. El logo es opcional: si no se puede leer, la pieza sale sin logo.
 * Una foto de producto que no se puede leer detiene la pieza con un mensaje claro. */
export async function loadImages(spec: PlanSpec, loadAsset: AssetLoader): Promise<{ images: ImageMap; missingLogo: boolean }> {
  const images: ImageMap = new Map()
  let missingLogo = false
  await Promise.all(specSources(spec).map(async (src) => {
    try {
      let blob: Blob
      if (src.startsWith('asset:')) blob = await loadAsset(src.slice(6))
      else {
        const url = resolveImageUrl(src)
        if (!url) throw new Error('invalid url')
        const response = await fetch(url, { credentials: 'omit' })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        blob = await response.blob()
      }
      images.set(src, await createImageBitmap(blob))
    } catch {
      if (src === spec.brand.logoUrl) { missingLogo = true; return }
      throw new Error('No se pudo leer una de las fotos. Si está alojada fuera de la tienda, súbela al producto y vuelve a intentarlo.')
    }
  }))
  return { images, missingLogo }
}

const FONT_LINK = 'creative-font-'
/** Carga la tipografía del Brand Kit (lista cerrada de la plataforma). Si falla, se usa la del panel. */
export async function ensureFont(family: string): Promise<string> {
  const safe = /^[A-Za-z ]{2,30}$/.test(family) ? family : 'Inter'
  try {
    const id = FONT_LINK + safe.replace(/ /g, '-')
    if (!document.getElementById(id)) {
      const link = document.createElement('link')
      link.id = id
      link.rel = 'stylesheet'
      link.href = `https://fonts.googleapis.com/css2?family=${safe.replace(/ /g, '+')}:wght@400;600;700;800&display=swap`
      document.head.appendChild(link)
      await new Promise<void>((resolve) => { link.onload = () => resolve(); link.onerror = () => resolve(); setTimeout(resolve, 2500) })
    }
    await Promise.all([400, 600, 700, 800].map((weight) => document.fonts.load(`${weight} 32px "${safe}"`)))
    return document.fonts.check(`700 32px "${safe}"`) ? safe : 'Inter'
  } catch { return 'Inter' }
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

function roundedPath(ctx: Ctx, x: number, y: number, w: number, h: number, radius: number) {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** Parte un texto en líneas que caben en `maxWidth`; la última se corta con puntos suspensivos si sobra. */
export function wrapLines(measure: (value: string) => number, value: string, maxWidth: number, maxLines: number): string[] {
  const words = value.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (measure(candidate) <= maxWidth || !line) line = candidate
    else { lines.push(line); line = word }
  }
  if (line) lines.push(line)
  if (lines.length <= maxLines) return lines
  const kept = lines.slice(0, maxLines)
  let last = kept[maxLines - 1]!
  while (last.length > 1 && measure(`${last}…`) > maxWidth) last = last.slice(0, -1).trimEnd()
  kept[maxLines - 1] = `${last}…`
  return kept
}

function drawLayer(ctx: Ctx, layer: Layer, images: ImageMap, font: string) {
  if (layer.opacity <= 0) return
  ctx.save()
  ctx.globalAlpha = layer.opacity
  const y = layer.y + layer.offsetY
  if (layer.type === 'rect') {
    ctx.fillStyle = layer.color
    roundedPath(ctx, layer.x, y, layer.w, layer.h, layer.radius)
    ctx.fill()
  } else if (layer.type === 'image') {
    const bitmap = images.get(layer.src)
    if (bitmap && layer.reveal > 0) {
      roundedPath(ctx, layer.x, y, layer.w * layer.reveal, layer.h, layer.radius)
      ctx.clip()
      if (layer.fit === 'contain') { ctx.fillStyle = '#FFFFFF'; ctx.fillRect(layer.x, y, layer.w, layer.h) }
      const scale = (layer.fit === 'cover' ? Math.max : Math.min)(layer.w / bitmap.width, layer.h / bitmap.height) * layer.zoom
      const w = bitmap.width * scale
      const h = bitmap.height * scale
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(bitmap, layer.x + (layer.w - w) / 2, y + (layer.h - h) / 2, w, h)
    }
  } else if (layer.type === 'text') {
    let size = layer.size
    const setFont = () => { ctx.font = `${layer.weight} ${size}px "${font}", Inter, system-ui, sans-serif` }
    setFont()
    let lines: string[]
    if (layer.shrink) {
      // Cifras y datos exactos: nunca se cortan; se reduce el tamaño hasta que quepan completos.
      while (size > 10 && ctx.measureText(layer.text).width > layer.w) { size -= 1; setFont() }
      lines = [layer.text]
    } else lines = wrapLines((value) => ctx.measureText(value).width, layer.text, layer.w, layer.maxLines)
    ctx.fillStyle = layer.color
    ctx.textBaseline = 'top'
    ctx.textAlign = layer.align
    const x = layer.align === 'center' ? layer.x + layer.w / 2 : layer.x
    lines.forEach((line, index) => {
      const lineY = y + index * layer.size * 1.22 + (layer.size - size) / 2
      ctx.fillText(line, x, lineY)
      if (layer.strike) {
        const width = ctx.measureText(line).width
        const start = layer.align === 'center' ? x - width / 2 : x
        ctx.fillRect(start, lineY + size * 0.52, width, Math.max(2, size * 0.07))
      }
    })
  } else {
    let size = layer.size
    const setFont = () => { ctx.font = `800 ${size}px "${font}", Inter, system-ui, sans-serif` }
    setFont()
    const padX = layer.size * 0.9
    while (size > 10 && ctx.measureText(layer.text).width + padX * 2 > layer.w) { size -= 1; setFont() }
    const width = ctx.measureText(layer.text).width + padX * 2
    const x = layer.align === 'right' ? layer.x + layer.w - width : layer.align === 'center' ? layer.x + (layer.w - width) / 2 : layer.x
    ctx.fillStyle = layer.bg
    roundedPath(ctx, x, y, width, layer.h, layer.h / 2)
    ctx.fill()
    ctx.fillStyle = layer.color
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
    ctx.fillText(layer.text, x + padX, y + layer.h / 2 + size * 0.04)
  }
  ctx.restore()
}

export function drawLayers(ctx: Ctx, layers: Layer[], images: ImageMap, font: string, scale = 1) {
  ctx.save()
  ctx.scale(scale, scale)
  for (const layer of layers) drawLayer(ctx, layer, images, font)
  ctx.restore()
}

const canvasOf = (width: number, height: number) => {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}
const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) => new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('No se pudo exportar la imagen'))), type, quality))

/** Exporta la imagen (o cada diapositiva del carrusel) al tamaño exacto del formato. */
export async function exportImages(spec: PlanSpec, images: ImageMap, font: string): Promise<Blob[]> {
  const blobs: Blob[] = []
  for (let slide = 0; slide < spec.slides; slide++) {
    const canvas = canvasOf(spec.width, spec.height)
    drawLayers(canvas.getContext('2d')!, buildScene(spec, slide).layers, images, font)
    blobs.push(spec.quality === 'alta' ? await toBlob(canvas, 'image/png') : await toBlob(canvas, 'image/jpeg', 0.92))
  }
  return blobs
}

/** Dibuja en un lienzo visible el cuadro del segundo `t` (vista previa). */
export function drawPreview(canvas: HTMLCanvasElement, spec: PlanSpec, images: ImageMap, font: string, slide: number, t: number | null) {
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  drawLayers(ctx, t === null ? buildScene(spec, slide).layers : frameAt(spec, t), images, font, canvas.width / spec.width)
}

export interface VideoExport { blob: Blob; durationMs: number; width: number; height: number; encoder: 'webcodecs-h264' | 'mediarecorder' }

async function h264Config(width: number, height: number, bitrate: number): Promise<VideoEncoderConfig | null> {
  if (typeof VideoEncoder === 'undefined') return null
  for (const codec of ['avc1.640028', 'avc1.4d0028', 'avc1.42002a', 'avc1.42001f']) {
    const config: VideoEncoderConfig = { codec, width, height, bitrate, framerate: VIDEO_FPS, avc: { format: 'avc' } }
    try { if ((await VideoEncoder.isConfigSupported(config)).supported) return config } catch { /* siguiente perfil */ }
  }
  return null
}

/** Exporta el video. Preferido: H.264 en MP4 cuadro por cuadro (WebCodecs). Respaldo: grabación del lienzo (WebM). */
export async function exportVideo(spec: PlanSpec, images: ImageMap, font: string, onProgress: (fraction: number) => void = () => undefined): Promise<VideoExport> {
  const { width, height } = videoSize(spec)
  const scale = width / spec.width
  const total = frameCount(spec)
  const seconds = spec.seconds || 6
  const canvas = canvasOf(width, height)
  const ctx = canvas.getContext('2d')!
  const paint = (frame: number) => { ctx.clearRect(0, 0, width, height); drawLayers(ctx, frameAt(spec, frame / VIDEO_FPS), images, font, scale) }
  const config = await h264Config(width, height, spec.quality === 'alta' ? 8_000_000 : 4_000_000)

  if (config) {
    const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: 'avc', width, height, frameRate: VIDEO_FPS }, fastStart: 'in-memory' })
    let failure: unknown = null
    const encoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (error) => { failure = error } })
    encoder.configure(config)
    for (let frame = 0; frame < total && !failure; frame++) {
      paint(frame)
      const videoFrame = new VideoFrame(canvas, { timestamp: Math.round(frame * 1_000_000 / VIDEO_FPS), duration: Math.round(1_000_000 / VIDEO_FPS) })
      encoder.encode(videoFrame, { keyFrame: frame % (VIDEO_FPS * 2) === 0 })
      videoFrame.close()
      // No acumular cuadros sin codificar en memoria.
      while (encoder.encodeQueueSize > 8) await new Promise((resolve) => setTimeout(resolve, 4))
      if (frame % 6 === 0) { onProgress(frame / total); await new Promise((resolve) => setTimeout(resolve, 0)) }
    }
    if (!failure) {
      await encoder.flush()
      encoder.close()
      muxer.finalize()
      onProgress(1)
      return { blob: new Blob([muxer.target.buffer], { type: 'video/mp4' }), durationMs: Math.round(total * 1000 / VIDEO_FPS), width, height, encoder: 'webcodecs-h264' }
    }
    try { encoder.close() } catch { /* ya cerrado */ }
  }

  // Respaldo en tiempo real para navegadores sin WebCodecs.
  if (typeof MediaRecorder === 'undefined' || !canvas.captureStream) throw new Error('Este navegador no puede exportar video. Usa una versión reciente de Chrome, Edge o Safari.')
  const mime = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm'].find((type) => MediaRecorder.isTypeSupported(type))
  if (!mime) throw new Error('Este navegador no puede exportar video.')
  const recorder = new MediaRecorder(canvas.captureStream(VIDEO_FPS), { mimeType: mime, videoBitsPerSecond: 4_000_000 })
  const chunks: Blob[] = []
  recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data) }
  const stopped = new Promise<void>((resolve) => { recorder.onstop = () => resolve() })
  const started = performance.now()
  recorder.start()
  await new Promise<void>((resolve) => {
    const tick = () => {
      const elapsed = (performance.now() - started) / 1000
      paint(Math.min(total - 1, Math.floor(elapsed * VIDEO_FPS)))
      onProgress(Math.min(1, elapsed / seconds))
      if (elapsed >= seconds) resolve(); else requestAnimationFrame(tick)
    }
    tick()
  })
  recorder.stop()
  await stopped
  return { blob: new Blob(chunks, { type: mime.split(';')[0] }), durationMs: Math.round(performance.now() - started), width, height, encoder: 'mediarecorder' }
}
