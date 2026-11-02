/** Netlify's public preview must stay read-only and must not contact a backend. */
export const IS_PUBLIC_DEMO = import.meta.env.VITE_PUBLIC_DEMO === 'true'
