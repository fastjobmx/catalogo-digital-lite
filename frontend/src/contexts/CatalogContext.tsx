import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { DEMO_CATALOG_VERSION } from '../data/catalogVersion'
import {
  archiveProduct as apiArchive,
  createCategory as apiCreateCategory,
  deactivateCategory as apiDeactivateCategory,
  createProduct as apiCreateProduct,
  getCategories,
  getProducts,
  restoreProduct as apiRestore,
  updateProduct as apiUpdateProduct,
  updateProductVariants as apiUpdateVariants,
  updateCategory as apiUpdateCategory,
  type CategoryApi,
  type CreateCategoryPayload,
  type CreateProductPayload,
  type ProductApi,
  type UpdateProductPayload,
} from '../services/api'
import { slugify } from '../lib/format'
import { findProductBySku } from '../lib/catalog'
import { isIndependentInstallation, storeStorageKey } from '../lib/installation'
import { useAuth } from './AuthContext'
import { useStore } from './StoreContext'
import { IS_PUBLIC_DEMO } from '../lib/publicDemo'

const PRODUCTS_KEY = storeStorageKey('catalogo-lite-demo-products')
const CATEGORIES_KEY = storeStorageKey('catalogo-lite-demo-categories')
const VERSION_KEY = storeStorageKey('catalogo-lite-demo-version')

// Si la versión del catálogo demo cambió, descarta la copia local antigua para
// que el nuevo catálogo se muestre sin que el usuario limpie el navegador.
function syncDemoVersion() {
  try {
    if (localStorage.getItem(VERSION_KEY) === DEMO_CATALOG_VERSION) return
    // Las claves pueden incluir productos creados o editados en modo local.
    // Nunca se borran automáticamente al actualizar los datos base de la demo.
    localStorage.setItem(VERSION_KEY, DEMO_CATALOG_VERSION)
  } catch { /* ignore */ }
}

export interface CatalogContextValue {
  products: ProductApi[]
  categories: CategoryApi[]
  archived: ProductApi[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  getBySku: (sku: string) => ProductApi | undefined
  createProduct: (payload: CreateProductPayload) => Promise<ProductApi>
  updateProduct: (id: number, payload: UpdateProductPayload) => Promise<void>
  archiveProduct: (id: number) => Promise<void>
  restoreProduct: (id: number) => Promise<void>
  updateVariantStock: (productId: number, variantId: number, stock: number) => Promise<void>
  createCategory: (payload: CreateCategoryPayload) => Promise<CategoryApi>
  updateCategory: (id: number, payload: Pick<CreateCategoryPayload, 'name' | 'slug'>) => Promise<void>
  deactivateCategory: (id: number) => Promise<void>
}

export const CatalogContext = createContext<CatalogContextValue | undefined>(undefined)

async function loadLocalProducts(): Promise<ProductApi[]> {
  if (IS_PUBLIC_DEMO) {
    const { DEMO_PRODUCTS } = await import('../data/demoCatalog')
    return structuredClone(DEMO_PRODUCTS)
  }
  if (isIndependentInstallation()) return []
  try {
    const raw = localStorage.getItem(PRODUCTS_KEY)
    if (raw) return JSON.parse(raw) as ProductApi[]
  } catch { /* ignore */ }
  const { DEMO_PRODUCTS } = await import('../data/demoCatalog')
  return structuredClone(DEMO_PRODUCTS)
}

async function loadLocalCategories(): Promise<CategoryApi[]> {
  if (IS_PUBLIC_DEMO) {
    const { DEMO_CATEGORIES } = await import('../data/demoCatalog')
    return structuredClone(DEMO_CATEGORIES)
  }
  if (isIndependentInstallation()) return []
  try {
    const raw = localStorage.getItem(CATEGORIES_KEY)
    if (raw) return JSON.parse(raw) as CategoryApi[]
  } catch { /* ignore */ }
  const { DEMO_CATEGORIES } = await import('../data/demoCatalog')
  return structuredClone(DEMO_CATEGORIES)
}

function recount(categories: CategoryApi[], products: ProductApi[]): CategoryApi[] {
  return categories.map((c) => ({
    ...c,
    productCount: products.filter((p) => p.categoryId === c.id && p.isActive !== false).length,
  }))
}

export function CatalogProvider({ children }: { children: ReactNode }) {
  const { backendAvailable } = useStore()
  const { token, isDemoSession } = useAuth()
  const [products, setProducts] = useState<ProductApi[]>([])
  const [archived, setArchived] = useState<ProductApi[]>([])
  const [categories, setCategories] = useState<CategoryApi[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const persistLocal = (nextProducts: ProductApi[], nextCategories: CategoryApi[]) => {
    localStorage.setItem(PRODUCTS_KEY, JSON.stringify(nextProducts))
    localStorage.setItem(CATEGORIES_KEY, JSON.stringify(recount(nextCategories, nextProducts)))
  }

  const requireLocalDemo = () => {
    if (!isDemoSession) throw new Error('El servidor no está disponible; no se guardó el cambio.')
  }

  const refresh = async () => {
    setLoading(true)
    if (!IS_PUBLIC_DEMO) syncDemoVersion()
    try {
      if (backendAvailable) {
        setProducts([])
        setCategories([])
        setArchived([])
        const [prods, cats] = await Promise.all([getProducts(), getCategories()])
        setError(null)
        setProducts(prods)
        setCategories(cats.map((c) => ({
          ...c,
          sortOrder: (c as CategoryApi).sortOrder ?? (c as unknown as { sort_order?: number }).sort_order ?? 0,
          productCount: (c as CategoryApi).productCount ?? (c as unknown as { product_count?: number }).product_count ?? 0,
        })))
        setArchived([])
      } else {
        setError(null)
        const [localProducts, localCats] = await Promise.all([loadLocalProducts(), loadLocalCategories()])
        setProducts(localProducts.filter((p) => p.isActive !== false))
        setArchived(localProducts.filter((p) => p.isActive === false))
        setCategories(recount(localCats, localProducts.filter((p) => p.isActive !== false)))
      }
    } catch (err) {
      // No mezclar registros demo con una tienda cuyo backend está seleccionado.
      setError(err instanceof Error ? err.message : 'No se pudo cargar el catálogo del servidor.')
    } finally {
      setLoading(false)
    }
  }

  // Reload after signing in or out too: a draft store's catalogue is only visible with the team's session.
  useEffect(() => {
    void refresh()
  }, [backendAvailable, token])

  const value = useMemo<CatalogContextValue>(() => ({
    products,
    categories,
    archived,
    loading,
    error,
    refresh,
    getBySku: (sku) => findProductBySku(products, sku),
    createProduct: async (payload) => {
      if (backendAvailable && token && !isDemoSession) {
        await apiCreateProduct(payload, token)
        await refresh()
        return products[0]!
      }
      requireLocalDemo()
      const id = Date.now()
      const cat = categories.find((c) => c.id === payload.categoryId)
      const product: ProductApi = {
        id,
        sku: payload.sku,
        name: payload.name,
        description: payload.description || '',
        brand: payload.brand || null,
        price: payload.price,
        compareAtPrice: payload.compareAtPrice ?? null,
        isFeatured: Boolean(payload.isFeatured),
        imageUrls: payload.imageUrls || [],
        categoryId: payload.categoryId ?? null,
        categoryName: cat?.name ?? null,
        categorySlug: cat?.slug ?? null,
        isActive: true,
        variants: (payload.variants || [{ sku: `${payload.sku}-UNI`, name: 'Único', stock: 0 }]).map((v, i) => ({
          id: id + i + 1,
          sku: v.sku || `${payload.sku}-${i + 1}`,
          name: v.name || v.size || 'Variante',
          size: v.size || null,
          color: v.color || null,
          priceOverride: v.priceOverride ?? null,
          stock: v.stock,
          isActive: true,
        })),
      }
      const next = [product, ...products, ...archived]
      setProducts([product, ...products])
      persistLocal(next, categories)
      setCategories(recount(categories, [product, ...products]))
      return product
    },
    updateProduct: async (id, payload) => {
      if (backendAvailable && token && !isDemoSession) {
        await apiUpdateProduct(id, payload, token)
        await refresh()
        return
      }
      requireLocalDemo()
      const mapItem = (p: ProductApi): ProductApi => p.id !== id ? p : {
        ...p,
        name: payload.name ?? p.name,
        description: payload.description ?? p.description,
        brand: payload.brand === undefined ? p.brand : payload.brand,
        price: payload.price ?? p.price,
        compareAtPrice: payload.compareAtPrice === undefined ? p.compareAtPrice : payload.compareAtPrice,
        isFeatured: payload.isFeatured ?? p.isFeatured,
        imageUrls: payload.imageUrls ?? p.imageUrls,
        isActive: payload.isActive ?? p.isActive,
      }
      const nextActive = products.map(mapItem)
      setProducts(nextActive)
      persistLocal([...nextActive, ...archived], categories)
    },
    archiveProduct: async (id) => {
      if (backendAvailable && token && !isDemoSession) {
        await apiArchive(id, token)
        await refresh()
        return
      }
      requireLocalDemo()
      const found = products.find((p) => p.id === id)
      if (!found) return
      const nextActive = products.filter((p) => p.id !== id)
      const nextArchived = [{ ...found, isActive: false }, ...archived]
      setProducts(nextActive)
      setArchived(nextArchived)
      persistLocal([...nextActive, ...nextArchived], categories)
      setCategories(recount(categories, nextActive))
    },
    restoreProduct: async (id) => {
      const found = archived.find((p) => p.id === id)
      if (!found) return
      if (backendAvailable && token && !isDemoSession) {
        await apiRestore(id, token)
        await refresh()
        return
      }
      requireLocalDemo()
      const restored = { ...found, isActive: true }
      const nextActive = [restored, ...products]
      const nextArchived = archived.filter((p) => p.id !== id)
      setProducts(nextActive)
      setArchived(nextArchived)
      persistLocal([...nextActive, ...nextArchived], categories)
    },
    updateVariantStock: async (productId, variantId, stock) => {
      const next = products.map((p) => p.id !== productId ? p : {
        ...p,
        variants: p.variants.map((v) => v.id === variantId ? { ...v, stock } : v),
      })
      if (backendAvailable && token && !isDemoSession) {
        const product = next.find((p) => p.id === productId)
        await apiUpdateVariants(
          productId,
          (product?.variants ?? []).map((v) => ({ id: v.id, stock: v.stock })),
          token,
        )
      } else {
        requireLocalDemo()
      }
      setProducts(next)
      persistLocal([...next, ...archived], categories)
    },
    createCategory: async (payload) => {
      if (backendAvailable && token && !isDemoSession) {
        await apiCreateCategory(payload, token)
        await refresh()
        return categories[0]!
      }
      requireLocalDemo()
      const cat: CategoryApi = {
        id: Date.now(),
        name: payload.name,
        slug: payload.slug || slugify(payload.name),
        description: payload.description || '',
        sortOrder: payload.sortOrder || categories.length + 1,
        productCount: 0,
      }
      const next = [...categories, cat]
      setCategories(next)
      persistLocal([...products, ...archived], next)
      return cat
    },
    deactivateCategory: async (id) => {
      if (backendAvailable && token && !isDemoSession) {
        await apiDeactivateCategory(id, token)
        await refresh()
        return
      }
      requireLocalDemo()
      const next = categories.filter((c) => c.id !== id)
      setCategories(next)
      persistLocal([...products, ...archived], next)
    },
    updateCategory: async (id, payload) => {
      if (backendAvailable && token && !isDemoSession) {
        await apiUpdateCategory(id, payload, token)
        await refresh()
        return
      }
      requireLocalDemo()
      const next = categories.map((category) => category.id === id ? { ...category, ...payload } : category)
      setCategories(next)
      persistLocal([...products, ...archived], next)
    },
  }), [products, categories, archived, loading, error, backendAvailable, token, isDemoSession])

  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>
}

export function useCatalog() {
  const ctx = useContext(CatalogContext)
  if (!ctx) throw new Error('useCatalog must be used within CatalogProvider')
  return ctx
}
