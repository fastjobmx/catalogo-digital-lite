/** Bold «Botón de pagos» in the storefront. The signed attributes come from the server (the secret never reaches
 * the browser); this only renders Bold's own button and remembers which order the buyer is paying. */
import type { BoldButtonData } from '../services/api'

const LIBRARY = 'https://checkout.bold.co/library/boldPaymentButton.js'
const PENDING_KEY = 'catalogo-bold-pending'

type BoldCheckoutInstance = { open: () => void }
type BoldCheckoutConstructor = new (config: Record<string, string>) => BoldCheckoutInstance
declare global { interface Window { BoldCheckout?: BoldCheckoutConstructor } }

let libraryLoad: Promise<BoldCheckoutConstructor> | null = null

/** Loads Bold's library once (https://checkout.bold.co/library/boldPaymentButton.js) and resolves with BoldCheckout. */
export function loadBoldLibrary(timeoutMs = 15_000): Promise<BoldCheckoutConstructor> {
  if (window.BoldCheckout) return Promise.resolve(window.BoldCheckout)
  if (libraryLoad) return libraryLoad
  libraryLoad = new Promise<BoldCheckoutConstructor>((resolve, reject) => {
    const done = () => (window.BoldCheckout ? resolve(window.BoldCheckout) : reject(new Error('BOLD_LIBRARY_UNAVAILABLE')))
    const timer = window.setTimeout(() => reject(new Error('BOLD_LIBRARY_TIMEOUT')), timeoutMs)
    const script = document.createElement('script')
    script.src = LIBRARY
    script.async = true
    script.onload = () => { window.clearTimeout(timer); done() }
    script.onerror = () => { window.clearTimeout(timer); reject(new Error('BOLD_LIBRARY_FAILED')) }
    document.head.appendChild(script)
  }).catch((error) => { libraryLoad = null; throw error })
  return libraryLoad
}

export type BoldCustomer = { name?: string; email?: string; phone?: string; address?: string; city?: string }

/** Customer data Bold pre-fills in its form (JSON strings, as its library expects). */
export function boldCustomerFields(customer: BoldCustomer): Record<string, string> {
  const fields: Record<string, string> = {}
  const data: Record<string, string> = {}
  if (customer.name?.trim()) data.fullName = customer.name.trim().slice(0, 100)
  if (customer.email?.trim()) data.email = customer.email.trim()
  const digits = (customer.phone || '').replace(/\D/g, '')
  if (digits.length === 12 && digits.startsWith('57')) { data.dialCode = '+57'; data.phone = digits.slice(2) }
  else if (digits.length === 10 && digits.startsWith('3')) { data.dialCode = '+57'; data.phone = digits }
  if (Object.keys(data).length) fields.customerData = JSON.stringify(data)
  if (customer.address?.trim() && customer.city?.trim()) {
    fields.billingAddress = JSON.stringify({ address: customer.address.trim().slice(0, 100), city: customer.city.trim().slice(0, 60), country: 'CO' })
  }
  return fields
}

/** Opens Bold's gateway in a modal over the store (Embedded Checkout): the buyer never leaves the page.
 * Every value comes signed from the server; Bold only accepts https return addresses. */
export async function openBoldCheckout(data: BoldButtonData, customer: BoldCustomer): Promise<void> {
  const BoldCheckout = await loadBoldLibrary()
  const config: Record<string, string> = {
    orderId: data.reference,
    currency: data.currency,
    amount: String(data.amount),
    apiKey: data.apiKey,
    integritySignature: data.signature,
    description: data.description,
    renderMode: 'embedded',
    ...boldCustomerFields(customer),
  }
  if (data.redirectionUrl.startsWith('https://')) {
    config.redirectionUrl = data.redirectionUrl
    config.originUrl = data.redirectionUrl
  }
  new BoldCheckout(config).open()
}

type Pending = { reference: string; checkoutKey: string; displayId: string; at: number }

function readPending(): Pending[] {
  try {
    const list = JSON.parse(localStorage.getItem(PENDING_KEY) || '[]') as Pending[]
    return Array.isArray(list) ? list.filter((entry) => Date.now() - entry.at < 3 * 86_400_000) : []
  } catch { return [] }
}

export function rememberBoldPayment(entry: Omit<Pending, 'at'>) {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify([{ ...entry, at: Date.now() }, ...readPending().filter((e) => e.reference !== entry.reference)].slice(0, 10))) } catch { /* private mode */ }
}

export function findBoldPayment(reference: string): Pending | null {
  return readPending().find((entry) => entry.reference === reference) || null
}

export function forgetBoldPayment(reference: string) {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify(readPending().filter((entry) => entry.reference !== reference))) } catch { /* private mode */ }
}
