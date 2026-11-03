import { actionSchemas, READ_ONLY_ACTIONS, type ActionName } from '../validation/actions'
import {
  getInventoryTool, lowStockTool, outOfStockTool, pendingOrdersTool, salesSummaryTool, searchProductsTool,
  storeSummaryTool, topProductsTool, withoutDescriptionTool, withoutPhotosTool, type ToolResult,
} from '../services/assistant/tools'

export type ReadScope = { storeId: number; currency: string }

/**
 * Executes a validated read-only action inside one store. Mutations are never
 * executed here: they go through confirmed, transactional operations.
 */
export async function executeReadAction(
  db: D1Database,
  action: ActionName,
  params: unknown,
  scope: ReadScope,
): Promise<{ ok: boolean; message: string; skus?: string[] }> {
  if (!READ_ONLY_ACTIONS.has(action)) return { ok: false, message: 'Esa acción modifica la tienda y necesita una confirmación.' }
  const parsed = actionSchemas[action].safeParse(params ?? {})
  if (!parsed.success) return { ok: false, message: 'Necesito un dato más para responder: ' + parsed.error.issues.map((issue) => issue.message).join(', ') }
  const p = parsed.data as Record<string, unknown>
  const { storeId, currency } = scope
  let result: ToolResult
  switch (action) {
    case 'get_inventory': result = await getInventoryTool(db, storeId, currency, typeof p.sku === 'string' ? p.sku : undefined); break
    case 'get_products': result = await searchProductsTool(db, storeId, currency, typeof p.query === 'string' ? p.query : undefined); break
    case 'get_store_configuration': result = await storeSummaryTool(db, storeId); break
    case 'get_low_stock': result = await lowStockTool(db, storeId, currency, typeof p.threshold === 'number' ? p.threshold : 5); break
    case 'get_out_of_stock': result = await outOfStockTool(db, storeId, currency); break
    case 'get_products_without_description': result = await withoutDescriptionTool(db, storeId, currency); break
    case 'get_products_without_photos': result = await withoutPhotosTool(db, storeId, currency); break
    case 'get_pending_orders': result = await pendingOrdersTool(db, storeId); break
    case 'get_top_products': result = await topProductsTool(db, storeId, currency, typeof p.days === 'number' ? p.days : 30); break
    case 'get_sales_summary': result = await salesSummaryTool(db, storeId, currency, typeof p.days === 'number' ? p.days : 30); break
    default: return { ok: false, message: 'Esta consulta necesita el asistente de IA.' }
  }
  return { ok: true, message: result.text, skus: result.skus }
}
