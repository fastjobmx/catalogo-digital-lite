/** Finds the real product a merchant is talking about, always inside the active store. A match is used
 * only when it is unambiguous; otherwise the caller shows the options. Nothing here writes data. */
import type { AssistantContext } from '../context'
import { colorOf, fold, FILLER, sameColor, sameSize, similarWord, singular } from './language'

export type CatalogVariant = { id: number; sku: string; size: string | null; color: string | null; stock: number; isActive: boolean }
export type CatalogProduct = {
  id: number; sku: string; name: string; brand: string | null; price: number; isActive: boolean
  description: string | null; categoryId: number | null; imageUrls: string[]; variants: CatalogVariant[]
}

type Row = { id: number; sku: string; name: string; brand: string | null; price: number; is_active: number; description: string | null; category_id: number | null; image_urls: string | null; variants: string | null }

export async function loadCatalog(ctx: AssistantContext): Promise<CatalogProduct[]> {
  const { results } = await ctx.db.prepare(
    `SELECT p.id, p.sku, p.name, p.brand, p.price, p.is_active, p.description, p.category_id, p.image_urls,
            (SELECT json_group_array(json_object('id', v.id, 'sku', v.sku, 'size', v.size, 'color', v.color, 'stock', v.stock, 'isActive', v.is_active))
             FROM product_variants v WHERE v.product_id = p.id) AS variants
     FROM products p WHERE p.store_id = ? AND p.is_archived = 0 ORDER BY p.id LIMIT 2000`,
  ).bind(ctx.store.id).all<Row>()
  return (results || []).map((row) => {
    let images: string[] = []
    let variants: Array<Omit<CatalogVariant, 'isActive'> & { isActive: number }> = []
    try { images = JSON.parse(row.image_urls || '[]') } catch { images = [] }
    try { variants = JSON.parse(row.variants || '[]') } catch { variants = [] }
    return {
      id: row.id, sku: row.sku, name: row.name, brand: row.brand, price: Number(row.price), isActive: row.is_active === 1,
      description: row.description, categoryId: row.category_id, imageUrls: Array.isArray(images) ? images.filter((url) => typeof url === 'string') : [],
      variants: variants.map((variant) => ({ ...variant, stock: Number(variant.stock), isActive: Boolean(variant.isActive) })),
    }
  })
}

/** Words of the query that can identify a product (articles, colours and filler removed). */
function queryWords(query: string): string[] {
  return fold(query).split(/[^a-z0-9ñ._-]+/).filter((word) => word.length >= 2 && !FILLER.has(word) && !colorOf(word))
}

function productWordsOf(product: CatalogProduct): string[] {
  const text = [product.name, product.brand || '', ...product.variants.map((variant) => variant.color || '')].join(' ')
  return fold(text).split(/[^a-z0-9ñ._-]+/).filter((word) => word.length >= 2)
}

export type Filters = { color?: string | null; size?: string | null }

export function variantMatches(variant: CatalogVariant, filters: Filters): boolean {
  if (filters.color && !sameColor(variant.color, filters.color)) return false
  if (filters.size && !sameSize(variant.size, filters.size)) return false
  return true
}

/** Products whose name, brand or code match every meaningful word of the query (typo tolerant). */
export function matchProducts(catalog: CatalogProduct[], query: string | null, filters: Filters = {}): CatalogProduct[] {
  const words = query ? queryWords(query) : []
  const bySku = query ? catalog.filter((product) => fold(product.sku) === fold(query.trim())) : []
  if (bySku.length) return bySku
  // A reference written among other words ("tenis AD223") is decisive: it identifies exactly one product.
  const codes = (query || '').split(' ').map((token) => fold(token)).filter((token) => token.length >= 3 && /[0-9]/.test(token) && /[a-z]/.test(token))
  const byCode = codes.length ? catalog.filter((product) => codes.includes(fold(product.sku))) : []
  if (byCode.length === 1) return byCode
  let candidates = catalog
  if (words.length) {
    candidates = catalog.filter((product) => {
      const own = productWordsOf(product)
      return words.every((word) => own.some((candidate) => similarWord(word, candidate) || (word.length >= 4 && singular(candidate).startsWith(singular(word)))))
    })
  }
  // A colour or size in the message narrows the list to products that really have it.
  if (filters.color || filters.size) {
    const narrowed = candidates.filter((product) => product.variants.some((variant) => variantMatches(variant, filters)))
    if (narrowed.length || !words.length) candidates = narrowed
  }
  return words.length || filters.color || filters.size ? candidates : []
}

export type Resolution = { kind: 'one'; product: CatalogProduct } | { kind: 'many'; options: CatalogProduct[] } | { kind: 'none'; reason: 'no_query' | 'not_found' }

/** Resolves the product: explicit words first, then the product in focus (only when unequivocal). */
export function resolveProduct(catalog: CatalogProduct[], query: string | null, filters: Filters, focusSku?: string | null): Resolution {
  const focus = focusSku ? catalog.find((product) => product.sku === focusSku) : undefined
  const pointsBack = !query || /^(?:ese|esa|esos|esas|este|esta|estos|estas|el anterior|la anterior|el mismo|la misma|lo mismo|ese producto|este producto)$/i.test(fold(query).trim())
  if (pointsBack) {
    if (focus && (!filters.color && !filters.size || focus.variants.some((variant) => variantMatches(variant, filters)))) return { kind: 'one', product: focus }
    if (!filters.color && !filters.size) return { kind: 'none', reason: 'no_query' }
  }
  const found = matchProducts(catalog, pointsBack ? null : query, filters)
  if (found.length === 1) return { kind: 'one', product: found[0]! }
  if (found.length > 1) {
    // The product in focus wins only if it is one of the matches.
    if (focus && found.some((product) => product.id === focus.id) && pointsBack) return { kind: 'one', product: focus }
    return { kind: 'many', options: found.slice(0, 8) }
  }
  return { kind: 'none', reason: query && !pointsBack ? 'not_found' : 'no_query' }
}

export function variantLabel(variant: Pick<CatalogVariant, 'size' | 'color' | 'sku'>): string {
  const parts = [variant.color && variant.color !== 'Único' ? variant.color : null, variant.size && variant.size !== 'Única' ? `talla ${variant.size}` : null].filter(Boolean)
  return parts.length ? parts.join(' · ') : 'única'
}
