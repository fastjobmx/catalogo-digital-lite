// Catálogo central de /servicios-adicionales: 54 servicios, 3 paquetes y 6 categorías.
// Edita aquí precio, descripción, alcance, periodicidad y disponibilidad: la página no tiene
// precios escritos a mano.
//
// REGLAS (propietario, 2026-11-14):
//  - Único precio confirmado: renovación de dominio estándar, $120.000 COP al año (id 10).
//    Todo lo demás es PROPUESTO (status 'propuesto'): se muestra con esa etiqueta y nunca como tarifa
//    definitiva. Al aprobar uno, cambia su status a 'confirmado' y anota la fecha.
//  - Precios de lanzamiento: rebajados frente al prototipo (suma de la lista: $31,1 M → $14,3 M)
//    porque la plataforma está empezando. Siguen sujetos a aprobación comercial.
//  - available: false = aún no implementado: aparece en «Próximamente», sin botón de cotización.
//  - planNote = aclara qué incluye ya el plan SaaS, para no cobrar dos veces lo mismo.
//  - Sin checkout, pagos ni cobros recurrentes: cada botón abre un correo a ventas@.

export type CategoryKey = 'web' | 'dominios' | 'seo' | 'marketing' | 'automatizaciones' | 'creativo'
export type Period = 'unico' | 'mensual' | 'anual' | 'proyecto' | 'cuenta' | 'articulo' | 'campana' | 'pieza' | 'paquete' | 'video' | 'foto' | 'lote' | 'hora' | 'recarga'
export type PriceStatus = 'confirmado' | 'propuesto'

export type AddOnService = {
  id: number
  category: CategoryKey
  name: string
  description: string
  /** Alcance y lo que no incluye. */
  scope: string
  /** Pesos colombianos, sin impuestos. */
  price: number
  /** Precio «desde»: el valor final depende del diagnóstico. */
  from?: boolean
  period: Period
  status: PriceStatus
  /** false = todavía no implementado: no se puede cotizar. */
  available?: boolean
  /** Qué incluye ya el plan SaaS, para no cobrarlo dos veces. */
  planNote?: string
}

export const periodLabel: Record<Period, string> = {
  unico: 'pago único', mensual: 'al mes', anual: 'al año', proyecto: 'por proyecto', cuenta: 'por cuenta', articulo: 'por artículo',
  campana: 'por campaña', pieza: 'por pieza', paquete: 'por paquete', video: 'por video', foto: 'por foto', lote: 'por lote', hora: 'por hora', recarga: 'por recarga',
}

export type Category = { key: CategoryKey; label: string; title: string; body: string; icon: 'devices' | 'globe' | 'chart' | 'megaphone' | 'bot' | 'palette' }

export const categories: Category[] = [
  { key: 'web', label: 'Páginas web', title: 'Desarrollo web', body: 'Landings, sitios corporativos y desarrollos a medida, rápidos y pensados para el celular.', icon: 'devices' },
  { key: 'dominios', label: 'Dominios', title: 'Dominios y correo', body: 'Registro, conexión, renovación y correo con el nombre de tu negocio.', icon: 'globe' },
  { key: 'seo', label: 'SEO', title: 'SEO', body: 'Estructura, indexación y contenido para que los buscadores entiendan tu negocio.', icon: 'chart' },
  { key: 'marketing', label: 'Marketing', title: 'Marketing digital', body: 'Redes, anuncios y correo con estrategia. Tu inversión en pauta va aparte.', icon: 'megaphone' },
  { key: 'automatizaciones', label: 'Automatizaciones', title: 'Automatizaciones e IA', body: 'Formularios, seguimiento de clientes y flujos que te ahorran trabajo manual.', icon: 'bot' },
  { key: 'creativo', label: 'Diseño y contenido', title: 'Diseño y contenido', body: 'Piezas, reels, fotos, logo, identidad y carga asistida de productos.', icon: 'palette' },
]

export const services: AddOnService[] = [
  // web
  { id: 1, category: 'web', name: "Landing page profesional", description: "Una página adaptable a móvil con propuesta comercial, formulario y llamadas a la acción.", scope: "Hasta 6 secciones; contenidos aportados por el cliente.", price: 290_000, period: 'unico', status: 'propuesto' },
  { id: 2, category: 'web', name: "Sitio web corporativo", description: "Sitio para presentar tu empresa, servicios, equipo y contacto.", scope: "Hasta 5 páginas, formulario y SEO técnico inicial.", price: 590_000, period: 'unico', status: 'propuesto' },
  { id: 3, category: 'web', name: "Web corporativa Plus", description: "Presencia digital de mayor alcance, estructura editorial y blog inicial.", scope: "Hasta 10 páginas; diseño responsive y analítica básica.", price: 990_000, period: 'unico', status: 'propuesto' },
  { id: 4, category: 'web', name: "Tienda online a medida", description: "Diseño y desarrollo de una tienda personalizada fuera del catálogo SaaS.", scope: "Alcance, pagos e integraciones sujetos a cotización.", price: 1_290_000, from: true, period: 'proyecto', status: 'propuesto', planNote: "Tu plan ya incluye tu tienda online; esto es un desarrollo aparte, fuera de la plataforma." },
  { id: 5, category: 'web', name: "Aplicación web personalizada", description: "Portal o sistema web adaptado a un proceso específico del negocio.", scope: "Requiere diagnóstico y propuesta técnica.", price: 1_990_000, from: true, period: 'proyecto', status: 'propuesto' },
  { id: 6, category: 'web', name: "Rediseño de sitio web", description: "Actualización visual, estructura y experiencia móvil de una web existente.", scope: "Precio final depende de tecnología y número de páginas.", price: 290_000, from: true, period: 'proyecto', status: 'propuesto' },
  { id: 7, category: 'web', name: "Mantenimiento web esencial", description: "Pequeñas correcciones y actualizaciones de contenido acordadas.", scope: "Incluye hasta 1 hora de cambios al mes; hosting aparte.", price: 59_000, period: 'mensual', status: 'propuesto' },
  { id: 8, category: 'web', name: "Mantenimiento web avanzado", description: "Soporte recurrente, actualizaciones y ajustes planificados.", scope: "Hasta 3 horas al mes; desarrollos nuevos aparte.", price: 129_000, period: 'mensual', status: 'propuesto' },
  // dominios
  { id: 9, category: 'dominios', name: "Registro de dominio estándar", description: "Búsqueda, registro del primer año y conexión básica a la web.", scope: "Sujeto a disponibilidad y extensión elegible.", price: 99_000, period: 'anual', status: 'propuesto' },
  { id: 10, category: 'dominios', name: "Renovación de dominio estándar", description: "Gestión de renovación para dominios estándar elegibles.", scope: "No incluye redención ni dominios premium.", price: 120_000, period: 'anual', status: 'confirmado' },
  { id: 11, category: 'dominios', name: "Conexión de dominio existente", description: "Configuración DNS para vincular el dominio que ya posees.", scope: "El dominio sigue siendo de su titular.", price: 29_000, period: 'unico', status: 'propuesto' },
  { id: 12, category: 'dominios', name: "Migración y ajustes de DNS", description: "Traslado técnico y verificación de registros cuando corresponda.", scope: "Transferencia registral y cargos externos aparte.", price: 49_000, from: true, period: 'unico', status: 'propuesto' },
  { id: 13, category: 'dominios', name: "Configuración de correo corporativo", description: "Configuración inicial de correo con proveedor contratado por el cliente.", scope: "Licencia y renovación del proveedor no incluidas.", price: 19_000, period: 'cuenta', status: 'propuesto' },
  // seo
  { id: 14, category: 'seo', name: "SEO básico asistido", description: "Optimización inicial de títulos, estructura e indexación de la web.", scope: "Hasta 10 URLs y 5 palabras clave; sin seguimiento mensual.", price: 79_000, period: 'unico', status: 'propuesto', planNote: "Tu tienda ya trae una base técnica de indexación; este servicio suma trabajo individual sobre tu catálogo." },
  { id: 15, category: 'seo', name: "SEO avanzado: inicio", description: "Auditoría técnica, investigación de búsquedas y plan de mejora.", scope: "Hasta 15 URLs y 20 palabras clave.", price: 179_000, period: 'unico', status: 'propuesto' },
  { id: 16, category: 'seo', name: "SEO avanzado: seguimiento", description: "Revisión mensual de indicadores y optimización gradual.", scope: "Hasta 5 URLs al mes y un informe; sin garantía de posiciones.", price: 129_000, period: 'mensual', status: 'propuesto' },
  { id: 17, category: 'seo', name: "SEO local para negocios", description: "Optimización inicial del perfil público de negocio y coherencia de datos.", scope: "Sujeto a acceso autorizado y verificación del proveedor.", price: 89_000, period: 'unico', status: 'propuesto' },
  { id: 18, category: 'seo', name: "Auditoría SEO independiente", description: "Diagnóstico priorizado de problemas técnicos y oportunidades.", scope: "Informe con hallazgos; ejecución cotizada aparte.", price: 119_000, period: 'unico', status: 'propuesto' },
  { id: 19, category: 'seo', name: "Artículo optimizado para buscadores", description: "Redacción editorial de hasta 1.000 palabras con estructura SEO.", scope: "Investigación especializada e imágenes premium aparte.", price: 39_000, period: 'articulo', status: 'propuesto' },
  // marketing
  { id: 20, category: 'marketing', name: "Diagnóstico y estrategia digital", description: "Análisis inicial de canales, público y objetivos con hoja de ruta.", scope: "Documento estratégico y reunión de entrega.", price: 129_000, period: 'unico', status: 'propuesto' },
  { id: 21, category: 'marketing', name: "Redes sociales Esencial", description: "Diseño y programación de contenido para mantener la marca activa.", scope: "8 publicaciones y 8 historias; no incluye responder mensajes.", price: 290_000, period: 'mensual', status: 'propuesto' },
  { id: 22, category: 'marketing', name: "Redes sociales Crecimiento", description: "Contenido con mayor frecuencia y formatos de video.", scope: "12 publicaciones, 12 historias y 2 reels editados.", price: 490_000, period: 'mensual', status: 'propuesto' },
  { id: 23, category: 'marketing', name: "Redes sociales Integral", description: "Operación de contenido ampliada con seguimiento periódico.", scope: "16 publicaciones, 16 historias y 4 reels; gestión de comunidad cotizada aparte.", price: 790_000, period: 'mensual', status: 'propuesto' },
  { id: 24, category: 'marketing', name: "Configuración de Meta Ads", description: "Estructuración inicial de cuenta, eventos disponibles y primera campaña.", scope: "Pauta publicitaria pagada directamente por el cliente.", price: 119_000, period: 'unico', status: 'propuesto' },
  { id: 25, category: 'marketing', name: "Gestión de Meta Ads", description: "Optimización y seguimiento de campañas previamente acordadas.", scope: "No incluye inversión en anuncios ni producción de creativos.", price: 249_000, period: 'mensual', status: 'propuesto' },
  { id: 26, category: 'marketing', name: "Configuración de Google Ads", description: "Estructura inicial de cuenta, conversiones disponibles y campaña.", scope: "No incluye presupuesto publicitario.", price: 149_000, period: 'unico', status: 'propuesto' },
  { id: 27, category: 'marketing', name: "Gestión de Google Ads", description: "Revisión de campañas, términos y conversiones con reporte.", scope: "Pauta publicitaria no incluida.", price: 290_000, period: 'mensual', status: 'propuesto' },
  { id: 28, category: 'marketing', name: "Campaña de email marketing", description: "Diseño, configuración y envío de una campaña a contactos autorizados.", scope: "Plataforma de envío y base de datos no incluidas.", price: 89_000, period: 'campana', status: 'propuesto' },
  { id: 29, category: 'marketing', name: "Gestión mensual de email marketing", description: "Hasta 4 campañas y un informe mensual de resultados.", scope: "Costo del proveedor y contenidos externos aparte.", price: 290_000, period: 'mensual', status: 'propuesto' },
  // automatizaciones
  { id: 30, category: 'automatizaciones', name: "Formulario conectado a CRM", description: "Envía nuevos prospectos desde formularios al sistema comercial elegido.", scope: "Una automatización y un destino compatible.", price: 179_000, period: 'unico', status: 'propuesto' },
  { id: 31, category: 'automatizaciones', name: "Seguimiento automático de prospectos", description: "Secuencia sencilla de avisos y seguimiento después del contacto.", scope: "Un flujo; plataformas externas aparte.", price: 229_000, period: 'unico', status: 'propuesto' },
  { id: 32, category: 'automatizaciones', name: "Recordatorios y estados comerciales", description: "Automatización de avisos internos y actualización de estados.", scope: "Hasta 2 integraciones compatibles según diagnóstico.", price: 319_000, from: true, period: 'unico', status: 'propuesto' },
  { id: 33, category: 'automatizaciones', name: "Paquete de tres automatizaciones", description: "Diseño, configuración y prueba de tres flujos sencillos.", scope: "Make, n8n o herramienta compatible; licencias aparte.", price: 419_000, period: 'unico', status: 'propuesto' },
  { id: 34, category: 'automatizaciones', name: "Automatización avanzada", description: "Orquestación de varios sistemas, webhooks y procesos de negocio.", scope: "Cotización final por complejidad e integraciones.", price: 590_000, from: true, period: 'proyecto', status: 'propuesto' },
  { id: 35, category: 'automatizaciones', name: "Asistente IA a medida", description: "Diseño de un flujo de asistencia conectado a procesos definidos.", scope: "API, mensajes, canales y hospedaje cobrados aparte.", price: 890_000, from: true, period: 'proyecto', status: 'propuesto', planNote: "Tu plan ya incluye el asistente de Telegram para administrar tu tienda; esto es un asistente distinto para otros procesos." },
  { id: 36, category: 'automatizaciones', name: "Panel de indicadores comerciales", description: "Dashboard con métricas de fuentes de datos autorizadas.", scope: "Conectores, licencias y mantenimiento no incluidos.", price: 390_000, from: true, period: 'proyecto', status: 'propuesto' },
  { id: 37, category: 'automatizaciones', name: "Mantenimiento de automatizaciones", description: "Supervisión y pequeñas correcciones de flujos contratados.", scope: "Hasta 2 flujos simples; licencias externas aparte.", price: 69_000, period: 'mensual', status: 'propuesto' },
  { id: 38, category: 'automatizaciones', name: "Integración WhatsApp Business oficial", description: "Diseño de una conexión compatible con la API oficial y su proveedor.", scope: "Solo si se habilita y aprueba el alcance; cargos Meta/BSP aparte.", price: 390_000, from: true, period: 'proyecto', status: 'propuesto', available: false },
  // creativo
  { id: 39, category: 'creativo', name: "Diseño de pieza publicitaria", description: "Una pieza estática manual adaptada a una red social.", scope: "Una propuesta y una ronda de ajustes menores.", price: 19_000, period: 'pieza', status: 'propuesto', planNote: "El Estudio Creativo de tu plan ya genera piezas automáticas sin costo; esto es diseño hecho a mano." },
  { id: 40, category: 'creativo', name: "Paquete de cinco piezas gráficas", description: "Cinco diseños estáticos coherentes con la identidad del negocio.", scope: "No incluye fotografía ni pauta.", price: 79_000, period: 'paquete', status: 'propuesto', planNote: "El Estudio Creativo de tu plan ya genera piezas automáticas sin costo; esto es diseño hecho a mano." },
  { id: 41, category: 'creativo', name: "Edición de reel comercial", description: "Edición de video corto con material aportado por el cliente.", scope: "Hasta 30 segundos; filmación y locución aparte.", price: 49_000, period: 'video', status: 'propuesto' },
  { id: 42, category: 'creativo', name: "Paquete de cuatro reels", description: "Cuatro videos cortos editados para redes.", scope: "Material provisto por el cliente.", price: 179_000, period: 'paquete', status: 'propuesto' },
  { id: 43, category: 'creativo', name: "Edición de fotografía de producto", description: "Corrección básica de luz, recorte y limpieza visual.", scope: "Edición manual; generación IA aparte.", price: 8_000, period: 'foto', status: 'propuesto', planNote: "Tu plan incluye mejoras de foto con IA; esto es edición manual de una persona." },
  { id: 44, category: 'creativo', name: "Pack de diez fotografías editadas", description: "Ajustes consistentes de diez imágenes comerciales.", scope: "No incluye sesión fotográfica.", price: 69_000, period: 'paquete', status: 'propuesto', planNote: "Tu plan incluye mejoras de foto con IA; esto es edición manual de una persona." },
  { id: 45, category: 'creativo', name: "Diseño de logotipo", description: "Creación de logo con propuesta y ajustes acordados.", scope: "Dos propuestas iniciales y dos rondas de ajustes.", price: 149_000, period: 'unico', status: 'propuesto' },
  { id: 46, category: 'creativo', name: "Identidad visual de marca", description: "Logotipo, paleta, tipografía y aplicaciones principales.", scope: "Entrega de archivos de marca y guía resumida.", price: 349_000, period: 'unico', status: 'propuesto' },
  { id: 47, category: 'creativo', name: "Personalización avanzada de tienda", description: "Ajustes visuales adicionales al alcance de tu plan.", scope: "Sujeto a plantillas y capacidades disponibles.", price: 69_000, period: 'proyecto', status: 'propuesto', planNote: "Tu plan ya incluye plantillas, colores, logo y portada que cambias tú; esto son ajustes adicionales hechos por nosotros." },
  { id: 48, category: 'creativo', name: "Carga asistida de 50 productos", description: "Organización y publicación asistida de hasta 50 fichas aportadas.", scope: "El cliente aporta fotos, precios y referencias.", price: 29_000, period: 'lote', status: 'propuesto', planNote: "Tu plan ya incluye importar desde Excel, CSV o PDF y cargar por Telegram; esto es carga hecha por nuestro equipo." },
  { id: 49, category: 'creativo', name: "Carga asistida de 100 productos", description: "Digitación asistida y revisión de hasta 100 productos.", scope: "No incluye investigación ni fotografía.", price: 49_000, period: 'lote', status: 'propuesto', planNote: "Tu plan ya incluye importar desde Excel, CSV o PDF y cargar por Telegram; esto es carga hecha por nuestro equipo." },
  { id: 50, category: 'creativo', name: "Carga asistida de 500 productos", description: "Carga y clasificación de un catálogo amplio con datos completos.", scope: "La calidad de la información depende del material recibido.", price: 199_000, period: 'lote', status: 'propuesto', planNote: "Tu plan ya incluye importar desde Excel, CSV o PDF y cargar por Telegram; esto es carga hecha por nuestro equipo." },
  { id: 51, category: 'creativo', name: "Capacitación personalizada", description: "Sesión guiada para aprender una función o proceso de la plataforma.", scope: "Remota; agenda según disponibilidad.", price: 35_000, period: 'hora', status: 'propuesto', planNote: "Las dudas de uso habituales se resuelven sin costo por soporte@tiendiaexpres.com; esto es una sesión guiada a tu medida." },
  { id: 52, category: 'creativo', name: "100 créditos artísticos", description: "Paquete para futuras herramientas generativas compatibles.", scope: "No disponible para compra hasta aprobar monedero y equivalencias.", price: 9_000, period: 'recarga', status: 'propuesto', available: false },
  { id: 53, category: 'creativo', name: "300 créditos artísticos", description: "Mayor capacidad para tareas creativas de IA.", scope: "No disponible para compra hasta habilitar sistema de créditos.", price: 24_000, period: 'recarga', status: 'propuesto', available: false },
  { id: 54, category: 'creativo', name: "700 créditos artísticos", description: "Paquete ampliado para generación artística.", scope: "No disponible para compra hasta habilitar sistema de créditos.", price: 49_000, period: 'recarga', status: 'propuesto', available: false },
]

export type Package = { key: string; eyebrow: string; name: string; summary: string; price: number; items: string[]; separate: number; highlight?: boolean }

/** Paquetes sugeridos (propuestos). `separate` = lo que costarían los mismos servicios por separado. */
export const packages: Package[] = [
  {
    key: 'despegue',
    eyebrow: 'Presencia digital',
    name: 'Despegue',
    summary: 'Para presentar tu negocio con una web profesional lista para compartir.',
    price: 390_000,
    items: ['Landing page de hasta 6 secciones', 'Registro de dominio estándar, primer año', 'SEO básico asistido', 'Formulario de contacto'],
    separate: 290_000 + 99_000 + 79_000,
  },
  {
    key: 'crecimiento',
    eyebrow: 'Presencia + estrategia',
    name: 'Crecimiento',
    summary: 'Una web corporativa con estructura comercial y una hoja de ruta para crecer.',
    price: 749_000,
    items: ['Sitio corporativo de hasta 5 páginas', 'SEO básico asistido', 'Diagnóstico y estrategia digital', 'Reunión de entrega'],
    separate: 590_000 + 79_000 + 129_000,
    highlight: true,
  },
  {
    key: 'operacion',
    eyebrow: 'Presencia + procesos',
    name: 'Operación inteligente',
    summary: 'Web y automatizaciones para organizar tus oportunidades comerciales.',
    price: 949_000,
    items: ['Sitio corporativo de hasta 5 páginas', 'Tres automatizaciones sencillas', 'Conexión de formularios', 'Pruebas y entrega de los flujos'],
    separate: 590_000 + 419_000,
  },
]
