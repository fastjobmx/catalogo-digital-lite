// "Tiendas reales": authorized stores (src/content/stores.ts) with their real captures, public
// catalogue figures and original product photos. Every external link goes to a public store URL.
import { useState, type KeyboardEvent } from 'react'
import { showcaseStores } from '../content/stores'
import { formatCOP } from '../content/media'
import { site } from '../config/site'
import { Button, BrowserFrame, SectionHeading } from '../components/ui/primitives'
import { Mascot } from '../components/brand/Decor'
import { PhoneFrame } from '../components/ui/PhoneFrame'

export function Stores() {
  const [active, setActive] = useState(showcaseStores[0]?.slug)
  // ARIA tabs pattern: arrows, Home and End move between tabs (roving tabindex).
  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const at = showcaseStores.findIndex((s) => s.slug === active)
    const next = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: showcaseStores.length - 1 }[e.key]
    if (next === undefined) return
    e.preventDefault()
    const target = showcaseStores[(next + showcaseStores.length) % showcaseStores.length]
    setActive(target.slug)
    document.getElementById(`tienda-tab-${target.slug}`)?.focus()
  }
  return (
    <section id="tiendas" aria-labelledby="tiendas-title" className="bg-porcelain py-24 md:py-32">
      <div className="wrap">
        <div data-reveal>
          <SectionHeading id="tiendas-title" eyebrow="Tiendas reales" title={<>Negocios que ya venden <span className="accent hl">con su propia tienda.</span></>} intro="Explora tiendas reales, con sus fotos y sus precios, y descubre cómo podría verse el tuyo." />
        </div>

        <div className="mt-12 flex flex-wrap gap-2" role="tablist" aria-label="Tiendas">
          {showcaseStores.map((store) => {
            const selected = store.slug === active
            return (
              <button key={store.slug} type="button" role="tab" id={`tienda-tab-${store.slug}`} aria-selected={selected} aria-controls={`tienda-panel-${store.slug}`} tabIndex={selected ? 0 : -1} onClick={() => setActive(store.slug)} onKeyDown={onKey} className={`min-h-12 rounded-full px-5 font-display text-[0.98rem] font-bold tracking-tight transition-colors duration-300 ${selected ? 'bg-night text-porcelain' : 'bg-paper text-night ring-1 ring-inset ring-night/12 hover:ring-night/40'}`}>
                {store.name}
              </button>
            )
          })}
        </div>

        {showcaseStores.map((store) => (
          <div key={store.slug} role="tabpanel" id={`tienda-panel-${store.slug}`} aria-labelledby={`tienda-tab-${store.slug}`} hidden={store.slug !== active} className="mt-8">
            <article data-tilt="0.25" className="grid grid-cols-1 gap-10 overflow-hidden rounded-[2rem] bg-paper p-6 ring-1 ring-night/8 lift md:p-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:gap-12">
              <div className="relative pb-8 pr-6 sm:pr-14">
                <BrowserFrame url={store.url.replace('https://', '')} className="shadow-[0_40px_80px_-40px_rgba(11,11,19,.6)]">
                  <img src={store.desktop.src} srcSet={store.desktop.srcSet} sizes="(min-width: 1024px) 44vw, 86vw" alt={`Captura real de la tienda ${store.name} en el computador`} width={store.desktop.width} height={store.desktop.height} loading="lazy" decoding="async" className="aspect-[16/10] w-full object-cover object-top" />
                </BrowserFrame>
                <div className="absolute bottom-0 right-0">
                  <PhoneFrame src={store.phone.src} alt={`Captura real de la tienda ${store.name} en el celular`} width="clamp(6.5rem, 17vw, 10.5rem)" />
                </div>
              </div>

              <div className="flex min-w-0 flex-col">
                <p className="eyebrow text-violet-ink">{store.category}</p>
                <h3 className="display mt-3 text-[clamp(1.9rem,3.2vw,2.6rem)]">{store.name}</h3>
                <p className="mt-3 text-[1.05rem] leading-relaxed text-ink-soft">{store.blurb}</p>
                <dl className="mt-6 flex flex-wrap gap-x-8 gap-y-3 border-y border-night/10 py-5">
                  <div><dt className="text-[0.8rem] text-ink-soft">Productos publicados</dt><dd className="font-display text-2xl font-extrabold tracking-tight">{store.productCount}</dd></div>
                  <div><dt className="text-[0.8rem] text-ink-soft">Categorías</dt><dd className="font-display text-2xl font-extrabold tracking-tight">{store.categoryCount}</dd></div>
                  {store.template ? <div><dt className="text-[0.8rem] text-ink-soft">Plantilla</dt><dd className="font-display text-2xl font-extrabold tracking-tight">{store.template}</dd></div> : null}
                </dl>
                {store.products.length > 0 && <ul className="mt-6 grid grid-cols-3 gap-3" aria-label={`Productos de ${store.name}`}>
                  {store.products.slice(0, 3).map((product) => (
                    <li key={product.name}>
                      <img src={product.src} alt={`${product.name}, foto original de la tienda ${store.name}`} width={product.width} height={product.height} loading="lazy" decoding="async" className="aspect-[4/5] w-full rounded-2xl bg-porcelain object-cover ring-1 ring-night/8" />
                      <p className="mt-2 line-clamp-2 text-[0.8rem] font-semibold leading-tight">{product.name}</p>
                      <p className="text-[0.8rem] text-ink-soft">{formatCOP(product.price)}</p>
                    </li>
                  ))}
                </ul>}
                <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3 lg:mt-auto lg:pt-8">
                  <Button href={store.url} variant="night" icon="arrowUpRight" external aria-label={`Ver tienda ${store.name} (se abre en una pestaña nueva)`}>Ver tienda</Button>
                  <p className="text-[0.8rem] text-ink-soft">Los productos y precios pueden cambiar en la tienda.</p>
                </div>
              </div>
            </article>
          </div>
        ))}

        <div className="on-dark relative mt-10 grid items-center gap-6 overflow-hidden rounded-[2rem] bg-night px-7 py-8 text-porcelain md:grid-cols-[auto_minmax(0,1fr)_auto] md:px-10" data-reveal>
          <div className="pointer-events-none absolute -left-16 -top-24 size-72 rounded-full bg-[radial-gradient(closest-side,rgba(18,220,231,.25),transparent)]" aria-hidden="true" />
          <div className="pointer-events-none absolute -bottom-28 right-24 size-80 rounded-full bg-[radial-gradient(closest-side,rgba(197,42,241,.4),transparent)]" aria-hidden="true" />
          <Mascot width={96} className="relative -my-4 hidden md:block" />
          <div className="relative">
            <h3 className="display text-[clamp(1.6rem,2.8vw,2.2rem)]">Tu negocio puede ser <span className="text-lime">el próximo.</span></h3>
            <p className="mt-2 max-w-xl text-mist">Mira cómo quedan tus productos con una prueba gratis, o escríbenos y armamos tu tienda contigo.</p>
          </div>
          <div className="relative flex flex-col gap-3 sm:flex-row">
            <Button href="#contacto" variant="lime" lead="store">Quiero mi tienda</Button>
            <Button href="#planes" variant="outline-light">Conocer planes</Button>
          </div>
          <p className="relative text-[0.85rem] text-mist md:col-span-3">¿Lo quieres ver ya? <a href={site.trialUrl} target="_blank" rel="noopener noreferrer" className="font-bold text-porcelain underline decoration-cyan decoration-2 underline-offset-4 hover:text-cyan">Crea tu tienda de prueba gratis<span className="sr-only"> (se abre en una pestaña nueva)</span></a>, sin correo ni contraseña.</p>
        </div>
      </div>
    </section>
  )
}
