/** Opciones del motor de diseño publicitario (fase 4 del Estudio Creativo).
 *
 * El panel compone la pieza con estas opciones; el servidor solo valida que sean de la lista cerrada y las
 * guarda en el plan (forman parte de la huella: otro estilo o variante es otra pieza). Los estilos y las
 * composiciones viven en el panel (frontend/src/lib/creative/design/styles.ts); estas claves deben coincidir. */
import { CreativeError } from './brandKit'

export const DESIGN_STYLE_KEYS = [
  'sneaker_impact', 'sport_neon', 'urban_drop', 'editorial_nude', 'luxury_lookbook', 'sale_chic', 'street_collage', 'bold_monochrome', 'hype_drop',
  'warm_decor', 'nordic_living', 'soft_catalog', 'clean_beauty', 'glow_premium', 'skincare_offer',
] as const
export const DESIGN_LAYOUT_KEYS = ['heroe', 'lookbook', 'collage', 'catalogo', 'podio', 'escenario', 'dividido', 'diagonal', 'editorial', 'tarjeta'] as const
export const DESIGN_SECTOR_KEYS = ['calzado', 'moda', 'streetwear', 'hogar', 'belleza'] as const
export const DESIGN_VIDEO_KEYS = ['producto_premium', 'oferta_relampago', 'presentacion_elegante', 'promocion_dinamica', 'producto_tecnologico', 'moda_accesorios', 'belleza_bienestar', 'producto_destacado', 'descuento_especial', 'catalogo_animado'] as const
/** Videos del motor de diseño: cualquier duración entera en este rango (8, 10, 12 y 15 s son las sugeridas). */
export const DESIGN_VIDEO_SECONDS = { min: 6, max: 20 } as const
export const DESIGN_OBJECTIVE_KEYS = ['venta', 'promocion', 'coleccion', 'catalogo', 'aspiracional', 'beneficios', 'lanzamiento'] as const

export type DesignStyleKey = typeof DESIGN_STYLE_KEYS[number]
export type DesignLayoutKey = typeof DESIGN_LAYOUT_KEYS[number]
export interface DesignOptions { sector: typeof DESIGN_SECTOR_KEYS[number]; objective: typeof DESIGN_OBJECTIVE_KEYS[number]; style: DesignStyleKey; layout: DesignLayoutKey; seed: number; colors: string[] | null; showPrice: boolean; removeBg: boolean; showReference: boolean; video?: string }

/** Familia de cada estilo (el sector por defecto cuando el panel no lo envía). */
const STYLE_SECTOR: Record<DesignStyleKey, typeof DESIGN_SECTOR_KEYS[number]> = {
  sneaker_impact: 'calzado', sport_neon: 'calzado', urban_drop: 'calzado', editorial_nude: 'moda', luxury_lookbook: 'moda', sale_chic: 'moda',
  street_collage: 'streetwear', bold_monochrome: 'streetwear', hype_drop: 'streetwear', warm_decor: 'hogar', nordic_living: 'hogar', soft_catalog: 'hogar',
  clean_beauty: 'belleza', glow_premium: 'belleza', skincare_offer: 'belleza',
}

const isHex = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)

/** null = composición clásica (sin motor de diseño). Valores fuera de la lista se rechazan con un mensaje claro. */
export function parseDesign(input: unknown, template: string): DesignOptions | null {
  if (input === undefined || input === null) return null
  if (typeof input !== 'object' || Array.isArray(input)) throw new CreativeError('INVALID_DESIGN', 'Opciones de diseño inválidas')
  const body = input as Record<string, unknown>
  if (!(DESIGN_STYLE_KEYS as readonly string[]).includes(String(body.style))) throw new CreativeError('INVALID_STYLE', 'Elige un estilo válido')
  if (!(DESIGN_LAYOUT_KEYS as readonly string[]).includes(String(body.layout))) throw new CreativeError('INVALID_LAYOUT', 'Elige una composición válida')
  const seed = Number(body.seed ?? 1)
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 99999) throw new CreativeError('INVALID_SEED', 'Variante inválida')
  let colors: string[] | null = null
  if (body.colors !== undefined && body.colors !== null) {
    if (!Array.isArray(body.colors) || body.colors.length > 2 || !body.colors.every(isHex)) throw new CreativeError('INVALID_COLORS', 'Los colores deben ser códigos #RRGGBB (máximo 2)')
    colors = body.colors.length ? body.colors.map((color) => color.toUpperCase()) : null
  }
  const sector = body.sector === undefined ? null : String(body.sector)
  if (sector !== null && !(DESIGN_SECTOR_KEYS as readonly string[]).includes(sector)) throw new CreativeError('INVALID_SECTOR', 'Elige un sector válido')
  const objective = body.objective === undefined ? 'venta' : String(body.objective)
  if (!(DESIGN_OBJECTIVE_KEYS as readonly string[]).includes(objective)) throw new CreativeError('INVALID_OBJECTIVE', 'Elige un objetivo válido')
  const video = body.video === undefined || body.video === null ? null : String(body.video)
  if (video !== null && !(DESIGN_VIDEO_KEYS as readonly string[]).includes(video)) throw new CreativeError('INVALID_VIDEO_TEMPLATE', 'Elige una plantilla de video válida')
  const showPrice = body.showPrice !== false
  // Una oferta sin precio no dice nada verdadero: el precio es obligatorio en esa plantilla.
  if (!showPrice && template === 'oferta_aprobada') throw new CreativeError('PRICE_REQUIRED', 'La plantilla «Oferta aprobada» siempre muestra el precio')
  return { sector: (sector ?? STYLE_SECTOR[body.style as DesignStyleKey]) as DesignOptions['sector'], objective: objective as DesignOptions['objective'], style: body.style as DesignStyleKey, layout: body.layout as DesignLayoutKey, seed, colors, showPrice, removeBg: body.removeBg !== false, showReference: body.showReference === true, ...(video ? { video } : {}) }
}
