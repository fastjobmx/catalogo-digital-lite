import { z } from 'zod'

export const productDraftFieldSchema = z.enum(['name', 'sku', 'description', 'price', 'category', 'variants'])
export type ProductDraftField = z.infer<typeof productDraftFieldSchema>
export type ProductDraftMissingField = ProductDraftField | 'photos'

const productDraftVariantSchema = z.object({
  size: z.string().trim().min(1).max(24).optional(),
  color: z.string().trim().min(1).max(48).optional(),
  stock: z.number().int().nonnegative().optional(),
})

const productDraftImageSchema = z.object({
  tempKey: z.string().min(1),
  telegramFileId: z.string().min(1),
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  extension: z.enum(['jpg', 'png', 'webp']),
  byteLength: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
})

export const telegramProductDraftSchema = z.object({
  version: z.literal(1),
  stage: z.enum(['collecting', 'ready']),
  fields: z.object({
    name: z.string().trim().min(1).max(120).optional(),
    sku: z.string().trim().min(1).max(64).optional(),
    description: z.string().trim().max(2000).optional(),
    brand: z.string().trim().max(80).optional(),
    price: z.number().int().positive().optional(),
    categoryId: z.number().int().positive().optional(),
    categoryName: z.string().trim().min(1).max(80).optional(),
  }),
  variants: z.array(productDraftVariantSchema).max(80),
  images: z.array(productDraftImageSchema).max(10),
  primaryImageIndex: z.number().int().nonnegative(),
  awaiting: productDraftFieldSchema.optional(),
  editField: productDraftFieldSchema.optional(),
  /** Fields proposed by Gemini from the photos; shown as suggestions in the preview. */
  aiSuggested: z.array(z.string().max(30)).max(10).optional(),
  aiAnalyzed: z.boolean().optional(),
  suggestedSku: z.string().trim().max(64).optional(),
  hint: z.string().trim().max(300).optional(),
  defaultColor: z.string().trim().max(48).optional(),
  suggestedCategory: z.string().trim().max(60).optional(),
  visibleBrand: z.string().trim().max(60).optional(),
}).superRefine((draft, ctx) => {
  if (draft.primaryImageIndex >= Math.max(1, draft.images.length)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['primaryImageIndex'], message: 'Invalid primary image index' })
  }
})

export type TelegramProductDraft = z.infer<typeof telegramProductDraftSchema>

export function createTelegramProductDraft(): TelegramProductDraft {
  return { version: 1, stage: 'collecting', fields: {}, variants: [], images: [], primaryImageIndex: 0 }
}

/** Extracts only explicitly supplied product fields from Gemini output. */
export function mergeGeminiProductFields(
  draft: TelegramProductDraft,
  input: Record<string, unknown>,
): TelegramProductDraft {
  const next = structuredClone(draft)
  const fields = next.fields as Record<string, unknown>
  copyText(input, fields, 'name', 120)
  copyText(input, fields, 'sku', 64)
  copyText(input, fields, 'description', 2000)
  copyText(input, fields, 'brand', 80)
  if (typeof input.price === 'number' && Number.isSafeInteger(input.price) && input.price > 0) fields.price = input.price
  const categoryName = input.categoryName ?? input.category
  if (typeof categoryName === 'string' && categoryName.trim()) fields.categoryName = categoryName.trim().slice(0, 80)

  const color = typeof input.color === 'string' && input.color.trim() ? input.color.trim().slice(0, 48) : undefined
  const sizes = Array.isArray(input.sizes) ? input.sizes : null
  const suppliedVariants = Array.isArray(input.variants) ? input.variants : null
  let variants: TelegramProductDraft['variants'] = []
  if (suppliedVariants) {
    variants = suppliedVariants.slice(0, 80).flatMap((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return []
      const item = value as Record<string, unknown>
      const size = explicitText(item.size, 24)
      const itemColor = explicitText(item.color, 48) || color
      const stock = typeof item.stock === 'number' && Number.isSafeInteger(item.stock) && item.stock >= 0 ? item.stock : undefined
      return [{ ...(size ? { size } : {}), ...(itemColor ? { color: itemColor } : {}), ...(stock !== undefined ? { stock } : {}) }]
    })
  } else if (sizes) {
    variants = sizes.slice(0, 80).flatMap((value) => {
      const size = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : explicitText(value, 24)
      return size ? [{ size, ...(color ? { color } : {}) }] : []
    })
  }
  if (variants.length) next.variants = variants
  if (color) next.defaultColor = color
  return next
}

export function missingProductDraftFields(draft: TelegramProductDraft): ProductDraftMissingField[] {
  const missing: ProductDraftMissingField[] = []
  if (!draft.fields.name || draft.fields.name.trim().length < 2) missing.push('name')
  if (!draft.fields.sku || !/^[A-Z0-9][A-Z0-9._-]{2,63}$/.test(draft.fields.sku.trim().toUpperCase())) missing.push('sku')
  if (!draft.fields.description || draft.fields.description.trim().length < 3) missing.push('description')
  if (!draft.fields.price || !Number.isSafeInteger(draft.fields.price) || draft.fields.price <= 0) missing.push('price')
  if (!draft.fields.categoryId || !draft.fields.categoryName) missing.push('category')
  if (!draft.variants.length || draft.variants.some((variant) => !variant.size || !variant.color || variant.stock === undefined)) missing.push('variants')
  if (!draft.images.length) missing.push('photos')
  return missing
}

export function parseProductDraftFieldReply(
  field: ProductDraftField,
  text: string,
  draft: TelegramProductDraft,
): { draft: TelegramProductDraft; error?: string } {
  const value = text.trim()
  const next = structuredClone(draft)
  delete next.awaiting
  delete next.editField
  if (field === 'name') {
    if (value.length < 2 || value.length > 120) return { draft, error: 'El nombre debe tener entre 2 y 120 caracteres.' }
    next.fields.name = value
  } else if (field === 'sku') {
    const sku = value.replace(/^(?:sku|referencia)\s*[:#-]?\s*/i, '').toUpperCase()
    if (!/^[A-Z0-9][A-Z0-9._-]{2,63}$/.test(sku)) return { draft, error: 'Escribe un SKU de 3 a 64 caracteres con letras, números, guion, punto o guion bajo.' }
    next.fields.sku = sku
  } else if (field === 'description') {
    if (value.length < 3 || value.length > 2000) return { draft, error: 'La descripción debe tener entre 3 y 2000 caracteres.' }
    next.fields.description = value
  } else if (field === 'price') {
    const thousands = value.match(/^\$?\s*(\d{1,4})\s*mil(?:\s*pesos)?$/i)
    if (thousands) {
      next.fields.price = Number(thousands[1]) * 1000
      return { draft: next }
    }
    const formatted = value.replace(/(?:pesos|peso|cop|\$|\s)/gi, '')
    if (!/^(?:\d+|\d{1,3}(?:[.,]\d{3})+)$/.test(formatted)) return { draft, error: 'Indica un precio entero válido, por ejemplo 250000 o 250.000.' }
    const digits = formatted.replace(/[.,]/g, '')
    const price = Number(digits)
    if (!Number.isSafeInteger(price) || price <= 0) return { draft, error: 'Indica un precio entero válido, por ejemplo 250000.' }
    next.fields.price = price
  } else if (field === 'variants') {
    const variants = parseVariantStockReply(value, draft.variants, draft.defaultColor)
    if (!variants) return { draft, error: 'Usa el formato talla:stock, por ejemplo 38:3, 39:2. Si hay varios colores, indica “Negro talla 38:3”.' }
    next.variants = variants
  } else if (field === 'category') {
    const categoryName = value.replace(/^categor[ií]a\s*[:=-]?\s*/i, '').trim()
    if (categoryName.length < 1 || categoryName.length > 80) return { draft, error: 'Indica el nombre de una categoría existente.' }
    next.fields.categoryName = categoryName
    delete next.fields.categoryId
  }
  return { draft: next }
}

function parseVariantStockReply(text: string, previous: TelegramProductDraft['variants'], defaultColor?: string): TelegramProductDraft['variants'] | null {
  // Single-size products: "10", "10 unidades", "talla única 10".
  const single = text.trim().match(/^(?:(?:talla\s+)?[uú]nica\s*[:=]?\s*)?(\d{1,6})\s*(?:unidades?|u\.?|pares?|piezas?)?$/i)
  if (single) {
    const color = previous.find((variant) => variant.color)?.color || defaultColor || 'Único'
    return [{ size: 'Única', color, stock: Number(single[1]) }]
  }
  // Accept explicit compact instructions such as “color: negro; tallas 38, 39
  // y 40; stock inicial: 2 unidades por talla” without asking the owner to
  // reformat data they already supplied.
  const natural = text.match(/(?:color\s*[:=]\s*|\b)([\p{L}][\p{L}\s-]{1,30}?)(?=\s+tallas?\b)/iu)
  const naturalSizes = text.match(/tallas?\s*[:=]?\s*([\d\s,;/y.-]+?)(?=\s*(?:stock|$))/iu)
  const uniformStock = text.match(/(?:stock(?:\s+inicial)?\s*[:=]?\s*)(\d+)\s*(?:unidades?\s+)?por\s+talla/iu)
  if (naturalSizes && uniformStock) {
    const color = natural?.[1]?.replace(/^color\s*[:=]?\s*/i, '').trim()
      || (new Set(previous.map((variant) => variant.color).filter(Boolean)).size === 1 ? previous.find((variant) => variant.color)?.color : undefined)
      || defaultColor
    const sizes = naturalSizes[1]!.split(/[\s,;/y.-]+/i).filter(Boolean)
    const stock = Number(uniformStock[1])
    if (color && sizes.length && Number.isSafeInteger(stock) && stock >= 0 && sizes.every((size) => /^\d{1,3}[a-z]?$/i.test(size))) {
      return sizes.map((size) => ({ size, color, stock }))
    }
  }
  const entries = text.split(/[;,]+/).map((part) => part.trim()).filter(Boolean)
  if (!entries.length) return null
  const parsed = entries.map((entry) => {
    const match = entry.match(/^(?:(.+?)\s+)?(?:talla\s*)?(\d{1,3}[a-z]?)\s*[:=]\s*(\d+)$/i)
    if (!match) return null
    const size = match[2]!
    const stock = Number(match[3])
    if (!Number.isSafeInteger(stock) || stock < 0) return null
    const prior = previous.find((variant) => variant.size?.toLowerCase() === size.toLowerCase())
    const color = match[1]?.trim() || prior?.color || (new Set(previous.map((variant) => variant.color).filter(Boolean)).size === 1 ? previous.find((variant) => variant.color)?.color : undefined) || defaultColor
    if (!color) return null
    return { size, color, stock }
  })
  return parsed.every(Boolean) ? parsed as TelegramProductDraft['variants'] : null
}

function copyText(input: Record<string, unknown>, target: Record<string, unknown>, field: string, maxLength: number): void {
  const value = input[field]
  if (typeof value === 'string' && value.trim()) target[field] = value.trim().slice(0, maxLength)
}

function explicitText(value: unknown, maxLength: number): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim().slice(0, maxLength)
  return undefined
}

/** Proposes an internal product code from its name and color (e.g. ZAP-NEG-4821).
 * It is an identifier, not a product fact; the owner can replace it. */
export function suggestSku(name: string | undefined, color?: string): string {
  const clean = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').trim()
  const words = clean(name || 'PRODUCTO').split(/\s+/).filter((word) => word.length > 2)
  const prefix = (words[0] || 'PRO').slice(0, 3)
  const colorPart = color ? clean(color).replace(/\s+/g, '').slice(0, 3) : (words[1] || '').slice(0, 3)
  const digits = String(1000 + (crypto.getRandomValues(new Uint16Array(1))[0]! % 9000))
  return [prefix, colorPart, digits].filter(Boolean).join('-')
}
