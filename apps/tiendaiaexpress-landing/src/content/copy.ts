// All page copy. Rule: only real, verified features are presented as available.
// Illustrative demos and upcoming features are labelled as such (rules inherited from the MOSTRALO PUES! site, docs/MOSTRALOPUES_FASE_A.md §6).
import type { IconName } from '../components/ui/Icon'
import { annualSaving, cop, plans } from './plans'

export const nav = [
  { href: '#inicio', label: 'Inicio' },
  { href: '#como-funciona', label: 'Cómo funciona' },
  { href: '#caracteristicas', label: 'Características' },
  { href: '#tiendas', label: 'Tiendas' },
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
  { title: 'Fichas con IA desde una foto', body: 'Subís la foto y la IA sugiere nombre, categoría y descripción; vos revisás y completás precio y tallas.', icon: 'sparkle' },
  { title: 'Importá tu lista de productos', body: 'Desde Excel o CSV, o desde un PDF (con lectura por IA opcional).', icon: 'layers' },
]

export const upcoming: Capability[] = [
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

const [emprendedor, negocio, mayorista] = plans

export const faq = [
  {
    q: '¿Cuánto cuesta crear mi tienda?',
    a: `Depende del plan. Con pago mensual: Emprendedor ${cop(emprendedor.monthly)} al mes, Negocio ${cop(negocio.monthly)} y Mayorista ${cop(mayorista.monthly)}, más un pago inicial único de ${cop(emprendedor.setup)}, ${cop(negocio.setup)} o ${cop(mayorista.setup)}. Con pago anual: ${cop(emprendedor.annual)}, ${cop(negocio.annual)} o ${cop(mayorista.annual)}, sin pago inicial.`,
  },
  {
    q: '¿Qué incluye el pago inicial?',
    a: 'La configuración de tu tienda con nuestro equipo: plantilla y colores, tu logo, la carga inicial de productos, las categorías, la conexión con tu WhatsApp, la vinculación del asistente de Telegram y una capacitación inicial. Se paga una sola vez, con la primera mensualidad.',
  },
  {
    q: '¿Cuál es la diferencia entre mensual y anual?',
    a: `Con pago mensual pagás el pago inicial una vez y luego cada mes. Con pago anual pagás 12 meses por adelantado y no hay pago inicial. Comparando el mismo primer año, el anual te ahorra ${cop(annualSaving(emprendedor))} en Emprendedor, ${cop(annualSaving(negocio))} en Negocio y ${cop(annualSaving(mayorista))} en Mayorista.`,
  },
  {
    q: '¿Puedo utilizar WhatsApp?',
    a: 'Sí. Tu cliente arma el carrito y te envía el pedido por WhatsApp, con los productos, las tallas y los datos de entrega. Después podés cambiar el estado del pedido desde el panel o desde Telegram.',
  },
  {
    q: '¿Cómo funciona Telegram?',
    a: 'Le escribís a tu asistente como a una persona: «cambiá el precio», «cargá 10 en talla 42», «¿qué pedidos tengo?». Entiende el mensaje y te pide confirmación antes de guardar cualquier cambio.',
  },
  {
    q: '¿Cuántos productos puedo publicar?',
    a: `${emprendedor.products} en Emprendedor, ${negocio.products.toLowerCase()} en Negocio y ${mayorista.products.toLowerCase()} en Mayorista. Si necesitás más, lo conversamos.`,
  },
  {
    q: '¿Qué ocurre cuando se agotan los créditos IA?',
    a: 'Tu tienda sigue funcionando igual: solo se pausan las funciones con IA hasta el mes siguiente, o hasta que pidás créditos adicionales desde tu panel y se aprueben. Si una acción con IA falla, no se descuenta.',
  },
  {
    q: '¿Puedo tener dominio propio?',
    a: 'Sí, como complemento con configuración asistida. Las condiciones (tipo de dominio, titularidad, renovación y transferencia) se acuerdan por escrito antes de configurarlo.',
  },
  {
    q: '¿Hay comisión por venta?',
    a: 'No. Pagás tu plan y nada más: no cobramos comisión por tus ventas. El pago lo acordás directamente con tu cliente.',
  },
  {
    q: '¿Puedo cobrar en línea?',
    a: 'Todavía no. Hoy el pago se acuerda con tu cliente por WhatsApp; en el pedido puede indicar su medio de pago preferido.',
  },
  {
    q: '¿Cómo puedo cambiar de plan?',
    a: 'Escribinos por WhatsApp. Te confirmamos el valor del cambio antes de hacerlo y tu tienda conserva sus productos y pedidos.',
  },
  {
    q: '¿Puedo importar mis productos desde Excel o PDF?',
    a: 'Sí. Desde el panel importás una lista en Excel (.xlsx) o CSV, y también desde PDF. Antes de guardar ves una vista previa; la lectura de PDF con IA es opcional y usa créditos.',
  },
  {
    q: '¿Qué funciones de IA están disponibles hoy?',
    a: 'El asistente de Telegram que entiende tus mensajes, las fichas de producto a partir de una foto, la lectura de listas en PDF, la lectura de guías de envío por foto y el estudio fotográfico con IA (packshots y escenarios). Formatos para redes, modelos virtuales y videos están en camino.',
  },
  {
    q: '¿Necesito saber de tecnología?',
    a: 'No. Creamos la tienda con vos y después la administrás desde un panel web o escribiéndole a tu asistente en Telegram.',
  },
  {
    q: '¿Puedo tener varias tiendas?',
    a: 'Sí. Una misma cuenta de Telegram puede administrar varias tiendas y cambiar entre ellas.',
  },
]
