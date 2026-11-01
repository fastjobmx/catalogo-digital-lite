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
  style: StyleConfig
  header: HeaderConfig
  hero: HeroConfig
  sections: SectionConfig
  promo: PromoBannerConfig
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
  primary: '#1F6FEB',
  secondary: '#DCE7F7',
  accent: '#3F6C8F',
  button: '#14181F',
  buttonText: '#F7F9FC',
}

// Tres presets, una sola tienda: solo cambian variables de presentación.
export const THEME_PRESETS: ThemePreset[] = [
  {
    id: 'streetwear-premium',
    name: 'Streetwear Premium',
    description: 'Editorial, neutro y fotográfico. La identidad base de la plantilla.',
    palette: PALETTE_STREETWEAR,
    typography: { fontPrimary: 'Inter', fontDisplay: 'Manrope', scale: 'normal', headingWeight: 'bold' },
    radius: 'square',
    buttonStyle: 'solid',
    cardStyle: 'flat',
    darkMode: false,
  },
  {
    id: 'boutique-elegance',
    name: 'Boutique Elegance',
    description: 'Fondos cálidos, serif editorial y bordes suaves. Sofisticado y sereno.',
    palette: PALETTE_BOUTIQUE,
    typography: { fontPrimary: 'DM Sans', fontDisplay: 'Playfair Display', scale: 'normal', headingWeight: 'semibold' },
    radius: 'soft',
    buttonStyle: 'solid',
    cardStyle: 'bordered',
    darkMode: false,
  },
  {
    id: 'tech-minimal',
    name: 'Tech Minimal',
    description: 'Composición limpia, azul técnico y acentos fríos. Preciso y moderno.',
    palette: PALETTE_TECH,
    typography: { fontPrimary: 'Space Grotesk', fontDisplay: 'Sora', scale: 'compact', headingWeight: 'semibold' },
    radius: 'soft',
    buttonStyle: 'solid',
    cardStyle: 'bordered',
    darkMode: false,
  },
]

export const DEFAULT_THEME: ThemeConfig = {
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

interface ThemeFallbacks {
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
    style: migrateStyle(p.style, fallbacks),
    header: { ...DEFAULT_THEME.header, ...(p.header || {}) },
    hero: { ...DEFAULT_THEME.hero, ...(p.hero || {}) },
    sections: mergeSections(p.sections),
    promo: { ...DEFAULT_THEME.promo, ...(p.promo || {}) },
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
