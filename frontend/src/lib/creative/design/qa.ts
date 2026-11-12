/** Control de calidad automático de una pieza compuesta.
 *
 * Una pieza no está lista solo porque se exportó: se revisan dimensiones, márgenes de seguridad,
 * desbordes, superposiciones, contraste (WCAG), tamaño mínimo de letra, fidelidad de la foto y que los
 * datos dibujados coincidan exactamente con el catálogo. Los errores bloquean el guardado; los avisos se
 * muestran para que el comercio decida. */
import type { Layer, PlanSpec, Scene } from '../scene'
import { contrastRatio, isHex } from './color'
import { cssFont } from './fonts'
import { turnedBox, type DesignContext, type Measure } from './compose'
import { styleOf } from './styles'

export interface QaCheck { code: string; level: 'error' | 'aviso' | 'ok'; message: string }
export interface QaReport { ok: boolean; errors: number; warnings: number; checks: QaCheck[] }

const CONTENT = new Set(['logo', 'etiqueta', 'titular', 'nombre', 'precio', 'precio_anterior', 'descripcion', 'cta', 'url', 'referencia', 'categoria', 'contador', 'dato', 'beneficio', 'marca'])
/** Parte mínima del lienzo que debe ocupar el producto, por sector (el producto manda). */
const PRODUCT_SHARE: Record<string, number> = { calzado: 0.16, moda: 0.2, streetwear: 0.14, hogar: 0.14, belleza: 0.1 }
type Box = { x: number; y: number; w: number; h: number }
const overlap = (a: Box, b: Box, tolerance = 2) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > tolerance && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > tolerance
const normalize = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').replace(/…$/, '').replace(/\s+/g, ' ').trim().toLocaleUpperCase('es')
const LABELS: Record<string, string> = { dato: 'un rótulo de la ficha', beneficio: 'un beneficio', marca: 'la marca', logo: 'el logo', etiqueta: 'la etiqueta', titular: 'el titular', nombre: 'el nombre', precio: 'el precio', precio_anterior: 'el precio anterior', descripcion: 'la descripción', cta: 'el botón', url: 'la dirección', referencia: 'la referencia', categoria: 'la categoría', contador: 'el contador', foto: 'el producto' }
const label = (role: string) => LABELS[role] ?? role

export function checkScene(scene: Scene, spec: PlanSpec, slide: number, ctx: Pick<DesignContext, 'photos' | 'measure'> & { measure: Measure }): QaReport {
  const checks: QaCheck[] = []
  const add = (code: string, level: QaCheck['level'], message: string) => checks.push({ code, level, message })
  const { width: W, height: H } = scene
  const u = Math.min(W, H) / 100
  // Las capas giradas se comprueban con la caja que realmente ocupan.
  const layers = scene.layers.map((layer) => (layer.turn ? { ...layer, ...turnedBox(layer, layer.turn) } : layer)) as Layer[]

  // 1. Dimensiones exactas del formato.
  add('dimensiones', scene.width === spec.width && scene.height === spec.height ? 'ok' : 'error', `Tamaño ${scene.width} × ${scene.height} px${scene.width === spec.width && scene.height === spec.height ? '' : ` (se esperaba ${spec.width} × ${spec.height})`}.`)

  // 2. Márgenes de seguridad y desbordes del lienzo.
  const margin = u * 2.5
  const story = H / W > 1.6
  const outside = layers.filter((layer) => CONTENT.has(layer.role) && (layer.x < margin - 1 || layer.y < (story ? H * 0.05 : margin) - 1 || layer.x + layer.w > W - margin + 1 || layer.y + layer.h > H - (story ? H * 0.06 : margin) + 1))
  add('margenes', outside.length ? 'error' : 'ok', outside.length ? `Fuera del margen de seguridad: ${[...new Set(outside.map((layer) => label(layer.role)))].join(', ')}.` : story ? 'Textos y logo dentro de la zona segura de historias y estados.' : 'Textos y logo dentro del margen de seguridad.')

  // 3. Superposiciones entre textos, logo, botón y producto.
  const content = layers.filter((layer) => CONTENT.has(layer.role) && (layer.type === 'text' || layer.type === 'pill' || layer.type === 'image' || (layer.type === 'rect' && layer.role !== 'logo')))
  const clashes: string[] = []
  for (let i = 0; i < content.length; i++) for (let j = i + 1; j < content.length; j++) {
    const a = content[i]!, b = content[j]!
    if (a.role === b.role) continue
    if ((a.role === 'precio' && b.role === 'precio_anterior') || (b.role === 'precio' && a.role === 'precio_anterior')) { if (overlap(a, b, 4)) clashes.push(`${label(a.role)} y ${label(b.role)}`); continue }
    if (overlap(a, b)) clashes.push(`${label(a.role)} y ${label(b.role)}`)
  }
  const subjects = layers.filter((layer): layer is Extract<Layer, { type: 'image' }> => layer.type === 'image' && layer.role === 'foto' && Boolean(layer.subject))
  const coversProduct: string[] = []
  for (const subject of subjects) for (const layer of content) {
    if (layer.role === 'etiqueta' || layer.role === 'contador' || layer.role === 'logo') continue
    if (overlap(layer, subject.subject!, u * 0.8)) coversProduct.push(label(layer.role))
  }
  add('superposicion', clashes.length ? 'error' : 'ok', clashes.length ? `Se superponen: ${[...new Set(clashes)].join('; ')}.` : 'Ningún texto se monta sobre otro.')
  add('producto_visible', coversProduct.length ? 'error' : 'ok', coversProduct.length ? `Tapan el producto: ${[...new Set(coversProduct)].join(', ')}.` : 'El producto se ve completo, sin textos encima.')
  const badgeOnProduct = subjects.some((subject) => layers.some((layer) => layer.role === 'etiqueta' && overlap(layer, subject.subject!, u * 2)))
  if (badgeOnProduct) add('etiqueta_producto', 'aviso', 'La etiqueta toca el borde del producto.')

  // 4. Contraste de cada texto con su fondo.
  const poor: string[] = []
  for (const layer of layers) {
    if (layer.role === 'rotulo' || layer.role === 'decoracion') continue
    let fg: string | null = null, bg: string | null = null, size = 0
    if (layer.type === 'text') { fg = layer.color; bg = layer.on ?? null; size = layer.size }
    else if (layer.type === 'pill') { fg = layer.color; bg = layer.bg; size = layer.size }
    if (!fg || !bg || !isHex(fg) || !isHex(bg)) continue
    const need = size >= u * 3.6 || (layer.type === 'text' && layer.weight >= 700 && size >= u * 2.6) ? 3 : 4.5
    const ratio = contrastRatio(fg, bg)
    if (ratio < need) poor.push(`${label(layer.role)} (${ratio.toFixed(1)}:1)`)
  }
  add('contraste', poor.length ? 'error' : 'ok', poor.length ? `Contraste insuficiente: ${poor.join(', ')}.` : 'Todos los textos tienen contraste suficiente (WCAG).')

  // 5. Textos cortados, desbordados o demasiado pequeños.
  const cut: string[] = [], overflow: string[] = [], tiny: string[] = []
  for (const layer of layers) {
    if (layer.type !== 'text' || layer.role === 'rotulo') continue
    const lines = layer.lines ?? [layer.text]
    if (lines.some((line) => line.endsWith('…'))) cut.push(label(layer.role))
    if (layer.font) {
      const font = cssFont(layer.font.family, layer.weight, layer.size, layer.font.italic)
      const spacing = (layer.font.letterSpacing ?? 0) * layer.size
      if (lines.some((line) => ctx.measure(line, font) + spacing * Math.max(0, line.length - 1) > layer.w + 2)) overflow.push(label(layer.role))
    }
    if (layer.size < u * 1.45) tiny.push(label(layer.role))
  }
  add('textos_completos', cut.includes('el precio') || cut.includes('el precio anterior') ? 'error' : cut.length ? 'aviso' : 'ok', cut.length ? `Texto acortado con puntos suspensivos: ${[...new Set(cut)].join(', ')}.` : 'Ningún texto quedó cortado.')
  add('desborde', overflow.length ? 'error' : 'ok', overflow.length ? `Se sale de su espacio: ${[...new Set(overflow)].join(', ')}.` : 'Cada texto cabe en su espacio.')
  add('legibilidad', tiny.length ? 'aviso' : 'ok', tiny.length ? `Letra muy pequeña para redes: ${[...new Set(tiny)].join(', ')}.` : 'Tamaños de letra legibles en el celular.')

  // 6. Datos exactos del catálogo.
  const single = spec.kind === 'carrusel' || (spec.kind === 'video' && spec.products.length > 1) ? spec.products[slide] ?? null : spec.products.length === 1 ? spec.products[0]! : null
  const texts = (role: string) => layers.filter((layer) => layer.role === role && (layer.type === 'text' || layer.type === 'pill')).map((layer) => (layer as Extract<Layer, { type: 'text' | 'pill' }>).text)
  const problems: string[] = []
  const showPrice = spec.design?.showPrice !== false
  if (single) {
    const prices = texts('precio')
    if (showPrice && !(prices.length === 1 && prices[0] === single.priceText)) problems.push(`precio (se esperaba «${single.priceText}»)`)
    if (!showPrice && prices.length) problems.push('el precio debía ocultarse')
    if (showPrice && single.compareAtText && !texts('precio_anterior').includes(single.compareAtText)) problems.push('precio anterior')
    const names = texts('nombre')
    if (!names.some((name) => normalize(single.name).startsWith(normalize(name)) && normalize(name).length >= Math.min(12, normalize(single.name).length))) problems.push('nombre del producto')
    if (!subjects.length && single.image) problems.push('falta la foto del producto')
  } else if (showPrice) {
    for (const product of spec.products) if (!texts('precio').includes(product.priceText)) problems.push(`precio de «${product.name}»`)
  }
  if (spec.badge && !texts('etiqueta').includes(spec.badge)) problems.push(`etiqueta «${spec.badge}»`)
  if (spec.brand.logoUrl && ctx.photos.has(spec.brand.logoUrl) && !layers.some((layer) => layer.role === 'logo' && layer.type === 'image')) problems.push('logo de la tienda')
  add('datos', problems.length ? 'error' : 'ok', problems.length ? `No coincide con el catálogo: ${problems.join(', ')}.` : 'Nombre, precio, etiqueta y logo coinciden con el catálogo.')

  // 7. Fidelidad de la foto: sin deformar y sin recortes que escondan el producto.
  let lost = 0
  for (const layer of layers) {
    if (layer.type !== 'image' || layer.role !== 'foto' || layer.fit !== 'cover') continue
    const info = ctx.photos.get(layer.src)
    if (!info) continue
    const crop = layer.crop ?? { w: info.width, h: info.height }
    const a = crop.w / crop.h, b = layer.w / layer.h
    lost = Math.max(lost, 1 - Math.min(a, b) / Math.max(a, b))
  }
  add('foto_fiel', lost > 0.2 ? 'error' : 'ok', lost > 0.2 ? `La foto se recorta un ${Math.round(lost * 100)} %: podría esconder parte del producto.` : 'Foto original sin deformar; el producto se ve completo.')

  // 8. Estética mínima: el producto manda y la pieza invita a actuar.
  if (single && subjects.length) {
    const area = Math.max(...subjects.map((layer) => (layer.subject!.w * layer.subject!.h) / (W * H)))
    const sector = spec.design?.sector ?? styleOf(spec.design?.style ?? '').sector
    const minimum = PRODUCT_SHARE[sector] ?? 0.12
    add('producto_protagonista', area < 0.05 ? 'error' : area < minimum ? 'aviso' : 'ok', area < minimum ? `El producto ocupa solo el ${Math.round(area * 100)} % de la pieza (lo recomendable para este sector es ${Math.round(minimum * 100)} % o más).` : `El producto es protagonista (${Math.round(area * 100)} % de la pieza).`)
  }
  const hasCta = layers.some((layer) => layer.role === 'cta' && (layer.type === 'pill' || layer.type === 'text'))
  add('llamado_accion', hasCta ? 'ok' : 'error', hasCta ? 'Tiene llamado a la acción.' : 'Falta el llamado a la acción.')
  if (spec.design?.objective === 'promocion' && single && showPrice) {
    const price = layers.find((layer) => layer.role === 'precio' && layer.type === 'text') as Extract<Layer, { type: 'text' }> | undefined
    if (!single.compareAtText) add('promocion', 'aviso', 'Objetivo «Promoción» sin descuento en el catálogo: la pieza muestra el precio normal, sin anunciar rebajas.')
    else if (price && price.size < u * 4.5) add('promocion', 'aviso', 'En una promoción el precio debería verse más grande.')
  }

  const errors = checks.filter((check) => check.level === 'error').length
  const warnings = checks.filter((check) => check.level === 'aviso').length
  return { ok: errors === 0, errors, warnings, checks }
}
