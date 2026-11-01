import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { CartProvider } from '../contexts/CartContext'
import { StoreContext, type StoreContextValue } from '../contexts/StoreContext'
import { DEMO_PRODUCTS } from '../data/demoCatalog'
import { DEFAULT_THEME } from '../types/theme'
import ProductCard from './ProductCard'

const storeValue: StoreContextValue = {
  store: {
    name: 'SneakerHub Premium', description: '', logo: null, favicon: null, slogan: null,
    businessType: 'Calzado', primaryColor: '#222222', secondaryColor: '#D9D0C1', accentColor: '#8D806D',
    buttonColor: '#222222', coverImage: null, whatsappPhone: '', whatsappOrders: null,
    phone: null, email: null, address: null, hours: null, instagram: null, facebook: null,
    tiktok: null, mapsUrl: null, currency: 'COP', country: 'CO', deliveryMethods: [],
    pickupAvailable: false, paymentInfo: null, defaultWhatsappMessage: '', theme: DEFAULT_THEME,
  },
  setStore: () => undefined,
  isLoading: false,
  isDemoMode: true,
  backendAvailable: false,
  storeLoadError: null,
  refreshFromApi: async () => undefined,
}

describe('ProductCard image rendering', () => {
  it('uses ProductImage for its main photo and keeps offscreen cards lazy', () => {
    const product = DEMO_PRODUCTS.find(({ sku }) => sku === 'ASTRAL-03')!
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <StoreContext.Provider value={storeValue}>
          <CartProvider><ProductCard product={product} /></CartProvider>
        </StoreContext.Provider>
      </MemoryRouter>,
    )

    expect(html).toContain('src="/seed-images/sneakerhub/ASTRAL-03.jpg"')
    expect(html).toContain('srcSet="/seed-images/sneakerhub/ASTRAL-03.webp"')
    expect(html).toContain('loading="lazy"')
    expect(html).toContain('alt="Astral Wave Runner"')
  })

  it('prioritizes visible cards when requested by the listing', () => {
    const product = DEMO_PRODUCTS.find(({ sku }) => sku === 'ASTRAL-03')!
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <StoreContext.Provider value={storeValue}>
          <CartProvider><ProductCard product={product} priority /></CartProvider>
        </StoreContext.Provider>
      </MemoryRouter>,
    )

    expect(html).toContain('loading="eager"')
    expect(html).toContain('fetchPriority="high"')
  })
})
