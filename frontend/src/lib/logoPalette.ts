import type { PaletteConfig } from '../types/theme'

export type LogoPaletteOption = { id: 'faithful' | 'balanced' | 'vibrant'; label: string; palette: PaletteConfig }

/** Uses the browser's image decoder, so PNG, JPG and WebP logos are supported. */
export async function palettesFromLogoFile(file: File): Promise<LogoPaletteOption[]> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Usa un logotipo PNG, JPG o WebP.')
  if (file.size > 8 * 1024 * 1024) throw new Error('El logotipo debe pesar 8 MB o menos.')
  const image = await createImageBitmap(file)
  try {
    if (image.width < 64 || image.height < 64 || image.width > 8000 || image.height > 8000 || image.width * image.height > 40_000_000) {
      throw new Error('El logotipo debe medir entre 64 px y 8000 px por lado.')
    }
    const canvas = document.createElement('canvas')
    canvas.width = 120
    canvas.height = 120
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('Este navegador no puede leer la imagen para crear una paleta.')
    context.fillStyle = '#FFFFFF'
    context.fillRect(0, 0, 120, 120)
    const scale = Math.min(120 / image.width, 120 / image.height)
    const width = image.width * scale, height = image.height * scale
    context.drawImage(image, (120 - width) / 2, (120 - height) / 2, width, height)
    const { data } = context.getImageData(0, 0, 120, 120)
    return palettesFromPixels(data)
  } finally {
    image.close()
  }
}

export function palettesFromPixels(pixels: Uint8ClampedArray): LogoPaletteOption[] {
  const bins = new Map<string, { r: number; g: number; b: number; n: number }>()
  for (let offset = 0; offset + 3 < pixels.length; offset += 4) {
    const alpha = pixels[offset + 3]! / 255
    if (alpha < 0.08) continue
    const r = Math.round(pixels[offset]! * alpha + 255 * (1 - alpha))
    const g = Math.round(pixels[offset + 1]! * alpha + 255 * (1 - alpha))
    const b = Math.round(pixels[offset + 2]! * alpha + 255 * (1 - alpha))
    const luma = (r * 299 + g * 587 + b * 114) / 1000
    if (luma > 246 || luma < 10) continue
    const key = `${r >> 5},${g >> 5},${b >> 5}`
    const bin = bins.get(key) || { r: 0, g: 0, b: 0, n: 0 }
    bin.r += r; bin.g += g; bin.b += b; bin.n++
    bins.set(key, bin)
  }
  const ranked = [...bins.values()].map((bin) => {
    const color = hex(Math.round(bin.r / bin.n), Math.round(bin.g / bin.n), Math.round(bin.b / bin.n))
    const [h, s] = hsl(color)
    return { color, h, s, score: bin.n * (s < 0.12 ? 0.3 : 0.45 + s) }
  }).sort((a, b) => b.score - a.score)
  const source = ranked.find((bin) => bin.s > 0.12) || ranked[0]
  if (!source || source.s < 0.12) return neutralPalettes()
  const hue = source?.h ?? 220
  const saturation = Math.max(0.38, Math.min(0.84, source?.s ?? 0.12))
  const otherHue = ranked.find((bin) => bin.s > 0.16 && Math.abs(bin.h - hue) > 24)?.h ?? (hue + 34) % 360
  const variants = [
    { id: 'faithful' as const, label: 'Fiel al logotipo', primary: safePrimary(hue, saturation, 0.34), accent: safePrimary(otherHue, Math.max(0.4, saturation * 0.75), 0.4), background: '#FAFAF8', surface: '#FFFFFF', secondary: shade(hue, 0.18, 0.91), border: '#E8E6E1' },
    { id: 'balanced' as const, label: 'Elegante y equilibrada', primary: safePrimary(hue, saturation * 0.76, 0.3), accent: safePrimary((hue + 154) % 360, 0.42, 0.36), background: '#F7F5F1', surface: '#FFFFFF', secondary: '#E7E3DD', border: '#E4DED4' },
    { id: 'vibrant' as const, label: 'Vibrante y comercial', primary: safePrimary(hue, Math.max(0.7, saturation), 0.32), accent: safePrimary((hue + 28) % 360, 0.76, 0.37), background: '#F8F9FC', surface: '#FFFFFF', secondary: shade((hue + 28) % 360, 0.22, 0.91), border: '#E1E5EB' },
  ]
  return variants.map((variant) => ({
    id: variant.id,
    label: variant.label,
    palette: {
      background: variant.background, surface: variant.surface, text: '#202124', textMuted: '#626870', border: variant.border,
      primary: variant.primary, secondary: variant.secondary, accent: variant.accent, button: variant.primary, buttonText: '#FFFFFF',
    },
  }))
}

function neutralPalettes(): LogoPaletteOption[] {
  const palette = (background: string, primary: string, secondary: string, accent: string, border: string): PaletteConfig => ({
    background, surface: '#FFFFFF', text: '#202124', textMuted: '#626870', border,
    primary, secondary, accent, button: primary, buttonText: '#FFFFFF',
  })
  return [
    { id: 'faithful', label: 'Fiel al logotipo', palette: palette('#FAFAF8', '#30343B', '#E3E5E8', '#626870', '#E4E7EB') },
    { id: 'balanced', label: 'Elegante y equilibrada', palette: palette('#F7F5F1', '#35312C', '#E7E3DD', '#766451', '#E4DED4') },
    { id: 'vibrant', label: 'Vibrante y comercial', palette: palette('#F8F9FC', '#17324D', '#DFEAF2', '#146C68', '#E1E5EB') },
  ]
}

export function contrastRatio(first: string, second: string): number {
  const a = luminance(first), b = luminance(second)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

function safePrimary(hue: number, saturation: number, lightness: number): string {
  let value = shade(hue, saturation, lightness)
  while (contrastRatio(value, '#FFFFFF') < 4.5 && lightness > 0.1) value = shade(hue, saturation, lightness -= 0.02)
  return value
}
function shade(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs((h / 60) % 2 - 1))
  const m = l - c / 2
  const values = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return hex(...values.map((value) => Math.round((value + m) * 255)) as [number, number, number])
}
function hsl(value: string): [number, number, number] {
  const [r8, g8, b8] = rgb(value), [r, g, b] = [r8 / 255, g8 / 255, b8 / 255]
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  let h = 0
  if (d) h = max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4)
  if (h < 0) h += 360
  const l = (max + min) / 2
  return [h, d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1)), l]
}
function rgb(value: string): [number, number, number] { return [parseInt(value.slice(1, 3), 16), parseInt(value.slice(3, 5), 16), parseInt(value.slice(5, 7), 16)] }
function hex(r: number, g: number, b: number): string { return `#${[r, g, b].map((part) => part.toString(16).padStart(2, '0')).join('').toUpperCase()}` }
function luminance(value: string): number {
  return rgb(value).map((part) => part / 255).map((part) => part <= 0.04045 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4).reduce((sum, part, index) => sum + part * [0.2126, 0.7152, 0.0722][index]!, 0)
}
