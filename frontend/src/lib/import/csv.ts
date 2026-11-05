import { tidyRows } from './table'

/** Detects the delimiter from the first lines: comma, semicolon (Excel in Spanish) or tab. */
export function detectDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).slice(0, 10).join('\n')
  const counts = [',', ';', '\t'].map((delimiter) => ({ delimiter, n: countOutsideQuotes(sample, delimiter) }))
  counts.sort((a, b) => b.n - a.n)
  return counts[0]!.n > 0 ? counts[0]!.delimiter : ','
}

function countOutsideQuotes(text: string, char: string): number {
  let inQuotes = false
  let n = 0
  for (const c of text) {
    if (c === '"') inQuotes = !inQuotes
    else if (c === char && !inQuotes) n++
  }
  return n
}

/** RFC 4180 CSV parser: quoted fields, escaped quotes ("") and line breaks inside quotes. */
export function parseCsv(input: string, delimiter = detectDelimiter(input)): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else inQuotes = false
      } else field += c
      continue
    }
    if (c === '"' && field === '') inQuotes = true
    else if (c === delimiter) { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field); rows.push(row); row = []; field = ''
    } else field += c
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return tidyRows(rows)
}
