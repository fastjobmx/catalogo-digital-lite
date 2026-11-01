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

  if (/color(?:es)?\s+(primario|principal)/.test(lower)) {
    const hex = raw.match(/#([0-9a-fA-F]{6})/)
    if (!hex) {
      return { action: 'update_store_colors', params: {}, missing: ['primaryColor'], needsConfirmation: false, summary: 'Falta el color hexadecimal.', simulated: true }
    }
    return {
      action: 'update_store_colors',
      params: { primaryColor: `#${hex[1]}` },
      missing: [],
      needsConfirmation: true,
      summary: `Cambiar color primario a #${hex[1]}.`,
      simulated: true,
    }
  }

  if (/whatsapp/.test(lower)) {
    const phone = raw.match(/(\+?\d{10,15})/)
    if (!phone) {
      return { action: 'update_whatsapp', params: {}, missing: ['whatsappPhone'], needsConfirmation: false, summary: 'Falta el número de WhatsApp.', simulated: true }
    }
    return {
      action: 'update_whatsapp',
      params: { whatsappPhone: phone[1] },
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
