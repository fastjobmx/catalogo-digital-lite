import { StrictMode, type ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { App } from './App'
import { TermsPage } from './legal/TermsPage'
import { ServicesPage } from './legal/ServicesPage'

/** Every prerendered page: the key is the HTML file in dist/ (see vite.config.ts and scripts/prerender.mjs). */
const pages: Record<string, () => ReactNode> = {
  'index.html': () => <App />,
  'terminos-y-condiciones.html': () => <TermsPage />,
  'servicios-adicionales.html': () => <ServicesPage />,
}

export const pageFiles = Object.keys(pages)

export function render(file = 'index.html') {
  const page = pages[file]
  if (!page) throw new Error(`no prerender for ${file}`)
  return renderToString(<StrictMode>{page()}</StrictMode>)
}
