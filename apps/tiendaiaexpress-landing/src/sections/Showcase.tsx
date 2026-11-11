// "Una tienda real. Una experiencia real." — authentic captures of the SneakerHub pilot store.
import { useState, type KeyboardEvent } from 'react'
import { capturedAt, desktop, productCount, categories, screens, store } from '../content/media'
import { site } from '../config/site'
import { Badge, Button, SectionHeading } from '../components/ui/primitives'
import { PhoneFrame } from '../components/ui/PhoneFrame'

const VIEWS = [
  { key: 'home', label: 'Inicio', desktop: desktop.home, phone: screens.home, phoneAlt: 'Inicio de SneakerHub en el celular' },
  { key: 'product', label: 'Producto', desktop: desktop.product, phone: screens.product, phoneAlt: 'Ficha de producto de SneakerHub en el celular' },
  { key: 'cart', label: 'Carrito', desktop: desktop.product, phone: screens.cart, phoneAlt: 'Carrito de SneakerHub con el botón Enviar pedido por WhatsApp' },
] as const

const date = new Date(capturedAt).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Bogota' })

export function Showcase() {
  const [view, setView] = useState<(typeof VIEWS)[number]>(VIEWS[0])
  // ARIA tabs pattern: arrows, Home and End move between tabs (roving tabindex).
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = VIEWS.findIndex((v) => v.key === view.key)
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: VIEWS.length - 1 }[e.key]
    if (next === undefined) return
    e.preventDefault()
    const target = VIEWS[(next + VIEWS.length) % VIEWS.length]
    setView(target)
    document.getElementById(`tab-${target.key}`)?.focus()
  }
  return (
    <section id="demo" aria-labelledby="demo-title" className="relative overflow-hidden bg-paper py-24 md:py-36">
      <div className="wrap">
        <div className="grid gap-10 lg:grid-cols-[1fr_auto] lg:items-end">
          <SectionHeading
            id="demo-title"
            kicker={<Badge kind="real" label="Tienda piloto en funcionamiento" />}
            title="Una tienda real. Una experiencia real."
            intro={`${store.name} es la tienda piloto de la plataforma: ${productCount} productos en ${categories.length} categorías, con carrito y pedidos por WhatsApp.`}
          />
          <div className="flex flex-col items-start gap-3 lg:items-end">
            <Button href={site.demoStoreUrl} variant="forest" size="lg" icon="arrowUpRight" external>Explorar tienda demo</Button>
            <p className="text-sm text-ink-soft">Se abre en una pestaña nueva; esta página sigue aquí.</p>
          </div>
        </div>

        <div className="mt-12 flex flex-wrap gap-2" role="tablist" aria-label="Pantallas de la tienda">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              type="button"
              role="tab"
              id={`tab-${v.key}`}
              aria-selected={view.key === v.key}
              aria-controls="showcase-panel"
              tabIndex={view.key === v.key ? 0 : -1}
              onClick={() => setView(v)}
              onKeyDown={onTabKey}
              className={`min-h-11 rounded-full px-5 font-display text-sm font-bold uppercase tracking-wide transition-colors ${view.key === v.key ? 'bg-forest text-ivory' : 'bg-forest/6 text-forest hover:bg-forest/12'}`}
            >
              {v.label}
            </button>
          ))}
        </div>

        <div id="showcase-panel" role="tabpanel" aria-labelledby={`tab-${view.key}`} className="relative mt-8 pb-10 md:pb-0">
          <div className="overflow-hidden rounded-[1.4rem] bg-forest shadow-[0_60px_120px_-50px_rgba(10,33,26,.6)] ring-1 ring-forest/10 md:mr-[12%]">
            <div className="flex items-center gap-3 px-4 py-3">
              <div className="flex gap-1.5"><span className="size-2.5 rounded-full bg-violet" /><span className="size-2.5 rounded-full bg-lime" /><span className="size-2.5 rounded-full bg-ivory/30" /></div>
              <p className="min-w-0 flex-1 truncate rounded-full bg-forest-deep px-4 py-1.5 text-center text-xs text-mist">{site.demoStoreUrl.replace('https://', '')}</p>
            </div>
            <img key={view.desktop.src} src={view.desktop.src} srcSet={view.desktop.srcSet} sizes="(min-width: 768px) 80vw, 100vw" alt={`Captura real de ${store.name} en el computador: ${view.label.toLowerCase()}`} width={1440} height={900} loading="lazy" className="aspect-[16/10] w-full animate-[fade-up_.6s_var(--ease-out-expo)] object-cover object-top" />
          </div>
          <div className="absolute -bottom-2 right-2 md:-bottom-12 md:right-0">
            <PhoneFrame key={view.phone} src={view.phone} alt={view.phoneAlt} width="clamp(8.5rem, 22vw, 17rem)" className="animate-[fade-up_.6s_var(--ease-out-expo)]" />
          </div>
        </div>
        <p className="mt-6 text-sm text-ink-soft md:mt-16">Capturas reales tomadas el {date}. Los productos, precios y existencias pueden cambiar en la tienda.</p>
      </div>
    </section>
  )
}
