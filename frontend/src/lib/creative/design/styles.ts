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
  tecnologia_futurista: {
    label: 'Tecnología futurista', mood: 'Innovación, precisión, potencia', description: 'Fondo nocturno con cuadrícula, luz de neón detrás del producto y tipografía técnica.',
    display: { family: 'Space Grotesk', weight: 700, letterSpacing: -0.01 }, body: { family: 'Inter', weight: 500 }, eyebrow: { family: 'Space Grotesk', weight: 600, letterSpacing: 0.24 },
    price: { family: 'Space Grotesk', weight: 700, shape: 'tag' }, radius: 1.4, shadow: 'marcada', reflection: 0.16, decor: ['grid', 'sparkles'], background: 'radial', texture: 'grid',
    layouts: ['escenario', 'diagonal', 'tarjeta', 'dividido', 'editorial'],
    palette: (input) => {
      const base = brandOr(input, 0, '#22D3EE')
      const [h, s] = hsl(base)
      // Neón: el tono de la marca muy saturado y luminoso; si la marca es gris, cian.
      const neon = s < 0.3 ? '#22D3EE' : hslToHex(h, Math.max(0.8, s), 0.58)
      const bg = hslToHex(s < 0.3 ? 222 : h + 200, 0.45, 0.07)
      return finish({ bg, bg2: hslToHex(hsl(bg)[0], 0.5, 0.03), surface: hslToHex(hsl(bg)[0], 0.35, 0.13), panel: hslToHex(hsl(bg)[0], 0.4, 0.12), ink: '#F1F5F9', muted: '#9FB0C8', price: neon, accent: neon, highlight: neon, line: 'rgba(148,163,184,0.18)', glow: hslToHex(hsl(neon)[0], 0.7, 0.24) })
    },
  },
  deportivo_dinamico: {
    label: 'Deportivo dinámico', mood: 'Energía, movimiento, rendimiento', description: 'Letras gruesas en mayúsculas, franjas inclinadas y contraste fuerte.',
    display: { family: 'Archivo Black', weight: 400, uppercase: true, letterSpacing: -0.01 }, body: { family: 'Inter', weight: 700 }, eyebrow: { family: 'Inter', weight: 800, letterSpacing: 0.18 },
    price: { family: 'Archivo Black', weight: 400, shape: 'tag' }, radius: 0.6, shadow: 'marcada', reflection: 0, decor: ['stripes'], background: 'lineal', texture: 'lines',
    layouts: ['diagonal', 'dividido', 'escenario', 'editorial', 'tarjeta'],
    palette: (input) => {
      const base = brandOr(input, 0, '#F97316')
      const [h, s, l] = hsl(base)
      const strong = s < 0.35 ? '#F97316' : hslToHex(h, Math.max(0.75, s), Math.min(0.55, Math.max(0.42, l)))
      return finish({ bg: '#0E0E10', bg2: '#1C1C21', surface: '#1F1F24', panel: strong, ink: '#FFFFFF', muted: '#B5B5BE', price: strong, accent: strong, highlight: strong, line: 'rgba(255,255,255,0.10)', glow: '#2A2A31' })
    },
  },
  belleza_cosmetica: {
    label: 'Belleza y cosmética', mood: 'Suavidad, cuidado, bienestar', description: 'Tonos pastel tomados de tu marca, formas orgánicas, brillo y serifa delicada.',
    display: { family: 'DM Serif Display', weight: 400 }, body: { family: 'Manrope', weight: 500 }, eyebrow: { family: 'Manrope', weight: 700, letterSpacing: 0.22 },
    price: { family: 'Manrope', weight: 800, shape: 'pill' }, radius: 4, shadow: 'suave', reflection: 0.14, decor: ['blobs', 'sparkles'], background: 'radial', texture: 'none',
    layouts: ['escenario', 'tarjeta', 'editorial', 'dividido', 'diagonal'],
    palette: (input) => {
      const base = brandOr(input, 0, '#E8A0B4')
      const [h] = hsl(base)
      const hue = hsl(base)[1] < 0.15 ? 340 : h
      return finish({ bg: hslToHex(hue, 0.55, 0.95), bg2: hslToHex(hue + 15, 0.5, 0.88), surface: '#FFFFFF', panel: hslToHex(hue, 0.45, 0.86), ink: hslToHex(hue, 0.35, 0.18), muted: hslToHex(hue, 0.18, 0.4), price: hslToHex(hue, 0.5, 0.3), accent: hslToHex(hue, 0.45, 0.34), highlight: hslToHex(hue, 0.6, 0.78), line: hslToHex(hue, 0.4, 0.8), glow: '#FFFFFF' })
    },
  },
  hogar_decoracion: {
    label: 'Hogar y decoración', mood: 'Calidez, confort, hogar', description: 'Tonos tierra tomados de tu foto, textura de papel, arcos y serifa cálida.',
    display: { family: 'Fraunces', weight: 600 }, body: { family: 'Manrope', weight: 500 }, eyebrow: { family: 'Manrope', weight: 700, letterSpacing: 0.2 },
    price: { family: 'Fraunces', weight: 700, shape: 'underline' }, radius: 2.4, shadow: 'suave', reflection: 0, decor: ['arcs', 'rules'], background: 'lineal', texture: 'noise',
    layouts: ['dividido', 'editorial', 'tarjeta', 'escenario', 'diagonal'],
    palette: (input) => {
      const source = input.override?.find(isHex) ?? input.photo.find((color) => hsl(color)[1] > 0.12 && hsl(color)[2] > 0.15 && hsl(color)[2] < 0.85) ?? '#B7795A'
      // Tono cálido: se acerca el tono de la foto hacia la gama tierra (naranjas y ocres).
      const [h0] = hsl(source)
      const h = h0 > 60 && h0 < 300 ? 28 + (h0 > 180 ? 0 : (h0 - 60) * 0.3) : h0
      return finish({ bg: hslToHex(h, 0.3, 0.92), bg2: hslToHex(h, 0.28, 0.86), surface: hslToHex(h, 0.35, 0.97), panel: hslToHex(h, 0.32, 0.8), ink: hslToHex(h, 0.3, 0.14), muted: hslToHex(h, 0.18, 0.36), price: hslToHex(h, 0.55, 0.3), accent: hslToHex(h, 0.45, 0.3), highlight: hslToHex(h + 120, 0.22, 0.4), line: hslToHex(h, 0.25, 0.62), glow: hslToHex(h, 0.5, 0.97) })
    },
  },
  lujo_negro_dorado: {
    label: 'Lujo negro y dorado', mood: 'Exclusividad, prestigio, valor', description: 'Negro profundo, dorado, letras clásicas espaciadas y marco fino.',
    display: { family: 'Cinzel', weight: 600, uppercase: true, letterSpacing: 0.06 }, body: { family: 'Montserrat', weight: 500 }, eyebrow: { family: 'Montserrat', weight: 600, letterSpacing: 0.32 },
    price: { family: 'Cinzel', weight: 700, shape: 'plain' }, radius: 0, shadow: 'marcada', reflection: 0.18, decor: ['frame', 'rules'], background: 'radial', texture: 'none',
    layouts: ['editorial', 'escenario', 'tarjeta', 'dividido', 'diagonal'],
    palette: () => finish({ bg: '#0B0A08', bg2: '#050504', surface: '#16130E', panel: '#1A1711', ink: '#F4E9CF', muted: '#BBA87F', price: '#D4AF5A', accent: '#C9A24B', onAccent: '#0B0A08', highlight: '#C9A24B', onHighlight: '#0B0A08', line: '#8C7038', glow: '#2A2316' }),
  },
  blanco_minimalista: {
    label: 'Blanco minimalista', mood: 'Pureza, sencillez, foco', description: 'Todo blanco y negro: el producto y su precio, nada más.',
    display: { family: 'Manrope', weight: 700, letterSpacing: -0.02 }, body: { family: 'Manrope', weight: 400 }, eyebrow: { family: 'Manrope', weight: 600, letterSpacing: 0.26 },
    price: { family: 'Manrope', weight: 600, shape: 'plain' }, radius: 0.4, shadow: 'suave', reflection: 0, decor: [], background: 'liso', texture: 'none',
    layouts: ['escenario', 'editorial', 'tarjeta', 'dividido', 'diagonal'],
    palette: () => finish({ bg: '#FFFFFF', bg2: '#F6F6F6', surface: '#FFFFFF', panel: '#F4F4F4', ink: '#0A0A0A', muted: '#5F5F5F', price: '#0A0A0A', accent: '#0A0A0A', highlight: '#0A0A0A', line: '#E2E2E2', glow: '#FFFFFF' }),
  },
  colores_vibrantes: {
    label: 'Colores vibrantes', mood: 'Alegría, juventud, diversión', description: 'Degradados intensos con tu color y su complementario, formas y tipografía expresiva.',
    display: { family: 'Bricolage Grotesque', weight: 800, letterSpacing: -0.02 }, body: { family: 'Poppins', weight: 500 }, eyebrow: { family: 'Poppins', weight: 700, letterSpacing: 0.14 },
    price: { family: 'Bricolage Grotesque', weight: 800, shape: 'pill' }, radius: 4, shadow: 'suave', reflection: 0, decor: ['blobs', 'circles', 'dots'], background: 'lineal', texture: 'none',
    layouts: ['tarjeta', 'escenario', 'diagonal', 'dividido', 'editorial'],
    palette: (input) => {
      const base = brandOr(input, 0, '#7C3AED')
      const [h0, s0] = hsl(base)
      const h = s0 < 0.25 ? 265 : h0
      const bg = hslToHex(h, 0.85, 0.55)
      return finish({ bg, bg2: hslToHex(h + 45, 0.9, 0.55), surface: '#FFFFFF', panel: hslToHex(h + 180, 0.85, 0.6), ink: bestOn(bg), muted: bestOn(bg), price: bestOn(bg), accent: '#111111', onAccent: '#FFFFFF', highlight: hslToHex(h + 180, 0.95, 0.62), line: 'rgba(255,255,255,0.22)', glow: hslToHex(h + 20, 0.95, 0.75) })
    },
  },
  editorial_revista: {
    label: 'Editorial de revista', mood: 'Autoridad, estilo, curaduría', description: 'Papel, titular de portada en serifa negra, filetes y un acento rojo.',
    display: { family: 'Playfair Display', weight: 800, letterSpacing: -0.01 }, body: { family: 'Inter', weight: 400 }, eyebrow: { family: 'Inter', weight: 700, letterSpacing: 0.28 },
    price: { family: 'Inter', weight: 700, shape: 'plain' }, radius: 0, shadow: 'suave', reflection: 0, decor: ['rules'], background: 'liso', texture: 'noise',
    layouts: ['editorial', 'dividido', 'escenario', 'tarjeta', 'diagonal'],
    palette: (input) => {
      const accent = input.override?.find(isHex) ?? '#B91C1C'
      return finish({ bg: '#F3EFE6', bg2: '#E8E2D5', surface: '#FBF9F4', panel: '#E5DECF', ink: '#111111', muted: '#55524C', price: '#111111', accent, highlight: accent, line: '#1C1C1C', glow: '#FBF9F4' })
    },
  },
  liquidacion_descuentos: {
    label: 'Liquidación y descuentos', mood: 'Ahorro, urgencia, oportunidad', description: 'Amarillo y negro de alto contraste, sello rojo para el precio y franjas de aviso.',
    display: { family: 'Archivo Black', weight: 400, uppercase: true }, body: { family: 'Inter', weight: 800 }, eyebrow: { family: 'Inter', weight: 800, letterSpacing: 0.16 },
    price: { family: 'Archivo Black', weight: 400, shape: 'burst' }, radius: 0.8, shadow: 'marcada', reflection: 0, decor: ['stripes'], background: 'liso', texture: 'none',
    layouts: ['diagonal', 'tarjeta', 'escenario', 'dividido', 'editorial'],
    // Solo la estética de liquidación: el estilo nunca escribe «liquidación» ni descuentos que el catálogo no tenga.
    palette: (input) => {
      const red = input.override?.find(isHex) ?? '#DC2626'
      return finish({ bg: '#FACC15', bg2: '#EAB308', surface: '#FFFFFF', panel: '#111111', ink: '#111111', muted: '#3F3A1E', price: '#111111', accent: '#111111', onAccent: '#FACC15', highlight: red, line: 'rgba(17,17,17,0.85)', glow: '#FDE68A' })
    },
  },
  lanzamiento_producto: {
    label: 'Lanzamiento de producto', mood: 'Expectativa, novedad, protagonismo', description: 'Escenario oscuro con foco de luz sobre el producto, reflejo y letras de cartelera.',
    display: { family: 'Bebas Neue', weight: 400, uppercase: true, letterSpacing: 0.02 }, body: { family: 'Inter', weight: 500 }, eyebrow: { family: 'Inter', weight: 700, letterSpacing: 0.34 },
    price: { family: 'Bebas Neue', weight: 400, shape: 'tag' }, radius: 1, shadow: 'marcada', reflection: 0.2, decor: ['arcs', 'sparkles'], background: 'radial', texture: 'none',
    layouts: ['escenario', 'editorial', 'diagonal', 'tarjeta', 'dividido'],
    palette: (input) => {
      const base = brandOr(input, 0, '#6366F1')
      const [h0, s0] = hsl(base)
      const h = s0 < 0.25 ? 230 : h0
      const bright = hslToHex(h, Math.max(0.75, s0), 0.6)
      return finish({ bg: hslToHex(h, 0.4, 0.08), bg2: '#030304', surface: hslToHex(h, 0.3, 0.13), panel: hslToHex(h, 0.45, 0.16), ink: '#FFFFFF', muted: '#B9BCCB', price: bright, accent: bright, highlight: bright, line: 'rgba(255,255,255,0.16)', glow: hslToHex(h, 0.45, 0.32) })
    },
  },
} as const satisfies Record<string, DesignStyleDef>

export type StyleKey = keyof typeof DESIGN_STYLES
/** Orden de la galería (el de la biblioteca acordada). */
export const STYLE_KEYS: StyleKey[] = [
  'minimalista_premium', 'comercial_moderno', 'oferta_impacto', 'tecnologia_futurista', 'moda_elegante', 'deportivo_dinamico', 'belleza_cosmetica', 'hogar_decoracion',
  'lujo_negro_dorado', 'blanco_minimalista', 'colores_vibrantes', 'editorial_revista', 'ecommerce_profesional', 'liquidacion_descuentos', 'lanzamiento_producto',
]
export const isStyle = (value: unknown): value is StyleKey => typeof value === 'string' && Object.hasOwn(DESIGN_STYLES, value)
export const isLayout = (value: unknown): value is LayoutKey => typeof value === 'string' && Object.hasOwn(LAYOUTS, value)

export function styleOf(key: string): DesignStyleDef {
  return (DESIGN_STYLES as Record<string, DesignStyleDef>)[key] ?? DESIGN_STYLES.ecommerce_profesional
}

/** Familias que necesita un estilo (para cargarlas antes de medir y pintar). */
export const styleFonts = (key: string) => { const s = styleOf(key); return [s.display.family, s.body.family, s.eyebrow.family, s.price.family] }

export { INK, WHITE }
