import { describe, expect, it } from 'vitest'
import { VIDEO_FPS, buildScene, contrastOn, frameAt, frameCount, palette, videoSegments, videoSize, type Layer, type PlanSpec } from './scene'
import { wrapLines } from './render'

const FORMATS: Record<string, [number, number]> = { cuadrado: [1080, 1080], vertical: [1080, 1350], historia: [1080, 1920], banner: [1920, 1080], whatsapp: [1200, 900], portada: [1640, 624] }
const product = (id: number, extra: Partial<PlanSpec['products'][number]> = {}) => ({ id, name: `Producto ${id} con un nombre largo de catálogo`, priceText: `$ ${id}9.900`, compareAtText: null, image: `/api/assets/stores/1/products/p${id}.jpg`, beforeAfter: null, ...extra })
function spec(format: string, extra: Partial<PlanSpec> = {}): PlanSpec {
  const [width, height] = FORMATS[format]!
  return {
    kind: 'imagen', template: 'producto_destacado', format, quality: 'estandar', seconds: null, width, height, slides: 1, badge: null, products: [product(1)],
    brand: { name: 'Mi Marca', slogan: 'Hecho con cariño', logoUrl: '/api/assets/stores/1/store/logo.png', colors: ['#0F766E', '#F59E0B'], font: 'Poppins' },
    storeUrl: null, copy: { headline: 'Titular', description: 'Descripción del producto', benefits: [], cta: 'Pídelo por WhatsApp' }, ...extra,
  }
}
const texts = (layers: Layer[], role: string) => layers.filter((layer) => layer.role === role && (layer.type === 'text' || layer.type === 'pill')).map((layer) => (layer as Extract<Layer, { type: 'text' | 'pill' }>).text)

describe('composición de piezas', () => {
  it('dibuja nombre, precio, etiqueta y logo tal cual vienen del plan, en todos los formatos', () => {
    for (const format of Object.keys(FORMATS)) {
      const scene = buildScene(spec(format, { template: 'oferta_aprobada', badge: '-20%', products: [product(1, { priceText: '$ 80.000', compareAtText: '$ 100.000' })] }))
      expect(texts(scene.layers, 'precio'), format).toEqual(['$ 80.000'])
      expect(texts(scene.layers, 'precio_anterior'), format).toEqual(['$ 100.000'])
      expect(texts(scene.layers, 'etiqueta'), format).toEqual(['-20%'])
      expect(texts(scene.layers, 'nombre'), format).toEqual(['Producto 1 con un nombre largo de catálogo'])
      expect(scene.layers.some((layer) => layer.type === 'image' && layer.role === 'logo'), format).toBe(true)
      // El precio es una cifra exacta: una sola línea que se encoge, nunca se corta. El anterior va tachado.
      const price = scene.layers.find((layer) => layer.role === 'precio') as Extract<Layer, { type: 'text' }>
      expect(price.shrink, format).toBe(true)
      expect((scene.layers.find((layer) => layer.role === 'precio_anterior') as Extract<Layer, { type: 'text' }>).strike, format).toBe(true)
      // Ninguna capa se sale del lienzo.
      for (const layer of scene.layers) {
        expect(layer.x >= 0 && layer.y >= 0 && layer.x + layer.w <= scene.width + 1 && layer.y + layer.h <= scene.height + 1, `${format} ${layer.role} ${JSON.stringify([layer.x, layer.y, layer.w, layer.h])}`).toBe(true)
      }
    }
  })

  it('sin etiqueta ni precio anterior cuando el plan no los trae; sin logo si la marca no tiene', () => {
    const scene = buildScene(spec('cuadrado', { brand: { name: 'X', slogan: null, logoUrl: null, colors: [], font: null } }))
    expect(texts(scene.layers, 'etiqueta')).toEqual([])
    expect(texts(scene.layers, 'precio_anterior')).toEqual([])
    expect(scene.layers.some((layer) => layer.role === 'logo')).toBe(false)
    expect(scene.font).toBe('Inter')
  })

  it('usa los colores del Brand Kit con texto legible', () => {
    expect(palette(spec('cuadrado'))).toEqual({ primary: '#0F766E', accent: '#F59E0B', onPrimary: '#FFFFFF', onAccent: '#111827' })
    expect(palette(spec('cuadrado', { brand: { name: 'X', slogan: null, logoUrl: null, colors: ['no-es-color'], font: null } })).primary).toBe('#111827')
    expect(contrastOn('#FFFFFF')).toBe('#111827')
    expect(contrastOn('#000000')).toBe('#FFFFFF')
  })

  it('colección: cada producto con su propio precio; carrusel: una diapositiva por producto', () => {
    const products = [product(1), product(2), product(3)]
    const grid = buildScene(spec('vertical', { template: 'coleccion', products }))
    expect(texts(grid.layers, 'precio')).toEqual(['$ 19.900', '$ 29.900', '$ 39.900'])
    expect(grid.layers.filter((layer) => layer.role === 'foto')).toHaveLength(3)
    const carousel = spec('cuadrado', { kind: 'carrusel', template: 'coleccion', products, slides: 3 })
    expect(texts(buildScene(carousel, 1).layers, 'precio')).toEqual(['$ 29.900'])
    expect(texts(buildScene(carousel, 2).layers, 'contador')).toEqual(['3/3'])
  })

  it('antes y después usa las dos fotos reales; la invitación muestra la dirección de la tienda', () => {
    const pair = { beforeAssetId: 'aaa', afterAssetId: 'bbb', afterUrl: '/api/assets/stores/1/products/estudio-bbb.png' }
    const scene = buildScene(spec('cuadrado', { template: 'antes_despues', products: [product(1, { beforeAfter: pair })] }))
    expect(scene.layers.filter((layer) => layer.type === 'image' && layer.role === 'foto').map((layer) => (layer as Extract<Layer, { type: 'image' }>).src)).toEqual(['asset:aaa', pair.afterUrl])
    expect(texts(scene.layers, 'rotulo')).toEqual(['ANTES', 'DESPUÉS'])
    const invite = buildScene(spec('historia', { template: 'invitacion_catalogo', products: [], storeUrl: 'https://app.tiendiaexpres.com/t/mi-tienda' }))
    expect(texts(invite.layers, 'url')).toEqual(['app.tiendiaexpres.com/t/mi-tienda'])
  })
})

describe('video determinista', () => {
  const video = (extra: Partial<PlanSpec> = {}) => spec('historia', { kind: 'video', seconds: 6, ...extra })

  it('exporta a tamaño par según la calidad y con la cantidad exacta de cuadros', () => {
    expect(videoSize(video())).toEqual({ width: 720, height: 1280 })
    expect(videoSize(video({ quality: 'alta' }))).toEqual({ width: 1080, height: 1920 })
    expect(videoSize(spec('vertical', { kind: 'video', seconds: 6 }))).toEqual({ width: 720, height: 900 })
    expect(frameCount(video())).toBe(6 * VIDEO_FPS)
    expect(frameCount(video({ seconds: 15 }))).toBe(450)
  })

  it('el mismo instante produce el mismo cuadro; las capas aparecen en orden y terminan todas visibles', () => {
    const s = video({ badge: 'NUEVO' })
    expect(frameAt(s, 1.234)).toEqual(frameAt(s, 1.234))
    const opacity = (t: number, role: string) => frameAt(s, t).find((layer) => layer.role === role)!.opacity
    expect(opacity(0, 'precio')).toBe(0)
    expect(opacity(0, 'foto')).toBe(1)
    expect(opacity(1.1, 'nombre')).toBeGreaterThan(0)
    expect(opacity(1.1, 'precio')).toBe(0)
    for (const layer of frameAt(s, 5.9)) { expect(layer.opacity, layer.role).toBe(1); expect(layer.offsetY, layer.role).toBe(0) }
    // El precio del video es el mismo texto del plan en todos los cuadros.
    for (const t of [0, 2, 4, 5.9]) expect(texts(frameAt(s, t), 'precio')).toEqual(['$ 19.900'])
    // Acercamiento continuo sobre la foto.
    const zoom = (t: number) => (frameAt(s, t).find((layer) => layer.role === 'foto') as Extract<Layer, { type: 'image' }>).zoom
    expect(zoom(0)).toBe(1)
    expect(zoom(3)).toBeGreaterThan(zoom(1))
    expect(zoom(6)).toBeCloseTo(1.08)
  })

  it('con varios productos muestra uno por segmento, con transición', () => {
    const s = video({ template: 'coleccion', seconds: 10, products: [product(1), product(2)] })
    expect(videoSegments(s)).toBe(2)
    expect(texts(frameAt(s, 4.5), 'precio')).toEqual(['$ 19.900'])
    expect(texts(frameAt(s, 9.5), 'precio')).toEqual(['$ 29.900'])
    // Durante la transición conviven el producto que sale y el que entra.
    expect(texts(frameAt(s, 5.1), 'nombre')).toHaveLength(2)
  })

  it('antes y después revela la foto mejorada sobre la original', () => {
    const pair = { beforeAssetId: 'aaa', afterAssetId: 'bbb', afterUrl: null }
    const s = video({ template: 'antes_despues', products: [product(1, { beforeAfter: pair })] })
    const reveal = (t: number) => (frameAt(s, t).filter((layer) => layer.role === 'foto')[1] as Extract<Layer, { type: 'image' }>).reveal
    expect(reveal(0.5)).toBe(0)
    expect(reveal(3)).toBeGreaterThan(0)
    expect(reveal(5.5)).toBe(1)
  })
})

describe('ajuste de texto', () => {
  const measure = (value: string) => value.length * 10
  it('parte en líneas y corta con puntos suspensivos solo los textos largos', () => {
    expect(wrapLines(measure, 'uno dos tres', 70, 2)).toEqual(['uno dos', 'tres'])
    expect(wrapLines(measure, 'uno dos tres cuatro cinco seis', 70, 2)).toEqual(['uno dos', 'tres…'])
    expect(wrapLines(measure, 'corto', 500, 2)).toEqual(['corto'])
  })
})
