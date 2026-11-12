/** Composición determinista de piezas comerciales (modo convencional, sin IA).
 *
 * Funciones puras: del plan que entrega el servidor (datos verificados) a una lista de capas con posición,
 * tamaño y momento de aparición. El nombre, el precio, la etiqueta y el logo son capas gráficas: se dibujan
 * con el texto exacto del plan y nunca los genera un modelo. render.ts solo pinta lo que sale de aquí. */

export interface PlanProduct {
  id: number; name: string; priceText: string; compareAtText: string | null; image: string | null
  beforeAfter: { beforeAssetId: string; afterAssetId: string; afterUrl: string | null } | null
  /** Motor de diseño (spec versión 2): referencia (SKU), categoría, descuento y hasta 3 fotos reales. */
  reference?: string | null; category?: string | null; discountPercent?: number | null; gallery?: string[]
}
/** Opciones del motor de diseño publicitario. Sin `design`, la pieza usa la composición clásica de la fase 3. */
export interface DesignOptions { style: string; layout: string; seed: number; colors: string[] | null; showPrice: boolean; removeBg: boolean; showReference: boolean }
export interface PlanSpec {
  kind: 'imagen' | 'carrusel' | 'video'; template: string; format: string; quality: 'estandar' | 'alta'; seconds: number | null
  width: number; height: number; slides: number; badge: string | null; products: PlanProduct[]
  brand: { name: string; slogan: string | null; logoUrl: string | null; colors: string[]; font: string | null }
  storeUrl: string | null
  copy: { headline: string; description: string; benefits: string[]; cta: string }
  design?: DesignOptions | null
}

export type LayerRole = 'fondo' | 'foto' | 'logo' | 'etiqueta' | 'titular' | 'nombre' | 'precio' | 'precio_anterior' | 'descripcion' | 'cta' | 'url' | 'marca' | 'rotulo' | 'contador' | 'decoracion' | 'referencia' | 'descuento' | 'categoria'
interface Base { role: LayerRole; x: number; y: number; w: number; h: number; opacity: number; offsetY: number; /** Segundo en que aparece (video). */ at: number }
/** Tipografía de una capa de texto (motor de diseño). Sin ella se usa la fuente de la escena. */
export interface TextStyle { family: string; italic?: boolean; letterSpacing?: number; lineHeight?: number }
export type ShapeKind = 'circle' | 'ring' | 'ellipse' | 'poly' | 'burst' | 'dots' | 'lines' | 'grid' | 'noise' | 'rule' | 'sparkle' | 'blob' | 'arc'
export type Layer =
  | (Base & { type: 'rect'; color: string; radius: number; stroke?: number })
  | (Base & {
      type: 'image'; src: string; fit: 'cover' | 'contain'; radius: number; zoom: number; /** Recorte horizontal visible (0..1) para la transición antes/después. */ reveal: number
      /** Zona de la foto original que se usa (px). Sin deformar: se encaja con `fit`. */ crop?: { x: number; y: number; w: number; h: number }
      /** Color de fondo del marco (la foto se encaja sobre su propio color de fondo). */ matte?: string
      shadow?: { blur: number; offsetY: number; color: string }; reflection?: number; mask?: 'rect' | 'circle' | 'arch'; blur?: number
      /** Recuadro del producto dentro del lienzo, para el control de superposiciones. */ subject?: { x: number; y: number; w: number; h: number }
    })
  | (Base & { type: 'text'; text: string; size: number; weight: 400 | 500 | 600 | 700 | 800; color: string; align: 'left' | 'center' | 'right'; maxLines: number; strike: boolean; /** true = una sola línea que se encoge para caber entera (cifras). */ shrink: boolean
      font?: TextStyle; /** Líneas ya partidas por el motor (medidas con la fuente real). */ lines?: string[]; /** Color sobre el que se lee (control de contraste). */ on?: string })
  | (Base & { type: 'pill'; text: string; size: number; bg: string; color: string; align: 'left' | 'center' | 'right'; font?: TextStyle; weight?: 400 | 500 | 600 | 700 | 800; radius?: number; on?: string })
  | (Base & { type: 'gradient'; stops: Array<[number, string]>; angle: number; radial: boolean; radius: number; circle?: boolean })
  | (Base & { type: 'shape'; shape: ShapeKind; color: string; stroke: number; rotation: number; seed: number; points?: number[]; size?: number })

export interface Scene { width: number; height: number; font: string; layers: Layer[] }

/** Fuente de imagen: URL pública de la tienda o recurso privado de la biblioteca. */
export const assetSrc = (id: string) => `asset:${id}`

const INK = '#111827'
const MUTED = '#6B7280'
const WHITE = '#FFFFFF'
const validHex = (value: string | undefined) => (value && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toUpperCase() : null)

/** Negro o blanco, lo que contraste mejor sobre el color dado (luminancia relativa WCAG). */
export function contrastOn(hex: string): string {
  const channel = (index: number) => { const v = parseInt(hex.slice(index, index + 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
  // Umbral donde el texto oscuro y el claro contrastan igual (WCAG).
  return luminance > 0.179 ? INK : WHITE
}

export function palette(spec: PlanSpec) {
  const primary = validHex(spec.brand.colors[0]) || INK
  const accent = validHex(spec.brand.colors[1]) || primary
  return { primary, accent, onPrimary: contrastOn(primary), onAccent: contrastOn(accent) }
}

const base = (role: LayerRole, x: number, y: number, w: number, h: number, at = 0): Base => ({ role, x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h), opacity: 1, offsetY: 0, at })
const rect = (role: LayerRole, x: number, y: number, w: number, h: number, color: string, radius = 0, at = 0): Layer => ({ ...base(role, x, y, w, h, at), type: 'rect', color, radius })
const image = (src: string, x: number, y: number, w: number, h: number, fit: 'cover' | 'contain' = 'cover', radius = 0, role: LayerRole = 'foto'): Extract<Layer, { type: 'image' }> => ({ ...base(role, x, y, w, h), type: 'image', src, fit, radius, zoom: 1, reveal: 1 })
const text = (role: LayerRole, value: string, x: number, y: number, w: number, size: number, options: Partial<{ weight: 400 | 600 | 700 | 800; color: string; align: 'left' | 'center'; maxLines: number; strike: boolean; shrink: boolean; at: number }> = {}): Layer => {
  const maxLines = options.shrink ? 1 : options.maxLines ?? 2
  return { ...base(role, x, y, w, Math.round(size * 1.22 * maxLines), options.at ?? 0), type: 'text', text: value, size: Math.round(size), weight: options.weight ?? 700, color: options.color ?? INK, align: options.align ?? 'left', maxLines, strike: options.strike ?? false, shrink: options.shrink ?? false }
}
const pill = (role: LayerRole, value: string, x: number, y: number, w: number, size: number, bg: string, color: string, align: 'left' | 'center' | 'right' = 'left', at = 0): Layer => ({ ...base(role, x, y, w, Math.round(size * 2.1), at), type: 'pill', text: value, size: Math.round(size), bg, color, align })

/** Momentos de aparición en video (segundos). El último segundo queda fijo con todo visible. */
const AT = { logo: 0.2, etiqueta: 0.6, titular: 0.5, nombre: 0.9, precio: 1.4, descripcion: 1.9, cta: 2.4 } as const

/** Bloque de producto: foto, nombre, precio (y precio anterior) dentro de un área. */
function productBlock(layers: Layer[], product: PlanProduct, colors: ReturnType<typeof palette>, area: { x: number; y: number; w: number; h: number }, u: number, compact: boolean) {
  const pad = compact ? u * 1.2 : u * 3
  const nameSize = compact ? u * 2.2 : u * 4.1
  const priceSize = compact ? u * 2.8 : u * 6
  const textHeight = nameSize * 1.22 * 2 + priceSize * 1.3 + pad
  const photoHeight = Math.max(area.h - textHeight - pad, area.h * 0.45)
  layers.push(rect('fondo', area.x, area.y, area.w, area.h, WHITE, compact ? u * 1.5 : 0))
  if (product.image) layers.push(image(product.image, area.x, area.y, area.w, photoHeight, 'cover', compact ? u * 1.5 : 0))
  const textY = area.y + photoHeight + pad * 0.7
  layers.push(text('nombre', product.name, area.x + pad, textY, area.w - pad * 2, nameSize, { weight: 700, maxLines: 2, at: AT.nombre }))
  const priceY = textY + nameSize * 1.22 * 2 + u * 0.4
  const priceWidth = product.compareAtText ? (area.w - pad * 2) * 0.58 : area.w - pad * 2
  layers.push(text('precio', product.priceText, area.x + pad, priceY, priceWidth, priceSize, { weight: 800, color: colors.primary === WHITE ? INK : colors.primary, shrink: true, at: AT.precio }))
  if (product.compareAtText) layers.push(text('precio_anterior', product.compareAtText, area.x + pad + priceWidth + u, priceY + priceSize * 0.3, (area.w - pad * 2) * 0.42 - u, priceSize * 0.55, { weight: 600, color: MUTED, strike: true, shrink: true, at: AT.precio }))
}

/** Construye la escena de una pieza (o de una diapositiva del carrusel / segmento del video). */
export function buildScene(spec: PlanSpec, slide = 0): Scene {
  const { width: W, height: H } = spec
  const colors = palette(spec)
  const u = Math.min(W, H) / 100
  const ratio = W / H
  const wide = ratio > 2
  const landscape = ratio > 1.25
  const pad = u * 4.5
  const layers: Layer[] = [rect('fondo', 0, 0, W, H, WHITE)]
  const single = spec.kind === 'carrusel' || (spec.kind === 'video' && spec.products.length > 1) ? spec.products[slide] ?? null : spec.products.length === 1 ? spec.products[0]! : null
  const ctaSize = wide ? u * 5 : u * 3.4
  const band = Math.round(ctaSize * 2.1 + pad * 1.4)
  const brandOnly = spec.template === 'historia_marca' && !single

  if (brandOnly || (spec.template === 'invitacion_catalogo' && !spec.products.length)) {
    // Pieza de marca: fondo del color principal con logo, nombre y eslogan (o titular y dirección).
    layers.push(rect('fondo', 0, 0, W, H, colors.primary))
    const logoSize = Math.min(W, H) * (wide ? 0.42 : 0.3)
    if (spec.brand.logoUrl) layers.push({ ...image(spec.brand.logoUrl, (W - logoSize) / 2, H * (wide ? 0.08 : 0.16), logoSize, logoSize, 'contain', u * 2, 'logo'), at: AT.logo })
    const titleY = spec.brand.logoUrl ? H * (wide ? 0.08 : 0.16) + logoSize + u * 3 : H * 0.3
    layers.push(text('titular', spec.copy.headline, pad, titleY, W - pad * 2, u * (wide ? 7 : 6.2), { weight: 800, color: colors.onPrimary, align: 'center', maxLines: 2, at: AT.titular }))
    if (spec.copy.description) layers.push(text('descripcion', spec.copy.description, pad * 1.5, titleY + u * (wide ? 7 : 6.2) * 2.5, W - pad * 3, u * 3.4, { weight: 400, color: colors.onPrimary, align: 'center', maxLines: 3, at: AT.descripcion }))
    if (spec.storeUrl) layers.push(text('url', spec.storeUrl.replace(/^https?:\/\//, ''), pad, H - band - u * 6, W - pad * 2, u * 3, { weight: 600, color: colors.onPrimary, align: 'center', shrink: true, at: AT.cta }))
    layers.push(pill('cta', spec.copy.cta, pad, H - band + pad * 0.5, W - pad * 2, ctaSize, colors.onPrimary, colors.primary, 'center', AT.cta))
    return { width: W, height: H, font: spec.brand.font || 'Inter', layers }
  }

  if (spec.template === 'antes_despues' && single?.beforeAfter) {
    // Dos fotos reales: la original y la mejorada. En video, la mejorada se revela sobre la original.
    const top = Math.round(u * 15)
    const photoArea = { x: 0, y: top, w: W, h: H - top - band - Math.round(u * 13) }
    const before = assetSrc(single.beforeAfter.beforeAssetId)
    const after = single.beforeAfter.afterUrl || assetSrc(single.beforeAfter.afterAssetId)
    layers.push(text('titular', spec.copy.headline, pad, u * 4.5, W - pad * 2, u * 5, { weight: 800, maxLines: 1, shrink: true, at: AT.titular }))
    if (spec.kind === 'video') {
      layers.push(image(before, photoArea.x, photoArea.y, photoArea.w, photoArea.h, 'contain'))
      layers.push({ ...image(after, photoArea.x, photoArea.y, photoArea.w, photoArea.h, 'contain'), reveal: 0 })
    } else {
      const half = landscape ? { w: W / 2, h: photoArea.h } : { w: W, h: photoArea.h / 2 }
      layers.push(image(before, 0, photoArea.y, half.w, half.h, 'contain'))
      layers.push(image(after, landscape ? W / 2 : 0, landscape ? photoArea.y : photoArea.y + half.h, half.w, half.h, 'contain'))
      layers.push(pill('rotulo', 'ANTES', pad, photoArea.y + u * 2, half.w - pad * 2, u * 2.6, INK, WHITE, 'left'))
      layers.push(pill('rotulo', 'DESPUÉS', (landscape ? W / 2 : 0) + pad, (landscape ? photoArea.y : photoArea.y + half.h) + u * 2, half.w - pad * 2, u * 2.6, colors.accent, colors.onAccent, 'left'))
    }
    const infoY = photoArea.y + photoArea.h + u * 2
    layers.push(text('precio', single.priceText, pad, infoY, W - pad * 2, u * 5.2, { weight: 800, color: colors.primary === WHITE ? INK : colors.primary, shrink: true, at: AT.precio }))
  } else if (single) {
    const logoBox = Math.round(u * 13)
    if (wide || landscape) {
      // Foto a la izquierda, datos a la derecha.
      const photoW = Math.round(W * (wide ? 0.42 : 0.56))
      if (single.image) layers.push(image(single.image, 0, 0, photoW, H, 'cover'))
      const x = photoW + pad
      const w = W - photoW - pad * 2
      const nameSize = u * (wide ? 8 : 5.6)
      const priceSize = u * (wide ? 12 : 8.4)
      const nameY = wide ? pad * 1.2 : H * 0.2
      layers.push(text('nombre', single.name, x, nameY, w, nameSize, { weight: 700, maxLines: 2, at: AT.nombre }))
      const priceY = nameY + nameSize * 1.22 * 2 + u * 1.5
      layers.push(text('precio', single.priceText, x, priceY, w, priceSize, { weight: 800, color: colors.primary === WHITE ? INK : colors.primary, shrink: true, at: AT.precio }))
      if (single.compareAtText) layers.push(text('precio_anterior', single.compareAtText, x, priceY + priceSize * 1.25, w, priceSize * 0.5, { weight: 600, color: MUTED, strike: true, shrink: true, at: AT.precio }))
      if (!wide && spec.copy.description) layers.push(text('descripcion', spec.copy.description, x, priceY + priceSize * 2.1, w, u * 3, { weight: 400, color: MUTED, maxLines: 3, at: AT.descripcion }))
      layers.push(pill('cta', spec.copy.cta, x, H - pad - ctaSize * 2.1, w, ctaSize, colors.primary, colors.onPrimary, 'left', AT.cta))
      if (spec.brand.logoUrl) layers.push({ ...image(spec.brand.logoUrl, W - pad - logoBox, wide ? H - pad - logoBox : pad, logoBox, logoBox, 'contain', u * 1.5, 'logo'), at: AT.logo })
    } else {
      productBlock(layers, single, colors, { x: 0, y: 0, w: W, h: H - band }, u, false)
      if (spec.brand.logoUrl) {
        layers.push(rect('logo', pad, pad, logoBox, logoBox, WHITE, u * 2, AT.logo))
        layers.push({ ...image(spec.brand.logoUrl, pad + u, pad + u, logoBox - u * 2, logoBox - u * 2, 'contain', u * 1.5, 'logo'), at: AT.logo })
      }
    }
  } else {
    // Varios productos en una sola pieza: titular y cuadrícula.
    const titleSize = u * (wide ? 6 : 5)
    layers.push(text('titular', spec.copy.headline, pad, pad, W - pad * 2 - (spec.brand.logoUrl ? u * 12 : 0), titleSize, { weight: 800, maxLines: 1, shrink: true, at: AT.titular }))
    if (spec.brand.logoUrl) layers.push({ ...image(spec.brand.logoUrl, W - pad - u * 9, pad * 0.5, u * 9, u * 9, 'contain', u * 1.5, 'logo'), at: AT.logo })
    const top = pad + titleSize * 1.22 + u * 5
    const urlSpace = spec.storeUrl ? u * 5 : 0
    const area = { x: pad, y: top, w: W - pad * 2, h: H - top - band - urlSpace - u * 2 }
    const n = spec.products.length
    const columns = wide || landscape ? Math.min(n, wide ? 6 : 3) : n <= 2 && ratio < 0.7 ? 1 : 2
    const rows = Math.ceil(n / columns)
    const gap = u * 2.2
    const cellW = (area.w - gap * (columns - 1)) / columns
    const cellH = (area.h - gap * (rows - 1)) / rows
    layers.push(rect('fondo', 0, top - u * 2.5, W, area.h + urlSpace + u * 5, '#F3F4F6'))
    spec.products.forEach((product, index) => productBlock(layers, product, colors, { x: area.x + (index % columns) * (cellW + gap), y: area.y + Math.floor(index / columns) * (cellH + gap), w: cellW, h: cellH }, u, true))
    if (spec.storeUrl) layers.push(text('url', spec.storeUrl.replace(/^https?:\/\//, ''), pad, area.y + area.h + u * 1.5, W - pad * 2, u * 2.8, { weight: 600, color: INK, align: 'center', shrink: true, at: AT.cta }))
  }

  if (!(single && (wide || landscape) && spec.template !== 'antes_despues')) {
    // Franja inferior con la llamada a la acción.
    layers.push(rect('cta', 0, H - band, W, band, colors.primary, 0, AT.cta))
    layers.push(text('cta', spec.copy.cta, pad, H - band + (band - ctaSize * 1.22) / 2, W - pad * 2, ctaSize, { weight: 700, color: colors.onPrimary, align: 'center', shrink: true, at: AT.cta }))
  }
  if (spec.badge) layers.push(pill('etiqueta', spec.badge, pad, wide || landscape ? pad : pad, W - pad * 2, u * (wide ? 4.2 : 3.2), colors.accent, colors.onAccent, single && (wide || landscape) ? 'left' : 'right', AT.etiqueta))
  if (spec.kind === 'carrusel' && spec.slides > 1) layers.push(pill('contador', `${slide + 1}/${spec.slides}`, pad, H - band - u * 8, W - pad * 2, u * 2.4, 'rgba(17,24,39,0.72)', WHITE, 'right'))
  return { width: W, height: H, font: spec.brand.font || 'Inter', layers }
}

// ---- video ---------------------------------------------------------------------------------------

export const VIDEO_FPS = 30
const APPEAR = 0.5
const CROSSFADE = 0.5
const easeOut = (t: number) => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3

/** Tamaño de exportación del video: lado menor de 720 px (estándar) o 1080 px (alta), siempre par. */
export function videoSize(spec: PlanSpec): { width: number; height: number } {
  const short = spec.quality === 'alta' ? 1080 : 720
  const scale = short / Math.min(spec.width, spec.height)
  return { width: Math.round(spec.width * scale / 2) * 2, height: Math.round(spec.height * scale / 2) * 2 }
}

/** Segmentos del video: uno por producto cuando hay varios; uno solo en los demás casos. */
export function videoSegments(spec: PlanSpec): number {
  return spec.kind === 'video' && spec.products.length > 1 ? spec.products.length : 1
}

/** Estado exacto de las capas en el segundo `t`. Misma entrada, mismo cuadro: el video es reproducible. */
export function frameAt(spec: PlanSpec, t: number, build: (spec: PlanSpec, slide: number) => Scene = buildScene): Layer[] {
  const duration = spec.seconds || 6
  const segments = videoSegments(spec)
  const length = duration / segments
  const index = Math.min(segments - 1, Math.floor(t / length))
  const local = t - index * length
  const draw = (slide: number, time: number, alpha: number): Layer[] => build(spec, slide).layers.map((layer) => {
    const next = { ...layer }
    if (next.type === 'image' && next.role === 'foto') {
      // Acercamiento lento y continuo (Ken Burns) sobre la foto real.
      next.zoom = 1 + 0.08 * Math.min(1, time / length)
      if (spec.template === 'antes_despues' && next.reveal === 0) next.reveal = easeOut((time - length * 0.3) / (length * 0.35))
    }
    // En segmentos cortos (varios productos) las apariciones se comprimen para que todo se alcance a leer.
    const pace = Math.min(1, length / 5)
    const progress = layer.at > 0 ? easeOut((time - layer.at * pace) / (APPEAR * pace)) : 1
    next.opacity = progress * alpha
    next.offsetY = Math.round((1 - progress) * spec.height * 0.025)
    return next
  })
  const fadeIn = index > 0 ? Math.min(1, local / CROSSFADE) : 1
  if (fadeIn >= 1) return draw(index, local, 1)
  // Transición entre productos: el anterior completo debajo y el nuevo entrando encima.
  return [...draw(index - 1, length, 1), ...draw(index, local, fadeIn)]
}

export const frameCount = (spec: PlanSpec) => Math.round((spec.seconds || 6) * VIDEO_FPS)
