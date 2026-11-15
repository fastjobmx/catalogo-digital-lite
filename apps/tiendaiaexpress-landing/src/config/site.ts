// Every contact detail, link and switch of the site lives here. Edit and rebuild.
// Values were provided by the owner on 2026-11-04; destinations are checked by `npm test`.

export const site = {
  name: 'Tienda IA Express',
  /** Stylised name used by the logo artwork. */
  wordmark: 'TiendIA Exprés',
  slogan: 'Tu tienda online, más fácil.',
  concept: 'Tienda online con IA y pedidos por WhatsApp.',
  url: __SITE_URL__,

  /** Platform app (stores, panel, trial). Set with VITE_APP_URL when the official domain is live. */
  appUrl: __APP_URL__,
  /** Live pilot store (Catálogo Digital IA platform). Opened in a new tab. */
  demoStoreUrl: `${__APP_URL__}/`,
  /** Store owners' panel login. Accounts with several stores choose the store after signing in. */
  adminLoginUrl: `${__APP_URL__}/admin/login`,
  /** Free trial without sign-up: a temporary mini store (platform route /prueba). */
  trialUrl: `${__APP_URL__}/prueba`,
  /**
   * Trial conditions as the live /prueba page states them (read on 2026-11-12): no e-mail or
   * password, up to 7 products with a photo, 7 days. The superadministrator can change them in
   * /plataforma/pruebas: update these two figures when that happens.
   */
  trial: { days: 7, products: 7 },

  whatsapp: {
    /** International format, digits only. */
    number: '573506912734',
    display: '+57 350 691 2734',
  },

  social: [
    { key: 'facebook', label: 'Facebook', url: 'https://www.facebook.com/tiendiaexpres/' },
    { key: 'instagram', label: 'Instagram', url: 'https://www.instagram.com/tiendiaexpres/' },
    { key: 'tiktok', label: 'TikTok', url: 'https://www.tiktok.com/@tiendiaexpres' },
  ] as const,

  /** Official mailboxes (confirmed by the owner on 2026-11-13). */
  email: { support: 'soporte@tiendiaexpres.com', sales: 'ventas@tiendiaexpres.com' },
  /** Office hours: days and hours still to be confirmed by the owner. Never invent them. */
  hours: 'Horario de oficina, hora de Colombia.',

  /** Terms and Conditions in force (src/legal/terminos-v1.2.md) and the versions published before. */
  terms: {
    version: '1.2',
    updated: '14 de noviembre de 2026',
    updatedIso: '2026-11-14',
    history: [
      { version: '1.2', date: '14 de noviembre de 2026', change: 'Tarifas de lanzamiento confirmadas para dominios, SEO y servicios adicionales.' },
      { version: '1.1', date: '13 de noviembre de 2026', change: 'Primera versión publicada.' },
    ],
  },

  /** Legal pages: add the URL when they exist. Empty entries are not rendered. "#…" anchors point to the home page. */
  legal: [
    { label: 'Condiciones comerciales', url: '#condiciones' },
    { label: 'Términos y condiciones', url: '/terminos-y-condiciones' },
    { label: 'Servicios adicionales', url: '/servicios-adicionales' },
    { label: 'Política de privacidad', url: '' },
  ],
} as const

export function whatsappLink(text?: string) {
  const base = `https://wa.me/${site.whatsapp.number}`
  return text ? `${base}?text=${encodeURIComponent(text)}` : base
}
