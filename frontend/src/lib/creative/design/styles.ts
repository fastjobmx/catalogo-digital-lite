/** Dirección de arte del motor publicitario: familias por sector, objetivos y estilos.
 *
 * El motor decide en este orden: sector del comercio → objetivo de la pieza → estilo → composición.
 * Cada sector tiene tres estilos con lenguaje visual propio (jerarquía, tratamiento del producto,
 * tipografía, fondos, ornamentos, botón, sello y relación texto/imagen), no la misma maqueta con otros
 * colores. Los estilos solo ponen estética: nunca escriben afirmaciones comerciales. */
import { INK, WHITE, bestOn, ensureContrast, hsl, hslToHex, isHex, luminance } from './color'

export const LAYOUTS = {
  heroe: { label: 'Producto héroe', hint: 'El producto grande e inclinado, con líneas de velocidad y una palabra gigante detrás.' },
  lookbook: { label: 'Lookbook', hint: 'La foto manda: marco editorial, mucho aire y poco texto.' },
  collage: { label: 'Collage', hint: 'Recortes, cinta, adhesivos y textos en bloques.' },
  catalogo: { label: 'Ficha de catálogo', hint: 'Foto limpia y datos ordenados: nombre, referencia, categoría y precio.' },
  podio: { label: 'Podio', hint: 'El producto sobre un podio con halo de luz.' },
  escenario: { label: 'Escenario', hint: 'Producto al centro, con luz y sombra.' },
  dividido: { label: 'Dividido', hint: 'Dos bloques: producto y datos.' },
  diagonal: { label: 'Diagonal', hint: 'Franja inclinada y movimiento.' },
  editorial: { label: 'Editorial', hint: 'Titular grande, como portada de revista.' },
  tarjeta: { label: 'Tarjeta', hint: 'Producto en una tarjeta flotante sobre un fondo con textura.' },
} as const
export type LayoutKey = keyof typeof LAYOUTS
export const LAYOUT_KEYS = Object.keys(LAYOUTS) as LayoutKey[]

export const SECTORS = {
  calzado: { label: 'Calzado y tenis', hint: 'Potente, dinámico y comercial: producto héroe, fondos intensos, precio con fuerza.' },
  moda: { label: 'Moda y boutique', hint: 'Editorial y aspiracional: mucho aire, serifas, la foto primero y el precio después.' },
  streetwear: { label: 'Streetwear', hint: 'Atrevido y joven: collage, recortes, alto contraste y tipografía gruesa.' },
  hogar: { label: 'Hogar y decoración', hint: 'Limpio y cálido: tonos tierra, orden y textura.' },
  belleza: { label: 'Belleza y cosmética', hint: 'Premium y pulido: degradados suaves, brillo y producto presentado con cuidado.' },
} as const
export type SectorKey = keyof typeof SECTORS
export const SECTOR_KEYS = Object.keys(SECTORS) as SectorKey[]

/** Objetivo de la pieza: decide la jerarquía (qué manda: producto, precio, marca o datos). No agrega afirmaciones:
 * «Promoción» solo muestra descuentos que existan en el catálogo (plantilla «Oferta aprobada»). */
export const OBJECTIVES = {
  venta: { label: 'Venta directa', hint: 'Producto, precio y botón con fuerza.' },
  promocion: { label: 'Promoción', hint: 'El precio y el descuento mandan. Requiere la plantilla «Oferta aprobada».' },
  coleccion: { label: 'Nueva colección', hint: 'Imagen y nombre primero; precio discreto.' },
  catalogo: { label: 'Catálogo limpio', hint: 'Datos ordenados: referencia, categoría y precio.' },
  aspiracional: { label: 'Historia aspiracional', hint: 'La foto domina; poco texto.' },
  beneficios: { label: 'Beneficios', hint: 'Muestra los beneficios que escribiste o aprobaste en «Texto».' },
  lanzamiento: { label: 'Lanzamiento', hint: 'Protagonismo y expectativa. «NUEVO» solo si el producto es nuevo de verdad.' },
} as const
export type ObjectiveKey = keyof typeof OBJECTIVES
export const OBJECTIVE_KEYS = Object.keys(OBJECTIVES) as ObjectiveKey[]

/** Jerarquía según el objetivo. */
export interface Emphasis { nameScale: number; priceScale: number; cta: 'fuerte' | 'suave'; description: boolean; benefits: boolean; image: number }
export const EMPHASIS: Record<ObjectiveKey, Emphasis> = {
  venta: { nameScale: 1, priceScale: 1.12, cta: 'fuerte', description: false, benefits: false, image: 1 },
  promocion: { nameScale: 0.88, priceScale: 1.38, cta: 'fuerte', description: false, benefits: false, image: 0.95 },
  coleccion: { nameScale: 1.12, priceScale: 0.78, cta: 'suave', description: false, benefits: false, image: 1.08 },
  catalogo: { nameScale: 0.9, priceScale: 0.96, cta: 'suave', description: true, benefits: false, image: 1 },
  aspiracional: { nameScale: 1.05, priceScale: 0.72, cta: 'suave', description: false, benefits: false, image: 1.14 },
  beneficios: { nameScale: 0.9, priceScale: 0.92, cta: 'fuerte', description: true, benefits: true, image: 0.95 },
  lanzamiento: { nameScale: 1.18, priceScale: 0.9, cta: 'fuerte', description: false, benefits: false, image: 1.06 },
}

export interface Palette {
  /** Fondo principal y su pareja para degradados. */
  bg: string; bg2: string
  /** Superficie de tarjetas y paneles. */
  surface: string; panel: string
  ink: string; muted: string
  /** Color del precio. */
  price: string
  /** Botón (llamada a la acción). */
  accent: string; onAccent: string
  /** Etiquetas, sellos y bloques de precio. */
  highlight: string; onHighlight: string
  /** Líneas y figuras decorativas, y luz detrás del producto. */
  line: string; glow: string
}

export interface StyleInput { brand: string[]; photo: string[]; override: string[] | null }

export type Decor =
  | 'rules' | 'circles' | 'stripes' | 'dots' | 'grid' | 'sparkles' | 'blobs' | 'frame' | 'arcs'
  /** Campaña: líneas de velocidad, palabra gigante en contorno, luz, trama de puntos, cinta adhesiva, podio y banda repetida. */
  | 'speed' | 'outline' | 'glow' | 'halftone' | 'tape' | 'podium' | 'marquee'

export interface DesignStyleDef {
  label: string
  sector: SectorKey
  description: string
  /** Lo que comunica, para ayudar a elegir. */
  mood: string
  display: { family: string; weight: 400 | 500 | 600 | 700 | 800; uppercase?: boolean; italic?: boolean; letterSpacing?: number }
  body: { family: string; weight: 400 | 500 | 600 | 700 | 800 }
  /** Rótulos pequeños (categoría, referencia): mayúsculas espaciadas. */
  eyebrow: { family: string; weight: 400 | 500 | 600 | 700 | 800; letterSpacing: number }
  price: { family: string; weight: 400 | 500 | 600 | 700 | 800; shape: 'plain' | 'tag' | 'burst' | 'underline' | 'pill' | 'sticker' | 'slash' }
  /** Botón: cápsula, bloque recto, contorno, cápsula con flecha o enlace subrayado. */
  cta: 'capsula' | 'bloque' | 'contorno' | 'flecha' | 'enlace'
  /** Etiqueta verificada (NUEVO, -20 %): cápsula, sello circular, etiqueta recta o cinta. */
  badge: 'capsula' | 'sello' | 'etiqueta' | 'cinta'
  /** Tamaño del nombre respecto al estándar (los estilos de impacto lo agrandan). */
  nameScale: number
  /** Inclinación del producto recortado en la composición héroe (grados). */
  tilt: number
  /** Textos de nombre sobre barras (estética de etiqueta urbana). */
  labelBars?: boolean
  /** Radio de esquinas en unidades (1 u = 1 % del lado menor). */
  radius: number
  shadow: 'suave' | 'marcada' | 'ninguna'
  reflection: number
  decor: Decor[]
  background: 'liso' | 'lineal' | 'radial'
  texture: 'none' | 'noise' | 'dots' | 'lines' | 'grid'
  layouts: LayoutKey[]
  palette: (input: StyleInput) => Palette
}

const customOr = (input: StyleInput, fallback: string, index = 0) => (input.override?.filter(isHex)[index] ?? fallback).toUpperCase()
/** El color de la marca solo si es lo bastante intenso para el estilo; si no, el del estilo. */
const vividBrand = (input: StyleInput, fallback: string, minimumSaturation = 0.45) => {
  const custom = input.override?.find(isHex)
  if (custom) return custom.toUpperCase()
  const brand = input.brand.find((color) => isHex(color) && hsl(color)[1] >= minimumSaturation && hsl(color)[2] > 0.2 && hsl(color)[2] < 0.75)
  return (brand ?? fallback).toUpperCase()
}

function finish(p: Omit<Palette, 'onAccent' | 'onHighlight'> & Partial<Pick<Palette, 'onAccent' | 'onHighlight'>>): Palette {
  return {
    ...p,
    ink: ensureContrast(p.ink, p.bg, 4.5),
    muted: ensureContrast(p.muted, p.bg, 4.6),
    price: ensureContrast(p.price, p.bg, 4.6),
    onAccent: p.onAccent ?? bestOn(p.accent),
    onHighlight: p.onHighlight ?? bestOn(p.highlight),
  }
}

export const DESIGN_STYLES = {
  // ---- CALZADO: potente, dinámico, producto héroe ----------------------------------------------------
  sneaker_impact: {
    label: 'Sneaker Impact', sector: 'calzado', mood: 'Fuerza, velocidad, deseo', description: 'Negro profundo, luz roja detrás del tenis, palabra gigante en contorno y precio en bloque inclinado.',
    display: { family: 'Anton', weight: 400, uppercase: true, letterSpacing: 0.01 }, body: { family: 'Inter', weight: 700 }, eyebrow: { family: 'Inter', weight: 800, letterSpacing: 0.24 },
    price: { family: 'Anton', weight: 400, shape: 'slash' }, cta: 'bloque', badge: 'sello', nameScale: 1.3, tilt: -13,
    radius: 0.4, shadow: 'marcada', reflection: 0, decor: ['speed', 'outline', 'glow'], background: 'radial', texture: 'noise',
    layouts: ['heroe', 'diagonal', 'escenario', 'dividido', 'tarjeta'],
    palette: (input) => {
      const hot = vividBrand(input, '#FF3B1F')
      return finish({ bg: '#0B0B0D', bg2: '#020203', surface: '#17171B', panel: '#141418', ink: '#FFFFFF', muted: '#A7A7B0', price: '#FFFFFF', accent: hot, highlight: hot, line: 'rgba(255,255,255,0.16)', glow: hslToHex(hsl(hot)[0], 0.75, 0.3) })
    },
  },
  sport_neon: {
    label: 'Sport Neon', sector: 'calzado', mood: 'Rendimiento, tecnología, noche', description: 'Degradado azul noche a violeta, neón, cuadrícula de pista y reflejo del producto.',
    display: { family: 'Bebas Neue', weight: 400, uppercase: true, letterSpacing: 0.03 }, body: { family: 'Space Grotesk', weight: 500 }, eyebrow: { family: 'Space Grotesk', weight: 700, letterSpacing: 0.3 },
    price: { family: 'Bebas Neue', weight: 400, shape: 'tag' }, cta: 'flecha', badge: 'capsula', nameScale: 1.25, tilt: -8,
    radius: 1.2, shadow: 'marcada', reflection: 0.2, decor: ['speed', 'glow', 'grid', 'sparkles'], background: 'lineal', texture: 'none',
    layouts: ['heroe', 'escenario', 'diagonal', 'tarjeta', 'dividido'],
    palette: (input) => {
      const neon = vividBrand(input, '#C6FF00', 0.6)
      const usable = luminance(neon) > 0.3 ? neon : '#C6FF00'
      return finish({ bg: '#0A0F2C', bg2: '#2B0B4D', surface: '#151B44', panel: '#131A40', ink: '#F3F5FF', muted: '#AEB6E0', price: usable, accent: usable, highlight: usable, line: 'rgba(160,170,255,0.20)', glow: '#3B2B8F' })
    },
  },
  urban_drop: {
    label: 'Urban Drop', sector: 'calzado', mood: 'Calle, lanzamiento, cultura', description: 'Concreto claro con grano, naranja de seguridad, adhesivos de precio y cinta.',
    display: { family: 'Archivo Black', weight: 400, uppercase: true, letterSpacing: -0.01 }, body: { family: 'Inter', weight: 700 }, eyebrow: { family: 'Inter', weight: 800, letterSpacing: 0.2 },
    price: { family: 'Archivo Black', weight: 400, shape: 'sticker' }, cta: 'bloque', badge: 'cinta', nameScale: 1.1, tilt: -6,
    radius: 0, shadow: 'marcada', reflection: 0, decor: ['outline', 'tape', 'halftone'], background: 'liso', texture: 'noise',
    layouts: ['collage', 'heroe', 'dividido', 'editorial', 'tarjeta'],
    palette: (input) => {
      const hazard = vividBrand(input, '#FF5A00')
      return finish({ bg: '#E6E3DD', bg2: '#D6D2CA', surface: '#F7F5F1', panel: '#111111', ink: '#111111', muted: '#4B4741', price: '#111111', accent: '#111111', onAccent: '#FFFFFF', highlight: hazard, line: 'rgba(17,17,17,0.12)', glow: '#F2F0EC' })
    },
  },
  // ---- MODA: editorial, aspiracional, la foto primero ----------------------------------------------
  editorial_nude: {
    label: 'Editorial Nude', sector: 'moda', mood: 'Elegancia serena, colección', description: 'Nude y crema, serifa clásica, marco fino y precio discreto: la foto manda.',
    display: { family: 'Cormorant Garamond', weight: 600 }, body: { family: 'Montserrat', weight: 500 }, eyebrow: { family: 'Montserrat', weight: 600, letterSpacing: 0.34 },
    price: { family: 'Montserrat', weight: 500, shape: 'plain' }, cta: 'enlace', badge: 'etiqueta', nameScale: 1.05, tilt: 0,
    radius: 0, shadow: 'suave', reflection: 0, decor: ['frame', 'rules'], background: 'liso', texture: 'noise',
    layouts: ['lookbook', 'editorial', 'dividido', 'escenario', 'tarjeta'],
    palette: (input) => {
      const accent = customOr(input, '#8A7365')
      return finish({ bg: '#EFE6DC', bg2: '#E4D8CA', surface: '#F7F1EA', panel: '#E2D4C4', ink: '#2B2522', muted: '#6E625A', price: '#2B2522', accent, highlight: '#2B2522', line: '#B9A898', glow: '#F7F1EA' })
    },
  },
  luxury_lookbook: {
    label: 'Luxury Lookbook', sector: 'moda', mood: 'Lujo, exclusividad, noche', description: 'Negro, marfil y champán; itálica de alta costura y foto a gran tamaño.',
    display: { family: 'Playfair Display', weight: 400, italic: true }, body: { family: 'Montserrat', weight: 400 }, eyebrow: { family: 'Montserrat', weight: 600, letterSpacing: 0.4 },
    price: { family: 'Montserrat', weight: 500, shape: 'plain' }, cta: 'contorno', badge: 'etiqueta', nameScale: 1.1, tilt: 0,
    radius: 0, shadow: 'marcada', reflection: 0, decor: ['frame'], background: 'radial', texture: 'none',
    layouts: ['lookbook', 'editorial', 'escenario', 'tarjeta', 'dividido'],
    palette: () => finish({ bg: '#0E0D0C', bg2: '#050505', surface: '#1A1816', panel: '#171513', ink: '#F5F0E8', muted: '#C9BBA2', price: '#E6D2AE', accent: '#D8C3A0', onAccent: '#0E0D0C', highlight: '#D8C3A0', onHighlight: '#0E0D0C', line: '#7A6A52', glow: '#2B2620' }),
  },
  sale_chic: {
    label: 'Sale Chic', sector: 'moda', mood: 'Oferta con estilo', description: 'Rosa empolvado y negro, serifa con carácter, sello circular para la etiqueta y precio en cápsula.',
    display: { family: 'DM Serif Display', weight: 400 }, body: { family: 'Manrope', weight: 600 }, eyebrow: { family: 'Manrope', weight: 700, letterSpacing: 0.26 },
    price: { family: 'Manrope', weight: 800, shape: 'pill' }, cta: 'bloque', badge: 'sello', nameScale: 1.05, tilt: 0,
    radius: 1, shadow: 'suave', reflection: 0, decor: ['blobs', 'rules'], background: 'lineal', texture: 'none',
    layouts: ['dividido', 'tarjeta', 'lookbook', 'escenario', 'editorial'],
    palette: (input) => {
      const rose = customOr(input, '#B4535E')
      return finish({ bg: '#F7EDE8', bg2: '#F1DDD6', surface: '#FFFFFF', panel: '#E9C9C1', ink: '#1E1A1A', muted: '#6A5653', price: '#1E1A1A', accent: '#1E1A1A', onAccent: '#FFFFFF', highlight: rose, line: '#D9B3AA', glow: '#FFF6F2' })
    },
  },
  // ---- STREETWEAR: collage, alto contraste, tipografía gruesa ----------------------------------------
  street_collage: {
    label: 'Street Collage', sector: 'streetwear', mood: 'Calle, actitud, recortes', description: 'Papel con grano y trama, fotos con cinta, nombre en barras negras y precio adhesivo.',
    display: { family: 'Archivo Black', weight: 400, uppercase: true }, body: { family: 'Space Grotesk', weight: 700 }, eyebrow: { family: 'Space Grotesk', weight: 700, letterSpacing: 0.18 },
    price: { family: 'Archivo Black', weight: 400, shape: 'sticker' }, cta: 'bloque', badge: 'cinta', nameScale: 1, tilt: -5, labelBars: true,
    radius: 0, shadow: 'marcada', reflection: 0, decor: ['tape', 'halftone', 'outline'], background: 'liso', texture: 'noise',
    layouts: ['collage', 'heroe', 'diagonal', 'tarjeta', 'dividido'],
    palette: (input) => {
      const acid = vividBrand(input, '#E8FF3A', 0.5)
      return finish({ bg: '#F2EFE6', bg2: '#E6E1D3', surface: '#FFFFFF', panel: '#111111', ink: '#111111', muted: '#4A463E', price: '#111111', accent: '#111111', onAccent: '#FFFFFF', highlight: luminance(acid) > 0.35 ? acid : '#E8FF3A', line: 'rgba(17,17,17,0.14)', glow: '#FFFFFF' })
    },
  },
  bold_monochrome: {
    label: 'Bold Monochrome', sector: 'streetwear', mood: 'Contraste, minimal urbano', description: 'Blanco y negro puros, letras condensadas gigantes en contorno y banda de texto repetido.',
    display: { family: 'Anton', weight: 400, uppercase: true, letterSpacing: 0.01 }, body: { family: 'Inter', weight: 600 }, eyebrow: { family: 'Inter', weight: 800, letterSpacing: 0.32 },
    price: { family: 'Anton', weight: 400, shape: 'plain' }, cta: 'contorno', badge: 'capsula', nameScale: 1.35, tilt: -4,
    radius: 0, shadow: 'marcada', reflection: 0, decor: ['outline', 'marquee'], background: 'liso', texture: 'none',
    layouts: ['editorial', 'heroe', 'dividido', 'collage', 'escenario'],
    palette: () => finish({ bg: '#000000', bg2: '#111111', surface: '#0E0E0E', panel: '#FFFFFF', ink: '#FFFFFF', muted: '#BDBDBD', price: '#FFFFFF', accent: '#FFFFFF', onAccent: '#000000', highlight: '#FFFFFF', onHighlight: '#000000', line: 'rgba(255,255,255,0.22)', glow: '#1C1C1C' }),
  },
  hype_drop: {
    label: 'Hype Drop', sector: 'streetwear', mood: 'Lanzamiento, euforia, edición', description: 'Degradado eléctrico, amarillo de alerta, destellos y precio en bloque inclinado.',
    display: { family: 'Bricolage Grotesque', weight: 800, letterSpacing: -0.03 }, body: { family: 'Poppins', weight: 600 }, eyebrow: { family: 'Poppins', weight: 700, letterSpacing: 0.2 },
    price: { family: 'Bricolage Grotesque', weight: 800, shape: 'slash' }, cta: 'flecha', badge: 'sello', nameScale: 1.2, tilt: -10,
    radius: 2, shadow: 'marcada', reflection: 0, decor: ['sparkles', 'speed', 'outline'], background: 'lineal', texture: 'noise',
    layouts: ['heroe', 'tarjeta', 'collage', 'diagonal', 'escenario'],
    palette: (input) => {
      const base = vividBrand(input, '#5B2BFF', 0.5)
      const h = hsl(base)[0]
      return finish({ bg: hslToHex(h, 0.85, 0.36), bg2: hslToHex(h + 70, 0.9, 0.42), surface: '#FFFFFF', panel: '#111111', ink: '#FFFFFF', muted: '#FFFFFF', price: '#FFFFFF', accent: '#FFE600', onAccent: '#111111', highlight: '#FFE600', onHighlight: '#111111', line: 'rgba(255,255,255,0.18)', glow: hslToHex(h + 30, 0.95, 0.66) })
    },
  },
  // ---- HOGAR: cálido, sobrio, materiales --------------------------------------------------------------
  warm_decor: {
    label: 'Warm Decor', sector: 'hogar', mood: 'Calidez, hogar, buen gusto', description: 'Arena y terracota, arco que enmarca la foto, serifa cálida y textura de papel.',
    display: { family: 'Fraunces', weight: 600 }, body: { family: 'Manrope', weight: 500 }, eyebrow: { family: 'Manrope', weight: 700, letterSpacing: 0.24 },
    price: { family: 'Fraunces', weight: 700, shape: 'underline' }, cta: 'capsula', badge: 'etiqueta', nameScale: 0.95, tilt: 0,
    radius: 2.4, shadow: 'suave', reflection: 0, decor: ['arcs'], background: 'lineal', texture: 'noise',
    layouts: ['dividido', 'catalogo', 'editorial', 'escenario', 'tarjeta'],
    palette: (input) => {
      const terracotta = customOr(input, '#B5603A')
      return finish({ bg: '#EFE4D6', bg2: '#E3D3BE', surface: '#F8F2EA', panel: '#DCC8AF', ink: '#3A2E25', muted: '#6F5E50', price: '#8E4325', accent: terracotta, highlight: '#6B7044', line: '#C2AC92', glow: '#FBF6EF' })
    },
  },
  nordic_living: {
    label: 'Nordic Living', sector: 'hogar', mood: 'Calma, luz, orden', description: 'Blanco piedra y verde salvia, mucho aire, líneas finas y tipografía limpia.',
    display: { family: 'Manrope', weight: 500, letterSpacing: -0.02 }, body: { family: 'Manrope', weight: 400 }, eyebrow: { family: 'Manrope', weight: 600, letterSpacing: 0.3 },
    price: { family: 'Manrope', weight: 600, shape: 'plain' }, cta: 'contorno', badge: 'capsula', nameScale: 0.95, tilt: 0,
    radius: 1, shadow: 'suave', reflection: 0, decor: ['rules'], background: 'liso', texture: 'none',
    layouts: ['catalogo', 'escenario', 'editorial', 'tarjeta', 'dividido'],
    palette: (input) => {
      const sage = customOr(input, '#6E8270')
      return finish({ bg: '#F4F4F1', bg2: '#E9EAE5', surface: '#FFFFFF', panel: '#E3E6DF', ink: '#1F2A2E', muted: '#5E6A6C', price: '#1F2A2E', accent: '#1F2A2E', highlight: sage, line: '#D3D6CF', glow: '#FFFFFF' })
    },
  },
  soft_catalog: {
    label: 'Soft Catalog', sector: 'hogar', mood: 'Claridad, confianza, catálogo', description: 'Fichas limpias sobre crema, datos ordenados y etiqueta de precio suave.',
    display: { family: 'Inter', weight: 700, letterSpacing: -0.02 }, body: { family: 'Inter', weight: 400 }, eyebrow: { family: 'Inter', weight: 700, letterSpacing: 0.16 },
    price: { family: 'Inter', weight: 800, shape: 'tag' }, cta: 'capsula', badge: 'capsula', nameScale: 0.9, tilt: 0,
    radius: 2.2, shadow: 'suave', reflection: 0, decor: [], background: 'liso', texture: 'none',
    layouts: ['catalogo', 'tarjeta', 'dividido', 'escenario', 'editorial'],
    palette: (input) => {
      const stone = customOr(input, '#5E554B')
      return finish({ bg: '#FBF8F3', bg2: '#F2ECE3', surface: '#FFFFFF', panel: '#F0E9DF', ink: '#2D2A26', muted: '#6B655D', price: '#2D2A26', accent: stone, highlight: '#E8DFD2', onHighlight: '#2D2A26', line: '#E3DBCF', glow: '#FFFFFF' })
    },
  },
  // ---- BELLEZA: pulido, premium, luz suave ------------------------------------------------------------
  clean_beauty: {
    label: 'Clean Beauty', sector: 'belleza', mood: 'Pureza, cuidado, natural', description: 'Neutros verdosos, podio, tipografía limpia y mucho orden.',
    display: { family: 'Manrope', weight: 700, letterSpacing: -0.02 }, body: { family: 'Manrope', weight: 400 }, eyebrow: { family: 'Manrope', weight: 700, letterSpacing: 0.28 },
    price: { family: 'Manrope', weight: 700, shape: 'plain' }, cta: 'capsula', badge: 'capsula', nameScale: 0.95, tilt: 0,
    radius: 3, shadow: 'suave', reflection: 0.1, decor: ['podium'], background: 'lineal', texture: 'none',
    layouts: ['podio', 'escenario', 'tarjeta', 'dividido', 'editorial'],
    palette: (input) => {
      const green = customOr(input, '#2F5D50')
      return finish({ bg: '#F4F6F3', bg2: '#E3EAE4', surface: '#FFFFFF', panel: '#DDE6DF', ink: '#22302B', muted: '#5A6862', price: '#22302B', accent: green, highlight: '#CFE0D5', onHighlight: '#22302B', line: '#C9D5CD', glow: '#FFFFFF' })
    },
  },
  glow_premium: {
    label: 'Glow Premium', sector: 'belleza', mood: 'Brillo, lujo, piel radiante', description: 'Halo dorado y durazno, destellos, itálica refinada y reflejo del producto.',
    display: { family: 'Playfair Display', weight: 400, italic: true }, body: { family: 'Manrope', weight: 500 }, eyebrow: { family: 'Manrope', weight: 700, letterSpacing: 0.3 },
    price: { family: 'Manrope', weight: 800, shape: 'pill' }, cta: 'capsula', badge: 'sello', nameScale: 1.05, tilt: 0,
    radius: 4, shadow: 'suave', reflection: 0.18, decor: ['glow', 'sparkles', 'podium'], background: 'radial', texture: 'none',
    layouts: ['podio', 'editorial', 'escenario', 'tarjeta', 'dividido'],
    palette: (input) => {
      const rosegold = customOr(input, '#A35B47')
      return finish({ bg: '#F6DCCB', bg2: '#E9B9A1', surface: '#FFF8F3', panel: '#F1CDB9', ink: '#3B1F1A', muted: '#6E463C', price: '#3B1F1A', accent: rosegold, highlight: rosegold, line: '#E0A98F', glow: '#FFF4E6' })
    },
  },
  skincare_offer: {
    label: 'Skincare Offer', sector: 'belleza', mood: 'Oferta cuidada, rutina', description: 'Lila y blanco, tarjeta con podio, sello de oferta y botón sólido.',
    display: { family: 'Manrope', weight: 800, letterSpacing: -0.02 }, body: { family: 'Manrope', weight: 500 }, eyebrow: { family: 'Manrope', weight: 700, letterSpacing: 0.22 },
    price: { family: 'Manrope', weight: 800, shape: 'pill' }, cta: 'bloque', badge: 'sello', nameScale: 1, tilt: 0,
    radius: 3.4, shadow: 'suave', reflection: 0, decor: ['blobs', 'podium'], background: 'lineal', texture: 'none',
    layouts: ['tarjeta', 'podio', 'dividido', 'escenario', 'diagonal'],
    palette: (input) => {
      const pink = customOr(input, '#D02B63')
      return finish({ bg: '#EEF0FB', bg2: '#DCE0F7', surface: '#FFFFFF', panel: '#E3E6FA', ink: '#1C1F3A', muted: '#525780', price: '#1C1F3A', accent: '#1C1F3A', onAccent: '#FFFFFF', highlight: pink, line: '#C9CEF0', glow: '#FFFFFF' })
    },
  },
} as const satisfies Record<string, DesignStyleDef>

export type StyleKey = keyof typeof DESIGN_STYLES
export const STYLE_KEYS = Object.keys(DESIGN_STYLES) as StyleKey[]
export const isStyle = (value: unknown): value is StyleKey => typeof value === 'string' && Object.hasOwn(DESIGN_STYLES, value)
export const isLayout = (value: unknown): value is LayoutKey => typeof value === 'string' && Object.hasOwn(LAYOUTS, value)
export const isSector = (value: unknown): value is SectorKey => typeof value === 'string' && Object.hasOwn(SECTORS, value)
export const isObjective = (value: unknown): value is ObjectiveKey => typeof value === 'string' && Object.hasOwn(OBJECTIVES, value)
export const stylesOf = (sector: SectorKey): StyleKey[] => STYLE_KEYS.filter((key) => DESIGN_STYLES[key].sector === sector)

export function styleOf(key: string): DesignStyleDef {
  return (DESIGN_STYLES as Record<string, DesignStyleDef>)[key] ?? DESIGN_STYLES.sneaker_impact
}

/** Familias que necesita un estilo (para cargarlas antes de medir y pintar). */
export const styleFonts = (key: string) => { const s = styleOf(key); return [s.display.family, s.body.family, s.eyebrow.family, s.price.family] }

const SECTOR_WORDS: Record<SectorKey, RegExp> = {
  calzado: /tenis|zapat|calzad|sneaker|botas?\b|bot[ií]n|sandalia|chancla|running|nike|adidas|jordan|guayos?|mocas[ií]n/,
  streetwear: /streetwear|urban|hoodie|buzo|sudadera|gorra|camiset|playera|oversize|jogger|jean|cargo|amiri|trapstar|essentials/,
  moda: /vestido|blusa|falda|boutique|dama|mujer|lencer|enterizo|conjunto|abrigo|chaqueta|bolso|cartera|moda|accesorio|joya|aret/,
  hogar: /hogar|decora|mueble|espejo|tocador|puff|silla|mesa|repisa|nochero|c[oó]moda|cl[oó]set|l[aá]mpara|cojin|cortina|cocina|ba[nñ]o|zapatero|closet/,
  belleza: /belleza|cosm[eé]t|maquill|labial|crema|s[eé]rum|skin|piel|perfum|fragancia|u[nñ]as|esmalte|cabello|champ|facial|cuidado/,
}

/** Sector probable del comercio a partir de categorías y nombres reales. null si no hay señal clara. */
export function detectSector(texts: string[]): SectorKey | null {
  const source = texts.join(' ').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  let best: SectorKey | null = null
  let score = 0
  for (const sector of SECTOR_KEYS) {
    const hits = source.match(new RegExp(SECTOR_WORDS[sector].source, 'g'))?.length ?? 0
    if (hits > score) { best = sector; score = hits }
  }
  return best
}

export { INK, WHITE }
