export function mapStoreRow(row: Record<string, unknown>) {
  const delivery = row.delivery_methods ?? row.deliveryMethods ?? '[]'
  const theme = row.theme_config ?? row.themeConfig ?? '{}'
  return {
    name: row.name,
    description: row.description,
    slogan: row.slogan,
    businessType: row.business_type ?? row.businessType,
    logoUrl: row.logo_url ?? row.logoUrl,
    faviconUrl: row.favicon_url ?? row.faviconUrl,
    coverImageUrl: row.cover_image_url ?? row.coverImageUrl,
    primaryColor: row.primary_color ?? row.primaryColor,
    secondaryColor: row.secondary_color ?? row.secondaryColor,
    accentColor: row.accent_color ?? row.accentColor,
    buttonColor: row.button_color ?? row.buttonColor,
    whatsappPhone: row.whatsapp_phone ?? row.whatsappPhone,
    whatsappOrders: row.whatsapp_orders ?? row.whatsappOrders,
    phone: row.phone,
    email: row.email,
    address: row.address,
    hours: row.hours,
    instagram: row.instagram,
    facebook: row.facebook,
    tiktok: row.tiktok,
    mapsUrl: row.maps_url ?? row.mapsUrl,
    currency: row.currency,
    country: row.country,
    deliveryMethods: typeof delivery === 'string' ? JSON.parse(delivery || '[]') : delivery,
    pickupAvailable: Boolean(row.pickup_available ?? row.pickupAvailable),
    paymentInfo: row.payment_info ?? row.paymentInfo,
    defaultWhatsappMessage: row.default_whatsapp_message ?? row.defaultWhatsappMessage,
    themeConfig: typeof theme === 'string' ? safeParse(theme) : theme,
  }
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value || '{}')
  } catch {
    return {}
  }
}

const CAMEL_TO_SNAKE: Record<string, string> = {
  businessType: 'business_type',
  logoUrl: 'logo_url',
  faviconUrl: 'favicon_url',
  coverImageUrl: 'cover_image_url',
  primaryColor: 'primary_color',
  secondaryColor: 'secondary_color',
  accentColor: 'accent_color',
  buttonColor: 'button_color',
  whatsappPhone: 'whatsapp_phone',
  whatsappOrders: 'whatsapp_orders',
  mapsUrl: 'maps_url',
  deliveryMethods: 'delivery_methods',
  pickupAvailable: 'pickup_available',
  paymentInfo: 'payment_info',
  defaultWhatsappMessage: 'default_whatsapp_message',
  themeConfig: 'theme_config',
}

export function normalizeStoreBody(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(body)) {
    const snake = CAMEL_TO_SNAKE[key] || key
    if (key === 'deliveryMethods' && Array.isArray(value)) {
      out[snake] = JSON.stringify(value)
    } else if (key === 'themeConfig' && value && typeof value === 'object') {
      out[snake] = JSON.stringify(value)
    } else {
      out[snake] = value
    }
    if (key === 'pickupAvailable') out[snake] = value ? 1 : 0
  }
  return out
}
