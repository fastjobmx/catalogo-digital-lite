import { StrictMode, type ReactNode } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import '../styles/global.css'

/** Hydrates a prerendered legal page (production) or renders it on the client (dev). */
export function mount(page: ReactNode) {
  const root = document.getElementById('root')!
  const app = <StrictMode>{page}</StrictMode>
  if (root.firstElementChild) hydrateRoot(root, app)
  else createRoot(root).render(app)
}
