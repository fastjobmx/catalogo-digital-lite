// Corporate footer: brand and contact card, three link columns, a giant outlined wordmark lit by
// a violet/cyan glow, and the legal bar with "back to top". Every destination comes from site.ts.
import { site, whatsappLink } from '../config/site'
import { Logo } from '../components/brand/Logo'
import { Icon } from '../components/ui/Icon'

const NewTab = () => <span className="sr-only"> (se abre en una pestaña nueva)</span>
const link = 'group inline-flex items-center gap-1.5 py-1.5 text-[0.96rem] text-mist transition-colors hover:text-porcelain'
const Arrow = () => <Icon name="arrowRight" size={14} className="-translate-x-1 text-lime opacity-0 transition-all duration-300 group-hover:translate-x-0 group-hover:opacity-100" />

type Item = { label: string; href: string; external?: boolean }

function Column({ title, items }: { title: string; items: Item[] }) {
  return (
    <div>
      <p className="eyebrow text-cyan">{title}</p>
      <ul className="mt-4">
        {items.map((item) => (
          <li key={item.label}>
            <a href={item.href} {...(item.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})} className={link}>
              {item.label}{item.external ? <NewTab /> : null}<Arrow />
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function Footer() {
  const legal = site.legal.filter((l) => l.url)
  const product: Item[] = [
    { label: 'Funciones', href: '#funciones' },
    { label: 'Cómo funciona', href: '#como-funciona' },
    { label: 'Estudio Creativo', href: '#estudio' },
    { label: 'Tiendas reales', href: '#tiendas' },
    { label: 'Planes y precios', href: '#planes' },
  ]
  const stores: Item[] = [
    { label: 'Probar gratis', href: site.trialUrl, external: true },
    { label: 'Ingresar a mi tienda', href: site.adminLoginUrl, external: true },
    { label: 'Tienda de demostración', href: site.demoStoreUrl, external: true },
    { label: 'Solicitar mi tienda', href: '#contacto' },
  ]
  const help: Item[] = [
    { label: 'Preguntas frecuentes', href: '#preguntas' },
    { label: 'Contacto', href: '#contacto' },
    ...legal.map((l) => ({ label: l.label, href: l.url })),
  ]

  return (
    <footer className="on-dark relative overflow-hidden bg-night-deep pt-16 text-porcelain md:pt-24">
      {/* Light that falls from the closing band: a thin violet→cyan line and two soft glows. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,#c52af1_30%,#12dce7_70%,transparent)]" aria-hidden="true" />
      <div className="pointer-events-none absolute -top-40 left-1/2 h-80 w-[60rem] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(197,42,241,.22),transparent)]" aria-hidden="true" />
      <div className="pointer-events-none absolute -bottom-40 right-[-10rem] size-[36rem] rounded-full bg-[radial-gradient(closest-side,rgba(18,220,231,.12),transparent)]" aria-hidden="true" />

      <div className="wrap relative">
        <div className="grid grid-cols-2 gap-x-6 gap-y-12 lg:grid-cols-[minmax(0,1.25fr)_repeat(3,minmax(0,0.75fr))] lg:gap-10">
          <div className="col-span-2 min-w-0 lg:col-span-1">
            <Logo size="lg" />
            <p className="mt-5 max-w-sm text-[0.98rem] leading-relaxed text-mist">
              <span className="font-semibold text-porcelain">{site.slogan}</span> Tienda online con inteligencia artificial y pedidos por WhatsApp para negocios que venden por chat y redes sociales.
            </p>

            <a href={whatsappLink('Hola, quiero información sobre TiendIA Exprés.')} target="_blank" rel="noopener noreferrer" data-tilt="0.6" className="glass-dark group mt-7 flex max-w-sm items-center gap-4 rounded-2xl p-4 transition-colors hover:bg-white/8">
              <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-[#25d366] text-white shadow-[0_0_24px_-4px_rgba(37,211,102,.7)]"><Icon name="whatsapp" size={24} /></span>
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block text-[0.8rem] text-mist">¿Hablamos? Escríbenos</span>
                <span className="mt-0.5 block font-display text-[1.1rem] font-extrabold tracking-tight">{site.whatsapp.display}</span>
              </span>
              <Icon name="arrowUpRight" size={18} className="text-lime transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              <NewTab />
            </a>

            <ul className="mt-6 flex gap-2.5" aria-label="Redes sociales">
              {site.social.map((s) => (
                <li key={s.key}>
                  <a href={s.url} target="_blank" rel="noopener noreferrer" className="grid size-11 place-items-center rounded-full bg-white/6 ring-1 ring-inset ring-white/12 transition-all duration-300 hover:-translate-y-0.5 hover:bg-violet-deep hover:shadow-[0_0_24px_rgba(197,42,241,.6)] hover:ring-violet">
                    <Icon name={s.key} size={18} /><span className="sr-only">{s.label} (se abre en una pestaña nueva)</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
          <nav aria-label="Pie de página" className="contents">
            <Column title="Producto" items={product} />
            <Column title="Comercios" items={stores} />
            <Column title="Ayuda" items={help} />
          </nav>
        </div>

        {/* Giant outlined wordmark, lit from below. Decorative: the logo above carries the name. */}
        <p className="footer-wordmark pointer-events-none mt-16 select-none whitespace-nowrap text-center font-display text-[clamp(2.6rem,12.6vw,10.6rem)] font-extrabold italic leading-[0.86] tracking-[-0.05em] md:mt-20" aria-hidden="true">
          TiendIA Exprés
        </p>

        <div className="relative flex flex-col items-start justify-between gap-4 border-t border-white/10 py-7 text-[0.86rem] text-mist md:flex-row md:items-center">
          <p>© {new Date().getFullYear()} {site.wordmark}. Hecho en Colombia.</p>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>Precios en pesos colombianos (COP).</span>
            <span className="inline-flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-lime" aria-hidden="true" />Sin comisión por venta.</span>
          </p>
          <a href="#inicio" className="group inline-flex items-center gap-2 rounded-full bg-white/6 py-2 pl-4 pr-2 font-semibold text-porcelain ring-1 ring-inset ring-white/12 transition-colors hover:bg-white/10">
            Volver arriba
            <span className="grid size-7 place-items-center rounded-full bg-lime text-night transition-transform duration-300 group-hover:-translate-y-0.5"><Icon name="arrowDown" size={14} className="rotate-180" /></span>
          </a>
        </div>
      </div>
    </footer>
  )
}
