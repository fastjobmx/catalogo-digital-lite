// V2 footer (second design). Everything comes from site.ts: destinations, the official WhatsApp, the official
// mailboxes (confirmed by the owner), social profiles and legal pages. Layout after 21st.dev «Footer with Big
// Wordmark» (MIT), Apple-quiet: a brand column with the main action and the direct contacts, three link
// columns that follow the page's order (they fold on phones), a bottom line with the legal pages and «Volver
// arriba». Dark, as the continuation of the finale: the brand name closes the page standing on the same
// reflective stage (Google Flow), with its reflection on the floor, and turns slightly toward a fine pointer
// (decorative). No status line and no office hours: nothing on the page claims availability.
import { site, whatsappLink } from '../config/site'
import { Logo } from '../components/brand/Logo'
import { Icon } from '../components/ui/Icon'
import { Cta, wrap } from './ui'
import stage from '../assets/v2/finale-stage.webp'

type Item = { label: string; href: string; external?: boolean }
type Col = { title: string; items: Item[] }

const ext = (item: Item) => (item.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})
const newTab = <span className="sr-only"> (se abre en una pestaña nueva)</span>

/** The three columns, in the order of the page; the same for the desktop grid and the folding rows on phones. */
const COLUMNS: Col[] = [
  { title: 'Producto', items: [
    { label: 'Cómo funciona', href: '#como-funciona' },
    { label: 'Qué ve tu cliente', href: '#comprar' },
    { label: 'Administra por chat', href: '#administracion' },
    { label: 'Tiendas reales', href: '#tiendas' },
    { label: 'Estudio Creativo', href: '#estudio' },
    { label: 'Planes y precios', href: '#planes' },
  ] },
  { title: 'Comercios', items: [
    { label: 'Probar gratis', href: site.trialUrl, external: true },
    { label: 'Ingresar a mi tienda', href: site.adminLoginUrl, external: true },
    { label: 'Tienda de demostración', href: site.demoStoreUrl, external: true },
    { label: 'Empieza en 3 pasos', href: '#empieza' },
    { label: 'Solicitar mi tienda', href: '#contacto' },
  ] },
  { title: 'Ayuda', items: [
    { label: 'Preguntas frecuentes', href: '#preguntas' },
    { label: 'Condiciones comerciales', href: '#condiciones' },
    { label: 'Contacto', href: '#contacto' },
  ] },
]

function Column({ col }: { col: Col }) {
  return (
    <div>
      <p className="text-[0.8125rem] font-semibold text-(--v2-text)">{col.title}</p>
      <ul className="mt-3">
        {col.items.map((item) => (
          <li key={item.label}>
            <a href={item.href} {...ext(item)} className="inline-flex min-h-9 items-center text-[0.875rem] text-(--v2-subtle) transition-colors hover:text-(--v2-text)">{item.label}{item.external ? newTab : null}</a>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function FooterV2() {
  // Legal pages with a page of their own (the commercial conditions are an anchor of this page, in «Ayuda»).
  const legal = site.legal.filter((l) => l.url && !l.url.startsWith('#'))
  return (
    <footer className="v2-footer overflow-hidden bg-black pt-16 md:pt-24">
      <div className={wrap}>
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,2fr)] lg:gap-16">
          <div>
            <Logo />
            <p className="mt-4 max-w-sm text-[0.9375rem] leading-relaxed text-(--v2-muted)">{site.slogan} Tu tienda online con pedidos por WhatsApp, administrada desde un chat privado.</p>
            <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2">
              <Cta href={site.trialUrl} external>Probar gratis</Cta>
              <a href={site.adminLoginUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-[0.9375rem] text-(--v2-text) underline-offset-4 after:ml-1 after:content-['›'] hover:underline">Ingresar a mi tienda{newTab}</a>
            </div>
            <ul className="mt-8 grid gap-1 text-[0.9375rem]" aria-label="Contacto directo">
              <li><a href={whatsappLink('Hola, quiero información sobre TiendIA Exprés.')} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center gap-2.5 font-semibold text-(--v2-text) hover:text-(--v2-muted)"><Icon name="whatsapp" size={17} className="text-(--v2-subtle)" />{site.whatsapp.display}<span className="sr-only"> (WhatsApp, se abre en una pestaña nueva)</span></a></li>
              <li><a href={`mailto:${site.email.sales}`} className="inline-flex min-h-10 items-center gap-2.5 text-(--v2-muted) hover:text-(--v2-text)"><Icon name="send" size={16} className="text-(--v2-subtle)" />{site.email.sales}<span className="sr-only"> (ventas)</span></a></li>
              <li><a href={`mailto:${site.email.support}`} className="inline-flex min-h-10 items-center gap-2.5 text-(--v2-muted) hover:text-(--v2-text)"><Icon name="chat" size={16} className="text-(--v2-subtle)" />{site.email.support}<span className="sr-only"> (soporte)</span></a></li>
            </ul>
            <ul className="mt-5 flex gap-2" aria-label="Redes sociales">
              {site.social.map((s) => (
                <li key={s.key}>
                  <a href={s.url} target="_blank" rel="noopener noreferrer" className="grid size-11 place-items-center rounded-full bg-(--v2-surface) text-(--v2-muted) transition-colors hover:text-(--v2-text)">
                    <Icon name={s.key} size={17} /><span className="sr-only">{s.label} (se abre en una pestaña nueva)</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <nav aria-label="Pie de página" className="grid gap-x-6 gap-y-10 max-md:hidden md:grid-cols-3">
            {COLUMNS.map((col) => <Column key={col.title} col={col} />)}
          </nav>
          {/* Phones: one folding row per column. */}
          <nav aria-label="Pie de página" className="-mx-3 grid gap-1 md:hidden">
            {COLUMNS.map((col) => (
              <details key={col.title} className="group rounded-2xl open:bg-(--v2-surface) [&_summary::-webkit-details-marker]:hidden">
                <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between px-3 text-[0.9375rem] font-semibold">
                  {col.title}
                  <Icon name="plus" size={16} className="text-(--v2-subtle) transition-transform duration-300 group-open:rotate-45" />
                </summary>
                <ul className="px-3 pb-3">
                  {col.items.map((item) => (
                    <li key={item.label}><a href={item.href} {...ext(item)} className="flex min-h-11 items-center text-[0.9375rem] text-(--v2-muted)">{item.label}{item.external ? newTab : null}</a></li>
                  ))}
                </ul>
              </details>
            ))}
          </nav>
        </div>

        <div className="mt-14 flex flex-col gap-4 border-t border-(--v2-line) py-6 text-[0.8125rem] text-(--v2-subtle) md:flex-row md:items-center md:justify-between">
          <p>© {new Date().getFullYear()} {site.wordmark}. Hecho en Colombia. Precios en pesos colombianos (COP) · Sin comisión por venta.</p>
          <ul className="flex flex-wrap items-center gap-x-5 gap-y-1">
            {legal.map((l) => <li key={l.label}><a href={l.url} className="inline-flex min-h-10 items-center hover:text-(--v2-text)">{l.label}</a></li>)}
            <li><a href="#contenido" className="inline-flex min-h-10 items-center gap-1.5 font-semibold text-(--v2-text)">Volver arriba<Icon name="arrowDown" size={14} className="rotate-180" /></a></li>
          </ul>
        </div>
      </div>
      {/* The brand on the stage: the Flow floor, the name standing on it and its reflection (decorative). */}
      <div className="v2-footer-stage" aria-hidden="true" data-v2-tilt="">
        <img src={stage} alt="" width={1920} height={1072} loading="lazy" decoding="async" />
        <div className="v2-footer-brand">
          <p className="v2-wordmark">{site.wordmark}</p>
          <p className="v2-wordmark v2-wordmark-mirror">{site.wordmark}</p>
        </div>
      </div>
    </footer>
  )
}
