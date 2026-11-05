/** Turns a read table into products for the import API: column mapping, number parsing and grouping of
 * variants. Values are taken as written; nothing missing is invented (no prices, stock or codes). */

export const IMPORT_FIELDS = ['sku', 'name', 'description', 'category', 'price', 'stock', 'color', 'size'] as const
export type ImportField = typeof IMPORT_FIELDS[number]
export type ColumnMapping = Partial<Record<ImportField, number>>

export const FIELD_LABELS: Record<ImportField, string> = {
  sku: 'Código (SKU)', name: 'Nombre', description: 'Descripción', category: 'Categoría',
  price: 'Precio', stock: 'Existencias', color: 'Color', size: 'Talla / tamaño',
}

const SYNONYMS: Record<ImportField, string[]> = {
  sku: ['sku', 'codigo', 'cod', 'ref', 'referencia', 'item', 'codigo de producto', 'id producto'],
  name: ['nombre', 'producto', 'nombre del producto', 'articulo', 'titulo', 'name', 'product'],
  description: ['descripcion', 'detalle', 'detalles', 'description', 'caracteristicas'],
  category: ['categoria', 'linea', 'familia', 'seccion', 'category', 'tipo'],
  price: ['precio', 'valor', 'precio de venta', 'pvp', 'precio unitario', 'price', 'valor unitario'],
  stock: ['stock', 'existencias', 'cantidad', 'inventario', 'unidades', 'disponible', 'qty'],
  color: ['color', 'colores', 'tono'],
  size: ['talla', 'tallas', 'tamano', 'medida', 'size', 'medidas'],
}

const normalize = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()

/** Finds the header row (the first row with at least two known column names) and maps its columns. */
export function detectMapping(rows: string[][]): { headerRow: number; mapping: ColumnMapping } {
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const mapping: ColumnMapping = {}
    rows[r]!.forEach((cell, index) => {
      const value = normalize(cell)
      if (!value || value.length > 40) return
      for (const field of IMPORT_FIELDS) {
        if (mapping[field] !== undefined) continue
        if (SYNONYMS[field].some((synonym) => value === synonym || value.startsWith(`${synonym} `))) { mapping[field] = index; return }
      }
    })
    if (Object.keys(mapping).length >= 2) return { headerRow: r, mapping }
  }
  return { headerRow: -1, mapping: {} }
}

/** Parses prices written as "$ 1.250.000", "1,250,000", "125000", "1.250,50" or "1250.50" (rounded to whole units). */
export function parseMoney(input: string): number | null {
  const raw = input.replace(/[^\d.,-]/g, '')
  if (!raw || !/\d/.test(raw) || raw.includes('-')) return null
  let normalized = raw
  const lastDot = raw.lastIndexOf('.')
  const lastComma = raw.lastIndexOf(',')
  if (lastDot >= 0 && lastComma >= 0) {
    const decimal = lastDot > lastComma ? '.' : ','
    const thousands = decimal === '.' ? ',' : '.'
    normalized = raw.split(thousands).join('').replace(decimal, '.')
  } else if (lastDot >= 0 || lastComma >= 0) {
    const separator = lastDot >= 0 ? '.' : ','
    const parts = raw.split(separator)
    const groupedThousands = parts.length > 1 && parts.slice(1).every((part) => part.length === 3) && parts[0]!.length <= 3 && parts[0]!.length > 0
    normalized = groupedThousands ? parts.join('') : parts.length === 2 ? `${parts[0]}.${parts[1]}` : ''
  }
  if (!normalized) return null
  const value = Number(normalized)
  return Number.isFinite(value) && value >= 0 && value <= 10_000_000_000 ? Math.round(value) : null
}

export function parseQuantity(input: string): number | null {
  const raw = input.replace(/[\s.]/g, '').replace(/,0+$/, '')
  if (!/^\d+$/.test(raw)) return null
  const value = Number(raw)
  return value <= 1_000_000 ? value : null
}

export type ImportVariant = { color: string | null; size: string | null; stock: number | null; price: number | null }
export type ImportProduct = { sku: string; name: string; description: string | null; category: string | null; price: number | null; variants: ImportVariant[] }
export type RowIssue = { row: number; message: string }

export type BuildOptions = {
  /** Creates internal codes ("IMP-…") for rows without SKU. Only when the store chooses it. */
  generateSku: boolean
  /** Stock used when a row has none. null keeps it empty (the product shows as sold out). */
  defaultStock: number | null
}

const skuFromName = (name: string) => `IMP-${normalize(name).replace(/ /g, '-').toUpperCase().slice(0, 40)}`.replace(/-+$/, '')

/** Groups rows into products: rows that share a code (or a name, with generated codes) become variants. */
export function buildProducts(rows: string[][], headerRow: number, mapping: ColumnMapping, options: BuildOptions) {
  const cell = (row: string[], field: ImportField) => (mapping[field] !== undefined ? (row[mapping[field]!] ?? '').trim() : '')
  const products = new Map<string, ImportProduct & { rows: number[]; generated: boolean }>()
  const issues: RowIssue[] = []
  rows.forEach((row, index) => {
    if (index <= headerRow) return
    const rowNumber = index + 1
    const name = cell(row, 'name')
    let sku = cell(row, 'sku').replace(/\s+/g, '-')
    if (!name && !sku) return
    if (!name) { issues.push({ row: rowNumber, message: 'Fila sin nombre: no se importa' }); return }
    let generated = false
    if (!sku) {
      if (!options.generateSku) { issues.push({ row: rowNumber, message: `«${name.slice(0, 40)}» no tiene código: no se importa` }); return }
      sku = skuFromName(name)
      generated = true
    }
    const priceText = cell(row, 'price')
    const price = priceText ? parseMoney(priceText) : null
    if (priceText && price === null) issues.push({ row: rowNumber, message: `Precio «${priceText.slice(0, 20)}» no reconocido: queda sin precio` })
    const stockText = cell(row, 'stock')
    let stock = stockText ? parseQuantity(stockText) : null
    if (stockText && stock === null) issues.push({ row: rowNumber, message: `Existencias «${stockText.slice(0, 20)}» no reconocidas` })
    if (stock === null) stock = options.defaultStock
    const variant: ImportVariant = { color: cell(row, 'color') || null, size: cell(row, 'size') || null, stock, price }
    const key = sku.toLowerCase()
    const existing = products.get(key)
    if (!existing) {
      products.set(key, { sku, name, description: cell(row, 'description') || null, category: cell(row, 'category') || null, price, variants: [variant], rows: [rowNumber], generated })
      return
    }
    existing.rows.push(rowNumber)
    if (existing.price === null && price !== null) existing.price = price
    const duplicate = existing.variants.find((item) => (item.color || '').toLowerCase() === (variant.color || '').toLowerCase() && (item.size || '').toLowerCase() === (variant.size || '').toLowerCase())
    if (duplicate) issues.push({ row: rowNumber, message: `Fila repetida de ${sku}: se usa la primera` })
    else existing.variants.push(variant)
  })
  const list = [...products.values()].map(({ rows: sourceRows, generated, ...product }) => ({
    product: { ...product, variants: product.variants.map((variant) => ({ ...variant, price: variant.price !== null && variant.price !== product.price ? variant.price : null })) },
    rows: sourceRows,
    generated,
  }))
  return { products: list, issues }
}
