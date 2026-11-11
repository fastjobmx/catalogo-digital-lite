// "Negocios que ya tienen su tienda con TiendIA Exprés": real stores that authorized appearing
// (src/content/stores.ts). Cards link to each store's public URL; no private data is shown.
import { showcaseStores } from '../content/stores'
import { Badge, Button, SectionHeading } from '../components/ui/primitives'
import { Icon } from '../components/ui/Icon'

export function Stores() {
  return (
    <section id="tiendas" aria-labelledby="tiendas-title" className="bg-ivory py-24 md:py-36">
      <div className="wrap">
        <SectionHeading
          id="tiendas-title"
          size="md"
          kicker={<Badge kind="real" label="Tiendas en funcionamiento" />}
          title="Negocios que ya tienen su tienda con TiendIA Exprés"
          intro="Explorá catálogos reales y descubrí cómo podría verse el tuyo."
        />
        <ul className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {showcaseStores.map((store) => (
            <li key={store.slug} className="flex">
              <article className="flex w-full flex-col overflow-hidden rounded-[2rem] bg-paper ring-1 ring-forest/8">
                <div className={`relative aspect-[16/10] overflow-hidden ${store.image.phone ? 'bg-forest' : 'bg-forest/5'}`}>
                  {store.image.phone ? (
                    // Phone capture: shown inside the screen area so it is not stretched.
                    <img src={store.image.src} alt={`Catálogo de ${store.name} en el celular`} width={store.image.width} height={store.image.height} loading="lazy" decoding="async" className="absolute left-1/2 top-6 w-[42%] -translate-x-1/2 rounded-t-[1.4rem] shadow-[0_30px_60px_-20px_rgba(0,0,0,.6)] ring-4 ring-forest-raised" />
                  ) : (
                    <img src={store.image.src} srcSet={store.image.srcSet} sizes="(min-width: 1024px) 30vw, (min-width: 640px) 46vw, 92vw" alt={`Portada de la tienda ${store.name}`} width={store.image.width} height={store.image.height} loading="lazy" decoding="async" className="size-full object-cover object-top" />
                  )}
                </div>
                <div className="flex flex-1 flex-col p-6 md:p-7">
                  <h3 className="font-display text-2xl font-bold leading-tight">{store.name}</h3>
                  <p className="mt-1 text-sm font-semibold text-ink-soft">
                    {store.category}{store.template ? <> · Plantilla {store.template}</> : null}
                  </p>
                  <p className="mt-3 flex-1 text-[0.98rem] leading-relaxed text-ink-soft">{store.blurb}</p>
                  <div className="mt-6">
                    <Button href={store.url} variant="forest" icon="arrowUpRight" external aria-label={`Ver tienda ${store.name} (se abre en una pestaña nueva)`}>Ver tienda</Button>
                  </div>
                </div>
              </article>
            </li>
          ))}
          {/* Full-width call to action when the stores fill whole rows; otherwise it takes the free cell. */}
          <li className={`flex ${showcaseStores.length % 3 === 0 ? 'lg:col-span-3' : ''} ${showcaseStores.length % 2 === 0 ? 'sm:col-span-2 lg:col-span-1' : ''}`}>
            <article className={`on-dark flex w-full flex-col justify-between gap-8 rounded-[2rem] bg-forest p-7 text-ivory md:p-9 ${showcaseStores.length % 3 === 0 ? 'lg:flex-row lg:items-center' : ''}`}>
              <div>
                <span className="grid size-12 place-items-center rounded-2xl bg-lime text-forest"><Icon name="store" size={24} /></span>
                <h3 className="mt-6 font-display text-2xl font-bold leading-tight md:text-3xl">Tu negocio puede ser el próximo.</h3>
                <p className="mt-3 text-mist">Mirá cómo quedan tus productos con una vista previa gratis, o escribinos y armamos tu tienda con vos.</p>
              </div>
              <div className="flex shrink-0 flex-col gap-2.5">
                <Button href="#contacto" variant="lime" icon="arrowRight">Quiero mi tienda</Button>
                <Button href="#planes" variant="outline-light">Conocer planes</Button>
              </div>
            </article>
          </li>
        </ul>
      </div>
    </section>
  )
}
