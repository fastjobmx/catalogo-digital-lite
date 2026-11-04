/** Deterministic Spanish intents for the most frequent requests. They avoid an
 * AI call (and its cost) when the meaning is unambiguous; everything else goes
 * to Gemini, which can only answer with typed actions. */

export type Intent =
  | { kind: 'greeting' }
  | { kind: 'thanks' }
  | { kind: 'menu' }
  | { kind: 'help' }
  | { kind: 'switch_store' }
  | { kind: 'start_product'; hint: string; count?: number }
  | { kind: 'palette_ideas' }
  | { kind: 'template_ideas' }
  | { kind: 'change_store_image'; target: 'banner' | 'logo' }
  | { kind: 'attach_photos'; sku: string }
  | { kind: 'action'; action: string; params: Record<string, unknown>; summary?: string }
  | { kind: 'needs_sku'; action: 'update_price' | 'write_description'; extra: Record<string, unknown> }

const NUMBER_WORDS: Record<string, number> = {
  un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, veinte: 20, treinta: 30, cincuenta: 50,
}

export function parseSpanishNumber(value: string | undefined): number | null {
  if (!value) return null
  const trimmed = value.trim().toLowerCase()
  if (/^\d+$/.test(trimmed)) return Number(trimmed)
  return NUMBER_WORDS[trimmed] ?? null
}

/** Parses "180.000", "180000", "$180.000 pesos" or "180 mil" into an integer amount. */
export function parseAmount(value: string): number | null {
  const thousands = value.match(/(\d{1,4})\s*mil\b/i)
  if (thousands) return Number(thousands[1]) * 1000
  const match = value.match(/\$?\s*(\d{1,3}(?:[.,]\d{3})+|\d+)/)
  if (!match) return null
  const number = Number(match[1]!.replace(/[.,]/g, ''))
  return Number.isSafeInteger(number) && number > 0 ? number : null
}

const SKU_TOKEN = /\b(?=[A-Z0-9._-]*[0-9._-])[A-Z0-9][A-Z0-9._-]{2,63}\b/i

function explicitSkus(text: string): string[] {
  const labelled = [...text.matchAll(/(?:sku|c[oó]digo|referencia|ref\.?)\s*:?\s*([A-Z0-9][A-Z0-9._-]{1,63})/gi)].map((match) => match[1]!.toUpperCase())
  const tokens = [...text.matchAll(new RegExp(SKU_TOKEN.source, 'gi'))].map((match) => match[0]!.toUpperCase())
    .filter((token) => /[A-Z]/i.test(token) && !/^\d{1,3}(?:\.\d{3})+$/.test(token))
  return [...new Set([...labelled, ...tokens])]
}

function referencesRecent(text: string): boolean {
  return /\b(este|esta|estos|estas|ese|esa|esos|esas)\s+(producto|productos|zapatos|tenis|art[ií]culos?|referencias?|prendas?)\b|\b(ese|este)\b\s*$/i.test(text)
}

function daysFromText(text: string, fallback = 30): number {
  if (/esta semana|la semana|7 d[ií]as/.test(text)) return 7
  if (/hoy/.test(text)) return 1
  if (/este mes|del mes|el mes/.test(text)) return Math.max(1, new Date().getUTCDate())
  if (/a[nñ]o/.test(text)) return 365
  const explicit = text.match(/[uú]ltimos?\s+(\d{1,3})\s+d[ií]as/)
  return explicit ? Math.min(365, Number(explicit[1])) : fallback
}

export function detectIntent(raw: string, recentSkus: string[] = []): Intent | null {
  const text = raw.trim()
  const lower = text.toLowerCase()
  const words = lower.split(/\s+/).filter(Boolean)

  if (words.length <= 5 && /^(hola|holi|buen[oa]s?(\s+(d[ií]as|tardes|noches))?|hey|qu[eé] tal|saludos|ey)\b/.test(lower)) return { kind: 'greeting' }
  if (words.length <= 5 && /^(gracias|muchas gracias|mil gracias|listo,? gracias|perfecto,? gracias|ok gracias)\b/.test(lower)) return { kind: 'thanks' }
  if (/^(men[uú]|inicio|opciones)$/.test(lower)) return { kind: 'menu' }
  if (/^(ayuda|qu[eé] puedes hacer|c[oó]mo funcionas)\??$/.test(lower)) return { kind: 'help' }
  if (/cambiar de tienda|otra tienda|mis tiendas|cambiar tienda/.test(lower)) return { kind: 'switch_store' }

  const attach = text.match(/(?:agrega|añade|sube|carga|pon)\w*\s+(?:estas\s+|las\s+|unas\s+)?(?:fotos?|fotograf[ií]as|im[aá]genes)\s+(?:al|a|en el|para el)\s+(?:producto\s+)?(?:con\s+)?(?:sku|c[oó]digo|referencia)?\s*:?\s*([A-Z0-9][A-Z0-9._-]{1,63})/i)
  if (attach) return { kind: 'attach_photos', sku: attach[1]!.toUpperCase() }

  if (/(cambia|cambiar|pon|poner|actualiza|reemplaza|nuevo|nueva)\w*\b.*\b(banner|imagen principal|foto principal|portada|foto de portada|imagen de portada)\b/.test(lower) && !/t[ií]tulo|del producto|de un producto|de (los|mis) productos/.test(lower)) return { kind: 'change_store_image', target: 'banner' }
  if (/(cambia|cambiar|pon|poner|actualiza|reemplaza|nuevo)\w*\b.*\blog(o|otipo)\b/.test(lower)) return { kind: 'change_store_image', target: 'logo' }

  // Colors and templates: offer options with a real preview instead of guessing one value.
  if (!/#[0-9a-f]{6}\b/i.test(text)) {
    const colorWord = /\b(colou?r(es)?|paleta|tonos?)\b/
    if ((/(c[oó]mo|puedo|quiero|quisiera|d[oó]nde|ay[uú]dame)\b.*\b(cambi|modific|eleg|escog|pon|ajust|personaliz|mejor)\w*/.test(lower) && colorWord.test(lower))
      || (/(mu[eé]strame|ens[eé][nñ]ame|c[oó]mo (se )?(ver[ií]a|quedar[ií]a|luce|lucir[ií]a)|pru[eé]ba|probar|\bver\b)/.test(lower) && /\b(tonos?|paleta|colores)\b/.test(lower))
      || /^(colores|paletas?|cambiar (los )?colores)\??$/.test(lower)) return { kind: 'palette_ideas' }
    if (/(c[oó]mo|puedo|quiero|quisiera|d[oó]nde|mu[eé]strame)\b.*\b(cambi|eleg|escog|ver|prob)\w*\b.*\b(plantillas?|dise[nñ]o de (la|mi) tienda|estilo de (la|mi) tienda)\b/.test(lower)
      || /^(plantillas?|ver plantillas|cambiar (la )?plantilla)\??$/.test(lower)) return { kind: 'template_ideas' }
  }

  if (/(oculta|ocultar|esconde|esconder|desactiva|quita|quitar)\w*\b.*\b(agotad|sin stock|sin existencias|sin unidades)/.test(lower)) {
    return { kind: 'action', action: 'hide_out_of_stock', params: {}, summary: 'Ocultar productos agotados.' }
  }

  // Commercial indicators (read-only, computed from confirmed orders only).
  if (/rentabilidad|ganancias?|utilidad(es)?|m[aá]rgen(es)?/.test(lower)) return { kind: 'action', action: 'get_profitability', params: {} }
  if (/rotaci[oó]n.*talla|tallas?\s+(?:que\s+)?m[aá]s\s+(?:se\s+)?vend|qu[eé]\s+tallas?\s+(?:se\s+)?vend/.test(lower)) return { kind: 'action', action: 'get_size_rotation', params: { days: daysFromText(lower, 60) } }
  if (/sin\s+movimiento|no\s+se\s+(?:han\s+)?vend|no\s+(?:he|han|hemos)\s+vendido|productos?\s+(?:quietos|estancados|lentos|parados)/.test(lower)) return { kind: 'action', action: 'get_slow_movers', params: { days: daysFromText(lower, 60) } }
  if (/clientes?\s+(?:recurrentes|frecuentes|fieles|que\s+repiten|que\s+vuelven)|(?:vuelven|repiten)\s+a\s+comprar/.test(lower)) return { kind: 'action', action: 'get_repeat_customers', params: { days: daysFromText(lower, 180) } }
  const period = lower.match(/ventas\s+(?:por|de\s+cada|cada)\s+(d[ií]a|semana|mes)|ventas\s+(diarias|semanales|mensuales)/)
  if (period) {
    const word = period[1] || period[2] || ''
    const granularity = /d[ií]a|diarias/.test(word) ? 'dia' : /mes|mensuales/.test(word) ? 'mes' : 'semana'
    return { kind: 'action', action: 'get_sales_by_period', params: { days: daysFromText(lower, granularity === 'mes' ? 180 : 30), granularity } }
  }

  const low = lower.match(/(?:menos de|menor a|por debajo de|bajo|poco)\s+(\d+|[a-záéíóúñ]+)?\s*(?:unidades|stock|existencias|inventario)/)
  if (low || /stock bajo|poco stock|por agotarse|se est[aá]n agotando/.test(lower)) {
    const threshold = parseSpanishNumber(low?.[1]) ?? 5
    return { kind: 'action', action: 'get_low_stock', params: { threshold } }
  }
  if (/\b(agotados?|sin stock|sin existencias)\b/.test(lower) && /(cu[aá]les|mu[eé]strame|ver|lista|tengo|hay|qu[eé])/.test(lower)) return { kind: 'action', action: 'get_out_of_stock', params: {} }
  if (/sin descripci[oó]n|no tienen descripci[oó]n|falta(n)? descripci/.test(lower)) return { kind: 'action', action: 'get_products_without_description', params: {} }
  if (/sin fotos?|no tienen fotos?|sin im[aá]genes/.test(lower)) return { kind: 'action', action: 'get_products_without_photos', params: {} }
  if (/pedidos?\s+(pendientes|sin (confirmar|atender|responder))/.test(lower)) return { kind: 'action', action: 'get_pending_orders', params: {} }
  if (/m[aá]s vendid|lo que m[aá]s (se )?vend|productos? estrella|top de ventas/.test(lower)) return { kind: 'action', action: 'get_top_products', params: { days: daysFromText(lower) } }
  if (/(c[oó]mo (van|me (fue|va))|resumen de|cu[aá]nto (vend|he vendido)).*(ventas|pedidos|vend)|ventas (de|del|este|esta)/.test(lower)) return { kind: 'action', action: 'get_sales_summary', params: { days: daysFromText(lower) } }
  if (/(mejorar|optimizar).*(cat[aá]logo|tienda|ventas)|consejos?|recomendaci[oó]n(es)?|qu[eé] me recomiendas/.test(lower)) return { kind: 'action', action: 'catalog_advice', params: {} }

  const descriptionRequest = /(escribe|redacta|mejora|genera|crea|hazme|haz)\w*\b.*\bdescripci[oó]n/.test(lower)
  if (descriptionRequest) {
    const sku = explicitSkus(text)[0] || (referencesRecent(text) && recentSkus.length === 1 ? recentSkus[0] : undefined)
    if (!sku) return { kind: 'needs_sku', action: 'write_description', extra: {} }
    const tone = lower.match(/m[aá]s\s+(atractiva|formal|corta|divertida|elegante|juvenil)/)?.[1]
    return { kind: 'action', action: 'write_description', params: { sku, ...(tone ? { tone } : {}) } }
  }

  const priceChange = /(cambia|cambiar|pon|poner|actualiza|ajusta|sube|baja|deja)\w*\b.*\bprecio\b/.test(lower)
  if (priceChange) {
    const amountText = text.split(/\b(?:a|en|por)\b/i).slice(1).join(' ') || text
    const price = parseAmount(amountText)
    const skus = explicitSkus(text.replace(/\$?\s*\d{1,3}(?:[.,]\d{3})+/g, ' '))
    const sku = skus[0] || (referencesRecent(text) && recentSkus.length === 1 ? recentSkus[0] : undefined)
    if (price && sku) return { kind: 'action', action: 'update_price', params: { sku, price }, summary: `Cambiar el precio de ${sku}.` }
    if (price && !sku) return { kind: 'needs_sku', action: 'update_price', extra: { price } }
  }

  const featured = text.match(/(?:pon|marca|deja|destaca)\w*\s+(.+?)\s+como\s+destacados?/i)
  if (featured || /(?:pon|marca|deja)\w*\s+(?:estos|estos\s+\w+)\s+(?:productos\s+)?(?:como\s+)?destacados?/i.test(text)) {
    const skus = explicitSkus(featured?.[1] || text)
    const resolved = skus.length ? skus : referencesRecent(text) ? recentSkus.slice(0, 20) : []
    if (resolved.length) return { kind: 'action', action: 'set_featured_products', params: { skus: resolved } }
  }

  const category = text.match(/(?:organiza|mueve|pasa|agrupa|pon)\w*\s+(.*?)\s*(?:en|a)\s+(?:una\s+)?(?:nueva\s+)?(?:la\s+)?categor[ií]a\s+["“']?([^"”']{2,60})["”']?\s*$/i)
  if (category) {
    const skus = explicitSkus(category[1] || '')
    const resolved = skus.length ? skus : referencesRecent(category[1] || text) ? recentSkus.slice(0, 50) : []
    if (resolved.length) return { kind: 'action', action: 'move_products_to_category', params: { skus: resolved, categoryName: category[2]!.trim() } }
  }

  if (/^(?:quiero |voy a |necesito |me gustar[ií]a )?(?:agregar|añadir|subir|crear|publicar|registrar|cargar)\w*\s+(?:un |una |unos |unas |el |la |los |las |nuevo |nueva )?(?:producto|productos|art[ií]culo|.{3,60})$/i.test(text)
    && !/precio|stock|categor|tienda|cuenta|usuario|fotos? (al|a|del)|descripci|banner|logo|horario|whatsapp/.test(lower)) {
    const hint = text.replace(/^(?:quiero |voy a |necesito |me gustar[ií]a )?(?:agregar|añadir|subir|crear|publicar|registrar|cargar)\w*\s+/i, '').replace(/^(?:un|una|unos|unas|el|la|los|las)\s+(?:nuevo\s+|nueva\s+)?/i, '').replace(/^(?:producto|productos)\s*/i, '').slice(0, 120)
    const many = hint.match(/^(\d{1,2}|[a-zñ]+)\s+(?:productos|art[ií]culos|referencias)\b/i)
    const count = many ? parseSpanishNumber(many[1]) : null
    return count && count > 1 ? { kind: 'start_product', hint: '', count } : { kind: 'start_product', hint }
  }
  return null
}
