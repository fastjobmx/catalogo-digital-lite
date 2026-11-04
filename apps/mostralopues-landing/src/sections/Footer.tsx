import { nav } from '../content/copy'
import { site } from '../config/site'
import { Logo } from '../components/brand/Logo'
import { Button } from '../components/ui/primitives'
import { Icon } from '../components/ui/Icon'

export function Footer() {
  const legal = site.legal.filter((l) => l.url)
  return (
    <footer className="on-dark bg-forest-deep pb-10 pt-16 text-ivory md:pt-24">
      <div className="wrap">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          {/* The principal logo is only used on light surfaces: an ivory plate. */}
          <div className="flex flex-col justify-between gap-10 rounded-[2rem] bg-ivory p-8 text-forest md:p-12">
            <Logo width={360} className="h-auto w-[min(100%,360px)]" />
            <div>
              <p className="display text-[clamp(1.8rem,4vw,3.2rem)]"><span className="block">Si no lo mostrás,</span><span className="block">no lo vendés.</span></p>
              <div className="mt-6"><Button href="#contacto" variant="forest" size="lg" icon="arrowRight">Quiero mi tienda</Button></div>
            </div>
          </div>
          <div className="grid gap-10 rounded-[2rem] bg-forest p-8 sm:grid-cols-2 md:p-12">
            <nav aria-label="Pie de página">
              <p className="font-display text-sm font-bold text-mist">Navegación</p>
              <ul className="mt-4 space-y-1">
                {nav.map((item) => <li key={item.href}><a href={item.href} className="inline-block py-1.5 font-semibold hover:text-lime">{item.label}</a></li>)}
              </ul>
            </nav>
            <div>
              <p className="font-display text-sm font-bold text-mist">Para comercios</p>
              <ul className="mt-4 space-y-1">
                <li><a href={site.adminLoginUrl} target="_blank" rel="noopener noreferrer" className="inline-block py-1.5 font-semibold hover:text-lime">Ingresar a mi tienda<span className="sr-only"> (se abre en una pestaña nueva)</span></a></li>
                <li><a href={site.demoStoreUrl} target="_blank" rel="noopener noreferrer" className="inline-block py-1.5 font-semibold hover:text-lime">Tienda demo<span className="sr-only"> (se abre en una pestaña nueva)</span></a></li>
                <li><a href={`https://wa.me/${site.whatsapp.number}`} target="_blank" rel="noopener noreferrer" className="inline-block py-1.5 font-semibold hover:text-lime">WhatsApp {site.whatsapp.display}<span className="sr-only"> (se abre en una pestaña nueva)</span></a></li>
              </ul>
              <ul className="mt-6 flex gap-2" aria-label="Redes sociales">
                {site.social.map((s) => (
                  <li key={s.key}>
                    <a href={s.url} target="_blank" rel="noopener noreferrer" className="grid size-11 place-items-center rounded-full bg-ivory/8 ring-1 ring-ivory/10 hover:bg-lime hover:text-forest">
                      <Icon name={s.key} size={19} /><span className="sr-only">{s.label} (se abre en una pestaña nueva)</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
        <div className="mt-10 flex flex-col justify-between gap-4 border-t border-ivory/10 pt-6 text-sm text-mist md:flex-row">
          <p>© {new Date().getFullYear()} {site.name}</p>
          {legal.length ? (
            <ul className="flex flex-wrap gap-5">{legal.map((l) => <li key={l.label}><a href={l.url} className="hover:text-lime">{l.label}</a></li>)}</ul>
          ) : null}
        </div>
      </div>
    </footer>
  )
}
