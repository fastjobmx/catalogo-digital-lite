/** Composition traits of each visual family. Colors come from the store tokens;
 * these traits change structure: header, hero, product cards and image framing. */

export type HeaderLayout = 'standard' | 'centered' | 'compact'
export type HeroLayout = 'split' | 'split-reverse' | 'overlay' | 'centered' | 'editorial'
export type CardLayout = 'classic' | 'minimal' | 'centered' | 'boxed' | 'overlay'
export type CardRatio = '1:1' | '4:5' | '4:3'

export interface TemplateLayout {
  header: HeaderLayout
  hero: HeroLayout
  card: CardLayout
  ratio: CardRatio
  upperTitles: boolean
}

export const TEMPLATE_LAYOUTS: Record<string, TemplateLayout> = {
  minimalista: { header: 'standard', hero: 'centered', card: 'minimal', ratio: '1:1', upperTitles: false },
  moderno: { header: 'standard', hero: 'split', card: 'boxed', ratio: '4:5', upperTitles: false },
  premium: { header: 'standard', hero: 'split-reverse', card: 'classic', ratio: '4:5', upperTitles: false },
  personalizado: { header: 'standard', hero: 'split', card: 'classic', ratio: '4:5', upperTitles: false },
  luxury: { header: 'centered', hero: 'overlay', card: 'centered', ratio: '4:5', upperTitles: true },
  urban: { header: 'compact', hero: 'overlay', card: 'overlay', ratio: '1:1', upperTitles: true },
  boutique: { header: 'centered', hero: 'centered', card: 'centered', ratio: '4:5', upperTitles: false },
  natural: { header: 'standard', hero: 'centered', card: 'boxed', ratio: '4:5', upperTitles: false },
  tech: { header: 'compact', hero: 'split', card: 'boxed', ratio: '1:1', upperTitles: false },
  playful: { header: 'standard', hero: 'centered', card: 'boxed', ratio: '1:1', upperTitles: false },
  gourmet: { header: 'centered', hero: 'overlay', card: 'centered', ratio: '4:3', upperTitles: false },
  artesanal: { header: 'standard', hero: 'split-reverse', card: 'boxed', ratio: '1:1', upperTitles: false },
  editorial: { header: 'centered', hero: 'editorial', card: 'minimal', ratio: '4:5', upperTitles: true },
  // The home page becomes a vertical feed (StoriesFeed); category and search pages keep a compact grid.
  stories: { header: 'compact', hero: 'overlay', card: 'overlay', ratio: '4:5', upperTitles: false },
}

export function templateLayout(template: string | undefined): TemplateLayout {
  return TEMPLATE_LAYOUTS[template || ''] || TEMPLATE_LAYOUTS.personalizado!
}
