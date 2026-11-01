import { actionSchemas, type ActionName } from '../validation/actions'

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

  const audit = async (entity: string, id: string, payload: unknown) => {
    await db.prepare(
      `INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source) VALUES (?, ?, ?, ?, ?, 'telegram')`,
    ).bind(action, entity, id, JSON.stringify(payload), actor).run()
  }

  switch (action) {
    case 'create_product': {
      const sku = String(p.sku)
      const existing = await db.prepare('SELECT id, name FROM products WHERE sku = ?').bind(sku).first()
      if (existing) {
        return { ok: false, message: `El SKU ${sku} ya existe (${(existing as { name: string }).name}). Ofrece actualizarlo en lugar de duplicarlo.` }
      }
      const result = await db.prepare(
        `INSERT INTO products (sku, name, description, brand, category_id, price, compare_at_price, is_featured, image_urls)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        sku,
        String(p.name),
        String(p.description || ''),
        p.brand ? String(p.brand) : null,
        typeof p.categoryId === 'number' ? p.categoryId : null,
        Number(p.price),
        p.compareAtPrice ?? null,
        p.isFeatured ? 1 : 0,
        JSON.stringify(p.imageUrls || []),
      ).run()
      const productId = result.meta.last_row_id as number
      const variants = (p.variants as Array<{ sku?: string; name?: string; size?: string; color?: string; stock: number }>) || []
      const statements = variants.map((v, i) =>
        db.prepare(
          `INSERT INTO product_variants (product_id, sku, name, size, color, stock, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).bind(productId, v.sku || `${sku}-${i + 1}`, v.name || v.size || '', v.size || null, v.color || null, v.stock, i),
      )
      if (statements.length) await db.batch(statements)
      await audit('product', String(productId), { sku })
      const total = variants.reduce((s, v) => s + v.stock, 0)
      return { ok: true, message: `Producto ${sku} publicado con ${variants.length} variantes y ${total} unidades.` }
    }
    case 'update_product':
    case 'update_price': {
      const sku = String(p.sku)
      const fields: string[] = []
      const values: unknown[] = []
      if (p.name) { fields.push('name = ?'); values.push(p.name) }
      if (p.description) { fields.push('description = ?'); values.push(p.description) }
      if (p.price !== undefined) { fields.push('price = ?'); values.push(p.price) }
      if (p.isFeatured !== undefined) { fields.push('is_featured = ?'); values.push(p.isFeatured ? 1 : 0) }
      if (!fields.length) return { ok: false, message: 'Nada que actualizar' }
      fields.push("updated_at = datetime('now')")
      values.push(sku)
      await db.prepare(`UPDATE products SET ${fields.join(', ')} WHERE sku = ?`).bind(...values).run()
      await audit('product', sku, p)
      return { ok: true, message: `Producto ${sku} actualizado.` }
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
      if (p.size) {
        await db.prepare(
          `UPDATE product_variants SET stock = ?, updated_at = datetime('now')
           WHERE sku = ? OR (size = ? AND product_id = (SELECT id FROM products WHERE sku = ?))`,
        ).bind(p.stock, `${p.sku}-${p.size}`, p.size, p.sku).run()
      } else {
        await db.prepare(
          `UPDATE product_variants SET stock = ?, updated_at = datetime('now') WHERE product_id = (SELECT id FROM products WHERE sku = ?)`,
        ).bind(p.stock, p.sku).run()
      }
      await audit('variant', String(p.sku), p)
      return { ok: true, message: 'Stock actualizado.' }
    }
    case 'create_category': {
      const name = String(p.name)
      const slug = String(p.slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-'))
      await db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)').bind(name, slug).run()
      await audit('category', slug, p)
      return { ok: true, message: `Categoría ${name} creada.` }
    }
    case 'update_category':
      await db.prepare('UPDATE categories SET name = ?, updated_at = datetime(\'now\') WHERE id = ?').bind(p.name, p.id).run()
      return { ok: true, message: 'Categoría actualizada.' }
    case 'delete_category':
      await db.prepare('UPDATE categories SET is_active = 0 WHERE id = ?').bind(p.id).run()
      return { ok: true, message: 'Categoría desactivada.' }
    case 'set_featured_products': {
      const skus = p.skus as string[]
      await db.prepare('UPDATE products SET is_featured = 0').run()
      for (const sku of skus) {
        await db.prepare('UPDATE products SET is_featured = 1 WHERE sku = ?').bind(sku).run()
      }
      return { ok: true, message: 'Destacados actualizados.' }
    }
    case 'update_store_name':
      await db.prepare('UPDATE store_config SET name = ?, updated_at = datetime(\'now\') WHERE id = 1').bind(p.name).run()
      return { ok: true, message: 'Nombre de tienda actualizado.' }
    case 'update_store_colors': {
      if (p.primaryColor) await db.prepare('UPDATE store_config SET primary_color = ? WHERE id = 1').bind(normalizeHex(String(p.primaryColor))).run()
      if (p.secondaryColor) await db.prepare('UPDATE store_config SET secondary_color = ? WHERE id = 1').bind(normalizeHex(String(p.secondaryColor))).run()
      return { ok: true, message: 'Colores actualizados.' }
    }
    case 'update_store_logo':
      await db.prepare('UPDATE store_config SET logo_url = ? WHERE id = 1').bind(p.logoUrl).run()
      return { ok: true, message: 'Logotipo actualizado.' }
    case 'update_store_banner':
      await db.prepare('UPDATE store_config SET cover_image_url = ? WHERE id = 1').bind(p.coverImageUrl).run()
      return { ok: true, message: 'Portada actualizada.' }
    case 'update_whatsapp':
      await db.prepare('UPDATE store_config SET whatsapp_phone = ?, whatsapp_orders = ? WHERE id = 1').bind(p.whatsappPhone, p.whatsappPhone).run()
      return { ok: true, message: 'WhatsApp actualizado.' }
    case 'update_business_hours':
      await db.prepare('UPDATE store_config SET hours = ? WHERE id = 1').bind(p.hours).run()
      return { ok: true, message: 'Horarios actualizados.' }
    case 'update_business_info': {
      if (p.address) await db.prepare('UPDATE store_config SET address = ? WHERE id = 1').bind(p.address).run()
      if (p.phone) await db.prepare('UPDATE store_config SET phone = ? WHERE id = 1').bind(p.phone).run()
      if (p.email) await db.prepare('UPDATE store_config SET email = ? WHERE id = 1').bind(p.email).run()
      return { ok: true, message: 'Datos comerciales actualizados.' }
    }
    case 'get_inventory': {
      const rows = await db.prepare(
        `SELECT p.sku as product_sku, p.name, v.sku, v.size, v.stock FROM product_variants v JOIN products p ON p.id = v.product_id WHERE p.is_archived = 0 LIMIT 50`,
      ).all()
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
