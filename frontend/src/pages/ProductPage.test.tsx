import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import { CartProvider } from '../contexts/CartContext'
import { CatalogContext, type CatalogContextValue } from '../contexts/CatalogContext'
import { StoreContext, type StoreContextValue } from '../contexts/StoreContext'
import { DEMO_CATEGORIES, DEMO_PRODUCTS } from '../data/demoCatalog'
import { findProductBySku } from '../lib/catalog'
import { DEFAULT_THEME } from '../types/theme'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import ProductPage from './ProductPage'

const testProducts = DEMO_PRODUCTS.map((product) => product.sku === 'KINETIK-06'
  ? { ...product, name: 'Kinetik Aero Carbon' }
  : product)

const catalogValue = {
  products: testProducts,
  categories: DEMO_CATEGORIES,
  archived: [],
  loading: false,
  error: null,
  refresh: async () => undefined,
  getBySku: (sku: string) => findProductBySku(testProducts, sku),
} as unknown as CatalogContextValue

const storeValue: StoreContextValue = {
  store: {
    name: 'SneakerHub Premium', description: '', logo: null, favicon: null, slogan: null,
    businessType: 'Calzado', primaryColor: '#222222', secondaryColor: '#D9D0C1', accentColor: '#8D806D',
    buttonColor: '#222222', coverImage: null, whatsappPhone: '+573001234567', whatsappOrders: null,
    phone: null, email: null, address: null, hours: null, instagram: null, facebook: null,
    tiktok: null, mapsUrl: null, currency: 'COP', country: 'CO', deliveryMethods: ['envio'],
    pickupAvailable: true, paymentInfo: null, defaultWhatsappMessage: '', theme: DEFAULT_THEME,
  },
  setStore: () => undefined,
  isLoading: false,
  isDemoMode: true,
  backendAvailable: false,
  storeLoadError: null,
  refreshFromApi: async () => undefined,
}

function renderProduct(path: string) {
  return renderToString(
    <MemoryRouter initialEntries={[path]}>
      <StoreContext.Provider value={storeValue}>
        <CatalogContext.Provider value={catalogValue}>
          <CartProvider>
            <Routes>
              <Route path="/product/:slug" element={<ProductPage />} />
              <Route path="/producto/:slug" element={<ProductPage />} />
            </Routes>
          </CartProvider>
        </CatalogContext.Provider>
      </StoreContext.Provider>
    </MemoryRouter>,
  )
}

describe('ficha de producto por SKU', () => {
  it.each(['/product/KINETIK-06', '/producto/KINETIK-06'])('renderiza la ficha y la foto correcta en %s', (path) => {
    const html = renderProduct(path)
    expect(html).toContain('Kinetik Aero Carbon')
    expect(html).toContain('KINETIK-06')
    expect(html).toContain('/seed-images/sneakerhub/KINETIK-06.jpg')
    expect(html).toContain('/seed-images/sneakerhub/KINETIK-06.webp')
    expect(html).toContain('Añadir al carrito')
    expect(html).toContain('Pedir por WhatsApp')
  })
})
