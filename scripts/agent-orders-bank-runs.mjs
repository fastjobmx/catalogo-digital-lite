// Agrega las corridas del banco de pedidos y reportes (pedidos-real-1.json … o pedidos-simulado.json).
// Uso: node scripts/agent-orders-bank-runs.mjs <carpeta> [--fallos] [--conversaciones id1,id2]
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const [dir, ...flags] = process.argv.slice(2)
const real = readdirSync(dir).filter((name) => /^pedidos-real(-\d+)?\.json$/.test(name)).sort()
const files = real.length ? real : readdirSync(dir).filter((name) => name === 'pedidos-simulado.json')
const runs = files.map((name) => JSON.parse(readFileSync(join(dir, name), 'utf8')))
const percentile = (values, p) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0 }

console.log(`${files.length} corrida(s): ${files.join(', ')}`)
for (const engine of ['anterior', 'nueva']) {
  const perRun = runs.map((run) => run.filter((row) => row.engine === engine))
  const total = perRun[0].length
  const passes = perRun.map((rows) => rows.filter((row) => row.pass).length)
  const critical = perRun.map((rows) => `${rows.filter((row) => row.critical && row.pass).length}/${rows.filter((row) => row.critical).length}`)
  const ux = perRun.map((rows) => rows.filter((row) => row.ux).length)
  const cases = perRun.flat()
  const turns = cases.flatMap((row) => row.turns)
  const ai = turns.filter((turn) => turn.ai)
  const cost = cases.reduce((sum, row) => sum + row.costMicros, 0) / 1e6
  console.log(`\nflujo ${engine} · ${total} conversaciones`)
  console.log(`  aciertos por corrida: ${passes.join(', ')} → promedio ${(passes.reduce((a, b) => a + b, 0) / passes.length).toFixed(1)}/${total}, peor ${Math.min(...passes)}/${total}`)
  console.log(`  críticos por corrida: ${critical.join(', ')} · experiencia: ${ux.join(', ')}`)
  console.log(`  mensajes: ${turns.length} · con IA: ${ai.length} (${Math.round(ai.length * 100 / turns.length)} %)`)
  console.log(`  latencia todos los mensajes: p50 ${percentile(turns.map((turn) => turn.ms), 0.5)} ms · p95 ${percentile(turns.map((turn) => turn.ms), 0.95)} ms`)
  console.log(`  latencia mensajes con IA:    p50 ${percentile(ai.map((turn) => turn.ms), 0.5)} ms · p95 ${percentile(ai.map((turn) => turn.ms), 0.95)} ms · máx ${Math.max(0, ...ai.map((turn) => turn.ms))} ms`)
  console.log(`  costo: US$ ${cost.toFixed(4)} · por mensaje (todos) US$ ${(cost / turns.length).toFixed(5)} · por mensaje que usa IA US$ ${(cost / Math.max(1, ai.length)).toFixed(5)}`)
  const failed = {}
  perRun.forEach((rows, index) => rows.filter((row) => !row.pass).forEach((row) => { (failed[`${row.id}${row.critical ? '*' : ''}`] ||= []).push(index + 1) }))
  if (Object.keys(failed).length) console.log(`  fallos (* = crítico): ${Object.entries(failed).map(([id, where]) => `${id} (${where.join(', ')})`).join(' · ')}`)
  if (flags.includes('--fallos') && engine === 'nueva') {
    perRun.forEach((rows, index) => rows.filter((item) => !item.pass || !item.ux).forEach((item) => {
      console.log(`\n  ## ${item.id} · corrida ${index + 1}`)
      print(item)
    }))
  }
}
const worse = new Set()
runs.forEach((run) => run.filter((item) => item.engine === 'nueva' && !item.pass).forEach((item) => { if (run.find((other) => other.engine === 'anterior' && other.id === item.id)?.pass) worse.add(item.id) }))
console.log(`\nanterior acierta y nueva falla: ${worse.size ? [...worse].join(', ') : 'ninguno'}`)

const wanted = flags.includes('--conversaciones') ? (flags[flags.indexOf('--conversaciones') + 1] || '').split(',') : []
for (const id of wanted) for (const engine of ['anterior', 'nueva']) {
  const item = runs[0].find((row) => row.id === id && row.engine === engine)
  if (!item) continue
  console.log(`\n## ${id} · ${engine}`)
  print(item)
}

function print(item) {
  for (const turn of item.turns) {
    console.log(`    > ${turn.input}`)
    for (const reply of turn.replies) console.log(`      < ${reply.replace(/\n/g, ' ⏎ ').slice(0, 420)}`)
    if (turn.failures.length || turn.uxFailures.length) console.log(`      !! ${[...turn.failures, ...turn.uxFailures].join(' | ')}`)
  }
}
