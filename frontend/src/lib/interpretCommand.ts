export interface Interpretation {
  action: string
  params: Record<string, unknown>
  missing: string[]
  needsConfirmation: boolean
  summary: string
  simulated: boolean
}

export function interpretCommand(text: string): Interpretation {
  const raw = text.trim()
  const lower = raw.toLowerCase()
  const skuMatch = raw.match(/(?:referencia|ref(?:erencia)?|sku)\s*([A-Za-z0-9-]+)/i)
  const priceMatch = raw.match(/precio\s+(\d[\d.]*)/i)
  const stockMatch = raw.match(/stock\s+(\d+)/i)
  const rangeMatch = raw.match(/desde\s+(?:la\s+)?(\d+)\s+hasta\s+(?:la\s+)?(\d+)/i)

  if (/whatsapp/.test(lower)) {
    const phone = raw.match(/(\+?\d{10,15})/)
    if (!phone) {
      return { action: 'update_whatsapp', params: {}, missing: ['whatsappPhone'], needsConfirmation: false, summary: 'Falta el número de WhatsApp.', simulated: true }
    }
    return { action: 'update_whatsapp', params: { whatsappPhone: phone[1] }, missing: [], needsConfirmation: true, summary: `Actualizar WhatsApp a ${phone[1]}.`, simulated: true }
  }

  if (/agrega|añade|crea|tenis|producto/.test(lower)) {
    const sku = skuMatch?.[1]
    const name = raw
      .replace(/agrega|añade|producto/gi, '')
      .replace(/referencia.+$/i, '')
      .replace(/precio.+$/i, '')
      .replace(/stock.+$/i, '')
      .split(',')[0]
      ?.trim()
    const missing: string[] = []
    if (!sku) missing.push('sku')
    if (!name) missing.push('name')
    if (!priceMatch) missing.push('price')
    if (!stockMatch) missing.push('stock')
    if (missing.length) {
      return { action: 'create_product', params: { sku, name }, missing, needsConfirmation: false, summary: `Faltan datos: ${missing.join(', ')}. No invento precios ni stock.`, simulated: true }
    }
    const price = Number(String(priceMatch![1]).replace(/\./g, ''))
    const stock = Number(stockMatch![1])
    const from = rangeMatch ? Number(rangeMatch[1]) : undefined
    const to = rangeMatch ? Number(rangeMatch[2]) : undefined
    const variants = from && to
      ? Array.from({ length: to - from + 1 }, (_, i) => {
          const size = String(from + i)
          return { sku: `${sku}-${size}`, name: `Talla ${size}`, size, stock }
        })
      : [{ sku: `${sku}-UNI`, name: 'Único', stock }]
    const total = variants.reduce((s, v) => s + v.stock, 0)
    return {
      action: 'create_product',
      params: { sku, name, price, variants },
      missing: [],
      needsConfirmation: true,
      summary: `Crear ${name} (${sku}) a ${price} con ${variants.length} variantes y ${total} unidades.`,
      simulated: true,
    }
  }

  return {
    action: 'unknown',
    params: { text: raw },
    missing: [],
    needsConfirmation: false,
    summary: 'No reconocí una acción segura.',
    simulated: true,
  }
}
