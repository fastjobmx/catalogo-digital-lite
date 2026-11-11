/** Estudio fotográfico · nivel A (edición convencional) y análisis de calidad. Todo ocurre en el navegador
 * con canvas: sin IA, sin créditos y sin enviar la foto a ningún proveedor. */

export type BrowserOperation = 'cuadrado' | 'encuadre_blanco' | 'redimensionar' | 'comprimir' | 'convertir_jpg' | 'auto_luz'
export const BROWSER_OPERATIONS: BrowserOperation[] = ['cuadrado', 'encuadre_blanco', 'redimensionar', 'comprimir', 'convertir_jpg', 'auto_luz']
export const isBrowserOperation = (value: string): value is BrowserOperation => (BROWSER_OPERATIONS as string[]).includes(value)

export const MAX_SIDE = 1600
export const SQUARE_SIDE = 1080

export type QualityIssue = 'baja_resolucion' | 'oscura' | 'sobreexpuesta' | 'poco_contraste' | 'borrosa' | 'no_cuadrada'
export interface PhotoQuality {
  width: number
  height: number
  /** Brillo medio 0–255. */
  brightness: number
  /** Desviación estándar de la luminancia (contraste global). */
  contrast: number
  /** Nitidez estimada (varianza del laplaciano en una copia reducida). */
  sharpness: number
  issues: Array<{ code: QualityIssue; message: string }>
}

type Rect = [number, number, number, number]

/** Geometría de salida de cada operación: qué región del original se dibuja y en qué lienzo. Función pura. */
export function planGeometry(operation: BrowserOperation, width: number, height: number): { canvas: [number, number]; source: Rect; target: Rect; background: string | null } {
  if (operation === 'cuadrado') {
    const side = Math.min(width, height)
    const out = Math.min(side, SQUARE_SIDE)
    return { canvas: [out, out], source: [Math.floor((width - side) / 2), Math.floor((height - side) / 2), side, side], target: [0, 0, out, out], background: null }
  }
  if (operation === 'encuadre_blanco') {
    const out = Math.min(Math.max(width, height), SQUARE_SIDE)
    const scale = out / Math.max(width, height)
    const w = Math.round(width * scale)
    const h = Math.round(height * scale)
    return { canvas: [out, out], source: [0, 0, width, height], target: [Math.floor((out - w) / 2), Math.floor((out - h) / 2), w, h], background: '#FFFFFF' }
  }
  const scale = operation === 'redimensionar' || operation === 'comprimir' ? Math.min(1, MAX_SIDE / Math.max(width, height)) : 1
  const w = Math.max(1, Math.round(width * scale))
  const h = Math.max(1, Math.round(height * scale))
  // JPG no tiene transparencia: se aplana sobre blanco.
  return { canvas: [w, h], source: [0, 0, width, height], target: [0, 0, w, h], background: operation === 'convertir_jpg' ? '#FFFFFF' : null }
}

export function outputFormat(operation: BrowserOperation, inputType: string): { type: 'image/jpeg' | 'image/png' | 'image/webp'; quality: number; extension: string } {
  if (operation === 'comprimir') return { type: 'image/webp', quality: 0.82, extension: 'webp' }
  if (operation === 'convertir_jpg') return { type: 'image/jpeg', quality: 0.9, extension: 'jpg' }
  if (inputType === 'image/png') return { type: 'image/png', quality: 1, extension: 'png' }
  if (inputType === 'image/webp') return { type: 'image/webp', quality: 0.9, extension: 'webp' }
  return { type: 'image/jpeg', quality: 0.9, extension: 'jpg' }
}

/** Estira los niveles (percentiles 1 y 99 de la luminancia) sin cambiar el tono. Modifica `data` (RGBA). */
export function autoLevels(data: Uint8ClampedArray): { low: number; high: number } {
  const histogram = new Uint32Array(256)
  const pixels = data.length / 4
  for (let i = 0; i < data.length; i += 4) {
    const bin = Math.round(0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!)
    histogram[bin] = histogram[bin]! + 1
  }
  const cut = pixels * 0.01
  let low = 0
  let high = 255
  let sum = histogram[0]!
  while (low < 255 && sum < cut) { low++; sum += histogram[low]! }
  sum = histogram[255]!
  while (high > 0 && sum < cut) { high--; sum += histogram[high]! }
  // Ya usa casi todo el rango, o es una imagen casi plana: no se toca.
  if (high - low < 32 || (low < 6 && high > 249)) return { low, high }
  const scale = 255 / (high - low)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = (data[i]! - low) * scale
    data[i + 1] = (data[i + 1]! - low) * scale
    data[i + 2] = (data[i + 2]! - low) * scale
  }
  return { low, high }
}

/** Mide una imagen RGBA (ya reducida). Función pura: se puede probar sin navegador. */
export function measureQuality(data: Uint8ClampedArray, width: number, height: number, original: { width: number; height: number }): PhotoQuality {
  const gray = new Float32Array(width * height)
  let sum = 0
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const v = 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!
    gray[p] = v
    sum += v
  }
  const brightness = sum / gray.length
  let variance = 0
  for (const v of gray) variance += (v - brightness) ** 2
  const contrast = Math.sqrt(variance / gray.length)
  let lapSum = 0
  let lapSq = 0
  let count = 0
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x
      const lap = gray[i - 1]! + gray[i + 1]! + gray[i - width]! + gray[i + width]! - 4 * gray[i]!
      lapSum += lap
      lapSq += lap * lap
      count++
    }
  }
  const sharpness = count ? lapSq / count - (lapSum / count) ** 2 : 0
  const issues: PhotoQuality['issues'] = []
  if (Math.max(original.width, original.height) < 800) issues.push({ code: 'baja_resolucion', message: `Resolución baja (${original.width}×${original.height}): se verá pixelada al ampliar.` })
  if (brightness < 70) issues.push({ code: 'oscura', message: 'La foto está oscura.' })
  if (brightness > 215) issues.push({ code: 'sobreexpuesta', message: 'La foto está muy clara o quemada.' })
  if (contrast < 28) issues.push({ code: 'poco_contraste', message: 'Tiene poco contraste.' })
  if (sharpness < 60) issues.push({ code: 'borrosa', message: 'Parece desenfocada o movida.' })
  const ratio = original.width / original.height
  if (ratio < 0.9 || ratio > 1.1) issues.push({ code: 'no_cuadrada', message: 'No es cuadrada: en el catálogo se recorta.' })
  return { width: original.width, height: original.height, brightness: Math.round(brightness), contrast: Math.round(contrast), sharpness: Math.round(sharpness), issues }
}

/** Sugerencia de la opción más sencilla que resuelve lo detectado (primero lo que no cuesta). */
export function suggestOperation(quality: PhotoQuality): { operation: BrowserOperation; reason: string } | null {
  const codes = new Set(quality.issues.map((issue) => issue.code))
  if (codes.has('oscura') || codes.has('poco_contraste')) return { operation: 'auto_luz', reason: 'Empieza por el ajuste básico de luz: no cuesta créditos.' }
  if (codes.has('no_cuadrada')) return { operation: 'encuadre_blanco', reason: 'Un encuadre cuadrado sobre blanco evita recortes en el catálogo y no cuesta créditos.' }
  // Ninguna edición recupera detalle real de una foto borrosa o pequeña: conviene otra foto.
  return null
}

async function decode(blob: Blob): Promise<ImageBitmap> {
  const bitmap = await createImageBitmap(blob).catch(() => null)
  if (!bitmap) throw new Error('No se pudo abrir la foto.')
  return bitmap
}

/** Analiza una foto en el navegador (sobre una copia de máx. 256 px). */
export async function analyzePhoto(blob: Blob): Promise<PhotoQuality> {
  const bitmap = await decode(blob)
  const scale = Math.min(1, 256 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(3, Math.round(bitmap.width * scale))
  canvas.height = Math.max(3, Math.round(bitmap.height * scale))
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  context.fillStyle = '#FFFFFF'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  const quality = measureQuality(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, { width: bitmap.width, height: bitmap.height })
  bitmap.close()
  return quality
}

/** Aplica una operación convencional y devuelve el archivo resultante. */
export async function applyBrowserOperation(blob: Blob, operation: BrowserOperation): Promise<File> {
  const bitmap = await decode(blob)
  const plan = planGeometry(operation, bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = plan.canvas[0]
  canvas.height = plan.canvas[1]
  const context = canvas.getContext('2d', { willReadFrequently: operation === 'auto_luz' })!
  if (plan.background) {
    context.fillStyle = plan.background
    context.fillRect(0, 0, canvas.width, canvas.height)
  }
  context.imageSmoothingQuality = 'high'
  context.drawImage(bitmap, ...plan.source, ...plan.target)
  bitmap.close()
  if (operation === 'auto_luz') {
    const image = context.getImageData(0, 0, canvas.width, canvas.height)
    autoLevels(image.data)
    context.putImageData(image, 0, 0)
  }
  const format = outputFormat(operation, blob.type)
  const output = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, format.type, format.quality))
  if (!output) throw new Error('No se pudo generar la imagen.')
  if (output.size > 5 * 1024 * 1024) throw new Error('El resultado pesa más de 5 MB. Prueba con «Comprimir».')
  return new File([output], `${operation}.${format.extension}`, { type: format.type })
}
