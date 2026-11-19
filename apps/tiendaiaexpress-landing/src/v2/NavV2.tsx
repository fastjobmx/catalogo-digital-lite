// Header of the V2 prototype. Same behaviour as the official Nav (src/sections/Nav.tsx, untouched):
// one row on desktop, an accessible dialog on smaller screens, one trial button and one panel link.
// Only the list of links changes: five destinations that exist on this page.
import { useEffect, useRef, useState } from 'react'
import { site } from '../config/site'
import { Logo } from '../components/brand/Logo'
import { Icon } from '../components/ui/Icon'
import { Cta } from './ui'

export const navV2 = [
  { href: '#como-funciona', label: 'Cómo funciona' },
  { href: '#tiendas', label: 'Tiendas' },
  { href: '#planes', label: 'Planes' },
  { href: '#preguntas', label: 'Preguntas' },
]

export function NavV2() {
  const [open, setOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const toggle = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); toggle.current?.focus() }
      if (e.key === 'Tab' && panel.current) {
        const items = [toggle.current, ...panel.current.querySelectorAll<HTMLElement>('a, button')].filter((el): el is HTMLElement => Boolean(el))
        const first = items[0]
        const last = items[items.length - 1]
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = previous; document.removeEventListener('keydown', onKey) }
  }, [open])

  const close = () => setOpen(false)

  return (
    <>
      <a href="#contenido" className="sr-only-focusable fixed left-4 top-4 z-[70] rounded-full bg-(--v2-text) px-5 py-3 font-semibold text-(--v2-bg)">Saltar al contenido</a>
      <header className={`fixed inset-x-0 top-0 z-50 border-b bg-[rgba(0,0,0,.78)] backdrop-blur-xl backdrop-saturate-150 transition-[border-color] duration-300 ${scrolled || open ? 'border-white/10' : 'border-transparent'}`}>
        <div className="mx-auto flex h-12 w-full max-w-[64rem] items-center justify-between gap-4 px-5 sm:px-6">
          <a href="#inicio" className="shrink-0 rounded-lg" aria-label="TiendIA Exprés, ir al inicio">
            <Logo priority />
          </a>
          <nav aria-label="Principal" className="hidden flex-1 justify-center lg:flex">
            <ul className="flex items-center gap-2">
              {navV2.map((item) => (
                <li key={item.href}>
                  <a href={item.href} className="whitespace-nowrap rounded-full px-3 py-2 text-[0.8125rem] text-[#d2d2d7] transition-colors hover:text-white">{item.label}</a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="flex items-center gap-1.5 sm:gap-2">
            <a href={site.adminLoginUrl} target="_blank" rel="noopener noreferrer" className="hidden min-h-10 items-center whitespace-nowrap rounded-full px-3 text-[0.8125rem] text-[#d2d2d7] transition-colors hover:text-white md:inline-flex">
              Ingresar<span className="sr-only"> a mi tienda (se abre en una pestaña nueva)</span>
            </a>
            <Cta href={site.trialUrl} external className="!min-h-8 !px-3.5 !text-[0.8125rem] max-[439px]:hidden">Probar gratis</Cta>
            <button
              ref={toggle}
              type="button"
              className="grid size-11 place-items-center rounded-full text-[#f5f5f7] transition-colors hover:bg-white/10 lg:hidden"
              aria-expanded={open}
              aria-controls="menu-movil"
              onClick={() => setOpen((v) => !v)}
            >
              <Icon name={open ? 'close' : 'menu'} size={20} />
              <span className="sr-only">{open ? 'Cerrar menú' : 'Abrir menú'}</span>
            </button>
          </div>
        </div>
      </header>

      <div
        id="menu-movil"
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Menú"
        className={`fixed inset-0 z-40 flex flex-col bg-(--v2-bg) px-5 pb-8 pt-24 text-(--v2-text) transition-[opacity,visibility] duration-200 lg:hidden ${open ? 'visible opacity-100' : 'invisible opacity-0'}`}
      >
        <nav aria-label="Menú móvil" className="flex-1 overflow-y-auto">
          <ul className="divide-y divide-(--v2-line) border-y border-(--v2-line)">
            {navV2.map((item) => (
              <li key={item.href}>
                <a href={item.href} onClick={close} className="flex min-h-14 items-center justify-between py-3 text-[1.25rem] font-semibold tracking-[-0.02em] hover:text-(--v2-muted)">
                  {item.label}
                  <Icon name="arrowRight" size={18} className="text-(--v2-subtle)" />
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <Cta href={site.trialUrl} size="lg" external>Crear mi tienda gratis</Cta>
          <Cta href={site.adminLoginUrl} variant="secondary" size="lg" external>Ingresar a mi tienda</Cta>
        </div>
      </div>
    </>
  )
}
