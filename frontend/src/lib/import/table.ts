/** A file read in the browser, as plain text cells. Nothing in it is ever executed or interpreted. */
export type RawTable = {
  source: 'csv' | 'xlsx' | 'pdf'
  fileName: string
  rows: string[][]
  /** Sheet names (Excel) or page count (PDF), for the summary. */
  sheets?: string[]
  pages?: number
  /** True when a PDF has (almost) no selectable text: probably scanned images. */
  textless?: boolean
  /** Rows transcribed by AI from page images: they must be checked against the document. */
  aiRead?: boolean
}

export const MAX_FILE_BYTES = 15 * 1024 * 1024
/** PDFs are only read in the browser (never uploaded), so large printed catalogues are allowed. */
export const MAX_PDF_BYTES = 60 * 1024 * 1024
export const MAX_ROWS = 5000
export const MAX_CELL_CHARS = 2000

export function cleanCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  const text = value instanceof Date ? value.toISOString().slice(0, 10) : String(value)
  return text.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_CELL_CHARS)
}

/** Drops empty rows and trailing empty cells; caps the number of rows. */
export function tidyRows(rows: unknown[][]): string[][] {
  const out: string[][] = []
  for (const row of rows) {
    const cells = row.map(cleanCell)
    while (cells.length && !cells[cells.length - 1]) cells.pop()
    if (cells.some(Boolean)) out.push(cells)
    if (out.length > MAX_ROWS) break
  }
  return out
}
