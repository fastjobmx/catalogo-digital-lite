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
    sku: z.string().min(1),
    name: z.string().optional(),
    description: z.string().optional(),
    price: z.number().int().nonnegative().optional(),
    isFeatured: z.boolean().optional(),
  }),
  archive_product: z.object({ sku: z.string().min(1) }),
  restore_product: z.object({ sku: z.string().min(1) }),
  update_stock: z.object({
    sku: z.string().min(1),
    size: z.string().min(1),
    stock: z.number().int().nonnegative(),
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
  set_featured_products: z.object({ skus: z.array(z.string()).max(20) }),
  update_store_name: z.object({ name: z.string().min(1) }),
  update_store_colors: z.object({
    primaryColor: z.string().regex(/^#?[0-9a-fA-F]{6}$/).optional(),
    secondaryColor: z.string().regex(/^#?[0-9a-fA-F]{6}$/).optional(),
    accentColor: z.string().regex(/^#?[0-9a-fA-F]{6}$/).optional(),
  }),
  update_store_logo: z.object({ logoUrl: z.string().min(1) }),
  update_store_banner: z.object({ coverImageUrl: z.string().min(1) }),
  update_whatsapp: z.object({ whatsappPhone: z.string().min(8) }),
  update_business_hours: z.object({ hours: z.string().min(1) }),
  update_business_info: z.object({
    address: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().optional(),
  }),
  get_inventory: z.object({ sku: z.string().optional() }),
  get_products: z.object({ query: z.string().optional() }),
  get_store_configuration: z.object({}),
}

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
