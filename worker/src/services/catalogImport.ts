/** Bulk product import (CSV / Excel / PDF read in the browser). The browser only sends normalized rows;
 * every rule is enforced again here. Imported text is untrusted data: it is stored as plain text and
 * never interpreted. Existing products are only changed when the import explicitly allows it. */
import { z } from 'zod'
import { createCatalogCategory, createCatalogProduct, productLimit, updateCatalogProduct, updateVariantStocksById, type AuditContext } from './business'
import { slugify } from '../tenancy/stores'

export const IMPORT_BATCH_SIZE = 50
export const IMPORT_SOURCES = ['csv', 'xlsx', 'pdf'] as const

export class ImportError extends Error {
  constructor(readonly code: string, message: string, readonly status: 400 | 404 | 409 = 400) { super(message) }
}

const clean = (value: string) => value.normalize('NFC').replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/g, ' ').trim()
const text = (max: number) => z.string().max(max * 4).transform(clean).pipe(z.string().max(max))
const optionalText = (max: number) => z.union([text(max), z.null()]).optional().transform((value) => value || null)
const money = z.number().int().min(0).max(10_000_000_000).nullable().optional().transform((value) => value ?? null)
const quantity = z.number().int().min(0).max(1_000_000).nullable().optional().transform((value) => value ?? null)

export const importVariantSchema = z.object({ color: optionalText(40), size: optionalText(20), stock: quantity, price: money }).strict()
export const importProductSchema = z.object({
  sku: text(64).pipe(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._\-/#]*$/, 'El código solo puede tener letras, números y . _ - / #')),
  name: text(160).pipe(z.string().min(1, 'Falta el nombre')),
  description: optionalText(2000),
  category: optionalText(80),
  price: money,
  variants: z.array(importVariantSchema).min(1).max(50),
}).strict()
export type ImportProduct = z.output<typeof importProductSchema>

export const importOptionsSchema = z.object({
  updateExisting: z.boolean().default(false),
  createCategories: z.boolean().default(true),
}).strict()
export type ImportOptions = z.output<typeof importOptionsSchema>

export type ImportAction = 'create' | 'update' | 'skip' | 'invalid'
export type ImportItem = {
  index: number; sku: string; name: string; action: ImportAction
  errors: string[]; warnings: string[]
  changes?: { price?: { from: number; to: number }; stock?: Array<{ variant: string; from: number; to: number }> }
  category?: string | null
}

const looksLikeFormula = (value: string | null) => Boolean(value && /^[=]/.test(value))
const variantLabel = (variant: { color: string | null; size: string | null }) => [variant.color, variant.size].filter(Boolean).join(' / ') || 'única'
const variantKey = (variant: { color: string | null; size: string | null }) => `${(variant.color || '').toLowerCase()}|${(variant.size || '').toLowerCase()}`

// ---- jobs ------------------------------------------------------------------------

export async function createImportJob(db: D1Database, storeId: number, body: { sourceType?: unknown; fileName?: unknown; options?: unknown }, actor: string) {
  if (!IMPORT_SOURCES.includes(body.sourceType as typeof IMPORT_SOURCES[number])) throw new ImportError('INVALID_SOURCE', 'Tipo de archivo no válido')
  const options = importOptionsSchema.safeParse(body.options ?? {})
  if (!options.success) throw new ImportError('INVALID_OPTIONS', 'Opciones de importación no válidas')
  const id = crypto.randomUUID()
  const fileName = typeof body.fileName === 'string' ? clean(body.fileName).slice(0, 160) : ''
  await db.prepare('INSERT INTO import_jobs (id, store_id, source_type, file_name, options_json, created_by) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, storeId, body.sourceType, fileName, JSON.stringify(options.data), actor.slice(0, 160)).run()
  return { id, options: options.data }
}

async function openJob(db: D1Database, storeId: number, jobId: string) {
  const job = await db.prepare('SELECT id, status, options_json FROM import_jobs WHERE id = ? AND store_id = ?').bind(jobId, storeId).first<{ id: string; status: string; options_json: string }>()
  if (!job) throw new ImportError('JOB_NOT_FOUND', 'Importación no encontrada', 404)
  if (job.status !== 'abierta') throw new ImportError('JOB_CLOSED', 'Esta importación ya terminó', 409)
  return { ...job, options: importOptionsSchema.parse(JSON.parse(job.options_json || '{}')) }
}

export async function listImportJobs(db: D1Database, storeId: number) {
  const { results } = await db.prepare(
    `SELECT id, source_type AS sourceType, file_name AS fileName, status, created_count AS created, updated_count AS updated,
            skipped_count AS skipped, failed_count AS failed, created_by AS createdBy, created_at AS createdAt, completed_at AS completedAt
     FROM import_jobs WHERE store_id = ? ORDER BY created_at DESC LIMIT 10`,
  ).bind(storeId).all()
  return results || []
}

export async function finishImportJob(db: D1Database, storeId: number, jobId: string) {
  await openJob(db, storeId, jobId)
  await db.prepare(`UPDATE import_jobs SET status = 'completada', completed_at = datetime('now') WHERE id = ? AND store_id = ? AND status = 'abierta'`).bind(jobId, storeId).run()
  return (await listImportJobs(db, storeId)).find((job: any) => job.id === jobId)
}

// ---- analysis (shared by the preview and the apply step) ----------------------------

function parseProducts(raw: unknown): Array<{ index: number; product?: ImportProduct; errors: string[]; sku: string; name: string }> {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > IMPORT_BATCH_SIZE) throw new ImportError('INVALID_BATCH', `Envía entre 1 y ${IMPORT_BATCH_SIZE} productos por lote`)
  return raw.map((item, index) => {
    const parsed = importProductSchema.safeParse(item)
    const fallback = item && typeof item === 'object' ? item as Record<string, unknown> : {}
    if (!parsed.success) {
      return { index, errors: [...new Set(parsed.error.issues.map((issue) => issue.message === 'Required' ? `Falta ${issue.path.join('.')}` : issue.message))].slice(0, 4), sku: String(fallback.sku ?? '').slice(0, 64), name: String(fallback.name ?? '').slice(0, 160) }
    }
    return { index, product: parsed.data, errors: [], sku: parsed.data.sku, name: parsed.data.name }
  })
}

type ExistingProduct = { id: number; sku: string; price: number; variants: Array<{ id: number; color: string | null; size: string | null; stock: number }> }

async function loadContext(db: D1Database, storeId: number, skus: string[]) {
  const existing = new Map<string, ExistingProduct>()
  if (skus.length) {
    const placeholders = skus.map(() => '?').join(',')
    const { results } = await db.prepare(
      `SELECT p.id, p.sku, p.price, v.id AS variantId, v.color, v.size, v.stock FROM products p
       LEFT JOIN product_variants v ON v.product_id = p.id AND v.is_active = 1
       WHERE p.store_id = ? AND p.is_archived = 0 AND lower(p.sku) IN (${placeholders}) ORDER BY p.id, v.id`,
    ).bind(storeId, ...skus.map((sku) => sku.toLowerCase())).all<{ id: number; sku: string; price: number; variantId: number | null; color: string | null; size: string | null; stock: number }>()
    for (const row of results || []) {
      const key = row.sku.toLowerCase()
      const product = existing.get(key) || { id: row.id, sku: row.sku, price: Number(row.price), variants: [] }
      if (row.variantId !== null) product.variants.push({ id: row.variantId, color: row.color, size: row.size, stock: Number(row.stock) })
      existing.set(key, product)
    }
    // Archived products keep their SKU: importing over them is refused instead of silently reviving them.
    const archived = await db.prepare(`SELECT lower(sku) AS sku FROM products WHERE store_id = ? AND is_archived = 1 AND lower(sku) IN (${placeholders})`).bind(storeId, ...skus.map((sku) => sku.toLowerCase())).all<{ sku: string }>()
    for (const row of archived.results || []) if (!existing.has(row.sku)) existing.set(row.sku, { id: -1, sku: row.sku, price: 0, variants: [] })
  }
  const { results: categories } = await db.prepare('SELECT id, name, slug FROM categories WHERE store_id = ? AND is_active = 1').bind(storeId).all<{ id: number; name: string; slug: string }>()
  const categoryIds = new Map<string, number>()
  for (const category of categories || []) { categoryIds.set(category.name.toLowerCase(), category.id); categoryIds.set(category.slug, category.id) }
  return { existing, categoryIds, limit: await productLimit(db, storeId) }
}

export async function analyzeImport(db: D1Database, storeId: number, raw: unknown, options: ImportOptions) {
  const parsed = parseProducts(raw)
  const valid = parsed.filter((item) => item.product)
  const { existing, categoryIds, limit } = await loadContext(db, storeId, [...new Set(valid.map((item) => item.product!.sku))])
  let remaining = limit.max === null ? Number.POSITIVE_INFINITY : Math.max(0, limit.max - limit.count)
  const seen = new Set<string>()
  const newCategories = new Set<string>()
  const items: Array<ImportItem & { product?: ImportProduct; existing?: ExistingProduct; variantUpdates?: Array<{ id: number; stock: number }> }> = []

  for (const entry of parsed) {
    const item: (typeof items)[number] = { index: entry.index, sku: entry.sku, name: entry.name, action: 'invalid', errors: [...entry.errors], warnings: [] }
    items.push(item)
    const product = entry.product
    if (!product) continue
    item.product = product
    const key = product.sku.toLowerCase()
    if (seen.has(key)) { item.errors.push('Código repetido en el archivo'); continue }
    seen.add(key)
    const texts = [product.name, product.description, product.category, ...product.variants.flatMap((v) => [v.color, v.size])]
    if (texts.some(looksLikeFormula)) { item.errors.push('Contiene una fórmula de hoja de cálculo; no se ejecuta ni se importa'); continue }
    const variantKeys = product.variants.map(variantKey)
    if (new Set(variantKeys).size !== variantKeys.length) { item.errors.push('Hay variantes repetidas (mismo color y talla)'); continue }

    const current = existing.get(key)
    if (current && current.id === -1) { item.errors.push('Ese código pertenece a un producto archivado; restáuralo o usa otro código'); continue }
    if (current) {
      if (!options.updateExisting) { item.action = 'skip'; item.warnings.push('Ya existe: no se modifica'); continue }
      const changes: NonNullable<ImportItem['changes']> = {}
      if (product.price !== null && product.price > 0 && product.price !== current.price) changes.price = { from: current.price, to: product.price }
      const stockChanges: Array<{ variant: string; from: number; to: number }> = []
      const variantUpdates: Array<{ id: number; stock: number }> = []
      for (const variant of product.variants) {
        if (variant.stock === null) continue
        const match = current.variants.find((candidate) => variantKey(candidate) === variantKey(variant)) || (current.variants.length === 1 && product.variants.length === 1 ? current.variants[0] : undefined)
        if (!match) { item.warnings.push(`La variante ${variantLabel(variant)} no existe; no se crea`); continue }
        if (match.stock !== variant.stock) { stockChanges.push({ variant: variantLabel(match), from: match.stock, to: variant.stock }); variantUpdates.push({ id: match.id, stock: variant.stock }) }
      }
      if (stockChanges.length) changes.stock = stockChanges
      item.existing = current
      item.variantUpdates = variantUpdates
      if (!changes.price && !changes.stock) { item.action = 'skip'; item.warnings.push('Ya existe y no tiene cambios'); continue }
      item.action = 'update'
      item.changes = changes
      item.warnings.push('Solo se actualizan precio y existencias; nombre, descripción y fotos no cambian')
      continue
    }

    // A product without a price would show as $0 in the store: the price must come from the file.
    if (product.price === null || product.price === 0) { item.errors.push('Falta el precio: agrégalo en el archivo'); continue }
    if (remaining <= 0) { item.errors.push('Supera el límite de productos de tu plan'); continue }
    remaining--
    item.action = 'create'
    if (product.variants.some((variant) => variant.stock === null)) item.warnings.push('Sin existencias: quedará en 0 (Agotado)')
    if (product.category) {
      const id = categoryIds.get(product.category.toLowerCase()) ?? categoryIds.get(slugify(product.category))
      if (id) item.category = product.category
      else if (options.createCategories && slugify(product.category)) { item.category = product.category; newCategories.add(product.category) }
      else item.warnings.push(`La categoría «${product.category}» no existe: queda sin categoría`)
    }
  }

  const summary = { create: 0, update: 0, skip: 0, invalid: 0 }
  for (const item of items) summary[item.action]++
  return { items, summary, newCategories: [...newCategories], limit: { max: limit.max, count: limit.count } }
}

const publicItem = ({ product: _product, existing: _existing, variantUpdates: _updates, ...item }: Awaited<ReturnType<typeof analyzeImport>>['items'][number]): ImportItem => item

export async function previewImport(db: D1Database, storeId: number, jobId: string, raw: unknown) {
  const job = await openJob(db, storeId, jobId)
  const analysis = await analyzeImport(db, storeId, raw, job.options)
  return { ...analysis, items: analysis.items.map(publicItem) }
}

// ---- apply ---------------------------------------------------------------------------

export async function applyImportBatch(db: D1Database, context: AuditContext, jobId: string, batchIndex: number, raw: unknown) {
  if (!Number.isInteger(batchIndex) || batchIndex < 0 || batchIndex > 10_000) throw new ImportError('INVALID_BATCH', 'Número de lote no válido')
  const job = await openJob(db, context.storeId, jobId)
  const claim = await db.prepare('INSERT OR IGNORE INTO import_job_batches (job_id, batch_index, store_id) VALUES (?, ?, ?)').bind(jobId, batchIndex, context.storeId).run()
  if (!claim.meta?.changes) {
    const stored = await db.prepare('SELECT result_json FROM import_job_batches WHERE job_id = ? AND batch_index = ?').bind(jobId, batchIndex).first<{ result_json: string | null }>()
    if (!stored?.result_json) throw new ImportError('BATCH_IN_PROGRESS', 'Este lote se está procesando', 409)
    return { ...JSON.parse(stored.result_json), replayed: true }
  }

  let analysis: Awaited<ReturnType<typeof analyzeImport>>
  try { analysis = await analyzeImport(db, context.storeId, raw, job.options) }
  catch (error) { await db.prepare('DELETE FROM import_job_batches WHERE job_id = ? AND batch_index = ? AND result_json IS NULL').bind(jobId, batchIndex).run(); throw error }

  const categoryCache = new Map<string, number | null>()
  const categoryFor = async (name: string | null | undefined): Promise<number | null> => {
    if (!name) return null
    const key = name.toLowerCase()
    if (categoryCache.has(key)) return categoryCache.get(key)!
    const slug = slugify(name)
    let row = await db.prepare('SELECT id FROM categories WHERE store_id = ? AND is_active = 1 AND (lower(name) = ? OR slug = ?)').bind(context.storeId, key, slug).first<{ id: number }>()
    if (!row && job.options.createCategories && slug) {
      try { row = await createCatalogCategory(db, { name, slug }, context) } catch (error) {
        if (!(error instanceof Error && error.message === 'CATEGORY_SLUG_EXISTS')) throw error
        row = await db.prepare('SELECT id FROM categories WHERE store_id = ? AND slug = ? AND is_active = 1').bind(context.storeId, slug).first<{ id: number }>()
      }
    }
    categoryCache.set(key, row?.id ?? null)
    return row?.id ?? null
  }

  const results: ImportItem[] = []
  for (const item of analysis.items) {
    const out = publicItem(item)
    try {
      if (item.action === 'create' && item.product) {
        const product = item.product
        const price = product.price!
        await createCatalogProduct(db, {
          sku: product.sku, name: product.name, description: product.description || '',
          categoryId: await categoryFor(item.category), price,
          variants: product.variants.map((variant) => ({ color: variant.color, size: variant.size, stock: variant.stock ?? 0, priceOverride: variant.price && variant.price !== price ? variant.price : null })),
        }, context)
      } else if (item.action === 'update' && item.existing) {
        if (item.changes?.price) await updateCatalogProduct(db, { id: item.existing.id }, { price: item.changes.price.to }, context)
        if (item.variantUpdates?.length) await updateVariantStocksById(db, item.variantUpdates, context, { importJob: jobId, sku: item.sku, stock: item.changes?.stock })
      }
    } catch (error) {
      const code = error instanceof Error ? error.message : ''
      out.action = code === 'SKU_ALREADY_EXISTS' ? 'skip' : 'invalid'
      out.errors = [...out.errors, code === 'SKU_ALREADY_EXISTS' ? 'Ya existe' : code === 'PLAN_PRODUCT_LIMIT' ? 'Supera el límite de productos de tu plan' : 'No se pudo guardar']
      if (!['SKU_ALREADY_EXISTS', 'PLAN_PRODUCT_LIMIT'].includes(code)) console.error('Import row failed:', code || 'unknown')
    }
    results.push(out)
  }

  const summary = { create: 0, update: 0, skip: 0, invalid: 0 }
  for (const item of results) summary[item.action]++
  const result = { batchIndex, summary, items: results }
  await db.batch([
    db.prepare('UPDATE import_job_batches SET result_json = ? WHERE job_id = ? AND batch_index = ?').bind(JSON.stringify(result), jobId, batchIndex),
    db.prepare('UPDATE import_jobs SET created_count = created_count + ?, updated_count = updated_count + ?, skipped_count = skipped_count + ?, failed_count = failed_count + ? WHERE id = ?')
      .bind(summary.create, summary.update, summary.skip, summary.invalid, jobId),
  ])
  return { ...result, replayed: false }
}
