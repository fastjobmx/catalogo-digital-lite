/** Opciones del motor de diseño publicitario (fase 4 del Estudio Creativo).
 *
 * El panel compone la pieza con estas opciones; el servidor solo valida que sean de la lista cerrada y las
 * guarda en el plan (forman parte de la huella: otro estilo o variante es otra pieza). Los estilos y las
 * composiciones viven en el panel (frontend/src/lib/creative/design/styles.ts); estas claves deben coincidir. */
import { CreativeError } from './brandKit'

export const DESIGN_STYLE_KEYS = [
  'minimalista_premium', 'comercial_moderno', 'oferta_impacto', 'moda_elegante', 'ecommerce_profesional',
] as const
export const DESIGN_LAYOUT_KEYS = ['escenario', 'dividido', 'diagonal', 'editorial', 'tarjeta'] as const

export type DesignStyleKey = typeof DESIGN_STYLE_KEYS[number]
export type DesignLayoutKey = typeof DESIGN_LAYOUT_KEYS[number]
export interface DesignOptions { style: DesignStyleKey; layout: DesignLayoutKey; seed: number; colors: string[] | null; showPrice: boolean; removeBg: boolean; showReference: boolean }

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
  const showPrice = body.showPrice !== false
  // Una oferta sin precio no dice nada verdadero: el precio es obligatorio en esa plantilla.
  if (!showPrice && template === 'oferta_aprobada') throw new CreativeError('PRICE_REQUIRED', 'La plantilla «Oferta aprobada» siempre muestra el precio')
  return { style: body.style as DesignStyleKey, layout: body.layout as DesignLayoutKey, seed, colors, showPrice, removeBg: body.removeBg !== false, showReference: body.showReference === true }
}
