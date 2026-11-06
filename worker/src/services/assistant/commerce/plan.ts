/** Turns a stock intent into concrete changes on real variants, or a precise question. It never fills a
 * gap by guessing: missing units, ambiguous colours or sizes always come back as a question. */
import type { CommerceIntent, StockLine } from './intent'
import { sameColor } from './language'
import { variantLabel, variantMatches, type CatalogProduct } from './resolve'

export type StockChange = { variantId: number; label: string; from: number; to: number }
export type NewVariant = { size: string; color: string; stock: number }
export type StockPlan =
  | { kind: 'changes'; changes: StockChange[]; create: NewVariant[]; movement: 'entrada' | 'salida' | 'ajuste'; quantity: number }
  | { kind: 'ask'; ask: 'mode' | 'distribution' | 'color'; text: string; missing?: number }
  | { kind: 'error'; text: string }

type StockIntent = Extract<CommerceIntent, { kind: 'stock' }>
type SoldOutIntent = Extract<CommerceIntent, { kind: 'sold_out' }>

const units = (n: number) => `${n} ${n === 1 ? 'unidad' : 'unidades'}`
const list = (values: string[]) => values.length <= 1 ? values.join('') : `${values.slice(0, -1).join(', ')} y ${values[values.length - 1]}`

export function sizesOf(product: CatalogProduct): string[] {
  return [...new Set(product.variants.filter((variant) => variant.isActive).map((variant) => variantLabel(variant)))]
}

export function planStock(product: CatalogProduct, intent: StockIntent): StockPlan {
  const active = product.variants.filter((variant) => variant.isActive)
  if (!active.length) return { kind: 'error', text: `${product.name} no tiene tallas ni variantes activas. Agrégalas desde el panel.` }
  if (intent.mode === 'ask') {
    const amount = intent.lines.reduce((sum, line) => sum + line.quantity, 0)
    return { kind: 'ask', ask: 'mode', text: `¿Quieres <b>sumar ${units(amount)}</b> a las existencias actuales o <b>dejar ${amount}</b> como existencias finales?` }
  }
  const declared = intent.lines.reduce((sum, line) => sum + line.quantity, 0)
  if (intent.total !== null && intent.lines.some((line) => line.size || line.color) && declared !== intent.total) {
    if (declared < intent.total) {
      const missing = intent.total - declared
      return { kind: 'ask', ask: 'distribution', missing, text: `Identifiqué ${units(declared)} distribuidas. Faltan ${missing} para completar las ${intent.total} que mencionaste. ¿Qué talla corresponde a esas ${missing} unidades?` }
    }
    return { kind: 'ask', ask: 'distribution', text: `Las tallas suman ${units(declared)}, pero mencionaste ${intent.total}. ¿Cuál es el dato correcto? Escríbeme de nuevo la distribución.` }
  }
  const lines: StockLine[] = intent.lines.length ? intent.lines : intent.total ? [{ quantity: intent.total, size: intent.size, color: intent.color }] : []
  if (!lines.length) return { kind: 'error', text: 'No identifiqué cuántas unidades son.' }

  const changes = new Map<number, StockChange>()
  const create: NewVariant[] = []
  const productColors = [...new Set(active.map((variant) => variant.color).filter(Boolean))] as string[]
  for (const line of lines) {
    const filters = { size: line.size, color: line.color || intent.color }
    if (!filters.size && !filters.color && active.length > 1) {
      return { kind: 'ask', ask: 'distribution', missing: line.quantity, text: `¿De qué talla son esas ${units(line.quantity)}? ${product.name} tiene: ${list(sizesOf(product))}.` }
    }
    const matches = active.filter((variant) => variantMatches(variant, filters))
    let target = matches.length === 1 ? matches[0]! : null
    if (matches.length > 1) {
      const colors = [...new Set(matches.map((variant) => variant.color).filter(Boolean))] as string[]
      if (colors.length > 1) return { kind: 'ask', ask: 'color', text: `${filters.size ? `La talla ${filters.size}` : 'Ese producto'} existe en ${list(colors)}. ¿De qué color son las ${units(line.quantity)}?` }
      return { kind: 'ask', ask: 'distribution', missing: line.quantity, text: `¿De qué talla son las ${units(line.quantity)}${filters.color ? ` ${filters.color.toLowerCase()}` : ''}? Tallas disponibles: ${list([...new Set(matches.map((variant) => variant.size || 'única'))])}.` }
    }
    if (!target) {
      if (intent.mode === 'remove') return { kind: 'error', text: `${product.name} no tiene ${[filters.color, filters.size ? `talla ${filters.size}` : null].filter(Boolean).join(' en ')}. Sus variantes son: ${list(sizesOf(product))}.` }
      if (!filters.size) return { kind: 'error', text: `${product.name} no tiene el color ${filters.color}. Sus variantes son: ${list(sizesOf(product))}.` }
      const color = filters.color || (productColors.length === 1 ? productColors[0]! : null)
      if (!color) return { kind: 'ask', ask: 'color', text: `${product.name} todavía no tiene la talla ${filters.size}. ¿De qué color son las ${units(line.quantity)}? Colores actuales: ${list(productColors)}.` }
      const existing = create.find((item) => item.size === filters.size && sameColor(item.color, color))
      if (existing) existing.stock += line.quantity
      else create.push({ size: filters.size, color, stock: line.quantity })
      continue
    }
    const current = changes.get(target.id) || { variantId: target.id, label: variantLabel(target), from: target.stock, to: target.stock }
    if (intent.mode === 'set') {
      if (changes.has(target.id) && current.to !== line.quantity) return { kind: 'error', text: `Indicaste dos cantidades distintas para ${variantLabel(target)}. Dime cuál es la correcta.` }
      current.to = line.quantity
    } else if (intent.mode === 'add') current.to += line.quantity
    else {
      current.to -= line.quantity
      if (current.to < 0) return { kind: 'error', text: `Solo hay ${units(current.from)} de ${product.name} (${variantLabel(target)}). No puedo descontar ${line.quantity}: el inventario nunca queda negativo.` }
    }
    changes.set(target.id, current)
  }
  const real = [...changes.values()].filter((change) => change.to !== change.from)
  if (!real.length && !create.length) return { kind: 'error', text: 'Las existencias ya están así; no hay nada que cambiar.' }
  return { kind: 'changes', changes: real, create, movement: intent.mode === 'add' ? 'entrada' : intent.mode === 'remove' ? 'salida' : 'ajuste', quantity: lines.reduce((sum, line) => sum + line.quantity, 0) }
}

/** "Las blancas ya no quedan": every matching active variant goes to 0. */
export function planSoldOut(product: CatalogProduct, intent: SoldOutIntent): StockPlan {
  const matches = product.variants.filter((variant) => variant.isActive && variantMatches(variant, { color: intent.color, size: intent.size }))
  if (!matches.length) return { kind: 'error', text: `${product.name} no tiene variantes ${[intent.color, intent.size ? `talla ${intent.size}` : null].filter(Boolean).join(' ')}. Sus variantes son: ${list(sizesOf(product))}.` }
  const changes = matches.filter((variant) => variant.stock > 0).map((variant) => ({ variantId: variant.id, label: variantLabel(variant), from: variant.stock, to: 0 }))
  if (!changes.length) return { kind: 'error', text: `${product.name}${intent.color ? ` ${intent.color.toLowerCase()}` : ''} ya está en 0 unidades.` }
  return { kind: 'changes', changes, create: [], movement: 'ajuste', quantity: changes.reduce((sum, change) => sum + change.from, 0) }
}
