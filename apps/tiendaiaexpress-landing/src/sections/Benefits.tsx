// Sections that production had and the redesign dropped: "Crea tu catálogo sin registro", the three
// benefits (with the copy-link demo) and "Tu tienda, y quien te ayuda a manejarla".
import { useState, type CSSProperties } from 'react'
import { site } from '../config/site'
import { formatCOP, products } from '../content/media'
import { Badge, Button, SectionHeading } from '../components/ui/primitives'
import { Icon } from '../components/ui/Icon'
import { Mascot } from '../components/brand/Decor'

const i = (n: number) => ({ '--i': n }) as CSSProperties

export function Trial() {
  const facts = [
    { icon: 'camera' as const, title: 'Vista previa real', body: `Hasta ${site.trial.products} productos con foto, con el estilo que elijas.` },
    { icon: 'clock' as const, title: 'Temporal y privada', body: `Dura ${site.trial.days} días. No te pedimos correo ni contraseña.` },
    { icon: 'store' as const, title: 'Para quedártela', body: 'Cuando quieras tu tienda definitiva, la creamos contigo. La prueba no se convierte en tienda por sí sola.' },
  ]
  return (
    <section id="prueba" aria-labelledby="prueba-title" className="on-dark relative overflow-hidden bg-night py-24 text-porcelain md:py-28">
      <div className="pointer-events-none absolute -right-24 top-0 size-[34rem] rounded-full bg-[radial-gradient(closest-side,rgba(18,220,231,.2),transparent)]" aria-hidden="true" />
      <div className="pointer-events-none absolute -left-32 bottom-0 size-[34rem] rounded-full bg-[radial-gradient(closest-side,rgba(197,42,241,.3),transparent)]" aria-hidden="true" />
      <div className="wrap relative grid items-center gap-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-16">
        <div data-reveal>
          <SectionHeading id="prueba-title" onDark eyebrow="Sin registro · Gratis" title={<>Prueba tu tienda <span className="accent accent-gradient">sin registro.</span></>} intro="Sube fotos de tus productos y descubre cómo puede verse tu tienda online. Importar tu lista completa desde Excel, CSV o PDF lo haces después, en el panel de tu tienda." />
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button href={site.trialUrl} variant="lime" size="lg" lead="store" icon="arrowUpRight" external>Probar gratis</Button>
            <Button href="#contacto" variant="outline-light" size="lg">Crear mi tienda</Button>
          </div>
        </div>
        <ul className="grid gap-3">
          {facts.map((f, n) => (
            <li key={f.title} data-reveal style={i(n)} className="glass-dark flex gap-4 rounded-2xl p-5">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-cyan/15 text-cyan"><Icon name={f.icon} size={21} /></span>
              <p><span className="block font-display font-bold">{f.title}</span><span className="mt-1 block text-[0.95rem] leading-snug text-mist">{f.body}</span></p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

function CopyLink() {
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle')
  const copy = async () => {
    try { await navigator.clipboard.writeText(site.demoStoreUrl); setState('ok') } catch { setState('fail') }
    window.setTimeout(() => setState('idle'), 2400)
  }
  return (
    <div className="mt-6 rounded-2xl bg-porcelain p-4 ring-1 ring-night/8">
      <p className="text-[0.85rem] text-ink-soft">El enlace de la tienda piloto:</p>
      <div className="mt-2 flex flex-wrap items-center gap-2.5">
        <span className="min-w-0 flex-1 truncate rounded-full bg-paper px-4 py-2.5 font-mono text-[0.82rem] ring-1 ring-night/10">{site.demoStoreUrl.replace('https://', '')}</span>
        <button type="button" onClick={copy} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-lime px-5 font-display text-[0.85rem] font-bold uppercase text-night transition-transform active:scale-95">
          <Icon name={state === 'ok' ? 'check' : 'link'} size={16} />{state === 'ok' ? 'Copiado' : 'Copiar'}
        </button>
      </div>
      <p className="mt-2 min-h-5 text-[0.8rem] text-ink-soft" aria-live="polite">{state === 'ok' ? 'Listo: pégalo donde quieras.' : state === 'fail' ? 'No pudimos copiar; selecciona el enlace y cópialo.' : ''}</p>
    </div>
  )
}

export function Benefits() {
  const p = products[0]
  return (
    <section aria-labelledby="beneficios-title" className="wash py-24 md:py-32">
      <div className="wrap">
        <div data-reveal>
          <SectionHeading id="beneficios-title" align="center" eyebrow="Beneficios" title={<>Menos complicaciones, <span className="accent hl">más tiempo para tu negocio.</span></>} />
        </div>
        <div className="mt-14 grid gap-5 lg:grid-cols-3">
          <article data-reveal data-tilt="0.8" className="min-w-0 rounded-3xl bg-paper p-7 ring-1 ring-night/8 lift">
            <span className="grid size-11 place-items-center rounded-xl bg-violet/10 text-violet-ink"><Icon name="link" size={21} /></span>
            <h3 className="display mt-5 text-[1.5rem]">Menos complicaciones.</h3>
            <p className="mt-2 text-ink-soft">Sin instalar nada ni contratar programadores. Tu tienda vive en un enlace que compartes donde quieras: estados, grupos, redes o en una conversación.</p>
            <CopyLink />
          </article>
          <article data-reveal data-tilt="0.8" style={i(1)} className="min-w-0 rounded-3xl bg-paper p-7 ring-1 ring-night/8 lift">
            <span className="grid size-11 place-items-center rounded-xl bg-violet/10 text-violet-ink"><Icon name="clock" size={21} /></span>
            <h3 className="display mt-5 text-[1.5rem]">Más tiempo para tu negocio.</h3>
            <p className="mt-2 text-ink-soft">Un mensaje a tu asistente reemplaza varios clics en un panel. Cambias un precio o cargas existencias mientras atiendes.</p>
            <div className="mt-6 space-y-2 rounded-2xl bg-night p-4 text-[0.9rem] text-porcelain">
              <Badge kind="demo" onDark />
              <p className="ml-auto w-fit max-w-[90%] rounded-2xl rounded-br-md bg-lime px-3.5 py-2 text-night">Cambia el precio del {p.name} a {formatCOP(p.price - 10000)}</p>
              <p className="w-fit max-w-[90%] rounded-2xl rounded-bl-md bg-white/10 px-3.5 py-2">Cambio el precio de {formatCOP(p.price)} a {formatCOP(p.price - 10000)}. ¿Confirmo?</p>
              <p className="ml-auto w-fit rounded-2xl rounded-br-md bg-lime px-3.5 py-2 text-night">Sí</p>
            </div>
          </article>
          <article data-reveal data-tilt="0.8" style={i(2)} className="min-w-0 rounded-3xl bg-paper p-7 ring-1 ring-night/8 lift">
            <span className="grid size-11 place-items-center rounded-xl bg-violet/10 text-violet-ink"><Icon name="whatsapp" size={21} /></span>
            <h3 className="display mt-5 text-[1.5rem]">Tu tienda siempre a la mano.</h3>
            <p className="mt-2 text-ink-soft">Lo abres desde el celular, lo muestras en una conversación y tu cliente pide sin salir de WhatsApp.</p>
            <div className="mt-6 rounded-2xl rounded-tl-md bg-[#d9fdd3] p-4 text-[#0b2e1f]">
              <p className="flex items-center gap-1.5 font-bold"><Icon name="whatsapp" size={16} className="text-[#0e7a3e]" />Mira mi tienda</p>
              <p className="mt-1 truncate text-[0.82rem] underline">{site.demoStoreUrl.replace('https://', '')}</p>
            </div>
          </article>
        </div>

        <div className="on-dark relative mt-14 overflow-hidden rounded-[2rem] bg-night p-8 text-porcelain md:p-12" data-reveal>
          <div className="pointer-events-none absolute -right-20 -top-20 size-80 rounded-full bg-[radial-gradient(closest-side,rgba(197,42,241,.4),transparent)]" aria-hidden="true" />
          <div className="relative grid items-center gap-8 lg:grid-cols-[auto_minmax(0,1fr)]">
            <Mascot width={150} className="mx-auto hidden lg:block" />
            <div>
              <h3 className="display text-[clamp(1.6rem,2.8vw,2.3rem)]">Tu tienda, y quien te ayuda a manejarla.</h3>
              <p className="mt-2 max-w-2xl text-mist">Son dos partes del mismo servicio: la tienda que ven tus clientes y el asistente con el que la administras.</p>
              <div className="mt-7 grid gap-4 md:grid-cols-2">
                {[
                  { t: 'Crear tu tienda', s: 'Lo que ven tus clientes.', l: ['Tu tienda en un enlace propio', 'Plantilla y colores de tu marca', 'Productos, categorías, tallas y precios', 'Carrito y pedido por WhatsApp'] },
                  { t: 'Administrarla con IA', s: 'Lo que haces tú, desde Telegram.', l: ['Le escribes a tu asistente como a una persona', 'Agrega productos, cambia precios y carga existencias', 'Revisas pedidos y actualizas su estado', 'Te pide confirmación antes de guardar cambios'] },
                ].map((c) => (
                  <div key={c.t} className="glass-dark rounded-2xl p-5">
                    <p className="font-display text-[1.15rem] font-extrabold">{c.t}</p>
                    <p className="text-[0.9rem] text-cyan">{c.s}</p>
                    <ul className="mt-3 space-y-2 text-[0.95rem]">{c.l.map((x) => <li key={x} className="flex gap-2.5"><Icon name="check" size={17} className="mt-0.5 shrink-0 text-lime" />{x}</li>)}</ul>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
