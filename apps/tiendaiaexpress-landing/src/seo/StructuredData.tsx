// JSON-LD rendered into the prerendered HTML (one @graph). Prices come from src/content/plans.ts and
// the FAQ from src/content/copy.ts, so the structured data always matches what the page shows.
// No ratings, reviews, customers or tax data.
import { site } from '../config/site'
import { plans } from '../content/plans'
import { faq } from '../content/copy'

const unit = (code: 'MON' | 'ANN') => ({ '@type': 'QuantitativeValue', value: 1, unitCode: code })

/** What the product does, as listed on the page (Funciones, Estudio Creativo, Administración). */
const FEATURES = [
  'Tienda online con dirección propia y plantilla de tu marca',
  'Carrito y pedidos completos por WhatsApp',
  'Productos, categorías, tallas, variantes e inventario',
  'Carga de productos con fotos, Excel, CSV o PDF',
  'Asistente con inteligencia artificial en Telegram para administrar la tienda',
  'Fichas de producto con IA desde una foto',
  'Estudio Creativo: imágenes, carruseles y videos cortos para redes sociales',
  'Mejoras de fotografía de producto con IA',
  'Panel web de administración y pedidos con estados',
  'Cupones de descuento',
  'Sin comisión por venta',
]

export function structuredData() {
  const url = `${site.url}/`
  const org = { '@id': `${url}#organizacion` }
  const offers = plans.flatMap((plan) => [
    {
      '@type': 'Offer',
      name: `Plan ${plan.name} · pago mensual`,
      description: plan.audience,
      url: `${url}#planes`,
      price: plan.monthly,
      priceCurrency: 'COP',
      availability: 'https://schema.org/InStock',
      eligibleRegion: { '@type': 'Country', name: 'Colombia' },
      seller: org,
      priceSpecification: [
        { '@type': 'UnitPriceSpecification', name: 'Mensualidad', price: plan.monthly, priceCurrency: 'COP', referenceQuantity: unit('MON') },
        { '@type': 'UnitPriceSpecification', name: 'Pago inicial (una sola vez)', price: plan.setup, priceCurrency: 'COP' },
      ],
    },
    {
      '@type': 'Offer',
      name: `Plan ${plan.name} · pago anual`,
      description: plan.audience,
      url: `${url}#planes`,
      price: plan.annual,
      priceCurrency: 'COP',
      availability: 'https://schema.org/InStock',
      eligibleRegion: { '@type': 'Country', name: 'Colombia' },
      seller: org,
      priceSpecification: [
        { '@type': 'UnitPriceSpecification', name: 'Anualidad (12 meses, sin pago inicial)', price: plan.annual, priceCurrency: 'COP', referenceQuantity: unit('ANN') },
      ],
    },
  ])
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        ...org,
        name: site.wordmark,
        alternateName: site.name,
        url,
        logo: { '@type': 'ImageObject', url: `${site.url}/icon-512.png`, width: 512, height: 512 },
        image: `${site.url}/og.png`,
        slogan: site.slogan,
        description: 'Plataforma colombiana para crear una tienda online con inteligencia artificial y recibir pedidos por WhatsApp.',
        areaServed: { '@type': 'Country', name: 'Colombia' },
        sameAs: site.social.map((s) => s.url),
        contactPoint: { '@type': 'ContactPoint', contactType: 'sales', telephone: `+${site.whatsapp.number}`, availableLanguage: 'es', areaServed: 'CO' },
      },
      { '@type': 'WebSite', '@id': `${url}#sitio`, name: site.wordmark, alternateName: site.name, url, inLanguage: 'es-CO', publisher: org },
      {
        '@type': 'WebPage',
        '@id': `${url}#pagina`,
        url,
        name: 'TiendIA Exprés | Tienda online con IA y pedidos por WhatsApp',
        description: 'Crea tu tienda online con IA y recibe pedidos por WhatsApp. Carga productos con fotos, Excel o Telegram y crea publicidad para tus redes. Sin comisión por venta.',
        inLanguage: 'es-CO',
        isPartOf: { '@id': `${url}#sitio` },
        about: { '@id': `${url}#aplicacion` },
        primaryImageOfPage: { '@type': 'ImageObject', url: `${site.url}/og.png`, width: 1200, height: 630 },
      },
      {
        '@type': 'SoftwareApplication',
        '@id': `${url}#aplicacion`,
        name: site.wordmark,
        alternateName: site.name,
        applicationCategory: 'BusinessApplication',
        applicationSubCategory: 'Tienda online y comercio por WhatsApp',
        operatingSystem: 'Web',
        inLanguage: 'es-CO',
        url,
        image: `${site.url}/og.png`,
        description: 'Tienda online con inteligencia artificial y pedidos por WhatsApp, administrable desde el panel web o Telegram, con asistente y Estudio Creativo para publicidad en redes.',
        featureList: FEATURES,
        provider: org,
        offers,
      },
      {
        '@type': 'FAQPage',
        '@id': `${url}#preguntas`,
        inLanguage: 'es-CO',
        isPartOf: { '@id': `${url}#pagina` },
        mainEntity: faq.map((item) => ({ '@type': 'Question', name: item.q, acceptedAnswer: { '@type': 'Answer', text: item.a } })),
      },
    ],
  }
}

export function StructuredData() {
  // "<" is escaped so no text can close the script element.
  const json = JSON.stringify(structuredData()).replace(/</g, '\\u003c')
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />
}
