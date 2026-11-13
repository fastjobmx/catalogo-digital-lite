import { describe, expect, it } from 'vitest'
import type { Layer, PlanProduct, PlanSpec } from '../scene'
import { composeDesign, type DesignContext } from './compose'
import type { PhotoAnalysis } from './photo'
import { checkScene } from './qa'
import { MAX_VIDEO_SECONDS, MIN_VIDEO_SECONDS, VIDEO_TEMPLATES, VIDEO_TEMPLATE_KEYS, outroScene, timeline, videoPasses, type Pass } from './video'

const measure = (text: string, font: string) => text.length * Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 16) * 0.55
const photo: PhotoAnalysis = { width: 1000, height: 1000, orientation: 'cuadrada', background: { uniform: true, color: '#F4F4F4', coverage: 1, transparent: false }, subject: { x: 0.1, y: 0.2, w: 0.8, h: 0.6 }, dominant: ['#1D4ED8'], brightness: 0.8, cutout: { ok: true, reason: null, mask: null, maskWidth: 0, maskHeight: 0 } }
const ctx: DesignContext = { photos: new Map([['/p1.jpg', photo], ['/p2.jpg', photo], ['/p3.jpg', photo]]), cutouts: new Set(['/p1.jpg']), measure }
const product = (extra: Partial<PlanProduct> = {}): PlanProduct => ({ id: 1, name: 'Tenis Nord 02', priceText: '$ 259.900', compareAtText: null, image: '/p1.jpg', beforeAfter: null, reference: 'NORD-02', category: 'Calzado', gallery: ['/p1.jpg', '/p2.jpg', '/p3.jpg'], ...extra })
const spec = (video: string, seconds = 10, extra: Partial<PlanSpec> = {}): PlanSpec => ({
  kind: 'video', template: 'producto_destacado', format: 'historia', quality: 'estandar', seconds, width: 1080, height: 1920, slides: 1, badge: null, products: [product()],
  brand: { name: 'SneakerHub', slogan: null, logoUrl: null, colors: ['#2563EB'], font: null }, storeUrl: null,
  copy: { headline: 'x', description: '', benefits: [], cta: 'Pídelo por WhatsApp' },
  design: { sector: 'calzado', objective: 'venta', style: 'sneaker_impact', layout: 'heroe', seed: 4, colors: null, showPrice: true, removeBg: true, showReference: false, video }, ...extra,
})
const build = (s: PlanSpec, n: number) => composeDesign(s, n, ctx).layers
const signature = (passes: Pass[]) => JSON.stringify(passes.map((pass) => [pass.alpha ?? 1, Math.round(pass.dx ?? 0), Math.round((pass.zoom ?? 1) * 100), Math.round((pass.clip ?? 1) * 100), pass.layers.filter((l) => l.role !== 'fondo').map((l) => [l.role, Math.round(l.opacity * 100), Math.round((l.scale ?? 1) * 100), Math.round(l.offsetX ?? 0), Math.round(l.offsetY), Math.round(l.turn ?? 0), Math.round((l.wipe ?? 1) * 100)])]))

describe('motor de video', () => {
  it('diez plantillas, cada una con movimiento propio', () => {
    expect(VIDEO_TEMPLATE_KEYS).toHaveLength(10)
    const at = [0.3, 1.2, 2.2, 3.5, 6, 9.4]
    const signatures = VIDEO_TEMPLATE_KEYS.map((key) => at.map((t) => signature(videoPasses(spec(key), t, ctx, build))).join('|'))
    expect(new Set(signatures).size).toBe(10)
  })

  it('reparte el tiempo en intro, escenas y cierre para 8, 10, 12 y 15 segundos', () => {
    for (const seconds of [8, 10, 12, 15, MIN_VIDEO_SECONDS, MAX_VIDEO_SECONDS]) for (const key of VIDEO_TEMPLATE_KEYS) {
      const line = timeline(spec(key, seconds))
      expect(line.intro + line.segment * line.segments + line.outro, `${key} ${seconds}`).toBeCloseTo(seconds, 5)
      expect(line.segment, `${key} ${seconds}`).toBeGreaterThan(1.5)
    }
  })

  it('es determinista: el mismo segundo da el mismo cuadro', () => {
    for (const key of VIDEO_TEMPLATE_KEYS) expect(signature(videoPasses(spec(key), 4.2, ctx, build))).toBe(signature(videoPasses(spec(key), 4.2, ctx, build)))
  })

  it('al final de la escena principal todos los datos son visibles y exactos; termina con logo o marca y botón', () => {
    for (const key of VIDEO_TEMPLATE_KEYS) {
      const s = spec(key)
      const line = timeline(s)
      const passes = videoPasses(s, line.intro + line.segment - 0.05, ctx, build)
      const layers = passes[passes.length - 1]!.layers
      const price = layers.find((l) => l.role === 'precio' && l.type === 'text') as Extract<Layer, { type: 'text' }>
      expect(price.text, key).toBe('$ 259.900')
      expect(price.opacity, key).toBeGreaterThan(0.95)
      const outro = outroScene(s, ctx)
      expect(outro.some((l) => l.role === 'cta'), key).toBe(true)
      expect(outro.some((l) => l.role === 'marca' || l.role === 'logo' || l.role === 'nombre'), key).toBe(true)
    }
  })

  it('«Descuento especial» tacha el precio anterior antes de mostrar el nuevo, solo si el descuento es real', () => {
    const offer = spec('descuento_especial', 10, { template: 'oferta_aprobada', badge: '-20%', products: [product({ priceText: '$ 80.000', compareAtText: '$ 100.000' })] })
    const line = timeline(offer)
    const early = videoPasses(offer, line.intro + 0.95, ctx, build).at(-1)!.layers
    const late = videoPasses(offer, line.intro + 2.5, ctx, build).at(-1)!.layers
    const before = (layers: Layer[]) => layers.find((l) => l.role === 'precio_anterior') as Extract<Layer, { type: 'text' }>
    expect(before(early).opacity).toBeGreaterThan(0)
    expect(before(early).strike).toBe(false)
    expect(before(late).strike).toBe(true)
    expect(late.find((l) => l.role === 'precio')!.opacity).toBeGreaterThan(0)
  })

  it('«Catálogo animado» recorre las fotos reales del producto', () => {
    const s = spec('catalogo_animado', 12)
    const line = timeline(s)
    expect(line.segments).toBe(3)
    const photos = [0, 1, 2].map((index) => videoPasses(s, line.intro + line.segment * index + line.segment / 2, ctx, build).at(-1)!.layers.find((l) => l.role === 'foto' && l.type === 'image') as Extract<Layer, { type: 'image' }>)
    expect(photos.map((layer) => layer.src)).toEqual(['cut:/p1.jpg', '/p2.jpg', '/p3.jpg'])
  })

  it('la escena final de cada plantilla pasa el control de calidad', () => {
    for (const key of VIDEO_TEMPLATE_KEYS) {
      const s = spec(key)
      const report = checkScene({ width: 1080, height: 1920, font: 'Inter', layers: composeDesign(s, 0, ctx).layers }, s, 0, ctx)
      expect(report.checks.filter((c) => c.level === 'error'), key).toEqual([])
    }
    expect(Object.values(VIDEO_TEMPLATES).every((tpl) => tpl.music.bpm >= 60 && tpl.music.bpm <= 150)).toBe(true)
  })
})
