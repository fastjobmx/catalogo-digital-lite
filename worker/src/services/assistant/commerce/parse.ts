/** Deterministic interpreter for everyday commerce messages ("me llegaron 10 camisetas 4 m 3 l",
 * "ponle el precio en 80mil", "las blancas ya no quedan"). It only extracts what is written; missing
 * or contradictory data is left for the planner to ask about. */
import { commerceIntentSchema, type CommerceIntent, type StockLine } from './intent'
import { ambiguousAmount, colorOf, fold, FILLER, numberWordsToDigits, parseMoney, quantityOf, sizeOf } from './language'
import { parseSizeLayouts } from './layouts'

const VERB_WORDS = new Set(fold([
  'pon', 'ponle', 'ponlo', 'ponla', 'ponlos', 'ponlas', 'ponles', 'poner', 'pone', 'pongan', 'deja', 'dejalo', 'dejala', 'dejalos', 'dejalas', 'dejar', 'dejame',
  'quita', 'quitale', 'quitar', 'quite', 'saca', 'sacale', 'sacar', 'borra', 'borrale', 'borrar', 'resta', 'restale', 'restar', 'vendi', 'vendimos', 'vendieron', 'vendio',
  'salio', 'salieron', 'llegaron', 'llego', 'entraron', 'entro', 'sube', 'subele', 'subile', 'subir', 'subirle', 'baja', 'bajale', 'bajile', 'bajar', 'bajarle',
  'cambia', 'cambiale', 'cambiar', 'crea', 'creame', 'crear', 'mete', 'metele', 'meter', 'mueve', 'muevelo', 'muevela', 'pasa', 'pasalo', 'pasala', 'pasame', 'dame',
  'manda', 'mandame', 'envia', 'enviame', 'agotaron', 'agoto', 'acabaron', 'acabo', 'terminaron', 'termino', 'cuesta', 'cuestan', 'vale', 'valen', 'nombre',
  'llama', 'llamar', 'link', 'enlace', 'url', 'foto', 'fotos', 'imagen', 'imagenes', 'fotografia', 'categoria', 'descripcion', 'son', 'es', 'era', 'eran',
  'hazme', 'haz', 'corregi', 'corrige', 'corregir', 'correccion', 'desactiva', 'desactivalo', 'desactivala', 'activa', 'activalo', 'activala', 'reactiva', 'oculta',
  'ocultalo', 'ocultala', 'muestra', 'muestrame', 'ensename', 'dime', 'decime', 'necesito', 'quiero', 'tienes', 'tiene', 'tienen', 'van', 'estan', 'esta', 'quedo',
  'agotado', 'agotados', 'agotada', 'agotadas', 'nuevo', 'nueva', 'nuevos', 'nuevas', 'otra', 'vez', 'favor', 'publica', 'publicalo', 'registra', 'sube', 'agrega',
  'agregale', 'agregar', 'suma', 'sumale', 'sumar', 'anade', 'anadele', 'recibi', 'recibimos', 'compre', 'compramos', 'anota', 'anotale', 'carga', 'cargale', 'ajusta',
  'ajustale', 'actualiza', 'actualizale', 'aumenta', 'aumentale', 'rebaja', 'rebajale', 'reduce', 'reducele', 'hay', 'tengo', 'tenemos', 'queda', 'quedan', 'quedaron',
].join('|')).split('|'))

const CONNECTORS = new Set(['unidades', 'unidad', 'u', 'pares', 'par', 'piezas', 'pieza', 'de', 'la', 'las', 'los', 'el', 'en', 'del', 'color', 'talla', 'tallas', 'numero', 'num'])
const SKU_LIKE = /^(?=[a-z0-9._-]*\d)(?=[a-z0-9._-]*[a-z])[a-z0-9][a-z0-9._-]{2,63}$/i

type Token = { raw: string; word: string }

function tokenize(text: string): Token[] {
  return text.split(/[\s,;]+/).map((raw) => raw.replace(/^[¿¡"“(]+|[.!?:"”)]+$/g, '')).filter(Boolean).map((raw) => ({ raw, word: fold(raw) }))
}

/** Product words left after removing verbs, quantities, sizes, colours, prices and filler. */
function productWords(tokens: Token[], used: Set<number>, extraSkip: Set<string> = new Set()): string | null {
  const words = tokens.filter((token, index) => {
    if (used.has(index) || extraSkip.has(token.word)) return false
    if (SKU_LIKE.test(token.word)) return true
    if (FILLER.has(token.word) || VERB_WORDS.has(token.word) || CONNECTORS.has(token.word)) return false
    if (quantityOf(token.word) !== null || sizeOf(token.word) || colorOf(token.word)) return false
    if (/^\$|^\d|mil$|^\d+k$/.test(token.word) || token.word.length < 2) return false
    return true
  }).map((token) => SKU_LIKE.test(token.word) ? token.raw.toUpperCase() : token.raw)
  const query = words.join(' ').trim().slice(0, 80)
  return query.length >= 2 ? query : null
}

/** Walks the message collecting "N [color] [talla] SIZE" lines, bare quantities and listed sizes. */
export function parseStockLines(text: string): { lines: StockLine[]; bare: Array<{ quantity: number; index: number }>; used: Set<number>; colors: string[]; sizes: string[]; firstLineIndex: number } {
  const tokens = tokenize(numberWordsToDigits(text))
  const used = new Set<number>()
  const lines: StockLine[] = []
  const bare: Array<{ quantity: number; index: number }> = []
  let firstLineIndex = -1
  let openLine: StockLine | null = null
  // Layouts that list sizes first or by range ("M 5, L 8", "de la 38 a la 42, tres de cada una").
  const layout = parseSizeLayouts(tokens)
  if (layout) {
    layout.lines.forEach((line) => lines.push(line))
    layout.used.forEach((index) => used.add(index))
    firstLineIndex = Math.min(...layout.used)
  }
  for (let i = 0; i < tokens.length; i++) {
    if (used.has(i)) continue
    const word = tokens[i]!.word
    // "38:3", "m=4": size with its quantity.
    const pair = word.match(/^([a-z0-9.]{1,5})[:=](\d{1,5})$/)
    if (pair && sizeOf(pair[1])) {
      lines.push({ quantity: Number(pair[2]), size: sizeOf(pair[1]), color: null }); used.add(i)
      if (firstLineIndex < 0) firstLineIndex = i
      continue
    }
    // "talla 38": a size that completes the line being read ("3 negras talla 38"). Otherwise it stays
    // as a size filter for the whole message ("vendí 2 camisetas talla m", "talla 38 y 39").
    if (word === 'talla' || word === 'tallas' || word === 'numero') {
      const size = sizeOf(tokens[i + 1]?.word)
      const target = openLine && !openLine.size ? openLine : null
      if (size && target) { target.size = size; openLine = null; used.add(i); used.add(i + 1) }
      continue
    }
    const quantity = quantityOf(word)
    const previous = tokens[i - 1]?.word
    if (quantity === null || previous === 'talla' || previous === 'tallas') continue
    // A number followed by its attributes: "4 m", "3 negras", "2 de la 39", "5 unidades talla l".
    let color: string | null = null
    let size: string | null = null
    let j = i + 1
    // Once a numeric shoe size was assigned in this message ("cuatro talla 38"), a number right after a
    // quantity is the next size ("cuatro 39 y cuatro 40").
    const shoeMode = lines.some((line) => line.size && /^\d/.test(line.size))
    for (; j < tokens.length && j <= i + 5; j++) {
      const next = tokens[j]!.word
      if (used.has(j)) break
      const spokenSize = quantityOf(next)
      if (shoeMode && !size && j === i + 1 && spokenSize !== null && spokenSize >= 20 && spokenSize <= 50) { size = sizeOf(String(spokenSize)); used.add(j); continue }
      if (quantityOf(next) !== null && !sizeOf(next)) break
      if (next === 'talla' || next === 'tallas' || next === 'numero') {
        const listed = sizeOf(tokens[j + 1]?.word)
        if (listed && !size) { size = listed; used.add(j); used.add(j + 1); j++; continue }
        break
      }
      if (!size && sizeOf(next) && (j === i + 1 || CONNECTORS.has(tokens[j - 1]!.word) || colorOf(tokens[j - 1]!.word))) {
        // A bare number after a quantity is a size only when it looks like one (letters, or a shoe size after "de la").
        if (/^\d/.test(next) && !(CONNECTORS.has(tokens[j - 1]!.word) || colorOf(tokens[j - 1]!.word))) break
        size = sizeOf(next); used.add(j); continue
      }
      if (!color && colorOf(next)) { color = colorOf(next); used.add(j); continue }
      if (CONNECTORS.has(next)) continue
      break
    }
    used.add(i)
    if (size || color) {
      const line: StockLine = { quantity, size, color }
      lines.push(line)
      openLine = size ? null : line
      if (firstLineIndex < 0) firstLineIndex = i
    } else {
      bare.push({ quantity, index: i })
    }
  }
  const colors = tokens.filter((token, index) => !used.has(index) && colorOf(token.word)).map((token) => colorOf(token.word)!)
  const sizes: string[] = []
  tokens.forEach((token, index) => {
    if (used.has(index) || !sizeOf(token.word)) return
    // Only sizes introduced by "talla(s)" or letter sizes count as a filter ("las m", "talla 38 y 39").
    if (/^[a-z]/.test(token.word) || tokens.slice(Math.max(0, index - 4), index).some((before) => before.word.startsWith('talla'))) sizes.push(sizeOf(token.word)!)
  })
  return { lines, bare, used, colors, sizes, firstLineIndex }
}

function result(intent: unknown): CommerceIntent | null {
  const parsed = commerceIntentSchema.safeParse(intent)
  return parsed.success ? parsed.data : null
}

function capitalize(value: string): string {
  return value.charAt(0).toLocaleUpperCase('es') + value.slice(1)
}

/** Creating a product. Explicit verbs (créame, registra, publica…) always mean a new product; "agrega/añade"
 * counts as new only with an indefinite article ("agrega unos tenis…"), because "agrega 3 negras talla 38" is a restock. */
const CREATE = /^(?:por\s+favor\s+|porfa\s+)?(?:creame|crea|crear|registrame|registra|publicame|publica|subeme|sube|quiero\s+(?:crear|publicar|vender|subir)|nuevo\s+producto:?|(?:agregame|agrega|anademe|anade|aniademe|aniade)\s+(?=(?:un|una|unos|unas)\b))\s*(?:(?:un|una|unos|unas|nuevo|nueva|nuevos|nuevas)\s+)?/

function parseCreate(text: string, lower: string): CommerceIntent | null {
  const head = lower.match(CREATE)
  if (!head) return null
  // Spoken compound numbers become digits, keeping the original capitals (brands).
  const original = numberWordsToDigits(text, true)
  const folded = fold(original)
  const priceMatch = folded.match(/\b(?:a|en|por|precio(?:\s+de)?|vale[n]?|cuesta[n]?)\s+(\$?\s*[\d.,]+\s*(?:mil|k|lucas?|millon(?:es)?)?|\w+(?:\s+y\s+\w+)?\s+mil)\b/)
  const priceStart = priceMatch?.index ?? folded.length
  const price = priceMatch ? parseMoney(priceMatch[1]!) : null
  const priceAsk = !price ? ambiguousAmount(folded) : null
  const region = original.slice(head[0].length, priceStart)
  const tokens = tokenize(region)
  const words = tokens.map((token) => ({ raw: token.raw, word: fold(token.raw) }))
  const layout = parseSizeLayouts(words)
  const reference = region.match(/\b(?:referencia|ref\.?|sku|c[oó]digo)\s*[:#-]?\s*([A-Za-z0-9][A-Za-z0-9._-]{2,63})\b/i)?.[1]?.toUpperCase() ?? null
  const used = new Set<number>(layout?.used || [])
  words.forEach((token, index) => { if (reference && token.word === fold(reference)) used.add(index) })
  let stocks: Array<{ size: string; quantity: number }> = (layout?.lines || []).map((line) => ({ size: line.size!, quantity: line.quantity }))
  const sizes: string[] = stocks.map((stock) => stock.size)
  if (!layout) {
    // Quantity-first: "5 unidades talla M".
    const lines = parseStockLines(region).lines
    if (lines.length && lines.every((line) => line.size)) stocks = lines.map((line) => ({ size: line.size!, quantity: line.quantity }))
    stocks.forEach((stock) => sizes.push(stock.size))
  }
  let color: string | null = null
  let colorWord: string | null = null
  let brand: string | null = null
  const nouns: string[] = []
  let inSizes = false
  for (let i = 0; i < words.length; i++) {
    if (used.has(i)) continue
    const word = words[i]!.word
    const raw = words[i]!.raw
    if (word === 'talla' || word === 'tallas') { inSizes = true; continue }
    if (inSizes && (sizeOf(word) || word === 'y' || word === 'e')) {
      if (sizeOf(word) && !sizes.includes(sizeOf(word)!)) sizes.push(sizeOf(word)!)
      continue
    }
    inSizes = false
    if (word === 'marca') { brand = tokens[i + 1]?.raw || null; i++; continue }
    if (colorOf(word)) { if (!color) { color = colorOf(word); colorWord = word } continue }
    if (['cada', 'una', 'uno', 'referencia', 'ref', 'sku', 'codigo'].includes(word) || FILLER.has(word) || VERB_WORDS.has(word) || /^\d/.test(word) || quantityOf(word) !== null) continue
    // A capitalised word after the product noun is read as the brand ("sandalias negras Guess").
    if (!brand && nouns.length && /^\p{Lu}/u.test(raw)) { brand = raw; continue }
    nouns.push(word)
  }
  if (!nouns.length) return null
  const name = [capitalize(nouns.join(' ')), brand, colorWord].filter(Boolean).join(' ')
  return result({ kind: 'create_product', name, brand, color, sizes: [...new Set(sizes)], price, sku: reference, stocks, priceAsk })
}

function parseCorrection(lower: string): CommerceIntent | null {
  const size = lower.match(/\btallas?\s+(?:es|era|son|eran|correcta\s+es)\s+(?:la\s+)?(\S+?)\s*,?\s+(?:y\s+)?no\s+(?:la\s+|es\s+(?:la\s+)?)?(?:talla\s+)?(\S+)/)
    || lower.match(/\bno\s+(?:es|era)\s+(?:la\s+)?(?:talla\s+)?(\S+?)\s*,?\s+(?:es|era|sino)\s+(?:la\s+)?(?:talla\s+)?(\S+)/)
  if (size) {
    const reversed = /^no\b|\bno\s+(?:es|era)\b/.test(size[0]!)
    const [to, from] = reversed ? [size[2], size[1]] : [size[1], size[2]]
    if (sizeOf(to) && sizeOf(from)) return result({ kind: 'correction', field: 'size', from: sizeOf(from), to: sizeOf(to)!, size: null, color: null })
  }
  const quantity = lower.match(/\b(?:las?|los?|de\s+la|en\s+la)\s+(\S+?)\s+(?:son|eran|es|quedan|van|serian)\s+(\S+?)\s*,?\s+(?:y\s+)?no\s+(\S+)/)
  if (quantity && (sizeOf(quantity[1]) || colorOf(quantity[1])) && quantityOf(quantity[2]) !== null && quantityOf(quantity[3]) !== null) {
    return result({ kind: 'correction', field: 'quantity', from: String(quantityOf(quantity[3])), to: String(quantityOf(quantity[2])), size: sizeOf(quantity[1]), color: sizeOf(quantity[1]) ? null : colorOf(quantity[1]) })
  }
  const bare = lower.match(/^\s*(?:no|perdon|mejor)\s*,?\s+(?:eran|son|era|fueron|serian)?\s*(\S+?)\s*(?:unidades|pares)?\s*\.?\s*$/)
  if (bare && quantityOf(bare[1]) !== null) return result({ kind: 'correction', field: 'quantity', from: null, to: String(quantityOf(bare[1])), size: null, color: null })
  const price = lower.match(/\bprecio\s+(?:es|era|seria|son)\s+(?:de\s+)?(.+?)\s*,?\s+(?:y\s+)?no\s+(.+)$/)
  if (price && parseMoney(price[1]!)) return result({ kind: 'correction', field: 'price', from: price[2] ? String(parseMoney(price[2]) ?? '') || null : null, to: String(parseMoney(price[1]!)), size: null, color: null })
  const color = lower.match(/\b(?:es|son|eran|era)\s+(\S+?)\s*,?\s+(?:y\s+)?no\s+(\S+)/)
  if (color && colorOf(color[1]) && colorOf(color[2])) return result({ kind: 'correction', field: 'color', from: colorOf(color[2]), to: colorOf(color[1])!, size: null, color: null })
  return null
}

/** Parses one message into a commerce intent, or null when it is not a commerce request. */
export function parseCommerce(raw: string): CommerceIntent | null {
  const text = raw.trim()
  if (!text || text.startsWith('/') || text.length > 400) return null
  const lower = numberWordsToDigits(text)
  const tokens = tokenize(text)
  const question = /\?\s*$/.test(text) || /^(?:cuant[oa]s?|que|cual(?:es)?|como|donde|dime|decime|muestrame|mostrame|ensename|ver|lista)\b/.test(lower)

  if (/\b(?:corrig\w*|correg\w*|perdon|me\s+equivoque|error)\b/.test(lower) || /^\s*(?:no|mejor)\s*,?\s+\S+(?:\s+\S+)?\s*\.?$/.test(lower) ||/\bno\s+(?:es|era)\b|\s+no\s+\S+\s*$/.test(lower)) {
    const correction = parseCorrection(lower)
    if (correction) return correction
  }

  if (/\b(?:quit|borr|elimin|sac)\w*\s+(?:(?:esa|la|esta|una|aquella|el|las|esas)\s+)?(?:foto|fotos|imagen|imagenes|fotografia)\b/.test(lower)) {
    return result({ kind: 'remove_photo', product: productWords(tokens, new Set(), new Set(['deja', 'dejala', 'otra', 'otras', 'primera', 'segunda', 'ultima'])) })
  }

  const created = parseCreate(text, lower)
  if (created) return created

  const rename = text.match(/(?:cambia(?:le)?|pon(?:le)?|actualiza(?:le)?)\s+(?:el\s+)?nombre\s+(?:de\s+|a\s+|al?\s+)?(.+?)\s+(?:a|por|como)\s+["“']?(.{2,120}?)["”']?$/i)
  if (rename) return result({ kind: 'rename', product: rename[1]!.replace(/^(?:la|las|el|los|producto)\s+/i, '').trim(), name: rename[2]!.trim() })

  const category = text.match(/(?:pasa|mueve|cambia|pon|mete)\w*\s+(.+?)\s+(?:a|en)\s+(?:la\s+)?categor[ií]a\s+["“']?([^"”']{1,60})["”']?\s*$/i)
  if (category && (category[1]!.match(/[A-Z0-9]*\d[A-Z0-9-]*/gi) || []).filter((token) => /[a-z]/i.test(token)).length < 2) {
    return result({ kind: 'set_category', product: category[1]!.replace(/^(?:la|las|el|los|producto|productos)\s+/i, '').trim() || null, category: category[2]!.trim() })
  }

  const description = text.match(/descripci[oó]n\s+(?:de|del|a|al)\s+(.+?)\s*:\s*(.{3,2000})$/i)
  if (description) return result({ kind: 'set_description', product: description[1]!.replace(/^(?:la|las|el|los)\s+/i, '').trim(), description: description[2]!.trim() })

  if (/\b(?:link|enlace|url)\b/.test(lower) && !/\btienda\b/.test(lower)) {
    return result({ kind: 'product_link', product: productWords(tokens, new Set(), new Set(['producto'])) })
  }

  if (/\b(?:desactiv|ocult|despublic|esconde|retira)\w*/.test(lower) && !/agotad|sin\s+(?:stock|existencias|unidades)/.test(lower)) {
    return result({ kind: 'set_active', active: false, product: productWords(tokens, new Set()) })
  }
  if (/\b(?:reactiv\w*|activa(?:lo|la|los|las)?|vuelve\s+a\s+(?:mostrar|publicar))\b/.test(lower)) {
    return result({ kind: 'set_active', active: true, product: productWords(tokens, new Set()) })
  }

  // Prices: "subile 10 mil a las sandalias", "ponle el precio en 80mil", "las sandalias valen 90 mil".
  const percent = lower.match(/(\d{1,3})\s*(?:%|por\s*ciento)/)
  const money = percent ? Number(percent[1]) : parseMoney(lower)
  const hasMoneyMarker = /\d\s*(?:mil|k|lucas?)\b|\$|\d{1,3}[.,]\d{3}|\b\w+\s+mil\b|millon/.test(lower)
  if (money && (percent || hasMoneyMarker || /\bprecio\b/.test(lower))) {
    const used = new Set<number>()
    tokens.forEach((token, index) => { if (/^\$?\d|mil$|^k$|^lucas?$|%/.test(token.word)) used.add(index) })
    const product = productWords(tokens, used, new Set(['precio', 'mil', 'pesos', 'ciento', 'por']))
    if (/\b(?:sub\w*|aument\w*|encarec\w*)\b/.test(lower)) return result({ kind: 'price', mode: 'increase', amount: money, percent: Boolean(percent), product })
    if (/\b(?:baj[ae]\w*|bajil\w*|rebaj\w*|reduc\w*)\b/.test(lower)) return result({ kind: 'price', mode: 'decrease', amount: money, percent: Boolean(percent), product })
    if (!percent && (/\bprecio\b|\b(?:cuesta|cuestan|vale|valen)\b/.test(lower) || /\b(?:pon\w*|deja\w*|cambia\w*)\b/.test(lower))) {
      return result({ kind: 'price', mode: 'set', amount: money, percent: false, product })
    }
  }

  // A bare small amount ("precio 180") is ambiguous: ask, never assume $180 or $180.000.
  const maybe = ambiguousAmount(lower)
  if (maybe && !money && /\b(?:precio|vale[n]?|cuesta[n]?|pon\w*|deja\w*|cambia\w*|sub\w*|baj\w*)\b/.test(lower)) {
    const used = new Set<number>()
    tokens.forEach((token, index) => { if (/^\$?\d/.test(token.word)) used.add(index) })
    const product = productWords(tokens, used, new Set(['precio']))
    const mode = /\b(?:sub\w*|aument\w*)\b/.test(lower) ? 'increase' : /\b(?:baj\w*|rebaj\w*|reduc\w*)\b/.test(lower) ? 'decrease' : 'set'
    return result({ kind: 'price_clarify', mode, amount: maybe, product })
  }

  const parsed = parseStockLines(text)
  const soldOut = /\b(?:ya\s+no\s+(?:me\s+)?(?:quedan?|hay|tengo|tenemos)|no\s+(?:me\s+)?quedan?(?:\s+mas)?|se\s+(?:me\s+)?(?:agotaron|agoto|acabaron|acabo|terminaron|termino)|(?:estan|quedaron|quedo)\s+agotad[oa]s?|sin\s+existencias)\b/.test(lower)
  if (soldOut && !question && !/\b(?:que|cuales|cosas|productos)\b/.test(lower) && !parsed.lines.length && !parsed.bare.length) {
    return result({ kind: 'sold_out', product: productWords(tokens, parsed.used), color: parsed.colors[0] ?? null, size: parsed.sizes[0] ?? null })
  }

  // General questions about the catalogue ("productos con menos de cinco unidades", "qué cosas ya no
  // tengo") belong to the existing reports, not to one product.
  const general = /\b(?:productos|cosas|cuales|todos|todas|menos\s+de|mas\s+de|agotad\w*|bajo|poco|vendid\w*)\b/.test(lower)
  if (question && general) return null
  if (question && /\b(?:quedan?|hay|tengo|tenemos|stock|existencias|inventario|unidades)\b/.test(lower) && !parsed.lines.length) {
    return result({ kind: 'stock_query', product: productWords(tokens, parsed.used) })
  }
  if (/^(?:stock|existencias|inventario)\s+(?:de|del)\s+/.test(lower)) return result({ kind: 'stock_query', product: productWords(tokens, parsed.used) })

  if (!parsed.lines.length && !parsed.bare.length) return null
  const remove = /\b(?:vendi\w*|vendimos|salieron|salio|se\s+(?:me\s+)?danaron|danad\w*|resta\w*|descont\w*|saca\w*|quita\w*|regale\w*)\b/.test(lower)
  const add = /\b(?:llegaron|llego|entraron|entro|ingres\w*|recibi\w*|agreg\w*|anad\w*|sum\w*|repus\w*|compr[eaoi]\w*|anot\w*|mete\w*|carga\w*)\b/.test(lower)
  const set = /\b(?:quedan|queda|hay|tengo|tenemos|ajust\w*|(?:deja|pon)\w*\s+en|existencias?|stock|inventario)\b/.test(lower)
  const ask = /^(?:pon\w*|deja\w*|actualiza\w*|cambia\w*)\b/.test(lower) && !set
  const mode = remove ? 'remove' : add ? 'add' : set ? 'set' : ask ? 'ask' : null
  if (!mode) return null
  let lines = parsed.lines
  let total: number | null = null
  // "10 camisetas negras talla M y 8 talla L": a size with no quantity of its own takes the lone bare quantity
  // (when that quantity is not simply the total of the other lines).
  const sumOfLines = lines.reduce((sum, line) => sum + line.quantity, 0)
  if (lines.length && parsed.bare.length === 1 && parsed.sizes.length === 1 && lines.every((line) => line.size) && parsed.bare[0]!.quantity !== sumOfLines
    && !lines.some((line) => line.size === parsed.sizes[0])) {
    lines = [{ quantity: parsed.bare[0]!.quantity, size: parsed.sizes[0]!, color: null }, ...lines]
  } else if (lines.length && parsed.bare.length === 1 && parsed.bare[0]!.index < parsed.firstLineIndex) total = parsed.bare[0]!.quantity
  else if (!lines.length && parsed.bare.length === 1) lines = [{ quantity: parsed.bare[0]!.quantity, size: parsed.sizes.length === 1 ? parsed.sizes[0]! : null, color: parsed.colors.length === 1 ? parsed.colors[0]! : null }]
  else if (!lines.length) return null
  // A colour mentioned once for the whole message applies to the lines without one ("3 m y 2 l negras").
  const color = parsed.colors.length === 1 ? parsed.colors[0]! : null
  if (color) lines = lines.map((line) => ({ ...line, color: line.color || color }))
  const product = productWords(tokens, parsed.used)
  return result({ kind: 'stock', mode, product, total, lines, color, size: parsed.sizes.length === 1 && lines.every((line) => !line.size) ? parsed.sizes[0]! : null })
}
