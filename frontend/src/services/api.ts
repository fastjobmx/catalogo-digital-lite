// ============================================
// Catálogo Digital Lite - Cliente API
// ============================================
// Conecta el frontend con el Worker Cloudflare (Hono + D1).
// En desarrollo VITE_API_URL se deja vacío y Vite hace proxy de /api
// hacia el Worker local (http://localhost:8788).
// En producción se define VITE_API_URL con la URL del Worker desplegado.

import type { ThemeConfig } from '../types/theme'
import { IS_PUBLIC_DEMO } from '../lib/publicDemo'

const API_BASE = import.meta.env.VITE_API_URL || ''
const inflightGetRequests = new Map<string, Promise<unknown>>()

interface ApiError {
 error: string
 message?: string
}

async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
 if (IS_PUBLIC_DEMO) throw new Error('La API está desactivada en esta vista de demostración.')
 const url = `${API_BASE}${path}`
 const method = (options?.method || 'GET').toUpperCase()
 const headers = new Headers(options?.headers)
 const key = `${url}|${headers.get('Authorization') || ''}`
 const existing = method === 'GET' ? inflightGetRequests.get(key) : undefined
 if (existing) return existing as Promise<T>

 const request = (async () => {
  try {
  const requestHeaders = new Headers(options?.headers)
  if (!requestHeaders.has('Content-Type')) requestHeaders.set('Content-Type', 'application/json')
  const response = await fetch(url, { ...options, headers: requestHeaders })

 if (!response.ok) {
 const errorData = await response.json().catch(() => ({ error: 'Unknown error' })) as ApiError
 throw new Error(errorData.error || `HTTP ${response.status}`)
 }

  return await response.json() as T
 } catch (err) {
 // Si el backend no está disponible, lanzar error claro
 if (err instanceof TypeError && err.message.includes('fetch')) {
 throw new Error('Backend no disponible. Inicia el Worker con "npm run dev" en la carpeta worker.')
 }
 throw err
 }
 })()
 if (method !== 'GET') return request
 inflightGetRequests.set(key, request)
 try { return await request }
 finally { if (inflightGetRequests.get(key) === request) inflightGetRequests.delete(key) }
}

// ============================================
// Store Config API
// ============================================

export interface StoreConfigApi {
 name: string
 description: string
 slogan: string | null
 businessType: string
 logoUrl: string | null
 faviconUrl: string | null
 coverImageUrl: string | null
 primaryColor: string
 secondaryColor: string
 accentColor: string
 buttonColor: string
 whatsappPhone: string
 whatsappOrders: string | null
 phone: string | null
 email: string | null
 address: string | null
 hours: string | null
 instagram: string | null
 facebook: string | null
 tiktok: string | null
 mapsUrl: string | null
 currency: string
 country: string
 deliveryMethods: string[]
 pickupAvailable: boolean
 paymentInfo: string | null
  defaultWhatsappMessage: string
  themeConfig?: Partial<ThemeConfig> | null
}

export async function getStoreConfig(): Promise<StoreConfigApi> {
 return fetchApi<StoreConfigApi>('/api/store')
}

// ============================================
// Products API
// ============================================

export interface ProductVariantApi {
 id: number
 sku: string
 name: string
 size: string | null
 color: string | null
 priceOverride: number | null
 stock: number
 isActive: boolean
}

export interface ProductApi {
 id: number
 sku: string
 name: string
 description: string
 brand: string | null
 price: number
 compareAtPrice: number | null
 isFeatured: boolean
 isActive?: boolean
 imageUrls: string[]
 categoryId: number | null
 categoryName: string | null
 categorySlug: string | null
 variants: ProductVariantApi[]
}

export interface GetProductsParams {
 category?: string
 q?: string
 featured?: boolean
}

export async function getProducts(params?: GetProductsParams, options?: RequestInit): Promise<ProductApi[]> {
 const query = new URLSearchParams()
 if (params?.category) query.set('category', params.category)
 if (params?.q) query.set('q', params.q)
 if (params?.featured) query.set('featured', '1')

 const qs = query.toString()
 return fetchApi<ProductApi[]>(`/api/products${qs ? `?${qs}` : ''}`, options)
}

export async function getProduct(sku: string, options?: RequestInit): Promise<ProductApi> {
 return fetchApi<ProductApi>(`/api/products/${encodeURIComponent(sku)}`, options)
}

// ============================================
// Categories API
// ============================================

export interface CategoryApi {
 id: number
 name: string
 slug: string
 description: string
 sortOrder: number
 productCount: number
}

export async function getCategories(): Promise<CategoryApi[]> {
 return fetchApi<CategoryApi[]>('/api/categories')
}

// ============================================
// Admin API
// ============================================

export interface AdminLoginResponse {
 token: string
 email: string
 expiresAt: string
 message?: string
}

export async function adminLogin(email: string, password: string): Promise<AdminLoginResponse> {
 return fetchApi<AdminLoginResponse>('/api/admin/login', {
 method: 'POST',
 body: JSON.stringify({ email, password }),
 })
}

export interface AdminStats {
 products: number
 categories: number
 totalStock: number
 ordersToday: number
}

export async function getAdminStats(token: string): Promise<AdminStats> {
 return fetchApi<AdminStats>('/api/admin/stats', {
 headers: { Authorization: `Bearer ${token}` },
 })
}

export async function updateStoreConfig(
 config: Partial<StoreConfigApi>,
 token: string
): Promise<{ success: boolean; updated: number }> {
 return fetchApi<{ success: boolean; updated: number }>('/api/admin/store', {
 method: 'PUT',
 headers: { Authorization: `Bearer ${token}` },
 body: JSON.stringify(config),
 })
}

// ============================================
// Admin CRUD - Products
// ============================================

export interface CreateProductPayload {
 sku: string
 name: string
 description?: string
 brand?: string
 categoryId?: number | null
 price: number
 compareAtPrice?: number | null
 isFeatured?: boolean
 imageUrls?: string[]
 variants?: Array<{
 sku?: string
 name?: string
 size?: string
 color?: string
 priceOverride?: number
 stock: number
 sortOrder?: number
 }>
}

export async function createProduct(payload: CreateProductPayload, token: string): Promise<{ id: number; sku: string }> {
 return fetchApi<{ id: number; sku: string }>('/api/admin/products', {
 method: 'POST',
 headers: { Authorization: `Bearer ${token}` },
 body: JSON.stringify(payload),
 })
}

export interface UpdateProductPayload {
 name?: string
 description?: string
 brand?: string
 categoryId?: number | null
 price?: number
 compareAtPrice?: number | null
 isFeatured?: boolean
 imageUrls?: string[]
 isActive?: boolean
}

export async function updateProduct(id: number, payload: UpdateProductPayload, token: string): Promise<{ success: boolean; id: number }> {
 return fetchApi<{ success: boolean; id: number }>(`/api/admin/products/${id}`, {
 method: 'PUT',
 headers: { Authorization: `Bearer ${token}` },
 body: JSON.stringify(payload),
 })
}

export async function archiveProduct(id: number, token: string): Promise<{ success: boolean; archived: number }> {
  return fetchApi<{ success: boolean; archived: number }>(`/api/admin/products/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
}

export async function updateProductVariants(
  id: number,
  variants: Array<{ id: number; stock: number }>,
  token: string
): Promise<{ success: boolean }> {
  return fetchApi<{ success: boolean }>(`/api/admin/products/${id}/variants`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ variants }),
  })
}

export async function restoreProduct(id: number, token: string): Promise<{ success: boolean; id: number }> {
  return fetchApi<{ success: boolean; id: number }>(`/api/admin/products/${id}/restore`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
}

// ============================================
// Admin CRUD - Categories
// ============================================

export interface CreateCategoryPayload {
 name: string
 slug: string
 description?: string
 sortOrder?: number
}

export async function createCategory(payload: CreateCategoryPayload, token: string): Promise<{ id: number; slug: string }> {
 return fetchApi<{ id: number; slug: string }>('/api/admin/categories', {
 method: 'POST',
 headers: { Authorization: `Bearer ${token}` },
 body: JSON.stringify(payload),
 })
}

export async function updateCategory(id: number, payload: Pick<CreateCategoryPayload, 'name' | 'slug'>, token: string): Promise<{ success: boolean; id: number; slug: string }> {
 return fetchApi<{ success: boolean; id: number; slug: string }>(`/api/admin/categories/${id}`, {
 method: 'PUT', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(payload),
 })
}

export async function deactivateCategory(id: number, token: string): Promise<{ success: boolean; deactivated: number }> {
 return fetchApi<{ success: boolean; deactivated: number }>(`/api/admin/categories/${id}`, {
 method: 'DELETE',
 headers: { Authorization: `Bearer ${token}` },
 })
}

// ============================================
// Upload API
// ============================================

export interface UploadImageResponse {
 url: string
 key: string
 size: number
 type: string
 warning?: string
}

export async function uploadImage(file: File, folder: string, token: string): Promise<UploadImageResponse> {
 const formData = new FormData()
 formData.append('file', file)
 formData.append('folder', folder)

 const url = `${API_BASE}/api/upload/image`
 const response = await fetch(url, {
 method: 'POST',
 headers: { Authorization: `Bearer ${token}` },
 body: formData,
 })

 if (!response.ok) {
 const errorData = await response.json().catch(() => ({ error: 'Upload failed' })) as ApiError
 throw new Error(errorData.error || `HTTP ${response.status}`)
 }

 return response.json() as Promise<UploadImageResponse>
}

// ============================================
// Orders API
// ============================================

export interface OrderItemPayload {
  productId?: string
  variantId?: string
  sku: string
  name: string
  price: number
  size?: string
  color?: string
  imageUrl?: string
  quantity: number
  lineSubtotal?: number
}

export interface CreateOrderPayload {
  customerName?: string
  customerPhone?: string
  customerEmail?: string
  customerCity?: string
  deliveryAddress?: string
  deliveryMethod?: string
  paymentMethod?: string
  notes?: string
  currency?: string
  items: OrderItemPayload[]
}

export interface CreateOrderResponse {
  id: number
  displayId: string
  subtotal: number
  discountTotal: number
  total: number | null
  currency: string
  status: string
  paymentStatus: string
  items: OrderItemPayload[]
  replayed?: boolean
}

export async function createOrder(payload: CreateOrderPayload, idempotencyKey: string): Promise<CreateOrderResponse> {
  return fetchApi<CreateOrderResponse>('/api/orders', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(payload),
  })
}

export interface OrderApi {
  id: number
  displayId: string
  customerName: string | null
  customerPhone: string | null
  deliveryAddress: string | null
  deliveryMethod: string | null
  items: OrderItemPayload[]
  subtotal: number
  discountTotal: number
  total: number | null
  shippingCost: number | null
  currency: string
  status: string
  paymentStatus: string
  paymentMethod: string | null
  customerNotes: string | null
  customerCity: string | null
  revision: number
  createdAt: string
}

export interface OrderPageApi { items: OrderApi[]; page: number; pageSize: number; total: number }

export async function getOrders(token: string, params: { page?: number; pageSize?: number; status?: string; from?: string; to?: string; q?: string } = {}): Promise<OrderPageApi> {
  const query = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => { if (value !== undefined && value !== '') query.set(key, String(value)) })
  return fetchApi<OrderPageApi>(`/api/orders${query.size ? `?${query.toString()}` : ''}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export interface OrderEventApi { eventType: string; fromValue: string | null; toValue: string | null; note: string | null; performedBy: string; createdAt: string }
export interface OrderDetailApi extends OrderApi {
  customerEmail: string | null
  internalNotes: string
  deliveryAddress: string | null
  deliveryMethod: string | null
  events: OrderEventApi[]
}

export async function getOrder(id: number, token: string): Promise<OrderDetailApi> {
  return fetchApi<OrderDetailApi>(`/api/orders/${id}`, { headers: { Authorization: `Bearer ${token}` } })
}

export async function updateOrder(id: number, patch: { status?: string; paymentStatus?: string; internalNotes?: string; shippingCost?: number | null; expectedRevision: number }, token: string): Promise<{ success: boolean; revision: number }> {
  return fetchApi<{ success: boolean; revision: number }>(`/api/orders/${id}`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(patch),
  })
}

// ============================================
// Health Check
// ============================================

export interface HealthResponse {
 status: string
 environment: string
 timestamp: string
}

export async function checkHealth(): Promise<HealthResponse> {
 return fetchApi<HealthResponse>('/api/health')
}

// ============================================
// Backend Availability Check
// ============================================

export async function isBackendAvailable(): Promise<boolean> {
 try {
 await checkHealth()
 return true
 } catch {
 return false
 }
}
