/** Análisis de la fotografía del producto, sin IA y en el equipo del comerciante.
 *
 * Trabaja sobre los píxeles reales (una copia reducida) para decidir cómo componer:
 *  - orientación y proporción;
 *  - si el fondo es uniforme (estudio, pared lisa) y de qué color;
 *  - el recuadro donde está el producto, para centrarlo y encuadrarlo sin deformarlo;
 *  - los colores dominantes del producto, para armonizar la paleta;
 *  - una máscara del producto cuando el fondo se puede separar con seguridad.
 *
 * Fidelidad: la máscara solo decide qué píxeles son fondo. Los píxeles del producto nunca se alteran
 * (color, empaque, etiquetas, marca). Si la separación no es confiable, se descarta y se usa la foto
 * original completa. */
import { rgbToHex, rgbToHsl, type Rgb } from './color'

export interface Pixels { width: number; height: number; data: Uint8ClampedArray }

export interface Box { x: number; y: number; w: number; h: number }

export interface PhotoAnalysis {
  width: number
  height: number
  orientation: 'vertical' | 'cuadrada' | 'horizontal'
  /** Fondo uniforme detectado en el borde de la foto. */
  background: { uniform: boolean; color: string; coverage: number; transparent: boolean }
  /** Recuadro del producto en proporciones (0..1) de la foto. Toda la foto si no se pudo aislar. */
  subject: Box
  /** Colores del producto, de más a menos presente. */
  dominant: string[]
  /** Brillo medio de la foto (0..1). */
  brightness: number
  /** Recorte del fondo: true solo si la máscara pasó todos los controles. */
  cutout: { ok: boolean; reason: string | null; mask: Uint8Array | null; maskWidth: number; maskHeight: number }
}

const distance = (data: Uint8ClampedArray, index: number, color: Rgb) => {
  const dr = data[index]! - color[0], dg = data[index + 1]! - color[1], db = data[index + 2]! - color[2]
  // Distancia ponderada por la sensibilidad del ojo (aproximación rápida a ΔE).
  return Math.sqrt(0.3 * dr * dr + 0.59 * dg * dg + 0.11 * db * db)
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

/** Píxeles del borde (anillo de `ring` píxeles). */
function borderIndexes(width: number, height: number, ring: number): number[] {
  const list: number[] = []
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x < ring || y < ring || x >= width - ring || y >= height - ring) list.push(y * width + x)
    }
  }
  return list
}

/** Analiza la foto. `pixels` debe ser una copia reducida (≈ 320-420 px de lado mayor) para que sea rápido. */
export function analyzePhoto(pixels: Pixels, original: { width: number; height: number } = pixels): PhotoAnalysis {
  const { width, height, data } = pixels
  const total = width * height
  const ratio = original.width / original.height
  const orientation = ratio > 1.15 ? 'horizontal' : ratio < 0.87 ? 'vertical' : 'cuadrada'

  let lightSum = 0
  for (let i = 0; i < total; i++) lightSum += (data[i * 4]! * 0.2126 + data[i * 4 + 1]! * 0.7152 + data[i * 4 + 2]! * 0.0722) / 255
  const brightness = total ? lightSum / total : 0.5

  const border = borderIndexes(width, height, Math.max(2, Math.round(Math.min(width, height) * 0.01)))
  const transparentBorder = border.filter((p) => data[p * 4 + 3]! < 16).length / Math.max(1, border.length)
  const opaqueBorder = border.filter((p) => data[p * 4 + 3]! >= 16)
  const bg: Rgb = opaqueBorder.length
    ? [median(opaqueBorder.map((p) => data[p * 4]!)), median(opaqueBorder.map((p) => data[p * 4 + 1]!)), median(opaqueBorder.map((p) => data[p * 4 + 2]!))]
    : [255, 255, 255]
  const close = opaqueBorder.filter((p) => distance(data, p * 4, bg) < 26).length
  const coverage = transparentBorder > 0.6 ? 1 : opaqueBorder.length ? close / opaqueBorder.length : 0
  const uniform = transparentBorder > 0.6 || coverage >= 0.78

  // ---- máscara: relleno desde el borde por el color de fondo ----
  const isBg = new Uint8Array(total)
  let cutReason: string | null = null
  if (transparentBorder > 0.6) {
    for (let i = 0; i < total; i++) if (data[i * 4 + 3]! < 24) isBg[i] = 1
  } else if (uniform) {
    const spread = median(opaqueBorder.map((p) => distance(data, p * 4, bg)))
    const tolerance = Math.min(42, Math.max(16, spread * 3 + 12))
    const queue = new Int32Array(total)
    let head = 0, tail = 0
    for (const p of border) if (!isBg[p] && distance(data, p * 4, bg) < tolerance) { isBg[p] = 1; queue[tail++] = p }
    while (head < tail) {
      const p = queue[head++]!
      const x = p % width, y = (p / width) | 0
      const neighbours = [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, y > 0 ? p - width : -1, y < height - 1 ? p + width : -1]
      for (const n of neighbours) {
        if (n < 0 || isBg[n]) continue
        // Además del color de fondo, el paso entre vecinos debe ser suave: así se frena en los bordes del producto.
        if (distance(data, n * 4, bg) < tolerance && distance(data, n * 4, [data[p * 4]!, data[p * 4 + 1]!, data[p * 4 + 2]!]) < 18) { isBg[n] = 1; queue[tail++] = n }
      }
    }
  } else cutReason = 'El fondo de la foto no es uniforme.'

  // Recuadro del producto (lo que no es fondo).
  let minX = width, minY = height, maxX = -1, maxY = -1, subjectCount = 0
  if (uniform) {
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (isBg[y * width + x]) continue
      subjectCount++
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  const found = uniform && maxX >= 0
  const subject: Box = found
    ? { x: minX / width, y: minY / height, w: (maxX - minX + 1) / width, h: (maxY - minY + 1) / height }
    : { x: 0, y: 0, w: 1, h: 1 }

  // Controles de la máscara: si alguno falla, se usa la foto original completa.
  const fraction = subjectCount / Math.max(1, total)
  if (!cutReason && !found) cutReason = 'No se encontró el producto sobre el fondo.'
  if (!cutReason && fraction < 0.03) cutReason = 'El producto ocupa muy poco de la foto.'
  if (!cutReason && fraction > 0.93) cutReason = 'El producto ocupa casi toda la foto.'
  if (!cutReason) {
    const touches = [minX <= 1, minY <= 1, maxX >= width - 2, maxY >= height - 2].filter(Boolean).length
    if (touches >= 3) cutReason = 'El producto está cortado por los bordes de la foto.'
  }
  if (!cutReason && transparentBorder <= 0.6) {
    // Contraste en el borde de la máscara: si el producto se parece demasiado al fondo, el recorte no es confiable.
    let edge = 0, edgeSum = 0
    for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
      const p = y * width + x
      if (isBg[p] || !(isBg[p - 1] || isBg[p + 1] || isBg[p - width] || isBg[p + width])) continue
      edge++
      edgeSum += distance(data, p * 4, bg)
    }
    const meanEdge = edge ? edgeSum / edge : 0
    if (meanEdge < 30) cutReason = 'El producto se confunde con el fondo.'
    // Un borde muy largo frente al área indica una máscara deshilachada (texturas, pelusa, sombras duras).
    else if (edge > 0 && edge / Math.sqrt(subjectCount) > 9) cutReason = 'El contorno del producto es irregular.'
  }

  // Colores dominantes del producto (cubos de 4 bits por canal).
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>()
  const step = Math.max(1, Math.floor(total / 40000))
  for (let i = 0; i < total; i += step) {
    if (uniform && isBg[i]) continue
    const o = i * 4
    if (data[o + 3]! < 128) continue
    const key = ((data[o]! >> 4) << 8) | ((data[o + 1]! >> 4) << 4) | (data[o + 2]! >> 4)
    const bucket = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 }
    bucket.n++; bucket.r += data[o]!; bucket.g += data[o + 1]!; bucket.b += data[o + 2]!
    buckets.set(key, bucket)
  }
  const ranked = [...buckets.values()].sort((a, b) => b.n - a.n).map((bucket) => rgbToHex([bucket.r / bucket.n, bucket.g / bucket.n, bucket.b / bucket.n]))
  const dominant: string[] = []
  for (const color of ranked) {
    if (dominant.length >= 4) break
    const [h, s, l] = rgbToHsl([parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16)])
    if (dominant.every((other) => { const [h2, s2, l2] = rgbToHsl([parseInt(other.slice(1, 3), 16), parseInt(other.slice(3, 5), 16), parseInt(other.slice(5, 7), 16)]); return Math.abs(h - h2) > 24 || Math.abs(s - s2) > 0.25 || Math.abs(l - l2) > 0.25 })) dominant.push(color)
  }

  let mask: Uint8Array | null = null
  if (!cutReason) {
    mask = new Uint8Array(total)
    for (let i = 0; i < total; i++) mask[i] = isBg[i] ? 0 : 255
  }
  return {
    width: original.width, height: original.height, orientation,
    background: { uniform, color: rgbToHex(bg), coverage: Math.round(coverage * 100) / 100, transparent: transparentBorder > 0.6 },
    subject, dominant, brightness: Math.round(brightness * 100) / 100,
    cutout: { ok: !cutReason, reason: cutReason, mask, maskWidth: width, maskHeight: height },
  }
}

/** Recuadro del producto con margen, en píxeles de la foto original, sin salirse de ella. */
export function subjectRect(analysis: PhotoAnalysis, margin = 0.04): Box {
  const { subject, width, height } = analysis
  const x = Math.max(0, subject.x - margin) * width
  const y = Math.max(0, subject.y - margin) * height
  const right = Math.min(1, subject.x + subject.w + margin) * width
  const bottom = Math.min(1, subject.y + subject.h + margin) * height
  return { x, y, w: right - x, h: bottom - y }
}
