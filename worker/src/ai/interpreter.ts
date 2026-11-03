import { z } from 'zod'
import { ActionName, parseActionPayload } from '../validation/actions'

export interface Interpretation {
  action: ActionName | 'unknown' | 'ask'
  params: Record<string, unknown>
  missing: string[]
  needsConfirmation: boolean
  summary: string
  simulated: boolean
}

const SIZE_RANGE = /desde\s+(?:la\s+)?(\d+)\s+hasta\s+(?:la\s+)?(\d+)/i
const STOCK_EACH = /stock\s+(\d+)/i
const PRICE = /precio\s+(\d[\d.]*)/i
const REF = /(?:referencia|ref(?:erencia)?|sku)\s*([A-Za-z0-9-]+)/i

export function interpretCommand(text: string): Interpretation {
  const raw = text.trim()
  const lower = raw.toLowerCase()

  const editName = raw.match(/\b(?:cambia|cambiar|actualiza|modifica)\s+(?:el\s+)?nombre\s+(?:de\s+)?(?:el\s+)?(?:producto\s+)?(?:sku\s+)?([A-Z0-9][A-Z0-9._-]{2,63})\s+(?:a|por)\s+["“]?(.+?)["”]?\s*$/i)
  const editDescription = raw.match(/\b(?:cambia|cambiar|actualiza|modifica)\s+(?:la\s+)?descripci[oó]n\s+(?:de\s+)?(?:el\s+)?(?:producto\s+)?(?:sku\s+)?([A-Z0-9][A-Z0-9._-]{2,63})\s+(?:a|por)\s+["“]?([\s\S]+?)["”]?\s*$/i)
  const editPublication = raw.match(/\b(?:activa|desactiva|publica|oculta)\s+(?:la\s+)?(?:publicaci[oó]n\s+de\s+)?(?:producto\s+)?(?:sku\s+)?([A-Z0-9][A-Z0-9._-]{2,63})\b/i)
  const hasSkuMarker = (value: string | undefined) => Boolean(value && /[0-9._-]/.test(value))
  const edit = editName && hasSkuMarker(editName[1]) ? { sku: editName[1]!, name: editName[2]!.trim() }
    : editDescription && hasSkuMarker(editDescription[1]) ? { sku: editDescription[1]!, description: editDescription[2]!.trim() }
      : editPublication && hasSkuMarker(editPublication[1]) ? { sku: editPublication[1]!, isActive: /^(?:activa|publica)$/i.test(raw.trim()) }
        : null
  if (!edit && /\b(?:cambia|cambiar|actualiza|modifica)\s+(?:el\s+)?(?:nombre|descripci[oó]n)\b/i.test(raw) && !/\b(?:nombre|descripci[oó]n)\s+de\s+mi\s+tienda\b/i.test(raw)) {
    return { action: 'ask', params: {}, missing: ['SKU exacto y valor nuevo'], needsConfirmation: false, summary: 'Para editar un producto necesito su SKU exacto y el nuevo valor.', simulated: true }
  }
  if (edit) {
    const parsed = parseActionPayload({ action: 'update_product', params: edit })
    if (!parsed.success) return { action: 'ask', params: {}, missing: ['un valor válido de nombre o descripción'], needsConfirmation: false, summary: 'El cambio no cumple las reglas del producto.', simulated: true }
    return { action: 'update_product', params: parsed.data.params as Record<string, unknown>, missing: [], needsConfirmation: true, summary: `Editar producto ${edit.sku} con el campo indicado.`, simulated: true }
  }

  if (/crea(r)? mi tienda|empezar|onboarding/.test(lower)) {
    return {
      action: 'ask',
      params: { flow: 'onboarding' },
      missing: [],
      needsConfirmation: false,
      summary: 'Iniciar cuestionario de configuración de la tienda.',
      simulated: true,
    }
  }

  // Parse explicit stock changes deterministically so a clear command does not
  // depend on Gemini inferring the variant size from Spanish phrasing.
  const stockChangeIntent = /\b(?:fija|pon|establece|actualiza|cambia|cambiar|ajusta|modifica|deja)\b/.test(lower)
    && /\b(?:existencia|stock|inventario)\b/.test(lower)
  if (stockChangeIntent) {
    const labelledSku = raw.match(REF)?.[1]
    // Hyphenated codes (TEST-TRN-001) or alphanumeric codes with letters and digits (ABC123).
    const skuCandidates = [...new Set([...raw.matchAll(/\b[A-Z0-9]+(?:-[A-Z0-9]+)+\b|\b(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{3,64}\b/gi)].map((match) => match[0]))]
    const sku = labelledSku || (skuCandidates.length === 1 ? skuCandidates[0] : undefined)
    const size = raw.match(/\btalla\s+(\d{1,3}[a-z]?)\b/i)?.[1]
    const quantity = raw.match(/\b(?:en|a)\s+(\d+)\s*(?:unidades?|pares?)?\b/i)?.[1]
    const missing = [
      ...(!sku ? ['referencia/SKU'] : []),
      ...(!size ? ['talla'] : []),
      ...(!quantity ? ['cantidad de unidades'] : []),
    ]
    if (missing.length) {
      return {
        action: 'ask', params: {}, missing, needsConfirmation: false,
        summary: `Para cambiar stock necesito ${missing.join(', ')}.`, simulated: true,
      }
    }
    const params = { sku: sku!, size: size!, stock: Number(quantity) }
    const parsed = parseActionPayload({ action: 'update_stock', params })
    if (!parsed.success) {
      return {
        action: 'ask', params: {}, missing: ['valores válidos de referencia, talla y stock'],
        needsConfirmation: false, summary: 'No pude validar el cambio de stock.', simulated: true,
      }
    }
    return {
      action: 'update_stock', params: parsed.data.params as Record<string, unknown>, missing: [],
      needsConfirmation: true,
      summary: `Fijar ${params.stock} unidades para ${params.sku}, talla ${params.size}.`,
      simulated: true,
    }
  }

  if (/inventario|stock total|cuánto tengo/.test(lower)) {
    return {
      action: 'get_inventory',
      params: {},
      missing: [],
      needsConfirmation: false,
      summary: 'Consultar inventario por variante.',
      simulated: true,
    }
  }

  if (/lista(?:r)? productos|qué productos/.test(lower)) {
    return {
      action: 'get_products',
      params: {},
      missing: [],
      needsConfirmation: false,
      summary: 'Listar productos activos.',
      simulated: true,
    }
  }

  const nameMatch = raw.match(/(?:cambia|cambiar|actualiza|pon|establece)\s+(?:el\s+)?(?:nombre(?:\s+comercial)?)(?:\s+de\s+mi\s+tienda)?\s+(?:a|por|como)\s+["“]?(.+?)["”]?$/i)
  if (nameMatch?.[1]) {
    const name = nameMatch[1].trim()
    const parsed = parseActionPayload({ action: 'update_store_name', params: { name } })
    if (parsed.success) return { action: 'update_store_name', params: parsed.data.params as Record<string, unknown>, missing: [], needsConfirmation: true, summary: `Cambiar nombre comercial a ${name}.`, simulated: true }
    return { action: 'ask', params: {}, missing: ['nombre comercial válido (2–80 caracteres)'], needsConfirmation: false, summary: 'El nombre propuesto no cumple el formato permitido.', simulated: true }
  }

  const heroTitleMatch = raw.match(/(?:cambia(?:r)?\s+)?(?:el\s+)?(?:t[ií]tulo(?:\s+principal)?(?:\s+de\s+portada)?|portada)\s+(?:de\s+mi\s+tienda\s+)?(?:a|por|como)\s+["“]?(.+?)["”]?$/i)
  if (heroTitleMatch?.[1]) {
    const title = heroTitleMatch[1].trim()
    const parsed = parseActionPayload({ action: 'update_hero_title', params: { title } })
    if (parsed.success) return { action: 'update_hero_title', params: parsed.data.params as Record<string, unknown>, missing: [], needsConfirmation: true, summary: `Cambiar título de portada a “${title}”.`, simulated: true }
    return { action: 'ask', params: {}, missing: ['título de portada válido (3–100 caracteres)'], needsConfirmation: false, summary: 'El título propuesto no cumple el formato permitido.', simulated: true }
  }

  const namedColors: Record<string, string> = {
    'azul oscuro': '#153D70', 'azul marino': '#153D70', 'azul': '#2563EB',
    'negro': '#171717', 'blanco': '#FFFFFF', 'rojo': '#C62828',
    'verde': '#237A57', 'verde oscuro': '#185C43', 'beige': '#D9D0C1',
    'gris': '#6B7280', 'morado': '#6D28D9', 'naranja': '#C2410C',
  }
  const namedColor = Object.keys(namedColors).sort((a, b) => b.length - a.length).find((color) => lower.includes(color) && /color|tienda|botones|p[aá]gina/.test(lower))
  if (namedColor || /color(?:es)?\s+(primario|principal)/.test(lower)) {
    const hex = raw.match(/#([0-9a-fA-F]{6})/)
    const color = hex ? `#${hex[1]}` : namedColor ? namedColors[namedColor] : undefined
    if (!color) return { action: 'ask', params: {}, missing: ['color principal inequívoco o hexadecimal'], needsConfirmation: false, summary: 'Indica un color como “azul oscuro” o un hexadecimal como #153D70.', simulated: true }
    return {
      action: 'update_store_colors',
      params: { primaryColor: color },
      missing: [],
      needsConfirmation: true,
      summary: `Cambiar color principal a ${color}.`,
      simulated: true,
    }
  }

  if (/whatsapp/.test(lower)) {
    const phone = raw.match(/(\+[\d\s().-]{8,20}\d)/)
    if (!phone) {
      return { action: 'ask', params: {}, missing: ['whatsapp internacional con prefijo +país'], needsConfirmation: false, summary: 'Escribe el WhatsApp con código internacional, por ejemplo +573506912734.', simulated: true }
    }
    const whatsappPhone = phone[1]!.replace(/[\s().-]/g, '')
    const parsed = parseActionPayload({ action: 'update_whatsapp', params: { whatsappPhone } })
    if (!parsed.success) return { action: 'ask', params: {}, missing: ['whatsapp internacional válido'], needsConfirmation: false, summary: 'El WhatsApp debe incluir el prefijo internacional y entre 8 y 15 dígitos.', simulated: true }
    return {
      action: 'update_whatsapp',
      params: { whatsappPhone },
      missing: [],
      needsConfirmation: true,
      summary: `Actualizar WhatsApp a ${phone[1]}.`,
      simulated: true,
    }
  }

  if (/agrega|añade|crea(r)?\s+(un\s+)?producto|tenis|producto/.test(lower)) {
    const skuMatch = raw.match(REF)
    const priceMatch = raw.match(PRICE)
    const stockMatch = raw.match(STOCK_EACH)
    const rangeMatch = raw.match(SIZE_RANGE)
    const sku = skuMatch?.[1] || extractDigitsSku(raw)
    const name = extractProductName(raw)
    const missing: string[] = []
    if (!sku) missing.push('sku')
    if (!name) missing.push('name')
    if (!priceMatch) missing.push('price')
    if (missing.length) {
      return {
        action: 'create_product',
        params: { sku, name },
        missing,
        needsConfirmation: false,
        summary: `Faltan datos obligatorios: ${missing.join(', ')}. No invento precios ni stock.`,
        simulated: true,
      }
    }
    const price = Number(String(priceMatch![1]).replace(/\./g, ''))
    const stock = stockMatch ? Number(stockMatch[1]) : undefined
    if (stock === undefined) missing.push('stock')
    const from = rangeMatch ? Number(rangeMatch[1]) : undefined
    const to = rangeMatch ? Number(rangeMatch[2]) : undefined
    const variants = from && to && stock !== undefined
      ? Array.from({ length: to - from + 1 }, (_, i) => {
          const size = String(from + i)
          return { sku: `${sku}-${size}`, name: `Talla ${size}`, size, stock }
        })
      : stock !== undefined
        ? [{ sku: `${sku}-UNI`, name: 'Único', stock }]
        : []
    const total = variants.reduce((s, v) => s + v.stock, 0)
    return {
      action: 'create_product',
      params: { sku, name, price, variants },
      missing: stock === undefined ? ['stock'] : [],
      needsConfirmation: true,
      summary: `Crear ${name} (${sku}) a ${price} con ${variants.length} variantes y ${total} unidades en total.`,
      simulated: true,
    }
  }

  try {
    const json = JSON.parse(raw)
    const parsed = parseActionPayload(json)
    if (parsed.success) {
      return {
        action: parsed.data.action,
        params: parsed.data.params as Record<string, unknown>,
        missing: [],
        needsConfirmation: true,
        summary: `Acción ${parsed.data.action} validada.`,
        simulated: true,
      }
    }
  } catch { /* not json */ }

  return {
    action: 'unknown',
    params: { text: raw },
    missing: [],
    needsConfirmation: false,
    summary: 'No reconocí una acción segura. Usa un comando concreto o configura Gemini.',
    simulated: true,
  }
}

function extractDigitsSku(text: string): string | undefined {
  const m = text.match(/\b(\d{3,})\b/)
  return m?.[1]
}

function extractProductName(text: string): string | undefined {
  const cleaned = text
    .replace(/agrega|añade|producto/gi, '')
    .replace(/referencia.+$/i, '')
    .replace(/precio.+$/i, '')
    .replace(/stock.+$/i, '')
    .trim()
  return cleaned.split(',')[0]?.trim() || undefined
}

export const GeminiProposalSchema = z.object({
  action: z.string(),
  params: z.record(z.unknown()).default({}),
  missing: z.array(z.string()).default([]),
  needsConfirmation: z.boolean().default(true),
  summary: z.string(),
})
