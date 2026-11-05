import { useEffect, useRef, useState } from 'react'
import { nav } from '../content/copy'
import { site } from '../config/site'
import { Logo } from '../components/brand/Logo'
import { Icon } from '../components/ui/Icon'
import { Button } from '../components/ui/primitives'

export function Nav() {
  const [open, setOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const toggle = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panel.current?.querySelector<HTMLElement>('a')?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); toggle.current?.focus() }
      if (e.key === 'Tab' && panel.current) {
        const items = [...panel.current.querySelectorAll<HTMLElement>('a, button')]
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
      <a href="#contenido" className="sr-only-focusable fixed left-4 top-4 z-[70] rounded-full bg-forest px-5 py-3 font-semibold text-ivory">Saltar al contenido</a>
      <header className="pointer-events-none fixed inset-x-0 top-0 z-50 px-2.5 pt-2.5 md:px-5 md:pt-4">
        <div className={`pointer-events-auto mx-auto flex max-w-[88rem] items-center justify-between gap-4 rounded-full bg-ivory/90 py-2 pl-4 pr-2 ring-1 ring-forest/8 backdrop-blur-xl transition-shadow duration-500 md:pl-6 ${scrolled ? 'shadow-[0_18px_40px_-24px_rgba(10,33,26,.55)]' : ''}`}>
          <a href="#inicio" className="shrink-0 rounded-lg" aria-label="Tienda IA Express, ir al inicio">
            <Logo width={150} priority decorative className="h-auto w-[118px] rounded-lg md:w-[150px]" />
          </a>
          <nav aria-label="Principal" className="hidden xl:block">
            <ul className="flex items-center gap-1">
              {nav.slice(1).map((item) => (
                // "Contacto" is the same destination as "Quiero mi tienda": shown only when there is room.
                <li key={item.href} className={item.href === '#contacto' ? 'hidden 2xl:block' : undefined}>
                  <a href={item.href} className="whitespace-nowrap rounded-full px-2.5 py-2 text-[0.86rem] font-semibold text-forest/80 transition-colors hover:bg-forest/6 hover:text-forest 2xl:px-3 2xl:text-[0.88rem]">{item.label}</a>
                </li>
              ))}
              <li>
                <a href={site.trialUrl} target="_blank" rel="noopener noreferrer" className="ml-1 inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-lime/35 px-3 py-2 text-[0.86rem] font-bold text-forest ring-1 ring-forest/10 transition-colors hover:bg-lime">
                  Prueba gratis<span className="sr-only"> (se abre en una pestaña nueva)</span>
                </a>
              </li>
            </ul>
          </nav>
          <div className="flex items-center gap-2">
            <a href={site.trialUrl} target="_blank" rel="noopener noreferrer" className="inline-flex whitespace-nowrap rounded-full px-3 py-2.5 text-[0.78rem] font-bold uppercase tracking-wide text-forest ring-1 ring-forest/15 hover:bg-lime/40 md:text-[0.85rem] xl:hidden">
              Prueba gratis<span className="sr-only"> (se abre en una pestaña nueva)</span>
            </a>
            <a href={site.adminLoginUrl} target="_blank" rel="noopener noreferrer" className="hidden whitespace-nowrap rounded-full px-4 py-2.5 text-[0.85rem] font-bold uppercase tracking-wide text-forest hover:bg-forest/6 md:inline-flex">
              Ingresar<span className="xl:hidden 2xl:inline">&nbsp;a mi tienda</span><span className="sr-only"> (se abre en una pestaña nueva)</span>
            </a>
            <span className="hidden min-[600px]:block"><Button href="#contacto" variant="lime">Quiero mi tienda</Button></span>
            <button
              ref={toggle}
              type="button"
              className="grid size-12 place-items-center rounded-full bg-forest text-ivory xl:hidden"
              aria-expanded={open}
              aria-controls="menu-movil"
              onClick={() => setOpen((v) => !v)}
            >
              <Icon name={open ? 'close' : 'menu'} size={22} />
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
        className={`on-dark fixed inset-0 z-40 flex flex-col bg-forest px-5 pb-8 pt-28 text-ivory transition-[opacity,visibility] duration-500 xl:hidden ${open ? 'visible opacity-100' : 'invisible opacity-0'}`}
      >
        <nav aria-label="Menú móvil" className="flex-1 overflow-y-auto">
          <ul className="space-y-1">
            {nav.map((item, i) => (
              <li key={item.href} style={{ transitionDelay: open ? `${80 + i * 40}ms` : '0ms' }} className={`transition-[opacity,transform] duration-500 ${open ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'}`}>
                <a href={item.href} onClick={close} className="block py-2 font-display text-[clamp(2rem,9vw,3.2rem)] font-bold uppercase leading-none tracking-tight hover:text-lime">{item.label}</a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <Button href="#contacto" variant="lime" size="lg" icon="arrowRight" onClick={close}>Quiero mi tienda</Button>
          <Button href={site.trialUrl} variant="ivory" size="lg" icon="arrowUpRight" external>Prueba gratis, sin registro</Button>
          <Button href={site.adminLoginUrl} variant="outline-light" size="lg" icon="arrowUpRight" external>Ingresar a mi tienda</Button>
        </div>
      </div>
    </>
  )
}
