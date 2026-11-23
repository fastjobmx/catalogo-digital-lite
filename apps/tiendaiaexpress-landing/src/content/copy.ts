// Shared page copy (navigation and FAQ). Section-specific copy lives next to each section.
// Rules: Colombian "tú" (never voseo), written for merchants who sell by WhatsApp and Instagram,
// and only real, verified features are presented as available; upcoming ones are labelled.
import { site } from '../config/site'
import { annualSaving, cop, plans } from './plans'

export const nav = [
  { href: '#inicio', label: 'Inicio' },
  { href: '#funciones', label: 'Funciones' },
  { href: '#como-funciona', label: 'Cómo funciona' },
  { href: '#tiendas', label: 'Tiendas' },
  { href: '#planes', label: 'Planes' },
  { href: '#preguntas', label: 'Preguntas' },
  { href: '#contacto', label: 'Contacto' },
]

const [emprendedor, negocio, mayorista] = plans

export const faq = [
  {
    q: '¿Cómo funciona la prueba gratis?',
    a: `Escribes el nombre de tu negocio y tu correo, confirmas el correo con el enlace que te enviamos y entras al panel de tu tienda. Durante ${site.trial.days} días puedes crear hasta ${site.trial.products} productos con fotos, precios y variantes, personalizar tu tienda, compartir el enlace y recibir pedidos por WhatsApp, sin tarjeta de crédito. Si contratas un plan, conservas la misma tienda con tus productos, pedidos y configuración. Las funciones de IA se activan con el plan.`,
  },
  {
    q: '¿Cuánto cuesta tener mi tienda?',
    a: `Depende del plan. Con pago mensual: Emprendedor ${cop(emprendedor.monthly)} al mes, Negocio ${cop(negocio.monthly)} y Mayorista ${cop(mayorista.monthly)}, más un pago inicial único de ${cop(emprendedor.setup)}, ${cop(negocio.setup)} o ${cop(mayorista.setup)}. Con pago anual: ${cop(emprendedor.annual)}, ${cop(negocio.annual)} o ${cop(mayorista.annual)}, sin pago inicial.`,
  },
  {
    q: '¿Qué incluye el pago inicial?',
    a: 'La configuración de tu tienda con nuestro equipo: plantilla y colores, tu logo, la carga inicial de productos, las categorías, la conexión con tu WhatsApp, la vinculación del asistente de Telegram y una capacitación inicial. Se paga una sola vez, con la primera mensualidad.',
  },
  {
    q: '¿Cuál es la diferencia entre el pago mensual y el anual?',
    a: `Con pago mensual pagas el pago inicial una vez y luego cada mes. Con pago anual pagas 12 meses por adelantado y no hay pago inicial. Comparando el mismo primer año, el anual te ahorra ${cop(annualSaving(emprendedor))} en Emprendedor, ${cop(annualSaving(negocio))} en Negocio y ${cop(annualSaving(mayorista))} en Mayorista.`,
  },
  {
    q: '¿Los pedidos me llegan por WhatsApp?',
    a: 'Sí. Tu cliente arma el carrito y te envía el pedido por WhatsApp, con los productos, las tallas y los datos de entrega. Después puedes cambiar el estado del pedido desde el panel o desde Telegram.',
  },
  {
    q: '¿Cómo funciona el asistente de Telegram?',
    a: 'Le escribes como a una persona: «cambia el precio», «carga 10 en talla 42», «¿qué pedidos tengo?». Entiende el mensaje y te pide confirmación antes de guardar cualquier cambio.',
  },
  {
    q: '¿Cuántos productos puedo publicar?',
    a: `${emprendedor.products} en Emprendedor, ${negocio.products.toLowerCase()} en Negocio y ${mayorista.products.toLowerCase()} en Mayorista. Si necesitas más, lo conversamos.`,
  },
  {
    q: '¿Qué pasa cuando se agotan los créditos de IA?',
    a: 'Tu tienda sigue funcionando igual: solo se pausan las funciones con IA hasta el mes siguiente, o hasta que pidas créditos adicionales desde tu panel y se aprueben. Si una acción con IA falla, no se descuenta.',
  },
  {
    q: '¿Puedo tener dominio propio?',
    a: 'Sí, como complemento con configuración asistida. Las condiciones (tipo de dominio, titularidad, renovación y transferencia) se acuerdan por escrito antes de configurarlo.',
  },
  {
    q: '¿Cobran comisión por venta?',
    a: 'No. Pagas tu plan y nada más: no cobramos comisión por tus ventas. Si cobras en línea, el dinero llega a tu propia cuenta Bold y solo aplica la tarifa de Bold por cada pago; si prefieres, acuerdas el pago con tu cliente por WhatsApp.',
  },
  {
    q: '¿Puedo cobrar en línea?',
    a: 'Sí, con tu propia cuenta de Bold. La conectas desde tu panel y tus clientes pagan con tarjeta, PSE o Nequi sin salir de tu tienda; el dinero llega directo a tu cuenta Bold. Cuando Bold aprueba el pago, el pedido queda confirmado, las unidades se apartan del inventario, tú recibes el aviso y tu cliente, el comprobante por correo. El envío del pago en línea es un valor fijo que defines tú. Quien prefiera puede seguir enviándote el pedido por WhatsApp.',
  },
  {
    q: '¿Cómo pago mi plan?',
    a: 'En línea con Bold: tarjeta de crédito o débito, PSE o Nequi. Eliges tu plan desde el panel de tu tienda, ves el valor final y pagas de forma segura; recibes el comprobante en tu correo. No hacemos cobros automáticos: cada pago lo haces tú.',
  },
  {
    q: '¿Cómo cambio de plan?',
    a: 'Escríbenos por WhatsApp. Te confirmamos el valor del cambio antes de hacerlo y tu tienda conserva sus productos y pedidos.',
  },
  {
    q: '¿Puedo importar mis productos desde Excel o PDF?',
    a: 'Sí. Desde el panel importas una lista en Excel (.xlsx) o CSV, y también desde PDF. Antes de guardar ves una vista previa; la lectura de PDF con IA es opcional y usa créditos.',
  },
  {
    q: '¿Qué funciones de IA están disponibles hoy?',
    a: 'El asistente de Telegram que entiende tus mensajes, las fichas de producto a partir de una foto, la lectura de listas en PDF, la lectura de guías de envío por foto y el estudio fotográfico con IA (packshots y escenarios). Sin IA y sin costo adicional también creas imágenes, carruseles y videos cortos para redes. Los modelos virtuales y el video con IA están en camino.',
  },
  {
    q: '¿Necesito saber de tecnología?',
    a: 'No. Creamos la tienda contigo y después la administras desde un panel web o escribiéndole a tu asistente en Telegram.',
  },
  {
    q: '¿Puedo tener varias tiendas?',
    a: 'Sí. Una misma cuenta de Telegram puede administrar varias tiendas y cambiar entre ellas.',
  },
]
