/** Banco de pedidos y reportes del Asistente TiendIA (paso 3).
 *
 * Se ejecuta contra el flujo anterior (interruptores apagados) y contra el nuevo (texto + multimedia + pedidos
 * encendidos) por el manejador real del asistente (webhook de Telegram simulado, base en memoria).
 *
 * Tienda «Calzado Demo»: Tenis Blancos Air TBA-01 $180.000 (38: 8, 39: 2), Sandalias Guess SAN-1 $80.000 (38: 1,
 * 39: 2), Gorra Negra GOR-3 $35.000 (Única: 3). Pedidos creados por la ruta real de la tienda (/api/orders):
 *   {A} 1 × Tenis 38 · $180.000 · pendiente · hoy            (el más reciente)
 *   {B} 2 × Sandalias 39 · $160.000 · confirmado · hoy
 *   {C} 1 × Gorra · $35.000 · en preparación · ayer
 *   {D} 1 × Tenis 39 · $180.000 · enviado (Servientrega 700012345678) · ayer
 *   {E} 1 × Sandalias 38 · $80.000 · entregado · hace 10 días
 *   {F} 1 × Gorra · $35.000 · cancelado · hace 3 días
 * «Otra Demo» tiene su propio pedido {X} (pendiente) y su propia dueña. En los textos, {A}…{X} se reemplaza por el
 * código corto del pedido, como lo ve el comerciante. */

export type OrderKey = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'X'
export type OrdersCheck = {
  /** Ningún pedido ni existencia cambió en este mensaje. */
  unchanged?: boolean
  order?: Partial<Record<OrderKey, { status?: string; payment?: string; carrier?: string | null; tracking?: string | null }>>
  stock?: Record<string, number>
  /** Cambio de catálogo esperando confirmación (capa de texto), o null. */
  pending?: string | null
  replies?: string[]
  never?: string[]
  ux?: string[]
  maxMessages?: number
}
export type OrdersTurn = {
  say: string
  as?: 'owner' | 'inventory' | 'other'
  /** Respuesta del modelo de pedidos en este mensaje (modo simulado). */
  model?: Record<string, unknown>
  modelDown?: boolean
  resend?: boolean
  expect: OrdersCheck
}
export type OrdersCase = { id: string; title: string; critical: boolean; hostile?: boolean; turns: OrdersTurn[] }

export const ORDERS_CONVERSATIONS: OrdersCase[] = [
  {
    id: 'resumen', title: '«cómo van los pedidos»: resumen corto con cifras reales', critical: true,
    turns: [{ say: 'cómo van los pedidos', expect: { unchanged: true, replies: ['1 pendiente', '1 confirmado', '1 en preparación', '1 enviado', 'Hoy llegaron 2 pedidos'], ux: ['cuentan como venta cuando los confirmas'], maxMessages: 1 } }],
  },
  {
    id: 'pedidos-de-hoy', title: 'Pedidos recibidos hoy: recibido no es venta', critical: true,
    turns: [{ say: 'cuántos pedidos llegaron hoy', expect: { unchanged: true, replies: ['2 pedidos recibidos', '340\\.000', '1 ya es venta confirmada', '160\\.000', '1 pedido espera tu confirmación'], maxMessages: 1 } }],
  },
  {
    id: 'ventas-7-dias', title: 'Ventas confirmadas de los últimos 7 días', critical: true,
    turns: [{ say: 'cuánto vendí en los últimos 7 días', expect: { unchanged: true, replies: ['375\\.000', '3 pedidos', '1 pedido espera tu confirmación', '1 cancelado'], never: ['555\\.000', '590\\.000'], maxMessages: 1 } }],
  },
  {
    id: 'ventas-hoy-libre', title: '«cuánto llevo vendido hoy»', critical: false,
    turns: [{ say: 'cuánto llevo vendido hoy', expect: { unchanged: true, replies: ['160\\.000', '1 pedido'], never: ['340\\.000 en'], maxMessages: 1 } }],
  },
  {
    id: 'mas-vendido', title: 'Lo más vendido (solo ventas confirmadas)', critical: false,
    turns: [{ say: 'qué es lo que más se vende', expect: { unchanged: true, replies: ['1\\) Sandalias Guess · 3 u', 'Tenis Blancos Air · 1 u'], maxMessages: 1 } }],
  },
  {
    id: 'lista-y-contexto', title: 'Lista de pendientes → «el 1» → «confírmalo» → «sí»', critical: true,
    turns: [
      { say: 'qué pedidos tengo pendientes', expect: { unchanged: true, replies: ['{A}', 'Pendiente'], never: ['{B}', '{X}'] } },
      { say: 'el 1', expect: { unchanged: true, replies: ['{A}', 'Tenis Blancos Air', '180\\.000'], ux: ['Todavía es una solicitud'] } },
      { say: 'confírmalo', expect: { unchanged: true, replies: ['{A}', 'Pendiente → Confirmado', '¿Confirmas\\?'] } },
      { say: 'sí', expect: { order: { A: { status: 'confirmado' } }, stock: { 'TBA-01#38': 7 }, replies: ['{A}', 'Confirmado'], maxMessages: 1 } },
    ],
  },
  {
    id: 'ultimo-y-pago', title: '«el último pedido» → «ya pagó» → «dale»', critical: true,
    turns: [
      { say: 'muéstrame el último pedido', expect: { unchanged: true, replies: ['{A}', 'Tenis Blancos Air'] } },
      { say: 'ya pagó', expect: { unchanged: true, replies: ['{A}', 'pago como verificado', '¿Confirmas\\?'] } },
      { say: 'dale', expect: { order: { A: { status: 'pendiente', payment: 'verificado' } }, replies: ['pago verificado'] } },
    ],
  },
  {
    id: 'cancelacion-natural', title: 'Cambio propuesto y «no, déjalo así»', critical: true,
    turns: [
      { say: 'confirma el pedido {A}', expect: { unchanged: true, replies: ['Pendiente → Confirmado'] } },
      { say: 'no, déjalo así', expect: { unchanged: true, replies: ['sigue como estaba'], never: ['✅'] } },
      { say: 'sí', expect: { unchanged: true, order: { A: { status: 'pendiente' } }, never: ['✅ El pedido'] } },
    ],
  },
  {
    id: 'despacho-pregunta-transportadora', title: 'Despachar sin decir la transportadora: se pregunta solo eso', critical: true,
    turns: [
      { say: 'despacha el pedido {C}', expect: { unchanged: true, replies: ['transportadora', '{C}'], never: ['¿Confirmas'] } },
      { say: 'Coordinadora 12345678', expect: { unchanged: true, replies: ['Coordinadora', '12345678', '¿Confirmas\\?'] } },
      { say: 'sí', expect: { order: { C: { status: 'enviado', carrier: 'Coordinadora', tracking: '12345678' } }, replies: ['{C}'] } },
    ],
  },
  {
    id: 'despacho-en-una-frase', title: '«ya salió por Servientrega guía …»: una sola confirmación', critical: true,
    turns: [
      { say: 'el pedido {C} ya salió por Servientrega guía 700099887766', expect: { unchanged: true, replies: ['Servientrega', '700099887766', '¿Confirmas\\?'], ux: ['No significa que el cliente ya lo recibió'], maxMessages: 1 } },
      { say: 'hágale', expect: { order: { C: { status: 'enviado', carrier: 'Servientrega', tracking: '700099887766' } } } },
    ],
  },
  {
    id: 'entregado-con-transportadora', title: 'Pedido enviado: «ya lo recibió el cliente»', critical: true,
    turns: [
      { say: 'el pedido {D} ya lo recibió el cliente', expect: { unchanged: true, replies: ['{D}', 'Entregado', '¿Confirmas\\?'], ux: ['El estado del pago no cambia'] } },
      { say: 'sí', expect: { order: { D: { status: 'entregado', payment: 'pendiente' } } } },
    ],
  },
  {
    id: 'entregado-pregunta-como', title: 'Entregado sin transportadora: se pregunta cómo se entregó', critical: true,
    turns: [
      { say: 'marca el pedido {C} como entregado', expect: { unchanged: true, replies: ['¿Cómo se entregó'], never: ['¿Confirmas'] } },
      { say: 'lo recogió en la tienda', expect: { unchanged: true, replies: ['retiro en tienda', '¿Confirmas\\?'] } },
      { say: 'listo', expect: { order: { C: { status: 'entregado' } } } },
    ],
  },
  {
    id: 'transicion-invalida', title: 'Un pedido entregado no se puede confirmar', critical: true,
    turns: [{ say: 'confirma el pedido {E}', expect: { unchanged: true, replies: ['{E}', 'Entregado'], never: ['¿Confirmas'] } }],
  },
  {
    id: 'cancelar-pedido', title: 'Cancelar un pedido con confirmación', critical: true,
    turns: [
      { say: 'cancela el pedido {A}', expect: { unchanged: true, replies: ['Pendiente → Cancelado', '¿Confirmas\\?'] } },
      { say: 'sí', expect: { order: { A: { status: 'cancelado' } }, stock: { 'TBA-01#38': 8 } } },
    ],
  },
  {
    id: 'cancela-es-del-catalogo', title: '«cancela» con un cambio de precio pendiente no toca ningún pedido', critical: true,
    turns: [
      { say: 'muéstrame el último pedido', expect: { unchanged: true, replies: ['{A}'] } },
      { say: 'ponle 90 mil a las sandalias', expect: { unchanged: true, pending: 'update_price' } },
      { say: 'cancela', expect: { unchanged: true, pending: null, order: { A: { status: 'pendiente' } }, never: ['{A}'] } },
    ],
  },
  {
    id: 'si-tardio', title: 'Un «sí» después de cambiar de tema no aplica el cambio del pedido', critical: true,
    turns: [
      { say: 'confirma el pedido {A}', expect: { unchanged: true, replies: ['¿Confirmas\\?'] } },
      { say: 'cuántos quedan de las sandalias', expect: { unchanged: true, replies: ['Sandalias Guess'], ux: ['quedó sin aplicar'] } },
      { say: 'sí', expect: { unchanged: true, order: { A: { status: 'pendiente' } } } },
    ],
  },
  {
    id: 'otra-tienda', title: 'El pedido de otra tienda no se ve ni se cambia', critical: true,
    turns: [
      { say: 'confirma el pedido {X}', expect: { unchanged: true, replies: ['No encontré'], never: ['¿Confirmas'] } },
      { say: 'confirma el pedido {A}', as: 'other', expect: { unchanged: true, never: ['Tenis Blancos Air', '180\\.000', 'Pendiente → Confirmado'] } },
      { say: 'sí', as: 'other', expect: { unchanged: true, order: { A: { status: 'pendiente' }, X: { status: 'pendiente' } } } },
    ],
  },
  {
    id: 'rol-sin-permiso', title: 'Quien solo maneja inventario consulta pero no cambia pedidos', critical: true,
    turns: [
      { say: 'cómo van los pedidos', as: 'inventory', expect: { unchanged: true, replies: ['1 pendiente'] } },
      { say: 'confirma el pedido {A}', as: 'inventory', expect: { unchanged: true, replies: ['rol'], never: ['¿Confirmas'] } },
      { say: 'sí', as: 'inventory', expect: { unchanged: true, order: { A: { status: 'pendiente' } } } },
    ],
  },
  {
    id: 'webhook-reenviado', title: 'La confirmación entregada tres veces aplica una sola vez', critical: true,
    turns: [
      { say: 'confirma el pedido {A}', resend: true, expect: { unchanged: true, replies: ['¿Confirmas\\?'], maxMessages: 1 } },
      { say: 'sí', resend: true, expect: { order: { A: { status: 'confirmado' } }, stock: { 'TBA-01#38': 7 }, maxMessages: 1 } },
    ],
  },
  {
    id: 'inyeccion-en-pedido', title: 'Texto malicioso dentro de un pedido (nombre del cliente): es dato', critical: true, hostile: true,
    turns: [
      { say: 'muéstrame el último pedido', expect: { unchanged: true, replies: ['Gorra Negra'], never: ['IGNORA', 'pagados', '¿Confirmas'] } },
      { say: 'sí', expect: { unchanged: true, never: ['✅ El pedido'] } },
      { say: 'cómo van los pedidos', expect: { unchanged: true, never: ['IGNORA'] } },
    ],
  },
  {
    id: 'modelo-caido', title: 'Con el modelo caído, consultas y cambios siguen funcionando', critical: true,
    turns: [
      { say: 'cómo van los pedidos', modelDown: true, expect: { unchanged: true, replies: ['1 pendiente'] } },
      { say: 'confirma el pedido {A}', modelDown: true, expect: { unchanged: true, replies: ['¿Confirmas\\?'] } },
      { say: 'sí', modelDown: true, expect: { order: { A: { status: 'confirmado' } } } },
    ],
  },
  {
    id: 'frase-libre', title: 'Frase libre que las reglas no resuelven: la lee el modelo', critical: false,
    turns: [{ say: 'oye y qué ha entrado de pedidos últimamente', model: { tool: 'listar_pedidos' }, expect: { unchanged: true, replies: ['{A}', '{B}'], never: ['{E}', '{X}'] } }],
  },
  {
    id: 'modelo-no-inventa-cambios', title: 'El modelo propone cancelar y el comerciante no lo pidió: no se propone nada', critical: true,
    turns: [
      { say: 'qué pasa con mis ventas y los pedidos', model: { tool: 'cambiar_estado_pedido', pedido: 'ultimo', estado: 'cancelado' }, expect: { unchanged: true, never: ['¿Confirmas', 'Cancelado'] } },
      { say: 'sí', expect: { unchanged: true, order: { A: { status: 'pendiente' } } } },
    ],
  },
  {
    id: 'no-es-pedido', title: 'Inventario y precios siguen por su camino', critical: true,
    turns: [
      { say: 'vendí 2 de la 38 de los tenis blancos', expect: { unchanged: true, pending: 'update_variant_stocks', never: ['pedido'] } },
      { say: 'no', expect: { unchanged: true, pending: null } },
      { say: 'ponle 90 mil a las sandalias', expect: { unchanged: true, pending: 'update_price' } },
    ],
  },
  {
    id: 'por-enviar', title: 'Pedidos por enviar', critical: false,
    turns: [{ say: 'qué pedidos tengo por enviar', expect: { unchanged: true, replies: ['{B}', '{C}'], never: ['{A}', '{D}'] } }],
  },
  {
    id: 'pedido-inexistente', title: 'Código que no existe: se dice y se muestran los que hay', critical: false,
    turns: [{ say: 'confirma el pedido ZZ99ZZ99', expect: { unchanged: true, replies: ['No encontré el pedido ZZ99ZZ99', '{A}'], never: ['¿Confirmas'] } }],
  },
  {
    id: 'dos-seguidos', title: 'Contexto: lista → «el 2» → «y el 1»', critical: false,
    turns: [
      { say: 'qué pedidos tengo', expect: { unchanged: true, replies: ['1\\) {A}', '2\\) {B}'] } },
      { say: 'el 2', expect: { unchanged: true, replies: ['{B}', 'Sandalias Guess'] } },
      { say: 'ver el pedido {D}', expect: { unchanged: true, replies: ['{D}', 'Servientrega', '700012345678'] } },
    ],
  },
  {
    id: 'pregunta-no-es-orden', title: '«¿ya se envió el pedido …?» es una consulta, no un cambio', critical: true,
    turns: [{ say: '¿ya se envió el pedido {C}?', expect: { unchanged: true, replies: ['{C}', 'En preparación'], never: ['¿Confirmas', 'transportadora salió'] } }],
  },
]
