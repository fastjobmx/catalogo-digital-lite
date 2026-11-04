/** A public demo build (VITE_PUBLIC_DEMO=true) stays read-only and never contacts a backend. */
export const IS_PUBLIC_DEMO = import.meta.env.VITE_PUBLIC_DEMO === 'true'
