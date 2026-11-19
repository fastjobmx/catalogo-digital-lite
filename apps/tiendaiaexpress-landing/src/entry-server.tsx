import { StrictMode, type ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { App } from './App'
import { TermsPage } from './legal/TermsPage'
import { ServicesPage } from './legal/ServicesPage'
import { AppV2 } from './v2/AppV2'

/** Every prerendered page: the key is the HTML file in dist/ (see vite.config.ts and scripts/prerender.mjs). */
const pages: Record<string, () => ReactNode> = {
  'index.html': () => <App />,
  'terminos-y-condiciones.html': () => <TermsPage />,
  'servicios-adicionales.html': () => <ServicesPage />,
  // Home V2 prototype: only when the preview build asks for it (VITE_HOME_V2=preview, replaced at build time).
  ...(import.meta.env.VITE_HOME_V2 === 'preview' ? { 'home-v2.html': () => <AppV2 /> } : {}),
}

export const pageFiles = Object.keys(pages)

export function render(file = 'index.html') {
  const page = pages[file]
  if (!page) throw new Error(`no prerender for ${file}`)
  return renderToString(<StrictMode>{page()}</StrictMode>)
}
