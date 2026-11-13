// Real stores shown on the landing ("Tiendas reales").
//
// How to manage it (superadministrator):
//  - Show a store: ONLY after the owner agreed, set `authorized: true` and write who authorized it
//    and when in `authorizedBy`. Then capture its public material (read-only):
//      node scripts/snapshot-stores.mjs <slug>        desktop first screen → src/assets/stores/
//      node scripts/snapshot-real-stores.mjs          product photos, phone screen and figures
//      python scripts/optimize_stores.py && python scripts/optimize_real.py
//    Product photos are chosen in PICKS (snapshot-real-stores.mjs): originals from the store's own
//    catalogue, without third-party brand marks or licensed characters.
//  - Hide it: `authorized: false` (and remove its files from src/assets/stores/ and src/assets/real/).
//  - This list only affects the landing: it never changes the store's status, plan or data, and
//    shows no sales, people's data or private figures. Product counts are the public catalogue's.
import { site } from '../config/site'
import real from './realStores.json'
import { desktop, products as pilotProducts, productCount, categories, screens, screenSrcSet } from './media'

const captures = import.meta.glob('../assets/stores/*.webp', { eager: true, import: 'default' }) as Record<string, string>
const realAssets = import.meta.glob('../assets/real/*.webp', { eager: true, import: 'default' }) as Record<string, string>
const capture = (file: string) => captures[`../assets/stores/${file}`]
const realAsset = (file: string) => realAssets[`../assets/real/${file}`]

type RealStore = { productCount: number; categoryCount: number; products: { sku: string; name: string; price: number; image: string; width: number; height: number }[] }
const realStores = real.stores as Record<string, RealStore>
/** Date of the read-only capture of the public catalogues (figures and photos). */
export const realCapturedAt = real.capturedAt

export type StoreProduct = { name: string; price: number; src: string; width: number; height: number }
export type ShowcaseStore = {
  slug: string
  name: string
  category: string
  template?: string
  blurb: string
  url: string
  productCount: number
  categoryCount: number
  desktop: { src: string; srcSet?: string; width: number; height: number }
  phone: { src: string; srcSet?: string }
  products: StoreProduct[]
}

type Entry = { slug: string; name: string; category: string; template?: string; blurb: string; order: number; authorized: boolean; authorizedBy?: string }

const ENTRIES: Entry[] = [
  {
    slug: 'luz-magica',
    name: 'Luz Mágica',
    category: 'Tocadores, espejos y muebles',
    template: 'Boutique',
    blurb: 'Tocadores, espejos LED y muebles fabricados a la medida, con pago contra entrega y domicilios en Medellín.',
    order: 5,
    authorized: true,
    authorizedBy: 'Autorización del comercio confirmada por el propietario de la plataforma el 2026-11-11.',
  },
  {
    slug: 'muy-parcero',
    name: 'MUY PARCERO',
    category: 'Tenis, ropa y estilo urbano',
    template: 'Personalizada',
    blurb: 'Ropa y tenis para dama, caballero y niño, con una tienda a su medida y pedidos por WhatsApp.',
    order: 2,
    authorized: true,
    authorizedBy: 'Autorización del comercio confirmada por el propietario de la plataforma el 2026-11-11.',
  },
  {
    slug: 'sneakerhub-premium',
    name: 'SneakerHub Premium',
    category: 'Calzado y streetwear',
    blurb: 'La tienda piloto de la plataforma: tallas, carrito y pedidos por WhatsApp.',
    order: 7,
    authorized: false,
    authorizedBy: 'Tienda piloto propia de la plataforma, ya publicada como demostración.',
    // Oculta de la landing por decisión del propietario (2026-11-13): es la tienda de demostración, no un comercio real.
  },
  {
    slug: 'pilot-equipment',
    name: 'Pilot Equipment',
    category: 'Tankbags y equipo para moto',
    template: 'Urban',
    blurb: 'Tankbags con acople rápido Tanklock, morrales y maletas para moto, con envíos a todo el país y pedidos por WhatsApp.',
    order: 6,
    authorized: true,
    authorizedBy: 'Autorización del comercio confirmada por el propietario de la plataforma el 2026-11-13.',
  },
  {
    slug: 'imperio-nova',
    name: 'Imperio Nova',
    category: 'Jeans, polos y palazzos',
    template: 'Premium',
    blurb: 'Jeans premium, polos y palazzos desde Bogotá, con envíos a toda Colombia y asesoría por WhatsApp.',
    order: 3,
    authorized: true,
    authorizedBy: 'Autorización del comercio confirmada por el propietario de la plataforma el 2026-11-13.',
  },
  {
    slug: 'el-palacio-de-las-flores',
    name: 'El Palacio de las Flores',
    category: 'Floristería y detalles',
    template: 'Boutique',
    blurb: 'Ramos naturales, arreglos, fruteros y desayunos sorpresa en Cúcuta, con domicilio el mismo día y pedidos por WhatsApp.',
    order: 4,
    authorized: true,
    authorizedBy: 'Autorización del comercio confirmada por el propietario de la plataforma el 2026-11-13.',
  },
  {
    slug: 'altogramaje-twin',
    name: 'AltoGramaje Twin',
    category: 'Ropa y gorras de alto gramaje',
    template: 'Luxury',
    blurb: 'Camisetas, buzos y gorras de tela de gramaje 390 desde Bucaramanga, con diseños nuevos cada semana y envíos a toda Colombia.',
    order: 1,
    authorized: true,
    authorizedBy: 'Tienda creada por encargo del propietario de la plataforma el 2026-11-13; publicación en la landing solicitada por él.',
  },
]

function resolve(entry: Entry): ShowcaseStore | null {
  const base = { slug: entry.slug, name: entry.name, category: entry.category, template: entry.template, blurb: entry.blurb, url: `${site.appUrl}/t/${entry.slug}` }
  if (entry.slug === 'sneakerhub-premium') {
    return {
      ...base,
      productCount,
      categoryCount: categories.length,
      desktop: { ...desktop.home, width: 1440, height: 900 },
      phone: { src: screens.home, srcSet: screenSrcSet.home },
      products: pilotProducts.slice(0, 4).map((p) => ({ name: p.name, price: p.price, src: p.src, width: 480, height: 480 })),
    }
  }
  const data = realStores[entry.slug]
  const src = capture(`${entry.slug}.webp`)
  const phone = realAsset(`${entry.slug}--movil.webp`)
  if (!data || !src || !phone) return null
  const small = capture(`${entry.slug}-480.webp`)
  const phoneSmall = realAsset(`${entry.slug}--movil-480.webp`)
  return {
    ...base,
    productCount: data.productCount,
    categoryCount: data.categoryCount,
    desktop: { src, srcSet: small ? `${small} 480w, ${src} 960w` : undefined, width: 960, height: 600 },
    phone: { src: phone, srcSet: phoneSmall ? `${phoneSmall} 480w, ${phone} 720w` : undefined },
    products: data.products.map((p) => ({ name: p.name, price: p.price, src: realAsset(p.image), width: p.width, height: p.height })).filter((p) => p.src),
  }
}

/** Rendered only when authorized AND its captures exist, so unauthorized stores are never published. */
export const showcaseStores: ShowcaseStore[] = ENTRIES.filter((e) => e.authorized)
  .sort((a, b) => a.order - b.order)
  .map(resolve)
  .filter((s): s is ShowcaseStore => s !== null)

export const storeBySlug = (slug: string) => showcaseStores.find((s) => s.slug === slug)
