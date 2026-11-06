/** Order, shipping and payment states as the panel shows them (same identifiers as the server). */
export const ORDER_FLOW = ['pendiente', 'confirmado', 'preparando', 'enviado', 'entregado'] as const

export const ORDER_STATUS: Record<string, { label: string; icon: string; tone: string }> = {
  pendiente: { label: 'Pendiente', icon: '📥', tone: 'bg-amber-50 text-amber-900 border-amber-300' },
  confirmado: { label: 'Confirmado', icon: '✅', tone: 'bg-sky-50 text-sky-900 border-sky-300' },
  preparando: { label: 'En preparación', icon: '📦', tone: 'bg-violet-50 text-violet-900 border-violet-300' },
  enviado: { label: 'Entregado a transportadora', icon: '🚚', tone: 'bg-indigo-50 text-indigo-900 border-indigo-300' },
  entregado: { label: 'Entregado', icon: '🏁', tone: 'bg-emerald-50 text-emerald-900 border-emerald-300' },
  cancelado: { label: 'Cancelado', icon: '✖', tone: 'bg-red-50 text-red-900 border-red-300' },
}

/** Forward transitions and owner/admin reversions (the server validates both again). */
export const NEXT_STATUSES: Record<string, string[]> = {
  pendiente: ['confirmado', 'cancelado'], confirmado: ['preparando', 'enviado', 'entregado', 'cancelado'],
  preparando: ['enviado', 'entregado', 'cancelado'], enviado: ['entregado'], entregado: [], cancelado: [],
}
export const REVERSIONS: Record<string, string[]> = { pendiente: [], confirmado: [], preparando: ['confirmado'], enviado: ['preparando'], entregado: ['enviado', 'preparando'], cancelado: [] }

export const SHIPPING_STATUS: Record<string, { label: string; icon: string }> = {
  por_cotizar: { label: 'Pendiente de cotización', icon: '🧮' }, por_despachar: { label: 'Pendiente de despacho', icon: '⏳' },
  preparando_envio: { label: 'Preparando envío', icon: '📦' }, en_transportadora: { label: 'Entregado a transportadora', icon: '🚚' },
  en_transito: { label: 'En tránsito', icon: '🛣' }, entregado_cliente: { label: 'Entregado al cliente', icon: '🏁' },
  incidencia: { label: 'Incidencia de entrega', icon: '⚠️' }, no_aplica: { label: 'Sin envío (entrega personal o retiro)', icon: '🤝' },
}
/** Shipping states allowed for each order status (contradictions are rejected by the server). */
export const SHIPPING_FOR_STATUS: Record<string, string[]> = {
  pendiente: ['por_cotizar', 'por_despachar', 'no_aplica'], confirmado: ['por_cotizar', 'por_despachar', 'preparando_envio', 'no_aplica'],
  preparando: ['por_cotizar', 'por_despachar', 'preparando_envio', 'no_aplica'], enviado: ['en_transportadora', 'en_transito', 'incidencia'],
  entregado: ['entregado_cliente', 'no_aplica'], cancelado: [],
}

export const PAYMENT_STATUS: Record<string, { label: string; icon: string; tone: string }> = {
  pendiente: { label: 'Pago pendiente', icon: '⏳', tone: 'bg-amber-50 text-amber-900 border-amber-300' },
  comprobante_recibido: { label: 'Comprobante recibido', icon: '🧾', tone: 'bg-sky-50 text-sky-900 border-sky-300' },
  verificado: { label: 'Pago verificado', icon: '💳', tone: 'bg-emerald-50 text-emerald-900 border-emerald-300' },
  reembolsado: { label: 'Reembolsado', icon: '↩', tone: 'bg-slate-50 text-slate-800 border-slate-300' },
}

export const DELIVERY_METHODS: Record<string, string> = {
  transportadora: 'Transportadora', entrega_personal: 'Entrega personal', retiro_en_tienda: 'Retiro en tienda', mensajero: 'Mensajero', otro: 'Otro',
}

const EVENT_LABELS: Record<string, string> = {
  created: 'Pedido recibido', legacy_import: 'Pedido registrado', status: 'Estado del pedido', status_revert: 'Estado revertido', payment_status: 'Estado del pago',
  shipping_status: 'Estado del envío', carrier: 'Transportadora', tracking_number: 'Número de guía', tracking_url: 'URL de seguimiento', shipped_at: 'Fecha de entrega a transportadora',
  shipping_cost: 'Costo del envío', shipping_notes: 'Notas de envío', delivery_method: 'Método de entrega', delivered_at: 'Fecha de entrega',
  delivery_receiver: 'Receptor', delivery_notes: 'Observaciones de entrega', delivery_reference: 'Referencia de entrega', internal_note: 'Notas internas',
  shipping_document: 'Foto de guía registrada',
}

export function eventLabel(type: string): string { return EVENT_LABELS[type] || type.replaceAll('_', ' ') }
export function valueLabel(type: string, value: string | null): string {
  if (value == null) return '—'
  if (type === 'status' || type === 'status_revert' || type === 'created' || type === 'legacy_import') return ORDER_STATUS[value]?.label || value
  if (type === 'payment_status') return PAYMENT_STATUS[value]?.label || value
  if (type === 'shipping_status') return SHIPPING_STATUS[value]?.label || value
  if (type === 'delivery_method') return DELIVERY_METHODS[value] || value
  return value
}
