/** Coupons, customer consent and merchant-approved campaigns. Nothing here sends
 * messages: approved campaigns only produce WhatsApp links the merchant opens by hand,
 * and only for customers who accepted promotions and have not unsubscribed. */

export type Coupon = {
  id: number; code: string; kind: 'porcentaje' | 'valor'; value: number; min_subtotal: number
  starts_at: string | null; ends_at: string | null; max_uses: number | null; uses: number; is_active: number
}

export const COUPON_CODE = /^[A-Z0-9][A-Z0-9_-]{2,19}$/

export function normalizeCouponCode(raw: unknown): string | null {
  const code = String(raw || '').trim().toUpperCase()
  return COUPON_CODE.test(code) ? code : null
}

/** Digits only; a 10-digit Colombian mobile gets its country code for WhatsApp links. */
export function normalizePhone(raw: unknown, country = 'CO'): string | null {
  const digits = String(raw || '').replace(/\D/g, '')
  if (digits.length < 7 || digits.length > 15) return null
  if (country === 'CO' && digits.length === 10 && digits.startsWith('3')) return `57${digits}`
  return digits
}

export function couponDiscount(coupon: Pick<Coupon, 'kind' | 'value'>, subtotal: number): number {
  const raw = coupon.kind === 'porcentaje' ? Math.floor(subtotal * coupon.value / 100) : coupon.value
  return Math.max(0, Math.min(subtotal, raw))
}

export type CouponCheck = { ok: true; coupon: Coupon; discount: number } | { ok: false; reason: string }

/** Server-side validation; the browser's preview is never trusted. */
export async function checkCoupon(db: D1Database, storeId: number, rawCode: unknown, subtotal: number): Promise<CouponCheck> {
  const code = normalizeCouponCode(rawCode)
  if (!code) return { ok: false, reason: 'Código de cupón inválido.' }
  const coupon = await db.prepare(
    `SELECT id, code, kind, value, min_subtotal, starts_at, ends_at, max_uses, uses, is_active FROM coupons WHERE store_id = ? AND code = ?`,
  ).bind(storeId, code).first<Coupon>()
  if (!coupon || !coupon.is_active) return { ok: false, reason: 'Ese cupón no existe o ya no está activo.' }
  const now = new Date().toISOString().slice(0, 10)
  if (coupon.starts_at && coupon.starts_at > now) return { ok: false, reason: 'Ese cupón todavía no está vigente.' }
  if (coupon.ends_at && coupon.ends_at < now) return { ok: false, reason: 'Ese cupón ya venció.' }
  if (coupon.max_uses !== null && coupon.uses >= coupon.max_uses) return { ok: false, reason: 'Ese cupón ya alcanzó su límite de usos.' }
  if (subtotal < coupon.min_subtotal) return { ok: false, reason: `Ese cupón aplica desde un subtotal de ${coupon.min_subtotal}.` }
  return { ok: true, coupon, discount: couponDiscount(coupon, subtotal) }
}

/** Counts a use only while the limit allows it (concurrent orders cannot exceed max_uses). */
export async function claimCouponUse(db: D1Database, couponId: number): Promise<boolean> {
  const result = await db.prepare(`UPDATE coupons SET uses = uses + 1, updated_at = datetime('now') WHERE id = ? AND is_active = 1 AND (max_uses IS NULL OR uses < max_uses)`).bind(couponId).run()
  return Number(result.meta.changes || 0) === 1
}

/** Stores consent only when the customer ticked it; a new consent reverses a previous unsubscribe. */
export async function recordMarketingConsent(db: D1Database, storeId: number, phone: string, name: string | null, source = 'checkout'): Promise<void> {
  await db.prepare(
    `INSERT INTO customer_contacts (store_id, phone, name, consent, consent_at, unsubscribed_at, source) VALUES (?, ?, ?, 1, datetime('now'), NULL, ?)
     ON CONFLICT(store_id, phone) DO UPDATE SET consent = 1, consent_at = datetime('now'), unsubscribed_at = NULL,
       name = COALESCE(excluded.name, customer_contacts.name), source = excluded.source, updated_at = datetime('now')`,
  ).bind(storeId, phone, name ? name.slice(0, 80) : null, source).run()
}

export async function unsubscribeContact(db: D1Database, storeId: number, phone: string): Promise<boolean> {
  const result = await db.prepare(`UPDATE customer_contacts SET consent = 0, unsubscribed_at = datetime('now'), updated_at = datetime('now') WHERE store_id = ? AND phone = ? AND unsubscribed_at IS NULL`).bind(storeId, phone).run()
  return Number(result.meta.changes || 0) === 1
}

export async function consentedContacts(db: D1Database, storeId: number): Promise<Array<{ phone: string; name: string | null }>> {
  return (await db.prepare(`SELECT phone, name FROM customer_contacts WHERE store_id = ? AND consent = 1 AND unsubscribed_at IS NULL ORDER BY consent_at DESC LIMIT 500`).bind(storeId).all<{ phone: string; name: string | null }>()).results || []
}

export const OPT_OUT_LINE = 'Si no quieres recibir más mensajes, responde BAJA.'

export function campaignText(message: string, contactName: string | null): string {
  const first = (contactName || '').trim().split(/\s+/)[0] || ''
  const body = message.replace(/\{nombre\}/gi, first).replace(/\s{2,}/g, ' ').trim()
  return body.includes('BAJA') ? body : `${body}\n\n${OPT_OUT_LINE}`
}

export function whatsappLink(phone: string, text: string): string {
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`
}

/** Coupon results from confirmed orders only (the same rule as every sales figure). */
export async function couponResults(db: D1Database, storeId: number, code: string): Promise<{ uses: number; confirmedOrders: number; confirmedSales: number; discounts: number } | null> {
  const coupon = await db.prepare('SELECT uses FROM coupons WHERE store_id = ? AND code = ?').bind(storeId, code).first<{ uses: number }>()
  if (!coupon) return null
  const row = await db.prepare(
    `SELECT COUNT(*) AS orders, COALESCE(SUM(subtotal - discount_total), 0) AS sales, COALESCE(SUM(discount_total), 0) AS discounts FROM orders
     WHERE store_id = ? AND coupon_code = ? AND status IN ('confirmado', 'preparando', 'enviado', 'entregado')`,
  ).bind(storeId, code).first<{ orders: number; sales: number; discounts: number }>()
  return { uses: coupon.uses, confirmedOrders: Number(row?.orders || 0), confirmedSales: Number(row?.sales || 0), discounts: Number(row?.discounts || 0) }
}
