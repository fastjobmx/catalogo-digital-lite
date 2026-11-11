/** Prueba MANUAL del estudio fotográfico contra el modelo de imagen real. No corre en la suite normal:
 * solo con RUN_REAL_AI=1 (gasta cuota de la clave local de worker/.dev.vars; nunca la imprime).
 *
 *   cd worker && RUN_REAL_AI=1 npx vitest run src/testing/photo-real.test.ts
 *
 * Usa el Worker real (rutas, créditos, biblioteca) sobre SQLite y R2 en memoria: no toca producción.
 * Deja el antes/después y un informe de costos en docs/capturas-estudio-fotografico/. */
import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHarness, createStoreUser, seedStore, superadminToken, userToken } from './harness'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..', '..')
const OUT = join(root, 'docs', 'capturas-estudio-fotografico')
const SEED = join(root, 'frontend', 'public', 'seed-images')
const MODEL = process.env.REAL_IMAGE_MODEL || 'gemini-3.1-flash-image'
/** Precio de salida configurado en producción para el modelo de imagen (micro-USD por millón de tokens). */
const IMAGE_OUTPUT_PRICE = '60000000'

/** Casos: condición de la foto → archivo de ejemplo → operación. `prepared` son variantes generadas con
 * scripts/… (oscurecida) y guardadas en OUT antes de correr. */
const CASES: Array<{ id: string; condition: string; file: string; operation: string }> = [
  { id: '01-fondo-complejo', condition: 'Fondo complejo con varios objetos', file: join(SEED, 'sneakerhub', 'KINETIK-05.jpg'), operation: 'fondo_blanco' },
  { id: '02-mala-iluminacion', condition: 'Mala iluminación (foto oscura)', file: join(SEED, 'tecnocell-demo', 'wireless-earbuds.jpg'), operation: 'fondo_blanco' },
  { id: '03-texto-y-manos', condition: 'Texto en empaque y manos (objetos ajenos)', file: join(SEED, 'patitas', 'treats.jpg'), operation: 'quitar_objetos' },
  { id: '04-colores-similares', condition: 'Producto y fondo de colores similares', file: join(SEED, 'sneakerhub', 'VANTA-01.jpg'), operation: 'fondo_blanco' },
  { id: '05-estampados', condition: 'Estampados (rayas de colores)', file: join(SEED, 'sneakerhub', 'VANTA-18.jpg'), operation: 'fondo_blanco' },
  { id: '06-reflejos', condition: 'Reflejos (metal brillante)', file: join(SEED, 'patitas', 'pet-bowl.jpg'), operation: 'sombra_natural' },
  { id: '07-variantes', condition: 'Variantes (tres colores en una foto)', file: join(SEED, 'sneakerhub', 'NORD-14.jpg'), operation: 'fondo_blanco' },
  { id: '08-oscurecida', condition: 'Subexpuesta (oscurecida a propósito)', file: join(OUT, '_entrada-oscurecida.jpg'), operation: 'iluminacion_estudio' },
  { id: '09-premium-escenario', condition: 'Packshot limpio → escenario comercial (nivel C)', file: join(SEED, 'sneakerhub', 'NORD-02.jpg'), operation: 'escenario_comercial' },
  { id: '10-premium-editorial', condition: 'Fondo de calle → luz editorial (nivel C)', file: join(SEED, 'sneakerhub', 'VOLTA-21.jpg'), operation: 'editorial' },
]

function localKey(): string {
  const file = join(root, 'worker', '.dev.vars')
  if (!existsSync(file)) return ''
  return readFileSync(file, 'utf8').match(/^GEMINI_API_KEY\s*=\s*"?([^"\r\n]+)"?/m)?.[1] || ''
}

describe.runIf(process.env.RUN_REAL_AI === '1')('estudio fotográfico con el modelo real (manual)', () => {
  it('procesa fotos reales, guarda antes/después y mide el costo', async () => {
    const key = localKey()
    expect(key, 'Falta GEMINI_API_KEY en worker/.dev.vars').not.toBe('')
    mkdirSync(OUT, { recursive: true })
    const h = createHarness({ GEMINI_API_KEY: key, GEMINI_IMAGE_MODEL: MODEL, GEMINI_IMAGE_PRICE_OUTPUT_MICROS_PER_MTOK: IMAGE_OUTPUT_PRICE })
    const admin = await superadminToken()
    const store = await seedStore(h.db, { slug: 'prueba-real', name: 'Prueba real' })
    h.db.query('UPDATE stores SET ai_monthly_budget_micros = 50000000 WHERE id = ?', store)
    const owner = await userToken(await createStoreUser(h.db, { email: 'real@tiendas.test', storeId: store, role: 'owner' }), 'real@tiendas.test')
    const api = (path: string, init: Parameters<typeof h.request>[1] = {}) => h.request(`/api/creative${path}`, { store: 'prueba-real', token: owner, ...init })
    const json = async (response: Response) => response.json() as Promise<any>
    for (const [feature, credits] of [['foto_packshot', 2], ['foto_premium', 5]] as const) await h.request(`/api/platform/credits/costs/${feature}`, { method: 'PUT', token: admin, body: { credits, enabled: true } })
    await h.request('/api/platform/stores/prueba-real/credits', { method: 'POST', token: admin, headers: { 'Idempotency-Key': 'recarga-prueba-real' }, body: { kind: 'recarga', amount: 100, reason: 'Prueba' } })

    // Subida de originales (y un archivo repetido, que no debe duplicarse).
    const assets: Record<string, any> = {}
    for (const item of CASES) {
      const bytes = readFileSync(item.file)
      const form = new FormData()
      form.append('file', new File([bytes], 'foto.jpg', { type: 'image/jpeg' }))
      const response = await api('/assets', { method: 'POST', body: form })
      expect(response.status, item.id).toBe(201)
      assets[item.id] = (await json(response)).asset
      writeFileSync(join(OUT, `${item.id}-antes.jpg`), bytes)
    }
    const repeat = new FormData()
    repeat.append('file', new File([readFileSync(CASES[0]!.file)], 'otra-vez.jpg', { type: 'image/jpeg' }))
    const repeated = await json(await api('/assets', { method: 'POST', body: repeat }))
    expect(repeated).toMatchObject({ duplicate: true, asset: { id: assets[CASES[0]!.id].id } })

    const report: any[] = []
    // Un lote por operación (como lo haría el panel), ejecutando trabajo por trabajo.
    const byOperation = new Map<string, typeof CASES>()
    const only = (process.env.REAL_ONLY || '').split(',').filter(Boolean)
    const cases = only.length ? CASES.filter((item) => only.some((prefix) => item.id.startsWith(prefix))) : CASES
    for (const item of cases) byOperation.set(item.operation, [...(byOperation.get(item.operation) || []), item])
    for (const [operation, items] of byOperation) {
      const quote = await json(await api('/photo/quote', { method: 'POST', body: { operation, count: items.length } }))
      const batch = await json(await api('/photo/batches', { method: 'POST', headers: { 'Idempotency-Key': `real-${operation}-${Date.now()}` }, body: { operation, items: items.map((item) => ({ assetId: assets[item.id].id })), confirmCredits: quote.totalCredits } }))
      expect(batch.total, operation).toBe(items.length)
      for (const [index, job] of batch.jobs.entries()) {
        const item = items[index]!
        const started = Date.now()
        const done = await json(await api(`/jobs/${job.id}/run`, { method: 'POST' }))
        const seconds = Math.round((Date.now() - started) / 100) / 10
        const usage = (h.db.query('SELECT model, status, prompt_tokens, output_tokens, estimated_cost_micros FROM ai_usage_events ORDER BY id DESC LIMIT 1') as any[])[0]
        const entry: any = { id: item.id, condition: item.condition, operation, level: quote.level, status: done.status, errorCode: done.errorCode, seconds, credits: done.result?.credits ?? 0, model: usage?.model, promptTokens: usage?.prompt_tokens, outputTokens: usage?.output_tokens, costMicros: usage?.estimated_cost_micros, input: { width: assets[item.id].width, height: assets[item.id].height, bytes: assets[item.id].bytes } }
        if (done.status === 'completado') {
          const result = await json(await api(`/assets/${done.result.assetId}`))
          const file = new Uint8Array(await (await api(`/assets/${result.id}/file`)).arrayBuffer())
          const extension = result.contentType === 'image/png' ? 'png' : result.contentType === 'image/webp' ? 'webp' : 'jpg'
          writeFileSync(join(OUT, `${item.id}-despues.${extension}`), file)
          entry.output = { width: result.width, height: result.height, bytes: result.bytes, type: result.contentType, file: `${item.id}-despues.${extension}` }
        }
        report.push(entry)
        console.log(JSON.stringify(entry))
      }
    }
    const credits = await json(await h.request('/api/admin/credits', { store: 'prueba-real', token: owner }))
    const summary = {
      date: new Date().toISOString(), model: MODEL, pricing: { imageOutputMicrosPerMTok: Number(IMAGE_OUTPUT_PRICE), inputMicrosPerMTok: 300000 },
      totals: {
        photos: report.length, ok: report.filter((r) => r.status === 'completado').length, failed: report.filter((r) => r.status !== 'completado').length,
        costMicros: report.reduce((sum, r) => sum + (r.status === 'completado' ? Number(r.costMicros || 0) : 0), 0),
        creditsCharged: report.reduce((sum, r) => sum + Number(r.credits || 0), 0), balanceAfter: credits.balance,
      },
      duplicateUploadDetected: repeated.duplicate, results: report,
    }
    writeFileSync(join(OUT, only.length ? `informe-${only.join('-')}.json` : 'informe.json'), JSON.stringify(summary, null, 2))
    expect(summary.totals.ok + summary.totals.failed).toBe(cases.length)
    // Lo cobrado coincide exactamente con lo que salió bien.
    expect(100 - credits.balance).toBe(summary.totals.creditsCharged)
  }, 900_000)
})
