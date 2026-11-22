/** Bold «Botón de pagos» in the storefront. The signed attributes come from the server (the secret never reaches
 * the browser); this only renders Bold's own button and remembers which order the buyer is paying. */
import type { BoldButtonData } from '../services/api'

const LIBRARY = 'https://checkout.bold.co/library/boldPaymentButton.js'
const PENDING_KEY = 'catalogo-bold-pending'

/** Bold scans the page when its library loads, so the library is (re)inserted after the button script. */
export function mountBoldButton(container: HTMLElement, data: BoldButtonData, customer: { name?: string; email?: string; phone?: string }) {
  container.replaceChildren()
  const button = document.createElement('script')
  const attributes: Record<string, string> = {
    'data-bold-button': 'dark-L',
    'data-api-key': data.apiKey,
    'data-order-id': data.reference,
    'data-amount': String(data.amount),
    'data-currency': data.currency,
    'data-integrity-signature': data.signature,
    'data-description': data.description,
  }
  // Bold only accepts https return URLs (a local http://localhost page is rejected with BTN-001).
  if (data.redirectionUrl.startsWith('https://')) {
    attributes['data-redirection-url'] = data.redirectionUrl
    attributes['data-origin-url'] = data.redirectionUrl
  }
  const customerData: Record<string, string> = {}
  if (customer.name?.trim()) customerData.fullName = customer.name.trim().slice(0, 100)
  if (customer.email?.trim()) customerData.email = customer.email.trim()
  const digits = (customer.phone || '').replace(/\D/g, '')
  if (digits.length === 12 && digits.startsWith('57')) { customerData.dialCode = '+57'; customerData.phone = digits.slice(2) }
  else if (digits.length === 10 && digits.startsWith('3')) { customerData.dialCode = '+57'; customerData.phone = digits }
  if (Object.keys(customerData).length) attributes['data-customer-data'] = JSON.stringify(customerData)
  for (const [name, value] of Object.entries(attributes)) button.setAttribute(name, value)
  container.appendChild(button)
  document.querySelectorAll(`script[src="${LIBRARY}"]`).forEach((node) => node.remove())
  const library = document.createElement('script')
  library.src = LIBRARY
  library.async = true
  document.head.appendChild(library)
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
