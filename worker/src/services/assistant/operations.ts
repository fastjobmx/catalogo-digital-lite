import { parseActionPayload, type ActionName } from '../../validation/actions'
import { applyConfirmedCatalogMutation, applyConfirmedProductEdit, applyConfirmedStoreMutation } from '../business'
import { slugify } from '../../tenancy/stores'
import { roleAllows, type StoreRole } from '../../tenancy/access'
import { say, sayPhoto, type AssistantContext } from './context'
import { operationKeyboard, backToMenu } from './menus'
import { escapeHtml, formatMoney } from './tools'

export interface PendingOperation {
  operation_id: string
  action: string
  params_json: string
  before_json: string
  after_json: string
  store_id?: number
}

const CATALOG_ACTIONS = new Set(['update_product', 'update_price', 'update_stock'])
const STORE_ACTIONS = new Set([
  'update_store_name', 'update_store_colors', 'update_hero_title', 'update_whatsapp', 'update_business_hours',
  'update_business_info', 'update_social_links', 'update_store_banner', 'update_store_logo',
])
const BULK_ACTIONS = new Set(['hide_out_of_stock', 'set_featured_products', 'move_products_to_category', 'archive_product', 'restore_product', 'create_category', 'import_catalog_updates'])
/** Actions prepared by trusted server code (photo and document flows) instead of the typed action catalog. */
const INTERNAL_ACTIONS = new Set(['update_store_banner', 'update_store_logo', 'import_catalog_updates'])

/** Minimum role needed to confirm each kind of change. */
export function requiredRole(action: string): StoreRole {
  if (action === 'update_stock') return 'operator'
  return 'admin'
}

export function isConfirmableAction(action: string): boolean {
  return CATALOG_ACTIONS.has(action) || STORE_ACTIONS.has(action) || BULK_ACTIONS.has(action)
}

const PRODUCT_SNAPSHOT_SQL = `SELECT p.sku, p.name, p.price, p.description, p.brand, p.category_id, p.is_featured, p.is_active, p.is_archived,
  (SELECT json_group_array(json_object('id', ordered.id, 'sku', ordered.sku, 'size', ordered.size, 'stock', ordered.stock))
   FROM (SELECT v.id, v.sku, v.size, v.stock FROM product_variants v WHERE v.product_id = p.id ORDER BY v.id) ordered) AS variants
  FROM products p WHERE p.store_id = ? AND p.sku = ?`

async function outOfStockSkus(db: D1Database, storeId: number): Promise<string[]> {
  const result = await db.prepare(
    `SELECT p.sku FROM products p LEFT JOIN product_variants v ON v.product_id = p.id AND v.is_active = 1
     WHERE p.store_id = ? AND p.is_active = 1 AND p.is_archived = 0
     GROUP BY p.id HAVING COALESCE(SUM(v.stock), 0) = 0 ORDER BY p.sku`,
  ).bind(storeId).all<{ sku: string }>()
  return (result.results || []).map((row) => row.sku)
}

/** Current state used for previews and stale checks; null when the target does not exist. */
export async function readActionState(ctx: AssistantContext, action: string, params: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const { db } = ctx
  const storeId = ctx.store.id
  const sku = String(params.sku || '')
  switch (action) {
    case 'update_product':
    case 'update_price':
    case 'update_stock':
    case 'archive_product':
    case 'restore_product':
      return db.prepare(PRODUCT_SNAPSHOT_SQL).bind(storeId, sku).first()
    case 'update_store_name': return db.prepare('SELECT name FROM store_config WHERE id = ?').bind(storeId).first()
    case 'update_store_colors': return db.prepare('SELECT primary_color, theme_config FROM store_config WHERE id = ?').bind(storeId).first()
    case 'update_hero_title': return db.prepare('SELECT theme_config FROM store_config WHERE id = ?').bind(storeId).first()
    case 'update_whatsapp': return db.prepare('SELECT whatsapp_phone, whatsapp_orders FROM store_config WHERE id = ?').bind(storeId).first()
    case 'update_business_hours': return db.prepare('SELECT hours FROM store_config WHERE id = ?').bind(storeId).first()
    case 'update_business_info': return db.prepare('SELECT address, phone, email FROM store_config WHERE id = ?').bind(storeId).first()
    case 'update_social_links': return db.prepare('SELECT instagram, facebook, tiktok FROM store_config WHERE id = ?').bind(storeId).first()
    case 'update_store_banner': return db.prepare('SELECT cover_image_url, theme_config FROM store_config WHERE id = ?').bind(storeId).first()
    case 'update_store_logo': return db.prepare('SELECT logo_url FROM store_config WHERE id = ?').bind(storeId).first()
    case 'hide_out_of_stock': return { skus: await outOfStockSkus(db, storeId) }
    case 'set_featured_products': {
      const result = await db.prepare('SELECT sku FROM products WHERE store_id = ? AND is_featured = 1 AND is_archived = 0 ORDER BY sku').bind(storeId).all<{ sku: string }>()
      return { featured: (result.results || []).map((row) => row.sku) }
    }
    case 'move_products_to_category': {
      const skus = [...new Set((params.skus as string[]).map((value) => value.toUpperCase()))].sort()
      const products = await db.prepare(
        `SELECT sku, category_id FROM products WHERE store_id = ? AND is_archived = 0 AND upper(sku) IN (${skus.map(() => '?').join(', ')}) ORDER BY sku`,
      ).bind(storeId, ...skus).all<{ sku: string; category_id: number | null }>()
      const name = String(params.categoryName).trim()
      const slug = slugify(name)
      const category = await db.prepare('SELECT id, name, slug, is_active FROM categories WHERE store_id = ? AND (slug = ? OR lower(name) = lower(?))').bind(storeId, slug, name).first<{ id: number; name: string; slug: string; is_active: number }>()
      return { products: products.results || [], category: category ? { id: category.id, name: category.name, slug: category.slug, active: category.is_active } : { id: null, name, slug, active: 0 } }
    }
    case 'import_catalog_updates': return readImportState(db, storeId, params)
    case 'create_category': {
      const name = String(params.name).trim()
      const slug = String(params.slug || slugify(name))
      const existing = await db.prepare('SELECT id FROM categories WHERE store_id = ? AND slug = ?').bind(storeId, slug).first()
      return { exists: Boolean(existing), name, slug }
    }
    default: return null
  }
}

function updateThemeConfig(value: unknown, mutate: (theme: Record<string, any>) => void): string | null {
  let parsed: Record<string, any>
  try {
    parsed = typeof value === 'string' ? JSON.parse(value || '{}') as Record<string, any> : (value || {}) as Record<string, any>
  } catch { return null }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const next = structuredClone(parsed)
  mutate(next)
  return JSON.stringify(next)
}

function objectAt(parent: Record<string, any>, key: string): Record<string, any> {
  parent[key] = parent[key] && typeof parent[key] === 'object' && !Array.isArray(parent[key]) ? parent[key] : {}
  return parent[key]
}

function normalizeHex(value: string): string { return (value.startsWith('#') ? value : `#${value}`).toUpperCase() }

export function proposedActionState(before: Record<string, unknown>, action: string, params: Record<string, unknown>): Record<string, unknown> | null {
  switch (action) {
    case 'update_price': return { ...before, price: params.price }
    case 'update_product': {
      const patch: Record<string, unknown> = {}
      if ('name' in params) patch.name = params.name
      if ('description' in params) patch.description = params.description
      if ('isActive' in params) patch.is_active = params.isActive ? 1 : 0
      return { ...before, ...patch }
    }
    case 'update_stock': {
      const variants = parseVariants(before.variants)
      const next = variants.map((variant) => !params.size || variant.sku === `${params.sku}-${params.size}` || variant.size === params.size ? { ...variant, stock: params.stock } : variant)
      return { ...before, variants: JSON.stringify(next) }
    }
    case 'archive_product': return { ...before, is_archived: 1, is_active: 0 }
    case 'restore_product': return { ...before, is_archived: 0, is_active: 1 }
    case 'update_store_name': return { name: params.name }
    case 'update_store_colors': {
      const color = normalizeHex(String(params.primaryColor))
      const theme = updateThemeConfig(before.theme_config, (next) => { objectAt(objectAt(next, 'style'), 'palette').primary = color })
      return theme ? { primary_color: color, theme_config: theme } : null
    }
    case 'update_hero_title': {
      const theme = updateThemeConfig(before.theme_config, (next) => { objectAt(next, 'hero').title = String(params.title) })
      return theme ? { theme_config: theme } : null
    }
    case 'update_whatsapp': {
      const phone = String(params.whatsappPhone).replace(/[\s().-]/g, '')
      return { whatsapp_phone: phone, whatsapp_orders: phone }
    }
    case 'update_business_hours': return { hours: String(params.hours).trim() }
    case 'update_business_info':
    case 'update_social_links': {
      const out: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(params)) if (value !== undefined) out[key] = String(value).trim()
      return out
    }
    case 'update_store_banner': {
      const url = String(params.imageUrl)
      const theme = updateThemeConfig(before.theme_config, (next) => {
        const hero = objectAt(next, 'hero')
        hero.imageUrl = url
        hero.imageUrlMobile = null
      })
      return theme ? { cover_image_url: url, theme_config: theme } : null
    }
    case 'update_store_logo': return { logo_url: String(params.imageUrl) }
    case 'hide_out_of_stock': return { hidden: before.skus }
    case 'set_featured_products': return { featured: [...new Set((params.skus as string[]).map((sku) => sku.toUpperCase()))] }
    case 'move_products_to_category': return { category: (before.category as Record<string, unknown>), skus: (before.products as Array<{ sku: string }>).map((product) => product.sku) }
    case 'create_category': return { name: before.name, slug: before.slug }
    case 'import_catalog_updates': return { prices: params.prices, stocks: params.stocks }
    default: return null
  }
}

type ImportParams = { prices: Array<{ sku: string; price: number }>; stocks: Array<{ sku: string; size: string | null; stock: number }> }

/** Current values for every row of a CSV import (prices by product, stock by variant). */
async function readImportState(db: D1Database, storeId: number, params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const input = params as unknown as ImportParams
  const rows = await db.prepare(
    `SELECT p.sku, p.price, v.id AS variant_id, v.size, v.stock FROM products p
     LEFT JOIN product_variants v ON v.product_id = p.id AND v.is_active = 1
     WHERE p.store_id = ? AND p.is_archived = 0 ORDER BY p.sku, v.id`,
  ).bind(storeId).all<{ sku: string; price: number; variant_id: number | null; size: string | null; stock: number | null }>()
  const all = rows.results || []
  const prices = input.prices.map((item) => {
    const row = all.find((candidate) => candidate.sku.toUpperCase() === item.sku.toUpperCase())
    return { sku: row?.sku ?? item.sku, price: row ? Number(row.price) : null }
  })
  const stocks = input.stocks.map((item) => {
    const variants = all.filter((candidate) => candidate.sku.toUpperCase() === item.sku.toUpperCase() && candidate.variant_id !== null)
    const variant = item.size ? variants.find((candidate) => String(candidate.size || '').toUpperCase() === item.size!.toUpperCase()) : variants.length === 1 ? variants[0] : undefined
    return { sku: variants[0]?.sku ?? item.sku, size: item.size, variantId: variant?.variant_id ?? null, stock: variant ? Number(variant.stock) : null }
  })
  return { prices, stocks }
}

export function parseVariants(value: unknown): Array<{ id: number; sku: string; size: string | null; stock: number }> {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

function readHeroTitle(value: unknown): string | null {
  try {
    const theme = typeof value === 'string' ? JSON.parse(value) as Record<string, any> : value as Record<string, any>
    return typeof theme?.hero?.title === 'string' ? theme.hero.title : null
  } catch { return null }
}

export function formatOperationPreview(operation: Pick<PendingOperation, 'action' | 'before_json' | 'after_json' | 'params_json'>, currency = 'COP'): string {
  let before: Record<string, any>, after: Record<string, any>, params: Record<string, any>
  try { before = JSON.parse(operation.before_json); after = JSON.parse(operation.after_json); params = JSON.parse(operation.params_json) }
  catch { return 'No se pudo validar la vista previa guardada.' }
  const arrow = (from: unknown, to: unknown) => `${escapeHtml(from || '—')} → <b>${escapeHtml(to || '—')}</b>`
  switch (operation.action) {
    case 'update_store_name': return `Nombre de la tienda: ${arrow(before.name, after.name)}`
    case 'update_store_colors': return `Color principal: ${arrow(before.primary_color, after.primary_color)}`
    case 'update_hero_title': return `Título de portada: ${arrow(readHeroTitle(before.theme_config), readHeroTitle(after.theme_config))}`
    case 'update_whatsapp': return `WhatsApp de pedidos: ${arrow(before.whatsapp_phone, after.whatsapp_phone)}`
    case 'update_business_hours': return `Horario: ${arrow(before.hours, after.hours)}`
    case 'update_business_info':
    case 'update_social_links': return Object.keys(after).map((key) => `${escapeHtml(key)}: ${arrow(before[key], after[key])}`).join('\n')
    case 'update_store_banner': return 'Banner principal: se reemplaza por la foto que enviaste.'
    case 'update_store_logo': return 'Logotipo: se reemplaza por la imagen que enviaste.'
    case 'update_price': return `Precio de <b>${escapeHtml(before.name)}</b> (${escapeHtml(before.sku)}): ${formatMoney(before.price, currency)} → <b>${formatMoney(after.price, currency)}</b>`
    case 'update_product': {
      const lines = [`Producto <b>${escapeHtml(before.name)}</b> (${escapeHtml(before.sku)})`]
      if ('name' in params) lines.push(`Nombre: ${arrow(before.name, after.name)}`)
      if ('description' in params) lines.push(`Descripción nueva:\n<i>${escapeHtml(after.description)}</i>`)
      if ('isActive' in params) lines.push(`Visible en la tienda: ${before.is_active ? 'Sí' : 'No'} → <b>${after.is_active ? 'Sí' : 'No'}</b>`)
      return lines.join('\n')
    }
    case 'update_stock': {
      const old = parseVariants(before.variants)
      const next = parseVariants(after.variants)
      const changed = next.filter((variant) => old.find((item) => item.id === variant.id)?.stock !== variant.stock)
      return `Stock de <b>${escapeHtml(before.name)}</b> (${escapeHtml(before.sku)}):\n${changed.map((variant) => `• ${escapeHtml(variant.size || variant.sku)}: ${old.find((item) => item.id === variant.id)?.stock ?? '—'} → <b>${variant.stock}</b>`).join('\n') || 'Sin cambios'}`
    }
    case 'archive_product': return `Ocultar y archivar <b>${escapeHtml(before.name)}</b> (${escapeHtml(before.sku)}). Puedes restaurarlo después.`
    case 'restore_product': return `Restaurar <b>${escapeHtml(before.name)}</b> (${escapeHtml(before.sku)}) y volverlo visible.`
    case 'hide_out_of_stock': return `Ocultar ${(before.skus as string[]).length} producto(s) agotados de la tienda:\n${(before.skus as string[]).slice(0, 15).map((sku) => `• ${escapeHtml(sku)}`).join('\n')}\nNo se borran: puedes volver a mostrarlos cuando tengas stock.`
    case 'set_featured_products': return `Productos destacados:\nAntes: ${escapeHtml((before.featured as string[]).join(', ') || 'ninguno')}\nDespués: <b>${escapeHtml((after.featured as string[]).join(', '))}</b>`
    case 'move_products_to_category': {
      const category = after.category as { id: number | null; name: string }
      return `${category.id ? 'Mover a la categoría' : 'Crear la categoría'} <b>${escapeHtml(category.name)}</b>${category.id ? '' : ' y mover allí'} ${(after.skus as string[]).length} producto(s):\n${(after.skus as string[]).map((sku) => `• ${escapeHtml(sku)}`).join('\n')}`
    }
    case 'create_category': return `Crear la categoría <b>${escapeHtml(after.name)}</b>.`
    case 'import_catalog_updates': {
      const prices = (before.prices as Array<{ sku: string; price: number }>).map((item, index) => `• ${escapeHtml(item.sku)}: precio ${formatMoney(item.price, currency)} → <b>${formatMoney(after.prices[index].price, currency)}</b>`)
      const stocks = (before.stocks as Array<{ sku: string; size: string | null; stock: number }>).map((item, index) => `• ${escapeHtml(item.sku)}${item.size ? ` talla ${escapeHtml(item.size)}` : ''}: stock ${item.stock} → <b>${after.stocks[index].stock}</b>`)
      const lines = [...prices, ...stocks]
      const more = lines.length > 15 ? `\n…y ${lines.length - 15} cambio(s) más.` : ''
      return `Actualizar ${prices.length} precio(s) y ${stocks.length} existencia(s) desde tu archivo:\n${lines.slice(0, 15).join('\n')}${more}`
    }
    default: return 'Cambio preparado.'
  }
}

/** Validates, snapshots and stores a pending change, then shows its preview. */
export async function proposeChange(ctx: AssistantContext, action: ActionName, params: Record<string, unknown>, summary?: string, preview?: { photoFileId?: string; operationId?: string }): Promise<void> {
  if (!roleAllows(ctx.role, requiredRole(action))) {
    await say(ctx, 'Tu rol en esta tienda no permite hacer este cambio. Pídeselo al propietario.')
    return
  }
  const validated = parseActionPayload({ action, params })
  if (!validated.success && !INTERNAL_ACTIONS.has(action)) {
    await say(ctx, `Me falta un dato para preparar el cambio: ${escapeHtml(validated.error)}.`)
    return
  }
  const cleanParams = validated.success && !INTERNAL_ACTIONS.has(action) ? validated.data.params as Record<string, unknown> : params
  if (action === 'set_featured_products') {
    const skus = [...new Set((cleanParams.skus as string[]).map((sku) => sku.toUpperCase()))]
    const found = await ctx.db.prepare(`SELECT upper(sku) AS sku FROM products WHERE store_id = ? AND is_archived = 0 AND upper(sku) IN (${skus.map(() => '?').join(', ')})`)
      .bind(ctx.store.id, ...skus).all<{ sku: string }>()
    const missing = skus.filter((sku) => !(found.results || []).some((row) => row.sku === sku))
    if (missing.length) { await say(ctx, `No encontré estos SKU en tu catálogo: ${escapeHtml(missing.join(', '))}.`); return }
  }
  await ctx.db.prepare(`UPDATE telegram_operations SET status = 'expired', completed_at = datetime('now') WHERE chat_id = ? AND status = 'pending' AND expires_at <= unixepoch()`).bind(String(ctx.chatId)).run()
  const before = await readActionState(ctx, action, cleanParams)
  if (!before) {
    await say(ctx, CATALOG_ACTIONS.has(action) || action === 'archive_product' || action === 'restore_product'
      ? `No encontré el producto ${escapeHtml(cleanParams.sku)} en tu catálogo. Revisa el SKU o escribe “mis productos” para verlos.`
      : 'No pude leer la configuración actual de tu tienda. Intenta de nuevo.')
    return
  }
  const rejection = validateProposal(action, before, cleanParams)
  if (rejection) { await say(ctx, rejection); return }
  const after = proposedActionState(before, action, cleanParams)
  if (!after) { await say(ctx, 'No pude preparar una vista previa válida. No se guardó ningún cambio.'); return }
  const operationId = preview?.operationId || crypto.randomUUID()
  const record = { operation_id: operationId, action, params_json: JSON.stringify(cleanParams), before_json: JSON.stringify(before), after_json: JSON.stringify(after) }
  try {
    await ctx.db.prepare(
      `INSERT INTO telegram_operations (operation_id, update_id, chat_id, store_id, action, params_json, before_json, after_json, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, unixepoch() + 900)`,
    ).bind(operationId, ctx.updateId, String(ctx.chatId), ctx.store.id, action, record.params_json, record.before_json, record.after_json).run()
  } catch (error) {
    if (error instanceof Error && /unique constraint/i.test(error.message)) {
      await say(ctx, 'Tienes otro cambio esperando confirmación. Confírmalo o cancélalo con /cancelar antes de pedir uno nuevo.')
      return
    }
    throw error
  }
  const text = `<b>Revisa este cambio</b>${summary ? `\n${escapeHtml(summary)}` : ''}\n\n${formatOperationPreview(record, ctx.store.currency)}\n\n<i>Nada cambia en tu tienda hasta que confirmes. Vence en 15 minutos.</i>`
  if (preview?.photoFileId) await sayPhoto(ctx, preview.photoFileId, text, operationKeyboard(operationId))
  else await say(ctx, text, operationKeyboard(operationId))
}

function validateProposal(action: string, before: Record<string, any>, params: Record<string, any>): string | null {
  if (CATALOG_ACTIONS.has(action) && action !== 'update_product' && (before.is_active !== 1 || before.is_archived !== 0)) return 'Ese producto está oculto o archivado. Restáuralo primero si quieres cambiarlo.'
  if (action === 'update_stock' && !parseVariants(before.variants).some((variant) => variant.sku === `${params.sku}-${params.size}` || variant.size === params.size)) return `El producto no tiene la talla ${escapeHtml(params.size)}. Revisa las tallas con “stock de ${escapeHtml(params.sku)}”.`
  if (action === 'archive_product' && before.is_archived === 1) return 'Ese producto ya está archivado.'
  if (action === 'restore_product' && before.is_archived === 0 && before.is_active === 1) return 'Ese producto ya está visible.'
  if (action === 'hide_out_of_stock' && !(before.skus as string[]).length) return '✅ No tienes productos visibles agotados. No hay nada que ocultar.'
  if (action === 'create_category' && before.exists) return 'Esa categoría ya existe.'
  if (action === 'import_catalog_updates' && ((before.prices as Array<{ price: number | null }>).some((item) => item.price === null) || (before.stocks as Array<{ variantId: number | null }>).some((item) => item.variantId === null))) return 'Algunas filas del archivo no coinciden con tu catálogo. Revísalo y envíalo de nuevo.'
  if (action === 'import_catalog_updates' && !(before.prices as unknown[]).length && !(before.stocks as unknown[]).length) return 'El archivo no tiene cambios para aplicar.'
  if (action === 'move_products_to_category') {
    const found = (before.products as Array<{ sku: string }>).map((product) => product.sku.toUpperCase())
    const missing = (params.skus as string[]).filter((sku) => !found.includes(sku.toUpperCase()))
    if (missing.length) return `No encontré estos SKU en tu catálogo: ${escapeHtml(missing.join(', '))}.`
    if (!slugify(String(params.categoryName))) return 'El nombre de la categoría no es válido.'
  }
  return null
}

export async function getPendingOperation(ctx: AssistantContext, operationId?: string): Promise<PendingOperation | null> {
  return ctx.db.prepare(
    `SELECT operation_id, action, params_json, before_json, after_json, store_id FROM telegram_operations
     WHERE chat_id = ? AND store_id = ? AND status = 'pending' AND expires_at > unixepoch() ${operationId ? 'AND operation_id = ?' : ''}
     ORDER BY created_at DESC LIMIT 1`,
  ).bind(...[String(ctx.chatId), ctx.store.id, ...(operationId ? [operationId] : [])]).first<PendingOperation>()
}

export async function cancelOperation(ctx: AssistantContext, operationId?: string): Promise<PendingOperation | null> {
  const pending = await getPendingOperation(ctx, operationId)
  if (!pending) return null
  await ctx.db.prepare(`UPDATE telegram_operations SET status = 'cancelled', completed_at = datetime('now') WHERE operation_id = ? AND chat_id = ? AND status = 'pending'`)
    .bind(pending.operation_id, String(ctx.chatId)).run()
  if (ctx.env.ASSETS && (pending.action === 'update_store_banner' || pending.action === 'update_store_logo')) {
    try { await ctx.env.ASSETS.delete(String(JSON.parse(pending.params_json).draftKey || '')) } catch { /* swept by cron */ }
  }
  return pending
}

function storeFields(action: string, after: Record<string, unknown>): Record<string, unknown> {
  if (action === 'update_store_name') return { name: after.name }
  if (action === 'update_store_colors') return { primary_color: after.primary_color, theme_config: after.theme_config }
  if (action === 'update_hero_title') return { theme_config: after.theme_config }
  if (action === 'update_whatsapp') return { whatsapp_phone: after.whatsapp_phone, whatsapp_orders: after.whatsapp_orders }
  if (action === 'update_store_banner') return { cover_image_url: after.cover_image_url, theme_config: after.theme_config }
  return { ...after }
}

type ApplyStatus = 'applied' | 'stale' | 'expired' | 'not_pending'

/** Claims the operation, re-checks the snapshot and applies gated statements atomically. */
async function applyBulkOperation(ctx: AssistantContext, pending: PendingOperation, build: (gate: string, gateBindings: unknown[]) => D1PreparedStatement[]): Promise<ApplyStatus> {
  const current = await readActionState(ctx, pending.action, JSON.parse(pending.params_json))
  if (!current || JSON.stringify(current) !== pending.before_json) {
    const marked = await ctx.db.prepare(`UPDATE telegram_operations SET status = CASE WHEN expires_at <= unixepoch() THEN 'expired' ELSE 'stale' END, completed_at = datetime('now') WHERE operation_id = ? AND chat_id = ? AND status = 'pending' RETURNING status`)
      .bind(pending.operation_id, String(ctx.chatId)).first<{ status: 'stale' | 'expired' }>()
    return marked?.status || 'not_pending'
  }
  const token = crypto.randomUUID()
  const gate = `EXISTS (SELECT 1 FROM telegram_operations WHERE operation_id = ? AND status = 'applying' AND execution_token = ?)`
  const gateBindings = [pending.operation_id, token]
  const claim = ctx.db.prepare(
    `UPDATE telegram_operations SET status = 'applying', execution_token = ?
     WHERE operation_id = ? AND chat_id = ? AND store_id = ? AND status = 'pending' AND expires_at > unixepoch() AND before_json = ?`,
  ).bind(token, pending.operation_id, String(ctx.chatId), ctx.store.id, pending.before_json)
  const audit = ctx.db.prepare(
    `INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id)
     SELECT ?, 'store', ?, ?, ?, 'telegram', ? WHERE ${gate}`,
  ).bind(pending.action, String(ctx.store.id), JSON.stringify({ operationId: pending.operation_id, before: JSON.parse(pending.before_json), after: JSON.parse(pending.after_json) }), `telegram:${ctx.telegramUserId}`, ctx.store.id, ...gateBindings)
  const complete = ctx.db.prepare(`UPDATE telegram_operations SET status = 'applied', execution_token = NULL, completed_at = datetime('now') WHERE operation_id = ? AND status = 'applying' AND execution_token = ?`)
    .bind(pending.operation_id, token)
  const results = await ctx.db.batch([claim, ...build(gate, gateBindings), audit, complete])
  if (Number(results[0]?.meta.changes || 0) === 1) return 'applied'
  const marked = await ctx.db.prepare(`UPDATE telegram_operations SET status = CASE WHEN expires_at <= unixepoch() THEN 'expired' ELSE 'stale' END, completed_at = datetime('now') WHERE operation_id = ? AND chat_id = ? AND status = 'pending' RETURNING status`)
    .bind(pending.operation_id, String(ctx.chatId)).first<{ status: 'stale' | 'expired' }>()
  return marked?.status || 'not_pending'
}

async function applyBulk(ctx: AssistantContext, pending: PendingOperation): Promise<ApplyStatus> {
  const params = JSON.parse(pending.params_json) as Record<string, any>
  const before = JSON.parse(pending.before_json) as Record<string, any>
  const after = JSON.parse(pending.after_json) as Record<string, any>
  const storeId = ctx.store.id
  const db = ctx.db
  return applyBulkOperation(ctx, pending, (gate, g) => {
    switch (pending.action) {
      case 'hide_out_of_stock': {
        const skus = before.skus as string[]
        return [db.prepare(`UPDATE products SET is_active = 0, updated_at = datetime('now') WHERE store_id = ? AND sku IN (${skus.map(() => '?').join(', ')}) AND is_active = 1 AND ${gate}`).bind(storeId, ...skus, ...g)]
      }
      case 'set_featured_products': {
        const skus = after.featured as string[]
        return [
          db.prepare(`UPDATE products SET is_featured = 0, updated_at = datetime('now') WHERE store_id = ? AND is_featured = 1 AND ${gate}`).bind(storeId, ...g),
          db.prepare(`UPDATE products SET is_featured = 1, updated_at = datetime('now') WHERE store_id = ? AND upper(sku) IN (${skus.map(() => '?').join(', ')}) AND is_archived = 0 AND ${gate}`).bind(storeId, ...skus, ...g),
        ]
      }
      case 'move_products_to_category': {
        const category = before.category as { id: number | null; name: string; slug: string; active: number }
        const skus = (before.products as Array<{ sku: string }>).map((product) => product.sku)
        const statements: D1PreparedStatement[] = []
        if (!category.id) {
          statements.push(db.prepare(`INSERT INTO categories (store_id, name, slug, sort_order) SELECT ?, ?, ?, COALESCE((SELECT MAX(sort_order) + 1 FROM categories WHERE store_id = ?), 0) WHERE ${gate}`)
            .bind(storeId, category.name, category.slug, storeId, ...g))
        } else if (!category.active) {
          statements.push(db.prepare(`UPDATE categories SET is_active = 1, updated_at = datetime('now') WHERE id = ? AND store_id = ? AND ${gate}`).bind(category.id, storeId, ...g))
        }
        statements.push(db.prepare(
          `UPDATE products SET category_id = (SELECT id FROM categories WHERE store_id = ? AND slug = ?), updated_at = datetime('now')
           WHERE store_id = ? AND sku IN (${skus.map(() => '?').join(', ')}) AND ${gate}`,
        ).bind(storeId, category.slug, storeId, ...skus, ...g))
        return statements
      }
      case 'archive_product':
      case 'restore_product': {
        const archived = pending.action === 'archive_product'
        return [db.prepare(`UPDATE products SET is_archived = ?, is_active = ?, updated_at = datetime('now') WHERE store_id = ? AND sku = ? AND ${gate}`)
          .bind(archived ? 1 : 0, archived ? 0 : 1, storeId, String(params.sku), ...g)]
      }
      case 'import_catalog_updates': {
        const statements: D1PreparedStatement[] = []
        for (const item of after.prices as Array<{ sku: string; price: number }>) {
          statements.push(db.prepare(`UPDATE products SET price = ?, updated_at = datetime('now') WHERE store_id = ? AND upper(sku) = upper(?) AND is_archived = 0 AND ${gate}`).bind(item.price, storeId, item.sku, ...g))
        }
        for (const item of before.stocks as Array<{ variantId: number }>) {
          const index = (before.stocks as Array<{ variantId: number }>).indexOf(item)
          statements.push(db.prepare(`UPDATE product_variants SET stock = ?, updated_at = datetime('now') WHERE id = ? AND product_id IN (SELECT id FROM products WHERE store_id = ?) AND ${gate}`)
            .bind(after.stocks[index].stock, item.variantId, storeId, ...g))
        }
        return statements
      }
      case 'create_category':
        return [db.prepare(`INSERT INTO categories (store_id, name, slug, sort_order) SELECT ?, ?, ?, COALESCE((SELECT MAX(sort_order) + 1 FROM categories WHERE store_id = ?), 0) WHERE ${gate}`)
          .bind(storeId, after.name, after.slug, storeId, ...g)]
      default: throw new Error('UNSUPPORTED_BULK_ACTION')
    }
  })
}

/** Promotes a private draft image before a store image change is applied. */
async function promoteStoreImage(ctx: AssistantContext, params: Record<string, any>): Promise<string | null> {
  const bucket = ctx.env.ASSETS
  if (!bucket) return null
  const draftKey = String(params.draftKey || '')
  const finalKey = String(params.finalKey || '')
  if (!draftKey.startsWith('telegram-drafts/') || !finalKey.startsWith(`stores/${ctx.store.id}/store/`)) return null
  const object = await bucket.get(draftKey)
  if (!object) return null
  await bucket.put(finalKey, object.body, { httpMetadata: { contentType: String(params.contentType || 'image/jpeg'), cacheControl: 'public, max-age=31536000, immutable' }, customMetadata: { storeId: String(ctx.store.id), purpose: 'telegram-store-image' } })
  return finalKey
}

export async function confirmOperation(ctx: AssistantContext, pending: PendingOperation): Promise<void> {
  if (!roleAllows(ctx.role, requiredRole(pending.action))) {
    await say(ctx, 'Tu rol en esta tienda no permite confirmar este cambio.')
    return
  }
  const params = JSON.parse(pending.params_json) as Record<string, any>
  const before = JSON.parse(pending.before_json) as Record<string, unknown>
  const after = JSON.parse(pending.after_json) as Record<string, unknown>
  const actor = `telegram:${ctx.telegramUserId}`
  let status: ApplyStatus
  let promotedKey: string | null = null
  try {
    if (pending.action === 'update_product') {
      status = await applyConfirmedProductEdit(ctx.db, {
        operationId: pending.operation_id, chatId: String(ctx.chatId), storeId: ctx.store.id, actor, sku: String(params.sku),
        fields: { ...(params.name !== undefined ? { name: String(params.name) } : {}), ...(params.description !== undefined ? { description: String(params.description) } : {}), ...(params.isActive !== undefined ? { isActive: Boolean(params.isActive) } : {}) },
        before, beforeJson: pending.before_json, after,
      })
    } else if (pending.action === 'update_price' || pending.action === 'update_stock') {
      status = await applyConfirmedCatalogMutation(ctx.db, {
        operationId: pending.operation_id, chatId: String(ctx.chatId), storeId: ctx.store.id, actor, action: pending.action,
        params: params as { sku: string; price?: number; stock?: number; size?: string }, before, beforeJson: pending.before_json, after,
      })
    } else if (STORE_ACTIONS.has(pending.action)) {
      if (pending.action === 'update_store_banner' || pending.action === 'update_store_logo') {
        promotedKey = await promoteStoreImage(ctx, params)
        if (!promotedKey) {
          await cancelOperation(ctx, pending.operation_id)
          await say(ctx, 'La imagen ya no está disponible. Envíala otra vez y te muestro la vista previa.')
          return
        }
      }
      status = await applyConfirmedStoreMutation(ctx.db, {
        operationId: pending.operation_id, chatId: String(ctx.chatId), storeId: ctx.store.id, actor,
        before, beforeJson: pending.before_json, after, fields: storeFields(pending.action, after),
      })
    } else if (BULK_ACTIONS.has(pending.action)) {
      status = await applyBulk(ctx, pending)
    } else {
      await ctx.db.prepare("UPDATE telegram_operations SET status = 'stale', completed_at = datetime('now') WHERE operation_id = ? AND status = 'pending'").bind(pending.operation_id).run()
      await say(ctx, 'Este cambio ya no es compatible. No se aplicó nada.')
      return
    }
  } catch (error) {
    console.error('Assistant operation failed:', pending.action, error instanceof Error ? error.message : 'unknown')
    if (promotedKey && ctx.env.ASSETS) await ctx.env.ASSETS.delete(promotedKey).catch(() => undefined)
    await ctx.db.prepare(`INSERT INTO platform_events (store_id, level, source, code, detail) VALUES (?, 'error', 'assistant', 'OPERATION_FAILED', ?)`).bind(ctx.store.id, pending.action).run().catch(() => undefined)
    await say(ctx, 'No pude guardar el cambio. Tu tienda no se modificó. Puedes intentarlo nuevamente.', backToMenu())
    return
  }
  if (status !== 'applied') {
    if (promotedKey && ctx.env.ASSETS) await ctx.env.ASSETS.delete(promotedKey).catch(() => undefined)
    const messages: Record<string, string> = {
      stale: 'Algo cambió en tu tienda desde que preparé la propuesta, así que no apliqué nada. Pídemelo de nuevo y te muestro la versión actualizada.',
      expired: 'La propuesta venció y no se aplicó. Pídemela de nuevo cuando quieras.',
      not_pending: 'Ese cambio ya se procesó o se canceló. No se repitió.',
    }
    await say(ctx, messages[status] || messages.not_pending!)
    return
  }
  if (promotedKey && ctx.env.ASSETS) await ctx.env.ASSETS.delete(String(params.draftKey)).catch(() => undefined)
  await say(ctx, `✅ ¡Listo! ${successMessage(pending.action, params, after, ctx.store.currency)}`, backToMenu())
}

function successMessage(action: string, params: Record<string, any>, after: Record<string, any>, currency: string): string {
  switch (action) {
    case 'update_price': return `El precio de ${escapeHtml(params.sku)} ahora es ${formatMoney(params.price, currency)}.`
    case 'update_stock': return `Stock de ${escapeHtml(params.sku)}${params.size ? ` talla ${escapeHtml(params.size)}` : ''} actualizado a ${params.stock} unidades.`
    case 'update_product': return `Actualicé el producto ${escapeHtml(params.sku)}.`
    case 'update_store_name': return `Tu tienda ahora se llama “${escapeHtml(after.name)}”.`
    case 'update_store_colors': return `El color principal ahora es ${escapeHtml(after.primary_color)}.`
    case 'update_hero_title': return 'El título de portada quedó actualizado.'
    case 'update_whatsapp': return `Los pedidos llegarán a ${escapeHtml(after.whatsapp_phone)}.`
    case 'update_business_hours': return 'Tu horario quedó actualizado.'
    case 'update_business_info': return 'Tus datos de contacto quedaron actualizados.'
    case 'update_social_links': return 'Tus redes sociales quedaron actualizadas.'
    case 'update_store_banner': return 'Tu nuevo banner ya está publicado.'
    case 'update_store_logo': return 'Tu nuevo logotipo ya está publicado.'
    case 'hide_out_of_stock': return `Oculté ${(after.hidden as string[]).length} producto(s) agotados. Siguen guardados para cuando tengas stock.`
    case 'set_featured_products': return 'Tus productos destacados quedaron actualizados.'
    case 'move_products_to_category': return `Moví ${(after.skus as string[]).length} producto(s) a “${escapeHtml(after.category.name)}”.`
    case 'archive_product': return `Archivé ${escapeHtml(params.sku)}. Puedes restaurarlo cuando quieras.`
    case 'restore_product': return `${escapeHtml(params.sku)} vuelve a estar visible.`
    case 'create_category': return `Creé la categoría “${escapeHtml(after.name)}”.`
    case 'import_catalog_updates': return `Apliqué ${(after.prices as unknown[]).length} precio(s) y ${(after.stocks as unknown[]).length} existencia(s) de tu archivo.`
    default: return 'Cambio aplicado.'
  }
}
