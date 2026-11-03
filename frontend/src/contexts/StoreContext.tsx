import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import { getStoreConfig, isBackendAvailable, type StoreConfigApi } from '../services/api'
import { DEMO_CATALOG_VERSION } from '../data/catalogVersion'
import { STORE_PRESET_CTA } from '../data/storePresetCta'
import { isIndependentInstallation, storeStorageKey } from '../lib/installation'
import { getClosingCtaDefaults, normalizeStoreTheme } from '../lib/storeTheme'
import { IS_PUBLIC_DEMO } from '../lib/publicDemo'
import { TENANT_SLUG } from '../lib/tenant'
import {
  DEFAULT_THEME,
  DENSITY_VALUES,
  HEADING_WEIGHTS,
  RADIUS_VALUES,
  SAFE_FONTS,
  TYPE_SCALE_VALUES,
  type ThemeConfig,
} from '../types/theme'

export interface StoreConfig {
 name: string
 description: string
 logo: string | null
 favicon: string | null
 slogan: string | null
 businessType: string
 primaryColor: string
 secondaryColor: string
 accentColor: string
 buttonColor: string
 coverImage: string | null
 whatsappPhone: string
 whatsappOrders: string | null
 phone: string | null
 email: string | null
 address: string | null
 hours: string | null
 instagram: string | null
 facebook: string | null
 tiktok: string | null
 mapsUrl: string | null
 currency: string
 country: string
 deliveryMethods: string[]
 pickupAvailable: boolean
 paymentInfo: string | null
 defaultWhatsappMessage: string
 theme: ThemeConfig
}

const INDEPENDENT_INSTALLATION = isIndependentInstallation()

function getDefaultStoreTheme(): ThemeConfig {
 const theme = structuredClone(DEFAULT_THEME)
 if (!INDEPENDENT_INSTALLATION) return theme

 theme.header.topbarEnabled = false
 theme.hero.eyebrow = ''
 theme.hero.title = 'Bienvenido'
 theme.hero.subtitle = ''
 theme.hero.description = ''
 theme.hero.imageUrl = null
 theme.hero.imageUrlMobile = null
 theme.hero.ctaSecondaryEnabled = false
 theme.cta = getClosingCtaDefaults('tu tienda', true, STORE_PRESET_CTA)
 theme.promo.enabled = false
 theme.sections.enabled.benefits = false
 theme.benefits = []
 theme.footer.aboutText = ''
 theme.footer.showPolicies = false
 return theme
}

const DEFAULT_STORE: StoreConfig = {
 name: INDEPENDENT_INSTALLATION ? 'Mi tienda' : 'SneakerHub Premium',
 description: INDEPENDENT_INSTALLATION ? '' : 'Sneakers, streetwear y accesorios seleccionados con envío a todo el país.',
 logo: null,
 favicon: '/favicon.svg',
 slogan: INDEPENDENT_INSTALLATION ? null : 'Tu estilo, tu ritmo',
 businessType: INDEPENDENT_INSTALLATION ? '' : 'Calzado y streetwear',
 primaryColor: '#222222',
 secondaryColor: '#D9D0C1',
 accentColor: '#8D806D',
 buttonColor: '#222222',
 coverImage: null,
 whatsappPhone: INDEPENDENT_INSTALLATION ? '' : '+573001234567',
 whatsappOrders: null,
 phone: INDEPENDENT_INSTALLATION ? null : '+573001234567',
 email: INDEPENDENT_INSTALLATION ? null : 'hola@sneakerhub.co',
 address: INDEPENDENT_INSTALLATION ? null : 'Bogotá, Colombia',
 hours: INDEPENDENT_INSTALLATION ? null : 'Lun-Sáb 9am-7pm',
 instagram: INDEPENDENT_INSTALLATION ? null : 'sneakerhub.co',
 facebook: INDEPENDENT_INSTALLATION ? null : 'sneakerhubco',
 tiktok: INDEPENDENT_INSTALLATION ? null : 'sneakerhub.co',
 mapsUrl: INDEPENDENT_INSTALLATION ? null : 'https://maps.google.com/?q=Bogota',
 currency: 'COP',
 country: 'CO',
 deliveryMethods: ['envio'],
 pickupAvailable: true,
 paymentInfo: 'Tarjetas, PSE, Nequi y contraentrega',
 defaultWhatsappMessage: INDEPENDENT_INSTALLATION ? 'Hola! Quiero hacer un pedido:' : 'Hola SneakerHub! Quiero información sobre un producto:',
 theme: getDefaultStoreTheme(),
}

export interface StoreContextValue {
 store: StoreConfig
 setStore: (config: Partial<StoreConfig>) => void
 isLoading: boolean
 isDemoMode: boolean
 backendAvailable: boolean
 storeLoadError: string | null
 refreshFromApi: () => Promise<void>
}

export const StoreContext = createContext<StoreContextValue | undefined>(undefined)

// Map API response to local StoreConfig format
function mapApiToStoreConfig(api: StoreConfigApi): StoreConfig {
 const theme = normalizeStoreTheme(api.themeConfig, api.name, INDEPENDENT_INSTALLATION, {
   primary: api.primaryColor,
   secondary: api.secondaryColor,
   accent: api.accentColor,
   button: api.buttonColor,
 }, STORE_PRESET_CTA)

 // Actualiza solo la portada demo heredada; las portadas configuradas por cada
 // comercio permanecen intactas.
 if (api.name === 'SneakerHub Premium' && theme.hero.imageUrl === '/seed-images/sneakerhub/hero-editorial.jpg') {
   theme.hero.imageUrl = '/seed-images/sneakerhub/TERA-16.jpg'
 }

 if (INDEPENDENT_INSTALLATION) {
   theme.header.topbarEnabled = false
   theme.hero.eyebrow = api.businessType || ''
   theme.hero.title = api.name || 'Mi tienda'
   theme.hero.subtitle = api.slogan || ''
   theme.hero.description = api.description || ''
   theme.hero.imageUrl = api.coverImageUrl
   theme.hero.imageUrlMobile = null
   theme.hero.ctaSecondaryEnabled = false
   theme.promo.enabled = false
   theme.sections.enabled.benefits = false
   theme.benefits = []
   theme.footer.aboutText = api.description || api.slogan || api.name
   theme.footer.showPolicies = false
 }

 return {
 name: api.name,
 description: api.description,
 logo: api.logoUrl,
 favicon: api.faviconUrl,
 slogan: api.slogan,
 businessType: api.businessType,
 primaryColor: api.primaryColor,
 secondaryColor: api.secondaryColor,
 accentColor: api.accentColor,
 buttonColor: api.buttonColor,
 coverImage: api.coverImageUrl,
 whatsappPhone: api.whatsappPhone,
 whatsappOrders: api.whatsappOrders,
 phone: api.phone,
 email: api.email,
 address: api.address,
 hours: api.hours,
 instagram: api.instagram,
 facebook: api.facebook,
 tiktok: api.tiktok,
 mapsUrl: api.mapsUrl,
 currency: api.currency,
 country: api.country,
 deliveryMethods: api.deliveryMethods,
 pickupAvailable: api.pickupAvailable,
 paymentInfo: api.paymentInfo,
 defaultWhatsappMessage: api.defaultWhatsappMessage,
 // Los colores de marca antiguos actúan como respaldo si el JSON aún no
 // incluye la paleta completa (migración sin perder personalizaciones).
 theme,
 }
}

export function StoreProvider({ children }: { children: ReactNode }) {
 const [store, setStoreState] = useState<StoreConfig>(DEFAULT_STORE)
 const [isLoading, setIsLoading] = useState(true)
 const [isDemoMode, setIsDemoMode] = useState(false)
 const [backendAvailable, setBackendAvailable] = useState(false)
 const [storeLoadError, setStoreLoadError] = useState<string | null>(null)

 const loadFromApi = async () => {
 if (IS_PUBLIC_DEMO) {
   setStoreState(DEFAULT_STORE)
   setBackendAvailable(false)
   setIsDemoMode(true)
   setStoreLoadError(null)
   setIsLoading(false)
   return
 }
 let available = false
 try {
 available = await isBackendAvailable()
 setBackendAvailable(available)

 if (available) {
 setIsDemoMode(false)
 try {
 const apiConfig = await getStoreConfig()
 setStoreState(mapApiToStoreConfig(apiConfig))
 setStoreLoadError(null)
 } catch (err) {
 const unavailable = err instanceof Error && /Store not (available|found)/i.test(err.message)
 setStoreLoadError(unavailable
   ? 'Esta tienda no está disponible en este momento. Si eres el propietario, inicia sesión en el panel para ver la vista previa.'
   : err instanceof Error ? err.message : 'No se pudo cargar la configuración de la tienda.')
 }
 } else {
 setIsDemoMode(true)
 setStoreLoadError(null)
 }
 } catch {
 // Solo un health-check fallido habilita el modo demo.
 setBackendAvailable(available)
 setIsDemoMode(!available)
 setStoreLoadError(available ? 'No se pudo conectar con la configuración del servidor.' : null)
 } finally {
 setIsLoading(false)
 }
 }

 useEffect(() => {
    if (IS_PUBLIC_DEMO) {
      void loadFromApi()
      return
    }
    try {
      // La versión del catálogo no debe borrar los overrides visuales de la tienda.
      const versionKey = storeStorageKey('catalogo-lite-store-version')
      if (localStorage.getItem(versionKey) !== DEMO_CATALOG_VERSION) {
        localStorage.setItem(versionKey, DEMO_CATALOG_VERSION)
      }
      const saved = localStorage.getItem(storeStorageKey('catalogo-lite-store-overrides'))
      if (saved) {
        const overrides = JSON.parse(saved) as Partial<StoreConfig>
        if (overrides.theme) {
          overrides.theme = normalizeStoreTheme(
            overrides.theme,
            overrides.name || 'tu tienda',
            INDEPENDENT_INSTALLATION,
            {
              primary: overrides.primaryColor,
              secondary: overrides.secondaryColor,
              accent: overrides.accentColor,
              button: overrides.buttonColor,
            },
            STORE_PRESET_CTA,
          )
        }
        setStoreState((prev) => ({ ...prev, ...overrides }))
      }
    } catch { /* ignore */ }
    void loadFromApi()
 }, [])

 const setStore = (updates: Partial<StoreConfig>) => {
 setStoreState((prev) => {
   const normalized = updates.theme
     ? {
         ...updates,
         theme: normalizeStoreTheme(updates.theme, updates.name || prev.name, INDEPENDENT_INSTALLATION, {
           primary: updates.primaryColor || prev.primaryColor,
           secondary: updates.secondaryColor || prev.secondaryColor,
           accent: updates.accentColor || prev.accentColor,
           button: updates.buttonColor || prev.buttonColor,
         }, STORE_PRESET_CTA),
       }
     : updates
   return { ...prev, ...normalized }
 })
 }

 // Aplica la identidad visual como variables CSS.
 // Una sola fuente de verdad: theme.style.palette + theme.style.typography.
 useEffect(() => {
 const root = document.documentElement
 const set = (name: string, value: string) => root.style.setProperty(name, value)

 const { palette, typography } = store.theme.style

 set('--color-background', palette.background)
 set('--color-surface', palette.surface)
 set('--color-text', palette.text)
 set('--color-text-muted', palette.textMuted || `color-mix(in srgb, ${palette.text} 58%, ${palette.background})`)
 set('--color-border', palette.border || `color-mix(in srgb, ${palette.text} 14%, ${palette.background})`)
 set('--color-primary', palette.primary)
 set('--color-primary-contrast', readableOn(palette.primary))
 set('--color-secondary', palette.secondary)
 set('--color-secondary-contrast', readableOn(palette.secondary))
 set('--color-accent', palette.accent)
 set('--color-button', palette.button)
 set('--color-button-text', palette.buttonText || readableOn(palette.button))

 // Alias heredados por componentes que aún los referencian directamente.
 set('--brand-primary', palette.primary)
 set('--brand-on-primary', readableOn(palette.primary))
 set('--brand-secondary', palette.secondary)
 set('--brand-on-secondary', readableOn(palette.secondary))
 set('--brand-accent', palette.accent)
 set('--brand-button', palette.button)
 set('--brand-on-button', palette.buttonText || readableOn(palette.button))

 root.style.colorScheme = store.theme.style.darkMode ? 'dark' : 'light'

 // Sombras coherentes con la paleta: sin glow neón en la plantilla premium.
 const shadowBase = palette.text
 set('--shadow-card', store.theme.style.cardStyle === 'elevated'
 ? `0 1px 2px color-mix(in srgb, ${shadowBase} 6%, transparent), 0 14px 36px color-mix(in srgb, ${shadowBase} 9%, transparent)`
 : 'none')
 set('--shadow-card-hover', `0 18px 44px color-mix(in srgb, ${shadowBase} 13%, transparent)`)
 set('--glow-primary', 'none')
 set('--glow-secondary', 'none')

 const radius = RADIUS_VALUES[store.theme.style.radius] ?? RADIUS_VALUES.soft
 set('--radius-card', radius.card)
 set('--radius-btn', radius.btn)
 set('--radius-field', radius.field)

 const density = DENSITY_VALUES[store.theme.style.density] ?? DENSITY_VALUES.normal
 set('--section-space', density.section)
 set('--card-pad', density.card)
 set('--grid-gap', density.grid)

 const safeFont = (name: string) => SAFE_FONTS.includes(name) ? name : 'Inter'
 set('--font-sans', `'${safeFont(typography.fontPrimary)}', system-ui, -apple-system, 'Segoe UI', sans-serif`)
 set('--font-display', `'${safeFont(typography.fontDisplay)}', '${safeFont(typography.fontPrimary)}', system-ui, sans-serif`)
 set('--font-size-base', TYPE_SCALE_VALUES[typography.scale] ?? TYPE_SCALE_VALUES.normal)
 set('--heading-weight', HEADING_WEIGHTS[typography.headingWeight] ?? '700')

 root.dataset.button = store.theme.style.buttonStyle
 root.dataset.card = store.theme.style.cardStyle
 root.dataset.preset = store.theme.style.radius
 root.classList.toggle('dark', store.theme.style.darkMode)

 // Color de la barra del navegador y favicon
 const themeColor = document.querySelector('meta[name="theme-color"]')
 if (themeColor) themeColor.setAttribute('content', palette.background)

 if (store.favicon) {
 let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
 if (!link) {
 link = document.createElement('link')
 link.rel = 'icon'
 document.head.appendChild(link)
 }
 link.href = store.favicon
 }

 // A platform store keeps its neutral title until its own configuration loads.
 if (!TENANT_SLUG || (!isLoading && !storeLoadError && !isDemoMode)) document.title = store.name
 }, [store.theme, store.favicon, store.name, isLoading, storeLoadError, isDemoMode])

 return (
 <StoreContext.Provider value={{ store, setStore, isLoading, isDemoMode, backendAvailable, storeLoadError, refreshFromApi: loadFromApi }}>
 {children}
 </StoreContext.Provider>
 )
}

export function useStore() {
 const context = useContext(StoreContext)
 if (!context) throw new Error('useStore must be used within StoreProvider')
 return context
}

// Devuelve un color de texto legible (claro u oscuro) sobre el color indicado
function readableOn(hex: string): string {
 return getLuminance(hex) > 0.55 ? '#0B1220' : '#FFFFFF'
}

// Helper to calculate relative luminance for contrast
function getLuminance(hex: string): number {
 const rgb = hexToRgb(hex)
 const r = rgb.r / 255
 const g = rgb.g / 255
 const b = rgb.b / 255
 const [rLin, gLin, bLin] = [r, g, b].map(c =>
 c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
 )
 return 0.2126 * (rLin ?? 0) + 0.7152 * (gLin ?? 0) + 0.0722 * (bLin ?? 0)
}

function hexToRgb(hex: string) {
 const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
 return result
 ? { r: parseInt(result[1]!, 16), g: parseInt(result[2]!, 16), b: parseInt(result[3]!, 16) }
 : { r: 0, g: 0, b: 0 }
}
