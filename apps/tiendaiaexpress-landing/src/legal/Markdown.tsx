// Minimal Markdown renderer for the legal documents (headings, paragraphs, lists, tables, bold,
// italics and e-mail links). The document text lives in a .md file so it can be compared line by
// line with the approved version; nothing here rewrites its content.
import { Fragment, type ReactNode } from 'react'

export type Block =
  | { type: 'h2' | 'h3'; id: string; text: string }
  | { type: 'p'; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'table'; head: string[]; right: boolean[]; rows: string[][] }

export type TocEntry = { id: string; text: string; children: { id: string; text: string }[] }

const slug = (text: string) =>
  text
    .replace(/^[\d.]+\s*/, '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

const cells = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())

export function parse(md: string): Block[] {
  const lines = md.replace(/\r/g, '').split('\n')
  const blocks: Block[] = []
  const used = new Set<string>()
  const uniqueId = (text: string) => {
    let id = slug(text) || 'seccion'
    while (used.has(id)) id += '-2'
    used.add(id)
    return id
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) continue
    const heading = /^(#{2,3})\s+(.*)$/.exec(line)
    if (heading) {
      blocks.push({ type: heading[1].length === 2 ? 'h2' : 'h3', id: uniqueId(heading[2]), text: heading[2] })
      continue
    }
    if (line.startsWith('- ')) {
      const items: string[] = []
      while (i < lines.length && lines[i].startsWith('- ')) items.push(lines[i++].slice(2))
      i--
      blocks.push({ type: 'ul', items })
      continue
    }
    if (line.startsWith('|')) {
      const head = cells(line)
      const right = cells(lines[i + 1] || '').map((c) => c.endsWith(':'))
      const rows: string[][] = []
      i += 2
      while (i < lines.length && lines[i].startsWith('|')) rows.push(cells(lines[i++]))
      i--
      blocks.push({ type: 'table', head, right, rows })
      continue
    }
    blocks.push({ type: 'p', text: line })
  }
  return blocks
}

export function toc(blocks: Block[]): TocEntry[] {
  const out: TocEntry[] = []
  for (const b of blocks) {
    if (b.type === 'h2') out.push({ id: b.id, text: b.text, children: [] })
    else if (b.type === 'h3' && out.length) out[out.length - 1].children.push({ id: b.id, text: b.text })
  }
  return out
}

/** **bold**, *italic* and e-mail addresses (as mailto: links). */
export function Inline({ text }: { text: string }) {
  const parts: ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|[\w.+-]+@[\w-]+\.[\w.]+)/g
  let last = 0
  let m: RegExpExecArray | null
  let k = 0
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    const t = m[0]
    if (t.startsWith('**')) parts.push(<strong key={k++} className="font-semibold text-night"><Inline text={t.slice(2, -2)} /></strong>)
    else if (t.startsWith('*')) parts.push(<em key={k++}>{t.slice(1, -1)}</em>)
    else parts.push(<a key={k++} href={`mailto:${t}`} className="legal-link">{t}</a>)
    last = m.index + t.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <>{parts.map((p, i) => <Fragment key={i}>{p}</Fragment>)}</>
}

export function Document({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.type) {
          case 'h2':
            return <h2 key={i} id={b.id} className="legal-h2"><a href={`#${b.id}`} className="legal-anchor"><Inline text={b.text} /></a></h2>
          case 'h3':
            return <h3 key={i} id={b.id} className="legal-h3"><Inline text={b.text} /></h3>
          case 'ul':
            return <ul key={i} className="legal-ul">{b.items.map((it, j) => <li key={j}><Inline text={it} /></li>)}</ul>
          case 'table':
            return (
              <div key={i} className="legal-table" role="region" aria-label={`Tabla: ${b.head.join(', ')}`} tabIndex={0}>
                <table>
                  <thead><tr>{b.head.map((h, j) => <th key={j} scope="col" className={b.right[j] ? 'text-right' : ''}>{h}</th>)}</tr></thead>
                  <tbody>{b.rows.map((r, j) => <tr key={j}>{r.map((c, n) => n === 0 ? <th key={n} scope="row"><Inline text={c} /></th> : <td key={n} className={b.right[n] ? 'text-right' : ''}><Inline text={c} /></td>)}</tr>)}</tbody>
                </table>
              </div>
            )
          default:
            return <p key={i} className="legal-p"><Inline text={b.text} /></p>
        }
      })}
    </>
  )
}
