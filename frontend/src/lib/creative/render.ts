/** Pintado y exportación de piezas comerciales en el navegador (Canvas 2D + WebCodecs).
 *
 * No usa IA ni servidores de render: el equipo del comerciante dibuja las capas de scene.ts (composición
 * clásica) o de design/compose.ts (motor de diseño) y codifica el archivo. Los videos se generan cuadro por
 * cuadro con marcas de tiempo exactas (no en tiempo real), así que el resultado no depende de la velocidad
 * del equipo. */
import { ArrayBufferTarget, Muxer } from 'mp4-muxer'
import { resolveImageUrl } from '../imageSources'
import { VIDEO_FPS, buildScene, frameAt, frameCount, videoSize, type Layer, type PlanSpec, type Scene } from './scene'
import { composeDesign, cutKey, type DesignContext } from './design/compose'
import { cssFont, ensureFonts } from './design/fonts'
import { analyzePhoto, subjectRect, type PhotoAnalysis } from './design/photo'
import { mix, seededRandom } from './design/color'
import { styleFonts } from './design/styles'
import { templateOf, videoPasses, type Pass } from './design/video'
import { aacSupported, encodeAac, generateMusic, AUDIO_SAMPLE_RATE } from './design/audio'

export type ImageMap = Map<string, ImageBitmap>
export type AssetLoader = (assetId: string) => Promise<Blob>
export type OutputType = 'png' | 'jpeg' | 'webp'

/** ¿La pieza usa el motor de diseño? Antes/después y las piezas solo de marca siguen con la composición clásica. */
export function usesDesign(spec: PlanSpec): boolean {
  return Boolean(spec.design) && spec.template !== 'antes_despues' && spec.products.length > 0
}

/** Escena de una diapositiva: motor de diseño cuando aplica y hay contexto; si no, la composición clásica. */
export function sceneFor(spec: PlanSpec, slide: number, design: DesignContext | null): Scene {
  return design && usesDesign(spec) ? composeDesign(spec, slide, design) : buildScene(spec, slide)
}

/** Todas las fuentes de imagen que usa el plan (fotos, antes/después y logo). */
export function specSources(spec: PlanSpec): string[] {
  const sources = new Set<string>()
  if (usesDesign(spec)) {
    for (const product of spec.products) {
      if (product.image) sources.add(product.image)
      // Hasta 2 fotos más del mismo producto para el collage (solo en piezas de un producto).
      if (spec.products.length === 1) for (const extra of (product.gallery ?? []).slice(0, 3)) sources.add(extra)
    }
    if (spec.brand.logoUrl) sources.add(spec.brand.logoUrl)
    return [...sources]
  }
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
      images.set(src, await decodeLimited(blob))
    } catch {
      if (src === spec.brand.logoUrl) { missingLogo = true; return }
      // Una foto adicional de la galería que falla no detiene la pieza: solo la foto principal es obligatoria.
      if (!spec.products.some((product) => product.image === src)) return
      throw new Error('No se pudo leer una de las fotos. Si está alojada fuera de la tienda, súbela al producto y vuelve a intentarlo.')
    }
  }))
  return { images, missingLogo }
}

/** Lado mayor máximo de las fotos en memoria: suficiente para 1920 px de salida y evita agotar la memoria en lotes. */
export const MAX_PHOTO_SIDE = 1600

/** Decodifica una imagen limitando su tamaño. Usa el redimensionado nativo si existe; si no, un lienzo. */
export async function decodeLimited(blob: Blob, maxSide = MAX_PHOTO_SIDE): Promise<ImageBitmap> {
  const bitmap = await createImageBitmap(blob)
  const scale = maxSide / Math.max(bitmap.width, bitmap.height)
  if (scale >= 1) return bitmap
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))
  try {
    const resized = await createImageBitmap(bitmap, { resizeWidth: width, resizeHeight: height, resizeQuality: 'high' })
    bitmap.close()
    return resized
  } catch {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()
    return createImageBitmap(canvas)
  }
}

/** Libera los mapas de bits de una pieza (fotos, recortes, logo). Imprescindible entre productos de un lote. */
export function releaseImages(images: ImageMap) {
  for (const bitmap of images.values()) { try { bitmap.close() } catch { /* ya liberado */ } }
  images.clear()
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

// ---- análisis de fotos y recorte de fondo -----------------------------------------------------------

const canvasOf = (width: number, height: number) => {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  return canvas
}

function readPixels(bitmap: ImageBitmap, maxSide = 360) {
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const canvas = canvasOf(bitmap.width * scale, bitmap.height * scale)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return { width: canvas.width, height: canvas.height, data: ctx.getImageData(0, 0, canvas.width, canvas.height).data }
}

/** Recorta el fondo con la máscara del análisis. Los píxeles del producto se copian tal cual (sin retoque). */
async function cutout(bitmap: ImageBitmap, analysis: PhotoAnalysis): Promise<ImageBitmap | null> {
  const { mask, maskWidth, maskHeight } = analysis.cutout
  if (!mask) return null
  // Se encoge la máscara un píxel para no arrastrar el halo del fondo al ampliarla.
  const eroded = new Uint8ClampedArray(maskWidth * maskHeight * 4)
  for (let y = 0; y < maskHeight; y++) for (let x = 0; x < maskWidth; x++) {
    const i = y * maskWidth + x
    let value = mask[i]!
    if (value && (x === 0 || y === 0 || x === maskWidth - 1 || y === maskHeight - 1 || !mask[i - 1] || !mask[i + 1] || !mask[i - maskWidth] || !mask[i + maskWidth])) value = 110
    eroded[i * 4 + 3] = value
  }
  const maskCanvas = canvasOf(maskWidth, maskHeight)
  maskCanvas.getContext('2d')!.putImageData(new ImageData(eroded, maskWidth, maskHeight), 0, 0)
  const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height))
  const canvas = canvasOf(bitmap.width * scale, bitmap.height * scale)
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  ctx.globalCompositeOperation = 'destination-in'
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(maskCanvas, 0, 0, canvas.width, canvas.height)
  const rect = subjectRect(analysis, 0.02)
  return createImageBitmap(canvas, Math.round(rect.x * scale), Math.round(rect.y * scale), Math.max(1, Math.round(rect.w * scale)), Math.max(1, Math.round(rect.h * scale)))
}

/** Prepara el motor de diseño: carga tipografías del estilo, analiza fotos y logo, y recorta fondos confiables. */
export async function prepareDesign(spec: PlanSpec, images: ImageMap): Promise<{ design: DesignContext; notes: string[] }> {
  const notes: string[] = []
  await ensureFonts(styleFonts(spec.design?.style ?? ''))
  const photos = new Map<string, PhotoAnalysis>()
  const cutouts = new Set<string>()
  const products = new Set(spec.products.map((product) => product.image).filter((src): src is string => Boolean(src)))
  for (const [src, bitmap] of images) {
    if (src.startsWith('cut:')) continue
    const analysis = analyzePhoto(readPixels(bitmap), { width: bitmap.width, height: bitmap.height })
    photos.set(src, analysis)
    // El recorte se prepara siempre (si es confiable): la opción «Quitar fondo» decide si se usa, sin recalcular.
    if (!products.has(src)) continue
    if (analysis.cutout.ok) {
      const bitmapCut = await cutout(bitmap, analysis).catch(() => null)
      if (bitmapCut) { images.set(cutKey(src), bitmapCut); cutouts.add(src) }
    } else if (analysis.cutout.reason) notes.push(analysis.cutout.reason)
  }
  const measurer = canvasOf(8, 8).getContext('2d')!
  const measure = (text: string, font: string) => { measurer.font = font; return measurer.measureText(text).width }
  return { design: { photos, cutouts, measure }, notes: [...new Set(notes)] }
}

// ---- pintado ---------------------------------------------------------------------------------------

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

function shapePath(ctx: Ctx, mask: 'rect' | 'circle' | 'arch' | undefined, x: number, y: number, w: number, h: number, radius: number) {
  if (mask === 'circle') { ctx.beginPath(); ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); ctx.closePath(); return }
  if (mask === 'arch') {
    const r = Math.min(w / 2, h / 2)
    ctx.beginPath()
    ctx.moveTo(x, y + h)
    ctx.lineTo(x, y + r)
    ctx.arc(x + w / 2, y + r, w / 2, Math.PI, 0)
    ctx.lineTo(x + w, y + h)
    ctx.closePath()
    return
  }
  roundedPath(ctx, x, y, w, h, radius)
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

// Cachés por mapa de bits (fondo desenfocado y reflejo): en video se dibujan cientos de veces.
const blurCache = new WeakMap<ImageBitmap, Map<string, HTMLCanvasElement>>()
function blurred(bitmap: ImageBitmap, w: number, h: number): HTMLCanvasElement {
  const key = `${Math.round(w)}x${Math.round(h)}`
  const map = blurCache.get(bitmap) ?? new Map<string, HTMLCanvasElement>()
  blurCache.set(bitmap, map)
  const cached = map.get(key)
  if (cached) return cached
  // Desenfoque por reducción y ampliación sucesivas: funciona en todos los navegadores (sin ctx.filter).
  const small = canvasOf(Math.max(4, w / 28), Math.max(4, h / 28))
  const sctx = small.getContext('2d')!
  const scale = Math.max(small.width / bitmap.width, small.height / bitmap.height)
  sctx.drawImage(bitmap, (small.width - bitmap.width * scale) / 2, (small.height - bitmap.height * scale) / 2, bitmap.width * scale, bitmap.height * scale)
  const mid = canvasOf(small.width * 4, small.height * 4)
  const mctx = mid.getContext('2d')!
  mctx.imageSmoothingQuality = 'high'
  mctx.drawImage(small, 0, 0, mid.width, mid.height)
  const out = canvasOf(w, h)
  const octx = out.getContext('2d')!
  octx.imageSmoothingQuality = 'high'
  octx.drawImage(mid, 0, 0, out.width, out.height)
  // Velo claro para que el fondo no compita con el producto.
  octx.fillStyle = 'rgba(255,255,255,0.18)'
  octx.fillRect(0, 0, out.width, out.height)
  map.set(key, out)
  return out
}

const patternCache = new Map<string, HTMLCanvasElement>()
function noiseTile(seed: number, color: string): HTMLCanvasElement {
  const key = `${seed}|${color}`
  const cached = patternCache.get(key)
  if (cached) return cached
  const tile = canvasOf(160, 160)
  const ctx = tile.getContext('2d')!
  const random = seededRandom(seed)
  ctx.fillStyle = color
  for (let i = 0; i < 900; i++) ctx.fillRect(Math.floor(random() * 160), Math.floor(random() * 160), 1 + Math.floor(random() * 2), 1)
  patternCache.set(key, tile)
  return tile
}

function drawShape(ctx: Ctx, layer: Extract<Layer, { type: 'shape' }>, y: number) {
  const { x, w, h } = layer
  ctx.fillStyle = layer.color
  ctx.strokeStyle = layer.color
  ctx.lineWidth = layer.stroke
  const cx = x + w / 2, cy = y + h / 2
  if (layer.shape === 'circle') { ctx.beginPath(); ctx.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2); ctx.fill(); return }
  if (layer.shape === 'ring') { ctx.beginPath(); ctx.ellipse(cx, cy, Math.max(1, w / 2 - layer.stroke / 2), Math.max(1, h / 2 - layer.stroke / 2), 0, 0, Math.PI * 2); ctx.stroke(); return }
  if (layer.shape === 'arc') { const start = (layer.rotation * Math.PI) / 180; ctx.beginPath(); ctx.ellipse(cx, cy, w / 2, h / 2, 0, start, start + Math.PI * 0.8); ctx.stroke(); return }
  if (layer.shape === 'ellipse') {
    // Sombra de contacto: elipse con borde difuso.
    ctx.save()
    ctx.translate(cx, cy)
    ctx.scale(1, Math.max(0.01, h / w))
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, w / 2)
    gradient.addColorStop(0, layer.color)
    gradient.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = gradient
    ctx.beginPath(); ctx.arc(0, 0, w / 2, 0, Math.PI * 2); ctx.fill()
    ctx.restore()
    return
  }
  if (layer.shape === 'poly' && layer.points && layer.points.length >= 6) {
    ctx.beginPath()
    ctx.moveTo(layer.points[0]!, layer.points[1]! + (y - layer.y))
    for (let i = 2; i < layer.points.length; i += 2) ctx.lineTo(layer.points[i]!, layer.points[i + 1]! + (y - layer.y))
    ctx.closePath(); ctx.fill(); return
  }
  if (layer.shape === 'burst' || layer.shape === 'sparkle') {
    const spikes = layer.shape === 'sparkle' ? 4 : Math.max(8, layer.size ?? 16)
    const outer = Math.min(w, h) / 2
    const innerR = layer.shape === 'sparkle' ? outer * 0.28 : outer * 0.86
    const rotation = (layer.rotation * Math.PI) / 180
    ctx.beginPath()
    for (let i = 0; i < spikes * 2; i++) {
      const r = i % 2 === 0 ? outer : innerR
      const angle = rotation + (i * Math.PI) / spikes - Math.PI / 2
      ctx.lineTo(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r)
    }
    ctx.closePath(); ctx.fill(); return
  }
  if (layer.shape === 'blob') {
    const random = seededRandom(layer.seed + 11)
    const points = 8
    const radii = Array.from({ length: points }, () => 0.86 + random() * 0.16)
    ctx.beginPath()
    for (let i = 0; i <= points; i++) {
      const a = (i / points) * Math.PI * 2
      const b = ((i + 0.5) / points) * Math.PI * 2
      const r = radii[i % points]!
      const rn = radii[(i + 1) % points]!
      const px = cx + Math.cos(a) * (w / 2) * r, py = cy + Math.sin(a) * (h / 2) * r
      if (i === 0) ctx.moveTo(px, py)
      else ctx.quadraticCurveTo(cx + Math.cos(a - Math.PI / points) * (w / 2) * ((r + rn) / 1.86), cy + Math.sin(a - Math.PI / points) * (h / 2) * ((r + rn) / 1.86), px, py)
      void b
    }
    ctx.closePath(); ctx.fill(); return
  }
  if (layer.shape === 'slant') {
    // Bloque inclinado (paralelogramo) para precios de impacto.
    const skew = h * 0.32
    ctx.beginPath(); ctx.moveTo(x + skew, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w - skew, y + h); ctx.lineTo(x, y + h); ctx.closePath(); ctx.fill(); return
  }
  if (layer.shape === 'podium') {
    // Podio cilíndrico: cuerpo con degradado y tapa elíptica más clara.
    const capH = h * 0.42
    const base = layer.color.startsWith('#') ? layer.color : '#E5E7EB'
    const body = ctx.createLinearGradient(x, 0, x + w, 0)
    body.addColorStop(0, mix(base, '#000000', 0.12)); body.addColorStop(0.45, base); body.addColorStop(1, mix(base, '#000000', 0.2))
    ctx.fillStyle = body
    ctx.beginPath(); ctx.moveTo(x, y + capH / 2); ctx.lineTo(x, y + h - capH / 2); ctx.ellipse(cx, y + h - capH / 2, w / 2, capH / 2, 0, Math.PI, 0, true); ctx.lineTo(x + w, y + capH / 2); ctx.closePath(); ctx.fill()
    ctx.fillStyle = mix(base, '#FFFFFF', 0.38)
    ctx.beginPath(); ctx.ellipse(cx, y + capH / 2, w / 2, capH / 2, 0, 0, Math.PI * 2); ctx.fill()
    return
  }
  // Texturas: se recortan a su caja.
  ctx.save()
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip()
  const step = Math.max(4, layer.size ?? 24)
  if (layer.shape === 'dots') {
    for (let py = y + step / 2; py < y + h; py += step) for (let px = x + step / 2; px < x + w; px += step) { ctx.beginPath(); ctx.arc(px, py, step * 0.13, 0, Math.PI * 2); ctx.fill() }
  } else if (layer.shape === 'lines') {
    ctx.translate(cx, cy)
    ctx.rotate((layer.rotation * Math.PI) / 180)
    const span = Math.hypot(w, h)
    for (let p = -span; p < span; p += step) ctx.fillRect(p, -span, Math.max(1, layer.stroke), span * 2)
  } else if (layer.shape === 'grid') {
    for (let px = x; px <= x + w; px += step) ctx.fillRect(px, y, Math.max(1, layer.stroke), h)
    for (let py = y; py <= y + h; py += step) ctx.fillRect(x, py, w, Math.max(1, layer.stroke))
  } else if (layer.shape === 'noise') {
    const pattern = ctx.createPattern(noiseTile(layer.seed, layer.color), 'repeat')
    if (pattern) { ctx.fillStyle = pattern; ctx.fillRect(x, y, w, h) }
  } else if (layer.shape === 'rule') ctx.fillRect(x, y, w, Math.max(1, layer.stroke))
  else if (layer.shape === 'speed') {
    // Líneas de velocidad: trazos afinados de largo y grosor reproducibles.
    const random = seededRandom(layer.seed + 3)
    ctx.translate(cx, cy)
    ctx.rotate((layer.rotation * Math.PI) / 180)
    for (let i = 0; i < 16; i++) {
      const length = w * (0.25 + random() * 0.55)
      const lx = -w / 2 + random() * (w - length)
      const ly = -h / 2 + random() * h
      const thick = Math.max(1, layer.stroke * (0.4 + random() * 1.4))
      const fade = ctx.createLinearGradient(lx, 0, lx + length, 0)
      fade.addColorStop(0, 'rgba(0,0,0,0)'); fade.addColorStop(0.7, layer.color); fade.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = fade
      ctx.fillRect(lx, ly, length, thick)
    }
  } else if (layer.shape === 'halftone') {
    // Trama de puntos que se desvanece desde una esquina.
    const max = Math.hypot(w, h)
    const flip = layer.rotation === 180
    for (let py = y + step / 2; py < y + h; py += step) for (let px = x + step / 2; px < x + w; px += step) {
      const d = Math.hypot(flip ? px - x : x + w - px, flip ? py - y : y + h - py) / max
      const r = step * 0.46 * Math.max(0, 1 - d * 1.15)
      if (r > 0.4) { ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill() }
    }
  }
  ctx.restore()
}

const silhouetteCache = new WeakMap<ImageBitmap, Map<string, HTMLCanvasElement>>()
/** Silueta de color del producto recortado (para el contorno de adhesivo). */
function silhouette(bitmap: ImageBitmap, color: string): HTMLCanvasElement {
  const map = silhouetteCache.get(bitmap) ?? new Map<string, HTMLCanvasElement>()
  silhouetteCache.set(bitmap, map)
  const cached = map.get(color)
  if (cached) return cached
  const canvas = canvasOf(bitmap.width, bitmap.height)
  const sctx = canvas.getContext('2d')!
  sctx.drawImage(bitmap, 0, 0)
  sctx.globalCompositeOperation = 'source-in'
  sctx.fillStyle = color
  sctx.fillRect(0, 0, canvas.width, canvas.height)
  map.set(color, canvas)
  return canvas
}

function drawImageLayer(ctx: Ctx, layer: Extract<Layer, { type: 'image' }>, y: number, images: ImageMap) {
  const bitmap = images.get(layer.src)
  if (!bitmap || layer.reveal <= 0) return
  const { x, w, h } = layer
  if (layer.border) {
    // Marco polaroid: papel blanco con sombra; la foto se dibuja encima sin su propia sombra.
    const b = layer.border.width
    ctx.save()
    if (layer.shadow) { ctx.shadowColor = layer.shadow.color; ctx.shadowBlur = layer.shadow.blur; ctx.shadowOffsetY = layer.shadow.offsetY }
    ctx.fillStyle = layer.border.color
    ctx.fillRect(x - b, y - b, w + b * 2, h + b * 2.6)
    ctx.restore()
    layer = { ...layer, shadow: undefined }
  }
  if (layer.outline && !layer.crop) {
    const scaleFit = Math.min(w / bitmap.width, h / bitmap.height) * layer.zoom
    const dw = bitmap.width * scaleFit, dh = bitmap.height * scaleFit
    const dx = x + (w - dw) / 2, dy = y + (h - dh) / 2
    const shape = silhouette(bitmap, layer.outline.color)
    ctx.save()
    if (layer.shadow) { ctx.shadowColor = layer.shadow.color; ctx.shadowBlur = layer.shadow.blur; ctx.shadowOffsetY = layer.shadow.offsetY }
    for (let i = 0; i < 16; i++) {
      const angle = (i / 16) * Math.PI * 2
      ctx.drawImage(shape, dx + Math.cos(angle) * layer.outline.width, dy + Math.sin(angle) * layer.outline.width, dw, dh)
      if (i === 0) ctx.shadowColor = 'transparent'
    }
    ctx.restore()
    layer = { ...layer, shadow: undefined }
  }
  const frameW = w * layer.reveal
  const hasFrame = Boolean(layer.matte || layer.mask || layer.radius || layer.blur || layer.fit === 'cover')
  // Sombra del marco (o del producto recortado) antes de recortar el área de dibujo.
  if (layer.shadow && hasFrame && !layer.src.startsWith('cut:')) {
    ctx.save()
    ctx.shadowColor = layer.shadow.color
    ctx.shadowBlur = layer.shadow.blur
    ctx.shadowOffsetY = layer.shadow.offsetY
    ctx.fillStyle = layer.matte ?? '#FFFFFF'
    shapePath(ctx, layer.mask, x, y, frameW, h, layer.radius)
    ctx.fill()
    ctx.restore()
  }
  ctx.save()
  if (hasFrame) { shapePath(ctx, layer.mask, x, y, frameW, h, layer.radius); ctx.clip() }
  if (layer.matte) { ctx.fillStyle = layer.matte; ctx.fillRect(x, y, w, h) }
  if (layer.blur) { ctx.drawImage(blurred(bitmap, w, h), x, y, w, h); ctx.restore(); return }
  const crop = layer.crop ?? { x: 0, y: 0, w: bitmap.width, h: bitmap.height }
  const fitScale = (layer.fit === 'cover' ? Math.max : Math.min)(w / crop.w, h / crop.h) * layer.zoom
  const dw = crop.w * fitScale
  const dh = crop.h * fitScale
  const dx = x + (w - dw) / 2
  const dy = y + (h - dh) / 2
  ctx.imageSmoothingQuality = 'high'
  if (layer.shadow && !hasFrame) {
    ctx.shadowColor = layer.shadow.color
    ctx.shadowBlur = layer.shadow.blur
    ctx.shadowOffsetY = layer.shadow.offsetY
  }
  ctx.drawImage(bitmap, crop.x, crop.y, crop.w, crop.h, dx, dy, dw, dh)
  ctx.restore()
  if (layer.reflection && layer.reflection > 0) {
    // Reflejo sutil: la parte inferior del producto, invertida y desvanecida.
    const rh = Math.min(dh * 0.32, h * 0.32)
    const temp = canvasOf(dw, rh)
    const tctx = temp.getContext('2d')!
    tctx.translate(0, rh)
    tctx.scale(1, -1)
    tctx.drawImage(bitmap, crop.x, crop.y + crop.h * (1 - rh / dh), crop.w, crop.h * (rh / dh), 0, 0, dw, rh)
    tctx.setTransform(1, 0, 0, 1, 0, 0)
    tctx.globalCompositeOperation = 'destination-in'
    const fade = tctx.createLinearGradient(0, 0, 0, rh)
    fade.addColorStop(0, 'rgba(0,0,0,1)')
    fade.addColorStop(1, 'rgba(0,0,0,0)')
    tctx.fillStyle = fade
    tctx.fillRect(0, 0, dw, rh)
    ctx.save()
    ctx.globalAlpha *= layer.reflection
    ctx.drawImage(temp, dx, dy + dh + 2)
    ctx.restore()
  }
}

/** Dibuja una línea con espaciado entre letras (el mismo cálculo que usa la medición del motor). */
function fillSpaced(ctx: Ctx, text: string, x: number, y: number, spacing: number, align: 'left' | 'center' | 'right', stroke = false) {
  const paint = (value: string, px: number) => (stroke ? ctx.strokeText(value, px, y) : ctx.fillText(value, px, y))
  if (!spacing) { ctx.textAlign = align; paint(text, x); return }
  const total = ctx.measureText(text).width + spacing * Math.max(0, text.length - 1)
  let cursor = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x
  ctx.textAlign = 'left'
  for (const char of text) { paint(char, cursor); cursor += ctx.measureText(char).width + spacing }
}

function drawText(ctx: Ctx, layer: Extract<Layer, { type: 'text' }>, y: number, font: string) {
  const family = layer.font?.family ?? font
  const lineHeight = layer.font?.lineHeight ?? 1.22
  let size = layer.size
  const setFont = () => { ctx.font = layer.font ? cssFont(family, layer.weight, size, layer.font.italic) : `${layer.weight} ${size}px "${font}", Inter, system-ui, sans-serif` }
  setFont()
  let lines: string[]
  const spacing = (layer.font?.letterSpacing ?? 0) * layer.size
  const widthOf = (value: string) => ctx.measureText(value).width + spacing * Math.max(0, value.length - 1)
  if (layer.lines?.length) {
    lines = layer.lines
    // Seguro: si la fuente real midiera distinto, la línea se reduce en vez de salirse.
    const widest = Math.max(...lines.map(widthOf))
    if (widest > layer.w + 1) { size = Math.max(8, size * (layer.w / widest)); setFont() }
  } else if (layer.shrink) {
    // Cifras y datos exactos: nunca se cortan; se reduce el tamaño hasta que quepan completos.
    while (size > 10 && ctx.measureText(layer.text).width > layer.w) { size -= 1; setFont() }
    lines = [layer.text]
  } else lines = wrapLines((value) => ctx.measureText(value).width, layer.text, layer.w, layer.maxLines)
  ctx.fillStyle = layer.color
  ctx.textBaseline = 'top'
  const x = layer.align === 'center' ? layer.x + layer.w / 2 : layer.align === 'right' ? layer.x + layer.w : layer.x
  if (layer.stroke) { ctx.strokeStyle = layer.color; ctx.lineWidth = layer.stroke; ctx.lineJoin = 'round' }
  lines.forEach((line, index) => {
    const lineY = y + index * layer.size * lineHeight + (layer.size - size) / 2 + (layer.font ? layer.size * (lineHeight - 1) * 0.5 : 0)
    if (layer.bars) {
      // Barra de etiqueta detrás de la línea (estética urbana); el texto se lee sobre ella.
      const width = widthOf(line)
      const pad = size * 0.28
      const start = layer.align === 'center' ? x - width / 2 : layer.align === 'right' ? x - width : x
      ctx.fillStyle = layer.bars
      ctx.fillRect(start - pad, lineY - size * (lineHeight - 1) * 0.5 - pad * 0.15, width + pad * 2, size * lineHeight * 0.96)
      ctx.fillStyle = layer.color
    }
    fillSpaced(ctx, line, x, lineY, spacing * (size / layer.size), layer.align, Boolean(layer.stroke))
    if (layer.strike) {
      const width = widthOf(line)
      const start = layer.align === 'center' ? x - width / 2 : layer.align === 'right' ? x - width : x
      ctx.fillRect(start, lineY + size * 0.5, width, Math.max(2, size * 0.07))
    }
  })
}

function drawPill(ctx: Ctx, layer: Extract<Layer, { type: 'pill' }>, y: number, font: string) {
  if (layer.font) {
    // Motor de diseño: la cápsula ocupa exactamente su caja y el texto va centrado.
    let size = layer.size
    const setFont = () => { ctx.font = cssFont(layer.font!.family, layer.weight ?? 800, size, layer.font!.italic) }
    setFont()
    const spacing = (layer.font.letterSpacing ?? 0) * size
    const padX = layer.size * 0.9
    const variant = layer.variant ?? 'solid'
    const room = variant === 'link' ? layer.w : layer.w - padX * 1.6
    while (size > 8 && ctx.measureText(layer.text).width + spacing * (layer.text.length - 1) > room) { size -= 1; setFont() }
    if (variant === 'solid') {
      ctx.fillStyle = layer.bg
      roundedPath(ctx, layer.x, y, layer.w, layer.h, layer.radius ?? layer.h / 2)
      ctx.fill()
    } else if (variant === 'outline') {
      ctx.strokeStyle = layer.color
      ctx.lineWidth = Math.max(2, size * 0.1)
      roundedPath(ctx, layer.x + ctx.lineWidth / 2, y + ctx.lineWidth / 2, layer.w - ctx.lineWidth, layer.h - ctx.lineWidth, layer.radius ?? layer.h / 2)
      ctx.stroke()
    }
    ctx.fillStyle = layer.color
    ctx.textBaseline = 'middle'
    fillSpaced(ctx, layer.text, layer.x + layer.w / 2, y + layer.h / 2 + size * 0.04, spacing, 'center')
    if (variant === 'link') {
      const width = ctx.measureText(layer.text).width + spacing * (layer.text.length - 1)
      ctx.fillRect(layer.x + (layer.w - width) / 2, y + layer.h / 2 + size * 0.62, width, Math.max(2, size * 0.08))
    }
    return
  }
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

function drawLayer(ctx: Ctx, layer: Layer, images: ImageMap, font: string) {
  if (layer.opacity <= 0) return
  ctx.save()
  // Se multiplica: respeta la opacidad de la pasada (transiciones entre escenas).
  ctx.globalAlpha *= layer.opacity
  const y = layer.y + layer.offsetY
  const dx = layer.offsetX ?? 0
  const scale = layer.scale ?? 1
  if (layer.turn || scale !== 1 || dx) {
    const cx = layer.x + layer.w / 2, cy = y + layer.h / 2
    ctx.translate(cx + dx, cy)
    if (layer.turn) ctx.rotate((layer.turn * Math.PI) / 180)
    if (scale !== 1) ctx.scale(scale, scale)
    ctx.translate(-cx, -cy)
  }
  if (layer.wipe !== undefined && layer.wipe < 1) {
    if (layer.wipe <= 0) { ctx.restore(); return }
    ctx.beginPath(); ctx.rect(layer.x - layer.w * 0.1, y - layer.h, layer.w * 1.2 * layer.wipe, layer.h * 3); ctx.clip()
  }
  if (layer.type === 'rect') {
    if (layer.stroke) { ctx.strokeStyle = layer.color; ctx.lineWidth = layer.stroke; roundedPath(ctx, layer.x, y, layer.w, layer.h, layer.radius); ctx.stroke() }
    else { ctx.fillStyle = layer.color; roundedPath(ctx, layer.x, y, layer.w, layer.h, layer.radius); ctx.fill() }
  } else if (layer.type === 'gradient') {
    const gradient = layer.radial
      ? ctx.createRadialGradient(layer.x + layer.w / 2, y + layer.h / 2, 0, layer.x + layer.w / 2, y + layer.h / 2, Math.max(layer.w, layer.h) / 2)
      : (() => {
          const angle = (layer.angle * Math.PI) / 180
          const cx = layer.x + layer.w / 2, cy = y + layer.h / 2
          const r = (Math.abs(Math.cos(angle)) * layer.w + Math.abs(Math.sin(angle)) * layer.h) / 2
          return ctx.createLinearGradient(cx - Math.sin(angle) * r, cy + Math.cos(angle) * -r, cx + Math.sin(angle) * r, cy + Math.cos(angle) * r)
        })()
    for (const [offset, color] of layer.stops) gradient.addColorStop(Math.min(1, Math.max(0, offset)), color)
    ctx.fillStyle = gradient
    if (layer.circle) { ctx.beginPath(); ctx.ellipse(layer.x + layer.w / 2, y + layer.h / 2, layer.w / 2, layer.h / 2, 0, 0, Math.PI * 2); ctx.fill() }
    else { roundedPath(ctx, layer.x, y, layer.w, layer.h, layer.radius); ctx.fill() }
  } else if (layer.type === 'shape') drawShape(ctx, layer, y)
  else if (layer.type === 'image') drawImageLayer(ctx, layer, y, images)
  else if (layer.type === 'text') drawText(ctx, layer, y, font)
  else drawPill(ctx, layer, y, font)
  ctx.restore()
}

export function drawLayers(ctx: Ctx, layers: Layer[], images: ImageMap, font: string, scale = 1) {
  ctx.save()
  ctx.scale(scale, scale)
  for (const layer of layers) drawLayer(ctx, layer, images, font)
  ctx.restore()
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) => new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('No se pudo exportar la imagen'))), type, quality))

/** Límite del servidor para imágenes (6 MB); se deja margen. */
const MAX_IMAGE_BYTES = 5.8 * 1024 * 1024

/** Exporta la imagen (o cada diapositiva del carrusel) al tamaño exacto del formato.
 * `output` elige PNG, JPG o WebP; sin elegir, la calidad «alta» usa PNG y la estándar JPG. Si un PNG supera el
 * límite de la plataforma, se guarda en JPG de alta calidad. */
export async function exportImages(spec: PlanSpec, images: ImageMap, font: string, design: DesignContext | null = null, output: OutputType | null = null): Promise<Blob[]> {
  const blobs: Blob[] = []
  const type = output ?? (spec.quality === 'alta' ? 'png' : 'jpeg')
  for (let slide = 0; slide < spec.slides; slide++) {
    const canvas = canvasOf(spec.width, spec.height)
    drawLayers(canvas.getContext('2d')!, sceneFor(spec, slide, design).layers, images, font)
    let blob = type === 'png' ? await toBlob(canvas, 'image/png') : await toBlob(canvas, `image/${type}`, 0.92)
    // WebP no está en todos los navegadores: algunos devuelven PNG. Se acepta lo que el servidor valida.
    if (blob.size > MAX_IMAGE_BYTES) blob = await toBlob(canvas, 'image/jpeg', 0.9)
    blobs.push(blob)
  }
  return blobs
}

/** Dibuja en un lienzo visible el cuadro del segundo `t` (vista previa). */
/** Dibuja las pasadas de un cuadro de video (escenas con su transición). */
export function drawPasses(ctx: Ctx, passes: Pass[], images: ImageMap, font: string, scale: number, width: number, height: number) {
  for (const pass of passes) {
    ctx.save()
    ctx.globalAlpha = pass.alpha ?? 1
    if (pass.clip !== undefined) { ctx.beginPath(); ctx.rect(0, 0, width * scale * pass.clip, height * scale); ctx.clip() }
    if (pass.dx) ctx.translate(pass.dx * scale, 0)
    if (pass.zoom && pass.zoom !== 1) { ctx.translate((width * scale) / 2, (height * scale) / 2); ctx.scale(pass.zoom, pass.zoom); ctx.translate((-width * scale) / 2, (-height * scale) / 2) }
    drawLayers(ctx, pass.layers, images, font, scale)
    ctx.restore()
  }
}

/** ¿Es un video del motor de diseño (plantillas de video con intro, escenas y cierre)? */
export const designVideo = (spec: PlanSpec, design: DesignContext | null): design is DesignContext => spec.kind === 'video' && Boolean(design) && usesDesign(spec)

/** Pasadas del segundo `t` de un video: motor de diseño o composición clásica. */
export function videoFrame(spec: PlanSpec, t: number, design: DesignContext | null): Pass[] {
  const build = (s: PlanSpec, n: number) => sceneFor(s, n, design)
  if (designVideo(spec, design)) return videoPasses(spec, t, design, (s, n) => build(s, n).layers)
  return [{ layers: frameAt(spec, t, build) }]
}

export function drawPreview(canvas: HTMLCanvasElement, spec: PlanSpec, images: ImageMap, font: string, slide: number, t: number | null, design: DesignContext | null = null) {
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  const scale = canvas.width / spec.width
  if (t === null) drawLayers(ctx, sceneFor(spec, slide, design).layers, images, font, scale)
  else drawPasses(ctx, videoFrame(spec, t, design), images, font, scale, spec.width, spec.height)
}

/** Lo que este navegador puede hacer al exportar video (para avisar antes de generar). */
export async function videoSupport(): Promise<{ mp4: boolean; aac: boolean; webm: boolean }> {
  const mp4 = Boolean(await h264Config(720, 1280, 4_000_000).catch(() => null))
  const webm = typeof MediaRecorder !== 'undefined' && ['video/webm;codecs=vp9', 'video/webm'].some((type) => MediaRecorder.isTypeSupported(type))
  return { mp4, aac: mp4 && (await aacSupported()), webm }
}

export interface VideoExport { blob: Blob; durationMs: number; width: number; height: number; encoder: 'webcodecs-h264' | 'mediarecorder'; audio: 'aac' | null; renderMs: number }

async function h264Config(width: number, height: number, bitrate: number): Promise<VideoEncoderConfig | null> {
  if (typeof VideoEncoder === 'undefined') return null
  for (const codec of ['avc1.640028', 'avc1.4d0028', 'avc1.42002a', 'avc1.42001f']) {
    const config: VideoEncoderConfig = { codec, width, height, bitrate, framerate: VIDEO_FPS, avc: { format: 'avc' } }
    try { if ((await VideoEncoder.isConfigSupported(config)).supported) return config } catch { /* siguiente perfil */ }
  }
  return null
}

/** Exporta el video. Preferido: H.264 en MP4 cuadro por cuadro (WebCodecs). Respaldo: grabación del lienzo (WebM). */
export interface VideoOptions {
  /** Música generada por el sistema (solo si el navegador codifica AAC; si no, el video sale sin audio). */
  music?: boolean
  signal?: AbortSignal
}

export async function exportVideo(spec: PlanSpec, images: ImageMap, font: string, onProgress: (fraction: number) => void = () => undefined, design: DesignContext | null = null, options: VideoOptions = {}): Promise<VideoExport> {
  const started = performance.now()
  const { width, height } = videoSize(spec)
  const scale = width / spec.width
  const total = frameCount(spec)
  const seconds = spec.seconds || 6
  const canvas = canvasOf(width, height)
  const ctx = canvas.getContext('2d')!
  const paint = (frame: number) => { ctx.clearRect(0, 0, width, height); drawPasses(ctx, videoFrame(spec, frame / VIDEO_FPS, design), images, font, scale, spec.width, spec.height) }
  const config = await h264Config(width, height, spec.quality === 'alta' ? 8_000_000 : 4_000_000)

  if (config) {
    // Audio: música generada y codificada en AAC cuando el navegador lo permite.
    const music = options.music && designVideo(spec, design) && (await aacSupported())
      ? await generateMusic(seconds, templateOf(spec).music.mood, templateOf(spec).music.bpm, spec.design?.seed ?? 1).catch(() => null)
      : null
    const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: 'avc', width, height, frameRate: VIDEO_FPS }, ...(music ? { audio: { codec: 'aac' as const, numberOfChannels: 2, sampleRate: AUDIO_SAMPLE_RATE } } : {}), fastStart: 'in-memory', firstTimestampBehavior: 'offset' })
    let failure: unknown = null
    const encoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (error) => { failure = error } })
    encoder.configure(config)
    for (let frame = 0; frame < total && !failure; frame++) {
      if (options.signal?.aborted) { try { encoder.close() } catch { /* cerrado */ } throw new DOMException('Cancelado', 'AbortError') }
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
      let audio: 'aac' | null = null
      if (music) {
        try { await encodeAac(music, (chunk, meta) => muxer.addAudioChunk(chunk, meta)); audio = 'aac' } catch { audio = null }
      }
      muxer.finalize()
      onProgress(1)
      return { blob: new Blob([muxer.target.buffer], { type: 'video/mp4' }), durationMs: Math.round(total * 1000 / VIDEO_FPS), width, height, encoder: 'webcodecs-h264', audio, renderMs: Math.round(performance.now() - started) }
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
  const recordStart = performance.now()
  recorder.start()
  await new Promise<void>((resolve) => {
    const tick = () => {
      const elapsed = (performance.now() - recordStart) / 1000
      paint(Math.min(total - 1, Math.floor(elapsed * VIDEO_FPS)))
      onProgress(Math.min(1, elapsed / seconds))
      // Con la pestaña oculta el navegador detiene requestAnimationFrame: se sigue con temporizadores para que
      // la grabación termine (más lenta y menos fluida; conviene dejar la pestaña visible).
      if (elapsed >= seconds) resolve(); else if (document.hidden) setTimeout(tick, 1000 / VIDEO_FPS); else requestAnimationFrame(tick)
    }
    tick()
  })
  recorder.stop()
  await stopped
  return { blob: new Blob(chunks, { type: mime.split(';')[0] }), durationMs: Math.round(performance.now() - recordStart), width, height, encoder: 'mediarecorder', audio: null, renderMs: Math.round(performance.now() - started) }
}
