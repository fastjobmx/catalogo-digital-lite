/** Composiciones de campaña: las que dan identidad a cada familia sectorial.
 *
 *  - héroe (calzado, streetwear): producto grande e inclinado, líneas de velocidad, palabra gigante detrás;
 *  - lookbook (moda): la foto original manda, marco editorial y poco texto;
 *  - collage (streetwear, calzado urbano): fotos con cinta, producto como adhesivo, nombre en barras;
 *  - catálogo (hogar): foto limpia y ficha de datos ordenada;
 *  - podio (belleza): producto sobre un podio con halo de luz.
 *
 * Reutilizan las mismas piezas del motor (medición, ajuste de texto, precio exacto, botón, logo, etiqueta y
 * encuadre fiel de la foto), así que heredan sus garantías y pasan por el mismo control de calidad. */
import type { Layer } from '../scene'
import { bestOn, contrastRatio, rgba } from './color'
import {
  AT, stacked, background, badgePill, base, ctaPill, decorate, displayStyle, fitText, header, infoStack, inset, logoLayers, priceBlock, productVisual, textLayer, upper,
  type Frame,
} from './compose'
import type { Box } from './photo'

const isCut = (frame: Frame) => Boolean(frame.product?.image && frame.design.removeBg && frame.ctx.cutouts.has(frame.product.image))

/** Fila inferior: precio a la izquierda y botón a la derecha, apoyada en `bottomY`. */
function priceCtaRow(frame: Frame, bottomY: number, on: string, align: 'split' | 'center' = 'split'): { layers: Layer[]; top: number } {
  const { W, m, u, product, design } = frame
  if (align === 'center') {
    const cta = ctaPill(frame, { x: m, y: 0, w: W - m * 2 }, 'center', false, undefined, on)
    cta.y = Math.round(bottomY - cta.h)
    const price = product && design.showPrice ? priceBlock(frame, product, { x: m, y: 0, w: W - m * 2 }, 'center', on, frame.emphasis.priceScale) : { layers: [], height: 0 }
    const priceTop = cta.y - u * 2.6 - price.height
    for (const layer of price.layers) layer.y = Math.round(layer.y + priceTop)
    return { layers: [...price.layers, cta], top: price.height ? priceTop : cta.y }
  }
  const half = W / 2
  const price = product && design.showPrice ? priceBlock(frame, product, { x: m, y: 0, w: half - m - u * 1.5 }, 'left', on, frame.emphasis.priceScale) : { layers: [], height: 0 }
  const cta = ctaPill(frame, { x: half + u * 1.5, y: 0, w: half - m - u * 1.5 }, 'right', false, undefined, on)
  const rowH = Math.max(price.height, cta.h)
  const top = bottomY - rowH
  for (const layer of price.layers) layer.y = Math.round(layer.y + top + (rowH - price.height) / 2)
  cta.y = Math.round(top + (rowH - cta.h) / 2)
  return { layers: [...price.layers, cta], top }
}

function tape(frame: Frame, x: number, y: number, turn: number) {
  const { u, colors } = frame
  frame.layers.push({ ...base('decoracion', { x, y, w: u * 12, h: u * 3.4 }), type: 'rect', color: rgba(colors.highlight.startsWith('#') ? colors.highlight : '#F5E6A8', 0.78), radius: 0, turn })
}

// ---- héroe -----------------------------------------------------------------------------------------

export function heroe(frame: Frame) {
  const { W, H, u, m, top, bottom, orient, colors, style } = frame
  const cut = isCut(frame)
  if (orient !== 'vertical') {
    const stage = { x: W * 0.42, y: top * 0.6, w: W * 0.58 - m * 0.4, h: H - top * 0.6 - bottom * 0.6 }
    background(frame, colors.bg, colors.bg2, { x: stage.x + stage.w / 2, y: H / 2 })
    decorate(frame, stage)
    productVisual(frame, stage, { floor: true, tilt: style.tilt, polaroid: !cut, alignY: 'center' })
    const logo = logoLayers(frame, { x: m, y: top }, 'left', u * 22, u * 9)
    frame.layers.push(...logo.layers)
    const badge = badgePill(frame, { x: W - m, y: top }, 'right', W * 0.3)
    if (badge) frame.layers.push(badge)
    const infoTop = (logo.box ? logo.box.y + logo.box.h : top) + u * 3
    const info = infoStack(frame, { box: { x: m, y: infoTop, w: W * 0.4 - m, h: H - infoTop - bottom }, align: 'left', valign: 'center', on: colors.bg, nameSize: u * (frame.wide ? 11 : 9.5), nameLines: 3, cta: true })
    frame.layers.push(...info.layers)
    return
  }
  const headBottom = header(frame, top)
  const name = infoStack(frame, { box: { x: m, y: 0, w: W - m * 2, h: H * 0.24 }, align: 'left', valign: 'top', on: colors.bg, nameSize: u * (orient === 'vertical' ? 10 : 8.4), nameLines: 2, cta: false, withPrice: false })
  const row = priceCtaRow(frame, H - bottom, colors.bg)
  const nameH = name.used.h
  const nameTop = row.top - u * 3 - nameH
  for (const layer of name.layers) layer.y = Math.round(layer.y - name.used.y + nameTop)
  const stage = { x: m * 0.4, y: headBottom + u * 1.5, w: W - m * 0.8, h: nameTop - headBottom - u * 4 }
  background(frame, colors.bg, colors.bg2, { x: W / 2, y: stage.y + stage.h / 2 })
  decorate(frame, stage)
  productVisual(frame, stage, { floor: true, tilt: style.tilt, polaroid: !cut, alignY: 'center' })
  frame.layers.push(...name.layers, ...row.layers)
}

// ---- lookbook --------------------------------------------------------------------------------------

export function lookbook(frame: Frame) {
  const { W, H, u, m, top, bottom, orient, colors, style, ctx, spec } = frame
  background(frame)
  decorate(frame, { x: 0, y: 0, w: W, h: H })
  const kicker = (spec.brand.name || '').toLocaleUpperCase('es')
  if (orient === 'horizontal') {
    const photo = { x: m * 0.7, y: m * 0.7, w: W * 0.52, h: H - m * 1.4 }
    productVisual(frame, photo, { floor: false, original: true, frameRadius: 0, shadow: style.shadow === 'marcada' })
    const col = { x: W * 0.52 + m * 1.4, y: top, w: W * 0.48 - m * 2.1, h: H - top - bottom }
    const logo = logoLayers(frame, { x: col.x, y: top }, 'left', u * 18, u * 7)
    frame.layers.push(...logo.layers)
    const infoTop = (logo.box ? logo.box.y + logo.box.h : top) + u * 2.5
    const info = infoStack(frame, { box: { x: col.x, y: infoTop, w: col.w, h: col.y + col.h - infoTop }, align: 'left', valign: 'bottom', on: colors.bg, nameSize: u * (frame.wide ? 10 : 8.5), nameLines: 3, cta: true })
    frame.layers.push(...info.layers)
    const badge = badgePill(frame, { x: photo.x + u * 2, y: photo.y + u * 2 }, 'left', photo.w * 0.5)
    if (badge) frame.layers.push(badge)
    return
  }
  // Cabecera: logo centrado y la marca en mayúsculas espaciadas.
  const logo = logoLayers(frame, { x: W / 2, y: top }, 'center', u * 18, u * 7.5)
  frame.layers.push(...logo.layers)
  let headBottom = logo.box ? logo.box.y + logo.box.h : top
  if (kicker && !logo.box) {
    const fitted = fitText(ctx.measure, kicker, { family: style.eyebrow.family, weight: style.eyebrow.weight, letterSpacing: style.eyebrow.letterSpacing, maxWidth: W - m * 2, maxLines: 1, maxSize: u * 2.4, minSize: u * 1.6 })
    frame.layers.push(textLayer('marca', fitted, { x: m, y: top, w: W - m * 2 }, colors.ink, colors.bg, { family: style.eyebrow.family, letterSpacing: style.eyebrow.letterSpacing }, style.eyebrow.weight, 'center', AT.logo))
    headBottom = top + fitted.size * 1.3
  }
  const info = infoStack(frame, { box: { x: m * 1.4, y: 0, w: W - m * 2.8, h: H * 0.3 }, align: 'center', valign: 'bottom', on: colors.bg, nameSize: u * 7.4, nameLines: 2, cta: true })
  const infoTop = H - bottom - info.used.h
  for (const layer of info.layers) layer.y = Math.round(layer.y - info.used.y + infoTop)
  const photo = { x: m, y: headBottom + u * 2.5, w: W - m * 2, h: infoTop - headBottom - u * 5.5 }
  const shown = productVisual(frame, photo, { floor: false, original: true, frameRadius: 0, shadow: style.shadow === 'marcada' })
  // Filete fino bajo la foto, como en una página de revista.
  frame.layers.push({ ...base('decoracion', { x: W / 2 - u * 6, y: shown.y + shown.h + u * 2.2, w: u * 12, h: Math.max(1.5, u * 0.18) }), type: 'rect', color: colors.line, radius: 0 })
  frame.layers.push(...info.layers)
  const badge = badgePill(frame, { x: shown.x + shown.w - u * 2, y: shown.y + u * 2 }, 'right', shown.w * 0.5)
  if (badge) frame.layers.push(badge)
}

// ---- collage ---------------------------------------------------------------------------------------

export function collage(frame: Frame) {
  const { W, H, u, m, top, bottom, orient, colors, product, ctx } = frame
  background(frame)
  const cut = isCut(frame)
  const extra = (product?.gallery ?? []).filter((src) => src !== product?.image && ctx.photos.has(src)).slice(0, 1)
  const place = (area: Box) => {
    decorate(frame, area)
    const main = productVisual(frame, { x: area.x, y: area.y, w: area.w * (cut || extra.length ? 0.66 : 1), h: area.h }, { floor: false, polaroid: true, tilt: -12, original: true })
    tape(frame, main.x + main.w * 0.08, main.y - u * 1.2, -18)
    tape(frame, main.x + main.w * 0.72, main.y - u * 1.4, 14)
    if (cut) productVisual(frame, { x: area.x + area.w * 0.4, y: area.y + area.h * 0.16, w: area.w * 0.6, h: area.h * 0.84 }, { floor: false, tilt: 9, sticker: true })
    else if (extra.length) {
      const sub: Frame = { ...frame, product: { ...product!, image: extra[0]! } }
      const second = productVisual(sub, { x: area.x + area.w * 0.56, y: area.y + area.h * 0.34, w: area.w * 0.44, h: area.h * 0.66 }, { floor: false, polaroid: true, tilt: 20, original: true })
      tape(frame, second.x + second.w * 0.35, second.y - u * 1.2, 6)
    }
  }
  if (orient !== 'vertical') {
    place({ x: m * 0.6, y: m * 0.9, w: W * 0.54, h: H - m * 1.8 })
    const col = { x: W * 0.58, y: top, w: W * 0.42 - m, h: H - top - bottom }
    const logo = logoLayers(frame, { x: col.x, y: top }, 'left', u * 20, u * 8)
    frame.layers.push(...logo.layers)
    const badge = badgePill(frame, { x: W - m, y: top }, 'right', col.w * 0.5)
    if (badge) frame.layers.push(badge)
    const infoTop = Math.max(logo.box ? logo.box.y + logo.box.h : top, badge ? badge.y + badge.h : top) + u * 3
    const info = infoStack(frame, { box: { x: col.x, y: infoTop, w: col.w, h: col.y + col.h - infoTop }, align: 'left', valign: 'center', on: colors.bg, nameSize: u * 7.6, nameLines: 3, cta: true })
    frame.layers.push(...info.layers)
    return
  }
  const headBottom = header(frame, top)
  const name = infoStack(frame, { box: { x: m, y: 0, w: W - m * 2, h: H * 0.24 }, align: 'left', valign: 'top', on: colors.bg, nameSize: u * 7.4, nameLines: 3, cta: false, withPrice: false })
  const row = priceCtaRow(frame, H - bottom, colors.bg)
  const nameTop = row.top - u * 3 - name.used.h
  for (const layer of name.layers) layer.y = Math.round(layer.y - name.used.y + nameTop)
  place({ x: m * 0.8, y: headBottom + u * 4.5, w: W - m * 1.6, h: nameTop - headBottom - u * 8 })
  frame.layers.push(...name.layers, ...row.layers)
}

// ---- ficha de catálogo -------------------------------------------------------------------------------

export function catalogo(frame: Frame) {
  const { W, H, u, m, top, bottom, orient, colors, style, product, design, ctx } = frame
  background(frame)
  const rows: Array<[string, string, 'referencia' | 'categoria']> = []
  if (product?.reference && (design.showReference || design.objective === 'catalogo')) rows.push(['Referencia', product.reference, 'referencia'])
  if (product?.category) rows.push(['Categoría', product.category, 'categoria'])
  const sheet = (x: number, w: number, bottomY: number, on: string): number => {
    // De abajo hacia arriba: botón, precio, filas de datos, filete y nombre. Devuelve dónde empieza el nombre.
    const cta = ctaPill(frame, { x, y: 0, w }, 'left', orient !== 'horizontal', undefined, on)
    cta.y = Math.round(bottomY - cta.h)
    frame.layers.push(cta)
    let y = cta.y - u * 3
    if (product && design.showPrice) {
      const price = priceBlock(frame, product, { x: x + w * 0.3, y: 0, w: w * 0.7 }, 'left', on, frame.emphasis.priceScale)
      const right = Math.max(...price.layers.map((layer) => layer.x + layer.w))
      const dx = x + w - right
      const priceTop = y - price.height
      for (const layer of price.layers) { layer.x = Math.round(layer.x + dx); layer.y = Math.round(layer.y + priceTop) }
      for (const layer of price.layers) if (layer.type === 'text') layer.align = 'right'
      frame.layers.push(...price.layers)
      const label = fitText(ctx.measure, 'Precio', { family: style.body.family, weight: 600, maxWidth: w * 0.28, maxLines: 1, maxSize: u * 2.3, minSize: u * 1.7 })
      const priceLeft = Math.min(...price.layers.map((layer) => layer.x))
      if (priceLeft - x > label.width + u * 2) frame.layers.push(textLayer('dato', label, { x, y: y - price.height / 2 - label.size * 0.6, w: w * 0.28 }, contrastRatio(colors.muted, on) >= 4.5 ? colors.muted : bestOn(on), on, { family: style.body.family }, 600, 'left', AT.precio))
      y = priceTop - u * 2
    }
    for (const [labelText, value, role] of [...rows].reverse()) {
      const size = u * 2.3
      const valueFit = fitText(ctx.measure, value, { family: style.body.family, weight: 600, maxWidth: w * 0.62, maxLines: 1, maxSize: size, minSize: u * 1.6 })
      const labelFit = fitText(ctx.measure, labelText, { family: style.body.family, weight: 500, maxWidth: w * 0.34, maxLines: 1, maxSize: size, minSize: u * 1.6 })
      const rowH = size * 2.4
      const rowY = y - rowH
      frame.layers.push({ ...base('decoracion', { x, y: y - 1, w, h: Math.max(1, u * 0.14) }), type: 'rect', color: colors.line, radius: 0 })
      frame.layers.push(textLayer('dato', labelFit, { x, y: rowY + (rowH - labelFit.size * 1.15) / 2, w: w * 0.34 }, contrastRatio(colors.muted, on) >= 4.5 ? colors.muted : bestOn(on), on, { family: style.body.family }, 500, 'left', AT.referencia))
      frame.layers.push(textLayer(role, valueFit, { x: x + w * 0.38, y: rowY + (rowH - valueFit.size * 1.15) / 2, w: w * 0.62 }, contrastRatio(colors.ink, on) >= 4.5 ? colors.ink : bestOn(on), on, { family: style.body.family }, 600, 'right', AT.referencia))
      y = rowY
    }
    frame.layers.push({ ...base('decoracion', { x, y: y - 1, w, h: Math.max(1, u * 0.14) }), type: 'rect', color: colors.line, radius: 0 })
    if (product) {
      const fitted = fitText(ctx.measure, upper(frame, product.name), { family: style.display.family, weight: style.display.weight, italic: style.display.italic, letterSpacing: style.display.letterSpacing, maxWidth: w, maxLines: 2, maxSize: u * 5.6 * style.nameScale * frame.emphasis.nameScale, minSize: u * 3 })
      const layer = textLayer('nombre', fitted, { x, y: 0, w }, contrastRatio(colors.ink, on) >= 4.5 ? colors.ink : bestOn(on), on, displayStyle(frame), style.display.weight, 'left', AT.nombre)
      layer.y = Math.round(y - u * 2.4 - layer.h)
      frame.layers.push(layer)
      return layer.y
    }
    return y
  }
  if (!stacked(frame)) {
    const photo = { x: m, y: m, w: W * 0.5 - m, h: H - m * 2 }
    // La tarjeta envuelve la foto tal como se ve (no un rectángulo vacío más grande que ella).
    const shown = productVisual(frame, inset(photo, u * 2.5), { floor: true, shadow: false, frameRadius: u * style.radius * 0.6 })
    frame.layers.push({ ...base('decoracion', inset(shown, -u * 2.5)), type: 'rect', color: colors.surface, radius: u * style.radius })
    const x = W * 0.5 + m * 0.8
    const w = W - x - m
    const logo = logoLayers(frame, { x, y: top }, 'left', u * 20, u * 8)
    frame.layers.push(...logo.layers)
    // La ficha se centra en el alto disponible bajo el logo (no queda pegada abajo).
    const before = frame.layers.length
    const nameTop = sheet(x, w, H - bottom, colors.bg)
    const room = H - bottom - ((logo.box ? logo.box.y + logo.box.h : top) + u * 3)
    const lift = Math.max(0, (room - (H - bottom - nameTop)) / 2)
    for (const layer of frame.layers.slice(before)) layer.y = Math.round(layer.y - lift)
    const badge = badgePill(frame, { x: shown.x, y: shown.y }, 'left', photo.w * 0.5)
    if (badge) frame.layers.push(badge)
    return
  }
  const headBottom = header(frame, top)
  const nameTop = sheet(m, W - m * 2, H - bottom, colors.bg)
  const photo = { x: m, y: headBottom + u * 2.5, w: W - m * 2, h: nameTop - headBottom - u * 5 }
  const shown = productVisual(frame, inset(photo, u * 2.5), { floor: true, shadow: false, frameRadius: u * style.radius * 0.6 })
  frame.layers.push({ ...base('decoracion', inset(shown, -u * 2.5)), type: 'rect', color: colors.surface, radius: u * style.radius })
}

// ---- podio -----------------------------------------------------------------------------------------

export function podio(frame: Frame) {
  const { W, H, u, m, top, bottom, colors } = frame
  const cut = isCut(frame)
  const stagePiece = (stage: Box) => {
    background(frame, colors.bg, colors.bg2, { x: stage.x + stage.w / 2, y: stage.y + stage.h * 0.45 })
    // Halo de luz detrás del producto y podio a sus pies.
    const r = Math.min(stage.w, stage.h) * 0.48
    const cx = stage.x + stage.w / 2, cy = stage.y + stage.h * 0.46
    frame.layers.push({ ...base('decoracion', { x: cx - r, y: cy - r, w: r * 2, h: r * 2 }), type: 'gradient', stops: [[0, rgba(colors.glow, 1)], [0.6, rgba(colors.glow, 0.55)], [1, rgba(colors.glow, 0)]], angle: 0, radial: true, radius: 0, circle: true })
    frame.layers.push({ ...base('decoracion', { x: cx - r * 0.98, y: cy - r * 0.98, w: r * 1.96, h: r * 1.96 }), type: 'shape', shape: 'ring', color: rgba(colors.line.startsWith('#') ? colors.line : '#FFFFFF', 0.8), stroke: Math.max(1.5, u * 0.2), rotation: 0, seed: 0 })
    const podiumW = Math.min(stage.w * 0.72, u * 62)
    const podiumH = Math.max(u * 6, podiumW * 0.2)
    const podium = { x: cx - podiumW / 2, y: stage.y + stage.h - podiumH, w: podiumW, h: podiumH }
    frame.layers.push({ ...base('decoracion', podium), type: 'shape', shape: 'podium', color: colors.panel, stroke: 0, rotation: 0, seed: 0 })
    decorate(frame, { x: stage.x, y: stage.y, w: stage.w, h: stage.h * 0.6 })
    const area = { x: stage.x + stage.w * 0.07, y: stage.y, w: stage.w * 0.86, h: stage.h - podiumH * 0.8 }
    // El producto se apoya en la tapa del podio (sin reservar espacio para reflejo).
    if (cut) frame.layers.push({ ...base('decoracion', { x: cx - podiumW * 0.3, y: podium.y + podiumH * 0.1, w: podiumW * 0.6, h: podiumH * 0.22 }), type: 'shape', shape: 'ellipse', color: 'rgba(0,0,0,0.22)', stroke: 0, rotation: 0, seed: 0 })
    productVisual(frame, area, { floor: false, alignY: 'bottom', mask: cut ? undefined : 'arch', original: !cut, frameRadius: u * frame.style.radius })
  }
  if (!stacked(frame)) {
    stagePiece({ x: m * 0.6, y: top * 0.7, w: W * 0.5, h: H - top * 0.7 - bottom * 0.7 })
    const col = { x: W * 0.54, y: top, w: W * 0.46 - m, h: H - top - bottom }
    const logo = logoLayers(frame, { x: col.x, y: top }, 'left', u * 20, u * 8)
    frame.layers.push(...logo.layers)
    const badge = badgePill(frame, { x: W - m, y: top }, 'right', col.w * 0.5)
    if (badge) frame.layers.push(badge)
    const infoTop = Math.max(logo.box ? logo.box.y + logo.box.h : top, badge ? badge.y + badge.h : top) + u * 3
    const info = infoStack(frame, { box: { x: col.x, y: infoTop, w: col.w, h: col.y + col.h - infoTop }, align: 'left', valign: 'center', on: colors.bg, nameSize: u * 7.4, nameLines: 3, cta: true })
    frame.layers.push(...info.layers)
    return
  }
  const headBottom = header(frame, top, 'center', 'right')
  const name = infoStack(frame, { box: { x: m, y: headBottom + u * 2.5, w: W - m * 2, h: H * 0.17 }, align: 'center', valign: 'top', on: colors.bg, nameSize: u * 6.4, nameLines: 2, cta: false, withPrice: false, description: false })
  const tail = infoStack(frame, { box: { x: m, y: 0, w: W - m * 2, h: H * 0.27 }, align: 'center', valign: 'bottom', on: colors.bg, nameSize: u * 6, withName: false, eyebrow: false, cta: true })
  const tailTop = H - bottom - tail.used.h
  for (const layer of tail.layers) layer.y = Math.round(layer.y - tail.used.y + tailTop)
  const nameBottom = name.used.y + name.used.h
  stagePiece({ x: m * 0.5, y: nameBottom + u * 2, w: W - m, h: tailTop - nameBottom - u * 4.5 })
  frame.layers.push(...name.layers, ...tail.layers)
}
