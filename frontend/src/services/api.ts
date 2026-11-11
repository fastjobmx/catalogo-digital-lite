// ============================================
// Catálogo Digital Lite - Cliente API
// ============================================
// Conecta el frontend con el Worker Cloudflare (Hono + D1).
// En desarrollo VITE_API_URL se deja vacío y Vite hace proxy de /api
// hacia el Worker local (http://localhost:8788).
// En producción se define VITE_API_URL con la URL del Worker desplegado.

import type { ThemeConfig } from '../types/theme'
import { IS_PUBLIC_DEMO } from '../lib/publicDemo'
import { tenantHeaders } from '../lib/tenant'
import { storeStorageKey } from '../lib/installation'

const API_BASE = import.meta.env.VITE_API_URL || ''
const inflightGetRequests = new Map<string, Promise<unknown>>()

interface ApiError {
 error: string
 message?: string
 code?: string
}

/** API failure with the HTTP status and the backend's stable error code. */
export class ApiRequestError extends Error {
 constructor(message: string, readonly status: number, readonly code?: string) {
  super(message)
  this.name = 'ApiRequestError'
 }
}

function readPreviewToken(): string | null {
 try {
  const token = localStorage.getItem(storeStorageKey('catalogo-lite-admin-token'))
  return token && token !== 'demo-local' ? token : null
 } catch { return null }
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
  for (const [name, value] of Object.entries(tenantHeaders())) if (!requestHeaders.has(name)) requestHeaders.set(name, value)
  // Draft stores are private: their own team previews them with its session.
  const previewToken = method === 'GET' && /^\/api\/(?:store|products|categories)(?:[/?]|$)/.test(path) ? readPreviewToken() : null
  if (previewToken && !requestHeaders.has('Authorization')) requestHeaders.set('Authorization', `Bearer ${previewToken}`)
  const response = await fetch(url, { ...options, headers: requestHeaders })

 if (!response.ok) {
 const errorData = await response.json().catch(() => ({ error: 'Unknown error' })) as ApiError
 throw new ApiRequestError(errorData.error || `HTTP ${response.status}`, response.status, errorData.code)
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
  template?: string
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

export interface StoreAccess {
 storeId: number
 slug: string
 name: string
 status: string
 role: string
}

export interface AdminLoginResponse {
 token: string
 email: string
 expiresAt: string
 role?: 'superadmin' | 'user'
 stores?: StoreAccess[]
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
 headers: { Authorization: `Bearer ${token}`, ...tenantHeaders() },
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
  couponCode?: string
  marketingConsent?: boolean
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

export interface CouponPreview { valid: boolean; code?: string; discount?: number; message?: string }

/** Cart preview only; the order endpoint validates the coupon again with catalog prices. */
export async function validateCoupon(code: string, subtotal: number): Promise<CouponPreview> {
  return fetchApi<CouponPreview>('/api/orders/coupon', { method: 'POST', body: JSON.stringify({ code, subtotal }) })
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
  carrier?: string | null
  trackingNumber?: string | null
  shippedAt?: string | null
  deliveredAt?: string | null
  shippingStatus?: string | null
  effectiveShippingStatus?: string | null
  trackingUrl?: string | null
  shippingNotes?: string | null
  delivery?: { method: string | null; receiver: string | null; notes: string | null; reference: string | null }
  paymentMethod: string | null
  customerNotes: string | null
  customerCity: string | null
  revision: number
  createdAt: string
}

export interface OrderPageApi { items: OrderApi[]; page: number; pageSize: number; total: number }

export async function getOrders(token: string, params: { page?: number; pageSize?: number; status?: string; shipping?: string; from?: string; to?: string; q?: string } = {}): Promise<OrderPageApi> {
  const query = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => { if (value !== undefined && value !== '') query.set(key, String(value)) })
  return fetchApi<OrderPageApi>(`/api/orders${query.size ? `?${query.toString()}` : ''}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export interface OrderEventApi { id: number; eventType: string; fromValue: string | null; toValue: string | null; note: string | null; performedBy: string; createdAt: string }
export interface OrderDocumentApi { id: number; kind: string; contentType: string; byteSize: number; source: string; createdBy: string; createdAt: string; hasTelegramCopy: boolean }
export interface OrderStatsApi { pendiente: number; confirmado: number; preparando: number; entregado_transportadora: number; en_transito: number; incidencia: number; entregado: number; cancelado: number; total: number }
export interface OrderDetailApi extends OrderApi {
  customerEmail: string | null
  internalNotes: string
  deliveryAddress: string | null
  deliveryMethod: string | null
  events: OrderEventApi[]
  documents: OrderDocumentApi[]
  customerNotice: string | null
}

export async function getOrder(id: number, token: string): Promise<OrderDetailApi> {
  return fetchApi<OrderDetailApi>(`/api/orders/${id}`, { headers: { Authorization: `Bearer ${token}` } })
}

export type OrderPatch = {
  status?: string; paymentStatus?: string; shippingStatus?: string | null; internalNotes?: string; shippingCost?: number | null
  carrier?: string | null; trackingNumber?: string | null; trackingUrl?: string | null; shippedAt?: string | null; shippingNotes?: string | null
  delivery?: { deliveredAt?: string | null; method?: string | null; receiver?: string | null; notes?: string | null; reference?: string | null }
  reason?: string | null; expectedRevision: number
}
export async function updateOrder(id: number, patch: OrderPatch, token: string): Promise<{ success: boolean; revision: number; changed?: number }> {
  return fetchApi<{ success: boolean; revision: number; changed?: number }>(`/api/orders/${id}`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(patch),
  })
}

export async function getOrderStats(token: string): Promise<OrderStatsApi> {
  return fetchApi<OrderStatsApi>('/api/orders/stats', { headers: { Authorization: `Bearer ${token}` } })
}

/** Private guide photo: fetched with the session and shown as a local blob (never a public URL). */
export async function getOrderDocument(orderId: number, documentId: number, token: string, download = false): Promise<Blob> {
  const response = await fetch(`${API_BASE}/api/orders/${orderId}/documents/${documentId}${download ? '?download=1' : ''}`, { headers: { Authorization: `Bearer ${token}`, ...tenantHeaders() } })
  if (!response.ok) throw new Error('No se pudo abrir la guía')
  return response.blob()
}

export async function uploadOrderDocument(orderId: number, file: File, token: string): Promise<{ id: number; duplicate: boolean }> {
  const form = new FormData()
  form.append('file', file)
  const response = await fetch(`${API_BASE}/api/orders/${orderId}/documents`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, ...tenantHeaders() }, body: form })
  const body = await response.json().catch(() => ({})) as { id?: number; duplicate?: boolean; error?: string }
  if (!response.ok) throw new Error(body.error || 'No se pudo subir la guía')
  return { id: Number(body.id), duplicate: Boolean(body.duplicate) }
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

// ============================================
// Activación de cuentas y plataforma multitienda
// ============================================

export async function getActivationInfo(token: string): Promise<{ email: string | null; store: { slug: string; name: string } }> {
  return fetchApi(`/api/auth/activation?token=${encodeURIComponent(token)}`)
}

export async function activateAccount(token: string, password: string): Promise<AdminLoginResponse & { store: { slug: string; name: string } | null }> {
  return fetchApi('/api/auth/activate', { method: 'POST', body: JSON.stringify({ token, password }) })
}

export async function requestPasswordReset(email: string): Promise<{ ok: boolean }> {
  return fetchApi('/api/auth/password-reset/request', { method: 'POST', body: JSON.stringify({ email }) })
}

export async function getPasswordResetInfo(token: string): Promise<{ email: string; store: { slug: string; name: string } }> {
  return fetchApi(`/api/auth/password-reset?token=${encodeURIComponent(token)}`)
}

export async function resetPassword(token: string, password: string): Promise<AdminLoginResponse & { store: { slug: string; name: string } | null }> {
  return fetchApi('/api/auth/password-reset', { method: 'POST', body: JSON.stringify({ token, password }) })
}

export interface PlatformStore {
  id: number; slug: string; name: string; status: string; planCode: string; template: string; businessType: string
  products: number; ordersLast30: number; aiPercent: number; ownerEmail: string | null; createdAt: string; activationRequestStatus: string | null
  telegramBulkImportEnabled: number
}

export interface PlatformSummary {
  period: string; stores: number; active: number; draft: number; suspended: number; products: number
  ordersLast30: number; pendingOrders: number; aiCostMicros: number; aiRequests: number; errorsLast24h: number; failedJobs: number
}

export interface ProvisionStep { key: string; label: string; status: 'ok' | 'error' | 'skipped'; detail?: string }

export interface ProvisionResponse {
  jobId: string; status: 'completed' | 'failed' | 'running'; storeId?: number; slug?: string; name?: string
  publicUrl?: string; adminUrl?: string; activationUrl?: string | null; telegramLinkCode?: string | null
  telegramDeepLink?: string | null; steps: ProvisionStep[]; errorCode?: string; replayed?: boolean
}

export interface CreateStorePayload {
  name: string; slug?: string; businessType: string; template: 'minimalista' | 'moderno' | 'premium' | 'personalizado' | 'luxury' | 'urban' | 'boutique' | 'natural' | 'tech' | 'playful' | 'gourmet' | 'artesanal' | 'editorial' | 'stories'
  primaryColor?: string; whatsapp?: string; ownerEmail?: string; ownerTelegramId?: string; planCode: string
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` })

export const platformApi = {
  summary: (token: string) => fetchApi<PlatformSummary>('/api/platform/summary', { headers: auth(token) }),
  stores: (token: string) => fetchApi<{ items: PlatformStore[] }>('/api/platform/stores', { headers: auth(token) }),
  plans: (token: string) => fetchApi<{ items: Array<{ code: string; name: string; aiBudgetMicros: number }> }>('/api/platform/plans', { headers: auth(token) }),
  createStore: async (payload: CreateStorePayload, idempotencyKey: string, token: string): Promise<ProvisionResponse> => {
    const response = await fetch(`${API_BASE}/api/platform/stores`, {
      method: 'POST', headers: { ...auth(token), 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(payload),
    })
    const body = await response.json().catch(() => ({ error: 'Respuesta inválida' })) as ProvisionResponse & ApiError
    if (response.status === 422 || response.status === 202 || response.ok) return body
    throw new ApiRequestError(body.error || `HTTP ${response.status}`, response.status, body.code)
  },
  setStatus: (slug: string, status: string, token: string, reason?: string) => fetchApi(`/api/platform/stores/${slug}/status`, { method: 'POST', headers: auth(token), body: JSON.stringify({ status, reason }) }),
  setAi: (slug: string, budgetUsd: number, token: string) => fetchApi(`/api/platform/stores/${slug}/ai`, { method: 'PUT', headers: auth(token), body: JSON.stringify({ budgetUsd, enabled: budgetUsd > 0 }) }),
  setTelegramBulkImport: (slug: string, enabled: boolean, token: string) => fetchApi(`/api/platform/stores/${slug}/telegram-bulk-import`, { method: 'PUT', headers: auth(token), body: JSON.stringify({ enabled }) }),
  setPlan: (slug: string, planCode: string, token: string) => fetchApi(`/api/platform/stores/${slug}/plan`, { method: 'PUT', headers: auth(token), body: JSON.stringify({ planCode }) }),
  regenerateAccess: (slug: string, token: string) => fetchApi<{ activationUrl: string | null; telegramLinkCode: string | null; telegramDeepLink: string | null }>(`/api/platform/stores/${slug}/access`, { method: 'POST', headers: auth(token) }),
}

// ---- AI credits ----------------------------------------------------------------

export type CreditKind = 'recarga' | 'ajuste' | 'reserva' | 'consumo' | 'liberacion'
export interface CreditMovement { id: number; kind: CreditKind; amount: number; feature: string | null; reservationId: number | null; actor: string; reason: string | null; createdAt: string }
export interface CreditCost { feature: string; label: string; configured: boolean; credits: number | null; enabled: boolean; updatedBy?: string | null; updatedAt?: string | null }
export interface CreditRequest { id: number; credits: number; note: string | null; status: 'pendiente' | 'aprobada' | 'rechazada'; approvedCredits: number | null; resolutionNote: string | null; createdAt: string; resolvedAt: string | null; storeId?: number; slug?: string; storeName?: string; requestedBy?: string }
export interface CreditTotals { balance: number; reserved: number; recharged: number; consumed: number }
export interface StoreCredits extends CreditTotals { aiEnabled: boolean; studioAvailable?: boolean; costs: CreditCost[]; movements: CreditMovement[]; requests: CreditRequest[] }

export const creditsApi = {
  get: (token: string) => fetchApi<StoreCredits>('/api/admin/credits', { headers: { Authorization: `Bearer ${token}` } }),
  request: (credits: number, note: string, token: string) => fetchApi<CreditRequest>('/api/admin/credits/requests', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ credits, note }) }),
}

export const platformCreditsApi = {
  costs: (token: string) => fetchApi<{ items: CreditCost[] }>('/api/platform/credits/costs', { headers: auth(token) }),
  setCost: (feature: string, credits: number, enabled: boolean, token: string) => fetchApi<CreditCost>(`/api/platform/credits/costs/${feature}`, { method: 'PUT', headers: auth(token), body: JSON.stringify({ credits, enabled }) }),
  requests: (token: string, status?: string) => fetchApi<{ items: CreditRequest[] }>(`/api/platform/credits/requests${status ? `?status=${status}` : ''}`, { headers: auth(token) }),
  resolve: (id: number, decision: 'aprobada' | 'rechazada', token: string, extra: { credits?: number; note?: string } = {}) => fetchApi<CreditRequest>(`/api/platform/credits/requests/${id}/resolve`, { method: 'POST', headers: auth(token), body: JSON.stringify({ decision, ...extra }) }),
  store: (slug: string, token: string) => fetchApi<CreditTotals & { movements: CreditMovement[]; requests: CreditRequest[] }>(`/api/platform/stores/${slug}/credits`, { headers: auth(token) }),
  grant: (slug: string, payload: { kind: 'recarga' | 'ajuste'; amount: number; reason: string }, idempotencyKey: string, token: string) => fetchApi<CreditTotals & { replayed: boolean }>(`/api/platform/stores/${slug}/credits`, { method: 'POST', headers: { ...auth(token), 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(payload) }),
}

// ---- bulk product import ----------------------------------------------------------

export type ImportAction = 'create' | 'update' | 'skip' | 'invalid'
export interface ImportItemResult {
  index: number; sku: string; name: string; action: ImportAction; errors: string[]; warnings: string[]; category?: string | null
  changes?: { price?: { from: number; to: number }; stock?: Array<{ variant: string; from: number; to: number }> }
}
export interface ImportSummary { create: number; update: number; skip: number; invalid: number }
export interface ImportPreview { items: ImportItemResult[]; summary: ImportSummary; newCategories: string[]; limit: { max: number | null; count: number } }
export interface ImportJob { id: string; sourceType: string; fileName: string; status: string; created: number; updated: number; skipped: number; failed: number; createdAt: string; completedAt: string | null }
export interface TelegramImport { id: string; status: string; createdAt: string; updatedAt: string; completedAt: string | null; telegramUserId: string; photos: number; published: number; pending: number; failed: number }
export interface TelegramImportItem {
  id: number; position: number; name: string | null; description: string | null; price: number | null; stock: number | null
  size: string | null; color: string | null; sku: string | null; categoryName: string | null; status: string
  validationErrors: string[]; warnings: string[]; productId: number | null
}
export interface TelegramImportReview {
  batch: { id: string; storeId: number; status: string; maxItems: number; createdAt: string; updatedAt: string; completedAt: string | null }
  items: TelegramImportItem[]
}
export interface ImportOptions { updateExisting: boolean; createCategories: boolean }

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` })
export const importApi = {
  list: (token: string) => fetchApi<{ items: ImportJob[] }>('/api/admin/imports', { headers: bearer(token) }),
  telegramList: (token: string) => fetchApi<{ items: TelegramImport[] }>('/api/admin/telegram-imports', { headers: bearer(token) }),
  telegramReview: (id: string, token: string) => fetchApi<TelegramImportReview>(`/api/admin/telegram-imports/${encodeURIComponent(id)}`, { headers: bearer(token) }),
  telegramUpdateItem: (id: string, itemId: number, fields: Partial<TelegramImportItem>, token: string) => fetchApi<TelegramImportReview>(`/api/admin/telegram-imports/${encodeURIComponent(id)}/items/${itemId}`, { method: 'PUT', headers: bearer(token), body: JSON.stringify(fields) }),
  telegramPhoto: async (id: string, itemId: number, token: string): Promise<string> => {
    const headers = new Headers(bearer(token))
    for (const [name, value] of Object.entries(tenantHeaders())) headers.set(name, value)
    const response = await fetch(`${API_BASE}/api/admin/telegram-imports/${encodeURIComponent(id)}/items/${itemId}/photo`, { headers })
    if (!response.ok) throw new Error('No se pudo abrir la foto de esta importación.')
    return URL.createObjectURL(await response.blob())
  },
  start: (sourceType: 'csv' | 'xlsx' | 'pdf', fileName: string, options: ImportOptions, token: string) => fetchApi<{ id: string }>('/api/admin/imports', { method: 'POST', headers: bearer(token), body: JSON.stringify({ sourceType, fileName, options }) }),
  preview: (id: string, products: unknown[], token: string) => fetchApi<ImportPreview>(`/api/admin/imports/${id}/preview`, { method: 'POST', headers: bearer(token), body: JSON.stringify({ products }) }),
  apply: (id: string, index: number, products: unknown[], token: string) => fetchApi<{ batchIndex: number; summary: ImportSummary; items: ImportItemResult[]; replayed: boolean }>(`/api/admin/imports/${id}/batches/${index}`, { method: 'POST', headers: bearer(token), body: JSON.stringify({ products }) }),
  finish: (id: string, token: string) => fetchApi<ImportJob>(`/api/admin/imports/${id}/finish`, { method: 'POST', headers: bearer(token) }),
}

// ---- AI for the catalogue ---------------------------------------------------------

export interface PhotoSuggestion { name: string; description: string; category: string; colors: string[]; features: string[]; visibleBrand: string; confidence: 'alta' | 'media' | 'baja'; isProductPhoto: boolean }
export type StudioPreset = 'fondo_blanco' | 'fondo_estudio' | 'mejorar_luz'
export interface CatalogPageRow { sku: string; name: string; price: string; stock: string; category: string; color: string; size: string; description: string }

export const aiCatalogApi = {
  photoToProduct: (imageUrl: string, idempotencyKey: string, token: string) => fetchApi<{ suggestion: PhotoSuggestion; charged: number }>('/api/admin/ai/photo-product', { method: 'POST', headers: { ...bearer(token), 'Idempotency-Key': idempotencyKey }, body: JSON.stringify({ imageUrl }) }),
  studio: (imageUrl: string, preset: StudioPreset, idempotencyKey: string, token: string) => fetchApi<{ image: { mimeType: string; data: string }; preset: StudioPreset; charged: number }>('/api/admin/ai/studio', { method: 'POST', headers: { ...bearer(token), 'Idempotency-Key': idempotencyKey }, body: JSON.stringify({ imageUrl, preset }) }),
  readCatalogPage: (image: string, mimeType: string, idempotencyKey: string, token: string) => fetchApi<{ rows: CatalogPageRow[]; readable: boolean; charged: number }>('/api/admin/ai/catalog-page', { method: 'POST', headers: { ...bearer(token), 'Idempotency-Key': idempotencyKey }, body: JSON.stringify({ image, mimeType }) }),
}

// ---- catalogue trial (no account) ------------------------------------------------------

export type TrialTemplate = 'clasica' | 'boutique' | 'stories'
export type TrialState = 'activa' | 'vencida' | 'convertida' | 'eliminada'
export interface TrialProduct { id: string; name: string; price: number | null; description: string; imageUrl: string | null }
export interface TrialColors { primary: string; accent: string }
export interface TrialView {
  id: string; businessName: string; template: TrialTemplate; state: TrialState; owner: boolean
  logoUrl: string | null; whatsapp: string | null; colors: TrialColors; products: TrialProduct[]
  ordersOpen: boolean; ordersEnabled: boolean
  expiresAt: string; deleteAfter: string; temporary: true; published: false
  limits: { maxProducts: number; maxPhotoMb: number; templates: TrialTemplate[] }
  /** AI photo improvements this trial may use (owner view of an active trial; null otherwise). */
  photoEnhance?: { limit: number; used: number } | null
}
export interface TrialConfig { enabled: boolean; durationHours: number; retentionHours: number; maxProducts: number; maxPhotoMb: number; templates: TrialTemplate[]; ordersEnabled: boolean; plans: Array<{ key: string; label: string }> }
export interface TrialOrderLine { productId: string; name: string; price: number; quantity: number; subtotal: number }
export interface TrialOrder { code: string; items: TrialOrderLine[]; total: number; customerName: string | null; note: string | null; createdAt: string }
export interface TrialActivationRequest { code: string; status: 'pendiente' | 'convertida' | 'descartada'; planChoice: string; planLabel: string; createdAt: string }

async function trialFetch<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  if (init.token) headers.set('X-Trial-Token', init.token)
  const response = await fetch(`${API_BASE}${path}`, { ...init, headers })
  const body = await response.json().catch(() => ({})) as T & ApiError
  if (!response.ok) throw new ApiRequestError(body.error || `HTTP ${response.status}`, response.status, body.code)
  return body
}

export const trialApi = {
  config: () => trialFetch<TrialConfig>('/api/trial/config'),
  create: (businessName: string, template: TrialTemplate) => trialFetch<TrialView & { editToken: string }>('/api/trial', { method: 'POST', body: JSON.stringify({ businessName, template }) }),
  get: (id: string, token?: string | null) => trialFetch<TrialView>(`/api/trial/${id}`, { token: token || undefined }),
  save: (id: string, token: string, payload: { businessName: string; template: TrialTemplate; logoUrl: string | null; whatsapp: string; colors: TrialColors; products: TrialProduct[]; keep: string[] }) => trialFetch<TrialView>(`/api/trial/${id}`, { method: 'PUT', token, body: JSON.stringify(payload) }),
  photo: (id: string, token: string, file: File) => { const form = new FormData(); form.append('file', file); return trialFetch<{ url: string }>(`/api/trial/${id}/photos`, { method: 'POST', token, body: form }) },
  enhancePhoto: (id: string, token: string, url: string) => trialFetch<{ url: string; originalUrl: string; remaining: number }>(`/api/trial/${id}/photos/enhance`, { method: 'POST', token, body: JSON.stringify({ url }) }),
  remove: (id: string, token: string) => trialFetch<{ deleted: boolean }>(`/api/trial/${id}`, { method: 'DELETE', token }),
  order: (id: string, body: { items: Array<{ productId: string; quantity: number }>; customerName: string; note: string }) => trialFetch<{ code: string; total: number; whatsappUrl: string }>(`/api/trial/${id}/orders`, { method: 'POST', body: JSON.stringify(body) }),
  orders: (id: string, token: string) => trialFetch<{ items: TrialOrder[] }>(`/api/trial/${id}/orders`, { token }),
  activation: (id: string, token: string) => trialFetch<{ request: TrialActivationRequest | null }>(`/api/trial/${id}/activation`, { token }),
  requestActivation: (id: string, token: string, body: { planChoice: string; name: string; email: string; phone: string; consent: boolean }) =>
    trialFetch<{ request: TrialActivationRequest }>(`/api/trial/${id}/activation`, { method: 'POST', token, body: JSON.stringify(body) }),
}

// ---- trials (superadmin) --------------------------------------------------------------

export interface TrialSettings { durationHours: number; retentionHours: number; maxProducts: number; maxPhotoMb: number; templates: TrialTemplate[]; dailyLimit: number; createPerIpHour: number; ordersEnabled: boolean; photoEnhancePerTrial: number; photoEnhanceDailyLimit: number }
export interface TrialMetrics {
  created: number; last7Days: number; active: number; expired: number; deleted: number; converted: number; avgProducts: number; withoutProducts: number; conversionRate: number
  templates: Array<{ template: string; count: number }>; productCounts: Array<{ products: number; count: number }>
  requests: { pending: number; converted: number; discarded: number; total: number }
  orders: { count: number; trialsWithOrders: number; amount: number }
}
export interface TrialRequestItem {
  id: number; code: string; status: 'pendiente' | 'convertida' | 'descartada'; planChoice: string; planLabel: string; suggestedPlanCode: string; planCode: string | null
  contact: { name: string; email: string; phone: string | null }
  trial: { id: string; businessName: string; template: string; productCount: number; status: string; expiresAt: string; deleteAfter: string }
  store: { id: number; slug: string; name: string; status: string } | null
  result: { imported: number; skipped: Array<{ name: string; reason: string }>; delivery: string; adminUrl?: string; publicUrl?: string } | null
  createdAt: string
}
export interface TrialConversionResult { storeId: number; slug: string; name: string; adminUrl: string; publicUrl: string; imported: number; skipped: Array<{ name: string; reason: string }>; delivery: 'email' | 'manual' | 'existing'; activationUrl: string | null; telegramDeepLink: string | null; replayed: boolean }

export const trialAdminApi = {
  summary: (token: string) => fetchApi<TrialMetrics>('/api/platform/trials/summary', { headers: bearer(token) }),
  settings: (token: string) => fetchApi<TrialSettings>('/api/platform/trials/settings', { headers: bearer(token) }),
  saveSettings: (settings: Partial<TrialSettings>, token: string) => fetchApi<TrialSettings>('/api/platform/trials/settings', { method: 'PUT', headers: bearer(token), body: JSON.stringify(settings) }),
  requests: (token: string, status?: string) => fetchApi<{ items: TrialRequestItem[] }>(`/api/platform/trials/requests${status ? `?status=${encodeURIComponent(status)}` : ''}`, { headers: bearer(token) }),
  convert: (id: number, planCode: string, token: string) => fetchApi<TrialConversionResult>(`/api/platform/trials/requests/${id}/convert`, { method: 'POST', headers: bearer(token), body: JSON.stringify({ planCode }) }),
  discard: (id: number, token: string) => fetchApi<{ discarded: boolean }>(`/api/platform/trials/requests/${id}/discard`, { method: 'POST', headers: bearer(token) }),
}

// ---- users and access (one store) --------------------------------------------------

export interface StoreMember {
  id: number; email: string | null; displayName: string; role: string
  status: 'activo' | 'invitado' | 'inactivo' | 'deshabilitado'
  emailVerified: boolean; emailVerifiedAt: string | null; lastLoginAt: string | null; telegramLinked: boolean; createdAt: string
  lastPasswordReset: { at: string; channel: string | null } | null
  emails: Array<{ purpose: string; status: string; createdAt: string }>
}

export const usersApi = {
  list: (token: string) => fetchApi<{ items: StoreMember[] }>('/api/admin/users', { headers: bearer(token) }),
  passwordReset: (id: number, token: string) => fetchApi<{ delivery: 'email' | 'telegram' | 'none'; sentAt: string }>(`/api/admin/users/${id}/password-reset`, { method: 'POST', headers: bearer(token) }),
  invitation: (id: number, token: string) => fetchApi<{ delivery: 'email' | 'manual'; sentAt: string; activationUrl: string | null }>(`/api/admin/users/${id}/invitation`, { method: 'POST', headers: bearer(token) }),
  verifyEmail: (id: number, token: string) => fetchApi<{ status: string; sentAt: string }>(`/api/admin/users/${id}/verify-email`, { method: 'POST', headers: bearer(token) }),
  access: (id: number, active: boolean, token: string) => fetchApi<{ active: boolean }>(`/api/admin/users/${id}/access`, { method: 'POST', headers: bearer(token), body: JSON.stringify({ active }) }),
  invite: (payload: { email: string; role: string; displayName: string }, token: string) => fetchApi<{ userId: number; activationUrl: string | null; delivery: 'email' | 'manual' | null }>('/api/admin/team', { method: 'POST', headers: bearer(token), body: JSON.stringify(payload) }),
}

export async function confirmEmailVerification(token: string): Promise<{ verified: boolean }> {
  return fetchApi('/api/auth/verify-email', { method: 'POST', body: JSON.stringify({ token }) })
}

// ---- email templates (superadmin) ---------------------------------------------------

export interface EmailTemplate {
  id: number; systemKey: string | null; name: string; subject: string; html: string; text: string; active: boolean; system: boolean
  updatedBy: string; updatedAt: string; variables: Array<{ key: string; label: string; systemLink: boolean }>
}
export interface EmailMessage { id: number; purpose: string; toEmail: string; subject: string; status: string; provider: string; errorCode: string | null; requestedBy: string; createdAt: string; storeName: string | null; templateName: string | null; deliveryStatus?: string | null; attempts?: number }
export interface EmailStatusInfo { configured: boolean; provider: string; from: string | null; testRecipients: string[]; replyTo?: string | null; webhookConfigured?: boolean }
export interface EmailOverview {
  windowDays: number
  totals: { total: number; accepted: number; failed: number; notConfigured: number; pending: number; delivered: number; bounced: number; complained: number; delayed: number }
  suppressed: number
  alerts: Array<{ purpose: string; count: number; lastAt: string }>
}
export interface EmailCategoryInfo { key: string; label: string; essential: boolean; enabled: boolean; updatedBy: string | null; updatedAt: string | null; templates: string[] }
export interface EmailDnsCheck { name: string; status: 'ok' | 'falta' | 'revisar' | 'error'; detail: string }
export interface EmailSuppression { email: string; reason: string; source: string; createdAt: string }
export interface UnverifiedOwnerStore { id: number; slug: string; name: string; status: string; ownerEmail: string | null; ownerAssigned: boolean }

export const emailApi = {
  status: (token: string) => fetchApi<EmailStatusInfo>('/api/platform/email/status', { headers: bearer(token) }),
  templates: (token: string) => fetchApi<{ items: EmailTemplate[] }>('/api/platform/email/templates', { headers: bearer(token) }),
  create: (payload: { name: string; subject: string; html: string; text: string }, token: string) => fetchApi<EmailTemplate>('/api/platform/email/templates', { method: 'POST', headers: bearer(token), body: JSON.stringify(payload) }),
  update: (id: number, payload: { name: string; subject: string; html: string; text: string }, token: string) => fetchApi<EmailTemplate>(`/api/platform/email/templates/${id}`, { method: 'PUT', headers: bearer(token), body: JSON.stringify(payload) }),
  duplicate: (id: number, token: string) => fetchApi<EmailTemplate>(`/api/platform/email/templates/${id}/duplicate`, { method: 'POST', headers: bearer(token) }),
  setActive: (id: number, active: boolean, token: string) => fetchApi<EmailTemplate>(`/api/platform/email/templates/${id}/status`, { method: 'POST', headers: bearer(token), body: JSON.stringify({ active }) }),
  preview: (id: number, draft: { name: string; subject: string; html: string; text: string } | null, token: string) => fetchApi<{ subject: string; html: string; text: string }>(`/api/platform/email/templates/${id}/preview`, { method: 'POST', headers: bearer(token), body: JSON.stringify(draft ? { draft } : {}) }),
  test: (id: number, to: string, key: string, token: string) => fetchApi<{ status: string; replayed: boolean }>(`/api/platform/email/templates/${id}/test`, { method: 'POST', headers: { ...bearer(token), 'Idempotency-Key': key }, body: JSON.stringify({ to }) }),
  overview: (token: string) => fetchApi<EmailOverview>('/api/platform/email/overview', { headers: bearer(token) }),
  dns: (token: string) => fetchApi<{ domain: string | null; checks: EmailDnsCheck[] }>('/api/platform/email/dns', { headers: bearer(token) }),
  categories: (token: string) => fetchApi<{ items: EmailCategoryInfo[] }>('/api/platform/email/categories', { headers: bearer(token) }),
  setCategory: (key: string, enabled: boolean, token: string) => fetchApi<{ items: EmailCategoryInfo[] }>(`/api/platform/email/categories/${encodeURIComponent(key)}`, { method: 'POST', headers: bearer(token), body: JSON.stringify({ enabled }) }),
  suppressions: (token: string) => fetchApi<{ items: EmailSuppression[] }>('/api/platform/email/suppressions', { headers: bearer(token) }),
  removeSuppression: (email: string, token: string) => fetchApi<{ ok: boolean }>('/api/platform/email/suppressions/remove', { method: 'POST', headers: bearer(token), body: JSON.stringify({ email }) }),
  messages: (token: string, status?: string) => fetchApi<{ items: EmailMessage[] }>(`/api/platform/email/messages${status ? `?status=${status}` : ''}`, { headers: bearer(token) }),
  unverifiedOwners: (token: string) => fetchApi<{ items: UnverifiedOwnerStore[] }>('/api/platform/owners/unverified', { headers: bearer(token) }),
  regularize: (slug: string, payload: { email: string; name: string; identityMethod: string; evidence: string; confirm: boolean }, token: string) =>
    fetchApi<{ invitation: { delivery: 'email' | 'manual'; activationUrl: string | null } | null; note: string }>(`/api/platform/stores/${slug}/owner-regularization`, { method: 'POST', headers: bearer(token), body: JSON.stringify(payload) }),
}


// ============================================
// Estudio Creativo IA (fase 1: resumen, Brand Kit y trabajos)
// ============================================
export type CreativeModuleStatus = 'disponible' | 'base' | 'proximamente'
export interface CreativeOverview {
  name: string
  description: string
  aiEnabled: boolean
  modules: Array<{ key: string; name: string; status: CreativeModuleStatus; summary: string }>
  tasks: Array<{ task: string; label: string; available: boolean; provider: string | null; model: string | null; reason: string | null }>
}
export interface BrandKitApi {
  brandName: string | null; slogan: string | null; tone: string | null; targetAudience: string | null; logoUrl: string | null
  colors: string[]; fonts: string[]; visualStyles: string[]; favoriteTemplates: string[]
  revision: number; updatedBy: string | null; updatedAt: string | null
}
export interface BrandKitResponse {
  kit: BrandKitApi
  hints: { name: string | null; logoUrl: string | null; primaryColor: string | null }
  options: { fonts: string[]; visualStyles: Record<string, string>; tones: Record<string, string> }
}
export interface CreativeJobApi {
  id: string; kind: string; status: 'pendiente' | 'en_proceso' | 'completado' | 'fallido' | 'cancelado'
  errorCode: string | null; requestedBy: string; createdAt: string; finishedAt: string | null
}

export const creativeApi = {
  overview: (token: string) => fetchApi<CreativeOverview>('/api/creative/overview', { headers: auth(token) }),
  brandKit: (token: string) => fetchApi<BrandKitResponse>('/api/creative/brand-kit', { headers: auth(token) }),
  saveBrandKit: (patch: Partial<Omit<BrandKitApi, 'updatedBy' | 'updatedAt'>>, token: string) =>
    fetchApi<{ kit: BrandKitApi }>('/api/creative/brand-kit', { method: 'PUT', headers: auth(token), body: JSON.stringify(patch) }),
  jobs: (token: string) => fetchApi<{ items: CreativeJobApi[] }>('/api/creative/jobs', { headers: auth(token) }),
}

// ---- Estudio fotográfico y biblioteca de recursos ----
export type PhotoLevel = 'A' | 'B' | 'C'
export interface CreativeAssetApi {
  id: string; role: 'original' | 'resultado'; status: 'activo' | 'pendiente' | 'aprobado' | 'descartado'
  productId: number | null; productName: string | null; publicUrl: string | null; contentType: string; bytes: number
  width: number | null; height: number | null; level: PhotoLevel | null; operation: string | null; model: string | null
  credits: number; costMicros: number; sourceAssetId: string | null; jobId: string | null; origin: string
  telegramDraft: boolean; hasFile: boolean; createdBy: string; createdAt: string
}
export interface PhotoCatalogApi {
  aiEnabled: boolean; balance: number; maxBatchItems: number
  levels: Array<{ level: PhotoLevel; label: string; description: string; available: boolean; creditsPerPhoto: number | null }>
  operations: Array<{ key: string; level: PhotoLevel; label: string; description: string; runsIn: 'navegador' | 'ia'; available: boolean; note: string | null }>
}
export interface PhotoQuoteApi { operation: string; level: PhotoLevel; count: number; creditsPerPhoto: number; priceConfigured: boolean; totalCredits: number; balance: number; enough: boolean; paused: boolean }
export interface PhotoBatchJobApi { id: string; status: CreativeJobApi['status']; errorCode: string | null; attempts: number; operation: string; sourceAssetId: string; productId: number | null; resultAssetId: string | null; credits: number }
export interface PhotoBatchApi {
  batchId: string; total: number; done: boolean; creditsCharged: number
  counts: Record<CreativeJobApi['status'], number>; jobs: PhotoBatchJobApi[]
  skipped?: Array<{ index: number; code: string; message: string }>
}
export type PhotoBatchItem = { productId: number; imageUrl?: string } | { assetId: string } | { telegramBatchId: string; telegramItemId: number }

async function creativeForm<T>(path: string, form: FormData, token: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, ...tenantHeaders() }, body: form })
  const data = await response.json().catch(() => ({ error: 'Error desconocido' })) as T & ApiError
  if (!response.ok) throw new ApiRequestError(data.error || `HTTP ${response.status}`, response.status, data.code)
  return data
}

export const creativePhotoApi = {
  catalog: (token: string) => fetchApi<PhotoCatalogApi>('/api/creative/photo/catalog', { headers: auth(token) }),
  quote: (operation: string, count: number, token: string) => fetchApi<PhotoQuoteApi>('/api/creative/photo/quote', { method: 'POST', headers: auth(token), body: JSON.stringify({ operation, count }) }),
  createBatch: (operation: string, items: PhotoBatchItem[], confirmCredits: number, key: string, token: string) =>
    fetchApi<PhotoBatchApi & { replayed: boolean }>('/api/creative/photo/batches', { method: 'POST', headers: { ...auth(token), 'Idempotency-Key': key }, body: JSON.stringify({ operation, items, confirmCredits }) }),
  batch: (id: string, token: string) => fetchApi<PhotoBatchApi>(`/api/creative/photo/batches/${encodeURIComponent(id)}?t=${Date.now()}`, { headers: auth(token) }),
  cancelBatch: (id: string, token: string) => fetchApi<PhotoBatchApi & { cancelled: number }>(`/api/creative/photo/batches/${encodeURIComponent(id)}/cancel`, { method: 'POST', headers: auth(token) }),
  runJob: (id: string, token: string) => fetchApi<CreativeJobApi>(`/api/creative/jobs/${id}/run`, { method: 'POST', headers: auth(token) }),
  retryJob: (id: string, token: string) => fetchApi<CreativeJobApi>(`/api/creative/jobs/${id}/retry`, { method: 'POST', headers: auth(token) }),
  assets: (token: string, filter: { role?: string; status?: string; productId?: number; sourceId?: string; before?: string } = {}) => {
    const query = new URLSearchParams(Object.entries(filter).filter(([, value]) => value !== undefined && value !== '').map(([key, value]) => [key, String(value)]))
    query.set('t', String(Date.now()))
    return fetchApi<{ items: CreativeAssetApi[] }>(`/api/creative/assets?${query}`, { headers: auth(token) })
  },
  asset: (id: string, token: string) => fetchApi<CreativeAssetApi>(`/api/creative/assets/${id}?t=${Date.now()}`, { headers: auth(token) }),
  upload: (file: File, token: string, productId?: number) => {
    const form = new FormData()
    form.append('file', file)
    if (productId) form.append('productId', String(productId))
    return creativeForm<{ asset: CreativeAssetApi; duplicate: boolean }>('/api/creative/assets', form, token)
  },
  importProduct: (productId: number, token: string, imageUrl?: string) => fetchApi<{ asset: CreativeAssetApi; duplicate: boolean }>('/api/creative/assets/import-product', { method: 'POST', headers: auth(token), body: JSON.stringify({ productId, imageUrl }) }),
  importTelegram: (batchId: string, itemId: number, token: string) => fetchApi<{ asset: CreativeAssetApi; duplicate: boolean }>('/api/creative/assets/import-telegram', { method: 'POST', headers: auth(token), body: JSON.stringify({ batchId, itemId }) }),
  saveEdit: (sourceId: string, file: File, operation: string, token: string) => {
    const form = new FormData()
    form.append('file', file)
    form.append('operation', operation)
    return creativeForm<CreativeAssetApi>(`/api/creative/assets/${sourceId}/edits`, form, token)
  },
  approve: (id: string, token: string, options: { attach?: 'principal' | 'agregar'; productId?: number } = {}) =>
    fetchApi<{ asset: CreativeAssetApi; attached: { productId: number; mode: string } | { telegramDraft: true } | null }>(`/api/creative/assets/${id}/approve`, { method: 'POST', headers: auth(token), body: JSON.stringify(options) }),
  discard: (id: string, token: string) => fetchApi<CreativeAssetApi>(`/api/creative/assets/${id}/discard`, { method: 'POST', headers: auth(token) }),
  /** Los archivos de la biblioteca son privados: se descargan con la sesión, nunca con una URL pública. */
  file: async (id: string, token: string): Promise<Blob> => {
    const response = await fetch(`${API_BASE}/api/creative/assets/${id}/file`, { headers: { Authorization: `Bearer ${token}`, ...tenantHeaders() } })
    if (!response.ok) throw new ApiRequestError('No se pudo abrir la imagen', response.status)
    return response.blob()
  },
}
