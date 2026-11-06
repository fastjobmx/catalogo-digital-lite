/** Structured commerce intents. The deterministic parser and the AI extractor both produce this
 * validated shape; neither can touch the database. Products are named in words here and resolved to
 * real ids later by the backend. */
import { z } from 'zod'

const product = z.string().trim().max(80).nullable()
const line = z.object({
  quantity: z.number().int().min(0).max(100000),
  size: z.string().trim().max(12).nullable(),
  color: z.string().trim().max(30).nullable(),
})
export type StockLine = z.infer<typeof line>

export const commerceIntentSchema = z.discriminatedUnion('kind', [
  /** Stock change. mode 'ask' = the owner did not say whether to add or set ("pon 5"). */
  z.object({
    kind: z.literal('stock'), mode: z.enum(['add', 'set', 'remove', 'ask']), product,
    total: z.number().int().positive().max(100000).nullable(), lines: z.array(line).max(40),
    color: z.string().trim().max(30).nullable(), size: z.string().trim().max(12).nullable(),
  }),
  /** "las blancas ya no quedan": stock 0 for the matching variants. */
  z.object({ kind: z.literal('sold_out'), product, color: z.string().trim().max(30).nullable(), size: z.string().trim().max(12).nullable() }),
  z.object({ kind: z.literal('price'), mode: z.enum(['set', 'increase', 'decrease']), amount: z.number().int().positive().max(10_000_000_000), percent: z.boolean(), product }),
  /** Fixes the pending proposal: "las m son 5 no 3", "la talla es 39 no 38". */
  z.object({
    kind: z.literal('correction'), field: z.enum(['quantity', 'size', 'color', 'price']),
    from: z.string().trim().max(30).nullable(), to: z.string().trim().min(1).max(30),
    size: z.string().trim().max(12).nullable(), color: z.string().trim().max(30).nullable(),
  }),
  z.object({ kind: z.literal('remove_photo'), product }),
  z.object({
    kind: z.literal('create_product'), name: z.string().trim().min(2).max(120), brand: z.string().trim().max(60).nullable(),
    color: z.string().trim().max(30).nullable(), sizes: z.array(z.string().trim().min(1).max(12)).max(30), price: z.number().int().positive().nullable(),
  }),
  z.object({ kind: z.literal('stock_query'), product }),
  z.object({ kind: z.literal('product_link'), product }),
  z.object({ kind: z.literal('set_active'), active: z.boolean(), product }),
  z.object({ kind: z.literal('rename'), product, name: z.string().trim().min(2).max(120) }),
  z.object({ kind: z.literal('set_category'), product, category: z.string().trim().min(1).max(60) }),
  z.object({ kind: z.literal('set_description'), product, description: z.string().trim().min(3).max(2000) }),
])
export type CommerceIntent = z.infer<typeof commerceIntentSchema>
