// ============================================
// Configuración de apariencia (tema) de la tienda
// ============================================
// Se persiste en D1 como JSON en la columna store_config.theme_config.
// Todo lo que el comerciante puede personalizar desde /admin/apariencia vive aquí.
//
// Regla de oro: este archivo describe PRESENTACIÓN. Nunca productos, precios,
// stock ni datos comerciales. Aplicar un preset no puede borrar catálogo.

export type RadiusScale = 'square' | 'soft' | 'round' | 'pill'
export type DensityScale = 'compact' | 'normal' | 'spacious'
export type HeroAlign = 'left' | 'center' | 'right'
export type HeroHeight = 'compact' | 'standard' | 'tall'
export type ButtonStyle = 'solid' | 'outline' | 'soft'
export type CardStyle = 'elevated' | 'bordered' | 'flat'
export type TypeScale = 'compact' | 'normal' | 'large'
export type HeadingWeight = 'semibold' | 'bold' | 'extrabold'

export type SectionKey =
  | 'hero'
  | 'categories'
  | 'featured'
  | 'promo'
  | 'offers'
  | 'newest'
  | 'benefits'
  | 'contact'
  | 'testimonials'
  | 'cta'

/**
 * Paleta completa de la tienda. Es la única fuente de verdad del color:
 * el storefront consume estas variables CSS y el panel las edita.
 */
export interface PaletteConfig {
  /** Fondo general de la página. */
  background: string
  /** Superficie de tarjetas, header y paneles. */
  surface: string
  /** Texto principal. */
  text: string
  /** Texto secundario y metadatos. */
  textMuted: string
  /** Líneas, separadores y bordes. */
  border: string
  /** Color de marca principal (enlaces, selección, foco). */
  primary: string
  /** Color secundario (etiquetas suaves, bloques). */
  secondary: string
  /** Acento editorial (detalles, eyebrows). */
  accent: string
  /** Fondo de los botones principales. */
  button: string
  /** Texto sobre los botones principales. */
  buttonText: string
}

export interface TypographyConfig {
  /** Fuente de interfaz y textos. */
  fontPrimary: string
  /** Fuente de títulos y display. */
  fontDisplay: string
  /** Tamaño base relativo de toda la tienda. */
  scale: TypeScale
  /** Peso de los títulos. */
  headingWeight: HeadingWeight
}

export interface HeaderConfig {
  /** Muestra la barra informativa superior. */
  topbarEnabled: boolean
  /** Texto de la barra informativa (envíos, temporada, etc.). */
  topbarText: string
  /** Muestra el acceso directo a WhatsApp / teléfono. */
  showContact: boolean
  /** Mantiene el header fijo al hacer scroll. */
  sticky: boolean
}

export interface HeroConfig {
  enabled: boolean
  eyebrow: string
  title: string
  subtitle: string
  description: string
  ctaPrimaryLabel: string
  ctaPrimaryHref: string
  ctaSecondaryEnabled: boolean
  ctaSecondaryLabel: string
  ctaSecondaryHref: string
  /** Fotografía principal (desktop). */
  imageUrl: string | null
  /** Fotografía opcional para móvil. Si falta se usa la de desktop. */
  imageUrlMobile: string | null
  align: HeroAlign
  height: HeroHeight
  /** Oscurecimiento del fondo, 0–90. */
  overlayOpacity: number
}

export interface PromoBannerConfig {
  enabled: boolean
  eyebrow: string
  title: string
  text: string
  ctaLabel: string
  ctaHref: string
  imageUrl: string | null
}

export interface ClosingCtaConfig {
  eyebrow: string
  title: string
  description: string
  primaryLabel: string
}

export interface SectionConfig {
  order: SectionKey[]
  enabled: Record<SectionKey, boolean>
  featuredLimit: number
}

export interface StyleConfig {
  palette: PaletteConfig
  typography: TypographyConfig
  radius: RadiusScale
  density: DensityScale
  buttonStyle: ButtonStyle
  cardStyle: CardStyle
  darkMode: boolean
}

export interface BenefitItem {
  icon: string
  title: string
  text: string
}

export interface TestimonialItem {
  name: string
  location: string
  rating: number
  text: string
}

export interface FooterConfig {
  aboutText: string
  showPolicies: boolean
  policiesTitle: string
  policies: string
  copyright: string
}

export interface ThemeConfig {
  /** Family selected by the merchant. Controls composition as well as tokens. */
  template?: string
  style: StyleConfig
  header: HeaderConfig
  hero: HeroConfig
  sections: SectionConfig
  promo: PromoBannerConfig
  cta: ClosingCtaConfig
  featuredSkus: string[]
  featuredSelectionEnabled: boolean
  featuredCategorySlugs: string[]
  categorySelectionEnabled: boolean
  categoryImages: Record<string, string>
  benefits: BenefitItem[]
  testimonials: TestimonialItem[]
  footer: FooterConfig
}

export const SECTION_LABELS: Record<SectionKey, string> = {
  hero: 'Portada (hero)',
  categories: 'Categorías visuales',
  featured: 'Colección destacada',
  promo: 'Banner editorial',
  offers: 'Ofertas',
  newest: 'Nuevos lanzamientos',
  benefits: 'Beneficios comerciales',
  contact: 'Contacto y WhatsApp',
  testimonials: 'Testimonios (solo reales)',
  cta: 'Cierre editorial',
}

export const FONT_OPTIONS = [
  { label: 'Inter (interfaz neutra)', value: 'Inter' },
  { label: 'Manrope (editorial moderna)', value: 'Manrope' },
  { label: 'DM Sans (limpia y cálida)', value: 'DM Sans' },
  { label: 'Space Grotesk (técnica)', value: 'Space Grotesk' },
  { label: 'Sora (geométrica)', value: 'Sora' },
  { label: 'Playfair Display (serif editorial)', value: 'Playfair Display' },
]

/** Familias seguras: todas se cargan desde Google Fonts y tienen licencia abierta. */
export const SAFE_FONTS = FONT_OPTIONS.map((f) => f.value)

export interface ThemePreset {
  id: string
  template: string
  name: string
  description: string
  palette: PaletteConfig
  typography: TypographyConfig
  radius: RadiusScale
  buttonStyle: ButtonStyle
  cardStyle: CardStyle
  darkMode: boolean
}

const PALETTE_STREETWEAR: PaletteConfig = {
  background: '#F7F6F2',
  surface: '#FFFFFF',
  text: '#171717',
  textMuted: '#717171',
  border: '#E5E3DE',
  primary: '#222222',
  secondary: '#D9D0C1',
  accent: '#8D806D',
  button: '#222222',
  buttonText: '#F7F6F2',
}

const PALETTE_BOUTIQUE: PaletteConfig = {
  background: '#FAF6F0',
  surface: '#FFFFFF',
  text: '#211C17',
  textMuted: '#7A6E62',
  border: '#E8DDCE',
  primary: '#6E4B36',
  secondary: '#E7D7C9',
  accent: '#9A6B4F',
  button: '#2B211A',
  buttonText: '#FBF7F2',
}

const PALETTE_TECH: PaletteConfig = {
  background: '#F4F5F7',
  surface: '#FFFFFF',
  text: '#14181F',
  textMuted: '#64707F',
  border: '#DFE3E8',
  primary: '#1B63D8',
  secondary: '#DCE7F7',
  accent: '#3F6C8F',
  button: '#14181F',
  buttonText: '#F7F9FC',
}

// Each family changes composition, typography, density and card treatment.
export const THEME_PRESETS: ThemePreset[] = [
  { id: 'minimalista', template: 'minimalista', name: 'Minimalista', description: 'Mucho aire, titulares centrados y tarjetas precisas.', palette: { ...PALETTE_STREETWEAR, primary: '#30343B', button: '#30343B', accent: '#707782' }, typography: { fontPrimary: 'Inter', fontDisplay: 'Inter', scale: 'normal', headingWeight: 'semibold' }, radius: 'soft', buttonStyle: 'outline', cardStyle: 'bordered', darkMode: false },
  { id: 'moderno', template: 'moderno', name: 'Moderno', description: 'Bloques vivos, botones sólidos y jerarquía geométrica.', palette: PALETTE_TECH, typography: { fontPrimary: 'Space Grotesk', fontDisplay: 'Sora', scale: 'normal', headingWeight: 'bold' }, radius: 'round', buttonStyle: 'solid', cardStyle: 'elevated', darkMode: false },
  { id: 'premium', template: 'premium', name: 'Premium', description: 'Fotografía protagonista y tonos neutros cálidos.', palette: PALETTE_STREETWEAR, typography: { fontPrimary: 'DM Sans', fontDisplay: 'Playfair Display', scale: 'normal', headingWeight: 'semibold' }, radius: 'soft', buttonStyle: 'solid', cardStyle: 'flat', darkMode: false },
  { id: 'personalizado', template: 'personalizado', name: 'Personalizado', description: 'Base flexible para ajustar cada detalle de marca.', palette: PALETTE_TECH, typography: { fontPrimary: 'Inter', fontDisplay: 'Manrope', scale: 'normal', headingWeight: 'bold' }, radius: 'soft', buttonStyle: 'solid', cardStyle: 'elevated', darkMode: false },
  { id: 'luxury', template: 'luxury', name: 'Luxury', description: 'Fondo oscuro, detalles dorados y composición serena.', palette: { background: '#151311', surface: '#211E1A', text: '#F7F2E8', textMuted: '#B8AA96', border: '#40382D', primary: '#C4A36A', secondary: '#32291E', accent: '#E2C98F', button: '#C4A36A', buttonText: '#17130D' }, typography: { fontPrimary: 'DM Sans', fontDisplay: 'Playfair Display', scale: 'large', headingWeight: 'semibold' }, radius: 'square', buttonStyle: 'outline', cardStyle: 'flat', darkMode: true },
  { id: 'urban', template: 'urban', name: 'Urban', description: 'Contraste alto, grilla compacta y acento enérgico.', palette: { background: '#111317', surface: '#1B1E24', text: '#F7F8FA', textMuted: '#A5ABB5', border: '#343942', primary: '#F04F36', secondary: '#2A2D34', accent: '#FFB547', button: '#D73F28', buttonText: '#FFFFFF' }, typography: { fontPrimary: 'Space Grotesk', fontDisplay: 'Space Grotesk', scale: 'normal', headingWeight: 'extrabold' }, radius: 'square', buttonStyle: 'solid', cardStyle: 'flat', darkMode: true },
  { id: 'boutique', template: 'boutique', name: 'Boutique', description: 'Portada centrada, serif delicada y tonos rosa tierra.', palette: { ...PALETTE_BOUTIQUE, primary: '#763B4C', button: '#763B4C', accent: '#A96D73' }, typography: { fontPrimary: 'DM Sans', fontDisplay: 'Playfair Display', scale: 'large', headingWeight: 'semibold' }, radius: 'round', buttonStyle: 'soft', cardStyle: 'bordered', darkMode: false },
  { id: 'natural', template: 'natural', name: 'Natural', description: 'Verdes botánicos, superficies suaves y ritmo amplio.', palette: { background: '#F4F5EE', surface: '#FFFFFF', text: '#202B22', textMuted: '#647063', border: '#DDE2D6', primary: '#365C42', secondary: '#DFE8D9', accent: '#8A6B3E', button: '#365C42', buttonText: '#FFFFFF' }, typography: { fontPrimary: 'Inter', fontDisplay: 'Manrope', scale: 'normal', headingWeight: 'semibold' }, radius: 'round', buttonStyle: 'soft', cardStyle: 'elevated', darkMode: false },
  { id: 'tech', template: 'tech', name: 'Tech', description: 'Paneles oscuros, líneas frías y navegación compacta.', palette: { background: '#0F1724', surface: '#172437', text: '#F2F7FF', textMuted: '#A3B5CB', border: '#2A3C53', primary: '#53B9E8', secondary: '#1D3850', accent: '#9A83FF', button: '#176B96', buttonText: '#FFFFFF' }, typography: { fontPrimary: 'Space Grotesk', fontDisplay: 'Sora', scale: 'compact', headingWeight: 'bold' }, radius: 'soft', buttonStyle: 'solid', cardStyle: 'bordered', darkMode: true },
  { id: 'playful', template: 'playful', name: 'Playful', description: 'Formas redondas, color alegre y titulares grandes.', palette: { background: '#FFF8EF', surface: '#FFFFFF', text: '#30212E', textMuted: '#786777', border: '#F0DFD5', primary: '#873261', secondary: '#F6DDEB', accent: '#A94D24', button: '#873261', buttonText: '#FFFFFF' }, typography: { fontPrimary: 'Manrope', fontDisplay: 'Sora', scale: 'large', headingWeight: 'extrabold' }, radius: 'pill', buttonStyle: 'solid', cardStyle: 'elevated', darkMode: false },
  { id: 'gourmet', template: 'gourmet', name: 'Gourmet', description: 'Titulares centrados, tonos cacao y acentos de especias.', palette: { background: '#F8F3EC', surface: '#FFFDF9', text: '#302017', textMuted: '#76675B', border: '#E9DDCE', primary: '#713B26', secondary: '#EFE2D1', accent: '#A7782B', button: '#713B26', buttonText: '#FFFFFF' }, typography: { fontPrimary: 'DM Sans', fontDisplay: 'Playfair Display', scale: 'normal', headingWeight: 'semibold' }, radius: 'soft', buttonStyle: 'solid', cardStyle: 'bordered', darkMode: false },
  { id: 'artesanal', template: 'artesanal', name: 'Artesanal', description: 'Textura cálida, serif hecha a mano y bordes orgánicos.', palette: { background: '#F7F1E5', surface: '#FFFDF7', text: '#352C20', textMuted: '#766A56', border: '#E5D9C4', primary: '#5D4930', secondary: '#E9DCC4', accent: '#8B5436', button: '#5D4930', buttonText: '#FFFFFF' }, typography: { fontPrimary: 'Inter', fontDisplay: 'Playfair Display', scale: 'normal', headingWeight: 'semibold' }, radius: 'round', buttonStyle: 'outline', cardStyle: 'bordered', darkMode: false },
  { id: 'editorial', template: 'editorial', name: 'Editorial', description: 'Titular de revista, grilla asimétrica y mucho espacio.', palette: { background: '#F4F2ED', surface: '#FFFFFF', text: '#181818', textMuted: '#6C6A66', border: '#DAD7CF', primary: '#262626', secondary: '#E4E0D8', accent: '#963F31', button: '#262626', buttonText: '#FFFFFF' }, typography: { fontPrimary: 'Inter', fontDisplay: 'Playfair Display', scale: 'large', headingWeight: 'bold' }, radius: 'square', buttonStyle: 'outline', cardStyle: 'flat', darkMode: false },
  { id: 'stories', template: 'stories', name: 'Stories', description: 'Vertical a pantalla completa: un producto por pantalla y se desliza hacia arriba, ideal para celulares.', palette: { background: '#0C0C0E', surface: '#18181C', text: '#FFFFFF', textMuted: '#B4B4BE', border: '#2C2C33', primary: '#FF5C82', secondary: '#26262D', accent: '#FFC24B', button: '#FF5C82', buttonText: '#16080D' }, typography: { fontPrimary: 'Manrope', fontDisplay: 'Sora', scale: 'normal', headingWeight: 'extrabold' }, radius: 'round', buttonStyle: 'solid', cardStyle: 'flat', darkMode: true },
]

/** Ready-to-use palettes (one per template), previewable independently from the template. */
export const BRAND_PALETTES = THEME_PRESETS
  .filter((preset) => preset.template !== 'personalizado')
  .map((preset) => ({ id: preset.template, name: preset.name, palette: preset.palette }))

export const DEFAULT_THEME: ThemeConfig = {
  template: 'personalizado',
  style: {
    palette: PALETTE_STREETWEAR,
    typography: { fontPrimary: 'Inter', fontDisplay: 'Manrope', scale: 'normal', headingWeight: 'bold' },
    radius: 'square',
    density: 'normal',
    buttonStyle: 'solid',
    cardStyle: 'flat',
    darkMode: false,
  },
  header: {
    topbarEnabled: true,
    topbarText: 'Envío a todo el país · Cambios gratis en 30 días',
    showContact: true,
    sticky: true,
  },
  hero: {
    enabled: true,
    eyebrow: 'TEMPORADA 2026 — SELECCIÓN EDITORIAL',
    title: 'El par que define\n tu próximo paso',
    subtitle: '',
    description: 'Sneakers y streetwear elegidos uno a uno. Materiales nobles, siluetas limpias y envíos a todo el país.',
    ctaPrimaryLabel: 'Explorar catálogo',
    ctaPrimaryHref: '/category/all',
    ctaSecondaryEnabled: true,
    ctaSecondaryLabel: 'Ver nuevos lanzamientos',
    ctaSecondaryHref: '/category/all?sort=newest',
    imageUrl: '/seed-images/sneakerhub/TERA-16.jpg',
    imageUrlMobile: null,
    align: 'left',
    height: 'tall',
    overlayOpacity: 52,
  },
  sections: {
    order: ['hero', 'categories', 'featured', 'promo', 'newest', 'offers', 'benefits', 'contact', 'cta'],
    enabled: {
      hero: true,
      categories: true,
      featured: true,
      promo: true,
      offers: true,
      newest: true,
      benefits: true,
      contact: true,
      // Sin reseñas verificadas por defecto: nunca inventamos testimonios.
      testimonials: false,
      cta: true,
    },
    featuredLimit: 8,
  },
  promo: {
    enabled: true,
    eyebrow: 'COLECCIÓN OUTDOOR',
    title: 'Fuera de ruta',
    text: 'Cuero hidrofugado, suela de agarre profundo y un soporte de tobillo que se agradece en el descenso.',
    ctaLabel: 'Ver outdoor',
    ctaHref: '/category/outdoor',
    imageUrl: '/seed-images/sneakerhub/TERA-15.jpg',
  },
  cta: {
    eyebrow: 'Cierre',
    title: 'Encuentra el par\nque te acompaña.',
    description: 'Explora la selección completa o escríbenos: te asesoramos con tallas, disponibilidad y envío. El pedido se confirma en la conversación de WhatsApp.',
    primaryLabel: 'Explorar catálogo',
  },
  featuredSkus: [],
  featuredSelectionEnabled: false,
  featuredCategorySlugs: [],
  categorySelectionEnabled: false,
  categoryImages: {},
  benefits: [
    { icon: 'truck', title: 'Envío nacional', text: 'Despacho en 24 h y entrega en 2 a 4 días hábiles.' },
    { icon: 'refresh', title: 'Cambios sin fricción', text: '30 días para cambiar la talla, sin preguntas.' },
    { icon: 'shield', title: 'Compra protegida', text: 'Cada par se revisa antes de salir del almacén.' },
    { icon: 'message-circle', title: 'Asesoría real', text: 'Te ayudamos a elegir talla y modelo por WhatsApp.' },
  ],
  // Vacío a propósito: la sección permanece oculta hasta que el comerciante
  // cargue reseñas reales. No publicamos testimonios inventados.
  testimonials: [],
  footer: {
    aboutText: 'SneakerHub Premium selecciona sneakers, streetwear y accesorios para quienes no negocian comodidad ni estilo.',
    showPolicies: true,
    policiesTitle: 'Envíos y cambios',
    policies: 'Envíos a todo el país con guía de seguimiento. Cambios y devoluciones dentro de los 30 días posteriores a la compra presentando el número de pedido.',
    copyright: 'Todos los derechos reservados.',
  },
}

// ------------------------------------------------------------------
// Migración tolerante: acepta configuraciones antiguas sin perderlas.
// ------------------------------------------------------------------

export interface ThemeFallbacks {
  primary?: string
  secondary?: string
  accent?: string
  button?: string
}

type LegacyStyle = Partial<StyleConfig> & {
  canvas?: string
  surface?: string
  ink?: string
  fontPrimary?: string
}

function mergePalette(partial: Partial<PaletteConfig> | undefined, fallbacks: ThemeFallbacks): PaletteConfig {
  return {
    ...PALETTE_STREETWEAR,
    ...(fallbacks.primary ? { primary: fallbacks.primary, button: fallbacks.button || fallbacks.primary } : {}),
    ...(fallbacks.secondary ? { secondary: fallbacks.secondary } : {}),
    ...(fallbacks.accent ? { accent: fallbacks.accent } : {}),
    ...(partial || {}),
  }
}

function migrateStyle(partial: unknown, fallbacks: ThemeFallbacks): StyleConfig {
  const p = (partial && typeof partial === 'object' ? partial : {}) as LegacyStyle
  const legacyPalette: Partial<PaletteConfig> = {
    // Versiones anteriores guardaban las superficies en style.canvas/surface/ink.
    ...(p.canvas ? { background: p.canvas } : {}),
    ...(p.ink ? { text: p.ink } : {}),
  }

  return {
    palette: mergePalette({ ...legacyPalette, ...(p.palette || {}) }, fallbacks),
    typography: {
      ...DEFAULT_THEME.style.typography,
      ...(p.fontPrimary ? { fontPrimary: p.fontPrimary } : {}),
      ...(p.typography || {}),
    },
    radius: p.radius ?? DEFAULT_THEME.style.radius,
    density: p.density ?? DEFAULT_THEME.style.density,
    buttonStyle: p.buttonStyle ?? DEFAULT_THEME.style.buttonStyle,
    cardStyle: p.cardStyle ?? DEFAULT_THEME.style.cardStyle,
    darkMode: Boolean(p.darkMode),
  }
}

function mergeSections(partial: unknown): SectionConfig {
  const p = (partial && typeof partial === 'object' ? partial : {}) as Partial<SectionConfig>

  // Conserva el orden guardado, descarta claves desconocidas y añade las nuevas.
  const saved = Array.isArray(p.order) ? p.order.filter((k): k is SectionKey => k in SECTION_LABELS) : []
  const order = [...new Set([...saved, ...DEFAULT_THEME.sections.order])]
  const enabled = { ...DEFAULT_THEME.sections.enabled, ...(p.enabled || {}) }

  return {
    order,
    enabled,
    featuredLimit: typeof p.featuredLimit === 'number' ? p.featuredLimit : DEFAULT_THEME.sections.featuredLimit,
  }
}

/**
 * Une la configuración guardada con los valores por defecto.
 * `fallbacks` permite heredar los colores de marca de columnas antiguas
 * (store_config.primary_color, etc.) cuando el JSON aún no tiene palette.
 */
export function mergeTheme(partial: unknown, fallbacks: ThemeFallbacks = {}): ThemeConfig {
  if (!partial || typeof partial !== 'object') {
    return { ...DEFAULT_THEME, style: migrateStyle(undefined, fallbacks) }
  }
  const p = partial as Partial<ThemeConfig>

  return {
    ...(typeof p.template === 'string' ? { template: p.template } : {}),
    style: migrateStyle(p.style, fallbacks),
    header: { ...DEFAULT_THEME.header, ...(p.header || {}) },
    hero: { ...DEFAULT_THEME.hero, ...(p.hero || {}) },
    sections: mergeSections(p.sections),
    promo: { ...DEFAULT_THEME.promo, ...(p.promo || {}) },
    cta: { ...DEFAULT_THEME.cta, ...(p.cta || {}) },
    featuredSkus: Array.isArray(p.featuredSkus) ? p.featuredSkus : DEFAULT_THEME.featuredSkus,
    featuredSelectionEnabled: typeof p.featuredSelectionEnabled === 'boolean' ? p.featuredSelectionEnabled : DEFAULT_THEME.featuredSelectionEnabled,
    featuredCategorySlugs: Array.isArray(p.featuredCategorySlugs) ? p.featuredCategorySlugs : DEFAULT_THEME.featuredCategorySlugs,
    categorySelectionEnabled: typeof p.categorySelectionEnabled === 'boolean' ? p.categorySelectionEnabled : DEFAULT_THEME.categorySelectionEnabled,
    categoryImages: p.categoryImages && typeof p.categoryImages === 'object' && !Array.isArray(p.categoryImages)
      ? Object.fromEntries(Object.entries(p.categoryImages).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
      : DEFAULT_THEME.categoryImages,
    benefits: Array.isArray(p.benefits) ? p.benefits : DEFAULT_THEME.benefits,
    // Nunca inventamos testimonios: si no hay datos reales, queda vacío.
    testimonials: Array.isArray(p.testimonials) ? p.testimonials : [],
    footer: { ...DEFAULT_THEME.footer, ...(p.footer || {}) },
  }
}

// Mapea la escala de radio a los valores CSS que consume Tailwind.
export const RADIUS_VALUES: Record<RadiusScale, { card: string; btn: string; field: string }> = {
  square: { card: '2px', btn: '2px', field: '2px' },
  soft: { card: '10px', btn: '6px', field: '6px' },
  round: { card: '18px', btn: '12px', field: '12px' },
  pill: { card: '24px', btn: '999px', field: '999px' },
}

export const DENSITY_VALUES: Record<DensityScale, { section: string; card: string; grid: string }> = {
  compact: { section: '3rem', card: '1rem', grid: '1.25rem' },
  normal: { section: '4.5rem', card: '1.35rem', grid: '1.75rem' },
  spacious: { section: '6rem', card: '1.75rem', grid: '2.25rem' },
}

export const TYPE_SCALE_VALUES: Record<TypeScale, string> = {
  compact: '15px',
  normal: '16px',
  large: '17.5px',
}

export const HEADING_WEIGHTS: Record<HeadingWeight, string> = {
  semibold: '600',
  bold: '700',
  extrabold: '800',
}

/** Escala tipográfica editorial usada por títulos de sección. */
export const sectionTitleClass =
  'font-display text-[clamp(1.65rem,1.15rem+1.6vw,2.6rem)] leading-[1.1] tracking-[-0.02em] text-ink'
