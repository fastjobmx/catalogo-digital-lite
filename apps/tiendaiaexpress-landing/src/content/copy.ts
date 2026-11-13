// Shared page copy (navigation and FAQ). Section-specific copy lives next to each section.
// Rules: Colombian "tú" (never voseo), written for merchants who sell by WhatsApp and Instagram,
// and only real, verified features are presented as available; upcoming ones are labelled.
import { site } from '../config/site'
import { annualSaving, cop, plans } from './plans'

export const nav = [
  { href: '#funciones', label: 'Funciones' },
  { href: '#como-funciona', label: 'Cómo funciona' },
  { href: '#tiendas', label: 'Tiendas' },
  { href: '#planes', label: 'Planes' },
  { href: '#preguntas', label: 'Preguntas frecuentes' },
]

const [emprendedor, negocio, mayorista] = plans

export const faq = [
  {
    q: '¿Cómo funciona la prueba gratis?',
    a: `Creas una mini tienda de prueba sin correo ni contraseña: le pones el nombre de tu negocio, eliges una plantilla y subes hasta ${site.trial.products} productos con foto. Dura ${site.trial.days} días y, si agregas tu WhatsApp, puedes recibir pedidos reales. Para quedarte con tu tienda eliges un plan y la activamos contigo; la prueba no se convierte en tienda por sí sola.`,
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
    a: 'No. Pagas tu plan y nada más: no cobramos comisión por tus ventas. El pago lo acuerdas directamente con tu cliente.',
  },
  {
    q: '¿Puedo cobrar en línea?',
    a: 'Todavía no. Hoy el pago se acuerda con tu cliente por WhatsApp; en el pedido puede indicar su medio de pago preferido.',
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
