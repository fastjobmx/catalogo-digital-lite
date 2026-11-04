export type LogoPalette = {
  id: 'faithful' | 'balanced' | 'vibrant'
  label: string
  palette: {
    background: string; surface: string; text: string; textMuted: string; border: string
    primary: string; secondary: string; accent: string; button: string; buttonText: string
  }
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const MAX_DECODED_BYTES = 16 * 1024 * 1024
const MAX_PIXELS = 4_000_000

/** Deterministic, bounded PNG palette extraction for Cloudflare Workers. */
export async function palettesFromPng(bytes: Uint8Array): Promise<LogoPalette[] | null> {
  const decoded = await decodePngRgba(bytes)
  if (!decoded) return null
  const { pixels, width, height } = decoded
  const buckets = new Map<string, { count: number; r: number; g: number; b: number }>()
  const stride = Math.max(1, Math.floor(Math.sqrt((width * height) / 24_000)))
  for (let y = Math.floor(stride / 2); y < height; y += stride) {
    for (let x = Math.floor(stride / 2); x < width; x += stride) {
      const offset = (y * width + x) * 4
      const alpha = pixels[offset + 3]!
      if (alpha < 40) continue
      const a = alpha / 255
      const r = Math.round(pixels[offset]! * a + 255 * (1 - a))
      const g = Math.round(pixels[offset + 1]! * a + 255 * (1 - a))
      const b = Math.round(pixels[offset + 2]! * a + 255 * (1 - a))
      const luma = (r * 299 + g * 587 + b * 114) / 1000
      if (luma > 246 || luma < 10) continue
      const key = `${r >> 5},${g >> 5},${b >> 5}`
      const bucket = buckets.get(key) || { count: 0, r: 0, g: 0, b: 0 }
      bucket.count++
      bucket.r += r
      bucket.g += g
      bucket.b += b
      buckets.set(key, bucket)
    }
  }
  const ranked = [...buckets.values()].map((bucket) => {
    const color = rgbHex(Math.round(bucket.r / bucket.count), Math.round(bucket.g / bucket.count), Math.round(bucket.b / bucket.count))
    const [h, s, l] = toHsl(color)
    const chromaWeight = s < 0.12 ? 0.32 : Math.min(1, 0.45 + s)
    const midToneWeight = l < 0.06 || l > 0.94 ? 0.2 : 1
    return { color, h, s, l, score: bucket.count * chromaWeight * midToneWeight }
  }).sort((a, b) => b.score - a.score)
  const main = ranked.find((item) => item.s >= 0.12)?.color || ranked[0]?.color || '#353535'
  const [hue, saturation] = toHsl(main)
  if (saturation < 0.12) return neutralVariants()
  const secondarySource = ranked.find((item) => item.s >= 0.12 && colorDistance(main, item.color) > 54)?.color
  const secondaryHue = secondarySource ? toHsl(secondarySource)[0] : (hue + 34) % 360
  return makeVariants(hue, saturation, secondaryHue)
}

/** Converts colors returned by a vision fallback into the same accessible variants. */
export function palettesFromColors(primary: string, secondary?: string): LogoPalette[] | null {
  if (!/^#[0-9a-f]{6}$/i.test(primary)) return null
  if (secondary && !/^#[0-9a-f]{6}$/i.test(secondary)) return null
  const [hue, saturation] = toHsl(primary)
  if (saturation < 0.12) return neutralVariants()
  const secondaryHue = secondary ? toHsl(secondary)[0] : (hue + 34) % 360
  return makeVariants(hue, Math.max(0.36, saturation), secondaryHue)
}

function makeVariants(hue: number, saturation: number, secondaryHue: number): LogoPalette[] {
  const primary = (h: number, s: number, l: number) => ensureWhiteContrast(fromHsl(h, s, l))
  const accent = (h: number, s: number, l: number) => ensureWhiteContrast(fromHsl(h, s, l))
  const make = (id: LogoPalette['id'], label: string, p: string, sec: string, acc: string, bg: string, surface: string, text: string, border: string): LogoPalette => ({
    id, label,
    palette: {
      background: bg, surface, text, textMuted: '#626870', border,
      primary: p, secondary: sec, accent: acc, button: p, buttonText: '#FFFFFF',
    },
  })
  const chroma = Math.max(0.36, Math.min(0.82, saturation || 0.5))
  const faithfulPrimary = primary(hue, chroma, 0.34)
  const faithfulAccent = accent(secondaryHue, Math.max(0.4, chroma * 0.78), 0.39)
  const balancedPrimary = primary(hue, Math.max(0.32, chroma * 0.76), 0.29)
  const balancedAccent = accent((hue + 154) % 360, 0.42, 0.36)
  const vividPrimary = primary(hue, Math.max(0.67, chroma), 0.32)
  const vividAccent = accent((hue + 28) % 360, 0.76, 0.37)
  return [
    make('faithful', 'Fiel al logotipo', faithfulPrimary, fromHsl(hue, 0.2, 0.91), faithfulAccent, '#FAFAF8', '#FFFFFF', '#202124', '#E8E6E1'),
    make('balanced', 'Elegante y equilibrada', balancedPrimary, '#E7E3DD', balancedAccent, '#F7F5F1', '#FFFFFF', '#252321', '#E4DED4'),
    make('vibrant', 'Vibrante y comercial', vividPrimary, fromHsl((hue + 28) % 360, 0.22, 0.91), vividAccent, '#F8F9FC', '#FFFFFF', '#171A20', '#E1E5EB'),
  ]
}

/** Monochrome marks stay neutral instead of being assigned an arbitrary red hue. */
function neutralVariants(): LogoPalette[] {
  const make = (id: LogoPalette['id'], label: string, primary: string, secondary: string, accent: string, background: string, surface: string, text: string, border: string): LogoPalette => ({
    id, label,
    palette: { background, surface, text, textMuted: '#626870', border, primary, secondary, accent, button: primary, buttonText: '#FFFFFF' },
  })
  return [
    make('faithful', 'Fiel al logotipo', '#30343B', '#E3E5E8', '#626870', '#FAFAF8', '#FFFFFF', '#202124', '#E4E7EB'),
    make('balanced', 'Elegante y equilibrada', '#35312C', '#E7E3DD', '#766451', '#F7F5F1', '#FFFFFF', '#252321', '#E4DED4'),
    make('vibrant', 'Vibrante y comercial', '#17324D', '#DFEAF2', '#146C68', '#F8F9FC', '#FFFFFF', '#171A20', '#E1E5EB'),
  ]
}

async function decodePngRgba(bytes: Uint8Array): Promise<{ pixels: Uint8Array; width: number; height: number } | null> {
  if (bytes.length < 33 || !PNG_SIGNATURE.every((value, index) => bytes[index] === value)) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const width = view.getUint32(16)
  const height = view.getUint32(20)
  const bitDepth = bytes[24]!
  const colorType = bytes[25]!
  const interlace = bytes[28]!
  if (!width || !height || width * height > MAX_PIXELS || bitDepth !== 8 || interlace !== 0) return null
  const channels: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }
  const channelCount = channels[colorType]
  if (!channelCount) return null
  const palette: number[][] = []
  let transparency: Uint8Array | null = null
  const dataParts: Uint8Array[] = []
  let dataLength = 0
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = view.getUint32(offset)
    const type = String.fromCharCode(bytes[offset + 4]!, bytes[offset + 5]!, bytes[offset + 6]!, bytes[offset + 7]!)
    const start = offset + 8
    if (length > bytes.length - offset - 12) return null
    if (type === 'PLTE') {
      for (let index = 0; index + 2 < length; index += 3) palette.push([bytes[start + index]!, bytes[start + index + 1]!, bytes[start + index + 2]!])
    } else if (type === 'tRNS') transparency = bytes.slice(start, start + length)
    else if (type === 'IDAT') {
      dataLength += length
      if (dataLength > MAX_DECODED_BYTES) return null
      dataParts.push(bytes.slice(start, start + length))
    }
    offset += length + 12
    if (type === 'IEND') break
  }
  if (!dataParts.length || (colorType === 3 && !palette.length)) return null
  const compressed = new Uint8Array(dataLength)
  let compressedOffset = 0
  for (const part of dataParts) { compressed.set(part, compressedOffset); compressedOffset += part.length }
  let raw: Uint8Array
  try {
    const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate'))
    raw = new Uint8Array(await new Response(stream).arrayBuffer())
  } catch { return null }
  const rowLength = width * channelCount
  if (raw.length !== (rowLength + 1) * height || raw.length > MAX_DECODED_BYTES) return null
  const rgba = new Uint8Array(width * height * 4)
  let previous = new Uint8Array(rowLength)
  for (let y = 0; y < height; y++) {
    const rawStart = y * (rowLength + 1)
    const filter = raw[rawStart]!
    const row = raw.slice(rawStart + 1, rawStart + 1 + rowLength)
    if (filter > 4) return null
    for (let x = 0; x < rowLength; x++) {
      const left = x >= channelCount ? row[x - channelCount]! : 0
      const above = previous[x]!
      const upperLeft = x >= channelCount ? previous[x - channelCount]! : 0
      if (filter === 1) row[x] = (row[x]! + left) & 255
      else if (filter === 2) row[x] = (row[x]! + above) & 255
      else if (filter === 3) row[x] = (row[x]! + Math.floor((left + above) / 2)) & 255
      else if (filter === 4) row[x] = (row[x]! + paeth(left, above, upperLeft)) & 255
    }
    for (let x = 0; x < width; x++) {
      const from = x * channelCount
      const to = (y * width + x) * 4
      if (colorType === 6) rgba.set(row.subarray(from, from + 4), to)
      else if (colorType === 2) {
        rgba[to] = row[from]!; rgba[to + 1] = row[from + 1]!; rgba[to + 2] = row[from + 2]!
        const transparent = transparency?.length === 6 && transparency[0] === 0 && transparency[2] === 0 && transparency[4] === 0
          && row[from] === transparency[1] && row[from + 1] === transparency[3] && row[from + 2] === transparency[5]
        rgba[to + 3] = transparent ? 0 : 255
      }
      else if (colorType === 0) {
        rgba[to] = row[from]!; rgba[to + 1] = row[from]!; rgba[to + 2] = row[from]!
        rgba[to + 3] = transparency?.length === 2 && transparency[0] === 0 && row[from] === transparency[1] ? 0 : 255
      }
      else if (colorType === 4) { rgba[to] = row[from]!; rgba[to + 1] = row[from]!; rgba[to + 2] = row[from]!; rgba[to + 3] = row[from + 1]! }
      else {
        const rgb = palette[row[from]!]
        if (!rgb) return null
        rgba[to] = rgb[0]!; rgba[to + 1] = rgb[1]!; rgba[to + 2] = rgb[2]!; rgba[to + 3] = transparency?.[row[from]!] ?? 255
      }
    }
    previous = row
  }
  return { pixels: rgba, width, height }
}

function paeth(left: number, above: number, upperLeft: number): number {
  const predictor = left + above - upperLeft
  const leftDistance = Math.abs(predictor - left)
  const aboveDistance = Math.abs(predictor - above)
  const upperLeftDistance = Math.abs(predictor - upperLeft)
  return leftDistance <= aboveDistance && leftDistance <= upperLeftDistance ? left : aboveDistance <= upperLeftDistance ? above : upperLeft
}

function colorDistance(a: string, b: string): number {
  const left = hexRgb(a), right = hexRgb(b)
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2])
}
function hexRgb(hex: string): [number, number, number] { return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)] }
function rgbHex(r: number, g: number, b: number): string { return `#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('').toUpperCase()}` }
function fromHsl(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs((h / 60) % 2 - 1))
  const m = l - c / 2
  const parts = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return rgbHex(...parts.map((value) => Math.round((value + m) * 255)) as [number, number, number])
}
function toHsl(hex: string): [number, number, number] {
  const [r8, g8, b8] = hexRgb(hex)
  const r = r8 / 255, g = g8 / 255, b = b8 / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min
  let h = 0
  if (delta) h = max === r ? 60 * (((g - b) / delta) % 6) : max === g ? 60 * ((b - r) / delta + 2) : 60 * ((r - g) / delta + 4)
  if (h < 0) h += 360
  const l = (max + min) / 2
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1))
  return [h, s, l]
}
function luminance(hex: string): number {
  const values = hexRgb(hex).map((value) => value / 255).map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
  return 0.2126 * values[0]! + 0.7152 * values[1]! + 0.0722 * values[2]!
}
function ensureWhiteContrast(hex: string): string {
  let [h, s, l] = toHsl(hex)
  while ((1.05 / (luminance(fromHsl(h, s, l)) + 0.05)) < 4.5 && l > 0.12) l -= 0.02
  return fromHsl(h, s, l)
}

export function contrastRatio(first: string, second: string): number {
  const a = luminance(first), b = luminance(second)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

/** Text, secondary text, buttons and links must stay readable before a palette is offered or saved. */
export function isLegiblePalette(palette: LogoPalette['palette']): boolean {
  const hexes = Object.values(palette)
  if (hexes.length !== 10 || !hexes.every((value) => /^#[0-9a-f]{6}$/i.test(value))) return false
  return contrastRatio(palette.text, palette.background) >= 4.5
    && contrastRatio(palette.textMuted, palette.surface) >= 4.5
    && contrastRatio(palette.buttonText, palette.button) >= 4.5
    && contrastRatio(palette.primary, palette.background) >= 3
}

/** Ten colors for `/admin/store-preview?palette=` in the order the web preview expects. */
export const PREVIEW_PALETTE_KEYS = ['background', 'surface', 'text', 'textMuted', 'border', 'primary', 'secondary', 'accent', 'button', 'buttonText'] as const
export function previewPaletteParam(palette: LogoPalette['palette']): string {
  return PREVIEW_PALETTE_KEYS.map((key) => palette[key].replace('#', '').toUpperCase()).join('-')
}

const NAMED_COLORS: Array<[RegExp, string, string]> = [
  [/\bazul(es)?\b|\bceleste/, '#1D4ED8', 'azules'],
  [/\bturquesa|aguamarina|\bteal\b/, '#0F766E', 'turquesa'],
  [/\bverde(s)?\b|oliva|\bmenta\b/, '#15803D', 'verdes'],
  [/\brojo(s)?\b|\broja(s)?\b/, '#B91C1C', 'rojos'],
  [/vinotinto|\bvino\b|burdeos|borgo[ñn]a/, '#7F1D1D', 'vino'],
  [/\brosa(s|do|dos)?\b|fucsia|magenta/, '#BE185D', 'rosados'],
  [/morado(s)?|violeta|\blila\b|p[uú]rpura/, '#6D28D9', 'morados'],
  [/naranja(s)?|anaranjado|coral/, '#C2410C', 'naranjas'],
  [/amarillo(s)?|dorado(s)?|mostaza/, '#A16207', 'dorados'],
  [/caf[eé]|marr[oó]n|chocolate|terracota|tierra/, '#7C4A2D', 'tierra'],
  [/beige|crema|arena|nude/, '#8B6F47', 'arena'],
  [/negro(s)?|gris(es)?|blanco(s)?|neutro(s)?|monocrom/, '#30343B', 'neutros'],
]

/** First color named in Spanish ("tonos azules", "en verde") as a brand hex, with its plural label. */
export function namedColor(text: string): { hex: string; label: string } | null {
  const lower = text.toLowerCase()
  for (const [pattern, hex, label] of NAMED_COLORS) if (pattern.test(lower)) return { hex, label }
  return null
}
