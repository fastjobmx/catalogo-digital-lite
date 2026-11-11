// Editorial list for "Negocios que ya tienen su tienda con TiendIA Exprés".
//
// How to manage it (superadministrator):
//  - Show a store as an example: ONLY after the owner agreed, set `authorized: true`, write who
//    authorized it and when in `authorizedBy`, and copy its capture to src/assets/stores/:
//      node scripts/snapshot-stores.mjs <slug>    (public first screen of the store, read-only)
//      python scripts/optimize_stores.py          (writes scripts/.stores/optimized/, not published)
//      copy <slug>.webp and <slug>-480.webp to src/assets/stores/
//    An entry is rendered only when it is authorized AND its image is in src/assets/stores/ (or it
//    reuses an existing asset), so captures of stores that did not authorize are never published.
//  - Hide it: `authorized: false` (and remove its files from src/assets/stores/). Order: `order`.
//  - Rebuild and publish the site. This list only affects the landing: it never changes the store's
//    status, plan or data, and shows no sales, people or private figures.
//
// Data audited read-only on 2026-11-11 (production: active stores and their public URLs).
import { site } from '../config/site'
import { screens } from './media'

const captures = import.meta.glob('../assets/stores/*.webp', { eager: true, import: 'default' }) as Record<string, string>
const capture = (file: string) => captures[`../assets/stores/${file}`]

type Image = { src: string; srcSet?: string; width: number; height: number; phone?: boolean }

type Entry = {
  slug: string
  name: string
  category: string
  /** Store template, shown when it adds value. */
  template?: string
  blurb: string
  /** Existing asset, or the base name of a capture in src/assets/stores/. */
  image: Image | { capture: string }
  order: number
  authorized: boolean
  authorizedBy?: string
}

const ENTRIES: Entry[] = [
  {
    slug: 'sneakerhub-premium',
    name: 'SneakerHub Premium',
    category: 'Calzado y streetwear',
    blurb: 'La tienda piloto de la plataforma: catálogo con tallas, carrito y pedidos por WhatsApp.',
    // Reuses the real catalogue capture (the showcase above uses the home, product and cart screens).
    image: { src: screens.catalog, width: 390, height: 844, phone: true },
    order: 1,
    authorized: true,
    authorizedBy: 'Tienda piloto propia de la plataforma, ya publicada como demostración.',
  },
  {
    slug: 'muy-parcero',
    name: 'MUY PARCERO',
    category: 'Tenis, ropa y estilo urbano',
    template: 'Personalizada',
    blurb: 'Ropa y tenis para dama, caballero y niño, con pedidos por WhatsApp.',
    image: { capture: 'muy-parcero' },
    order: 2,
    authorized: true,
    authorizedBy: 'Autorización del comercio confirmada por el propietario de la plataforma el 2026-11-11.',
  },
  {
    slug: 'luz-magica',
    name: 'Luz Mágica',
    category: 'Tocadores, espejos y muebles',
    template: 'Boutique',
    blurb: 'Tocadores, espejos LED y muebles fabricados a la medida, con domicilios en Medellín.',
    image: { capture: 'luz-magica' },
    order: 3,
    authorized: true,
    authorizedBy: 'Autorización del comercio confirmada por el propietario de la plataforma el 2026-11-11.',
  },
]

function resolveImage(image: Entry['image']): Image | null {
  if (!('capture' in image)) return image
  const src = capture(`${image.capture}.webp`)
  const small = capture(`${image.capture}-480.webp`)
  return src ? { src, srcSet: small ? `${small} 480w, ${src} 960w` : undefined, width: 960, height: 600 } : null
}

export type ShowcaseStore = Omit<Entry, 'image'> & { image: Image; url: string }

export const showcaseStores: ShowcaseStore[] = ENTRIES.filter((e) => e.authorized)
  .map((e) => ({ ...e, image: resolveImage(e.image), url: `${site.appUrl}/t/${e.slug}` }))
  .filter((e): e is ShowcaseStore => e.image !== null)
  .sort((a, b) => a.order - b.order)
