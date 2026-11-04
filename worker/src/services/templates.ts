/** Store templates applied during provisioning. They only define presentation
 * and starter categories: never products, prices, stock, reviews or policies
 * the merchant has not confirmed. */

export const TEMPLATE_KEYS = [
  'minimalista', 'moderno', 'premium', 'personalizado', 'luxury', 'urban', 'boutique',
  'natural', 'tech', 'playful', 'gourmet', 'artesanal', 'editorial',
] as const
export type TemplateKey = typeof TEMPLATE_KEYS[number]

export const TEMPLATE_LABELS: Record<TemplateKey, string> = {
  minimalista: 'Minimalista',
  moderno: 'Moderno',
  premium: 'Premium',
  personalizado: 'Personalizado',
  luxury: 'Luxury',
  urban: 'Urban',
  boutique: 'Boutique',
  natural: 'Natural',
  tech: 'Tech',
  playful: 'Playful',
  gourmet: 'Gourmet',
  artesanal: 'Artesanal',
  editorial: 'Editorial',
}

type Palette = { background: string; surface: string; text: string; textMuted: string; border: string; primary: string; secondary: string; accent: string; button: string; buttonText: string }

const PALETTES: Record<TemplateKey, Palette> = {
  minimalista: { background: '#FFFFFF', surface: '#FAFAFA', text: '#111111', textMuted: '#6B6B6B', border: '#E5E5E5', primary: '#111111', secondary: '#F2F2F2', accent: '#8A8A8A', button: '#111111', buttonText: '#FFFFFF' },
  moderno: { background: '#F7F8FA', surface: '#FFFFFF', text: '#0F172A', textMuted: '#64748B', border: '#E2E8F0', primary: '#1B63D8', secondary: '#DBEAFE', accent: '#F97316', button: '#1B63D8', buttonText: '#FFFFFF' },
  premium: { background: '#F6F1EA', surface: '#FFFDF9', text: '#1C1917', textMuted: '#78716C', border: '#E7DED3', primary: '#1C1917', secondary: '#EADFD2', accent: '#B08D57', button: '#1C1917', buttonText: '#F6F1EA' },
  personalizado: { background: '#F7F8FA', surface: '#FFFFFF', text: '#0F172A', textMuted: '#64748B', border: '#E2E8F0', primary: '#2563EB', secondary: '#DBEAFE', accent: '#F97316', button: '#2563EB', buttonText: '#FFFFFF' },
  luxury: { background: '#151311', surface: '#211E1A', text: '#F7F2E8', textMuted: '#B8AA96', border: '#40382D', primary: '#C4A36A', secondary: '#32291E', accent: '#E2C98F', button: '#C4A36A', buttonText: '#17130D' },
  urban: { background: '#111317', surface: '#1B1E24', text: '#F7F8FA', textMuted: '#A5ABB5', border: '#343942', primary: '#F04F36', secondary: '#2A2D34', accent: '#FFB547', button: '#D73F28', buttonText: '#FFFFFF' },
  boutique: { background: '#FBF5F2', surface: '#FFFFFF', text: '#321D24', textMuted: '#806B70', border: '#E9D9D8', primary: '#763B4C', secondary: '#F1E1E2', accent: '#A96D73', button: '#763B4C', buttonText: '#FFFFFF' },
  natural: { background: '#F4F5EE', surface: '#FFFFFF', text: '#202B22', textMuted: '#647063', border: '#DDE2D6', primary: '#365C42', secondary: '#DFE8D9', accent: '#8A6B3E', button: '#365C42', buttonText: '#FFFFFF' },
  tech: { background: '#0F1724', surface: '#172437', text: '#F2F7FF', textMuted: '#A3B5CB', border: '#2A3C53', primary: '#53B9E8', secondary: '#1D3850', accent: '#9A83FF', button: '#176B96', buttonText: '#FFFFFF' },
  playful: { background: '#FFF8EF', surface: '#FFFFFF', text: '#30212E', textMuted: '#786777', border: '#F0DFD5', primary: '#A23D78', secondary: '#F6DDEB', accent: '#C05B2B', button: '#873261', buttonText: '#FFFFFF' },
  gourmet: { background: '#F8F3EC', surface: '#FFFDF9', text: '#302017', textMuted: '#76675B', border: '#E9DDCE', primary: '#713B26', secondary: '#EFE2D1', accent: '#A7782B', button: '#713B26', buttonText: '#FFFFFF' },
  artesanal: { background: '#F7F1E5', surface: '#FFFDF7', text: '#352C20', textMuted: '#766A56', border: '#E5D9C4', primary: '#5D4930', secondary: '#E9DCC4', accent: '#8B5436', button: '#5D4930', buttonText: '#FFFFFF' },
  editorial: { background: '#F4F2ED', surface: '#FFFFFF', text: '#181818', textMuted: '#6C6A66', border: '#DAD7CF', primary: '#262626', secondary: '#E4E0D8', accent: '#963F31', button: '#262626', buttonText: '#FFFFFF' },
}

export const TEMPLATE_DESIGNS: Record<TemplateKey, { typography: Record<string, string>; radius: string; density: string; buttonStyle: string; cardStyle: string; darkMode: boolean; align: 'left' | 'center' }> = {
  minimalista: { typography: { fontPrimary: 'Inter', fontDisplay: 'Inter', scale: 'normal', headingWeight: 'semibold' }, radius: 'soft', density: 'spacious', buttonStyle: 'outline', cardStyle: 'bordered', darkMode: false, align: 'center' },
  moderno: { typography: { fontPrimary: 'Space Grotesk', fontDisplay: 'Sora', scale: 'normal', headingWeight: 'bold' }, radius: 'round', density: 'normal', buttonStyle: 'solid', cardStyle: 'elevated', darkMode: false, align: 'left' },
  premium: { typography: { fontPrimary: 'DM Sans', fontDisplay: 'Playfair Display', scale: 'normal', headingWeight: 'semibold' }, radius: 'soft', density: 'spacious', buttonStyle: 'solid', cardStyle: 'flat', darkMode: false, align: 'left' },
  personalizado: { typography: { fontPrimary: 'Inter', fontDisplay: 'Manrope', scale: 'normal', headingWeight: 'bold' }, radius: 'soft', density: 'normal', buttonStyle: 'solid', cardStyle: 'elevated', darkMode: false, align: 'left' },
  luxury: { typography: { fontPrimary: 'DM Sans', fontDisplay: 'Playfair Display', scale: 'large', headingWeight: 'semibold' }, radius: 'square', density: 'spacious', buttonStyle: 'outline', cardStyle: 'flat', darkMode: true, align: 'center' },
  urban: { typography: { fontPrimary: 'Space Grotesk', fontDisplay: 'Space Grotesk', scale: 'normal', headingWeight: 'extrabold' }, radius: 'square', density: 'compact', buttonStyle: 'solid', cardStyle: 'flat', darkMode: true, align: 'left' },
  boutique: { typography: { fontPrimary: 'DM Sans', fontDisplay: 'Playfair Display', scale: 'large', headingWeight: 'semibold' }, radius: 'round', density: 'spacious', buttonStyle: 'soft', cardStyle: 'bordered', darkMode: false, align: 'center' },
  natural: { typography: { fontPrimary: 'Inter', fontDisplay: 'Manrope', scale: 'normal', headingWeight: 'semibold' }, radius: 'round', density: 'spacious', buttonStyle: 'soft', cardStyle: 'elevated', darkMode: false, align: 'left' },
  tech: { typography: { fontPrimary: 'Space Grotesk', fontDisplay: 'Sora', scale: 'compact', headingWeight: 'bold' }, radius: 'soft', density: 'compact', buttonStyle: 'solid', cardStyle: 'bordered', darkMode: true, align: 'left' },
  playful: { typography: { fontPrimary: 'Manrope', fontDisplay: 'Sora', scale: 'large', headingWeight: 'extrabold' }, radius: 'pill', density: 'spacious', buttonStyle: 'solid', cardStyle: 'elevated', darkMode: false, align: 'center' },
  gourmet: { typography: { fontPrimary: 'DM Sans', fontDisplay: 'Playfair Display', scale: 'normal', headingWeight: 'semibold' }, radius: 'soft', density: 'normal', buttonStyle: 'solid', cardStyle: 'bordered', darkMode: false, align: 'center' },
  artesanal: { typography: { fontPrimary: 'Inter', fontDisplay: 'Playfair Display', scale: 'normal', headingWeight: 'semibold' }, radius: 'round', density: 'spacious', buttonStyle: 'outline', cardStyle: 'bordered', darkMode: false, align: 'left' },
  editorial: { typography: { fontPrimary: 'Inter', fontDisplay: 'Playfair Display', scale: 'large', headingWeight: 'bold' }, radius: 'square', density: 'spacious', buttonStyle: 'outline', cardStyle: 'flat', darkMode: false, align: 'left' },
}

export type BusinessProfile = { key: string; label: string; categories: string[]; heroEyebrow: string }

const BUSINESS_PROFILES: Array<BusinessProfile & { match: RegExp }> = [
  { key: 'moda', label: 'Moda y accesorios', match: /ropa|moda|prenda|vestido|camis|boutique|textil/i, categories: ['Ropa', 'Accesorios', 'Calzado', 'Ofertas'], heroEyebrow: 'NUEVA COLECCIÓN' },
  { key: 'calzado', label: 'Calzado', match: /calzado|zapato|tenis|sneaker|zapatilla/i, categories: ['Calzado', 'Deportivo', 'Casual', 'Accesorios'], heroEyebrow: 'NUEVOS MODELOS' },
  { key: 'tecnologia', label: 'Tecnología', match: /tecno|celular|m[oó]vil|electr[oó]nic|computa|gamer|cargador/i, categories: ['Celulares', 'Accesorios', 'Audio', 'Cargadores'], heroEyebrow: 'TECNOLOGÍA' },
  { key: 'mascotas', label: 'Mascotas', match: /mascota|perro|gato|veterin|pet/i, categories: ['Alimento', 'Accesorios', 'Juguetes', 'Higiene'], heroEyebrow: 'PARA TU MASCOTA' },
  { key: 'belleza', label: 'Belleza y cuidado personal', match: /belleza|maquillaje|cosm[eé]tic|skin|piel|cabello|perfum|u[nñ]as/i, categories: ['Maquillaje', 'Cuidado de la piel', 'Cabello', 'Fragancias'], heroEyebrow: 'BELLEZA' },
  { key: 'hogar', label: 'Hogar', match: /hogar|casa|decoraci|cocina|mueble/i, categories: ['Cocina', 'Decoración', 'Organización', 'Textiles'], heroEyebrow: 'PARA TU HOGAR' },
  { key: 'joyeria', label: 'Joyería y bisutería', match: /joya|bisuter|collar|anillo|arete|reloj/i, categories: ['Collares', 'Aretes', 'Pulseras', 'Anillos'], heroEyebrow: 'JOYERÍA' },
  { key: 'alimentos', label: 'Alimentos y bebidas', match: /comida|aliment|panader|reposter|caf[eé]|bebida|postre|snack|restaurante/i, categories: ['Productos', 'Combos', 'Bebidas', 'Ofertas'], heroEyebrow: 'HECHO PARA TI' },
]

export function businessProfile(businessType: string): BusinessProfile {
  const found = BUSINESS_PROFILES.find((profile) => profile.match.test(businessType))
  return found ?? { key: 'general', label: 'Comercio general', categories: ['Productos', 'Novedades', 'Ofertas'], heroEyebrow: 'BIENVENIDOS' }
}

function hex(value: string | undefined): string | null {
  if (!value) return null
  const normalized = value.trim().replace(/^#?/, '#').toUpperCase()
  return /^#[0-9A-F]{6}$/.test(normalized) ? normalized : null
}

export function buildTheme(input: { template: TemplateKey; name: string; businessType: string; description?: string; primaryColor?: string; accentColor?: string }): Record<string, unknown> {
  const base = input.template
  const palette = templatePalette(input.template, input.primaryColor, input.accentColor)
  const profile = businessProfile(input.businessType)
  const { align, ...design } = TEMPLATE_DESIGNS[base]
  return {
    style: { ...design, palette },
    header: { topbarEnabled: false, topbarText: '', showContact: true, sticky: true },
    hero: {
      enabled: true,
      eyebrow: profile.heroEyebrow,
      title: input.name,
      subtitle: '',
      description: input.description || `Descubre nuestros productos y haz tu pedido por WhatsApp.`,
      ctaPrimaryLabel: 'Ver catálogo',
      ctaPrimaryHref: '/category/all',
      ctaSecondaryEnabled: false,
      ctaSecondaryLabel: '',
      ctaSecondaryHref: '/category/all',
      imageUrl: null,
      imageUrlMobile: null,
      align,
      height: 'standard',
      overlayOpacity: 40,
    },
    sections: {
      order: ['hero', 'categories', 'featured', 'newest', 'offers', 'promo', 'benefits', 'contact', 'cta'],
      enabled: { hero: true, categories: true, featured: true, promo: false, offers: true, newest: true, benefits: false, contact: true, testimonials: false, cta: true },
      featuredLimit: 8,
    },
    promo: { enabled: false, eyebrow: '', title: '', text: '', ctaLabel: '', ctaHref: '/category/all', imageUrl: null },
    cta: { eyebrow: 'Pedidos', title: '¿Te gustó algo?', description: 'Agrega tus productos al carrito y envíanos el pedido por WhatsApp. Confirmamos disponibilidad y envío en la conversación.', primaryLabel: 'Ver catálogo' },
    featuredSkus: [],
    featuredSelectionEnabled: false,
    featuredCategorySlugs: [],
    categorySelectionEnabled: false,
    categoryImages: {},
    benefits: [],
    testimonials: [],
    footer: {
      aboutText: input.description || `${input.name}: ${profile.label.toLowerCase()}.`,
      showPolicies: false,
      policiesTitle: 'Envíos y cambios',
      policies: '',
      copyright: 'Todos los derechos reservados.',
    },
    template: input.template,
  }
}

/** Template palette with the brand colors on top: primary drives buttons and
 * headings, accent the highlights. Either may be omitted. */
export function templatePalette(template: TemplateKey, primaryColor?: string, accentColor?: string): Palette {
  const palette = { ...PALETTES[template] }
  const custom = hex(primaryColor)
  if (custom) Object.assign(palette, { primary: custom, button: custom })
  const accent = hex(accentColor)
  if (accent) palette.accent = accent
  return palette
}
