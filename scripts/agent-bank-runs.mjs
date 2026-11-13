// Agrega varias corridas reales del banco (banco-real-1.json … banco-real-N.json).
// Uso: node scripts/agent-bank-runs.mjs <carpeta> [--fallos]
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const [dir, ...flags] = process.argv.slice(2)
const files = readdirSync(dir).filter((name) => /^banco-real-\d+\.json$/.test(name)).sort()
const runs = files.map((name) => JSON.parse(readFileSync(join(dir, name), 'utf8')))
const percentile = (values, p) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0 }
const usesAi = (turn) => (turn.plans || []).length > 0 || turn.ms > 400

for (const set of ['banco', 'reserva']) {
  for (const engine of ['anterior', 'nueva']) {
    const perRun = runs.map((run) => run.filter((result) => (result.set || 'banco') === set && result.engine === engine)).filter((rows) => rows.length)
    if (!perRun.length) continue
    const total = perRun[0].length
    const passes = perRun.map((rows) => rows.filter((row) => row.pass).length)
    const critical = perRun.map((rows) => `${rows.filter((row) => row.critical && row.pass).length}/${rows.filter((row) => row.critical).length}`)
    const turns = perRun.flatMap((rows) => rows.flatMap((row) => row.turns))
    const ai = turns.filter(usesAi)
    const cost = perRun.reduce((sum, rows) => sum + rows.reduce((inner, row) => inner + row.costMicros, 0), 0) / 1e6
    console.log(`\n${set} · motor ${engine} · ${perRun.length} corrida(s) de ${total} conversaciones`)
    console.log(`  aciertos por corrida: ${passes.join(', ')}  → promedio ${(passes.reduce((a, b) => a + b, 0) / passes.length).toFixed(1)}/${total}, peor ${Math.min(...passes)}/${total}`)
    console.log(`  críticos por corrida: ${critical.join(', ')}`)
    console.log(`  mensajes: ${turns.length} · con IA: ${ai.length} (${Math.round(ai.length * 100 / turns.length)} %)`)
    console.log(`  latencia todos los mensajes: p50 ${percentile(turns.map((turn) => turn.ms), 0.5)} ms · p95 ${percentile(turns.map((turn) => turn.ms), 0.95)} ms`)
    console.log(`  latencia mensajes con IA:    p50 ${percentile(ai.map((turn) => turn.ms), 0.5)} ms · p95 ${percentile(ai.map((turn) => turn.ms), 0.95)} ms · máx ${Math.max(0, ...ai.map((turn) => turn.ms))} ms`)
    console.log(`  costo: US$ ${cost.toFixed(4)} · por mensaje (todos) US$ ${(cost / turns.length).toFixed(5)} · por mensaje que usa IA US$ ${(cost / Math.max(1, ai.length)).toFixed(5)}`)
    const failed = {}
    perRun.forEach((rows, index) => rows.filter((row) => !row.pass).forEach((row) => { (failed[row.id] ||= []).push(index + 1) }))
    if (Object.keys(failed).length) console.log(`  fallos: ${Object.entries(failed).map(([id, where]) => `${id} (corrida ${where.join(', ')})`).join(' · ')}`)
    if (flags.includes('--fallos')) {
      perRun.forEach((rows, index) => rows.filter((row) => !row.pass).forEach((row) => {
        console.log(`\n  ## ${row.id} · corrida ${index + 1}`)
        for (const turn of row.turns) {
          console.log(`    > ${turn.input}`)
          for (const plan of turn.plans || []) console.log(`      · modelo: ${plan.replace(/\s+/g, ' ').replace(/^(\d+ ms) · \{.*?\} · /, '$1 · ').slice(0, 420)}`)
          for (const reply of turn.replies) console.log(`      < ${reply.replace(/\n/g, ' ⏎ ').slice(0, 320)}`)
          if (turn.failures.length) console.log(`      !! ${turn.failures.join(' | ')}`)
        }
      }))
    }
  }
}
