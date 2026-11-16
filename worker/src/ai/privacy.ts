/** Buyers' personal data in what we would send to a model.
 *
 * Decided by what is actually in the request, not only by the feature: a request is treated as carrying buyer data
 * when the operation is about orders or shipping guides (their photos cannot be read here), or when its text contains
 * a phone number, an e-mail, a street address or an identity number. Conservative on purpose: a false positive only
 * means the task is not sent to an unverified own key; a false negative would leak a buyer's data.
 */

/** Operations whose input is, by nature, buyers' data (orders, shipping-guide photos). */
export const BUYER_DATA_FEATURES = new Set(['pedidos', 'leer_guia_envio'])

const PATTERNS: Array<[string, RegExp]> = [
  ['teléfono', /(?:\+?57[\s-]?)?\b3\d{2}[\s.-]?\d{3}[\s.-]?\d{4}\b/],
  ['correo', /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/],
  ['dirección', /\b(?:calle|carrera|cra|kra|cr|cl|cll|avenida|av|diagonal|dg|transversal|tv|manzana|mz)\.?\s*\d+\s*[a-z]?\s*(?:#|no\.?|n°|nro\.?)\s*\d+/i],
  ['documento', /\b(?:c\.?\s?c\.?|c[ée]dula|nit|documento)\s*[:#.]?\s*\d[\d.]{5,12}\b/i],
]

function textOf(body: unknown): string {
  const b = (body || {}) as { contents?: Array<{ parts?: Array<{ text?: string }> }>; input?: Array<{ text?: string }> }
  const parts: string[] = []
  for (const content of b.contents || []) for (const part of content.parts || []) if (typeof part.text === 'string') parts.push(part.text)
  for (const item of b.input || []) if (typeof item.text === 'string') parts.push(item.text)
  return parts.join('\n')
}

/** Which kinds of buyer data the request carries (empty = none found). Never returns the data itself. */
export function buyerDataIn(feature: string, body: unknown): string[] {
  const kinds = BUYER_DATA_FEATURES.has(feature) ? ['pedido o guía'] : []
  const text = textOf(body)
  for (const [kind, pattern] of PATTERNS) if (pattern.test(text)) kinds.push(kind)
  return kinds
}
