// All page copy. Rule: only real, verified features are presented as available.
// Illustrative demos and upcoming features are labelled as such (rules inherited from the MOSTRALO PUES! site, docs/MOSTRALOPUES_FASE_A.md §6).
import type { IconName } from '../components/ui/Icon'

export const nav = [
  { href: '#inicio', label: 'Inicio' },
  { href: '#como-funciona', label: 'Cómo funciona' },
  { href: '#caracteristicas', label: 'Características' },
  { href: '#demo', label: 'Demo' },
  { href: '#planes', label: 'Planes' },
  { href: '#preguntas', label: 'Preguntas frecuentes' },
  { href: '#contacto', label: 'Contacto' },
]

export const acts = [
  {
    id: 'mostra',
    verb: 'Mostrá',
    title: 'Todo comienza con lo que vendés.',
    body: 'Subís la foto de tu producto y queda en una ficha con nombre, precio, tallas y descripción, lista para que tus clientes la vean.',
    screen: 'product' as const,
  },
  {
    id: 'organiza',
    verb: 'Organizá',
    title: 'Todo tu catálogo, en un solo lugar.',
    body: 'Categorías, productos, variantes y precios ordenados en una tienda que se ve bien en cualquier celular.',
    screen: 'catalog' as const,
  },
  {
    id: 'vende',
    verb: 'Vendé',
    title: 'Compartilo. Mostralo. Vendé.',
    body: 'Compartís el enlace, tu cliente arma el carrito y te envía el pedido por WhatsApp con productos, tallas y datos de entrega.',
    screen: 'cart' as const,
  },
]

export type Capability = { title: string; body: string; icon: IconName }

export const moreCapabilities: Capability[] = [
  { title: 'Varias tiendas, una cuenta', body: 'Administrá más de una tienda desde la misma cuenta de Telegram y cambiá entre ellas.', icon: 'stores' },
  { title: 'Pedidos con estados', body: 'Seguí cada pedido: recibido, confirmado, en preparación, enviado y entregado, con transportadora y guía.', icon: 'box' },
  { title: 'Inventario por talla', body: 'Cargá stock por variante y consultá los movimientos.', icon: 'layers' },
  { title: 'Cupones de descuento', body: 'Creá cupones y tus clientes los aplican en el carrito.', icon: 'ticket' },
  { title: 'Tu equipo, con permisos', body: 'Sumá personas con roles: administración, ventas o inventario.', icon: 'users' },
]

export const upcoming: Capability[] = [
  { title: 'Fichas con IA desde una foto', body: 'Mandás la foto y el asistente propone nombre, descripción y categoría. En pruebas finales.', icon: 'sparkle' },
  { title: 'Mejoramiento fotográfico', body: 'Fondos limpios y luz pareja para tus fotos de producto.', icon: 'wand' },
  { title: 'Estadísticas avanzadas', body: 'Qué se mira, qué se vende y cuándo.', icon: 'chart' },
  { title: 'Asistente de ventas', body: 'Respuestas a las preguntas frecuentes de tus clientes.', icon: 'bot' },
  { title: 'Promociones inteligentes', body: 'Sugerencias de promociones según tu catálogo.', icon: 'megaphone' },
]

export const benefits = [
  {
    title: ['Menos', 'complicaciones.'],
    body: 'Sin instalar nada ni contratar programadores. Tu tienda vive en un enlace que compartís donde quieras: estados, grupos, redes o en una conversación.',
    demo: 'link' as const,
  },
  {
    title: ['Más tiempo', 'para tu negocio.'],
    body: 'Un mensaje a tu asistente reemplaza varios clics en un panel. Cambiás un precio o cargás stock mientras atendés.',
    demo: 'chat' as const,
  },
  {
    title: ['Tu catálogo', 'siempre a mano.'],
    body: 'Lo abrís desde el celular, lo mostrás en una conversación y tu cliente pide sin salir de WhatsApp.',
    demo: 'phone' as const,
  },
]

export const compare = {
  create: {
    title: 'Crear tu tienda',
    lead: 'Lo que ven tus clientes.',
    points: [
      'Tu catálogo en un enlace propio',
      'Plantilla y colores de tu marca',
      'Productos, categorías, tallas y precios',
      'Carrito y pedido por WhatsApp',
    ],
  },
  manage: {
    title: 'Administrarla con IA',
    lead: 'Lo que hacés vos, desde Telegram.',
    points: [
      'Le escribís a tu asistente como a una persona',
      'Agrega productos, cambia precios y carga stock',
      'Revisás pedidos y actualizás su estado',
      'Te pide confirmación antes de guardar cambios',
    ],
  },
}

export const plans = [
  {
    key: 'lite',
    name: 'Catálogo Lite',
    for: 'Para empezar a mostrar.',
    includes: ['Catálogo responsive con plantilla', 'Productos, categorías y variantes', 'Carrito y pedidos por WhatsApp', 'Panel web de administración'],
  },
  {
    key: 'ia',
    name: 'Catálogo IA',
    for: 'Para administrar desde el celular.',
    includes: ['Todo lo de Catálogo Lite', 'Asistente en Telegram con IA', 'Pedidos, inventario y cupones', 'Varias tiendas en una cuenta'],
    featured: true,
  },
  {
    key: 'medida',
    name: 'Soluciones a medida',
    for: 'Para necesidades especiales.',
    includes: ['Dominio propio (configuración asistida)', 'Diseño o integraciones especiales', 'Acompañamiento para tu equipo', 'Lo conversamos según tu caso'],
  },
]

export const faq = [
  {
    q: '¿Necesito saber de tecnología?',
    a: 'No. Creamos la tienda con vos y después la administrás desde un panel web o escribiéndole a tu asistente en Telegram.',
  },
  {
    q: '¿Cómo me llegan los pedidos?',
    a: 'Tu cliente arma el carrito y envía el pedido por WhatsApp a tu número, con los productos, las tallas y los datos de entrega. Después podés cambiar su estado desde el panel o desde Telegram.',
  },
  {
    q: '¿Puedo cobrar en línea?',
    a: 'Todavía no. Hoy el pago se acuerda con tu cliente por WhatsApp; en el pedido puede indicar su medio de pago preferido.',
  },
  {
    q: '¿Cómo creo mi tienda?',
    a: 'Escribinos por WhatsApp. Por ahora el alta la hacemos con vos: no hay registro automático.',
  },
  {
    q: '¿Qué hace la inteligencia artificial?',
    a: 'Entiende lo que le escribís a tu asistente en Telegram, como cambiar un precio o cargar stock, y te pide confirmación antes de guardar. La creación de fichas a partir de una foto está en pruebas finales.',
  },
  {
    q: '¿Puedo tener varias tiendas?',
    a: 'Sí. Una misma cuenta de Telegram puede administrar varias tiendas y cambiar entre ellas.',
  },
  {
    q: '¿Puedo usar mi propio dominio?',
    a: 'Sí, como solución a medida: lo configuramos con vos. Escribinos y lo revisamos.',
  },
  {
    q: '¿Cuánto cuesta?',
    a: 'Los planes están en definición. Escribinos por WhatsApp y te contamos las opciones para tu negocio.',
  },
]
