import { site } from '../config/site'
import { Icon } from '../components/ui/Icon'
import { Button } from '../components/ui/primitives'
import { Document, Inline, parse, toc } from './Markdown'
import { LegalHero, LegalLayout, MetaChip } from './LegalLayout'
import termsMd from './terminos-v1.1.md?raw'

const blocks = parse(termsMd)
const index = toc(blocks)

function Index({ compact }: { compact?: boolean }) {
  return (
    <ol className={`legal-toc ${compact ? '' : 'text-[0.9rem]'}`}>
      {index.map((s) => (
        <li key={s.id}>
          <a href={`#${s.id}`}><Inline text={s.text} /></a>
          {s.children.length ? (
            <ol>
              {s.children.map((c) => <li key={c.id}><a href={`#${c.id}`}><Inline text={c.text} /></a></li>)}
            </ol>
          ) : null}
        </li>
      ))}
    </ol>
  )
}

export function TermsPage() {
  return (
    <LegalLayout page="terminos">
      <LegalHero
        eyebrow="Documento legal"
        title="Términos y Condiciones de Uso y Contratación"
        intro={<p>Las reglas que aplican cuando usas o contratas TiendIA Exprés: planes, dominios, servicios adicionales, inteligencia artificial, datos y cancelación.</p>}
        meta={
          <>
            <MetaChip>Versión {site.terms.version}</MetaChip>
            <MetaChip>Actualizado el&nbsp;<time dateTime={site.terms.updatedIso}>{site.terms.updated}</time></MetaChip>
            <MetaChip>Legislación colombiana</MetaChip>
          </>
        }
        actions={
          <>
            <button type="button" onClick={() => window.print()} className="inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-[0.9rem] font-bold text-porcelain ring-1 ring-inset ring-porcelain/30 transition-colors hover:bg-porcelain hover:text-night">
              <Icon name="file" size={18} />Imprimir o guardar en PDF
            </button>
            <Button href="/servicios-adicionales" variant="lime" size="sm" icon="arrowRight">Ver servicios adicionales</Button>
          </>
        }
      />

      <div className="wrap grid gap-10 py-12 md:py-16 lg:grid-cols-[17rem_minmax(0,1fr)] lg:gap-14">
        <aside className="legal-aside lg:sticky lg:top-24 lg:max-h-[calc(100svh-7rem)] lg:self-start lg:overflow-y-auto lg:pr-2">
          <details className="legal-details rounded-2xl bg-paper p-4 ring-1 ring-night/10 lg:hidden">
            <summary className="flex cursor-pointer list-none items-center justify-between font-display font-bold">
              Índice del documento <Icon name="chevronDown" size={18} />
            </summary>
            <nav aria-label="Índice del documento (móvil)" className="mt-3"><Index compact /></nav>
          </details>
          <nav aria-labelledby="indice-titulo" className="hidden lg:block">
            <p id="indice-titulo" className="eyebrow mb-4 text-violet-ink">Índice</p>
            <Index />
          </nav>
        </aside>

        <article className="legal-doc min-w-0 max-w-3xl" aria-labelledby="doc-titulo">
          <header className="mb-8 border-b border-night/10 pb-6">
            <p id="doc-titulo" className="font-display text-[1.05rem] font-bold text-night">TIENDIA EXPRÉS</p>
            <p className="mt-1 text-[0.95rem] text-ink-soft">
              Versión {site.terms.version} · Fecha de actualización: {site.terms.updated} · Sitio web: <a href={site.url} className="legal-link">{site.url.replace(/^https?:\/\//, '')}</a>
            </p>
          </header>

          <Document blocks={blocks} />

          <section aria-labelledby="contacto-oficial" className="legal-contact mt-14 rounded-3xl bg-night p-7 text-porcelain md:p-9 on-dark">
            <h2 id="contacto-oficial" className="display text-[1.6rem]">Contacto oficial</h2>
            <dl className="mt-6 grid gap-5 sm:grid-cols-2">
              <div><dt className="text-[0.8rem] uppercase tracking-[0.12em] text-mist">Soporte</dt><dd className="mt-1 font-semibold"><a href={`mailto:${site.email.support}`} className="underline decoration-lime/60 underline-offset-4 hover:text-lime">{site.email.support}</a></dd></div>
              <div><dt className="text-[0.8rem] uppercase tracking-[0.12em] text-mist">Ventas y contrataciones</dt><dd className="mt-1 font-semibold"><a href={`mailto:${site.email.sales}`} className="underline decoration-lime/60 underline-offset-4 hover:text-lime">{site.email.sales}</a></dd></div>
              <div><dt className="text-[0.8rem] uppercase tracking-[0.12em] text-mist">Sitio web</dt><dd className="mt-1 font-semibold">{site.url.replace(/^https?:\/\//, '')}</dd></div>
              <div><dt className="text-[0.8rem] uppercase tracking-[0.12em] text-mist">Horario</dt><dd className="mt-1 font-semibold">{site.hours}</dd></div>
            </dl>
          </section>
        </article>
      </div>
    </LegalLayout>
  )
}
