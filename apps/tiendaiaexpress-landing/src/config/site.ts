// Every contact detail, link and switch of the site lives here. Edit and rebuild.
// Values were provided by the owner on 2026-11-04; destinations are checked by `npm test`.

export const site = {
  name: 'Tienda IA Express',
  /** Stylised name used by the logo artwork. */
  wordmark: 'TiendIA Exprés',
  slogan: 'Tu tienda online, más fácil.',
  concept: 'Catálogo digital con pedidos por WhatsApp.',
  url: __SITE_URL__,

  /** Platform app (stores, panel, trial). Set with VITE_APP_URL when the official domain is live. */
  appUrl: __APP_URL__,
  /** Live pilot store (Catálogo Digital IA platform). Opened in a new tab. */
  demoStoreUrl: `${__APP_URL__}/`,
  /** Store owners' panel login. Accounts with several stores choose the store after signing in. */
  adminLoginUrl: `${__APP_URL__}/admin/login`,
  /** Free trial without sign-up: a temporary, unpublished preview of the visitor's catalogue (48 hours). */
  trialUrl: `${__APP_URL__}/prueba`,

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

  /** Legal pages: add the URL when they exist. Empty entries are not rendered. */
  legal: [
    { label: 'Términos y condiciones', url: '' },
    { label: 'Política de privacidad', url: '' },
  ],
} as const

export function whatsappLink(text?: string) {
  const base = `https://wa.me/${site.whatsapp.number}`
  return text ? `${base}?text=${encodeURIComponent(text)}` : base
}
