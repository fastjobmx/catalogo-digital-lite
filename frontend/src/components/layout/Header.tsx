import { useState, useEffect, useRef } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { Search, ShoppingBag, Menu, X, Phone, Clock, ChevronRight, MessageCircle, ArrowRight } from 'lucide-react'
import { useStore } from '../../contexts/StoreContext'
import { useCart } from '../../contexts/CartContext'
import { useCatalog } from '../../contexts/CatalogContext'
import { whatsappLink } from '../../lib/whatsapp'
import { IS_PUBLIC_DEMO } from '../../lib/publicDemo'
import { templateLayout } from '../../lib/templateLayouts'

/** Enlace de navegación con estado activo sutil (subrayado fino). */
function NavLink({ to, children, active }: { to: string; children: React.ReactNode; active?: boolean }) {
  return (
    <Link
      to={to}
      className={`relative inline-flex items-center h-full px-3 text-[13px] font-medium tracking-[0.01em]
                  transition-colors after:absolute after:left-3 after:right-3 after:bottom-0 after:h-px
                  after:bg-current after:transition-transform after:duration-200
                  ${active ? 'text-ink after:scale-x-100' : 'text-muted hover:text-ink after:scale-x-0 hover:after:scale-x-100'}`}
    >
      {children}
    </Link>
  )
}

export default function Header() {
  const { store } = useStore()
  const { totalItems } = useCart()
  const { categories } = useCatalog()
  const navigate = useNavigate()
  const location = useLocation()
  const headerLayout = templateLayout(store.theme.template).header
  const centered = headerLayout === 'centered'
  const compact = headerLayout === 'compact'
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)

  const header = store.theme.header
  const navCategories = categories.slice(0, 5)
  const whatsapp = IS_PUBLIC_DEMO ? null : whatsappLink(store.whatsappPhone, store.defaultWhatsappMessage)

  // Cierra los paneles al cambiar de ruta
  useEffect(() => {
    setMobileMenuOpen(false)
    setSearchOpen(false)
  }, [location.pathname])

  // Bloquea el scroll del fondo cuando hay un panel abierto y permite cerrar con Esc
  useEffect(() => {
    const open = mobileMenuOpen || searchOpen
    document.body.style.overflow = open ? 'hidden' : ''
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setMobileMenuOpen(false)
      setSearchOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', onKey)
    }
  }, [mobileMenuOpen, searchOpen])

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus()
  }, [searchOpen])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    const query = searchQuery.trim()
    if (!query) return
    navigate(`/search?q=${encodeURIComponent(query)}`)
    setSearchQuery('')
    setMobileMenuOpen(false)
    setSearchOpen(false)
  }

  const openCart = () => document.dispatchEvent(new CustomEvent('open-cart'))

  return (
    <header className={`header--${headerLayout} ${header.sticky ? 'sticky top-0 z-40' : 'relative z-40'}`} data-header-layout={headerLayout}>
      {/* Barra informativa configurable */}
      {header.topbarEnabled && (
        <div className="bg-ink text-canvas">
          <div className="shell flex items-center justify-between gap-6 h-9">
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] truncate">
              {header.topbarText || store.slogan}
            </p>
            <div className="hidden sm:flex items-center gap-5 text-[11px] tracking-wide text-canvas/75">
              {store.hours && (
                <span className="flex items-center gap-1.5">
                  <Clock size={12} aria-hidden="true" /> {store.hours}
                </span>
              )}
              {!IS_PUBLIC_DEMO && header.showContact && store.phone && (
                <a href={`tel:${store.phone}`} className="flex items-center gap-1.5 hover:text-canvas transition-colors">
                  <Phone size={12} aria-hidden="true" /> {store.phone}
                </a>
              )}
              {header.showContact && whatsapp && (
                <a
                  href={whatsapp}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 hover:text-canvas transition-colors"
                >
                  <MessageCircle size={12} aria-hidden="true" /> WhatsApp
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Barra principal */}
      <div className={`bg-surface/92 backdrop-blur-md border-b border-line ${header.sticky ? 'supports-[backdrop-filter]:bg-surface/85' : ''}`}>
        <div className={`shell relative flex items-center gap-2 sm:gap-6 ${compact ? 'h-[56px] lg:h-[60px]' : 'h-[64px] lg:h-[76px]'}`}>
          <button
            onClick={() => setMobileMenuOpen(true)}
            className="lg:hidden -ml-2 p-2.5 text-ink hover:opacity-60 transition-opacity"
            aria-label="Abrir menú de navegación"
            aria-expanded={mobileMenuOpen}
          >
            <Menu size={22} strokeWidth={1.6} />
          </button>

          {/* Marca: logo gráfico o wordmark tipográfico */}
          <Link to="/" className={`flex items-center gap-2.5 shrink-0 min-h-[44px] ${centered ? 'lg:absolute lg:left-1/2 lg:-translate-x-1/2' : ''}`} aria-label={`${store.name} — inicio`}>
            {store.logo ? (
              <img
                src={store.logo}
                alt={store.name}
                className="h-8 lg:h-10 w-auto max-w-[170px] object-contain"
              />
            ) : (
              <span className="font-display text-[15px] sm:text-[17px] lg:text-[19px] font-extrabold uppercase tracking-[0.16em] text-ink whitespace-nowrap">
                {store.name}
              </span>
            )}
          </Link>

          {/* Navegación de escritorio */}
          <nav className={`${centered ? 'hidden' : 'hidden lg:flex'} items-stretch self-stretch ml-4`} aria-label="Categorías">
            <NavLink to="/category/all" active={location.pathname === '/category/all'}>Catálogo</NavLink>
            {navCategories.map((cat) => (
              <NavLink
                key={cat.slug}
                to={`/category/${cat.slug}`}
                active={location.pathname === `/category/${cat.slug}`}
              >
                {cat.name}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-1 ml-auto">
            {/* Buscador de escritorio */}
            <form onSubmit={handleSearch} role="search" className="hidden md:block mr-2">
              <div className="relative">
                <Search className="absolute left-0 top-1/2 -translate-y-1/2 text-muted pointer-events-none" size={16} aria-hidden="true" />
                <input
                  type="search"
                  placeholder="Buscar en la tienda"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  aria-label="Buscar productos"
                  className="w-40 lg:w-52 pl-6 pr-2 py-2 bg-transparent border-0 border-b border-line text-[13px]
                             placeholder:text-muted focus:outline-none focus:border-ink focus:ring-0 transition-colors"
                />
              </div>
            </form>

            {!IS_PUBLIC_DEMO && header.showContact && (
              <a
                href={whatsapp || `tel:${store.phone || ''}`}
                target={whatsapp ? '_blank' : undefined}
                rel={whatsapp ? 'noopener noreferrer' : undefined}
                className="hidden sm:grid place-items-center w-10 h-10 text-ink hover:opacity-60 transition-opacity"
                aria-label="Contactar por WhatsApp"
              >
                <MessageCircle size={19} strokeWidth={1.6} />
              </a>
            )}

            <button
              onClick={() => setSearchOpen(true)}
              className="md:hidden grid place-items-center w-10 h-10 text-ink hover:opacity-60 transition-opacity"
              aria-label="Buscar productos"
            >
              <Search size={20} strokeWidth={1.6} />
            </button>

            <button
              onClick={openCart}
              className="relative grid place-items-center w-11 h-11 text-ink hover:opacity-60 transition-opacity"
              aria-label={`Abrir carrito, ${totalItems} ${totalItems === 1 ? 'artículo' : 'artículos'}`}
            >
              <ShoppingBag size={20} strokeWidth={1.6} />
              {totalItems > 0 && (
                <span
                  className="absolute top-1 right-0.5 min-w-[17px] h-[17px] px-1 grid place-items-center
                             bg-ink text-canvas text-[10px] font-semibold rounded-full tabular-nums"
                  aria-hidden="true"
                >
                  {totalItems > 99 ? '99+' : totalItems}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>

      {centered && (
        <nav className="hidden lg:flex justify-center h-11 border-b border-line bg-surface/92 backdrop-blur-md" aria-label="Categorías">
          <NavLink to="/category/all" active={location.pathname === '/category/all'}>Catálogo</NavLink>
          {navCategories.map((cat) => (
            <NavLink key={cat.slug} to={`/category/${cat.slug}`} active={location.pathname === `/category/${cat.slug}`}>
              {cat.name}
            </NavLink>
          ))}
        </nav>
      )}

      {/* Buscador móvil */}
      {searchOpen && (
        <div className="md:hidden fixed inset-0 z-50 bg-surface animate-fade-in">
          <div className="shell pt-4">
            <div className="flex items-center justify-between mb-6">
              <span className="eyebrow text-muted">Buscar</span>
              <button
                onClick={() => setSearchOpen(false)}
                className="grid place-items-center w-10 h-10 -mr-2 text-ink"
                aria-label="Cerrar buscador"
              >
                <X size={22} strokeWidth={1.6} />
              </button>
            </div>
            <form onSubmit={handleSearch} role="search">
              <div className="relative border-b border-ink pb-3">
                <Search className="absolute left-0 top-1/2 -translate-y-1/2 text-muted" size={20} aria-hidden="true" />
                <input
                  ref={searchInputRef}
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="¿Qué estás buscando?"
                  aria-label="Buscar productos"
                  className="w-full pl-8 bg-transparent border-0 text-lg focus:outline-none focus:ring-0"
                />
              </div>
              <button type="submit" className="btn-brand w-full mt-5">
                Buscar <ArrowRight size={16} />
              </button>
            </form>

            {categories.length > 0 && (
              <div className="mt-8">
                <p className="eyebrow text-muted mb-3">Categorías</p>
                <div className="flex flex-wrap gap-2">
                  {categories.map((cat) => (
                    <Link key={cat.slug} to={`/category/${cat.slug}`} className="chip" onClick={() => setSearchOpen(false)}>
                      {cat.name}
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Menú móvil */}
      {mobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-ink/50 animate-fade-in"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />
          <div
            className="absolute left-0 top-0 bottom-0 w-[88%] max-w-sm bg-surface flex flex-col animate-slide-in-right"
            role="dialog"
            aria-modal="true"
            aria-label="Menú de navegación"
          >
            <div className="flex items-center justify-between px-5 h-[64px] border-b border-line">
              <span className="font-display text-sm font-extrabold uppercase tracking-[0.16em] text-ink truncate">
                {store.name}
              </span>
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="grid place-items-center w-10 h-10 -mr-2 text-ink"
                aria-label="Cerrar menú"
              >
                <X size={22} strokeWidth={1.6} />
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto py-3" aria-label="Categorías">
              <Link
                to="/category/all"
                className="flex items-center justify-between px-5 py-4 text-[15px] font-medium text-ink hover:bg-canvas transition-colors"
              >
                Todo el catálogo <ChevronRight size={17} className="text-muted" />
              </Link>
              {categories.map((cat) => (
                <Link
                  key={cat.slug}
                  to={`/category/${cat.slug}`}
                  className="flex items-center justify-between px-5 py-4 text-[15px] text-ink hover:bg-canvas transition-colors"
                >
                  {cat.name}
                  <span className="text-[11px] text-muted tabular-nums">{cat.productCount}</span>
                </Link>
              ))}
            </nav>

            <div className="px-5 py-5 border-t border-line space-y-3">
              {whatsapp && (
                <a href={whatsapp} target="_blank" rel="noopener noreferrer" className="btn-brand w-full">
                  <MessageCircle size={17} /> Escribir por WhatsApp
                </a>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-muted">
                {store.hours && <span>{store.hours}</span>}
              {!IS_PUBLIC_DEMO && store.phone && (
                  <a href={`tel:${store.phone}`} className="hover:text-ink transition-colors">{store.phone}</a>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </header>
  )
}
