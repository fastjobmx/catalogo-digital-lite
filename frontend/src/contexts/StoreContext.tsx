import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import { getStoreConfig, isBackendAvailable, type StoreConfigApi } from '../services/api'
import { DEMO_CATALOG_VERSION } from '../data/demoCatalog'
import {
  DEFAULT_THEME,
  DENSITY_VALUES,
  HEADING_WEIGHTS,
  RADIUS_VALUES,
  SAFE_FONTS,
  TYPE_SCALE_VALUES,
  mergeTheme,
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

const DEFAULT_STORE: StoreConfig = {
 name: 'SneakerHub Premium',
 description: 'Sneakers, streetwear y accesorios seleccionados con envío a todo el país.',
 logo: null,
 favicon: '/favicon.svg',
 slogan: 'Tu estilo, tu ritmo',
 businessType: 'Calzado y streetwear',
 primaryColor: '#222222',
 secondaryColor: '#D9D0C1',
 accentColor: '#8D806D',
 buttonColor: '#222222',
 coverImage: null,
 whatsappPhone: '+573001234567',
 whatsappOrders: null,
 phone: '+573001234567',
 email: 'hola@sneakerhub.co',
 address: 'Bogotá, Colombia',
 hours: 'Lun-Sáb 9am-7pm',
 instagram: 'sneakerhub.co',
 facebook: 'sneakerhubco',
 tiktok: 'sneakerhub.co',
 mapsUrl: 'https://maps.google.com/?q=Bogota',
 currency: 'COP',
 country: 'CO',
 deliveryMethods: ['envio'],
 pickupAvailable: true,
 paymentInfo: 'Tarjetas, PSE, Nequi y contraentrega',
 defaultWhatsappMessage: 'Hola SneakerHub! Quiero información sobre un producto:',
 theme: DEFAULT_THEME,
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
 const theme = mergeTheme(api.themeConfig, {
   primary: api.primaryColor,
   secondary: api.secondaryColor,
   accent: api.accentColor,
   button: api.buttonColor,
 })

 // Actualiza solo la portada demo heredada; las portadas configuradas por cada
 // comercio permanecen intactas.
 if (api.name === 'SneakerHub Premium' && theme.hero.imageUrl === '/seed-images/sneakerhub/hero-editorial.jpg') {
   theme.hero.imageUrl = '/seed-images/sneakerhub/TERA-16.jpg'
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
 setStoreLoadError(err instanceof Error ? err.message : 'No se pudo cargar la configuración de la tienda.')
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
    try {
      // La versión del catálogo no debe borrar los overrides visuales de la tienda.
      const versionKey = 'catalogo-lite-store-version'
      if (localStorage.getItem(versionKey) !== DEMO_CATALOG_VERSION) {
        localStorage.setItem(versionKey, DEMO_CATALOG_VERSION)
      }
      const saved = localStorage.getItem('catalogo-lite-store-overrides')
      if (saved) setStoreState((prev) => ({ ...prev, ...JSON.parse(saved) }))
    } catch { /* ignore */ }
    void loadFromApi()
 }, [])

 const setStore = (updates: Partial<StoreConfig>) => {
 setStoreState(prev => ({ ...prev, ...updates }))
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

 document.title = store.name
 }, [store.theme, store.favicon, store.name])

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
