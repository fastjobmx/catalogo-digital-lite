import { roleAllows } from '../../tenancy/access'
import { downloadTelegramFile, bytesToBase64, type TelegramMessage } from './telegramApi'
import { say, rememberTurn, type AssistantContext } from './context'
import { proposeChange } from './operations'
import { summarizeDocument } from './ai'
import { escapeHtml } from './tools'

const CSV_LIMIT_BYTES = 512 * 1024
const PDF_LIMIT_BYTES = 5 * 1024 * 1024
const MAX_ROWS = 200

export type ImportPlan = {
  prices: Array<{ sku: string; price: number }>
  stocks: Array<{ sku: string; size: string | null; stock: number }>
  errors: Array<{ line: number; reason: string }>
}

const HEADER_ALIASES: Record<string, 'sku' | 'price' | 'stock' | 'size'> = {
  sku: 'sku', codigo: 'sku', 'código': 'sku', referencia: 'sku', ref: 'sku',
  precio: 'price', price: 'price', valor: 'price',
  stock: 'stock', existencias: 'stock', cantidad: 'stock', inventario: 'stock', unidades: 'stock',
  talla: 'size', size: 'size', variante: 'size',
}

function splitLine(line: string, delimiter: string): string[] {
  const cells: string[] = []
  let current = ''
  let quoted = false
  for (let index = 0; index < line.length; index++) {
    const char = line[index]!
    if (char === '"') {
      if (quoted && line[index + 1] === '"') { current += '"'; index++ } else quoted = !quoted
    } else if (char === delimiter && !quoted) { cells.push(current.trim()); current = '' } else current += char
  }
  cells.push(current.trim())
  return cells
}

function parseInteger(value: string): number | null {
  const clean = value.replace(/[$\s]/g, '').replace(/(?:cop|pesos?)$/i, '')
  if (!clean) return null
  if (!/^(?:\d+|\d{1,3}(?:[.,]\d{3})+)$/.test(clean)) return null
  const number = Number(clean.replace(/[.,]/g, ''))
  return Number.isSafeInteger(number) && number >= 0 ? number : null
}

/** Parses a price/stock CSV. Formula-like cells are rejected to avoid CSV injection. */
export function parseCatalogCsv(text: string): ImportPlan | { error: string } {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).map((line) => line.trimEnd()).filter((line) => line.trim())
  if (lines.length < 2) return { error: 'El archivo necesita una fila de encabezados y al menos una fila de datos.' }
  if (lines.length - 1 > MAX_ROWS) return { error: `El archivo tiene más de ${MAX_ROWS} filas. Divídelo en varias partes.` }
  const header = lines[0]!
  const delimiter = [';', ',', '\t'].sort((a, b) => header.split(b).length - header.split(a).length)[0]!
  const columns = splitLine(header, delimiter).map((cell) => HEADER_ALIASES[cell.toLowerCase().normalize('NFC')] ?? null)
  if (!columns.includes('sku') || (!columns.includes('price') && !columns.includes('stock'))) {
    return { error: 'No encontré las columnas necesarias. Usa encabezados como: sku, precio, stock (y talla si aplica).' }
  }
  const plan: ImportPlan = { prices: [], stocks: [], errors: [] }
  lines.slice(1).forEach((line, offset) => {
    const lineNumber = offset + 2
    const cells = splitLine(line, delimiter)
    const value = (key: 'sku' | 'price' | 'stock' | 'size') => cells[columns.indexOf(key)] ?? ''
    if (cells.some((cell) => /^[=+\-@]/.test(cell) && !/^-?\d/.test(cell))) { plan.errors.push({ line: lineNumber, reason: 'contiene una fórmula' }); return }
    const sku = value('sku').toUpperCase()
    if (!/^[A-Z0-9][A-Z0-9._-]{1,63}$/.test(sku)) { plan.errors.push({ line: lineNumber, reason: 'SKU inválido' }); return }
    const size = value('size').trim() || null
    if (columns.includes('price') && value('price')) {
      const price = parseInteger(value('price'))
      if (price === null || price <= 0) plan.errors.push({ line: lineNumber, reason: 'precio inválido' })
      else if (!plan.prices.some((item) => item.sku === sku)) plan.prices.push({ sku, price })
    }
    if (columns.includes('stock') && value('stock')) {
      const stock = parseInteger(value('stock'))
      if (stock === null) plan.errors.push({ line: lineNumber, reason: 'stock inválido' })
      else plan.stocks.push({ sku, size, stock })
    }
  })
  return plan
}

/** Matches the plan against the store catalog and drops rows that do not exist. */
async function resolvePlan(ctx: AssistantContext, plan: ImportPlan): Promise<ImportPlan> {
  const rows = await ctx.db.prepare(
    `SELECT p.sku, p.price, v.id AS variant_id, v.size, v.stock FROM products p
     LEFT JOIN product_variants v ON v.product_id = p.id AND v.is_active = 1
     WHERE p.store_id = ? AND p.is_archived = 0`,
  ).bind(ctx.store.id).all<{ sku: string; price: number; variant_id: number | null; size: string | null; stock: number | null }>()
  const all = rows.results || []
  const resolved: ImportPlan = { prices: [], stocks: [], errors: [...plan.errors] }
  for (const item of plan.prices) {
    const row = all.find((candidate) => candidate.sku.toUpperCase() === item.sku)
    if (!row) resolved.errors.push({ line: 0, reason: `${item.sku}: no existe en tu catálogo` })
    else if (Number(row.price) !== item.price) resolved.prices.push({ sku: row.sku, price: item.price })
  }
  for (const item of plan.stocks) {
    const variants = all.filter((candidate) => candidate.sku.toUpperCase() === item.sku && candidate.variant_id !== null)
    if (!variants.length) { resolved.errors.push({ line: 0, reason: `${item.sku}: no existe en tu catálogo` }); continue }
    const variant = item.size ? variants.find((candidate) => String(candidate.size || '').toUpperCase() === item.size!.toUpperCase()) : variants.length === 1 ? variants[0] : undefined
    if (!variant) { resolved.errors.push({ line: 0, reason: `${item.sku}: ${item.size ? `no tiene la talla ${item.size}` : 'tiene varias tallas; agrega la columna talla'}` }); continue }
    if (Number(variant.stock) !== item.stock) resolved.stocks.push({ sku: variants[0]!.sku, size: item.size, stock: item.stock })
  }
  return resolved
}

export function isSupportedDocument(message: TelegramMessage): boolean {
  const document = message.document
  if (!document) return false
  return /\.(csv|tsv|txt|pdf)$/i.test(document.file_name || '') || ['text/csv', 'text/plain', 'application/pdf', 'text/tab-separated-values'].includes(document.mime_type || '')
}

export async function handleDocument(ctx: AssistantContext, message: TelegramMessage): Promise<void> {
  const document = message.document!
  const name = document.file_name || 'archivo'
  const isPdf = /\.pdf$/i.test(name) || document.mime_type === 'application/pdf'
  const limit = isPdf ? PDF_LIMIT_BYTES : CSV_LIMIT_BYTES
  if (document.file_size && document.file_size > limit) {
    await say(ctx, `El archivo es muy grande (máximo ${Math.round(limit / 1024)} KB para este tipo). Divídelo o compártelo resumido.`)
    return
  }
  let bytes: Uint8Array
  try {
    bytes = (await downloadTelegramFile(ctx.botToken, document.file_id, limit)).bytes
  } catch {
    await say(ctx, 'No pude descargar el archivo. Intenta enviarlo de nuevo.')
    return
  }
  await rememberTurn(ctx, 'user', `[Documento] ${name}`)
  if (isPdf) {
    if (bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 || bytes[3] !== 0x46) { await say(ctx, 'El archivo no parece un PDF válido.'); return }
    const outcome = await summarizeDocument(ctx, { mimeType: 'application/pdf', data: bytesToBase64(bytes), fileName: name }, message.caption || '')
    await say(ctx, outcome.ok ? `📄 <b>${escapeHtml(name)}</b>\n${escapeHtml(outcome.value.answer)}\n\n<i>Para importar precios o stock, envíame un CSV con columnas sku, precio, stock.</i>` : outcome.message)
    return
  }
  const text = new TextDecoder('utf-8').decode(bytes)
  const parsed = parseCatalogCsv(text)
  if ('error' in parsed) {
    await say(ctx, `${parsed.error}\n\nEjemplo:\n<code>sku;precio;stock;talla\nABC123;180000;5;38</code>`)
    return
  }
  if (!roleAllows(ctx.role, 'admin')) { await say(ctx, 'Tu rol no permite importar cambios de precios o stock.'); return }
  const plan = await resolvePlan(ctx, parsed)
  const errors = plan.errors.slice(0, 8).map((error) => `• ${error.line ? `Fila ${error.line}: ` : ''}${escapeHtml(error.reason)}`).join('\n')
  if (!plan.prices.length && !plan.stocks.length) {
    await say(ctx, `Revisé <b>${escapeHtml(name)}</b> y no encontré cambios para aplicar.${errors ? `\n\nFilas con problemas:\n${errors}` : ''}`)
    return
  }
  if (errors) await say(ctx, `Revisé <b>${escapeHtml(name)}</b>. Estas filas no se importarán:\n${errors}${plan.errors.length > 8 ? `\n…y ${plan.errors.length - 8} más.` : ''}`)
  await proposeChange(ctx, 'import_catalog_updates' as never, { prices: plan.prices, stocks: plan.stocks }, `Importación desde ${name}`)
}
