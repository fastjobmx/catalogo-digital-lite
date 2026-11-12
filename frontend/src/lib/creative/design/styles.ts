/** Biblioteca de estilos gráficos del motor de diseño.
 *
 * Un estilo no es «la misma maqueta con otros colores»: define tipografías, paleta, tratamiento de la foto,
 * recursos gráficos, forma del precio y el orden de las composiciones que mejor le van. Cada estilo ofrece
 * cinco composiciones (variantes) con distribución, jerarquía y fondos distintos. */
import { INK, WHITE, bestOn, ensureContrast, hsl, hslToHex, isHex, luminance, mix } from './color'

export const LAYOUTS = {
  escenario: { label: 'Escenario', hint: 'Producto protagonista al centro, con luz y sombra.' },
  dividido: { label: 'Dividido', hint: 'Dos bloques: producto y datos, con el precio en la unión.' },
  diagonal: { label: 'Diagonal', hint: 'Franja inclinada y movimiento, para captar la atención.' },
  editorial: { label: 'Editorial', hint: 'Titular grande, como portada de revista.' },
  tarjeta: { label: 'Tarjeta', hint: 'Producto en una tarjeta flotante sobre un fondo con textura.' },
} as const
export type LayoutKey = keyof typeof LAYOUTS
export const LAYOUT_KEYS = Object.keys(LAYOUTS) as LayoutKey[]

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
  /** Etiquetas y sellos (descuento, «NUEVO»). */
  highlight: string; onHighlight: string
  /** Líneas y figuras decorativas. */
  line: string; glow: string
}

export interface StyleInput { brand: string[]; photo: string[]; override: string[] | null }

export type Decor = 'rules' | 'circles' | 'burst' | 'stripes' | 'dots' | 'grid' | 'noise' | 'sparkles' | 'blobs' | 'frame' | 'arcs'
export interface DesignStyleDef {
  label: string
  description: string
  /** Lo que comunica, para ayudar a elegir. */
  mood: string
  display: { family: string; weight: 400 | 500 | 600 | 700 | 800; uppercase?: boolean; italic?: boolean; letterSpacing?: number }
  body: { family: string; weight: 400 | 500 | 600 | 700 | 800 }
  /** Rótulos pequeños (categoría, referencia): mayúsculas espaciadas. */
  eyebrow: { family: string; weight: 400 | 500 | 600 | 700 | 800; letterSpacing: number }
  price: { family: string; weight: 400 | 500 | 600 | 700 | 800; shape: 'plain' | 'tag' | 'burst' | 'underline' | 'pill' }
  /** Radio de esquinas en unidades (1 u = 1 % del lado menor). */
  radius: number
  shadow: 'suave' | 'marcada' | 'ninguna'
  reflection: number
  decor: Decor[]
  /** Fondo: liso, degradado lineal, degradado radial (luz) o foto desenfocada. */
  background: 'liso' | 'lineal' | 'radial' | 'foto'
  texture: 'none' | 'noise' | 'dots' | 'lines' | 'grid'
  layouts: LayoutKey[]
  palette: (input: StyleInput) => Palette
}

const brandOr = (input: StyleInput, index: number, fallback: string) => {
  const list = input.override?.filter(isHex).length ? input.override.filter(isHex) : input.brand.filter(isHex)
  return (list[index] ?? (index > 0 ? list[0] : undefined) ?? fallback).toUpperCase()
}
/** Tinte muy claro de un color, para fondos que armonizan sin competir con el producto. */
const tint = (hex: string, lightness = 0.95, saturation = 0.35) => { const [h, s] = hsl(hex); return hslToHex(h, Math.min(s, saturation), lightness) }
const deep = (hex: string, lightness = 0.14, saturation = 0.45) => { const [h, s] = hsl(hex); return hslToHex(h, Math.min(s, saturation), lightness) }

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
  minimalista_premium: {
    label: 'Minimalista premium', mood: 'Calma, calidad, precio justo', description: 'Mucho aire, tonos marfil, serifa elegante y sombras suaves.',
    display: { family: 'Playfair Display', weight: 600 }, body: { family: 'Inter', weight: 400 }, eyebrow: { family: 'Inter', weight: 600, letterSpacing: 0.22 },
    price: { family: 'Inter', weight: 600, shape: 'underline' }, radius: 1.2, shadow: 'suave', reflection: 0.12, decor: ['rules', 'arcs'], background: 'radial', texture: 'none',
    layouts: ['escenario', 'editorial', 'tarjeta', 'dividido', 'diagonal'],
    palette: (input) => {
      const accent = brandOr(input, 0, '#1C1917')
      const bg = input.override?.length ? tint(accent, 0.95, 0.25) : '#F6F2EC'
      return finish({ bg, bg2: mix(bg, '#D9CFC1', 0.55), surface: '#FFFFFF', panel: mix(bg, '#CFC3B2', 0.35), ink: '#1C1917', muted: '#6B625A', price: '#1C1917', accent: luminance(accent) > 0.5 ? '#1C1917' : accent, highlight: '#1C1917', line: '#B8AC9C', glow: '#FFFFFF' })
    },
  },
  comercial_moderno: {
    label: 'Comercial moderno', mood: 'Cercano, actual, confiable', description: 'Bloques de color de tu marca, esquinas redondas y tipografía geométrica.',
    display: { family: 'Poppins', weight: 800 }, body: { family: 'Poppins', weight: 500 }, eyebrow: { family: 'Poppins', weight: 600, letterSpacing: 0.12 },
    price: { family: 'Poppins', weight: 800, shape: 'pill' }, radius: 3.2, shadow: 'suave', reflection: 0, decor: ['circles', 'dots'], background: 'lineal', texture: 'none',
    layouts: ['dividido', 'escenario', 'tarjeta', 'diagonal', 'editorial'],
    palette: (input) => {
      const primary = brandOr(input, 0, '#2563EB')
      const second = brandOr(input, 1, hslToHex(hsl(primary)[0] + 35, 0.85, 0.55))
      const bg = tint(primary, 0.965, 0.5)
      return finish({ bg, bg2: tint(primary, 0.9, 0.55), surface: '#FFFFFF', panel: primary, ink: deep(primary, 0.13, 0.5), muted: deep(primary, 0.36, 0.25), price: deep(primary, 0.2, 0.7), accent: primary, highlight: second, line: tint(primary, 0.78, 0.6), glow: '#FFFFFF' })
    },
  },
  oferta_impacto: {
    label: 'Oferta de alto impacto', mood: 'Urgencia, energía, precio', description: 'Colores intensos, letras condensadas, sello de precio y franjas en movimiento.',
    display: { family: 'Anton', weight: 400, uppercase: true, letterSpacing: 0.01 }, body: { family: 'Inter', weight: 700 }, eyebrow: { family: 'Inter', weight: 800, letterSpacing: 0.14 },
    price: { family: 'Anton', weight: 400, shape: 'burst' }, radius: 1, shadow: 'marcada', reflection: 0, decor: ['burst', 'stripes'], background: 'radial', texture: 'lines',
    layouts: ['diagonal', 'escenario', 'dividido', 'tarjeta', 'editorial'],
    palette: (input) => {
      const base = brandOr(input, 0, '#DC2626')
      const [h, s, l] = hsl(base)
      // Un rojo, naranja o el color de la marca muy saturado; el amarillo como sello.
      const strong = s < 0.35 || l < 0.15 || l > 0.8 ? '#DC2626' : hslToHex(h, Math.max(0.7, s), Math.min(0.48, Math.max(0.36, l)))
      const pop = brandOr(input, 1, '#FACC15')
      const highlight = Math.abs(hsl(pop)[0] - hsl(strong)[0]) < 25 ? '#FACC15' : pop
      return finish({ bg: strong, bg2: hslToHex(hsl(strong)[0], 0.85, 0.28), surface: '#FFFFFF', panel: hslToHex(hsl(strong)[0], 0.85, 0.24), ink: WHITE, muted: '#FFE4E6', price: WHITE, accent: '#111111', onAccent: '#FFFFFF', highlight, line: 'rgba(255,255,255,0.14)' as string, glow: hslToHex(hsl(strong)[0], 0.95, 0.62) })
    },
  },
  moda_elegante: {
    label: 'Moda elegante', mood: 'Estilo, tendencia, exclusividad', description: 'Serifa fina en itálica, mayúsculas espaciadas y paleta tomada del producto.',
    display: { family: 'Cormorant Garamond', weight: 600, italic: true }, body: { family: 'Montserrat', weight: 500 }, eyebrow: { family: 'Montserrat', weight: 600, letterSpacing: 0.3 },
    price: { family: 'Montserrat', weight: 600, shape: 'plain' }, radius: 0, shadow: 'suave', reflection: 0, decor: ['frame', 'rules'], background: 'liso', texture: 'noise',
    layouts: ['editorial', 'dividido', 'escenario', 'tarjeta', 'diagonal'],
    palette: (input) => {
      const source = input.override?.find(isHex) ?? input.photo.find((color) => hsl(color)[1] > 0.12 && hsl(color)[2] > 0.15 && hsl(color)[2] < 0.85) ?? '#B49A7E'
      const [h] = hsl(source)
      const bg = hslToHex(h, 0.16, 0.9)
      return finish({ bg, bg2: hslToHex(h, 0.14, 0.84), surface: hslToHex(h, 0.2, 0.96), panel: hslToHex(h, 0.18, 0.8), ink: '#161412', muted: hslToHex(h, 0.12, 0.34), price: '#161412', accent: '#161412', highlight: '#161412', line: hslToHex(h, 0.14, 0.55), glow: hslToHex(h, 0.2, 0.97) })
    },
  },
  ecommerce_profesional: {
    label: 'E-commerce profesional', mood: 'Claridad, orden, confianza', description: 'Fondo blanco de estudio, producto centrado con sombra de contacto y datos limpios.',
    display: { family: 'Inter', weight: 800 }, body: { family: 'Inter', weight: 500 }, eyebrow: { family: 'Inter', weight: 700, letterSpacing: 0.12 },
    price: { family: 'Inter', weight: 800, shape: 'tag' }, radius: 2, shadow: 'suave', reflection: 0, decor: ['grid'], background: 'radial', texture: 'none',
    layouts: ['escenario', 'tarjeta', 'dividido', 'editorial', 'diagonal'],
    palette: (input) => {
      const primary = brandOr(input, 0, '#0F172A')
      const highlight = brandOr(input, 1, luminance(primary) > 0.4 ? '#0F172A' : primary)
      return finish({ bg: '#FFFFFF', bg2: '#EEF1F5', surface: '#FFFFFF', panel: '#F3F5F8', ink: '#0F172A', muted: '#526077', price: primary, accent: primary, highlight, line: '#DCE1E8', glow: '#FFFFFF' })
    },
  },
} as const satisfies Record<string, DesignStyleDef>

export type StyleKey = keyof typeof DESIGN_STYLES
export const STYLE_KEYS = Object.keys(DESIGN_STYLES) as StyleKey[]
export const isStyle = (value: unknown): value is StyleKey => typeof value === 'string' && Object.hasOwn(DESIGN_STYLES, value)
export const isLayout = (value: unknown): value is LayoutKey => typeof value === 'string' && Object.hasOwn(LAYOUTS, value)

export function styleOf(key: string): DesignStyleDef {
  return (DESIGN_STYLES as Record<string, DesignStyleDef>)[key] ?? DESIGN_STYLES.ecommerce_profesional
}

/** Familias que necesita un estilo (para cargarlas antes de medir y pintar). */
export const styleFonts = (key: string) => { const s = styleOf(key); return [s.display.family, s.body.family, s.eyebrow.family, s.price.family] }

export { INK, WHITE }
