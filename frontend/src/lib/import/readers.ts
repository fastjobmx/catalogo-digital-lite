/** File readers for the import wizard. The Excel and PDF libraries load only when a file of that type is chosen. */
import { parseCsv } from './csv'
import { MAX_FILE_BYTES, cleanCell, tidyRows, type RawTable } from './table'

export class ReadError extends Error {}

export function sourceOf(file: File): RawTable['source'] | null {
  const name = file.name.toLowerCase()
  if (name.endsWith('.csv') || name.endsWith('.txt') || file.type === 'text/csv') return 'csv'
  if (name.endsWith('.xlsx')) return 'xlsx'
  if (name.endsWith('.pdf') || file.type === 'application/pdf') return 'pdf'
  return null
}

export async function readImportFile(file: File, sheet?: string): Promise<RawTable> {
  const source = sourceOf(file)
  if (!source) throw new ReadError('Usa un archivo CSV, Excel (.xlsx) o PDF.')
  if (file.size > MAX_FILE_BYTES) throw new ReadError('El archivo pesa más de 15 MB. Divídelo en partes más pequeñas.')
  if (source === 'csv') return { source, fileName: file.name, rows: parseCsv(await readText(file)) }
  if (source === 'xlsx') return readXlsx(file, sheet)
  return readPdf(file)
}

async function readText(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  // Excel in Spanish often saves CSV as Windows-1252: fall back when UTF-8 shows replacement characters.
  return utf8.includes(String.fromCharCode(0xfffd)) ? new TextDecoder('windows-1252').decode(bytes) : utf8
}

async function readXlsx(file: File, sheet?: string): Promise<RawTable> {
  const { default: readXlsxFile } = await import('read-excel-file/browser')
  let sheets: Awaited<ReturnType<typeof readXlsxFile>>
  // Only stored cell values are read: formulas are never calculated.
  try { sheets = await readXlsxFile(file) } catch { throw new ReadError('No se pudo leer el Excel. Guárdalo de nuevo como .xlsx e inténtalo otra vez.') }
  const chosen = sheets.find((item) => item.sheet === sheet) || sheets.find((item) => item.data.length > 1) || sheets[0]
  if (!chosen) throw new ReadError('El Excel no tiene hojas con datos.')
  return { source: 'xlsx', fileName: file.name, sheets: sheets.map((item) => item.sheet), rows: tidyRows(chosen.data as unknown[][]) }
}

type TextItem = { str: string; x: number; y: number; width: number; height: number }

async function readPdf(file: File): Promise<RawTable> {
  const pdfjs = await import('pdfjs-dist')
  const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  // No forms, scripts or external fonts: only the text layer is read.
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), enableXfa: false, disableFontFace: true, useSystemFonts: false })
  let document: Awaited<typeof task.promise>
  try {
    document = await task.promise
  } catch { throw new ReadError('No se pudo abrir el PDF. Si tiene contraseña, quítala y vuelve a intentarlo.') }
  const rows: string[][] = []
  let characters = 0
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
    const page = await document.getPage(pageNumber)
    const content = await page.getTextContent()
    const items: TextItem[] = []
    for (const item of content.items) {
      if (!('str' in item) || !item.str.trim()) continue
      characters += item.str.trim().length
      items.push({ str: item.str, x: item.transform[4], y: item.transform[5], width: item.width, height: Math.abs(item.transform[3]) || 10 })
    }
    rows.push(...pdfLines(items))
    page.cleanup()
  }
  const pages = document.numPages
  await task.destroy()
  return { source: 'pdf', fileName: file.name, pages, rows: tidyRows(rows), textless: characters < pages * 20 }
}

/** Groups PDF text into lines (by height on the page) and cells (by horizontal gaps). */
export function pdfLines(items: TextItem[]): string[][] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x)
  const lines: TextItem[][] = []
  for (const item of sorted) {
    const line = lines[lines.length - 1]
    if (line && Math.abs(line[0]!.y - item.y) <= Math.max(2, item.height * 0.4)) line.push(item)
    else lines.push([item])
  }
  return lines.map((line) => {
    line.sort((a, b) => a.x - b.x)
    const cells: string[] = []
    let current = ''
    let end = -Infinity
    for (const item of line) {
      const gap = item.x - end
      if (current && gap > Math.max(12, item.height * 1.2)) { cells.push(cleanCell(current)); current = '' }
      current += (current && gap > item.height * 0.15 && !current.endsWith(' ') ? ' ' : '') + item.str
      end = item.x + item.width
    }
    if (current) cells.push(cleanCell(current))
    return cells
  })
}
