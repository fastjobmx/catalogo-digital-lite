/** Color y azar reproducible para el motor de diseño publicitario.
 *
 * Funciones puras: conversión hex/RGB/HSL, mezcla, contraste WCAG y un generador pseudoaleatorio con semilla
 * (la misma semilla produce siempre la misma variante: una pieza se puede regenerar idéntica). */

export type Rgb = [number, number, number]

export const isHex = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)

export function hexToRgb(hex: string): Rgb {
  const value = isHex(hex) ? hex : '#000000'
  return [parseInt(value.slice(1, 3), 16), parseInt(value.slice(3, 5), 16), parseInt(value.slice(5, 7), 16)]
}

export function rgbToHex([r, g, b]: Rgb): string {
  const part = (value: number) => Math.round(Math.min(255, Math.max(0, value))).toString(16).padStart(2, '0')
  return `#${part(r)}${part(g)}${part(b)}`.toUpperCase()
}

export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex)
  return `rgba(${r},${g},${b},${Math.min(1, Math.max(0, alpha)).toFixed(3)})`
}

/** Mezcla lineal de dos colores (0 = a, 1 = b). */
export function mix(a: string, b: string, amount: number): string {
  const x = hexToRgb(a)
  const y = hexToRgb(b)
  const t = Math.min(1, Math.max(0, amount))
  return rgbToHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t])
}

export function rgbToHsl([r, g, b]: Rgb): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === rn ? (gn - bn) / d + (gn < bn ? 6 : 0) : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4
  return [h * 60, s, l]
}

export function hslToHex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360
  const sat = Math.min(1, Math.max(0, s))
  const light = Math.min(1, Math.max(0, l))
  const c = (1 - Math.abs(2 * light - 1)) * sat
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1))
  const m = light - c / 2
  const [r, g, b] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x]
  return rgbToHex([(r + m) * 255, (g + m) * 255, (b + m) * 255])
}

export const hsl = (hex: string) => rgbToHsl(hexToRgb(hex))

/** Luminancia relativa WCAG 2.x. */
export function luminance(hex: string): number {
  const channel = (value: number) => { const v = value / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
  const [r, g, b] = hexToRgb(hex)
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** Relación de contraste WCAG entre dos colores (1 a 21). */
export function contrastRatio(a: string, b: string): number {
  const x = luminance(a)
  const y = luminance(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

export const INK = '#111827'
export const WHITE = '#FFFFFF'

/** El color de texto (de la lista dada) con mejor contraste sobre el fondo. */
export function bestOn(background: string, candidates: string[] = [INK, WHITE]): string {
  return candidates.reduce((best, color) => (contrastRatio(color, background) > contrastRatio(best, background) ? color : best), candidates[0] ?? INK)
}

/** Ajusta la luminosidad de `color` hasta alcanzar el contraste pedido sobre `background`, sin cambiar su tono. */
export function ensureContrast(color: string, background: string, minimum = 4.5): string {
  if (contrastRatio(color, background) >= minimum) return color.toUpperCase()
  const [h, s, l] = hsl(color)
  const darker = luminance(background) > 0.18
  for (let step = 1; step <= 20; step++) {
    const candidate = hslToHex(h, s, darker ? l * (1 - step / 20) : l + (1 - l) * (step / 20))
    if (contrastRatio(candidate, background) >= minimum) return candidate
  }
  return bestOn(background)
}

/** Generador pseudoaleatorio reproducible (mulberry32). */
export function seededRandom(seed: number): () => number {
  let state = (Math.floor(seed) >>> 0) || 0x9e3779b9
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const pick = <T>(random: () => number, list: readonly T[]): T => list[Math.floor(random() * list.length) % list.length]!
