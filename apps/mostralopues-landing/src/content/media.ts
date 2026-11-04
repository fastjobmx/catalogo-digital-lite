// Real captures of the SneakerHub pilot store (scripts/snapshot-sneakerhub.mjs → optimize_images.py).
import data from './sneakerhub.json'
import home from '../assets/sneakerhub/mobile-home.webp'
import catalog from '../assets/sneakerhub/mobile-catalog.webp'
import product from '../assets/sneakerhub/mobile-product.webp'
import cart from '../assets/sneakerhub/mobile-cart.webp'
import home480 from '../assets/sneakerhub/mobile-home-480.webp'
import catalog480 from '../assets/sneakerhub/mobile-catalog-480.webp'
import product480 from '../assets/sneakerhub/mobile-product-480.webp'
import cart480 from '../assets/sneakerhub/mobile-cart-480.webp'
import desktopHome from '../assets/sneakerhub/desktop-home.webp'
import desktopHome960 from '../assets/sneakerhub/desktop-home-960.webp'
import desktopProduct from '../assets/sneakerhub/desktop-product.webp'
import desktopProduct960 from '../assets/sneakerhub/desktop-product-960.webp'

const productImages = import.meta.glob('../assets/sneakerhub/product-*.webp', { eager: true, import: 'default' }) as Record<string, string>
const templateImages = import.meta.glob('../assets/templates/*.webp', { eager: true, import: 'default' }) as Record<string, string>

export const screens = { home, catalog, product, cart }
/** srcset for the phone screens (390 × 844 captures at 480 and 720 px wide). */
export const screenSrcSet = {
  home: `${home480} 480w, ${home} 720w`,
  catalog: `${catalog480} 480w, ${catalog} 720w`,
  product: `${product480} 480w, ${product} 720w`,
  cart: `${cart480} 480w, ${cart} 720w`,
}
export type ScreenKey = keyof typeof screens

export const desktop = {
  home: { src: desktopHome, srcSet: `${desktopHome960} 960w, ${desktopHome} 1440w` },
  product: { src: desktopProduct, srcSet: `${desktopProduct960} 960w, ${desktopProduct} 1440w` },
}

export type Product = { sku: string; name: string; brand: string; price: number; category: string; sizes: string[]; url: string; image: string }

export const store = data.store
export const storeUrl = data.storeUrl
export const capturedAt = data.capturedAt
export const categories = data.categories
export const productCount = data.productCount
export const products: (Product & { src: string })[] = (data.products as Product[]).map((p) => ({
  ...p,
  src: productImages[`../assets/sneakerhub/${p.image}`],
}))

const TEMPLATE_NAMES: Record<string, string> = {
  artesanal: 'Artesanal', boutique: 'Boutique', editorial: 'Editorial', gourmet: 'Gourmet', luxury: 'Luxury',
  minimalista: 'Minimalista', moderno: 'Moderno', natural: 'Natural', personalizado: 'Personalizado',
  playful: 'Playful', premium: 'Premium', tech: 'Tech', urban: 'Urban',
}
export const templates = data.templates.map((key) => ({ key, name: TEMPLATE_NAMES[key] ?? key, src: templateImages[`../assets/templates/${key}.webp`] }))

export const formatCOP = (value: number) => `$ ${value.toLocaleString('es-CO')}`
