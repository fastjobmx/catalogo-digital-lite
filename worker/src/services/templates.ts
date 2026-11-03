/** Store templates applied during provisioning. They only define presentation
 * and starter categories: never products, prices, stock, reviews or policies
 * the merchant has not confirmed. */

export const TEMPLATE_KEYS = ['minimalista', 'moderno', 'premium', 'personalizado'] as const
export type TemplateKey = typeof TEMPLATE_KEYS[number]

export const TEMPLATE_LABELS: Record<TemplateKey, string> = {
  minimalista: 'Minimalista',
  moderno: 'Moderno',
  premium: 'Premium',
  personalizado: 'Personalizado',
}

type Palette = { background: string; surface: string; text: string; textMuted: string; border: string; primary: string; secondary: string; accent: string; button: string; buttonText: string }

const PALETTES: Record<Exclude<TemplateKey, 'personalizado'>, Palette> = {
  minimalista: { background: '#FFFFFF', surface: '#FAFAFA', text: '#111111', textMuted: '#6B6B6B', border: '#E5E5E5', primary: '#111111', secondary: '#F2F2F2', accent: '#8A8A8A', button: '#111111', buttonText: '#FFFFFF' },
  moderno: { background: '#F7F8FA', surface: '#FFFFFF', text: '#0F172A', textMuted: '#64748B', border: '#E2E8F0', primary: '#2563EB', secondary: '#DBEAFE', accent: '#F97316', button: '#2563EB', buttonText: '#FFFFFF' },
  premium: { background: '#F6F1EA', surface: '#FFFDF9', text: '#1C1917', textMuted: '#78716C', border: '#E7DED3', primary: '#1C1917', secondary: '#EADFD2', accent: '#B08D57', button: '#1C1917', buttonText: '#F6F1EA' },
}

const STYLE: Record<Exclude<TemplateKey, 'personalizado'>, Record<string, unknown>> = {
  minimalista: { typography: { fontPrimary: 'Inter', fontDisplay: 'Inter', scale: 'normal', headingWeight: 'semibold' }, radius: 'soft', density: 'spacious', buttonStyle: 'solid', cardStyle: 'bordered', darkMode: false },
  moderno: { typography: { fontPrimary: 'Space Grotesk', fontDisplay: 'Sora', scale: 'normal', headingWeight: 'bold' }, radius: 'round', density: 'normal', buttonStyle: 'solid', cardStyle: 'elevated', darkMode: false },
  premium: { typography: { fontPrimary: 'DM Sans', fontDisplay: 'Playfair Display', scale: 'normal', headingWeight: 'semibold' }, radius: 'soft', density: 'spacious', buttonStyle: 'solid', cardStyle: 'flat', darkMode: false },
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
  const base = input.template === 'personalizado' ? 'moderno' : input.template
  const palette = templatePalette(input.template, input.primaryColor, input.accentColor)
  const profile = businessProfile(input.businessType)
  return {
    style: { ...STYLE[base], palette },
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
      align: input.template === 'minimalista' ? 'center' : 'left',
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
  const base = template === 'personalizado' ? 'moderno' : template
  const palette = { ...PALETTES[base] }
  const custom = hex(primaryColor)
  if (custom) Object.assign(palette, { primary: custom, button: custom })
  const accent = hex(accentColor)
  if (accent) palette.accent = accent
  return palette
}
