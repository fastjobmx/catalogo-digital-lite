import { useEffect, useRef, useState } from 'react'
import { nav } from '../content/copy'
import { site } from '../config/site'
import { Logo } from '../components/brand/Logo'
import { Icon } from '../components/ui/Icon'
import { Button } from '../components/ui/primitives'

/** Compact header: one row of links on desktop, an accessible dialog on smaller screens.
 * One destination per control: "Probar gratis" (trial) and "Ingresar a mi tienda" (panel). */
export function Nav() {
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
        // The close button lives in the header, above the panel: it is part of the focus cycle.
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
      <a href="#contenido" className="sr-only-focusable fixed left-4 top-4 z-[70] rounded-full bg-lime px-5 py-3 font-semibold text-night">Saltar al contenido</a>
      <header className={`on-dark fixed inset-x-0 top-0 z-50 border-b transition-[background-color,border-color,box-shadow] duration-500 ${scrolled || open ? 'border-white/10 bg-night/85 shadow-[0_18px_40px_-28px_rgba(0,0,0,.8)] backdrop-blur-xl' : 'border-transparent bg-night/0'}`}>
        <div className="wrap flex h-16 items-center justify-between gap-4 lg:h-[4.5rem]">
          <a href="#inicio" className="shrink-0 rounded-lg" aria-label="TiendIA Exprés, ir al inicio">
            <Logo priority />
          </a>
          <nav aria-label="Principal" className="hidden lg:block">
            <ul className="flex items-center">
              {nav.map((item) => (
                <li key={item.href}>
                  <a href={item.href} className="whitespace-nowrap rounded-full px-2.5 py-2 text-[0.9rem] font-semibold text-porcelain/80 transition-colors hover:bg-white/8 hover:text-porcelain xl:px-3.5">{item.label}</a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="flex items-center gap-1.5 sm:gap-2">
            <a href={site.adminLoginUrl} target="_blank" rel="noopener noreferrer" className="hidden whitespace-nowrap rounded-full px-3.5 py-2 text-[0.92rem] font-semibold text-porcelain/80 transition-colors hover:bg-white/8 hover:text-porcelain md:inline-flex">
              Ingresar<span className="lg:hidden xl:inline">&nbsp;a mi tienda</span><span className="sr-only"> (se abre en una pestaña nueva)</span>
            </a>
            <Button href={site.trialUrl} variant="lime" size="sm" lead="store" external className="max-[439px]:hidden"><span className="hidden 2xl:inline">Crear mi tienda gratis</span><span className="2xl:hidden">Probar gratis</span></Button>
            <button
              ref={toggle}
              type="button"
              className="grid size-11 place-items-center rounded-full text-porcelain ring-1 ring-inset ring-white/20 transition-colors hover:bg-white/8 lg:hidden"
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
        className={`on-dark fixed inset-0 z-40 flex flex-col bg-night px-5 pb-8 pt-24 text-porcelain transition-[opacity,visibility] duration-300 lg:hidden ${open ? 'visible opacity-100' : 'invisible opacity-0'}`}
      >
        <nav aria-label="Menú móvil" className="flex-1 overflow-y-auto">
          <ul className="divide-y divide-white/10 border-y border-white/10">
            {nav.map((item, i) => (
              <li key={item.href} style={{ transitionDelay: open ? `${60 + i * 35}ms` : '0ms' }} className={`transition-[opacity,transform] duration-500 ${open ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'}`}>
                <a href={item.href} onClick={close} className="flex items-center justify-between py-4 font-display text-[1.5rem] font-bold tracking-tight hover:text-lime">
                  {item.label}
                  <Icon name="arrowRight" size={20} className="text-porcelain/40" />
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <Button href={site.trialUrl} variant="lime" size="lg" icon="arrowUpRight" external>Probar gratis</Button>
          <Button href={site.adminLoginUrl} variant="outline-light" size="lg" icon="arrowUpRight" external>Ingresar a mi tienda</Button>
        </div>
      </div>
    </>
  )
}
