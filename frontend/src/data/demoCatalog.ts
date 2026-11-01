import type { CategoryApi, ProductApi, ProductVariantApi } from '../services/api'

// ============================================
// Catálogo demo — SNEAKERHUB PREMIUM
// ============================================
// Todas las fotografías son archivos locales servidos desde
// /public/seed-images/sneakerhub. Las fuentes conocidas y las pendientes de
// verificar están registradas en docs/ASSETS_DEMO.md.
//
// Los datos son de demostración: marcas, referencias y precios son ficticios.
// Confirmar materiales, especificaciones y derechos antes de publicar productos.

// Cambiar esta versión invalida el catálogo demo guardado en el navegador,
// de modo que los clientes ven el catálogo actual sin limpiar localStorage.
export const DEMO_CATALOG_VERSION = '2026-11-01-sneakerhub-premium-3'

/** Ruta local de la fotografía principal de cada SKU. */
const img = (fileName: string) => `/seed-images/sneakerhub/${fileName}.jpg`

export const DEMO_CATEGORIES: CategoryApi[] = [
  { id: 1, name: 'Urbano', slug: 'urbano', description: 'Sneakers de calle con actitud, comodidad y materiales nobles para el día a día.', sortOrder: 1, productCount: 4 },
  { id: 2, name: 'Running', slug: 'running', description: 'Amortiguación y respuesta para entrenar, competir y bajar tus marcas.', sortOrder: 2, productCount: 4 },
  { id: 3, name: 'Casual', slug: 'casual', description: 'Perfiles limpios que combinan con todo, del trabajo al fin de semana.', sortOrder: 3, productCount: 2 },
  { id: 4, name: 'Outdoor', slug: 'outdoor', description: 'Agarre, protección y confort para senderos y clima exigente.', sortOrder: 4, productCount: 3 },
  { id: 5, name: 'Accesorios', slug: 'accesorios', description: 'Complementos que completan tu equipo y cuidan tu calzado.', sortOrder: 5, productCount: 5 },
]

const CATEGORY = new Map(DEMO_CATEGORIES.map((c) => [c.slug, c]))

let variantSeq = 1000

function sizeVariants(productSku: string, sizes: string[], stockFor: (size: string, index: number) => number): ProductVariantApi[] {
  return sizes.map((size, index) => ({
    id: variantSeq++,
    sku: `${productSku}-${size}`,
    name: `Talla ${size}`,
    size,
    color: null,
    priceOverride: null,
    stock: stockFor(size, index),
    isActive: true,
  }))
}

// Stock habitual con la última talla en escasez para mostrar avisos reales.
const normalStock = (base = 18) => (_size: string, index: number, total: number) =>
  index === total - 1 ? 3 : base

interface Seed {
  id: number
  sku: string
  name: string
  description: string
  brand: string
  categorySlug: string
  price: number
  compareAtPrice?: number
  isFeatured?: boolean
  images: string[]
  sizes: string[]
  base?: number
}

const SHOE_SIZES = ['38', '39', '40', '41', '42', '43', '44']
const BIG_SIZES = ['40', '41', '42', '43', '44', '45']

const SEEDS: Seed[] = [
  // ---------------- Accesorios ----------------
  {
    id: 1, sku: 'VANTA-18', name: 'Vanta Crew Socks', brand: 'Vanta', categorySlug: 'accesorios',
    description: 'Calcetines de caña media en algodón peinado, con puño acanalado y refuerzo en el talón. Seis combinaciones de color para rotar toda la semana.',
    price: 49900, sizes: ['Única'], base: 42, images: [img('VANTA-18')],
  },
  {
    id: 2, sku: 'KINETIK-19', name: 'Kinetik Sport Cap', brand: 'Kinetik', categorySlug: 'accesorios',
    description: 'Gorra de sarga lavada con visera curva y cierre ajustable. El lavado en prenda le da un tono desgastado que gana con el uso.',
    price: 79900, compareAtPrice: 94900, sizes: ['Única'], base: 30, images: [img('KINETIK-19')],
  },
  {
    id: 3, sku: 'RUTA-20', name: 'Ruta Canvas Tote', brand: 'Ruta', categorySlug: 'accesorios',
    description: 'Tote de lona gruesa con asas reforzadas y bolsillo interior. Suficientemente amplio para el día completo y suficientemente sobrio para todo.',
    price: 119900, sizes: ['Única'], base: 24, images: [img('RUTA-20')],
  },
  {
    id: 4, sku: 'VOLTA-21', name: 'Volta Reusable Bottle', brand: 'Volta', categorySlug: 'accesorios',
    description: 'Botella reutilizable de demostración en tono blanco con tapa deportiva. Confirma material y capacidad antes de publicar.',
    price: 69900, sizes: ['Única'], base: 35, images: [img('VOLTA-21')],
  },
  {
    id: 5, sku: 'NORD-22', name: 'Nord Field Backpack', brand: 'Nord', categorySlug: 'accesorios',
    description: 'Mochila de lona con cierre de cordón, bolsillo frontal con hebilla metálica y correas acolchadas. Pensada para escapadas de fin de semana.',
    price: 199900, compareAtPrice: 239900, isFeatured: true, sizes: ['Única'], base: 20, images: [img('NORD-22')],
  },

  // ---------------- Casual ----------------
  {
    id: 6, sku: 'NORD-14', name: 'Nord Suede Loafer', brand: 'Nord', categorySlug: 'casual',
    description: 'Mocasín de ante con horma redondeada y suela flexible. La alternativa sin cordones al zapato de todos los días.',
    price: 169900, sizes: BIG_SIZES, images: [img('NORD-14')],
  },
  {
    id: 7, sku: 'RUTA-12', name: 'Ruta Canvas Classic', brand: 'Ruta', categorySlug: 'casual',
    description: 'Lona resistente, puntera vulcanizada y cordones de algodón. El clásico de siempre en un rojo apagado que combina con todo.',
    price: 149900, compareAtPrice: 179900, sizes: SHOE_SIZES, images: [img('RUTA-12')],
  },

  // ---------------- Outdoor ----------------
  {
    id: 8, sku: 'TERA-16', name: 'Tera Ridge Low', brand: 'Tera', categorySlug: 'outdoor',
    description: 'Caña baja, ligera y transpirable, con suela de tacos moderados. Pensada para senderos de un día con desniveles suaves.',
    price: 259900, sizes: BIG_SIZES, images: [img('TERA-16')],
  },
  {
    id: 9, sku: 'VOLTA-17', name: 'Volta Terra Hiker', brand: 'Volta', categorySlug: 'outdoor',
    description: 'Bota de caña media con membrana impermeable, cuello acolchado y suela de agarre. Diseñada para barro, nieve y piedra suelta.',
    price: 229900, sizes: BIG_SIZES, images: [img('VOLTA-17')],
  },

  // ---------------- Urbano ----------------
  {
    id: 10, sku: 'ASTRAL-03', name: 'Astral Wave Runner', brand: 'Astral', categorySlug: 'urbano',
    description: 'Silueta futurista con malla transpirable y detalles reflectantes. Comodidad de running con actitud de calle.',
    price: 174900, compareAtPrice: 199900, isFeatured: true, sizes: BIG_SIZES, images: [img('ASTRAL-03')],
  },
  {
    id: 11, sku: 'TERA-15', name: 'Tera Alpine Boot', brand: 'Tera', categorySlug: 'outdoor',
    description: 'Bota de montaña en cuero hidrofugado, con soporte de tobillo y suela profunda. Construida para terrenos exigentes y jornadas largas.',
    price: 349900, compareAtPrice: 399900, isFeatured: true, sizes: BIG_SIZES, base: 12, images: [img('TERA-15')],
  },
  {
    id: 12, sku: 'VOLTA-04', name: 'Volta Street Mid', brand: 'Volta', categorySlug: 'urbano',
    description: 'Caña media con paneles de ante y malla. Amortiguación equilibrada para caminar todo el día con soporte.',
    price: 199900, sizes: BIG_SIZES, images: [img('VOLTA-04')],
  },

  // ---------------- Running ----------------
  {
    id: 13, sku: 'LUMEN-07', name: 'Lumen Pace Lite', brand: 'Lumen', categorySlug: 'running',
    description: 'Rodadora ligera y ventilada, con mediasuela de espuma blanda y upper de punto. La opción para sumar kilómetros sin pensar en los pies.',
    price: 209900, sizes: BIG_SIZES, images: [img('LUMEN-07')],
  },
  {
    id: 14, sku: 'NORD-02', name: 'Nord Drift High', brand: 'Nord', categorySlug: 'urbano',
    description: 'Caña alta con cuello reforzado y suela de goma antideslizante. Un básico de temporada que aguanta el ritmo de la ciudad.',
    price: 219900, isFeatured: true, sizes: BIG_SIZES, images: [img('NORD-02')],
  },
  {
    id: 15, sku: 'KINETIK-05', name: 'Kinetik Flow 3', brand: 'Kinetik', categorySlug: 'running',
    description: 'Producto de demostración: zapatilla de running azul marino y naranja, con cordones y suela blanca. Verifica modelo, color y características reales antes de publicar.',
    price: 259900, compareAtPrice: 299900, isFeatured: true, sizes: BIG_SIZES, images: [img('KINETIK-05')],
  },
  {
    id: 16, sku: 'VANTA-01', name: 'Vanta Knit Low', brand: 'Vanta', categorySlug: 'urbano',
    description: 'Sneaker de perfil bajo en tejido blanco, con plantilla acolchada y forro transpirable. Modelo visual de demostración; confirma materiales antes de publicar.',
    price: 189900, compareAtPrice: 229900, isFeatured: true, sizes: SHOE_SIZES, images: [img('VANTA-01')],
  },
  {
    id: 17, sku: 'KINETIK-06', name: 'Kinetik Aero Run', brand: 'Kinetik', categorySlug: 'running',
    description: 'Modelo de demostración para running en blanco y negro, con upper de malla y suela de perfil alto. Confirma materiales y ficha técnica antes de publicar.',
    price: 389900, isFeatured: true, sizes: BIG_SIZES, base: 9, images: [img('KINETIK-06')],
  },
  {
    id: 18, sku: 'TERA-08', name: 'Tera Trail GTX', brand: 'Tera', categorySlug: 'running',
    description: 'Trail con membrana impermeable, tacos de agarre profundo y protección en la puntera. Diseñada para barro, raíces y desnivel.',
    price: 279900, compareAtPrice: 319900, isFeatured: true, sizes: BIG_SIZES, images: [img('TERA-08')],
  },
]

export const DEMO_PRODUCTS: ProductApi[] = SEEDS.map((seed) => {
  const category = CATEGORY.get(seed.categorySlug)!
  const total = seed.sizes.length
  const base = seed.base ?? 18
  return {
    id: seed.id,
    sku: seed.sku,
    name: seed.name,
    description: seed.description,
    brand: seed.brand,
    price: seed.price,
    compareAtPrice: seed.compareAtPrice ?? null,
    isFeatured: Boolean(seed.isFeatured),
    imageUrls: seed.images,
    categoryId: category.id,
    categoryName: category.name,
    categorySlug: category.slug,
    isActive: true,
    variants: sizeVariants(seed.sku, seed.sizes, (size, index) => normalStock(base)(size, index, total)),
  }
})

export function totalStock(product: ProductApi): number {
  return product.variants.reduce((sum, v) => sum + (v.isActive ? v.stock : 0), 0)
}
