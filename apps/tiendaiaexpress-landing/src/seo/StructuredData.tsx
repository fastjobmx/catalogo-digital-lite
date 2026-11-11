// JSON-LD rendered into the prerendered HTML. Prices come from src/content/plans.ts, so the
// structured offers always match the published cards. No ratings, reviews, customers or tax data.
import { site } from '../config/site'
import { plans } from '../content/plans'

const unit = (code: 'MON' | 'ANN') => ({ '@type': 'QuantitativeValue', value: 1, unitCode: code })

export function structuredData() {
  const url = `${site.url}/`
  const offers = plans.flatMap((plan) => [
    {
      '@type': 'Offer',
      name: `Plan ${plan.name} · pago mensual`,
      url: `${url}#planes`,
      price: plan.monthly,
      priceCurrency: 'COP',
      priceSpecification: [
        { '@type': 'UnitPriceSpecification', name: 'Mensualidad', price: plan.monthly, priceCurrency: 'COP', referenceQuantity: unit('MON') },
        { '@type': 'UnitPriceSpecification', name: 'Pago inicial (una sola vez)', price: plan.setup, priceCurrency: 'COP' },
      ],
    },
    {
      '@type': 'Offer',
      name: `Plan ${plan.name} · pago anual`,
      url: `${url}#planes`,
      price: plan.annual,
      priceCurrency: 'COP',
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
        '@id': `${url}#organizacion`,
        name: site.wordmark,
        alternateName: site.name,
        url,
        logo: `${site.url}/icon-512.png`,
        slogan: site.slogan,
        sameAs: site.social.map((s) => s.url),
        contactPoint: { '@type': 'ContactPoint', contactType: 'sales', telephone: `+${site.whatsapp.number}`, availableLanguage: 'es', areaServed: 'CO' },
      },
      { '@type': 'WebSite', '@id': `${url}#sitio`, name: site.wordmark, alternateName: site.name, url, inLanguage: 'es-CO', publisher: { '@id': `${url}#organizacion` } },
      {
        '@type': 'SoftwareApplication',
        name: site.wordmark,
        alternateName: site.name,
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web',
        url,
        description: 'Tienda online y catálogo digital con pedidos por WhatsApp, administrable desde el panel web o Telegram, con herramientas de inteligencia artificial.',
        provider: { '@id': `${url}#organizacion` },
        offers,
      },
    ],
  }
}

export function StructuredData() {
  // "<" is escaped so no text can close the script element.
  const json = JSON.stringify(structuredData()).replace(/</g, '\\u003c')
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />
}
