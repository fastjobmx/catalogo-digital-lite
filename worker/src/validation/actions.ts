import { z } from 'zod'

const variantSchema = z.object({
  sku: z.string().optional(),
  name: z.string().optional(),
  size: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  stock: z.number().int().nonnegative(),
  priceOverride: z.number().int().nonnegative().nullable().optional(),
})

export const actionSchemas = {
  create_product: z.object({
    sku: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    brand: z.string().optional(),
    categoryId: z.number().int().optional(),
    price: z.number().int().nonnegative(),
    compareAtPrice: z.number().int().positive().nullable().optional(),
    isFeatured: z.boolean().optional(),
    imageUrls: z.array(z.string()).optional(),
    variants: z.array(variantSchema).min(1),
  }),
  update_product: z.object({
    sku: z.string().trim().regex(/^[A-Z0-9][A-Z0-9._-]{2,63}$/i),
    name: z.string().trim().min(2).max(120).optional(),
    description: z.string().trim().min(3).max(2000).optional(),
    isActive: z.boolean().optional(),
  }).strict().refine(({ sku: _sku, ...fields }) => Object.keys(fields).length > 0, 'Indica al menos un campo de producto para cambiar'),
  archive_product: z.object({ sku: z.string().min(1) }),
  restore_product: z.object({ sku: z.string().min(1) }),
  update_stock: z.object({
    sku: z.string().min(1),
    size: z.string().min(1),
    stock: z.number().int().nonnegative(),
    /** Set when the owner reports an entry or exit; the new absolute stock is computed by the server. */
    movementKind: z.enum(['entrada', 'salida']).optional(),
    movementQuantity: z.number().int().positive().max(100000).optional(),
    movementReason: z.string().trim().min(2).max(80).optional(),
  }),
  update_price: z.object({
    sku: z.string().min(1),
    price: z.number().int().nonnegative(),
  }),
  create_category: z.object({
    name: z.string().min(1),
    slug: z.string().optional(),
  }),
  update_category: z.object({
    id: z.number().int(),
    name: z.string().min(1),
  }),
  delete_category: z.object({ id: z.number().int() }),
  set_featured_products: z.object({ skus: z.array(z.string().trim().min(1).max(64)).min(1).max(20) }),
  update_store_name: z.object({ name: z.string().trim().min(2).max(80).regex(/^[\p{L}\p{N}][\p{L}\p{N} .&'’_-]*$/u) }),
  update_store_colors: z.object({
    primaryColor: z.string().regex(/^#?[0-9a-fA-F]{6}$/),
    /** Full legible palette prepared by the assistant (logo or named color). */
    palette: z.object(Object.fromEntries(
      ['background', 'surface', 'text', 'textMuted', 'border', 'primary', 'secondary', 'accent', 'button', 'buttonText']
        .map((key) => [key, z.string().regex(/^#[0-9a-fA-F]{6}$/)]),
    ) as Record<'background' | 'surface' | 'text' | 'textMuted' | 'border' | 'primary' | 'secondary' | 'accent' | 'button' | 'buttonText', z.ZodString>).strict().optional(),
  }).strict(),
  update_hero_title: z.object({ title: z.string().trim().min(3).max(100).refine((value) => !/[\u0000-\u001f\u007f]/.test(value)) }),
  update_store_logo: z.object({ logoUrl: z.string().min(1) }),
  update_store_banner: z.object({ coverImageUrl: z.string().min(1) }),
  update_whatsapp: z.object({ whatsappPhone: z.string().trim().min(9).max(20).refine((value) => {
    const normalized = value.replace(/[\s().-]/g, '')
    return /^\+[1-9]\d{7,14}$/.test(normalized)
  }, 'whatsappPhone must be an international number with country code') }),
  update_business_hours: z.object({ hours: z.string().trim().min(3).max(300) }),
  update_business_info: z.object({
    address: z.string().trim().max(300).optional(),
    phone: z.string().trim().max(40).optional(),
    email: z.string().trim().email().max(254).optional(),
  }).refine((value) => Object.values(value).some((item) => item !== undefined), 'Indica dirección, teléfono o correo'),
  update_social_links: z.object({
    instagram: z.string().trim().max(200).optional(),
    facebook: z.string().trim().max(200).optional(),
    tiktok: z.string().trim().max(200).optional(),
  }).strict().refine((value) => Object.values(value).some((item) => item !== undefined), 'Indica al menos una red social')
    .refine((value) => Object.values(value).every((item) => item === undefined || item === '' || /^https:\/\/[^\s]+$/i.test(item) || /^@?[A-Za-z0-9._]{2,60}$/.test(item)), 'Usa un enlace https o un usuario válido'),
  hide_out_of_stock: z.object({}).strict(),
  move_products_to_category: z.object({
    skus: z.array(z.string().trim().min(1).max(64)).min(1).max(50),
    categoryName: z.string().trim().min(2).max(60),
  }).strict(),
  get_inventory: z.object({ sku: z.string().optional() }),
  get_products: z.object({ query: z.string().optional() }),
  get_store_configuration: z.object({}),
  get_low_stock: z.object({ threshold: z.number().int().min(0).max(1000).optional() }),
  get_out_of_stock: z.object({}),
  get_products_without_description: z.object({}),
  get_products_without_photos: z.object({}),
  get_pending_orders: z.object({}),
  get_top_products: z.object({ days: z.number().int().min(1).max(365).optional() }),
  get_sales_summary: z.object({ days: z.number().int().min(1).max(365).optional() }),
  catalog_advice: z.object({}),
  get_sales_by_period: z.object({ days: z.number().int().min(1).max(365).optional(), granularity: z.enum(['dia', 'semana', 'mes']).optional() }),
  get_slow_movers: z.object({ days: z.number().int().min(1).max(365).optional() }),
  get_size_rotation: z.object({ days: z.number().int().min(1).max(365).optional() }),
  get_repeat_customers: z.object({ days: z.number().int().min(1).max(365).optional() }),
  get_profitability: z.object({}),
  ask_ai: z.object({ question: z.string().trim().min(2).max(1000) }),
  write_description: z.object({ sku: z.string().trim().min(1).max(64), tone: z.string().trim().max(60).optional() }),
}

/** Actions that only read data or prepare drafts; they never mutate the store. */
export const READ_ONLY_ACTIONS: ReadonlySet<string> = new Set([
  'get_inventory', 'get_products', 'get_store_configuration', 'get_low_stock', 'get_out_of_stock',
  'get_products_without_description', 'get_products_without_photos', 'get_pending_orders',
  'get_top_products', 'get_sales_summary', 'catalog_advice', 'ask_ai', 'write_description',
  'get_sales_by_period', 'get_slow_movers', 'get_size_rotation', 'get_repeat_customers', 'get_profitability',
])

export type ActionName = keyof typeof actionSchemas

export const ACTION_NAMES = Object.keys(actionSchemas) as ActionName[]

export function parseActionPayload(input: unknown): { success: true; data: { action: ActionName; params: unknown } } | { success: false; error: string } {
  if (!input || typeof input !== 'object' || !('action' in input)) {
    return { success: false, error: 'Falta action' }
  }
  const action = (input as { action: string }).action as ActionName
  if (!(action in actionSchemas)) {
    return { success: false, error: `Acción no permitida: ${action}` }
  }
  const params = (input as { params?: unknown }).params ?? input
  const parsed = actionSchemas[action].safeParse(params)
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((i) => i.message).join(', ') }
  }
  return { success: true, data: { action, params: parsed.data } }
}
