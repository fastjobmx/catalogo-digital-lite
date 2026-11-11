import { describe, expect, it } from 'vitest'
import { buildCatalog, isRetiredModel, parseExtraModels, routeTask, taskAvailability } from './aiRouter'

describe('enrutador de IA', () => {
  it('usa los modelos Gemini ya configurados sin cambiarlos', () => {
    const catalog = buildCatalog({ GEMINI_MODEL: 'gemini-3.8-flash', GEMINI_IMAGE_MODEL: 'gemini-3.1-flash-image' })
    const decision = routeTask(catalog, { task: 'edicion_foto' }, { GEMINI_API_KEY: true })
    expect(decision).toMatchObject({ ok: true, entry: { provider: 'gemini', model: 'gemini-3.1-flash-image' } })
    expect(routeTask(catalog, { task: 'texto' }, { GEMINI_API_KEY: true })).toMatchObject({ ok: true, entry: { model: 'gemini-3.8-flash' } })
  })

  it('no ofrece tareas sin modelo, sin credencial o con modelos descontinuados', () => {
    const catalog = buildCatalog({})
    expect(routeTask(catalog, { task: 'video' }, { GEMINI_API_KEY: true })).toMatchObject({ ok: false, reason: 'sin_modelo' })
    expect(routeTask(catalog, { task: 'render' }, {})).toMatchObject({ ok: false, reason: 'sin_modelo' })
    expect(routeTask(catalog, { task: 'texto' }, {})).toMatchObject({ ok: false, reason: 'sin_credencial' })
    expect(routeTask(buildCatalog({ GEMINI_MODEL: 'gemini-2.0-flash' }), { task: 'texto' }, { GEMINI_API_KEY: true })).toMatchObject({ ok: false, reason: 'descontinuado' })
    expect(isRetiredModel('imagen-4.0-generate-001')).toBe(true)
    expect(routeTask(buildCatalog({ GEMINI_MODEL: 'gemini-3.1-pro-preview' }), { task: 'texto' }, { GEMINI_API_KEY: true })).toMatchObject({ ok: false, reason: 'descontinuado' })
    expect(routeTask(buildCatalog({ GEMINI_MODEL: 'gemini-3.1-pro-preview' }), { task: 'texto', allowPreview: true }, { GEMINI_API_KEY: true })).toMatchObject({ ok: true })
  })

  it('elige por costo, calidad, latencia y resolución entre entradas configuradas', () => {
    const extra = JSON.stringify([
      { provider: 'p1', model: 'video-alta', tasks: ['video'], requiresSecret: 'P1_KEY', quality: 3, latency: 3, unitCostMicros: 900, maxResolution: 1920 },
      { provider: 'p2', model: 'video-barato', tasks: ['video'], requiresSecret: 'P2_KEY', quality: 1, latency: 1, unitCostMicros: 100, maxResolution: 720 },
      { provider: 'x', model: 'malo', tasks: ['inexistente'] },
      { provider: 'p3', model: 'apagado', tasks: ['video'], enabled: false },
    ])
    const catalog = buildCatalog({ CREATIVE_AI_MODELS: extra })
    const secrets = { P1_KEY: true, P2_KEY: true }
    expect(routeTask(catalog, { task: 'video' }, secrets)).toMatchObject({ ok: true, entry: { model: 'video-alta' } })
    expect(routeTask(catalog, { task: 'video', prefer: 'costo' }, secrets)).toMatchObject({ ok: true, entry: { model: 'video-barato' } })
    expect(routeTask(catalog, { task: 'video', prefer: 'latencia' }, secrets)).toMatchObject({ ok: true, entry: { model: 'video-barato' } })
    expect(routeTask(catalog, { task: 'video', minResolution: 1080, prefer: 'costo' }, secrets)).toMatchObject({ ok: true, entry: { model: 'video-alta' } })
    expect(routeTask(catalog, { task: 'video', minResolution: 4000 }, secrets)).toMatchObject({ ok: false, reason: 'requisitos' })
    expect(routeTask(catalog, { task: 'video' }, { P2_KEY: true })).toMatchObject({ ok: true, entry: { model: 'video-barato' } })
    expect(parseExtraModels('no-json')).toEqual([])
  })

  it('resume la disponibilidad sin exponer secretos', () => {
    const summary = taskAvailability({ GEMINI_API_KEY: 'secreto-real', GEMINI_IMAGE_MODEL: 'gemini-3.1-flash-image' })
    expect(JSON.stringify(summary)).not.toContain('secreto-real')
    expect(summary.find((t) => t.task === 'imagen')?.available).toBe(true)
    expect(summary.find((t) => t.task === 'video')?.available).toBe(false)
  })
})
