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

const HUNDREDS: Record<string, number> = {
  cien: 100, ciento: 100, doscientos: 200, doscientas: 200, trescientos: 300, trescientas: 300, cuatrocientos: 400, cuatrocientas: 400,
  quinientos: 500, quinientas: 500, seiscientos: 600, seiscientas: 600, setecientos: 700, setecientas: 700, ochocientos: 800, ochocientas: 800,
  novecientos: 900, novecientas: 900,
}
/** Number words that can appear in a spoken price ("ciento ochenta mil", "dos mil quinientos"). */
export const HUNDRED_WORD = Object.keys(HUNDREDS).join('|')
export const SPOKEN_AMOUNT = `(?:(?:${Object.keys(UNITS).filter((word) => word !== 'docena').join('|')}|${HUNDRED_WORD}|y)\\s+){1,5}mil(?:\\s+(?:${HUNDRED_WORD})(?:\\s+(?:y|${Object.keys(UNITS).filter((word) => word !== 'docena').join('|')})){0,3})?`
const TENS_WORDS = 'veinte|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa'
const DIGIT_WORDS = 'uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve'

/** "treinta y ocho" → "38" (only the compound form, so "una camiseta" stays untouched). */
export function numberWordsToDigits(text: string, keepCase = false): string {
  return (keepCase ? text : fold(text)).replace(new RegExp(`\\b(${TENS_WORDS})\\s+y\\s+(${DIGIT_WORDS})\\b`, 'gi'), (_match, tens: string, unit: string) => String((UNITS[tens.toLowerCase()] || 0) + (UNITS[unit.toLowerCase()] || 0)))
}

/** Sum of a run of number words ("ciento ochenta", "treinta y cinco"); null if any word is not a number. */
export function spanishNumber(words: string[]): number | null {
  let total = 0
  let seen = false
  for (const raw of words) {
    const word = fold(raw)
    if (word === 'y') continue
    if (HUNDREDS[word] !== undefined) { total += HUNDREDS[word]!; seen = true; continue }
    if (UNITS[word] !== undefined && word !== 'docena') { total += UNITS[word]!; seen = true; continue }
    return null
  }
  return seen ? total : null
}

/** A price written as a bare small number ("precio 180"): it could be $180 or $180.000, so it is asked, never assumed. */
export function ambiguousAmount(text: string): number | null {
  const value = fold(text)
  if (/(?:\bmil\b|\bk\b|lucas?|millon|\$|pesos|\bcop\b|\d[.,]\d{3})/.test(value)) return null
  const match = value.match(/(?:\bprecio(?:\s+de)?|\bvale[n]?|\bcuesta[n]?|\ba|\ben|\bpor)\s+(\d{2,3})\b(?!\s*(?:unidades|pares|u\b|talla))/)
  const amount = match ? Number(match[1]) : null
  return amount && amount >= 10 && amount <= 999 ? amount : null
}

/** Prices as merchants write them: 80mil, 80 mil, 80k, 80.000, $80.000, 1,5 millones, ochenta mil.
 * Returns an integer amount or null. A bare small number ("80") is not a price. */
export function parseMoney(text: string): number | null {
  const value = fold(text)
  const millions = value.match(/(\d{1,3}(?:[.,]\d{1,3})?)\s*(?:millon(?:es)?|palos?)\b(\s+y\s+medio\b)?/)
  if (millions) return Math.round(Number(millions[1]!.replace(',', '.')) * 1_000_000) + (millions[2] ? 500_000 : 0)
  // "un millón", "dos palos", "millón y medio", "medio millón".
  if (/\bmedio\s+(?:millon|palo)\b/.test(value)) return 500_000
  const spokenMillions = value.match(new RegExp(`\\b(?:(un|${DIGIT_WORDS}|diez)\\s+)?(?:millon(?:es)?|palos?)\\b(\\s+y\\s+medio\\b)?`))
  if (spokenMillions && (spokenMillions[1] || spokenMillions[2])) return (UNITS[spokenMillions[1] || 'un'] || 1) * 1_000_000 + (spokenMillions[2] ? 500_000 : 0)
  const thousands = value.match(/(\d{1,4}(?:[.,]\d{1,3})?)\s*(?:mil|k|lucas?)\b/)
  if (thousands) {
    const raw = thousands[1]!
    // "80.000 mil" is unusual; "1.5k"/"1,5 mil" are decimals.
    const number = /^\d{1,3}[.,]\d{3}$/.test(raw) ? Number(raw.replace(/[.,]/g, '')) : Number(raw.replace(',', '.'))
    return Number.isFinite(number) && number > 0 ? Math.round(number * 1000) + hundredsAfterMil(value) : null
  }
  const tokens = value.split(/[^a-z0-9]+/).filter(Boolean)
  const milIndex = tokens.indexOf('mil')
  if (milIndex > 0) {
    // Number words right before "mil": "ochenta mil", "ciento ochenta mil", "treinta y cinco mil".
    const run: string[] = []
    for (let k = milIndex - 1; k >= 0 && run.length < 5; k--) {
      const word = tokens[k]!
      if (word === 'y' || HUNDREDS[word] !== undefined || (UNITS[word] !== undefined && word !== 'docena')) run.unshift(word)
      else break
    }
    const amount = run.length ? spanishNumber(run) : null
    if (amount) return amount * 1000 + hundredsAfterMil(value)
  }
  const formatted = value.match(/\$\s*(\d{1,3}(?:[.,]\d{3})+|\d+)|\b(\d{1,3}(?:[.,]\d{3})+|\d{4,9})\b/)
  if (!formatted) return null
  const number = Number((formatted[1] || formatted[2])!.replace(/[.,]/g, ''))
  return Number.isSafeInteger(number) && number > 0 ? number : null
}

/** "dos mil quinientos" → the 500. Only a hundreds word counts, so "80 mil cinco pares" never becomes 80.005. */
function hundredsAfterMil(value: string): number {
  const tokens = value.split(/[^a-z0-9]+/).filter(Boolean)
  const start = tokens.indexOf('mil') + 1
  if (start <= 0 || HUNDREDS[tokens[start] || ''] === undefined) return 0
  const run: string[] = [tokens[start]!]
  for (let k = start + 1; k < tokens.length && run.length < 4; k++) {
    const word = tokens[k]!
    if (word === 'y' || (UNITS[word] !== undefined && word !== 'docena' && UNITS[word]! < 100)) run.push(word)
    else break
  }
  // "quinientos cinco pares": a unit followed by what it counts is a quantity, not part of the price.
  while (run.length > 1 && /^(?:pares?|unidades|unidad|u|de|talla|tallas)$/.test(tokens[start + run.length] || '')) run.pop()
  if (run[run.length - 1] === 'y') run.pop()
  return spanishNumber(run) ?? 0
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
