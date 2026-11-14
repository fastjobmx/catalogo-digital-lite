// Resume un informe del banco de conversaciones (banco-real.json o banco-simulado.json).
// Uso: node scripts/agent-bank-report.mjs <informe.json> [--fallos] [--caso <id>]
import { readFileSync } from 'node:fs'

const [file, ...flags] = process.argv.slice(2)
const results = JSON.parse(readFileSync(file, 'utf8'))
const engines = [...new Set(results.map((result) => result.engine))]
const percentile = (values, p) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0 }

console.log('motor     | casos | datos y seguridad | críticos | experiencia | llamadas IA | costo US$ | costo/mensaje | p50 ms | p95 ms')
for (const engine of engines) {
  const rows = results.filter((result) => result.engine === engine)
  const turns = rows.flatMap((row) => row.turns)
  const critical = rows.filter((row) => row.critical)
  const cost = rows.reduce((sum, row) => sum + row.costMicros, 0) / 1e6
  console.log([
    engine.padEnd(9), String(rows.length).padStart(5), `${rows.filter((row) => row.pass).length}/${rows.length}`.padStart(17),
    `${critical.filter((row) => row.pass).length}/${critical.length}`.padStart(8), `${rows.filter((row) => row.pass && row.ux).length}/${rows.length}`.padStart(11),
    String(rows.reduce((sum, row) => sum + row.modelCalls, 0)).padStart(11), cost.toFixed(4).padStart(9), (cost / turns.length).toFixed(5).padStart(13),
    String(percentile(turns.map((turn) => turn.ms), 0.5)).padStart(6), String(percentile(turns.map((turn) => turn.ms), 0.95)).padStart(6),
  ].join(' | '))
}

if (engines.length === 2) {
  const [a, b] = engines
  const byId = (engine) => Object.fromEntries(results.filter((result) => result.engine === engine).map((result) => [result.id, result]))
  const first = byId(a), second = byId(b)
  const line = (label, ids) => console.log(`${label}: ${ids.length ? ids.join(', ') : 'ninguno'}`)
  console.log('')
  line(`Acierta «${b}» y falla «${a}»`, Object.keys(first).filter((id) => !first[id].pass && second[id]?.pass))
  line(`Acierta «${a}» y falla «${b}»`, Object.keys(first).filter((id) => first[id].pass && !second[id]?.pass))
  line('Fallan los dos', Object.keys(first).filter((id) => !first[id].pass && !second[id]?.pass))
}

const only = flags.includes('--caso') ? flags[flags.indexOf('--caso') + 1] : null
if (flags.includes('--fallos') || only) {
  for (const result of results) {
    if (only ? result.id !== only : result.pass && result.ux) continue
    console.log(`\n## ${result.id} · ${result.engine}${result.pass ? '' : ' · FALLA'}`)
    for (const turn of result.turns) {
      console.log(`  > ${turn.input}`)
      for (const plan of turn.plans || []) console.log(`    · modelo: ${plan.slice(0, 700)}`)
      for (const reply of turn.replies) console.log(`    < ${reply.replace(/\n/g, ' ⏎ ').slice(0, 360)}`)
      if (turn.failures.length || turn.uxFailures.length) console.log(`    !! ${[...turn.failures, ...turn.uxFailures].join(' | ')}`)
    }
  }
}
