// Public commercial plans: the single source for the cards, the monthly/annual comparator, the
// WhatsApp messages, the contact form and the JSON-LD offers. Prices in whole COP.
//
// Rules (owner brief, 2026-11-11):
//  - Three public plans: Emprendedor, Negocio, Mayorista. The "Promocional" plan is never shown here.
//  - The backend (plans table) stays the source of truth for real limits: editing this file does NOT
//    change limits, credits or permissions of any store. Differences are listed in
//    docs/LANDING_PLANES_Y_PRECIOS.md and need approval before production limits change.
//  - Only features verified in the code are listed as available; the rest go to `soon`.

export type Billing = 'mensual' | 'anual'

export type Plan = {
  key: 'emprendedor' | 'negocio' | 'mayorista'
  name: string
  audience: string
  setup: number
  monthly: number
  annual: number
  products: string
  /** Available today (verified in the code). */
  features: string[]
  /** Monthly AI allowances of the plan. */
  ai: string[]
  /** Announced, not available yet: shown with the "Próximamente" label. */
  soon: string[]
  highlight?: boolean
}

export const plans: Plan[] = [
  {
    key: 'emprendedor',
    name: 'Emprendedor',
    audience: 'Para empezar a vender con un catálogo propio.',
    setup: 149_000,
    monthly: 59_900,
    annual: 599_000,
    products: 'Hasta 150 productos',
    features: [
      'Catálogo responsive con plantilla',
      'Dirección propia: app.tiendiaexpres.com/t/tu-negocio',
      'Productos, categorías, tallas y variantes',
      'Carrito y pedidos por WhatsApp',
      'Panel web de administración',
      'Herramientas básicas de fotografía (uso razonable)',
    ],
    ai: [
      'Asistente en Telegram: hasta 500 mensajes IA al mes',
      '50 mejoras de fotografía con IA al mes',
      '200 descripciones con IA al mes',
    ],
    soon: [],
  },
  {
    key: 'negocio',
    name: 'Negocio',
    audience: 'Para tiendas con más productos y pedidos todos los días.',
    setup: 199_000,
    monthly: 99_900,
    annual: 999_000,
    products: 'Hasta 500 productos',
    features: [
      'Todo lo del plan Emprendedor',
      'Asistente en Telegram de uso ampliado',
      'Guías de envío desde Telegram (foto de la guía)',
      'Pedidos con estados, transportadora y número de guía',
    ],
    ai: [
      '150 mejoras de fotografía con IA al mes',
      'Descripciones con IA bajo uso razonable',
    ],
    soon: ['Reportes comerciales'],
    highlight: true,
  },
  {
    key: 'mayorista',
    name: 'Mayorista',
    audience: 'Para distribuidores y catálogos grandes.',
    setup: 299_000,
    monthly: 169_900,
    annual: 1_699_000,
    products: 'Hasta 2.000 productos',
    features: [
      'Todo lo del plan Negocio',
      'Varios administradores con roles',
      'Soporte prioritario',
    ],
    ai: [
      '400 mejoras de fotografía con IA al mes',
      'Descripciones con IA bajo uso razonable',
    ],
    soon: ['Precios al por mayor', 'Reportes comerciales'],
  },
]

/** Colombian format with the currency code: 149000 → "$149.000 COP". Locale-independent (SSR = browser). */
export function cop(value: number): string {
  const digits = Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `$${digits} COP`
}

/** First year paying monthly: the one-time setup plus twelve monthly payments. */
export const firstYearMonthly = (plan: Pick<Plan, 'setup' | 'monthly'>) => plan.setup + plan.monthly * 12

/** Saving of the annual payment against the same first year (12 months) paid monthly. */
export const annualSaving = (plan: Pick<Plan, 'setup' | 'monthly' | 'annual'>) => firstYearMonthly(plan) - plan.annual

export const billingLabel: Record<Billing, string> = { mensual: 'pago mensual', anual: 'pago anual' }

/** WhatsApp text for a plan: always names the plan and the chosen billing. */
export function planMessage(plan: Pick<Plan, 'name' | 'setup' | 'monthly' | 'annual'>, billing: Billing): string {
  const price = billing === 'anual'
    ? `${cop(plan.annual)} al año, sin pago inicial adicional`
    : `${cop(plan.monthly)} al mes + pago inicial de ${cop(plan.setup)}`
  return `Hola, quiero el plan ${plan.name} de TiendIA Exprés con ${billingLabel[billing]} (${price}).`
}

/** Optional add-ons. Only what can be offered today; prices only where the owner set one. */
export type AddOn = { title: string; body: string; price: string; status: 'disponible' | 'consulta' | 'pronto' }

export const addOns: AddOn[] = [
  {
    title: 'Dominio propio',
    body: 'Tu tienda en tu propia dirección (por ejemplo, tunegocio.com), con configuración asistida.',
    price: 'Plan Emprendedor: $99.000 COP al año. Planes Negocio y Mayorista: consulta las condiciones.',
    status: 'consulta',
  },
  {
    title: 'Créditos IA adicionales',
    body: 'Si se terminan las cuotas IA del mes, puedes solicitar créditos adicionales desde tu panel.',
    price: 'Valor según la cantidad: te lo confirmamos antes de cargarlos.',
    status: 'disponible',
  },
  {
    title: 'Estudio Creativo',
    body: 'Imágenes, carruseles y videos cortos para redes con tus productos, desde tu panel. El video con IA llega pronto.',
    price: 'Incluido en todos los planes, sin consumir créditos IA.',
    status: 'disponible',
  },
]
