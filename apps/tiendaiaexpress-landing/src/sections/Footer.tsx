import { nav } from '../content/copy'
import { site, whatsappLink } from '../config/site'
import { Logo } from '../components/brand/Logo'
import { Icon } from '../components/ui/Icon'

const link = 'inline-block py-1.5 text-[0.96rem] text-mist transition-colors hover:text-lime'
const NewTab = () => <span className="sr-only"> (se abre en una pestaña nueva)</span>

export function Footer() {
  const legal = site.legal.filter((l) => l.url)
  return (
    <footer className="on-dark bg-forest-deep pb-10 pt-16 text-ivory md:pt-20">
      <div className="wrap">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1.3fr)_repeat(3,minmax(0,0.7fr))] lg:gap-10">
          <div>
            <Logo size="lg" />
            <p className="mt-5 max-w-sm text-[0.98rem] leading-relaxed text-mist">{site.slogan} Catálogo digital con pedidos por WhatsApp para negocios que venden por chat y redes sociales.</p>
            <ul className="mt-6 flex gap-2" aria-label="Redes sociales">
              {site.social.map((s) => (
                <li key={s.key}>
                  <a href={s.url} target="_blank" rel="noopener noreferrer" className="grid size-11 place-items-center rounded-full bg-white/6 ring-1 ring-inset ring-white/10 transition-colors hover:bg-lime hover:text-forest">
                    <Icon name={s.key} size={18} /><span className="sr-only">{s.label} (se abre en una pestaña nueva)</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
          <nav aria-label="Pie de página">
            <p className="eyebrow text-ivory">Producto</p>
            <ul className="mt-4">
              {nav.map((item) => <li key={item.href}><a href={item.href} className={link}>{item.label}</a></li>)}
              <li><a href="#estudio" className={link}>Estudio Creativo</a></li>
            </ul>
          </nav>
          <div>
            <p className="eyebrow text-ivory">Comercios</p>
            <ul className="mt-4">
              <li><a href={site.trialUrl} target="_blank" rel="noopener noreferrer" className={link}>Probar gratis<NewTab /></a></li>
              <li><a href={site.adminLoginUrl} target="_blank" rel="noopener noreferrer" className={link}>Ingresar a mi tienda<NewTab /></a></li>
              <li><a href={site.demoStoreUrl} target="_blank" rel="noopener noreferrer" className={link}>Tienda de demostración<NewTab /></a></li>
              <li><a href="#contacto" className={link}>Solicitar mi tienda</a></li>
            </ul>
          </div>
          <div>
            <p className="eyebrow text-ivory">Contacto</p>
            <ul className="mt-4">
              <li><a href={whatsappLink()} target="_blank" rel="noopener noreferrer" className={`${link} inline-flex items-center gap-2`}><Icon name="whatsapp" size={16} className="text-lime" />{site.whatsapp.display}<NewTab /></a></li>
              {legal.map((l) => <li key={l.label}><a href={l.url} className={link}>{l.label}</a></li>)}
            </ul>
          </div>
        </div>
        <div className="mt-14 flex flex-col justify-between gap-3 border-t border-white/10 pt-6 text-[0.86rem] text-mist md:flex-row">
          <p>© {new Date().getFullYear()} {site.wordmark}. Hecho en Colombia.</p>
          <p>Precios en pesos colombianos (COP). Sin comisión por venta.</p>
        </div>
      </div>
    </footer>
  )
}
