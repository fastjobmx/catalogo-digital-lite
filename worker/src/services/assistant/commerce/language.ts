/** Spanish commerce language helpers: quantities, prices, sizes, colours and typo-tolerant matching.
 * Pure functions (no database); every result is either explicit in the text or null — never guessed. */
import { normalizeSize } from '../../../validation/telegramProductDraft'

/** Lower case without accents (ñ is kept as n, which also absorbs common typing differences). */
export function fold(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

const UNITS: Record<string, number> = {
  un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19,
  veinte: 20, veintiuno: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25, treinta: 30, cuarenta: 40,
  cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90, cien: 100, ciento: 100, docena: 12,
}

/** "3", "tres", "una docena" → number; null for anything else. */
export function quantityOf(token: string | undefined): number | null {
  if (!token) return null
  const value = fold(token).trim()
  if (/^\d{1,6}$/.test(value)) return Number(value)
  return UNITS[value] ?? null
}

export const QUANTITY_WORD = Object.keys(UNITS).join('|')

/** Prices as merchants write them: 80mil, 80 mil, 80k, 80.000, $80.000, 1,5 millones, ochenta mil.
 * Returns an integer amount or null. A bare small number ("80") is not a price. */
export function parseMoney(text: string): number | null {
  const value = fold(text)
  const millions = value.match(/(\d{1,3}(?:[.,]\d{1,3})?)\s*(?:millon(?:es)?|palos?)\b/)
  if (millions) return Math.round(Number(millions[1]!.replace(',', '.')) * 1_000_000)
  const thousands = value.match(/(\d{1,4}(?:[.,]\d{1,3})?)\s*(?:mil|k|lucas?)\b/)
  if (thousands) {
    const raw = thousands[1]!
    // "80.000 mil" is unusual; "1.5k"/"1,5 mil" are decimals.
    const number = /^\d{1,3}[.,]\d{3}$/.test(raw) ? Number(raw.replace(/[.,]/g, '')) : Number(raw.replace(',', '.'))
    return Number.isFinite(number) && number > 0 ? Math.round(number * 1000) : null
  }
  const wordThousands = value.match(new RegExp(`\\b(${QUANTITY_WORD})(?:\\s+y\\s+(${QUANTITY_WORD}))?\\s+mil\\b`))
  if (wordThousands) return ((UNITS[wordThousands[1]!] || 0) + (UNITS[wordThousands[2] || ''] || 0)) * 1000 || null
  const formatted = value.match(/\$\s*(\d{1,3}(?:[.,]\d{3})+|\d+)|\b(\d{1,3}(?:[.,]\d{3})+|\d{4,9})\b/)
  if (!formatted) return null
  const number = Number((formatted[1] || formatted[2])!.replace(/[.,]/g, ''))
  return Number.isSafeInteger(number) && number > 0 ? number : null
}

const LETTER_SIZE = /^(?:xxs|xs|s|m|l|xl|xxl|xxxl|[2-6]xl|xxxxl)$/
/** "38", "7.5", "M", "xl", "2xl", "unica" → normalised size; null when it is not a size. */
export function sizeOf(token: string | undefined): string | null {
  if (!token) return null
  const value = fold(token).replace(/[.,;:!?]+$/, '')
  if (value === 'unica') return 'Única'
  if (LETTER_SIZE.test(value)) return normalizeSize(value)
  if (/^\d{1,2}(?:[.,]5)?$/.test(value) && Number(value.replace(',', '.')) >= 1 && Number(value.replace(',', '.')) <= 60) return normalizeSize(value)
  return null
}

const COLORS: Array<[RegExp, string]> = [
  [/^negr[oa]s?$/, 'Negro'], [/^blanc[oa]s?$/, 'Blanco'], [/^azul(?:es)?$/, 'Azul'], [/^roj[oa]s?$/, 'Rojo'], [/^verdes?$/, 'Verde'],
  [/^gris(?:es)?$/, 'Gris'], [/^beiges?$/, 'Beige'], [/^(?:cafe|cafes|marron(?:es)?)$/, 'Café'], [/^(?:rosad[oa]s?|rosas?)$/, 'Rosado'],
  [/^morad[oa]s?$/, 'Morado'], [/^amarill[oa]s?$/, 'Amarillo'], [/^naranjas?$/, 'Naranja'], [/^dorad[oa]s?$/, 'Dorado'],
  [/^platead[oa]s?$/, 'Plateado'], [/^(?:vinotintos?|vinos?)$/, 'Vinotinto'], [/^fucsias?$/, 'Fucsia'], [/^celestes?$/, 'Celeste'],
  [/^cremas?$/, 'Crema'], [/^nudes?$/, 'Nude'], [/^lilas?$/, 'Lila'], [/^turquesas?$/, 'Turquesa'], [/^multicolor(?:es)?$/, 'Multicolor'],
]

/** "negras" → "Negro". Only real colour words; null otherwise. */
export function colorOf(token: string | undefined): string | null {
  if (!token) return null
  const value = fold(token).replace(/[.,;:!?]+$/, '')
  return COLORS.find(([pattern]) => pattern.test(value))?.[1] ?? null
}

/** Same colour regardless of gender, number and accents ("Negra" ~ "negro"). */
export function sameColor(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  return (colorOf(a) || fold(a)) === (colorOf(b) || fold(b))
}

export function sameSize(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  return (sizeOf(a) || fold(a)).toUpperCase() === (sizeOf(b) || fold(b)).toUpperCase()
}

/** Very small Spanish singulariser for matching ("camisetas" ~ "camiseta", "pantalones" ~ "pantalon"). */
export function singular(word: string): string {
  const value = fold(word)
  if (value.length > 4 && /(?:ones|anes|enes)$/.test(value)) return value.slice(0, -2)
  if (value.length > 4 && /[^aeiou]es$/.test(value) && !/(?:ces|ses)$/.test(value)) return value.slice(0, -2)
  if (value.length > 3 && value.endsWith('s')) return value.slice(0, -1)
  return value
}

export function editDistance(a: string, b: string): number {
  if (a === b) return 0
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i++) {
    let diagonal = previous[0]!
    previous[0] = i
    for (let j = 1; j <= b.length; j++) {
      const above = previous[j]!
      previous[j] = Math.min(previous[j]! + 1, previous[j - 1]! + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1))
      diagonal = above
    }
  }
  return previous[b.length]!
}

/** Typo-tolerant word match: equal after folding/singular, or one edit (two for long words). */
export function similarWord(a: string, b: string): boolean {
  const x = singular(a), y = singular(b)
  if (x === y) return true
  if (Math.min(x.length, y.length) < 4) return false
  return editDistance(x, y) <= (Math.max(x.length, y.length) >= 8 ? 2 : 1)
}

/** Words that never name a product. */
export const FILLER = new Set(fold([
  'me', 'te', 'le', 'les', 'lo', 'la', 'las', 'el', 'los', 'un', 'una', 'unos', 'unas', 'de', 'del', 'a', 'al', 'en', 'y', 'e', 'o', 'que', 'ya', 'no',
  'se', 'por', 'para', 'con', 'sin', 'mas', 'más', 'otra', 'otro', 'otras', 'otros', 'esa', 'ese', 'esas', 'esos', 'esta', 'este', 'estas', 'estos', 'eso',
  'producto', 'productos', 'articulo', 'articulos', 'referencia', 'ahora', 'hay', 'son', 'es', 'eran', 'era', 'mi', 'mis', 'su', 'sus', 'tengo', 'tenemos',
  'unidades', 'unidad', 'u', 'pares', 'par', 'piezas', 'pieza', 'talla', 'tallas', 'color', 'colores', 'precio', 'precios', 'mil', 'k', 'pesos', 'peso',
  'cop', 'total', 'todas', 'todos', 'toda', 'todo', 'cada', 'solo', 'sólo', 'nada', 'favor', 'porfa', 'porfavor', 'gracias', 'hola', 'por favor', 'como',
  'cuanto', 'cuantos', 'cuantas', 'cuánto', 'cuántos', 'cuántas', 'quedan', 'queda', 'quedaron', 'stock', 'inventario', 'existencias', 'anterior', 'mismo', 'misma',
].join('|')).split('|'))
