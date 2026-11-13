/** Motor de video publicitario (sin IA): diez plantillas con intro, escena principal animada y cierre.
 *
 * Cada cuadro se calcula con una función pura del tiempo: la misma pieza y el mismo segundo dan siempre la
 * misma imagen. Las capas son las de la composición del motor de diseño (con sus datos exactos), animadas por
 * rol: el nombre, el precio, la etiqueta y el botón entran, se mueven y se destacan según la plantilla; la
 * foto recibe movimiento de cámara. Nada se inventa: el video muestra lo mismo que la imagen verificada. */
import type { Layer, PlanSpec } from '../scene'
import { WHITE, bestOn, rgba } from './color'
import { AT, background, base, ctaPill, fitText, logoLayers, makeFrame, orderLayers, textLayer, upper, type DesignContext } from './compose'

export type Entrance = 'fundido' | 'subir' | 'izquierda' | 'derecha' | 'rebote' | 'golpe' | 'barrido' | 'giro'
export type Camera = 'acercar' | 'alejar' | 'paneo' | 'empuje' | 'giro' | 'flotar'
export type Transition = 'corte' | 'fundido' | 'barrido' | 'deslizar' | 'zoom'
export type Mood = 'energico' | 'suave' | 'elegante' | 'tecno' | 'alegre'

export interface VideoTemplateDef {
  label: string
  description: string
  intro: { seconds: number; kind: 'logo' | 'destello' | 'negro' | 'blanco' | 'reticula' }
  outro: { seconds: number; kind: 'boton' | 'logo' | 'pulso' }
  transition: Transition
  camera: Camera
  /** Entrada de nombre, precio, botón, etiqueta y datos secundarios. */
  enter: { nombre: Entrance; precio: Entrance; cta: Entrance; etiqueta: Entrance; datos: Entrance }
  /** Ritmo de las apariciones (1 = estándar; menor = más rápido). */
  pace: number
  priceFx: 'ninguno' | 'pulso' | 'tachado'
  music: { mood: Mood; bpm: number }
}

export const VIDEO_TEMPLATES = {
  producto_premium: {
    label: 'Producto premium', description: 'Sale de la oscuridad con un foco de luz, cámara que se aleja y textos que se revelan con calma.',
    intro: { seconds: 1.2, kind: 'negro' }, outro: { seconds: 2, kind: 'logo' }, transition: 'fundido', camera: 'alejar',
    enter: { nombre: 'barrido', precio: 'fundido', cta: 'fundido', etiqueta: 'fundido', datos: 'fundido' }, pace: 1.3, priceFx: 'ninguno', music: { mood: 'elegante', bpm: 76 },
  },
  oferta_relampago: {
    label: 'Oferta relámpago', description: 'Destello inicial, producto que empuja hacia la cámara, sello girando y precio que late.',
    intro: { seconds: 0.6, kind: 'destello' }, outro: { seconds: 1.6, kind: 'pulso' }, transition: 'zoom', camera: 'empuje',
    enter: { nombre: 'golpe', precio: 'rebote', cta: 'rebote', etiqueta: 'giro', datos: 'izquierda' }, pace: 0.6, priceFx: 'pulso', music: { mood: 'energico', bpm: 140 },
  },
  presentacion_elegante: {
    label: 'Presentación elegante', description: 'Fundido desde blanco, acercamiento lento y textos que aparecen suavemente.',
    intro: { seconds: 1, kind: 'blanco' }, outro: { seconds: 2, kind: 'logo' }, transition: 'fundido', camera: 'acercar',
    enter: { nombre: 'fundido', precio: 'fundido', cta: 'fundido', etiqueta: 'fundido', datos: 'subir' }, pace: 1.4, priceFx: 'ninguno', music: { mood: 'elegante', bpm: 70 },
  },
  promocion_dinamica: {
    label: 'Promoción dinámica', description: 'Paneo de cámara, textos que entran por los lados y barridos entre escenas.',
    intro: { seconds: 0.8, kind: 'logo' }, outro: { seconds: 1.8, kind: 'boton' }, transition: 'barrido', camera: 'paneo',
    enter: { nombre: 'izquierda', precio: 'derecha', cta: 'subir', etiqueta: 'rebote', datos: 'izquierda' }, pace: 0.85, priceFx: 'pulso', music: { mood: 'alegre', bpm: 116 },
  },
  producto_tecnologico: {
    label: 'Producto tecnológico', description: 'Retícula de inicio, producto que gira a su posición y textos que se escanean.',
    intro: { seconds: 0.9, kind: 'reticula' }, outro: { seconds: 1.8, kind: 'boton' }, transition: 'deslizar', camera: 'giro',
    enter: { nombre: 'barrido', precio: 'barrido', cta: 'fundido', etiqueta: 'barrido', datos: 'barrido' }, pace: 0.9, priceFx: 'ninguno', music: { mood: 'tecno', bpm: 122 },
  },
  moda_accesorios: {
    label: 'Moda y accesorios', description: 'Ritmo de pasarela: la foto respira, los textos suben despacio y todo se funde.',
    intro: { seconds: 0.9, kind: 'logo' }, outro: { seconds: 2, kind: 'logo' }, transition: 'fundido', camera: 'alejar',
    enter: { nombre: 'subir', precio: 'fundido', cta: 'fundido', etiqueta: 'fundido', datos: 'subir' }, pace: 1.25, priceFx: 'ninguno', music: { mood: 'suave', bpm: 88 },
  },
  belleza_bienestar: {
    label: 'Belleza y bienestar', description: 'El producto flota con suavidad, brillos y textos que aparecen con calma.',
    intro: { seconds: 0.9, kind: 'blanco' }, outro: { seconds: 2, kind: 'boton' }, transition: 'fundido', camera: 'flotar',
    enter: { nombre: 'subir', precio: 'rebote', cta: 'fundido', etiqueta: 'rebote', datos: 'subir' }, pace: 1.15, priceFx: 'ninguno', music: { mood: 'suave', bpm: 78 },
  },
  producto_destacado: {
    label: 'Producto destacado', description: 'Logo de entrada, acercamiento, textos escalonados y precio que late al final.',
    intro: { seconds: 0.8, kind: 'logo' }, outro: { seconds: 1.8, kind: 'boton' }, transition: 'zoom', camera: 'acercar',
    enter: { nombre: 'subir', precio: 'rebote', cta: 'subir', etiqueta: 'rebote', datos: 'subir' }, pace: 1, priceFx: 'pulso', music: { mood: 'alegre', bpm: 104 },
  },
  descuento_especial: {
    label: 'Descuento especial', description: 'Primero el precio anterior, luego se tacha y aparece el precio actual (solo con descuento real).',
    intro: { seconds: 0.7, kind: 'destello' }, outro: { seconds: 1.8, kind: 'pulso' }, transition: 'zoom', camera: 'empuje',
    enter: { nombre: 'izquierda', precio: 'rebote', cta: 'rebote', etiqueta: 'giro', datos: 'fundido' }, pace: 0.8, priceFx: 'tachado', music: { mood: 'energico', bpm: 126 },
  },
  catalogo_animado: {
    label: 'Catálogo animado', description: 'Recorre varias fotos o varios productos con deslizamientos, cada uno con su nombre y precio.',
    intro: { seconds: 0.8, kind: 'logo' }, outro: { seconds: 1.8, kind: 'boton' }, transition: 'deslizar', camera: 'acercar',
    enter: { nombre: 'subir', precio: 'fundido', cta: 'fundido', etiqueta: 'rebote', datos: 'subir' }, pace: 0.7, priceFx: 'ninguno', music: { mood: 'alegre', bpm: 100 },
  },
} as const satisfies Record<string, VideoTemplateDef>

export type VideoTemplateKey = keyof typeof VIDEO_TEMPLATES
export const VIDEO_TEMPLATE_KEYS = Object.keys(VIDEO_TEMPLATES) as VideoTemplateKey[]
export const isVideoTemplate = (value: unknown): value is VideoTemplateKey => typeof value === 'string' && Object.hasOwn(VIDEO_TEMPLATES, value)
export const VIDEO_SECONDS = [8, 10, 12, 15] as const
export const MIN_VIDEO_SECONDS = 6
export const MAX_VIDEO_SECONDS = 20

/** Plantilla de video sugerida para cada sector (el comercio puede elegir cualquiera). */
export const SECTOR_VIDEO: Record<string, VideoTemplateKey> = { calzado: 'oferta_relampago', moda: 'moda_accesorios', streetwear: 'promocion_dinamica', hogar: 'presentacion_elegante', belleza: 'belleza_bienestar' }

/** Una pasada de dibujo: capas con transformación global (transiciones entre escenas). */
export interface Pass { layers: Layer[]; alpha?: number; dx?: number; zoom?: number; clip?: number }

const clamp = (value: number) => Math.min(1, Math.max(0, value))
const easeOut = (t: number) => 1 - (1 - clamp(t)) ** 3
const easeInOut = (t: number) => { const x = clamp(t); return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2 }
const backOut = (t: number) => { const x = clamp(t); const c = 1.9; return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2 }

export function templateOf(spec: PlanSpec): VideoTemplateDef {
  const key = spec.design?.video
  // Sin plantilla elegida, la sugerida para el sector (la misma que marca el panel).
  const fallback = SECTOR_VIDEO[spec.design?.sector ?? ''] ?? 'producto_destacado'
  return isVideoTemplate(key) ? VIDEO_TEMPLATES[key] : VIDEO_TEMPLATES[fallback]
}

/** Reparto del tiempo: intro, escenas (una por producto o por foto) y cierre. */
export function timeline(spec: PlanSpec): { intro: number; outro: number; segments: number; segment: number; total: number } {
  const total = spec.seconds || 10
  const tpl = templateOf(spec)
  const intro = Math.min(tpl.intro.seconds, total * 0.15)
  const outro = Math.min(tpl.outro.seconds, total * 0.22)
  const main = Math.max(1, total - intro - outro)
  const isCatalog = spec.design?.video === 'catalogo_animado'
  const gallery = spec.products.length === 1 ? (spec.products[0]!.gallery ?? []).length : 0
  // Cada foto del catálogo necesita al menos 2 s en pantalla para que se lean su nombre y su precio.
  const segments = spec.products.length > 1 ? spec.products.length : isCatalog ? Math.max(1, Math.min(3, gallery, Math.floor(main / 2))) : 1
  return { intro, outro, segments, segment: main / segments, total }
}

const ENTRY_START: Partial<Record<Layer['role'], number>> = {
  logo: 0.05, etiqueta: 0.45, categoria: 0.25, marca: 0.2, nombre: 0.35, referencia: 0.6, dato: 0.6, descripcion: 0.85, beneficio: 0.85, precio_anterior: 0.8, precio: 1.0, cta: 1.35,
}

function entranceOf(tpl: VideoTemplateDef, role: Layer['role']): Entrance {
  if (role === 'nombre' || role === 'titular') return tpl.enter.nombre
  if (role === 'precio' || role === 'precio_anterior') return tpl.enter.precio
  if (role === 'cta') return tpl.enter.cta
  if (role === 'etiqueta') return tpl.enter.etiqueta
  return tpl.enter.datos
}

function applyEntrance(layer: Layer, effect: Entrance, p: number, W: number, H: number) {
  const e = easeOut(p)
  if (effect === 'fundido') layer.opacity *= e
  else if (effect === 'subir') { layer.opacity *= e; layer.offsetY += (1 - e) * H * 0.04 }
  else if (effect === 'izquierda') { layer.opacity *= Math.min(1, p * 2.5); layer.offsetX = (layer.offsetX ?? 0) - (1 - e) * W * 0.35 }
  else if (effect === 'derecha') { layer.opacity *= Math.min(1, p * 2.5); layer.offsetX = (layer.offsetX ?? 0) + (1 - e) * W * 0.35 }
  else if (effect === 'rebote') { layer.opacity *= Math.min(1, p * 3); layer.scale = (layer.scale ?? 1) * (0.55 + 0.45 * backOut(p)) }
  else if (effect === 'golpe') { layer.opacity *= Math.min(1, p * 2); layer.scale = (layer.scale ?? 1) * (1 + (1 - easeOut(p)) * 0.8) }
  else if (effect === 'barrido') { layer.wipe = e; layer.opacity *= Math.min(1, p * 4) }
  else if (effect === 'giro') { layer.opacity *= Math.min(1, p * 2.5); layer.turn = (layer.turn ?? 0) - (1 - e) * 200; layer.scale = (layer.scale ?? 1) * (0.4 + 0.6 * backOut(p)) }
}

/** Anima las capas de una escena en su segundo local `t` (de 0 a `length`). */
function animateScene(layers: Layer[], spec: PlanSpec, tpl: VideoTemplateDef, t: number, length: number): Layer[] {
  const { width: W, height: H } = spec
  const pace = Math.min(tpl.pace, length / 3.2)
  return layers.map((source) => {
    const layer = { ...source } as Layer
    if (layer.role === 'fondo') return layer
    if (layer.role === 'decoracion' || layer.role === 'rotulo') {
      // Paralaje: el fondo gráfico se desplaza despacio en sentido contrario a la cámara.
      layer.offsetX = (layer.offsetX ?? 0) - (t / length - 0.5) * W * (layer.role === 'rotulo' ? 0.06 : 0.015)
      layer.opacity *= easeOut(t / 0.5)
      return layer
    }
    if (layer.role === 'foto') {
      const k = clamp(t / length)
      // Intensidad según la foto: el producto recortado puede crecer; una foto en marco se mueve dentro de su
      // marco (acercamiento interno); una foto completa apenas cambia de tamaño para no tapar los textos.
      const cut = layer.type === 'image' && layer.src.startsWith('cut:')
      const framed = layer.type === 'image' && layer.fit === 'cover'
      const amount = cut ? 1 : 0.3
      const grow = (value: number) => {
        if (framed && layer.type === 'image') layer.zoom = 1 + (value - 1) * 1.4
        else layer.scale = 1 + (value - 1) * amount
      }
      if (tpl.camera === 'acercar') grow(1 + 0.08 * easeInOut(k))
      else if (tpl.camera === 'alejar') grow(1.1 - 0.1 * easeInOut(k))
      else if (tpl.camera === 'paneo') { grow(1.04); layer.offsetX = (layer.offsetX ?? 0) + (easeInOut(k) - 0.5) * W * (cut ? 0.05 : 0.02) }
      else if (tpl.camera === 'empuje') grow(0.86 + 0.14 * backOut(t / 0.7) + 0.03 * k)
      else if (tpl.camera === 'giro') { layer.turn = (layer.turn ?? 0) - (1 - easeOut(t / 0.9)) * (cut ? 14 : 5); grow(0.92 + 0.08 * easeOut(t / 0.9) + 0.02 * k) }
      else if (tpl.camera === 'flotar') layer.offsetY += Math.sin(t * 1.7) * H * (cut ? 0.008 : 0.004)
      layer.opacity *= easeOut(t / 0.35)
      return layer
    }
    const start = (ENTRY_START[layer.role] ?? 0.6) * pace
    const duration = 0.5 * Math.max(0.6, pace)
    const p = clamp((t - start) / duration)
    if (p <= 0) { layer.opacity = 0; return layer }
    applyEntrance(layer, entranceOf(tpl, layer.role), p, W, H)
    if (layer.role === 'precio' && tpl.priceFx === 'pulso' && p >= 1) layer.scale = (layer.scale ?? 1) * (1 + 0.045 * Math.max(0, Math.sin((t - start - duration) * 5)))
    if (layer.role === 'cta' && t > length * 0.7) layer.scale = (layer.scale ?? 1) * (1 + 0.03 * Math.max(0, Math.sin(t * 6)))
    return layer
  })
}

/** «Descuento especial»: el precio anterior aparece primero sin tachar, luego se tacha y entra el precio actual. */
function discountSequence(layers: Layer[], t: number, pace: number): Layer[] {
  const strikeAt = 1.35 * pace
  const priceAt = 1.75 * pace
  return layers.map((layer) => {
    if (layer.role === 'precio_anterior' && layer.type === 'text') return { ...layer, strike: t >= strikeAt, scale: t < strikeAt ? 1.25 : 1 }
    if (layer.role === 'precio') return t < priceAt ? { ...layer, opacity: 0 } : layer
    return layer
  })
}

// ---- intro y cierre ----------------------------------------------------------------------------------

function introLayers(spec: PlanSpec, ctx: DesignContext, tpl: VideoTemplateDef, p: number): Layer[] {
  const frame = makeFrame(spec, 0, ctx)
  const { W, H, u, colors, style } = frame
  if (tpl.intro.kind === 'negro') frame.layers.push({ ...base('fondo', { x: 0, y: 0, w: W, h: H }), type: 'rect', color: '#050505', radius: 0 })
  else if (tpl.intro.kind === 'blanco') frame.layers.push({ ...base('fondo', { x: 0, y: 0, w: W, h: H }), type: 'rect', color: '#FFFFFF', radius: 0 })
  else background(frame)
  if (tpl.intro.kind === 'reticula') frame.layers.push({ ...base('decoracion', { x: 0, y: 0, w: W, h: H }), type: 'shape', shape: 'grid', color: rgba(colors.highlight.startsWith('#') ? colors.highlight : '#22D3EE', 0.35 * easeOut(p * 2)), stroke: 1.5, rotation: 0, seed: 0, size: u * 8 })
  const onColor = tpl.intro.kind === 'negro' ? '#050505' : tpl.intro.kind === 'blanco' ? '#FFFFFF' : colors.bg
  const logo = logoLayers(frame, { x: W / 2, y: H / 2 - u * 10 }, 'center', W * 0.5, u * 20, onColor)
  if (logo.box) for (const layer of logo.layers) layer.y = Math.round(layer.y + (u * 10 - logo.box.h / 2))
  const brand = spec.brand.name
  if (!logo.box && brand) {
    const fitted = fitText(ctx.measure, upper(frame, brand), { family: style.display.family, weight: style.display.weight, maxWidth: W * 0.8, maxLines: 2, maxSize: u * 9, minSize: u * 4 })
    frame.layers.push(textLayer('marca', fitted, { x: W * 0.1, y: H / 2 - fitted.size, w: W * 0.8 }, bestOn(onColor), onColor, { family: style.display.family }, style.display.weight, 'center', 0))
  }
  frame.layers.push(...logo.layers)
  const e = easeOut(p * 1.6)
  const layers = orderLayers(frame.layers).map((layer) => (layer.role === 'logo' || layer.role === 'marca' ? { ...layer, opacity: e, scale: 0.82 + 0.18 * e } : layer))
  if (tpl.intro.kind === 'destello') layers.push({ ...base('decoracion', { x: 0, y: 0, w: W, h: H }), type: 'rect', color: WHITE, radius: 0, opacity: Math.max(0, 1 - p * 3) })
  return layers
}

function outroLayers(spec: PlanSpec, ctx: DesignContext, tpl: VideoTemplateDef, t: number): Layer[] {
  const frame = makeFrame(spec, 0, ctx)
  const { W, H, u, m, colors, style, product } = frame
  background(frame)
  const logo = logoLayers(frame, { x: W / 2, y: H * 0.26 }, 'center', W * 0.42, u * 16)
  frame.layers.push(...logo.layers)
  let y = logo.box ? logo.box.y + logo.box.h + u * 5 : H * 0.34
  if (spec.products.length === 1 && product) {
    const fitted = fitText(ctx.measure, upper(frame, product.name), { family: style.display.family, weight: style.display.weight, italic: style.display.italic, maxWidth: W - m * 2, maxLines: 2, maxSize: u * 6, minSize: u * 3 })
    const name = textLayer('nombre', fitted, { x: m, y, w: W - m * 2 }, colors.ink, colors.bg, { family: style.display.family, italic: style.display.italic, lineHeight: 1.1 }, style.display.weight, 'center', AT.nombre)
    frame.layers.push(name)
    y = name.y + name.h + u * 2
    if (frame.design.showPrice) {
      const price = fitText(ctx.measure, product.priceText, { family: style.price.family, weight: style.price.weight, maxWidth: W - m * 2, maxLines: 1, maxSize: u * 7, minSize: u * 3 })
      const layer = textLayer('precio', price, { x: m, y, w: W - m * 2 }, colors.price, colors.bg, { family: style.price.family, lineHeight: 1.1 }, style.price.weight, 'center', AT.precio, { shrink: true })
      frame.layers.push(layer)
      y = layer.y + layer.h + u * 4
    }
  }
  const cta = ctaPill({ ...frame, emphasis: { ...frame.emphasis, cta: 'fuerte' } }, { x: m, y, w: W - m * 2 }, 'center', false)
  frame.layers.push(cta)
  const e = easeOut(t / 0.6)
  return orderLayers(frame.layers).map((layer) => {
    if (layer.role === 'fondo' || layer.role === 'decoracion') return layer
    const next = { ...layer, opacity: layer.opacity * e, offsetY: layer.offsetY + (1 - e) * H * 0.03 }
    if (layer.role === 'cta' && tpl.outro.kind === 'pulso') next.scale = 1 + 0.06 * Math.max(0, Math.sin(t * 7))
    if (layer.role === 'cta' && tpl.outro.kind === 'boton') next.scale = 0.7 + 0.3 * backOut(t / 0.6)
    return next as Layer
  })
}

// ---- cuadro completo -----------------------------------------------------------------------------

/** Escena de una parte del video: el producto `slide`, o en «Catálogo animado» con un solo producto, su foto `slide`. */
function sceneSpec(spec: PlanSpec, slide: number): { spec: PlanSpec; slide: number } {
  if (spec.design?.video === 'catalogo_animado' && spec.products.length === 1) {
    const product = spec.products[0]!
    const gallery = product.gallery ?? []
    const image = gallery[slide] ?? product.image
    return { spec: { ...spec, products: [{ ...product, image }] }, slide: 0 }
  }
  return { spec, slide }
}

function transitionPasses(kind: Transition, from: Layer[], to: Layer[], p: number, W: number): Pass[] {
  const e = easeInOut(p)
  if (kind === 'corte') return [{ layers: p < 0.5 ? from : to }]
  if (kind === 'fundido') return [{ layers: from }, { layers: to, alpha: e }]
  if (kind === 'barrido') return [{ layers: from }, { layers: to, clip: e }]
  if (kind === 'deslizar') return [{ layers: from, dx: -e * W }, { layers: to, dx: (1 - e) * W }]
  // Zoom: la escena saliente se acerca y la entrante aterriza desde un poco más grande. Ambas cubren todo el
  // cuadro (la saliente siempre opaca), así nunca se ve el fondo vacío del lienzo.
  return [{ layers: from, zoom: 1 + e * 0.18 }, { layers: to, zoom: 1.14 - 0.14 * e, alpha: e }]
}

/** Lo que se dibuja en el segundo `t`. `build` compone una escena estática (el motor de diseño). */
export function videoPasses(spec: PlanSpec, t: number, ctx: DesignContext, build: (spec: PlanSpec, slide: number) => Layer[]): Pass[] {
  const tpl = templateOf(spec)
  const line = timeline(spec)
  const TR = 0.4
  const sceneAt = (index: number, local: number) => {
    const target = sceneSpec(spec, index)
    let layers = animateScene(build(target.spec, target.slide), spec, tpl, local, line.segment)
    if (tpl.priceFx === 'tachado' && target.spec.products[target.slide]?.compareAtText) layers = discountSequence(layers, local, Math.min(tpl.pace, line.segment / 3.2))
    return layers
  }
  if (t < line.intro) {
    const intro = introLayers(spec, ctx, tpl, t / line.intro)
    const left = line.intro - t
    if (left < TR) return transitionPasses(tpl.transition, intro, sceneAt(0, 0), 1 - left / TR, spec.width)
    return [{ layers: intro }]
  }
  const mainEnd = line.intro + line.segment * line.segments
  if (t < mainEnd) {
    const local = t - line.intro
    const index = Math.min(line.segments - 1, Math.floor(local / line.segment))
    const inner = local - index * line.segment
    if (index > 0 && inner < TR) return transitionPasses(tpl.transition, sceneAt(index - 1, line.segment), sceneAt(index, inner), inner / TR, spec.width)
    return [{ layers: sceneAt(index, inner) }]
  }
  const local = t - mainEnd
  const outro = outroLayers(spec, ctx, tpl, local)
  if (local < TR) return transitionPasses(tpl.transition === 'corte' ? 'fundido' : tpl.transition, sceneAt(line.segments - 1, line.segment), outro, local / TR, spec.width)
  return [{ layers: outro }]
}

/** Capas del cierre (para el control de calidad: la pieza termina con logo y botón). */
export const outroScene = (spec: PlanSpec, ctx: DesignContext) => outroLayers(spec, ctx, templateOf(spec), 1)
