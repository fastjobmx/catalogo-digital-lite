// Genera el documento de conversaciones antes/después a partir del informe del banco con el modelo real.
// Uso: node scripts/agent-bank-transcripts.mjs <banco-real.json> <salida.md>
import { readFileSync, writeFileSync } from "node:fs"
const [file, out] = process.argv.slice(2)
const results = JSON.parse(readFileSync(file, "utf8"))
const ids = [...new Set(results.map((result) => result.id))]
const lines = ["# Asistente TiendIA — conversaciones del banco (modelo real)", "", "Generado con `scripts/agent-bank-transcripts.mjs` a partir de la última ejecución real del banco. Tienda ficticia «Calzado Demo» en una base en memoria. ✔ = cumple datos y seguridad; ✖ = no cumple.", ""]
for (const id of ids) {
  const pair = ["anterior", "nueva"].map((engine) => results.find((result) => result.id === id && result.engine === engine)).filter(Boolean)
  lines.push(`## ${pair[0].title}${pair[0].critical ? " (crítico)" : ""}`, "")
  for (const result of pair) {
    lines.push(`**Motor ${result.engine === "nueva" ? "nuevo (capa conversacional)" : "anterior"}** ${result.pass ? "✔" : "✖"}`, "")
    for (const turn of result.turns) {
      lines.push(`- 🧑 ${turn.input}`)
      for (const reply of turn.replies) lines.push(`  - 🤖 ${reply.replace(/\n+/g, " ⏎ ").slice(0, 420)}`)
      if (!turn.replies.length) lines.push("  - 🤖 (sin respuesta)")
      if (turn.failures.length) lines.push(`  - ⚠️ ${turn.failures.join("; ")}`)
    }
    lines.push("")
  }
}
writeFileSync(out, lines.join("\n"))
console.log(`${ids.length} conversaciones`)
