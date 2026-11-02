import { actionSchemas, type ActionName } from '../validation/actions'
import { createCatalogCategory, createCatalogProduct, deactivateCatalogCategory, updateCatalogCategory, updateCatalogProduct, updateProductInventory, updateProductPrice, updateStoreConfiguration } from '../services/business'

export async function executeAction(
  db: D1Database,
  action: ActionName,
  params: unknown,
  actor: string,
): Promise<{ ok: boolean; message: string; data?: unknown }> {
  const parsed = actionSchemas[action].safeParse(params ?? {})
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues.map((i) => i.message).join(', ') }
  }
  const p = parsed.data as Record<string, unknown>
  const context = { actor, source: 'telegram' as const }

  const audit = async (entity: string, id: string, payload: unknown) => {
    await db.prepare(
      `INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source) VALUES (?, ?, ?, ?, ?, 'telegram')`,
    ).bind(action, entity, id, JSON.stringify(payload), actor).run()
  }

  switch (action) {
    case 'create_product': {
      const sku = String(p.sku)
      try {
        const result = await createCatalogProduct(db, p as Parameters<typeof createCatalogProduct>[1], context)
        const variants = (p.variants as Array<{ stock: number }>) || []
        const total = variants.reduce((sum, variant) => sum + variant.stock, 0)
        return { ok: true, message: `Producto ${sku} publicado con ${variants.length} variantes y ${total} unidades.`, data: result }
      } catch (error) {
        if (error instanceof Error && error.message === 'SKU_ALREADY_EXISTS') {
          const existing = await db.prepare('SELECT name FROM products WHERE sku = ?').bind(sku).first()
          return { ok: false, message: `El SKU ${sku} ya existe (${(existing as { name: string } | null)?.name || 'sin nombre'}). Ofrece actualizarlo en lugar de duplicarlo.` }
        }
        throw error
      }
    }
    case 'update_price': {
      const sku = String(p.sku)
      const updated = await updateProductPrice(db, sku, Number(p.price), context)
      return updated ? { ok: true, message: `Precio de ${sku} actualizado.` } : { ok: false, message: `No se encontró un producto activo con SKU ${sku}.` }
    }
    case 'update_product': {
      const sku = String(p.sku)
      const fields = Object.fromEntries(Object.entries(p).filter(([key]) => key !== 'sku'))
      const updated = await updateCatalogProduct(db, { sku }, fields, context)
      return updated ? { ok: true, message: `Producto ${sku} actualizado.` } : { ok: false, message: 'Producto no encontrado o sin campos válidos.' }
    }
    case 'archive_product':
      await db.prepare(`UPDATE products SET is_archived = 1, is_active = 0, updated_at = datetime('now') WHERE sku = ?`).bind(String(p.sku)).run()
      await audit('product', String(p.sku), p)
      return { ok: true, message: `Producto ${p.sku} archivado.` }
    case 'restore_product':
      await db.prepare(`UPDATE products SET is_archived = 0, is_active = 1, updated_at = datetime('now') WHERE sku = ?`).bind(String(p.sku)).run()
      await audit('product', String(p.sku), p)
      return { ok: true, message: `Producto ${p.sku} restaurado.` }
    case 'update_stock': {
      const changes = await updateProductInventory(db, String(p.sku), Number(p.stock), context, p.size ? String(p.size) : undefined)
      return changes ? { ok: true, message: 'Stock actualizado.', data: { variants: changes } } : { ok: false, message: 'No se encontró el producto o variante solicitados.' }
    }
    case 'create_category': {
      const name = String(p.name)
      const slug = String(p.slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-'))
      try {
        await createCatalogCategory(db, { name, slug }, context)
        return { ok: true, message: `Categoría ${name} creada.` }
      } catch (error) {
        if (error instanceof Error && error.message === 'CATEGORY_SLUG_EXISTS') return { ok: false, message: `La categoría ${slug} ya existe.` }
        throw error
      }
    }
    case 'update_category': {
      try {
        await updateCatalogCategory(db, Number(p.id), { name: String(p.name) }, context)
        return { ok: true, message: 'Categoría actualizada.' }
      } catch (error) {
        if (error instanceof Error && error.message === 'CATEGORY_NOT_FOUND') return { ok: false, message: 'Categoría no encontrada.' }
        throw error
      }
    }
    case 'delete_category': {
      const changed = await deactivateCatalogCategory(db, Number(p.id), context)
      return changed ? { ok: true, message: 'Categoría desactivada.' } : { ok: false, message: 'Categoría no encontrada o ya inactiva.' }
    }
    case 'set_featured_products': {
      const skus = p.skus as string[]
      await db.prepare('UPDATE products SET is_featured = 0').run()
      for (const sku of skus) {
        await db.prepare('UPDATE products SET is_featured = 1 WHERE sku = ?').bind(sku).run()
      }
      return { ok: true, message: 'Destacados actualizados.' }
    }
    case 'update_store_name':
      await updateStoreConfiguration(db, { name: p.name }, context)
      return { ok: true, message: 'Nombre de tienda actualizado.' }
    case 'update_store_colors': {
      await updateStoreConfiguration(db, {
        ...(p.primaryColor ? { primary_color: normalizeHex(String(p.primaryColor)) } : {}),
        ...(p.secondaryColor ? { secondary_color: normalizeHex(String(p.secondaryColor)) } : {}),
        ...(p.accentColor ? { accent_color: normalizeHex(String(p.accentColor)) } : {}),
      }, context)
      return { ok: true, message: 'Colores actualizados.' }
    }
    case 'update_store_logo':
      await updateStoreConfiguration(db, { logo_url: p.logoUrl }, context)
      return { ok: true, message: 'Logotipo actualizado.' }
    case 'update_store_banner':
      await updateStoreConfiguration(db, { cover_image_url: p.coverImageUrl }, context)
      return { ok: true, message: 'Portada actualizada.' }
    case 'update_whatsapp':
      await updateStoreConfiguration(db, { whatsapp_phone: p.whatsappPhone, whatsapp_orders: p.whatsappPhone }, context)
      return { ok: true, message: 'WhatsApp actualizado.' }
    case 'update_business_hours':
      await updateStoreConfiguration(db, { hours: p.hours }, context)
      return { ok: true, message: 'Horarios actualizados.' }
    case 'update_business_info': {
      await updateStoreConfiguration(db, {
        ...(p.address ? { address: p.address } : {}),
        ...(p.phone ? { phone: p.phone } : {}),
        ...(p.email ? { email: p.email } : {}),
      }, context)
      return { ok: true, message: 'Datos comerciales actualizados.' }
    }
    case 'get_inventory': {
      const rows = await db.prepare(
        `SELECT p.sku as product_sku, p.name, v.sku, v.size, v.stock
         FROM product_variants v JOIN products p ON p.id = v.product_id
         WHERE p.is_active = 1 AND p.is_archived = 0 AND v.is_active = 1
           AND (? IS NULL OR p.sku = ?)
         ORDER BY p.sku, v.size, v.sku LIMIT 50`,
      ).bind(p.sku ?? null, p.sku ?? null).all()
      return { ok: true, message: JSON.stringify(rows.results || [], null, 2) }
    }
    case 'get_products': {
      const rows = await db.prepare(`SELECT sku, name, price FROM products WHERE is_active = 1 AND is_archived = 0 LIMIT 20`).all()
      return { ok: true, message: JSON.stringify(rows.results || [], null, 2) }
    }
    case 'get_store_configuration': {
      const row = await db.prepare('SELECT name, primary_color, whatsapp_phone, currency FROM store_config WHERE id = 1').first()
      return { ok: true, message: JSON.stringify(row) }
    }
    default:
      return { ok: false, message: 'Acción no implementada' }
  }
}

function normalizeHex(value: string): string {
  return value.startsWith('#') ? value : `#${value}`
}
