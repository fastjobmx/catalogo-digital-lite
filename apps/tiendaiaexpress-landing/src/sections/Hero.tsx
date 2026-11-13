// Cover. Everything shown is real: the Luz Mágica store (authorized, src/content/stores.ts), its
// desktop and phone captures and two products of its public catalogue with their real prices.
import type { CSSProperties } from 'react'
import { site } from '../config/site'
import { storeBySlug, type StoreProduct } from '../content/stores'
import { formatCOP } from '../content/media'
import { Button, BrowserFrame } from '../components/ui/primitives'
import { PhoneFrame } from '../components/ui/PhoneFrame'
import { Icon } from '../components/ui/Icon'

const store = storeBySlug('luz-magica')
const i = (n: number) => ({ '--i': n }) as CSSProperties

function ProductCard({ product, className = '', index }: { product: StoreProduct; className?: string; index: number }) {
  return (
    <figure className={`drift absolute z-20 w-[7.25rem] overflow-hidden rounded-2xl bg-paper p-1.5 text-forest shadow-[0_30px_60px_-24px_rgba(0,0,0,.65)] ring-1 ring-black/5 sm:w-44 ${className}`} style={i(index)}>
      <img src={product.src} alt={`${product.name}, producto real de ${store?.name}`} width={product.width} height={product.height} loading="eager" decoding="async" className="aspect-square w-full rounded-xl object-cover" />
      <figcaption className="px-2 pb-2 pt-2.5">
        <p className="truncate text-[0.8rem] font-semibold leading-tight">{product.name}</p>
        <p className="mt-0.5 font-display text-[0.95rem] font-extrabold tracking-tight">{formatCOP(product.price)}</p>
      </figcaption>
    </figure>
  )
}

export function Hero() {
  const [first, , second] = store?.products ?? []
  return (
    <section id="inicio" aria-labelledby="inicio-title" className="on-dark relative overflow-hidden bg-forest pb-20 pt-28 text-ivory md:pb-28 md:pt-36 lg:pt-40">
      <div className="grid-fade pointer-events-none absolute inset-0" aria-hidden="true" />
      <div className="pointer-events-none absolute -right-40 top-10 size-[44rem] rounded-full bg-[radial-gradient(closest-side,rgba(203,250,58,.13),transparent)]" aria-hidden="true" />
      <div className="pointer-events-none absolute -left-52 bottom-[-18rem] size-[40rem] rounded-full bg-[radial-gradient(closest-side,rgba(164,63,229,.2),transparent)]" aria-hidden="true" />

      <div className="wrap relative grid grid-cols-1 items-center gap-14 lg:grid-cols-[minmax(0,1.02fr)_minmax(0,1fr)] lg:gap-12 xl:gap-20">
        <div className="min-w-0">
          <p className="hero-in inline-flex items-center gap-2 rounded-full bg-white/6 py-1.5 pl-2 pr-3.5 text-[0.84rem] font-semibold text-ivory ring-1 ring-inset ring-white/12" style={i(0)}>
            <span className="grid size-6 place-items-center rounded-full bg-lime text-forest"><Icon name="whatsapp" size={13} /></span>
            Catálogo digital con pedidos por WhatsApp
          </p>
          <h1 id="inicio-title" className="display hero-in mt-6 text-[clamp(2.5rem,5.3vw,4.3rem)]" style={i(1)}>
            Tu tienda online, <span className="accent accent-gradient block w-fit">lista para vender.</span>
          </h1>
          <p className="hero-in mt-6 max-w-xl text-lg leading-relaxed text-mist md:text-[1.25rem]" style={i(2)}>
            Organiza tus productos, comparte tu catálogo y recibe pedidos por WhatsApp. Todo desde una plataforma diseñada para hacerte la vida más fácil.
          </p>
          <div className="hero-in mt-9 flex flex-col gap-3 xs:flex-row xs:flex-wrap" style={i(3)}>
            <Button href={site.trialUrl} variant="lime" size="lg" icon="arrowUpRight" external>Probar gratis</Button>
            <Button href="#como-funciona" variant="outline-light" size="lg" icon="arrowDown">Ver cómo funciona</Button>
          </div>
          <ul className="hero-in mt-7 flex flex-wrap gap-x-6 gap-y-2 text-[0.92rem] text-mist" style={i(4)} aria-label="Condiciones de la prueba gratis">
            {[`Prueba de ${site.trial.days} días`, 'Sin correo ni contraseña', `Hasta ${site.trial.products} productos con foto`].map((item) => (
              <li key={item} className="flex items-center gap-2"><Icon name="check" size={16} className="text-lime" />{item}</li>
            ))}
          </ul>
        </div>

        {store ? (
          <div className="hero-in mx-auto w-full max-w-[40rem] lg:mx-0 lg:max-w-none" style={i(3)}>
            <div className="relative pb-14 sm:pb-12">
              <BrowserFrame url={store.url.replace('https://', '')} className="shadow-[0_60px_120px_-40px_rgba(0,0,0,.85)]">
                <img src={store.desktop.src} srcSet={store.desktop.srcSet} sizes="(min-width: 1024px) 46vw, 92vw" alt={`Captura real de la tienda ${store.name} en el computador`} width={store.desktop.width} height={store.desktop.height} loading="eager" fetchPriority="high" decoding="async" className="aspect-[16/10] w-full object-cover object-top" />
              </BrowserFrame>
              <div className="absolute bottom-0 right-2 z-10 sm:right-6 lg:-right-4 xl:-right-6">
                <PhoneFrame src={store.phone.src} alt={`Captura real de la tienda ${store.name} en el celular`} width="clamp(7rem, 17vw, 11rem)" eager />
              </div>
              {first ? <ProductCard product={first} index={0} className="-left-1 bottom-0 sm:-left-5 lg:-left-8" /> : null}
              {second ? <ProductCard product={second} index={1} className="-right-3 -top-14 hidden w-36! xl:block" /> : null}
            </div>
            <p className="mt-5 text-[0.8rem] leading-snug text-mist">Capturas y productos reales de {store.name}, una tienda creada con TiendIA Exprés.</p>
          </div>
        ) : null}
      </div>
    </section>
  )
}
