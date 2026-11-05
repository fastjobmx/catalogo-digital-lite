import { useState, useEffect, useRef } from 'react'
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Package, Boxes, Tag, Settings, LogOut, Bot, Sparkles, ClipboardList,
  Palette, Menu, X, ExternalLink, ChevronRight, CircleUserRound, Building2, Coins, FileUp,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useStore } from '../contexts/StoreContext'

interface AdminNavItem {
  to: string
  activeTo?: string
  icon: LucideIcon
  label: string
  exact?: boolean
}

interface AdminNavGroup {
  label: string
  items: AdminNavItem[]
}

export const ADMIN_NAV_GROUPS: AdminNavGroup[] = [
  {
    label: 'General',
    items: [
      { to: '/admin', icon: LayoutDashboard, label: 'Resumen', exact: true },
    ],
  },
  {
    label: 'Catálogo', items: [
      { to: '/admin/products', icon: Package, label: 'Productos' },
      { to: '/admin/products#inventory', activeTo: '/admin/products', icon: Boxes, label: 'Inventario' },
      { to: '/admin/categories', icon: Tag, label: 'Categorías' },
      { to: '/admin/importar', icon: FileUp, label: 'Importar' },
    ],
  },
  {
    label: 'Ventas', items: [
      { to: '/admin/orders', icon: ClipboardList, label: 'Pedidos' },
    ],
  },
  {
    label: 'Personalización',
    items: [
      { to: '/admin/appearance', icon: Palette, label: 'Apariencia' },
      { to: '/admin/settings', icon: Settings, label: 'Configuración' },
    ],
  },
  {
    label: 'Herramientas',
    items: [
      { to: '/admin/onboarding', icon: Sparkles, label: 'Cuestionario' },
      { to: '/admin/simulator', icon: Bot, label: 'Simulador IA' },
      { to: '/admin/creditos', icon: Coins, label: 'Créditos IA' },
    ],
  },
]

export function isAdminLinkActive(pathname: string, hash: string, item: AdminNavItem): boolean {
  const activeTo = item.activeTo || item.to.split('#')[0] || item.to
  const pathMatches = item.exact
    ? pathname === activeTo
    : pathname === activeTo || pathname.startsWith(`${activeTo}/`)
  if (!pathMatches) return false
  if (item.to.includes('#')) return hash === item.to.slice(item.to.indexOf('#'))
  return hash !== '#inventory'
}

export default function AdminLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const { email, logout, isDemoSession, role } = useAuth()
  const { store, backendAvailable } = useStore()
  const [mobileOpen, setMobileOpen] = useState(false)
  const menuTriggerRef = useRef<HTMLButtonElement>(null)
  const mobileMenuRef = useRef<HTMLDivElement>(null)
  const closeMenu = () => { setMobileOpen(false); menuTriggerRef.current?.focus() }

  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (!mobileOpen) return
    const menu = mobileMenuRef.current
    const focusable = () => menu?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')
    focusable()?.[0]?.focus()
    const handleMenuKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeMenu()
        return
      }
      if (event.key !== 'Tab') return
      const elements = Array.from(focusable() || [])
      if (!elements.length) return
      const first = elements[0]!
      const last = elements[elements.length - 1]!
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleMenuKey)
    return () => {
      document.removeEventListener('keydown', handleMenuKey)
      if (menu?.contains(document.activeElement)) menuTriggerRef.current?.focus()
    }
  }, [mobileOpen])

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [mobileOpen])

  const handleLogout = () => {
    logout()
    navigate('/admin/login', { replace: true })
  }

  const pageSection = ADMIN_NAV_GROUPS.find((group) => group.items.some((item) =>
    isAdminLinkActive(location.pathname, location.hash, item),
  ))?.label ?? 'Panel'

  const NavLinks = ({ onNavigate }: { onNavigate?: () => void }) => (
    <nav className="flex-1 min-h-0 overflow-y-auto px-3 py-5 space-y-5" aria-label="Navegación administrativa">
      {ADMIN_NAV_GROUPS.map((group) => (
        <div key={group.label}>
          <p className="px-3 mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-ink/55">
            {group.label}
          </p>
          <div className="space-y-1">
            {group.items.map(({ to, icon: Icon, label, ...item }) => {
              const active = isAdminLinkActive(location.pathname, location.hash, { to, ...item, icon: Icon, label })
              return (
                <Link
                  key={to}
                  to={to}
                  onClick={onNavigate}
                  aria-current={active ? 'page' : undefined}
                  className={`relative flex items-center gap-3 px-3 py-2.5 rounded-btn text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 ${
                    active
                      ? 'bg-brand/10 text-ink'
                      : 'text-ink/75 hover:bg-white hover:text-ink'
                  }`}
                >
                  {active && (
                    <span className="absolute inset-y-2 left-0 w-1 rounded-full bg-brand" aria-hidden="true" />
                  )}
                  <Icon size={18} className={`shrink-0 ${active ? 'text-brand' : 'text-muted'}`} aria-hidden="true" />
                  {label}
                </Link>
              )
            })}
          </div>
        </div>
      ))}
    </nav>
  )

  const SidebarFooter = ({ onNavigate }: { onNavigate?: () => void }) => (
    <div className="p-3 border-t border-line space-y-1 shrink-0">
      <div className="flex items-center gap-2.5 px-3 py-3 mb-1 rounded-btn bg-white/70">
        <CircleUserRound size={18} className="text-brand shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted">Sesión de administrador</p>
          <p className="text-xs font-semibold text-ink truncate" title={email || ''}>{email || 'Usuario administrador'}</p>
        </div>
      </div>
      {role === 'superadmin' && (
        <Link
          to="/plataforma"
          onClick={onNavigate}
          className="flex items-center gap-3 px-3 py-2.5 rounded-btn text-sm font-semibold text-brand bg-brand/10 hover:bg-brand/15 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <Building2 size={18} />
          Plataforma · todas las tiendas
        </Link>
      )}
      <Link
        to="/"
        target="_blank"
        onClick={onNavigate}
        className="flex items-center gap-3 px-3 py-2.5 rounded-btn text-sm font-semibold text-ink/75 hover:bg-white hover:text-ink transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        <ExternalLink size={18} />
        Ver tienda
      </Link>
      <button
        onClick={handleLogout}
        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-btn text-sm font-semibold text-ink/75 hover:bg-red-50 hover:text-red-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
      >
        <LogOut size={18} />
        Cerrar sesión
      </button>
    </div>
  )

  const Brand = () => (
    <div className="flex items-center gap-3 px-5 h-20 border-b border-white/10 bg-ink shrink-0">
      {store.logo ? (
        <img src={store.logo} alt={store.name} className="h-10 w-auto object-contain" />
      ) : (
        <span className="grid place-items-center w-10 h-10 rounded-btn bg-brand text-brand-foreground font-black text-lg shrink-0">
          {store.name.trim().charAt(0).toUpperCase()}
        </span>
      )}
      <div className="min-w-0">
        <p className="text-sm font-black tracking-tight text-canvas leading-tight truncate">
          {store.name}
        </p>
        <p className="text-[10px] font-bold uppercase tracking-widest text-canvas/40 mt-0.5 truncate" title={email || ''}>
          Panel administrativo
        </p>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-canvas flex">
      {/* Sidebar de escritorio */}
      <aside className="w-[250px] h-screen sticky top-0 bg-canvas border-r border-line hidden md:flex flex-col shrink-0">
        <Brand />
        <NavLinks />
        <SidebarFooter />
      </aside>

      {/* Sidebar móvil */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Menú administrativo">
          <button type="button" className="absolute inset-0 w-full bg-black/45 backdrop-blur-sm animate-fade-in" onClick={closeMenu} aria-label="Cerrar menú" />
          <div ref={mobileMenuRef} id="admin-mobile-menu" className="absolute left-0 top-0 bottom-0 w-[82%] max-w-[300px] bg-canvas flex flex-col shadow-card animate-slide-in-right">
            <div className="flex items-center justify-between pr-3">
              <Brand />
              <button
                onClick={closeMenu}
                className="p-2 rounded-btn text-canvas/70 hover:bg-canvas/10 transition-colors"
                aria-label="Cerrar menú"
              >
                <X size={20} />
              </button>
            </div>
            <NavLinks onNavigate={closeMenu} />
            <SidebarFooter onNavigate={closeMenu} />
          </div>
        </div>
      )}

      {/* Contenido */}
      <main className="flex-1 min-w-0 overflow-y-auto">
        {/* Cabecera adaptable */}
        <header className="sticky top-0 z-30 flex items-center gap-3 h-16 px-4 sm:px-6 lg:px-8 bg-surface/90 backdrop-blur-xl border-b border-line">
          <button
            ref={menuTriggerRef}
            onClick={() => setMobileOpen(true)}
            className="md:hidden p-2 -ml-2 rounded-btn text-ink hover:bg-canvas transition-colors"
            aria-label="Abrir menú"
            aria-expanded={mobileOpen}
            aria-controls="admin-mobile-menu"
          >
            <Menu size={22} />
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-1 text-[11px] text-muted"><span>Panel</span><ChevronRight size={13}/><span className="font-semibold text-ink truncate">{pageSection}</span></div>
          </div>
          <span className={`ml-auto inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ${backendAvailable && !isDemoSession ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${backendAvailable && !isDemoSession ? 'bg-emerald-500' : 'bg-amber-500'}`}/>{isDemoSession ? 'Demo local' : backendAvailable ? 'Servicio conectado' : 'Modo sin conexión'}
          </span>
          <Link to="/" target="_blank" className="inline-flex items-center gap-2 p-2 rounded-btn text-muted hover:bg-canvas hover:text-ink transition-colors" aria-label="Ver tienda">
            <ExternalLink size={18} /><span className="hidden sm:inline text-xs font-semibold">Ver tienda</span>
          </Link>
          <details className="relative">
            <summary className="list-none cursor-pointer grid h-9 w-9 place-items-center rounded-full border border-line bg-canvas text-ink" aria-label="Menú de usuario"><CircleUserRound size={18}/></summary>
            <div className="absolute right-0 top-11 z-40 w-56 rounded-card border border-line bg-surface p-3 shadow-card">
              <p className="truncate px-2 py-2 text-xs text-muted" title={email || ''}>{email || 'Usuario administrador'}</p>
              <button onClick={handleLogout} className="flex w-full items-center gap-2 rounded-btn px-2 py-2 text-left text-sm text-ink hover:bg-canvas"><LogOut size={16}/> Cerrar sesión</button>
            </div>
          </details>
        </header>

        <div className="p-5 sm:p-6 lg:p-8 max-w-6xl mx-auto">
          {isDemoSession && (
            <p className="mb-6 rounded-card border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950" role="status">
              Sesión demo local. Los cambios quedan en este navegador; no se enviarán al Worker ni a otra tienda.
            </p>
          )}
          <Outlet />
        </div>
      </main>
    </div>
  )
}
