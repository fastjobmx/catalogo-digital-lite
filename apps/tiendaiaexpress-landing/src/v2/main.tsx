import { StrictMode } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import { AppV2 } from './AppV2'
import '../styles/global.css'
import './home-v2.css'
import './hero-story.css'
import './depth.css'

const root = document.getElementById('root')!
const app = (
  <StrictMode>
    <AppV2 />
  </StrictMode>
)
// The preview HTML is prerendered (scripts/prerender.mjs); dev renders on the client.
if (root.firstElementChild) hydrateRoot(root, app)
else createRoot(root).render(app)
