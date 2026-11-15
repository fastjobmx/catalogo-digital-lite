// Shared frame of the legal pages: a sober header (no 3D, no scroll scenes), the page body on a
// light surface for long reading, and the site footer with "#…" anchors pointing to the home page.
import type { ReactNode } from 'react'
import { site } from '../config/site'
import { Logo } from '../components/brand/Logo'
import { Button } from '../components/ui/primitives'
import { Footer } from '../sections/Footer'

export type LegalPage = 'terminos' | 'servicios'

const links: { key: LegalPage; label: string; href: string }[] = [
  { key: 'terminos', label: 'Términos y condiciones', href: '/terminos-y-condiciones' },
  { key: 'servicios', label: 'Servicios adicionales', href: '/servicios-adicionales' },
]

export function LegalLayout({ page, children }: { page: LegalPage; children: ReactNode }) {
  return (
    <div id="inicio">
      <a href="#contenido" className="sr-only-focusable fixed left-4 top-4 z-[70] rounded-full bg-lime px-5 py-3 font-semibold text-night">Saltar al contenido</a>
      <header className="legal-header on-dark sticky top-0 z-50 border-b border-white/10 bg-night/95 backdrop-blur-xl">
        <div className="wrap flex min-h-16 flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2 lg:min-h-[4.5rem]">
          <a href="/" className="shrink-0 rounded-lg" aria-label="TiendIA Exprés, ir al inicio">
            <Logo priority />
          </a>
          <nav aria-label="Documentos" className="order-3 w-full sm:order-none sm:w-auto">
            <ul className="flex gap-1 overflow-x-auto">
              {links.map((l) => (
                <li key={l.key}>
                  <a
                    href={l.href}
                    aria-current={l.key === page ? 'page' : undefined}
                    className={`block whitespace-nowrap rounded-full px-2.5 py-2 text-[0.86rem] sm:px-3 sm:text-[0.88rem] font-semibold transition-colors ${l.key === page ? 'bg-white/10 text-porcelain' : 'text-porcelain/75 hover:bg-white/8 hover:text-porcelain'}`}
                  >
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <Button href={site.trialUrl} variant="lime" size="sm" external className="max-[379px]:hidden">Probar gratis</Button>
        </div>
      </header>
      <main id="contenido" tabIndex={-1} className="legal-main outline-none">
        {children}
      </main>
      <div className="legal-footer"><Footer onHome={false} /></div>
    </div>
  )
}

/** Dark title band at the top of each legal page. */
export function LegalHero({ eyebrow, title, intro, meta, actions }: { eyebrow: string; title: string; intro?: ReactNode; meta?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="legal-hero on-dark relative overflow-hidden bg-night text-porcelain">
      <div className="pointer-events-none absolute -top-48 right-[-12rem] size-[34rem] rounded-full bg-[radial-gradient(closest-side,rgba(197,42,241,.16),transparent)]" aria-hidden="true" />
      <div className="wrap relative py-14 md:py-20">
        <p className="eyebrow flex items-center gap-2.5 text-cyan"><span className="h-px w-6 bg-cyan/70" aria-hidden="true" />{eyebrow}</p>
        <h1 className="display mt-5 max-w-4xl text-[clamp(2rem,4.4vw,3.5rem)]">{title}</h1>
        {intro ? <div className="mt-5 max-w-2xl text-[1.08rem] leading-relaxed text-mist md:text-[1.15rem]">{intro}</div> : null}
        {meta ? <div className="mt-7 flex flex-wrap gap-2 text-[0.86rem]">{meta}</div> : null}
        {actions ? <div className="legal-actions mt-8 flex flex-wrap gap-3">{actions}</div> : null}
      </div>
    </div>
  )
}

export function MetaChip({ children }: { children: ReactNode }) {
  return <span className="inline-flex items-center rounded-full bg-white/8 px-3 py-1.5 text-porcelain/90 ring-1 ring-inset ring-white/12">{children}</span>
}
