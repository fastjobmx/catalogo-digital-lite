// Agrega las corridas del banco multimodal (multimodal-real-1.json … o multimodal-simulado.json).
// Uso: node scripts/agent-media-bank-runs.mjs <carpeta> [--fallos]
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const [dir, ...flags] = process.argv.slice(2)
const real = readdirSync(dir).filter((name) => /^multimodal-real(-\d+)?\.json$/.test(name)).sort()
const files = real.length ? real : readdirSync(dir).filter((name) => name === 'multimodal-simulado.json')
const runs = files.map((name) => JSON.parse(readFileSync(join(dir, name), 'utf8')))
const percentile = (values, p) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0 }
const usd = (micros) => (micros / 1e6).toFixed(5)

console.log(`${files.length} corrida(s): ${files.join(', ')}`)
for (const engine of ['anterior', 'nueva']) {
  const perRun = runs.map((run) => run.filter((row) => row.engine === engine))
  const total = perRun[0].length
  const passes = perRun.map((rows) => rows.filter((row) => row.pass).length)
  const critical = perRun.map((rows) => `${rows.filter((row) => row.critical && row.pass).length}/${rows.filter((row) => row.critical).length}`)
  const ux = perRun.map((rows) => rows.filter((row) => row.ux).length)
  const cases = perRun.flat()
  const turns = cases.flatMap((row) => row.turns)
  const acks = cases.map((row) => row.firstAckMs).filter((value) => value !== null)
  const costs = cases.map((row) => row.costMicros)
  const withAi = cases.filter((row) => row.costMicros > 0)
  console.log(`\nflujo ${engine} · ${total} escenarios`)
  console.log(`  aciertos por corrida: ${passes.join(', ')} → promedio ${(passes.reduce((a, b) => a + b, 0) / passes.length).toFixed(1)}/${total}, peor ${Math.min(...passes)}/${total}`)
  console.log(`  críticos por corrida: ${critical.join(', ')} · experiencia: ${ux.join(', ')}`)
  console.log(`  latencia por mensaje (${turns.length}): p50 ${percentile(turns.map((turn) => turn.ms), 0.5)} ms · p95 ${percentile(turns.map((turn) => turn.ms), 0.95)} ms · máx ${Math.max(...turns.map((turn) => turn.ms))} ms`)
  console.log(`  primer acuse tras la primera foto (${acks.length}): p50 ${percentile(acks, 0.5)} ms · p95 ${percentile(acks, 0.95)} ms`)
  console.log(`  costo por lote (todos los escenarios): promedio US$ ${usd(costs.reduce((a, b) => a + b, 0) / costs.length)} · máx US$ ${usd(Math.max(...costs))}`)
  console.log(`  costo por lote (solo los ${withAi.length} que usaron IA): promedio US$ ${usd(withAi.reduce((sum, row) => sum + row.costMicros, 0) / Math.max(1, withAi.length))} · llamadas al modelo por escenario: ${(cases.reduce((sum, row) => sum + row.modelCalls, 0) / cases.length).toFixed(1)}`)
  const failed = {}
  perRun.forEach((rows, index) => rows.filter((row) => !row.pass).forEach((row) => { (failed[row.id] ||= []).push(index + 1) }))
  if (Object.keys(failed).length) console.log(`  fallos: ${Object.entries(failed).map(([id, where]) => `${id}${row(perRun, id).critical ? '*' : ''} (corrida ${where.join(', ')})`).join(' · ')}`)
  if (flags.includes('--fallos') && engine === 'nueva') {
    perRun.forEach((rows, index) => rows.filter((item) => !item.pass || !item.ux).forEach((item) => {
      console.log(`\n  ## ${item.id} · corrida ${index + 1}`)
      for (const turn of item.turns) {
        console.log(`    > ${turn.input}`)
        for (const reply of turn.replies) console.log(`      < ${reply.replace(/\n/g, ' ⏎ ').slice(0, 320)}`)
        if (turn.failures.length || turn.uxFailures.length) console.log(`      !! ${[...turn.failures, ...turn.uxFailures].join(' | ')}`)
      }
    }))
  }
}
// The comparison that matters: any scenario where the previous flow passes and the new one fails.
const worse = new Set()
runs.forEach((run) => run.filter((item) => item.engine === 'nueva' && !item.pass).forEach((item) => { if (run.find((other) => other.engine === 'anterior' && other.id === item.id)?.pass) worse.add(item.id) }))
console.log(`\nanterior acierta y nueva falla: ${worse.size ? [...worse].join(', ') : 'ninguno'}`)

function row(perRun, id) { return perRun[0].find((item) => item.id === id) }
