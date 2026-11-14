// Optional services of /servicios-adicionales, taken from the Terms and Conditions v1.1 (§10–§15).
//
// PRICE STATUS (owner, 2026-11-13): only the standard domain renewal ($120.000 COP a year) is a
// confirmed commercial price. Every other figure is a PROPOSAL pending the owner's approval: it is
// shown with the "Propuesto" label and never as a final price. When the owner approves one, change
// its `status` to 'confirmado' (and note the date here). Nothing on this page charges or books
// anything: every request goes to ventas@ for a written quote that the merchant must accept.

export type PriceStatus = 'confirmado' | 'propuesto' | 'incluido' | 'cotizacion' | 'tercero' | 'no-disponible'
export type Period = 'Pago único' | 'Mensual' | 'Por año' | 'Por hora' | 'Por paquete' | '—'

export type Service = {
  name: string
  /** Whole COP. Omitted for quotes, third-party prices and included items. */
  price?: number
  /** Text shown instead of a price (quotes, included items, third-party fees). */
  priceText?: string
  period: Period
  status: PriceStatus
  note?: string
}

export const statusLabel: Record<PriceStatus, string> = {
  confirmado: 'Precio confirmado',
  propuesto: 'Propuesto · sujeto a aprobación',
  incluido: 'Incluido en el plan',
  cotizacion: 'Cotización previa',
  tercero: 'Tarifa de un tercero',
  'no-disponible': 'Aún no disponible',
}

export type SeoPlan = {
  key: string
  name: string
  price: number
  period: Period
  status: PriceStatus
  summary: string
  deliverables: string[]
  excludes: string
  best: string
}

export const seoPlans: SeoPlan[] = [
  {
    key: 'basico',
    name: 'SEO básico asistido',
    price: 149_000,
    period: 'Pago único',
    status: 'propuesto',
    summary: 'Una revisión inicial para dejar en orden lo esencial de tu tienda.',
    best: 'Tiendas que empiezan y quieren una base técnica correcta.',
    deliverables: [
      'Revisión inicial del estado de indexación.',
      'Investigación básica de hasta 5 palabras clave relevantes.',
      'Títulos y metadescripciones de hasta 10 páginas o URLs.',
      'Recomendaciones sobre encabezados y estructura.',
      'Revisión de sitemap, robots y etiquetas de indexación cuando corresponda.',
      'Orientación para vincular Google Search Console.',
      'Informe de entrega con acciones y recomendaciones.',
    ],
    excludes: 'No incluye seguimiento mensual, contenido ilimitado, campañas de anuncios ni desarrollos a medida.',
  },
  {
    key: 'avanzado',
    name: 'SEO avanzado: implementación inicial',
    price: 349_000,
    period: 'Pago único',
    status: 'propuesto',
    summary: 'Auditoría completa y un plan de prioridades para tu catálogo.',
    best: 'Catálogos medianos o grandes en mercados con competencia.',
    deliverables: [
      'Auditoría técnica inicial.',
      'Investigación de hasta 20 palabras clave.',
      'Análisis básico de competidores.',
      'Plan de arquitectura y optimización de contenido.',
      'Revisión y optimización de hasta 15 URLs.',
      'Evaluación de datos estructurados cuando apliquen.',
      'Indexación, experiencia móvil y principales problemas técnicos.',
      'Configuración u orientación de medición con herramientas compatibles.',
      'Documento de prioridades SEO para la tienda.',
    ],
    excludes: 'Los cambios de infraestructura o desarrollos a medida fuera del alcance se cotizan aparte antes de hacerse.',
  },
  {
    key: 'mensual',
    name: 'SEO avanzado: seguimiento mensual',
    price: 249_000,
    period: 'Mensual',
    status: 'propuesto',
    summary: 'Mejora continua mes a mes, con informe de trabajo.',
    best: 'Tiendas que ya hicieron la implementación inicial y quieren continuidad.',
    deliverables: [
      'Seguimiento mensual de indexación.',
      'Revisión de los indicadores disponibles.',
      'Optimización de hasta 5 URLs existentes al mes.',
      'Recomendaciones de contenido.',
      'Revisión de oportunidades y problemas técnicos detectados.',
      'Un informe mensual de trabajo y resultados observables.',
    ],
    excludes: 'No incluye artículos completos, campañas pagadas ni posicionamiento garantizado. Es independiente de la mensualidad de tu plan.',
  },
]

export type Group = { id: string; title: string; intro?: string; items: Service[]; footnote?: string }

export const groups: Group[] = [
  {
    id: 'tarifas-dominios',
    title: 'Dominios y servicios técnicos',
    items: [
      { name: 'Registro inicial de dominio estándar elegible (primer año)', price: 120_000, period: 'Por año', status: 'propuesto' },
      { name: 'Renovación anual de dominio estándar elegible', price: 120_000, period: 'Por año', status: 'confirmado' },
      { name: 'Conexión de un dominio externo que ya tienes', price: 49_000, period: 'Pago único', status: 'propuesto' },
      { name: 'Dirección de tu tienda en app.tiendiaexpres.com', priceText: 'Sin cobro adicional', period: '—', status: 'incluido' },
      { name: 'HTTPS estándar del servicio alojado', priceText: 'Sin cobro adicional', period: '—', status: 'incluido' },
      { name: 'Dominios premium o extensiones especiales', priceText: 'Según cotización', period: '—', status: 'cotizacion' },
      { name: 'Restauración de un dominio vencido', priceText: 'Cargo real del registrador más el servicio', period: '—', status: 'cotizacion' },
      { name: 'Transferencia de tu dominio a otro registrador', priceText: 'Sin penalización de TiendIA', period: '—', status: 'tercero', note: 'Pueden aplicar costos del registrador de destino.' },
    ],
  },
  {
    id: 'tarifas-seo',
    title: 'SEO y contenido',
    items: [
      { name: 'SEO básico asistido', price: 149_000, period: 'Pago único', status: 'propuesto' },
      { name: 'SEO avanzado, implementación inicial', price: 349_000, period: 'Pago único', status: 'propuesto' },
      { name: 'SEO avanzado, optimización y seguimiento', price: 249_000, period: 'Mensual', status: 'propuesto' },
      { name: 'Redacción de artículo SEO de hasta 1.000 palabras', price: 80_000, period: 'Pago único', status: 'propuesto' },
      { name: 'Otros servicios de contenido o investigación', priceText: 'Según cotización', period: '—', status: 'cotizacion' },
    ],
  },
  {
    id: 'tarifas-catalogo',
    title: 'Catálogo y administración',
    intro: 'Trabajo humano para organizar y cargar la información que nos entregas. No reemplaza la importación desde Excel, CSV o PDF ni la creación de productos que ya incluye tu plan.',
    items: [
      { name: 'Carga asistida de hasta 50 productos', price: 49_000, period: 'Pago único', status: 'propuesto' },
      { name: 'Carga asistida de hasta 100 productos', price: 89_000, period: 'Pago único', status: 'propuesto' },
      { name: 'Carga asistida de hasta 500 productos', price: 349_000, period: 'Pago único', status: 'propuesto' },
      { name: 'Personalización visual avanzada', price: 129_000, period: 'Pago único', status: 'propuesto' },
      { name: 'Capacitación personalizada', price: 60_000, period: 'Por hora', status: 'propuesto' },
    ],
    footnote: 'La carga asistida requiere las fotos y los datos comerciales de tus productos. La edición profesional de fotos, la investigación de productos y la redacción adicional no están incluidas salvo acuerdo por escrito.',
  },
  {
    id: 'tarifas-diseno',
    title: 'Diseño y publicidad',
    intro: 'El diseño hecho a mano por una persona es distinto de las plantillas automáticas del Estudio Creativo, que ya vienen en tu plan.',
    items: [
      { name: 'Una pieza publicitaria diseñada a mano', price: 35_000, period: 'Pago único', status: 'propuesto' },
      { name: 'Paquete de cinco piezas diseñadas a mano', price: 149_000, period: 'Pago único', status: 'propuesto' },
      { name: 'Plantillas automáticas del Estudio Creativo', priceText: 'Sin cobro adicional', period: '—', status: 'incluido' },
      { name: 'Campañas publicitarias pagadas', priceText: 'Según cotización; la inversión en anuncios va aparte', period: '—', status: 'cotizacion' },
      { name: 'Producciones audiovisuales personalizadas', priceText: 'Según cotización', period: '—', status: 'cotizacion' },
    ],
  },
  {
    id: 'tarifas-correo',
    title: 'Correo corporativo e integraciones',
    items: [
      { name: 'Configuración de una cuenta de correo corporativo con un proveedor externo', price: 39_000, period: 'Pago único', status: 'propuesto' },
      { name: 'Suscripción al proveedor de correo', priceText: 'Tarifa del proveedor, informada antes', period: '—', status: 'tercero' },
      { name: 'Integraciones especiales o desarrollos a medida', priceText: 'Según cotización', period: '—', status: 'cotizacion' },
    ],
    footnote: 'Las integraciones que siguen en desarrollo o en piloto no se ofrecen comercialmente.',
  },
  {
    id: 'tarifas-creditos',
    title: 'Créditos artísticos de IA',
    intro: 'Paquetes para funciones del Estudio Creativo que requieran créditos. Se habilitarán cuando el monedero de créditos esté activo; antes de generar, cada herramienta te dirá cuántos créditos consume.',
    items: [
      { name: '100 créditos artísticos', price: 12_000, period: 'Por paquete', status: 'no-disponible' },
      { name: '300 créditos artísticos', price: 30_000, period: 'Por paquete', status: 'no-disponible' },
      { name: '700 créditos artísticos', price: 63_000, period: 'Por paquete', status: 'no-disponible' },
    ],
    footnote: 'Precios propuestos, sujetos a la aprobación del sistema de créditos y sus equivalencias. Hoy, si se agotan las cuotas IA de tu plan, puedes pedir créditos adicionales desde tu panel y te confirmamos el valor antes de cargarlos.',
  },
]

/** What the merchant always receives in writing before paying for any add-on (§15 of the terms). */
export const beforeBuying = [
  { title: 'Servicio', body: 'Qué se va a hacer, con nombre claro.' },
  { title: 'Alcance', body: 'Entregables, cantidades y lo que no incluye.' },
  { title: 'Precio total', body: 'El valor final que pagas, en pesos colombianos.' },
  { title: 'Impuestos aplicables', body: 'Los impuestos y cargos que correspondan, antes del pago.' },
  { title: 'Periodicidad', body: 'Pago único, mensual o anual, y cómo se termina.' },
  { title: 'Condiciones de ejecución', body: 'Qué necesitamos de ti y en cuánto tiempo se entrega.' },
  { title: 'Cancelación o devolución', body: 'La política que aplica a ese servicio, según la ley.' },
]

export const faqs = [
  {
    q: '¿Mi plan incluye un dominio propio?',
    a: 'Hoy ningún plan incluye dominio propio. Todos incluyen la dirección de tu tienda en app.tiendiaexpres.com/t/tu-negocio sin costo adicional. Si quieres tu propio dominio (por ejemplo, tunegocio.com), lo cotizamos como complemento.',
  },
  {
    q: '¿A nombre de quién queda el dominio?',
    a: 'A tu nombre o al de tu empresa, con tus datos. Nosotros hacemos la gestión técnica, pero no nos quedamos con la titularidad. Te entregamos constancia del registro y la fecha de vencimiento.',
  },
  {
    q: '¿Qué pasa si no renuevo el dominio?',
    a: 'El registrador puede suspenderlo y tu tienda dejaría de abrir con esa dirección. Después del vencimiento la recuperación puede tener costos extra del registrador, y si alguien más lo registra no podemos garantizar recuperarlo. Por eso te avisamos con anticipación.',
  },
  {
    q: '¿Puedo llevarme mi dominio a otro proveedor?',
    a: 'Sí. No cobramos penalización por transferir un dominio que es tuyo. El nuevo registrador puede cobrar su propia tarifa. Cancelar tu plan no nos transfiere tu dominio.',
  },
  {
    q: '¿El SEO garantiza que salga primero en Google?',
    a: 'No. Nadie puede garantizar posiciones, visitas ni ventas: dependen de los buscadores, la competencia y el contenido. Lo que sí entregamos es el trabajo descrito en cada servicio, con un informe.',
  },
  {
    q: '¿Me pueden cobrar un servicio sin pedirlo?',
    a: 'No. Ningún trabajo opcional con cobro se hace sin una cotización escrita que aceptes. Los servicios de pago único no se convierten en suscripciones, y no hay cobros automáticos.',
  },
  {
    q: '¿Cómo pago un servicio adicional?',
    a: 'Escríbenos a ventas@tiendiaexpres.com. Te enviamos la cotización con el total, impuestos y condiciones; cuando la aceptas, te indicamos cómo pagar. Esta página no recibe pagos.',
  },
]
