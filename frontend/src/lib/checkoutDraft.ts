/** Buyer details typed in the cart are carried to the checkout page (this browser tab only). */
export type CheckoutDraft = { name: string; phone: string; email: string; city: string; address: string; notes: string; coupon: string }

const KEY = 'catalogo-checkout-draft'
const EMPTY: CheckoutDraft = { name: '', phone: '', email: '', city: '', address: '', notes: '', coupon: '' }

export function readCheckoutDraft(): CheckoutDraft {
  try {
    const value = JSON.parse(sessionStorage.getItem(KEY) || '{}') as Partial<CheckoutDraft>
    return Object.fromEntries(Object.entries(EMPTY).map(([key, empty]) => [key, typeof value[key as keyof CheckoutDraft] === 'string' ? String(value[key as keyof CheckoutDraft]).slice(0, 500) : empty])) as CheckoutDraft
  } catch { return { ...EMPTY } }
}

export function saveCheckoutDraft(draft: Partial<CheckoutDraft>) {
  try { sessionStorage.setItem(KEY, JSON.stringify({ ...readCheckoutDraft(), ...draft })) } catch { /* private mode */ }
}

/** Field rules shared by the checkout form (messages in the buyer's language). */
export function validateCheckout(draft: CheckoutDraft): Partial<Record<keyof CheckoutDraft, string>> {
  const errors: Partial<Record<keyof CheckoutDraft, string>> = {}
  if (draft.name.trim().split(/\s+/).filter(Boolean).length < 2) errors.name = 'Escribe tu nombre y apellido.'
  const digits = draft.phone.replace(/\D/g, '')
  if (!(digits.length === 10 && digits.startsWith('3')) && !(digits.length === 12 && digits.startsWith('573')) && !(digits.length >= 8 && digits.length <= 15 && draft.phone.trim().startsWith('+'))) {
    errors.phone = 'Escribe un número de WhatsApp válido, por ejemplo 300 123 4567.'
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(draft.email.trim())) errors.email = 'Escribe un correo válido: ahí te llega el comprobante.'
  if (draft.address.trim().length < 6) errors.address = 'Escribe la dirección completa (calle, número, barrio, apto).'
  if (draft.city.trim().length < 3) errors.city = 'Escribe la ciudad o municipio.'
  return errors
}
