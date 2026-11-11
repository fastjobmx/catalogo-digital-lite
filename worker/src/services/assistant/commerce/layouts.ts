/** Ways merchants list sizes and units that the quantity-first reader does not cover:
 *  - range + each:   "de la 38 a la 42, tres de cada talla"
 *  - list + each:    "tallas 38, 39 y 40, cinco pares de cada una"
 *  - size first:     "M 5, L 8, XL 3" · "talla M, 5 unidades" · "28 dos unidades, 30 cinco y 32 una"
 * Everything returned is written in the text; a layout that is not clearly one of these returns null. */
import type { StockLine } from './intent'
import { colorOf, quantityOf, sizeOf } from './language'

export type LayoutToken = { raw: string; word: string }
export type Layout = { kind: 'range_each' | 'list_each' | 'size_first'; lines: StockLine[]; used: Set<number> }

const UNIT_WORDS = new Set(['unidades', 'unidad', 'u', 'pares', 'par', 'piezas', 'pieza'])
const isUnit = (word: string | undefined) => word !== undefined && UNIT_WORDS.has(word)
const isQty = (word: string | undefined) => word !== undefined && quantityOf(word) !== null
const numericSize = (word: string | undefined): string | null => {
  if (!word || !/^\d{2}(?:[.,]5)?$/.test(word)) return null
  const value = Number(word.replace(',', '.'))
  return value >= 20 && value <= 50 ? sizeOf(word) : null
}
const letterSize = (word: string | undefined): string | null => {
  if (!word || !/^[a-z0-9]{1,4}$/.test(word) || !/[a-z]/.test(word)) return null
  const size = sizeOf(word)
  return size && size !== 'Única' && !colorOf(word) ? size : null
}

/** "tres de cada una" / "cinco pares de cada talla": the quantity written right before "de cada". */
function eachQuantity(tokens: LayoutToken[]): { quantity: number; indexes: number[] } | null {
  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index]!.word !== 'cada') continue
    const indexes = [index]
    let cursor = index - 1
    if (tokens[cursor]?.word === 'de') { indexes.push(cursor); cursor-- }
    while (isUnit(tokens[cursor]?.word)) { indexes.push(cursor); cursor-- }
    if (isQty(tokens[cursor]?.word)) {
      indexes.push(cursor)
      if (['una', 'uno', 'talla', 'numero'].includes(tokens[index + 1]?.word || '')) indexes.push(index + 1)
      return { quantity: quantityOf(tokens[cursor]!.word)!, indexes }
    }
  }
  return null
}

function sizeFirstLetters(tokens: LayoutToken[]): Layout | null {
  const lines: StockLine[] = []
  const used = new Set<number>()
  let first = -1
  for (let index = 0; index < tokens.length; index++) {
    const size = letterSize(tokens[index]!.word)
    if (!size) continue
    let quantityIndex = index + 1
    // "M: 5", "talla M, 5 unidades", "M 5"
    if (!isQty(tokens[quantityIndex]?.word)) continue
    const before = tokens[index - 1]?.word === 'talla' ? index - 2 : index - 1
    if (first < 0) {
      // A quantity right before the size means quantity-first ("4 m 3 l"): not this layout.
      if (isQty(tokens[before]?.word)) return null
      first = index
    }
    lines.push({ quantity: quantityOf(tokens[quantityIndex]!.word)!, size, color: null })
    used.add(index); used.add(quantityIndex)
    if (tokens[index - 1]?.word === 'talla') used.add(index - 1)
    if (isUnit(tokens[quantityIndex + 1]?.word)) used.add(quantityIndex + 1)
    index = quantityIndex
  }
  return lines.length ? { kind: 'size_first', lines, used } : null
}

function sizeFirstNumbers(tokens: LayoutToken[]): Layout | null {
  const slots: Array<{ index: number; word: string }> = []
  tokens.forEach((token, index) => {
    if (!isQty(token.word)) return
    // "un/una/uno" is an article unless it directly follows a size number ("32 una" = size 32, 1 unit).
    if (/^(?:un|una|uno)$/.test(token.word) && !numericSize(tokens[index - 1]?.word)) return
    slots.push({ index, word: token.word })
  })
  if (slots.length < 4 || slots.length % 2) return null
  const sizes: string[] = []
  const lines: StockLine[] = []
  let last = 0
  for (let k = 0; k < slots.length; k += 2) {
    const size = numericSize(slots[k]!.word)
    const quantity = quantityOf(slots[k + 1]!.word)
    if (!size || quantity === null || quantity > 99 || Number(size.replace(',', '.')) <= last) return null
    last = Number(size.replace(',', '.'))
    sizes.push(size)
    lines.push({ quantity, size, color: null })
  }
  const used = new Set<number>()
  slots.forEach((slot) => { used.add(slot.index); if (isUnit(tokens[slot.index + 1]?.word)) used.add(slot.index + 1) })
  return { kind: 'size_first', lines, used }
}

export function parseSizeLayouts(tokens: LayoutToken[]): Layout | null {
  const each = eachQuantity(tokens)
  if (each) {
    // Range: "de la 38 a la 42".
    for (let index = 0; index < tokens.length; index++) {
      const from = numericSize(tokens[index]!.word)
      if (!from || !['a', 'hasta', 'al'].includes(tokens[index + 1]?.word || '')) continue
      const toIndex = tokens[index + 2]?.word === 'la' ? index + 3 : index + 2
      const to = numericSize(tokens[toIndex]?.word)
      const start = Number(from.replace(',', '.')), end = to ? Number(to.replace(',', '.')) : 0
      if (!to || end <= start || end - start > 15) continue
      const lines: StockLine[] = []
      for (let value = start; value <= end; value++) lines.push({ quantity: each.quantity, size: String(value), color: null })
      const used = new Set<number>([index, index + 1, toIndex, ...(tokens[index + 2]?.word === 'la' ? [index + 2] : []), ...each.indexes])
      return { kind: 'range_each', lines, used }
    }
    // List: "tallas 38, 39 y 40".
    for (let index = 0; index < tokens.length; index++) {
      if (tokens[index]!.word !== 'tallas' && tokens[index]!.word !== 'talla') continue
      const sizes: string[] = []
      const used = new Set<number>([index])
      for (let cursor = index + 1; cursor < tokens.length; cursor++) {
        const word = tokens[cursor]!.word
        const size = numericSize(word) || letterSize(word)
        if (size) { sizes.push(size); used.add(cursor); continue }
        if (word === 'y' || word === 'e') { used.add(cursor); continue }
        break
      }
      if (sizes.length >= 2 || (sizes.length === 1 && tokens[index]!.word === 'talla')) {
        each.indexes.forEach((i) => used.add(i))
        return { kind: 'list_each', lines: sizes.map((size) => ({ quantity: each.quantity, size, color: null })), used }
      }
    }
  }
  return sizeFirstLetters(tokens) || sizeFirstNumbers(tokens)
}
