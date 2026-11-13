/** Tipografías del motor de diseño: lista cerrada de Google Fonts con licencia libre (SIL Open Font License),
 * aptas para uso comercial. Cada una declara sus pesos reales para no pedir variantes que no existen. */

export const FONT_LIBRARY: Record<string, { weights: number[]; italic?: number[] }> = {
  Inter: { weights: [400, 500, 600, 700, 800] },
  Poppins: { weights: [400, 500, 600, 700, 800] },
  Montserrat: { weights: [400, 500, 600, 700, 800] },
  'Playfair Display': { weights: [400, 600, 700, 800], italic: [400, 600] },
  'Cormorant Garamond': { weights: [500, 600, 700], italic: [500, 600] },
  Anton: { weights: [400] },
  Oswald: { weights: [400, 500, 600, 700] },
  'Bebas Neue': { weights: [400] },
  'Space Grotesk': { weights: [400, 500, 600, 700] },
  'DM Serif Display': { weights: [400], italic: [400] },
  Fraunces: { weights: [400, 600, 700, 800] },
  Cinzel: { weights: [400, 600, 700, 800] },
  'Archivo Black': { weights: [400] },
  Manrope: { weights: [400, 500, 600, 700, 800] },
  'Bricolage Grotesque': { weights: [400, 600, 700, 800] },
}

/** Peso disponible más cercano al pedido (las fuentes de un solo peso siempre devuelven ese). */
export function nearestWeight(family: string, weight: number): number {
  const weights = FONT_LIBRARY[family]?.weights ?? [400, 700]
  return weights.reduce((best, item) => (Math.abs(item - weight) < Math.abs(best - weight) ? item : best), weights[0]!)
}

/** Declaración CSS de fuente que usan por igual la medición y el pintado. */
export function cssFont(family: string, weight: number, size: number, italic = false): string {
  return `${italic ? 'italic ' : ''}${nearestWeight(family, weight)} ${Math.max(1, Math.round(size * 10) / 10)}px "${family}", Inter, system-ui, sans-serif`
}

/** Dirección de Google Fonts con solo los pesos reales de la familia. */
export function googleFontsUrl(family: string): string | null {
  const spec = FONT_LIBRARY[family]
  if (!spec) return null
  const name = family.replace(/ /g, '+')
  if (!spec.italic?.length) return `https://fonts.googleapis.com/css2?family=${name}:wght@${spec.weights.join(';')}&display=swap`
  const pairs = [...spec.weights.map((w) => `0,${w}`), ...spec.italic.map((w) => `1,${w}`)]
  return `https://fonts.googleapis.com/css2?family=${name}:ital,wght@${pairs.join(';')}&display=swap`
}

/** Carga las familias en el navegador. Devuelve las que quedaron disponibles (las demás caen en Inter). */
export async function ensureFonts(families: string[]): Promise<Set<string>> {
  const ready = new Set<string>()
  if (typeof document === 'undefined') return ready
  await Promise.all([...new Set(families)].map(async (family) => {
    const url = googleFontsUrl(family)
    if (!url) return
    try {
      const id = `creative-font-${family.replace(/ /g, '-')}`
      if (!document.getElementById(id)) {
        const link = document.createElement('link')
        link.id = id
        link.rel = 'stylesheet'
        link.href = url
        document.head.appendChild(link)
        await new Promise<void>((resolve) => { link.onload = () => resolve(); link.onerror = () => resolve(); setTimeout(resolve, 3000) })
      }
      const spec = FONT_LIBRARY[family]!
      await Promise.all([
        ...spec.weights.map((weight) => document.fonts.load(`${weight} 40px "${family}"`)),
        ...(spec.italic ?? []).map((weight) => document.fonts.load(`italic ${weight} 40px "${family}"`)),
      ])
      if (document.fonts.check(`${spec.weights[0]} 40px "${family}"`)) ready.add(family)
    } catch { /* la familia cae en Inter */ }
  }))
  return ready
}
