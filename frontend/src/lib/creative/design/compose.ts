/** Motor de composición publicitaria (sin IA).
 *
 * Decide la distribución de una pieza a partir de los datos reales del plan, el análisis de la foto y el
 * espacio disponible: mide cada texto con la fuente real, lo ajusta (tamaño y líneas) a su zona, reparte
 * el espacio entre el producto y la información sin superposiciones, y declara sobre qué color se lee cada
 * texto para poder comprobar el contraste. El resultado es una lista de capas que render.ts pinta tal cual.
 *
 * Reglas fijas:
 *  - el nombre, la referencia, el precio, el precio anterior y la etiqueta se dibujan con el texto exacto del plan;
 *  - el precio nunca se corta: se reduce la letra hasta que cabe en una línea;
 *  - la foto nunca se deforma: se encaja (contain) o se recorta como máximo un 18 % cuando la proporción casi coincide. */
import type { DesignOptions, Layer, LayerRole, PlanProduct, PlanSpec, Scene, TextStyle } from '../scene'
import { INK, WHITE, bestOn, contrastRatio, ensureContrast, hsl, hslToHex, isHex, mix, pick, rgba, seededRandom } from './color'
import { cssFont } from './fonts'
import { subjectRect, type Box, type PhotoAnalysis } from './photo'
import { LAYOUT_KEYS, isLayout, isStyle, styleOf, type DesignStyleDef, type LayoutKey, type Palette } from './styles'

export type Measure = (text: string, font: string) => number
export interface DesignContext {
  /** Análisis de cada foto y del logo, por su fuente. */
  photos: Map<string, PhotoAnalysis>
  /** Fuentes con recorte de fondo disponible (mapa de bits `cut:<fuente>`). */
  cutouts: Set<string>
  measure: Measure
}

/** Momentos de aparición en video (segundos), los mismos de la composición clásica. */
const AT = { logo: 0.2, etiqueta: 0.6, categoria: 0.5, nombre: 0.9, referencia: 1.1, precio: 1.4, descripcion: 1.9, cta: 2.4 } as const

export const cutKey = (src: string) => `cut:${src}`

const round = (box: Box): Box => ({ x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.w), h: Math.round(box.h) })
const inset = (box: Box, dx: number, dy = dx): Box => ({ x: box.x + dx, y: box.y + dy, w: Math.max(1, box.w - dx * 2), h: Math.max(1, box.h - dy * 2) })
const base = (role: LayerRole, box: Box, at = 0) => ({ role, ...round(box), opacity: 1, offsetY: 0, at })

/** Encaja una proporción dentro de una caja sin deformar. */
export function containRect(aspect: number, box: Box, alignY: 'center' | 'bottom' | 'top' = 'center'): Box {
  let w = box.w, h = box.w / aspect
  if (h > box.h) { h = box.h; w = h * aspect }
  const y = alignY === 'bottom' ? box.y + box.h - h : alignY === 'top' ? box.y : box.y + (box.h - h) / 2
  return { x: box.x + (box.w - w) / 2, y, w, h }
}

// ---- texto ---------------------------------------------------------------------------------------

interface Fitted { size: number; lines: string[]; truncated: boolean; width: number }
interface FitOptions { family: string; weight: number; italic?: boolean; letterSpacing?: number; maxWidth: number; maxLines: number; maxSize: number; minSize: number; /** Alto máximo del bloque (con su interlineado). */ maxHeight?: number; lineHeight?: number }

const width = (measure: Measure, text: string, font: string, spacing: number) => measure(text, font) + Math.max(0, text.length - 1) * spacing

function wrap(measure: Measure, text: string, font: string, spacing: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (!line || width(measure, candidate, font, spacing) <= maxWidth) line = candidate
    else { lines.push(line); line = word }
  }
  if (line) lines.push(line)
  return lines
}

/** Tamaño mayor (entre min y max) con el que el texto cabe completo en `maxLines`. Si no cabe ni al mínimo,
 * se corta la última línea con puntos suspensivos y se marca como truncado (el control de calidad lo avisa). */
export function fitText(measure: Measure, text: string, options: FitOptions): Fitted {
  const spacingOf = (size: number) => (options.letterSpacing ?? 0) * size
  for (let size = options.maxSize; size >= options.minSize; size = size * 0.94) {
    const font = cssFont(options.family, options.weight, size, options.italic)
    const lines = wrap(measure, text, font, spacingOf(size), options.maxWidth)
    const widest = Math.max(0, ...lines.map((line) => width(measure, line, font, spacingOf(size))))
    const tall = options.maxHeight !== undefined && lines.length * size * (options.lineHeight ?? 1.15) > options.maxHeight
    if (lines.length <= options.maxLines && widest <= options.maxWidth && !tall) return { size, lines, truncated: false, width: widest }
  }
  const size = options.minSize
  const font = cssFont(options.family, options.weight, size, options.italic)
  const spacing = spacingOf(size)
  const lines = wrap(measure, text, font, spacing, options.maxWidth)
  const kept = lines.slice(0, options.maxLines)
  let last = kept[kept.length - 1] ?? ''
  if (lines.length > options.maxLines || width(measure, last, font, spacing) > options.maxWidth) {
    while (last.length > 1 && width(measure, `${last}…`, font, spacing) > options.maxWidth) last = last.slice(0, -1).trimEnd()
    kept[kept.length - 1] = `${last}…`
  }
  return { size, lines: kept, truncated: true, width: Math.max(0, ...kept.map((line) => width(measure, line, font, spacing))) }
}

/** Primeras frases completas de un texto que caben en las líneas dadas (nunca corta a media frase). */
function sentences(measure: Measure, text: string, options: Omit<FitOptions, 'maxSize' | 'minSize'> & { size: number }): string[] | null {
  const parts = text.replace(/\s+/g, ' ').trim().split(/(?<=[.!?;])\s+/).filter(Boolean)
  const font = cssFont(options.family, options.weight, options.size, options.italic)
  let best: string[] | null = null
  let current = ''
  for (const part of parts) {
    const candidate = current ? `${current} ${part}` : part
    const lines = wrap(measure, candidate, font, 0, options.maxWidth)
    if (lines.length > options.maxLines) break
    current = candidate
    best = lines
  }
  return best
}

type TextLayer = Extract<Layer, { type: 'text' }>
function textLayer(role: LayerRole, fitted: Fitted, box: { x: number; y: number; w: number }, color: string, on: string, style: TextStyle, weight: number, align: 'left' | 'center' | 'right', at: number, extra: Partial<TextLayer> = {}): TextLayer {
  const lineHeight = style.lineHeight ?? 1.15
  return {
    ...base(role, { x: box.x, y: box.y, w: box.w, h: Math.ceil(fitted.lines.length * fitted.size * lineHeight) }, at),
    type: 'text', text: fitted.lines.join(' '), lines: fitted.lines, size: Math.round(fitted.size * 10) / 10, weight: weight as TextLayer['weight'],
    color, align, maxLines: fitted.lines.length, strike: false, shrink: false, font: { ...style, lineHeight }, on, ...extra,
  }
}

// ---- contexto de la pieza ------------------------------------------------------------------------

interface Frame {
  spec: PlanSpec; product: PlanProduct | null; design: DesignOptions; style: DesignStyleDef; colors: Palette
  W: number; H: number; u: number; m: number; top: number; bottom: number
  orient: 'vertical' | 'cuadrado' | 'horizontal'; wide: boolean
  random: () => number; ctx: DesignContext; layers: Layer[]
}

const upper = (frame: Frame, text: string) => (frame.style.display.uppercase ? text.toLocaleUpperCase('es') : text)

function displayStyle(frame: Frame): TextStyle {
  return { family: frame.style.display.family, italic: frame.style.display.italic, letterSpacing: frame.style.display.letterSpacing ?? 0, lineHeight: frame.style.display.uppercase ? 1.02 : 1.1 }
}

// ---- piezas de información ----------------------------------------------------------------------

interface InfoOptions {
  box: Box; align: 'left' | 'center'; valign: 'top' | 'center' | 'bottom'; on: string
  nameSize: number; nameLines?: number; ink?: string; muted?: string; price?: string
  eyebrow?: boolean; description?: boolean; cta?: boolean; ctaFull?: boolean; withPrice?: boolean
}

/** Pila de información: rótulo, nombre, referencia, descripción, precio y llamada a la acción.
 * Se mide completa y, si no cabe, se simplifica por pasos (sin descripción, letra menor, sin rótulo). */
function infoStack(frame: Frame, options: InfoOptions): { layers: Layer[]; used: Box } {
  const { u, product, spec, style, colors, design, ctx } = frame
  // Sobre un fondo distinto del principal (tarjeta, panel), los colores se ajustan para seguir siendo legibles.
  const readable = (color: string, minimum: number) => (contrastRatio(color, options.on) >= minimum ? color : contrastRatio(INK, options.on) >= contrastRatio(WHITE, options.on) ? ensureContrast(mix(color, INK, 0.7), options.on, minimum) : ensureContrast(mix(color, WHITE, 0.7), options.on, minimum))
  const ink = readable(options.ink ?? colors.ink, 4.5)
  const muted = readable(options.muted ?? colors.muted, 4.5)
  const priceColor = readable(options.price ?? colors.price, 4.5)
  const attempts: Array<{ nameScale: number; description: boolean; eyebrow: boolean; reference: boolean; priceScale: number }> = [
    { nameScale: 1, description: true, eyebrow: true, reference: true, priceScale: 1 },
    { nameScale: 1, description: false, eyebrow: true, reference: true, priceScale: 1 },
    { nameScale: 0.82, description: false, eyebrow: true, reference: true, priceScale: 0.9 },
    { nameScale: 0.7, description: false, eyebrow: false, reference: true, priceScale: 0.8 },
    { nameScale: 0.6, description: false, eyebrow: false, reference: false, priceScale: 0.7 },
    { nameScale: 0.48, description: false, eyebrow: false, reference: false, priceScale: 0.58 },
  ]
  const gap = u * 1.6
  let result: { layers: Layer[]; height: number } = { layers: [], height: Infinity }
  for (const attempt of attempts) {
    const layers: Layer[] = []
    let y = 0
    const x = options.box.x
    const w = options.box.w
    const push = (layer: Layer, after = gap) => { layer.y += 0; layers.push(layer); y = layer.y + layer.h + after }
    const eyebrowText = product?.category || null
    if (options.eyebrow !== false && attempt.eyebrow && eyebrowText) {
      const fitted = fitText(ctx.measure, eyebrowText.toLocaleUpperCase('es'), { family: style.eyebrow.family, weight: style.eyebrow.weight, letterSpacing: style.eyebrow.letterSpacing, maxWidth: w, maxLines: 1, maxSize: u * 2.3, minSize: u * 1.6 })
      if (!fitted.truncated) push(textLayer('categoria', fitted, { x, y, w }, muted, options.on, { family: style.eyebrow.family, letterSpacing: style.eyebrow.letterSpacing }, style.eyebrow.weight, options.align, AT.categoria), u * 1.1)
    }
    if (product) {
      const fitted = fitText(ctx.measure, upper(frame, product.name), { family: style.display.family, weight: style.display.weight, italic: style.display.italic, letterSpacing: style.display.letterSpacing, maxWidth: w, maxLines: options.nameLines ?? 3, maxSize: options.nameSize * attempt.nameScale, minSize: u * 3 })
      push(textLayer('nombre', fitted, { x, y, w }, ink, options.on, displayStyle(frame), style.display.weight, options.align, AT.nombre), u * 1.2)
    }
    if (product?.reference && design.showReference && attempt.reference) {
      const fitted = fitText(ctx.measure, `REF. ${product.reference}`, { family: style.eyebrow.family, weight: 600, letterSpacing: 0.08, maxWidth: w, maxLines: 1, maxSize: u * 2.1, minSize: u * 1.6 })
      push(textLayer('referencia', fitted, { x, y, w }, muted, options.on, { family: style.eyebrow.family, letterSpacing: 0.08 }, 600, options.align, AT.referencia), gap)
    }
    if (options.description && attempt.description && spec.copy.description) {
      const size = u * 2.5
      const lines = sentences(ctx.measure, spec.copy.description, { family: style.body.family, weight: style.body.weight, maxWidth: w, maxLines: 2, size })
      if (lines) push(textLayer('descripcion', { size, lines, truncated: false, width: w }, { x, y, w }, muted, options.on, { family: style.body.family, lineHeight: 1.35 }, style.body.weight, options.align, AT.descripcion), gap)
    }
    if (product && design.showPrice && options.withPrice !== false) {
      const block = priceBlock(frame, product, { x, y, w }, options.align, options.on, attempt.priceScale, priceColor)
      layers.push(...block.layers)
      y += block.height + gap * 1.2
    }
    if (options.cta) {
      const cta = ctaPill(frame, { x, y, w }, options.align, options.ctaFull ?? false)
      layers.push(cta)
      y = cta.y + cta.h + gap
    }
    const height = y - gap
    result = { layers, height }
    if (height <= options.box.h) break
  }
  const shift = options.valign === 'top' ? options.box.y : options.valign === 'bottom' ? options.box.y + options.box.h - result.height : options.box.y + (options.box.h - result.height) / 2
  for (const layer of result.layers) layer.y = Math.round(layer.y + shift)
  return { layers: result.layers, used: { x: options.box.x, y: shift, w: options.box.w, h: result.height } }
}

/** Precio (y precio anterior tachado). Forma según el estilo: liso, subrayado, cápsula, etiqueta o sello. */
function priceBlock(frame: Frame, product: PlanProduct, area: { x: number; y: number; w: number }, align: 'left' | 'center', on: string, scale = 1, color?: string): { layers: Layer[]; height: number } {
  const { u, style, colors, ctx, orient } = frame
  const layers: Layer[] = []
  const shape = style.price.shape
  const maxSize = u * (orient === 'horizontal' ? 7.4 : 8.2) * scale
  const fitPrice = (maxWidth: number, size = maxSize) => fitText(ctx.measure, product.priceText, { family: style.price.family, weight: style.price.weight, maxWidth, maxLines: 1, maxSize: size, minSize: u * 2.6 })
  let y = area.y
  if (product.compareAtText) {
    const before = fitText(ctx.measure, product.compareAtText, { family: style.body.family, weight: 600, maxWidth: area.w * 0.6, maxLines: 1, maxSize: u * 3.2 * scale, minSize: u * 2 })
    layers.push(textLayer('precio_anterior', before, { x: area.x, y, w: area.w }, on === colors.bg ? colors.muted : ensureContrast(colors.muted, on, 4.5), on, { family: style.body.family }, 600, align, AT.precio, { strike: true, shrink: true }))
    y += before.size * 1.25 + u * 0.4
  }
  if (shape === 'pill' || shape === 'tag') {
    const padX = u * 2.6, padY = u * 1.3
    const fitted = fitPrice(area.w - padX * 2, maxSize * 0.82)
    const boxW = fitted.width + padX * 2
    const boxH = fitted.size * 1.15 + padY * 2
    const bx = align === 'center' ? area.x + (area.w - boxW) / 2 : area.x
    const bg = shape === 'pill' ? colors.highlight : colors.accent
    const fg = bestOn(bg)
    layers.push({ ...base('precio', { x: bx, y, w: boxW, h: boxH }, AT.precio), type: 'rect', color: bg, radius: shape === 'pill' ? boxH / 2 : u * 1.2 })
    layers.push(textLayer('precio', fitted, { x: bx + padX, y: y + padY, w: boxW - padX * 2 }, fg, bg, { family: style.price.family }, style.price.weight, 'left', AT.precio, { shrink: true }))
    return { layers, height: y - area.y + boxH }
  }
  if (shape === 'burst') {
    const fitted = fitPrice(area.w * 0.9, maxSize)
    const diameter = Math.min(area.w, Math.max(fitted.width / 0.74, u * 20 * scale))
    const inner = fitPrice(diameter * 0.74, maxSize)
    const bx = align === 'center' ? area.x + (area.w - diameter) / 2 : area.x
    layers.push({ ...base('precio', { x: bx, y, w: diameter, h: diameter }, AT.precio), type: 'shape', shape: 'burst', color: colors.highlight, stroke: 0, rotation: frame.random() * 20 - 10, seed: 0, size: 16 })
    const textW = diameter * 0.74
    layers.push(textLayer('precio', inner, { x: bx + (diameter - textW) / 2, y: y + (diameter - inner.size * 1.02) / 2, w: textW }, colors.onHighlight, colors.highlight, { family: style.price.family, lineHeight: 1.02 }, style.price.weight, 'center', AT.precio, { shrink: true }))
    return { layers, height: y - area.y + diameter }
  }
  const fitted = fitPrice(area.w)
  const priceColor = color ?? colors.price
  layers.push(textLayer('precio', fitted, { x: area.x, y, w: area.w }, priceColor, on, { family: style.price.family, lineHeight: 1.1 }, style.price.weight, align, AT.precio, { shrink: true }))
  let height = y - area.y + fitted.size * 1.1
  if (shape === 'underline') {
    const ruleW = Math.min(area.w, u * 9)
    layers.push({ ...base('decoracion', { x: align === 'center' ? area.x + (area.w - ruleW) / 2 : area.x, y: y + fitted.size * 1.18, w: ruleW, h: Math.max(2, u * 0.35) }, AT.precio), type: 'rect', color: priceColor, radius: 0 })
    height += u * 1.2
  }
  return { layers, height }
}

function ctaPill(frame: Frame, area: { x: number; y: number; w: number }, align: 'left' | 'center' | 'right', full: boolean, bg = frame.colors.accent): Extract<Layer, { type: 'pill' }> {
  const { u, style, ctx, spec, orient } = frame
  const size = u * (orient === 'horizontal' ? 2.9 : 3.1)
  const padX = size * 0.9
  const fitted = fitText(ctx.measure, spec.copy.cta, { family: style.body.family, weight: 700, maxWidth: area.w - padX * 2, maxLines: 1, maxSize: size, minSize: u * 2 })
  const pillW = full ? area.w : Math.min(area.w, fitted.width + padX * 2)
  const h = fitted.size * 2.1
  const x = align === 'center' ? area.x + (area.w - pillW) / 2 : align === 'right' ? area.x + area.w - pillW : area.x
  return { ...base('cta', { x, y: area.y, w: pillW, h }, AT.cta), type: 'pill', text: spec.copy.cta, size: Math.round(fitted.size * 10) / 10, bg, color: bestOn(bg), align: 'center', font: { family: style.body.family }, weight: 700, radius: style.radius > 0.5 ? h / 2 : u * 0.4, on: bg }
}

/** Logo encajado en su proporción real. Con fondo propio (no transparente) se apoya en una placa de su color. */
function logoLayers(frame: Frame, anchor: { x: number; y: number }, align: 'left' | 'center' | 'right', maxW: number, maxH: number, on = frame.colors.bg): { layers: Layer[]; box: Box | null } {
  const logo = frame.spec.brand.logoUrl
  if (!logo) return { layers: [], box: null }
  const info = frame.ctx.photos.get(logo)
  const aspect = info ? info.width / info.height : 1
  // Logo transparente: si su color principal se pierde sobre el fondo, se apoya en una placa que contraste.
  const logoColor = info?.dominant[0]
  const lost = Boolean(info?.background.transparent && logoColor && isHex(on) && contrastRatio(logoColor, on) < 2.2)
  const plate = info ? !info.background.transparent || lost : true
  const plateColor = lost && logoColor ? (contrastRatio(logoColor, INK) >= contrastRatio(logoColor, WHITE) ? INK : WHITE) : info && isHex(info.background.color) ? info.background.color : WHITE
  const pad = plate ? frame.u * 1 : 0
  const fitted = containRect(aspect, { x: 0, y: 0, w: maxW - pad * 2, h: maxH - pad * 2 })
  const outerW = fitted.w + pad * 2, outerH = fitted.h + pad * 2
  const x = align === 'center' ? anchor.x - outerW / 2 : align === 'right' ? anchor.x - outerW : anchor.x
  const box = { x, y: anchor.y, w: outerW, h: outerH }
  const layers: Layer[] = []
  if (plate) layers.push({ ...base('logo', box, AT.logo), type: 'rect', color: plateColor, radius: frame.u * 1.4 })
  layers.push({ ...base('logo', { x: x + pad, y: anchor.y + pad, w: fitted.w, h: fitted.h }, AT.logo), type: 'image', src: logo, fit: 'contain', radius: 0, zoom: 1, reveal: 1 })
  return { layers, box }
}

function badgePill(frame: Frame, anchor: { x: number; y: number }, align: 'left' | 'right', maxW: number, bg = frame.colors.highlight): Extract<Layer, { type: 'pill' }> | null {
  const badge = frame.spec.badge
  if (!badge) return null
  const { u, style, ctx } = frame
  const size = u * 2.7
  const fitted = fitText(ctx.measure, badge, { family: style.eyebrow.family, weight: 800, letterSpacing: 0.04, maxWidth: maxW - size * 1.8, maxLines: 1, maxSize: size, minSize: u * 1.8 })
  const w = fitted.width + fitted.size * 1.8
  const h = fitted.size * 2.1
  return { ...base('etiqueta', { x: align === 'right' ? anchor.x - w : anchor.x, y: anchor.y, w, h }, AT.etiqueta), type: 'pill', text: badge, size: Math.round(fitted.size * 10) / 10, bg, color: bestOn(bg), align: 'center', font: { family: style.eyebrow.family, letterSpacing: 0.04 }, weight: 800, radius: style.radius > 0.5 ? h / 2 : u * 0.3, on: bg }
}

// ---- fondo y recursos gráficos -------------------------------------------------------------------

function background(frame: Frame, color = frame.colors.bg, color2 = frame.colors.bg2, focus?: { x: number; y: number }) {
  const { W, H, style, layers, colors } = frame
  layers.push({ ...base('fondo', { x: 0, y: 0, w: W, h: H }), type: 'rect', color, radius: 0 })
  if (style.background === 'lineal') layers.push({ ...base('fondo', { x: 0, y: 0, w: W, h: H }), type: 'gradient', stops: [[0, color], [1, color2]], angle: 160, radial: false, radius: 0 })
  if (style.background === 'radial') {
    const cx = focus?.x ?? W / 2, cy = focus?.y ?? H * 0.45
    const r = Math.max(W, H) * 0.75
    layers.push({ ...base('fondo', { x: cx - r, y: cy - r, w: r * 2, h: r * 2 }), type: 'gradient', stops: [[0, colors.glow], [0.45, color], [1, color2]], angle: 0, radial: true, radius: 0 })
  }
  if (style.texture !== 'none') texture(frame, { x: 0, y: 0, w: W, h: H }, style.texture)
}

function texture(frame: Frame, box: Box, kind: DesignStyleDef['texture'], color?: string) {
  if (kind === 'none') return
  const tone = color ?? (contrastRatio(frame.colors.bg, INK) > contrastRatio(frame.colors.bg, WHITE) ? 'rgba(17,24,39,0.07)' : 'rgba(255,255,255,0.09)')
  frame.layers.push({ ...base('decoracion', box), type: 'shape', shape: kind, color: tone, stroke: Math.max(1, frame.u * 0.25), rotation: kind === 'lines' ? -32 : 0, seed: Math.floor(frame.random() * 1e6), size: frame.u * (kind === 'dots' ? 2.4 : kind === 'grid' ? 7 : kind === 'lines' ? 3.2 : 1) })
}

/** Figuras decorativas reproducibles (misma semilla, misma posición), en zonas de fondo. */
function decorate(frame: Frame, stage: Box) {
  const { u, W, H, colors, random, layers, style } = frame
  for (const decor of style.decor) {
    if (decor === 'circles') {
      const r = Math.max(stage.w, stage.h) * (0.42 + random() * 0.08)
      layers.push({ ...base('decoracion', { x: stage.x + stage.w / 2 - r, y: stage.y + stage.h / 2 - r, w: r * 2, h: r * 2 }), type: 'shape', shape: 'circle', color: rgba(colors.highlight.startsWith('#') ? colors.highlight : '#FFFFFF', 0.16), stroke: 0, rotation: 0, seed: 0 })
      const small = u * (5 + random() * 4)
      const corner = pick(random, [[W - small * 1.6, H * 0.08], [small * 0.6, H * 0.6], [W * 0.82, H * 0.62]] as const)
      layers.push({ ...base('decoracion', { x: corner[0], y: corner[1], w: small, h: small }), type: 'shape', shape: 'ring', color: rgba(colors.accent, 0.35), stroke: u * 0.8, rotation: 0, seed: 0 })
    } else if (decor === 'dots') {
      const size = u * 16
      const x = random() > 0.5 ? W - size - u * 3 : u * 3
      layers.push({ ...base('decoracion', { x, y: stage.y + stage.h - size * 0.6, w: size, h: size * 0.6 }), type: 'shape', shape: 'dots', color: rgba(colors.accent, 0.3), stroke: 0, rotation: 0, seed: 0, size: u * 2.6 })
    } else if (decor === 'arcs') {
      const r = Math.max(stage.w, stage.h) * 0.62
      layers.push({ ...base('decoracion', { x: stage.x + stage.w / 2 - r, y: stage.y + stage.h / 2 - r, w: r * 2, h: r * 2 }), type: 'shape', shape: 'arc', color: rgba(colors.line, 0.7), stroke: Math.max(1.5, u * 0.18), rotation: 200 + random() * 40, seed: 0 })
    } else if (decor === 'blobs') {
      // Formas orgánicas en dos esquinas opuestas (la semilla decide cuáles).
      const corners = random() > 0.5 ? [[-0.18, -0.1], [0.72, 0.68]] : [[0.7, -0.12], [-0.2, 0.7]]
      corners.forEach(([fx, fy], index) => {
        const size = Math.max(W, H) * (0.42 + random() * 0.12)
        layers.push({ ...base('decoracion', { x: W * fx!, y: H * fy!, w: size, h: size * (0.8 + random() * 0.3) }), type: 'shape', shape: 'blob', color: rgba(colors.highlight.startsWith('#') ? colors.highlight : '#FFFFFF', index ? 0.22 : 0.3), stroke: 0, rotation: 0, seed: Math.floor(random() * 1000) })
      })
    } else if (decor === 'sparkles') {
      for (let i = 0; i < 3; i++) {
        const s = u * (2 + random() * 2.5)
        layers.push({ ...base('decoracion', { x: stage.x + random() * stage.w, y: stage.y + random() * stage.h * 0.5, w: s, h: s }), type: 'shape', shape: 'sparkle', color: rgba(colors.glow, 0.85), stroke: 0, rotation: 0, seed: i })
      }
    } else if (decor === 'stripes') {
      const h = u * 6
      layers.push({ ...base('decoracion', { x: -W * 0.1, y: H * (0.04 + random() * 0.04), w: W * 1.2, h }), type: 'shape', shape: 'lines', color: rgba(colors.highlight, 0.22), stroke: u * 0.9, rotation: -32, seed: 0, size: u * 2.6 })
    } else if (decor === 'frame') {
      const d = u * 2.8
      layers.push({ ...base('decoracion', { x: d, y: d, w: W - d * 2, h: H - d * 2 }), type: 'rect', color: colors.line, radius: 0, stroke: Math.max(1.5, u * 0.15) })
    } else if (decor === 'grid') {
      layers.push({ ...base('decoracion', stage), type: 'shape', shape: 'grid', color: rgba(colors.line, 0.55), stroke: 1, rotation: 0, seed: 0, size: u * 6 })
    }
  }
}

// ---- producto --------------------------------------------------------------------------------------

interface VisualOptions { floor: boolean; frameRadius?: number; mask?: 'rect' | 'circle' | 'arch'; backdrop?: 'circle' | 'arch' | null; frameColor?: string; allowCover?: boolean; shadow?: boolean }

/** Pone el producto en la zona dada. Con recorte confiable: producto aislado con sombra (y reflejo).
 * Con fondo liso sin recorte: la foto encajada sobre su propio color de fondo. Con fondo complejo: foto
 * encajada sobre una versión desenfocada de sí misma (o recortada levemente si la proporción casi coincide). */
function productVisual(frame: Frame, stage: Box, options: VisualOptions): Box {
  const { product, design, ctx, u, colors, style, layers } = frame
  const src = product?.image
  if (!src) return stage
  const info = ctx.photos.get(src)
  const shadowColor = 'rgba(0,0,0,0.28)'
  if (design.removeBg && ctx.cutouts.has(src) && info) {
    const rect = subjectRect(info, 0.02)
    const aspect = rect.w / rect.h
    const reflection = options.floor ? style.reflection : 0
    const area = inset(stage, stage.w * 0.04, stage.h * 0.03)
    const usable = { ...area, h: area.h * (reflection ? 0.84 : options.floor ? 0.93 : 1) }
    const fitted = containRect(aspect, usable, options.floor ? 'bottom' : 'center')
    if (options.backdrop) {
      const r = Math.max(fitted.w, fitted.h) * 0.62
      const cx = fitted.x + fitted.w / 2, cy = fitted.y + fitted.h / 2
      const box = options.backdrop === 'circle' ? { x: cx - r, y: cy - r, w: r * 2, h: r * 2 } : { x: fitted.x - fitted.w * 0.12, y: fitted.y - fitted.h * 0.1, w: fitted.w * 1.24, h: fitted.h * 1.16 }
      layers.push({ ...base('decoracion', box), type: 'shape', shape: options.backdrop === 'circle' ? 'circle' : 'blob', color: options.frameColor ?? colors.panel, stroke: 0, rotation: 0, seed: 7 })
    }
    if (options.floor && style.shadow !== 'ninguna') {
      const sw = fitted.w * 0.86, sh = Math.max(u * 1.6, fitted.h * 0.06)
      layers.push({ ...base('decoracion', { x: fitted.x + (fitted.w - sw) / 2, y: fitted.y + fitted.h - sh * 0.55, w: sw, h: sh }), type: 'shape', shape: 'ellipse', color: style.shadow === 'marcada' ? 'rgba(0,0,0,0.42)' : shadowColor, stroke: 0, rotation: 0, seed: 0 })
    }
    layers.push({
      ...base('foto', fitted), type: 'image', src: cutKey(src), fit: 'contain', radius: 0, zoom: 1, reveal: 1,
      shadow: style.shadow === 'ninguna' || options.shadow === false ? undefined : { blur: u * (style.shadow === 'marcada' ? 2.2 : 3.2), offsetY: u * (style.shadow === 'marcada' ? 1.6 : 1.2), color: style.shadow === 'marcada' ? 'rgba(0,0,0,0.32)' : 'rgba(0,0,0,0.16)' },
      reflection: reflection || undefined, subject: round(fitted),
    })
    return fitted
  }
  const radius = options.frameRadius ?? u * style.radius
  const sourceW = info?.width ?? 1000, sourceH = info?.height ?? 1000
  if (info?.background.uniform) {
    // Fondo liso: se encuadra el producto (sin deformar) y el marco toma el color de fondo de la foto.
    const crop = subjectRect(info, 0.07)
    const box = options.mask === 'circle' ? containRect(1, stage) : stage
    const fitted = containRect(crop.w / crop.h, inset(box, box.w * (options.mask === 'circle' ? 0.14 : 0.04)))
    layers.push({
      ...base('foto', box), type: 'image', src, fit: 'contain', radius, zoom: 1, reveal: 1, matte: info.background.color, mask: options.mask, crop: round(crop),
      shadow: options.shadow === false || style.shadow === 'ninguna' ? undefined : { blur: u * 3, offsetY: u * 1.2, color: 'rgba(0,0,0,0.14)' }, subject: round(fitted),
    })
    return box
  }
  const photoAspect = sourceW / sourceH
  const stageAspect = stage.w / stage.h
  const box = options.mask === 'circle' ? containRect(1, stage) : stage
  if (options.allowCover !== false && Math.abs(photoAspect - stageAspect) / stageAspect <= 0.18) {
    layers.push({ ...base('foto', box), type: 'image', src, fit: 'cover', radius, zoom: 1, reveal: 1, mask: options.mask, shadow: options.shadow === false ? undefined : { blur: u * 3, offsetY: u * 1.2, color: 'rgba(0,0,0,0.16)' }, subject: round(box) })
    return box
  }
  // Proporción distinta: la foto completa en su proporción natural, como una tarjeta con sombra
  // (nada del producto se recorta ni se deforma).
  const fitted = containRect(photoAspect, box)
  if (options.mask === 'circle') {
    layers.push({ ...base('decoracion', box), type: 'image', src, fit: 'cover', radius, zoom: 1, reveal: 1, blur: 1, mask: 'circle' })
    layers.push({ ...base('foto', fitted), type: 'image', src, fit: 'contain', radius: 0, zoom: 1, reveal: 1, subject: round(fitted) })
    return box
  }
  layers.push({ ...base('foto', fitted), type: 'image', src, fit: 'contain', radius, zoom: 1, reveal: 1, mask: options.mask === 'arch' && fitted.h > fitted.w * 0.9 ? 'arch' : undefined, shadow: options.shadow === false ? undefined : { blur: u * 3.2, offsetY: u * 1.4, color: 'rgba(0,0,0,0.2)' }, subject: round(fitted) })
  return fitted
}

// ---- composiciones ---------------------------------------------------------------------------------

function header(frame: Frame, y: number, logoAlign: 'left' | 'center' | 'right' = 'left', badgeAlign: 'left' | 'right' = 'right', onColor?: string): number {
  const { m, W, u } = frame
  const logoH = u * (frame.orient === 'horizontal' ? 10 : 9)
  const anchorX = logoAlign === 'left' ? m : logoAlign === 'center' ? W / 2 : W - m
  const logo = logoLayers(frame, { x: anchorX, y }, logoAlign, u * 24, logoH, onColor ?? frame.colors.bg)
  frame.layers.push(...logo.layers)
  const badge = badgePill(frame, { x: badgeAlign === 'right' ? W - m : m, y }, badgeAlign, W * 0.42)
  if (badge) { if (onColor) badge.on = badge.bg; frame.layers.push(badge) }
  return Math.max(logo.box ? logo.box.y + logo.box.h : y, badge ? badge.y + badge.h : y)
}

function escenario(frame: Frame) {
  const { W, H, u, m, top, bottom, orient, colors } = frame
  if (orient === 'horizontal') {
    background(frame, colors.bg, colors.bg2, { x: W * 0.3, y: H * 0.5 })
    const stage = { x: m, y: top, w: W * 0.52 - m, h: H - top - bottom }
    decorate(frame, stage)
    productVisual(frame, stage, { floor: true, backdrop: null })
    const col = { x: W * 0.56, y: top, w: W * 0.44 - m, h: H - top - bottom }
    const head = header(frame, top, 'left', 'right')
    frame.layers.forEach((layer) => { if (layer.role === 'logo') layer.x += col.x - m })
    const info = infoStack(frame, { box: { ...col, y: head + u * 3, h: col.y + col.h - head - u * 3 }, align: 'left', valign: 'center', on: colors.bg, nameSize: u * (frame.wide ? 9 : 7), nameLines: 3, cta: true, description: !frame.wide })
    frame.layers.push(...info.layers)
    return
  }
  const headBottom = header(frame, top)
  const infoMax = { x: m, y: 0, w: W - m * 2, h: H * (orient === 'vertical' ? 0.34 : 0.33) }
  const probe = infoStack(frame, { box: { ...infoMax, y: H - bottom - infoMax.h }, align: 'center', valign: 'bottom', on: colors.bg, nameSize: u * 6.6, nameLines: 2, cta: true, description: orient === 'vertical' })
  const stage = { x: m, y: headBottom + u * 2.5, w: W - m * 2, h: probe.used.y - headBottom - u * 5 }
  background(frame, colors.bg, colors.bg2, { x: W / 2, y: stage.y + stage.h * 0.55 })
  // El fondo debe ir debajo de todo: se reordena al final de la composición (ver orderLayers).
  decorate(frame, stage)
  productVisual(frame, stage, { floor: true, backdrop: null })
  frame.layers.push(...probe.layers)
}

function dividido(frame: Frame) {
  const { W, H, u, m, top, bottom, orient, colors } = frame
  const panelColor = colors.panel
  const onPanel = bestOn(panelColor)
  if (orient === 'vertical') {
    // La unión se acomoda al alto real de la información (nombres largos bajan el panel del producto).
    const probe = infoStack(frame, { box: { x: m, y: 0, w: W - m * 2, h: H * 0.5 }, align: 'left', valign: 'top', on: colors.bg, nameSize: u * 6.4, nameLines: 3, cta: true, description: true })
    const seam = Math.round(Math.min(H * 0.64, Math.max(H * 0.42, H - bottom - probe.used.h - u * 8)))
    background(frame, colors.bg, colors.bg2)
    frame.layers.push({ ...base('fondo', { x: 0, y: 0, w: W, h: seam }), type: 'rect', color: panelColor, radius: 0 })
    texture(frame, { x: 0, y: 0, w: W, h: seam }, frame.style.texture === 'none' ? 'dots' : frame.style.texture, rgba(onPanel, 0.08))
    const headBottom = header(frame, top, 'left', 'right', panelColor)
    const stage = { x: m, y: headBottom + u * 2, w: W - m * 2, h: seam - headBottom - u * 4 }
    productVisual(frame, stage, { floor: true, backdrop: frame.style.decor.includes('circles') ? 'circle' : null, frameColor: rgba(onPanel, 0.1) })
    const info = infoStack(frame, { box: { x: m, y: seam + u * 4, w: W - m * 2, h: H - seam - u * 4 - bottom }, align: 'left', valign: 'center', on: colors.bg, nameSize: u * 6.4, nameLines: 3, cta: true, description: true })
    frame.layers.push(...info.layers)
    return
  }
  // Cuadrado y horizontal: panel a la izquierda con el producto, datos a la derecha.
  const split = Math.round(W * (orient === 'horizontal' ? 0.5 : 0.52))
  background(frame, colors.bg, colors.bg2)
  frame.layers.push({ ...base('fondo', { x: 0, y: 0, w: split, h: H }), type: 'rect', color: panelColor, radius: 0 })
  texture(frame, { x: 0, y: 0, w: split, h: H }, frame.style.texture === 'none' ? 'dots' : frame.style.texture, rgba(onPanel, 0.08))
  const logo = logoLayers(frame, { x: split + m * 0.8, y: top }, 'left', u * 22, u * 8.5)
  frame.layers.push(...logo.layers)
  const badge = badgePill(frame, { x: m, y: top }, 'left', split - m * 2)
  if (badge) frame.layers.push(badge)
  const stageTop = badge ? badge.y + badge.h + u * 2 : top
  const stage = { x: m * 0.7, y: stageTop, w: split - m * 1.4, h: H - stageTop - bottom }
  productVisual(frame, stage, { floor: true, backdrop: frame.style.decor.includes('circles') ? 'circle' : null, frameColor: rgba(onPanel, 0.1) })
  const infoTop = logo.box ? logo.box.y + logo.box.h + u * 3 : top
  const info = infoStack(frame, { box: { x: split + m * 0.8, y: infoTop, w: W - split - m * 1.8, h: H - infoTop - bottom }, align: 'left', valign: 'center', on: colors.bg, nameSize: u * (frame.wide ? 8 : 6.2), nameLines: 3, cta: true, description: orient === 'horizontal' && !frame.wide })
  frame.layers.push(...info.layers)
}

function diagonal(frame: Frame) {
  const { W, H, u, m, top, bottom, orient, colors, random } = frame
  background(frame)
  const band = colors.panel === colors.bg ? colors.bg2 : colors.panel
  const tilt = (0.16 + random() * 0.08) * (random() > 0.5 ? 1 : -1)
  if (orient === 'horizontal') {
    const x0 = W * 0.48
    frame.layers.push({ ...base('decoracion', { x: 0, y: 0, w: W, h: H }), type: 'shape', shape: 'poly', color: band, stroke: 0, rotation: 0, seed: 0, points: [x0 + H * 0.25, 0, W, 0, W, H, x0 - H * 0.12, H] })
    const stage = { x: W * 0.5, y: top, w: W * 0.5 - m, h: H - top - bottom }
    productVisual(frame, stage, { floor: true, backdrop: null })
    const head = header(frame, top, 'left', 'left')
    void head
    const badge = frame.layers.find((layer) => layer.role === 'etiqueta')
    if (badge) { badge.x = Math.round(W - m - badge.w) }
    const logoBottom = Math.max(top, ...frame.layers.filter((layer) => layer.role === 'logo').map((layer) => layer.y + layer.h))
    const info = infoStack(frame, { box: { x: m, y: logoBottom + u * 3, w: W * 0.44 - m, h: H - logoBottom - u * 3 - bottom }, align: 'left', valign: 'center', on: colors.bg, nameSize: u * (frame.wide ? 10 : 8.4), nameLines: 3, cta: true })
    frame.layers.push(...info.layers)
    return
  }
  // Vertical y cuadrado: nombre arriba, franja inclinada detrás del producto, precio y botón abajo.
  const headBottom = header(frame, top)
  const name = infoStack(frame, { box: { x: m, y: headBottom + u * 2.5, w: W - m * 2, h: H * (orient === 'vertical' ? 0.22 : 0.24) }, align: 'left', valign: 'top', on: colors.bg, nameSize: u * (orient === 'vertical' ? 8.4 : 7.6), nameLines: 2, cta: false, withPrice: false })
  frame.layers.push(...name.layers)
  const textBottom = name.used.y + name.used.h
  const cta = ctaPill(frame, { x: W / 2, y: 0, w: W / 2 - m }, 'right', false)
  const price = frame.product && frame.design.showPrice ? priceBlock(frame, frame.product, { x: m, y: 0, w: (W - m * 2) * 0.5 }, 'left', colors.bg) : { layers: [], height: 0 }
  const footH = Math.max(price.height, cta.h)
  const footY = H - bottom - footH
  for (const layer of price.layers) layer.y = Math.round(layer.y + footY + (footH - price.height) / 2)
  cta.y = Math.round(footY + (footH - cta.h) / 2)
  frame.layers.push(...price.layers, cta)
  const stage = { x: m, y: textBottom + u * 2, w: W - m * 2, h: footY - textBottom - u * 4 }
  const cy = stage.y + stage.h * 0.55
  const bh = stage.h * 0.46
  frame.layers.push({ ...base('decoracion', { x: 0, y: 0, w: W, h: H }), type: 'shape', shape: 'poly', color: band, stroke: 0, rotation: 0, seed: 0, points: [0, cy - bh / 2 + W * tilt, W, cy - bh / 2 - W * tilt, W, cy + bh / 2 - W * tilt, 0, cy + bh / 2 + W * tilt] })
  if (frame.style.decor.includes('stripes')) decorate(frame, stage)
  productVisual(frame, stage, { floor: false, backdrop: null })
}

function editorial(frame: Frame) {
  const { W, H, u, m, top, bottom, orient, colors, product, design, ctx } = frame
  background(frame)
  if (frame.style.decor.includes('frame')) decorate(frame, { x: 0, y: 0, w: 0, h: 0 })
  const brand = frame.spec.brand.name
  const kicker = (product?.category || brand || '').toLocaleUpperCase('es')
  const isCut = Boolean(product?.image && design.removeBg && ctx.cutouts.has(product.image))
  if (orient === 'horizontal') {
    const col = { x: m, y: top, w: W * 0.46 - m, h: H - top - bottom }
    const logo = logoLayers(frame, { x: m, y: top }, 'left', u * 20, u * 8)
    frame.layers.push(...logo.layers)
    const info = infoStack(frame, { box: { ...col, y: (logo.box ? logo.box.y + logo.box.h : top) + u * 3, h: col.h - (logo.box ? logo.box.h + u * 3 : 0) }, align: 'left', valign: 'bottom', on: colors.bg, nameSize: u * (frame.wide ? 11 : 9.5), nameLines: 3, cta: true })
    frame.layers.push(...info.layers)
    const stage = { x: W * 0.5, y: frame.wide ? top : m * 0.6, w: W * 0.5 - m * 0.6, h: H - (frame.wide ? top + bottom : m * 1.2) }
    productVisual(frame, stage, { floor: isCut, mask: isCut ? undefined : 'arch', frameRadius: 0, backdrop: isCut ? 'arch' : null })
    const badge = badgePill(frame, { x: W - m, y: top }, 'right', W * 0.3)
    if (badge) frame.layers.push(badge)
    return
  }
  // Rótulo superior: marca o categoría en mayúsculas espaciadas, con una línea fina.
  const kick = fitText(ctx.measure, kicker || ' ', { family: frame.style.eyebrow.family, weight: 600, letterSpacing: 0.3, maxWidth: W * 0.6, maxLines: 1, maxSize: u * 2.1, minSize: u * 1.5 })
  const logo = logoLayers(frame, { x: W - m, y: top }, 'right', u * 18, u * 7.5)
  frame.layers.push(...logo.layers)
  if (kicker) frame.layers.push(textLayer('categoria', kick, { x: m, y: top + u * 1.5, w: W * 0.6 }, colors.muted, colors.bg, { family: frame.style.eyebrow.family, letterSpacing: 0.3 }, 600, 'left', AT.categoria))
  const lineY = Math.max(top + u * 6, logo.box ? logo.box.y + logo.box.h + u * 1.5 : 0)
  frame.layers.push({ ...base('decoracion', { x: m, y: lineY, w: W - m * 2, h: Math.max(1.5, u * 0.16) }), type: 'rect', color: colors.line, radius: 0 })
  // Pie: precio a la izquierda y botón a la derecha, separados por una línea.
  const priceArea = { x: m, y: 0, w: W / 2 - m - u * 1.5 }
  const price = product && design.showPrice ? priceBlock(frame, product, priceArea, 'left', colors.bg) : { layers: [], height: 0 }
  const cta = ctaPill(frame, { x: W / 2 + u * 1.5, y: 0, w: W / 2 - m - u * 1.5 }, 'right', false)
  const ref = product?.reference && design.showReference ? fitText(ctx.measure, `REF. ${product.reference}`, { family: frame.style.eyebrow.family, weight: 600, letterSpacing: 0.08, maxWidth: W * 0.4, maxLines: 1, maxSize: u * 2, minSize: u * 1.5 }) : null
  const footH = Math.max(price.height, cta.h) + (ref ? ref.size * 1.4 + u : 0)
  const footY = H - bottom - footH
  let cursor = footY
  if (ref) { frame.layers.push(textLayer('referencia', ref, { x: m, y: cursor, w: W * 0.4 }, colors.muted, colors.bg, { family: frame.style.eyebrow.family, letterSpacing: 0.08 }, 600, 'left', AT.referencia)); cursor += ref.size * 1.4 + u }
  const minY = Math.min(...price.layers.map((layer) => layer.y), Infinity)
  for (const layer of price.layers) layer.y = Math.round(layer.y - minY + cursor)
  cta.y = Math.round(cursor + Math.max(0, (price.height - cta.h) / 2))
  frame.layers.push(...price.layers, cta)
  frame.layers.push({ ...base('decoracion', { x: m, y: footY - u * 2.4, w: W - m * 2, h: Math.max(1.5, u * 0.16) }), type: 'rect', color: colors.line, radius: 0 })
  // Titular grande: el nombre del producto. Nunca ocupa más del 45 % del espacio entre la línea y el pie.
  const display = displayStyle(frame)
  const title = fitText(ctx.measure, upper(frame, product?.name ?? brand), { family: frame.style.display.family, weight: frame.style.display.weight, italic: frame.style.display.italic, letterSpacing: frame.style.display.letterSpacing, maxWidth: W - m * 2, maxLines: 3, maxSize: u * (orient === 'vertical' ? 11 : 9), minSize: u * 3.6, maxHeight: (footY - u * 5 - (lineY + u * 3)) * 0.45, lineHeight: display.lineHeight })
  const titleLayer = textLayer('nombre', title, { x: m, y: lineY + u * 3, w: W - m * 2 }, colors.ink, colors.bg, display, frame.style.display.weight, 'left', AT.nombre)
  frame.layers.push(titleLayer)
  const stage = { x: m, y: titleLayer.y + titleLayer.h + u * 3, w: W - m * 2, h: footY - u * 5 - (titleLayer.y + titleLayer.h + u * 3) }
  if (isCut && product?.category) {
    // Profundidad: la categoría en grande detrás del producto, en un tono apenas visible.
    const giant = fitText(ctx.measure, product.category.toLocaleUpperCase('es'), { family: frame.style.display.family, weight: frame.style.display.weight, maxWidth: W - m, maxLines: 1, maxSize: stage.h * 0.4, minSize: u * 6 })
    frame.layers.push(textLayer('rotulo', giant, { x: m * 0.5, y: stage.y + (stage.h - giant.size) / 2, w: W - m }, mix(colors.bg, colors.ink, 0.07), colors.bg, { family: frame.style.display.family, lineHeight: 1 }, frame.style.display.weight, 'center', 0))
  }
  productVisual(frame, stage, { floor: isCut, mask: isCut ? undefined : orient === 'vertical' ? 'arch' : undefined, frameRadius: u * frame.style.radius })
  const badge = badgePill(frame, { x: W - m, y: stage.y + u }, 'right', W * 0.4)
  if (badge) frame.layers.push(badge)
}

function tarjeta(frame: Frame) {
  const { W, H, u, m, top, bottom, orient, colors, style } = frame
  background(frame, colors.bg2, colors.bg)
  texture(frame, { x: 0, y: 0, w: W, h: H }, style.texture === 'none' ? 'dots' : style.texture)
  const radius = u * Math.max(1.5, style.radius * 1.4)
  if (orient === 'horizontal') {
    const card = { x: m, y: top, w: W * 0.46, h: H - top - bottom }
    frame.layers.push({ ...base('decoracion', card), type: 'rect', color: colors.surface, radius })
    productVisual(frame, inset(card, u * 3), { floor: true, shadow: true })
    const badge = badgePill(frame, { x: card.x + u * 2, y: card.y + u * 2 }, 'left', card.w * 0.6)
    if (badge) frame.layers.push(badge)
    const col = { x: card.x + card.w + m * 0.8, y: top, w: W - card.x - card.w - m * 1.8, h: H - top - bottom }
    const logo = logoLayers(frame, { x: col.x, y: top }, 'left', u * 20, u * 8)
    frame.layers.push(...logo.layers)
    const infoTop = logo.box ? logo.box.y + logo.box.h + u * 3 : top
    const info = infoStack(frame, { box: { ...col, y: infoTop, h: col.y + col.h - infoTop }, align: 'left', valign: 'center', on: colors.bg2, nameSize: u * (frame.wide ? 8 : 6.4), nameLines: 3, cta: true })
    frame.layers.push(...info.layers)
    return
  }
  const headBottom = header(frame, top, 'center', 'right')
  const cta = ctaPill(frame, { x: m, y: 0, w: W - m * 2 }, 'center', orient === 'vertical')
  cta.y = Math.round(H - bottom - cta.h)
  const card = { x: m, y: headBottom + u * 3, w: W - m * 2, h: cta.y - u * 3 - (headBottom + u * 3) }
  frame.layers.push({ ...base('decoracion', card), type: 'rect', color: colors.surface, radius })
  const pad = u * 3.5
  const probe = infoStack(frame, { box: { x: card.x + pad, y: 0, w: card.w - pad * 2, h: card.h * 0.42 }, align: 'center', valign: 'bottom', on: colors.surface, nameSize: u * 5.6, nameLines: 2, cta: false, description: orient === 'vertical' })
  const shift = card.y + card.h - pad - (probe.used.y + probe.used.h)
  for (const layer of probe.layers) layer.y = Math.round(layer.y + shift)
  const infoTop = probe.used.y + shift
  const stage = { x: card.x + pad, y: card.y + pad, w: card.w - pad * 2, h: infoTop - card.y - pad * 2 }
  productVisual(frame, stage, { floor: true, frameRadius: radius * 0.7, shadow: false })
  frame.layers.push(...probe.layers, cta)
}

const LAYOUT_BUILDERS: Record<LayoutKey, (frame: Frame) => void> = { escenario, dividido, diagonal, editorial, tarjeta }

/** Fondo y decoraciones debajo; contenido encima. Se conserva el orden relativo dentro de cada grupo. */
function orderLayers(layers: Layer[]): Layer[] {
  const rank = (layer: Layer) => (layer.role === 'fondo' ? 0 : layer.role === 'decoracion' || layer.role === 'rotulo' ? 1 : 2)
  return layers.map((layer, index) => ({ layer, index })).sort((a, b) => rank(a.layer) - rank(b.layer) || a.index - b.index).map((item) => item.layer)
}

/** Varios productos en una pieza: titular, cuadrícula de tarjetas y botón, con la estética del estilo. */
function grid(frame: Frame) {
  const { W, H, u, m, top, bottom, spec, colors, style, ctx, orient } = frame
  background(frame)
  const logo = logoLayers(frame, { x: W - m, y: top }, 'right', u * 18, u * 8)
  frame.layers.push(...logo.layers)
  const title = fitText(ctx.measure, upper(frame, spec.copy.headline), { family: style.display.family, weight: style.display.weight, italic: style.display.italic, maxWidth: W - m * 2 - (logo.box ? logo.box.w + u * 3 : 0), maxLines: 2, maxSize: u * 6.5, minSize: u * 3.2 })
  const titleLayer = textLayer('titular', title, { x: m, y: top, w: W - m * 2 - (logo.box ? logo.box.w + u * 3 : 0) }, colors.ink, colors.bg, displayStyle(frame), style.display.weight, 'left', 0.5)
  frame.layers.push(titleLayer)
  const cta = ctaPill(frame, { x: m, y: 0, w: W - m * 2 }, 'center', false)
  cta.y = Math.round(H - bottom - cta.h)
  let footTop = cta.y
  if (spec.storeUrl) {
    const url = fitText(ctx.measure, spec.storeUrl.replace(/^https?:\/\//, ''), { family: style.body.family, weight: 600, maxWidth: W - m * 2, maxLines: 1, maxSize: u * 2.6, minSize: u * 1.6 })
    footTop = cta.y - url.size * 1.3 - u * 1.5
    frame.layers.push(textLayer('url', url, { x: m, y: footTop, w: W - m * 2 }, colors.muted, colors.bg, { family: style.body.family }, 600, 'center', AT.cta))
  }
  frame.layers.push(cta)
  const areaTop = Math.max(titleLayer.y + titleLayer.h, logo.box ? logo.box.y + logo.box.h : 0) + u * 3
  const area = { x: m, y: areaTop, w: W - m * 2, h: footTop - u * 3 - areaTop }
  const n = spec.products.length
  const columns = orient === 'horizontal' ? Math.min(n, frame.wide ? 6 : 3) : n <= 2 && H / W > 1.5 ? 1 : 2
  const rows = Math.ceil(n / columns)
  const gap = u * 2.2
  const cw = (area.w - gap * (columns - 1)) / columns
  const ch = (area.h - gap * (rows - 1)) / rows
  spec.products.forEach((product, index) => {
    const cell = { x: area.x + (index % columns) * (cw + gap), y: area.y + Math.floor(index / columns) * (ch + gap), w: cw, h: ch }
    frame.layers.push({ ...base('decoracion', cell), type: 'rect', color: colors.surface, radius: u * Math.max(1, style.radius) })
    const sub: Frame = { ...frame, product, u: frame.u * 0.62 }
    const info = infoStack(sub, { box: { x: cell.x + u * 1.6, y: cell.y, w: cell.w - u * 3.2, h: ch * 0.4 }, align: 'left', valign: 'bottom', on: colors.surface, nameSize: u * 3.2, nameLines: 2, eyebrow: false, cta: false })
    const shift = cell.y + cell.h - u * 1.6 - (info.used.y + info.used.h)
    for (const layer of info.layers) layer.y = Math.round(layer.y + shift)
    const stage = { x: cell.x + u * 1.2, y: cell.y + u * 1.2, w: cell.w - u * 2.4, h: info.used.y + shift - cell.y - u * 2.4 }
    productVisual(sub, stage, { floor: true, shadow: false, frameRadius: u * 0.8 })
    frame.layers.push(...info.layers)
  })
}

/** Normaliza las opciones de diseño (valores desconocidos caen en los del estilo). */
export function normalizeDesign(design: Partial<DesignOptions> | null | undefined): DesignOptions {
  const styleKey = isStyle(design?.style) ? design.style : 'ecommerce_profesional'
  const style = styleOf(styleKey)
  return {
    style: styleKey,
    layout: isLayout(design?.layout) ? design.layout : style.layouts[0]!,
    seed: Number.isSafeInteger(design?.seed) ? Math.abs(design!.seed!) % 100000 : 1,
    colors: Array.isArray(design?.colors) ? design.colors.filter(isHex).slice(0, 2) : null,
    showPrice: design?.showPrice !== false,
    removeBg: design?.removeBg !== false,
    showReference: design?.showReference === true,
  }
}

/** Composición publicitaria de una pieza (o de una diapositiva del carrusel / segmento del video). */
export function composeDesign(spec: PlanSpec, slide: number, ctx: DesignContext): Scene {
  const design = normalizeDesign(spec.design)
  const style = styleOf(design.style)
  const { width: W, height: H } = spec
  const u = Math.min(W, H) / 100
  const ratio = W / H
  const orient = ratio > 1.15 ? 'horizontal' : ratio < 0.87 ? 'vertical' : 'cuadrado'
  const single = spec.kind === 'carrusel' || (spec.kind === 'video' && spec.products.length > 1) ? spec.products[slide] ?? null : spec.products.length === 1 ? spec.products[0]! : null
  const photoInfo = single?.image ? ctx.photos.get(single.image) : undefined
  const colors = style.palette({ brand: spec.brand.colors, photo: photoInfo?.dominant ?? [], override: design.colors?.length ? design.colors : null })
  const m = Math.round(u * (orient === 'horizontal' ? 6.5 : 6))
  // Historias y estados: la interfaz de la red tapa arriba y abajo; el contenido importante queda dentro.
  const story = H / W > 1.6
  const frame: Frame = {
    spec, product: single, design, style, colors, W, H, u, m,
    top: story ? Math.round(H * 0.085) : m, bottom: story ? Math.round(H * 0.11) : m,
    orient, wide: ratio > 2.2, random: seededRandom(design.seed * 7919 + slide * 104729 + design.layout.length), ctx, layers: [],
  }
  if (single) LAYOUT_BUILDERS[design.layout as LayoutKey](frame)
  else grid(frame)
  if (spec.kind === 'carrusel' && spec.slides > 1) {
    const counter = `${slide + 1}/${spec.slides}`
    const fitted = fitText(ctx.measure, counter, { family: style.body.family, weight: 700, maxWidth: u * 12, maxLines: 1, maxSize: u * 2.2, minSize: u * 1.6 })
    const w = fitted.width + fitted.size * 1.8, h = fitted.size * 2.1
    frame.layers.push({ ...base('contador', { x: W - frame.m - w, y: H - frame.bottom + (frame.bottom - h) / 2, w, h }), type: 'pill', text: counter, size: fitted.size, bg: 'rgba(17,24,39,0.72)', color: WHITE, align: 'center', font: { family: style.body.family }, weight: 700, on: '#111827' })
  }
  return { width: W, height: H, font: style.body.family, layers: orderLayers(frame.layers) }
}

/** Las cinco composiciones de un estilo, en su orden recomendado (variante 1 a 5). */
export const styleLayouts = (style: string): LayoutKey[] => { const list = styleOf(style).layouts; return [...list, ...LAYOUT_KEYS.filter((key) => !list.includes(key))].slice(0, 5) }

export { hsl, hslToHex }
