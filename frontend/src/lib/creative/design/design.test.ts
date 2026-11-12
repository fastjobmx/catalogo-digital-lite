import { describe, expect, it } from 'vitest'
import type { PlanProduct, PlanSpec } from '../scene'
import { contrastRatio, ensureContrast, seededRandom } from './color'
import { composeDesign, containRect, fitText, normalizeDesign, styleLayouts, type DesignContext } from './compose'
import { analyzePhoto, type PhotoAnalysis } from './photo'
import { checkScene } from './qa'
import { DESIGN_STYLES, LAYOUT_KEYS, OBJECTIVE_KEYS, SECTOR_KEYS, STYLE_KEYS, detectSector, stylesOf } from './styles'

const FORMATS: Record<string, [number, number]> = { cuadrado: [1080, 1080], vertical: [1080, 1350], historia: [1080, 1920], banner: [1920, 1080], whatsapp: [1200, 900], portada: [1640, 624], anuncio: [1200, 628] }

/** Medición aproximada (ancho medio de glifo según la familia): suficiente para probar el reparto del espacio. */
const measure = (text: string, font: string) => {
  const size = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 16)
  const factor = /Anton|Bebas|Oswald/.test(font) ? 0.46 : /Cormorant|Playfair/.test(font) ? 0.5 : 0.57
  return text.length * size * factor
}

function photo(overrides: Partial<PhotoAnalysis> = {}): PhotoAnalysis {
  return {
    width: 1000, height: 1200, orientation: 'vertical', background: { uniform: true, color: '#F4F4F4', coverage: 0.95, transparent: false },
    subject: { x: 0.2, y: 0.1, w: 0.6, h: 0.8 }, dominant: ['#8B5E3C', '#222222'], brightness: 0.8,
    cutout: { ok: true, reason: null, mask: null, maskWidth: 0, maskHeight: 0 }, ...overrides,
  }
}

const product = (extra: Partial<PlanProduct> = {}): PlanProduct => ({
  id: 1, name: 'Nochero Luxury LED oro rosa con sensor de tacto', priceText: '$ 360.000', compareAtText: null, image: '/api/assets/stores/1/products/p1.webp', beforeAfter: null,
  reference: 'LM-105', category: 'Nocheros, cómodas y zapateros', discountPercent: null, gallery: [], ...extra,
})

function spec(format: string, style: string, layout: string, extra: Partial<PlanSpec> = {}, design: Partial<PlanSpec['design']> = {}): PlanSpec {
  const [width, height] = FORMATS[format]!
  return {
    kind: 'imagen', template: 'producto_destacado', format, quality: 'estandar', seconds: null, width, height, slides: 1, badge: null, products: [product()],
    brand: { name: 'Luz Mágica', slogan: null, logoUrl: '/api/assets/stores/1/logo.png', colors: ['#B76E79', '#1F2937'], font: null },
    storeUrl: null, copy: { headline: 'Nochero Luxury', description: 'Nochero con luz LED y sensor de tacto. Cajones con riel de metal.', benefits: [], cta: 'Pídelo por WhatsApp' },
    design: { style, layout, seed: 3, colors: null, showPrice: true, removeBg: true, showReference: true, ...design }, ...extra,
  }
}

function context(cut = true, analysis = photo()): DesignContext {
  return {
    photos: new Map([['/api/assets/stores/1/products/p1.webp', analysis], ['/api/assets/stores/1/products/p2.webp', photo({ width: 1200, height: 800, orientation: 'horizontal' })], ['/api/assets/stores/1/logo.png', photo({ width: 600, height: 300, background: { uniform: true, color: '#FFFFFF', coverage: 1, transparent: true } })]]),
    cutouts: new Set(cut ? ['/api/assets/stores/1/products/p1.webp', '/api/assets/stores/1/products/p2.webp'] : []),
    measure,
  }
}

const CASES: Array<{ name: string; extra?: Partial<PlanSpec>; ctx?: DesignContext; design?: Partial<PlanSpec['design']> }> = [
  { name: 'recorte' },
  { name: 'beneficios', extra: { copy: { headline: 'x', description: 'Nochero con luz LED y sensor de tacto.', benefits: ['Luz LED con sensor de tacto', 'Cajones con riel de metal'], cta: 'Pídelo por WhatsApp' } }, design: { objective: 'beneficios' } },
  { name: 'catálogo', design: { objective: 'catalogo' } },
  { name: 'colección sin recorte', ctx: context(false), design: { objective: 'coleccion' } },
  { name: 'oferta', design: { objective: 'promocion' }, extra: { template: 'oferta_aprobada', badge: '-50%', products: [product({ priceText: '$ 60.000', compareAtText: '$ 120.000', discountPercent: 50 })] } },
  { name: 'fondo liso sin recorte', ctx: context(false) },
  { name: 'foto compleja', ctx: context(false, photo({ background: { uniform: false, color: '#776655', coverage: 0.3, transparent: false }, subject: { x: 0, y: 0, w: 1, h: 1 }, cutout: { ok: false, reason: 'x', mask: null, maskWidth: 0, maskHeight: 0 } })) },
  { name: 'sin logo, nombre corto, precio oculto', extra: { brand: { name: 'X', slogan: null, logoUrl: null, colors: [], font: null }, products: [product({ name: 'Jeans AMIRI', category: null, reference: null })] }, design: { showPrice: false } },
  { name: 'nuevo con etiqueta larga', extra: { template: 'ultimas_unidades', badge: 'ÚLTIMAS UNIDADES', products: [product({ name: 'CAMISETA TOP QUALITY TIP ORIGINAL 300GRS', priceText: 'Desde $ 100.000' })] } },
]

describe('motor de diseño publicitario', () => {
  it('cada estilo, composición y formato pasa el control de calidad', async () => {
    const failures: string[] = []
    let total = 0
    for (const style of STYLE_KEYS) for (const layout of LAYOUT_KEYS) for (const format of Object.keys(FORMATS)) for (const item of CASES) {
      const s = spec(format, style, layout, item.extra, item.design)
      const ctx = item.ctx ?? context()
      const scene = composeDesign(s, 0, ctx)
      const report = checkScene(scene, s, 0, ctx)
      total++
      for (const check of report.checks) if (check.level === 'error') failures.push(`${style}/${layout}/${format}/${item.name}: ${check.message}`)
    }
    expect(total).toBe(STYLE_KEYS.length * LAYOUT_KEYS.length * 7 * CASES.length)
    if (failures.length && process.env.QA_DUMP) (await import('node:fs')).writeFileSync(process.env.QA_DUMP, failures.join(String.fromCharCode(10)))
    expect(failures.slice(0, 25), `${failures.length} fallos`).toEqual([])
  })

  it('las cinco variantes de un estilo son composiciones distintas, no la misma con otros colores', () => {
    for (const style of STYLE_KEYS) {
      const signatures = styleLayouts(style).map((layout) => {
        const scene = composeDesign(spec('vertical', style, layout), 0, context())
        const place = (role: string) => { const layer = scene.layers.find((item) => item.role === role); return layer ? `${Math.round(layer.x / 54)},${Math.round(layer.y / 54)},${Math.round(layer.w / 54)}` : '-' }
        return ['foto', 'nombre', 'precio', 'cta'].map(place).join('|')
      })
      expect(new Set(signatures).size, style).toBe(5)
    }
  })

  it('dibuja los datos exactos del catálogo y oculta el precio cuando se pide', () => {
    const ctx = context()
    const offer = spec('cuadrado', 'sneaker_impact', 'heroe', { template: 'oferta_aprobada', badge: '-50%', products: [product({ priceText: '$ 60.000', compareAtText: '$ 120.000' })] })
    const layers = composeDesign(offer, 0, ctx).layers
    const text = (role: string) => layers.filter((layer) => layer.role === role && (layer.type === 'text' || layer.type === 'pill')).map((layer) => (layer as { text: string }).text)
    expect(text('precio')).toEqual(['$ 60.000'])
    expect(text('precio_anterior')).toEqual(['$ 120.000'])
    expect(text('etiqueta')).toEqual(['-50%'])
    expect(text('referencia')).toEqual(['REF. LM-105'])
    const hidden = composeDesign(spec('cuadrado', 'soft_catalog', 'catalogo', {}, { showPrice: false }), 0, ctx).layers
    expect(hidden.some((layer) => layer.role === 'precio')).toBe(false)
  })

  it('usa el recorte solo cuando existe; si no, la foto original sin deformar', () => {
    const withCut = composeDesign(spec('vertical', 'clean_beauty', 'escenario'), 0, context(true)).layers.find((layer) => layer.role === 'foto')
    expect(withCut && withCut.type === 'image' && withCut.src.startsWith('cut:')).toBe(true)
    const noCut = composeDesign(spec('vertical', 'clean_beauty', 'escenario', {}, { removeBg: false }), 0, context(true)).layers.find((layer) => layer.role === 'foto')
    expect(noCut && noCut.type === 'image' && !noCut.src.startsWith('cut:') && noCut.matte === '#F4F4F4').toBe(true)
    // La caja del producto recortado respeta su proporción real.
    if (withCut) expect(Math.abs(withCut.w / withCut.h - (0.64 * 1000) / (0.84 * 1200))).toBeLessThan(0.02)
  })

  it('misma semilla, misma pieza; otra semilla, otra variante de decoración', () => {
    const a = JSON.stringify(composeDesign(spec('cuadrado', 'hype_drop', 'heroe'), 0, context()).layers)
    const b = JSON.stringify(composeDesign(spec('cuadrado', 'hype_drop', 'heroe'), 0, context()).layers)
    const c = JSON.stringify(composeDesign(spec('cuadrado', 'hype_drop', 'heroe', {}, { seed: 99 }), 0, context()).layers)
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })

  it('normaliza opciones desconocidas sin romper la pieza', () => {
    expect(normalizeDesign({ style: 'no-existe', layout: 'raro', seed: -5, colors: ['#zzzzzz', '#112233'] })).toEqual({ sector: 'calzado', objective: 'venta', style: 'sneaker_impact', layout: 'heroe', seed: 5, colors: ['#112233'], showPrice: true, removeBg: true, showReference: false })
    for (const key of STYLE_KEYS) expect(DESIGN_STYLES[key].layouts).toHaveLength(5)
  })
})

describe('dirección de arte por sector', () => {
  it('cinco familias con tres estilos cada una, de lenguaje visual distinto entre sí', () => {
    expect(SECTOR_KEYS).toHaveLength(5)
    expect(STYLE_KEYS).toHaveLength(15)
    for (const sector of SECTOR_KEYS) {
      const keys = stylesOf(sector)
      expect(keys, sector).toHaveLength(3)
      // Dos estilos de la misma familia difieren en al menos 4 de 7 decisiones de diseño.
      const traits = keys.map((key) => { const s = DESIGN_STYLES[key]; return [s.display.family, s.price.shape, s.cta, s.badge, s.layouts[0], s.background, s.decor.join('+')] })
      for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) expect(traits[i]!.filter((trait, index) => trait !== traits[j]![index]).length, `${keys[i]} vs ${keys[j]}`).toBeGreaterThanOrEqual(4)
    }
  })

  it('detecta el sector con las categorías y nombres reales', () => {
    expect(detectSector(['Calzado', 'NIKE TRAIL HOMBRE', 'Tenis Nord 02'])).toBe('calzado')
    expect(detectSector(['Espejos', 'Tocador Imperia', 'Puff corazón'])).toBe('hogar')
    expect(detectSector(['Ropa', 'Camiseta oversize', 'Hoodie negro'])).toBe('streetwear')
    expect(detectSector(['Sérum facial', 'Crema hidratante'])).toBe('belleza')
    expect(detectSector(['Vestido largo', 'Blusa de dama'])).toBe('moda')
    expect(detectSector(['xyz'])).toBeNull()
  })

  it('el objetivo cambia la jerarquía: en promoción el precio pesa más que en colección', () => {
    const size = (objective: string) => {
      const layers = composeDesign(spec('vertical', 'sneaker_impact', 'heroe', { template: 'oferta_aprobada', badge: '-50%', products: [product({ priceText: '$ 60.000', compareAtText: '$ 120.000' })] }, { objective }), 0, context()).layers
      return (layers.find((layer) => layer.role === 'precio' && layer.type === 'text') as { size: number }).size
    }
    expect(size('promocion')).toBeGreaterThan(size('coleccion'))
    for (const key of OBJECTIVE_KEYS) expect(size(key)).toBeGreaterThan(0)
  })

  it('beneficios: solo los que escribió el comercio; sin ellos no aparece ninguno', () => {
    const withBenefits = composeDesign(spec('vertical', 'clean_beauty', 'podio', { copy: { headline: 'x', description: '', benefits: ['Luz LED con sensor de tacto'], cta: 'Comprar' } }, { objective: 'beneficios' }), 0, context()).layers
    expect(withBenefits.filter((layer) => layer.role === 'beneficio').map((layer) => (layer as { text: string }).text)).toEqual(['Luz LED con sensor de tacto'])
    const none = composeDesign(spec('vertical', 'clean_beauty', 'podio', {}, { objective: 'beneficios' }), 0, context()).layers
    expect(none.some((layer) => layer.role === 'beneficio')).toBe(false)
  })
})

describe('ajuste de texto y encuadre', () => {
  it('reduce la letra hasta que el texto cabe; si no cabe ni al mínimo, lo marca', () => {
    const fit = fitText(measure, 'Un nombre de producto bastante largo para probar', { family: 'Inter', weight: 700, maxWidth: 400, maxLines: 2, maxSize: 80, minSize: 20 })
    expect(fit.truncated).toBe(false)
    expect(fit.lines.length).toBeLessThanOrEqual(2)
    expect(fit.size).toBeLessThan(80)
    const tight = fitText(measure, 'Texto imposible de encajar en un espacio diminuto de verdad', { family: 'Inter', weight: 700, maxWidth: 100, maxLines: 1, maxSize: 40, minSize: 20 })
    expect(tight.truncated).toBe(true)
    expect(tight.lines[0]!.endsWith('…')).toBe(true)
  })

  it('encaja sin deformar', () => {
    const box = containRect(2, { x: 0, y: 0, w: 400, h: 400 })
    expect(box).toEqual({ x: 0, y: 100, w: 400, h: 200 })
    expect(containRect(0.5, { x: 0, y: 0, w: 400, h: 400 }, 'bottom')).toEqual({ x: 100, y: 0, w: 200, h: 400 })
  })
})

describe('colores', () => {
  it('ajusta un color hasta lograr el contraste pedido sin cambiar su tono', () => {
    const fixed = ensureContrast('#F9A8D4', '#FFFFFF', 4.5)
    expect(contrastRatio(fixed, '#FFFFFF')).toBeGreaterThanOrEqual(4.5)
    const random = seededRandom(42)
    expect([random(), random()]).toEqual((() => { const again = seededRandom(42); return [again(), again()] })())
  })

  it('las paletas de los estilos tienen texto legible', () => {
    for (const key of STYLE_KEYS) for (const brand of [['#B76E79'], ['#FACC15', '#111827'], [], ['#FFFFFF']]) {
      const p = DESIGN_STYLES[key].palette({ brand, photo: ['#8B5E3C'], override: null })
      expect(contrastRatio(p.ink, p.bg), `${key} ${brand}`).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(p.price, p.bg), `${key} ${brand}`).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(p.onAccent, p.accent), `${key} ${brand}`).toBeGreaterThanOrEqual(3)
    }
  })
})

describe('análisis de la foto', () => {
  const synthetic = (w: number, h: number, paint: (x: number, y: number) => [number, number, number, number]) => {
    const data = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(paint(x, y), (y * w + x) * 4)
    return { width: w, height: h, data }
  }

  it('aísla un producto sobre fondo liso y encuentra su recuadro', () => {
    const pixels = synthetic(200, 240, (x, y) => (x >= 50 && x < 150 && y >= 40 && y < 200 ? [180, 40, 60, 255] : [245, 245, 245, 255]))
    const result = analyzePhoto(pixels)
    expect(result.background.uniform).toBe(true)
    expect(result.cutout.ok).toBe(true)
    expect(result.subject.x).toBeCloseTo(0.25, 2)
    expect(result.subject.w).toBeCloseTo(0.5, 2)
    expect(result.orientation).toBe('vertical')
    expect(result.dominant[0]).toBe('#B4283C')
  })

  it('conserva las zonas claras dentro del producto (no se vacían)', () => {
    const pixels = synthetic(200, 200, (x, y) => {
      const inside = x >= 40 && x < 160 && y >= 40 && y < 160
      const hole = x >= 80 && x < 120 && y >= 80 && y < 120
      return inside ? (hole ? [245, 245, 245, 255] : [20, 30, 90, 255]) : [245, 245, 245, 255]
    })
    const result = analyzePhoto(pixels)
    expect(result.cutout.ok).toBe(true)
    expect(result.cutout.mask![100 * 200 + 100]).toBe(255)
  })

  it('no recorta cuando el fondo no es uniforme o el producto se confunde con él', () => {
    const noisy = synthetic(160, 160, (x, y) => [(x * 37 + y * 11) % 255, (x * 13 + y * 29) % 255, (x * 7) % 255, 255])
    expect(analyzePhoto(noisy).cutout.ok).toBe(false)
    const similar = synthetic(160, 160, (x, y) => (x > 40 && x < 120 && y > 40 && y < 120 ? [232, 232, 232, 255] : [245, 245, 245, 255]))
    const result = analyzePhoto(similar)
    expect(result.cutout.ok).toBe(false)
  })

  it('respeta la transparencia de un PNG ya recortado', () => {
    const png = synthetic(100, 100, (x, y) => (x > 30 && x < 70 && y > 20 && y < 90 ? [10, 120, 60, 255] : [0, 0, 0, 0]))
    const result = analyzePhoto(png)
    expect(result.background.transparent).toBe(true)
    expect(result.cutout.ok).toBe(true)
  })
})
