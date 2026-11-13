// "Cómo funciona" in three steps, each with a real capture of the pilot store on a phone.
import type { CSSProperties } from 'react'
import { site } from '../config/site'
import { screens, type ScreenKey } from '../content/media'
import { Button, SectionHeading } from '../components/ui/primitives'
import { PhoneFrame } from '../components/ui/PhoneFrame'

const i = (n: number) => ({ '--i': n }) as CSSProperties
const address = `${new URL(site.appUrl).host}/t/tu-negocio`

const STEPS: { title: string; body: string; screen: ScreenKey; alt: string }[] = [
  {
    title: 'Sube tus productos',
    body: 'Con fotos desde el panel, con tu lista en Excel o con un mensaje a tu asistente de Telegram. Cada producto queda con nombre, precio, tallas y descripción.',
    screen: 'product',
    alt: 'Captura real de una ficha de producto en el celular',
  },
  {
    title: 'Comparte tu enlace',
    body: `Tu catálogo queda en una dirección propia, como ${address}. Compártela en tus estados, tus redes y tus conversaciones.`,
    screen: 'catalog',
    alt: 'Captura real del catálogo en el celular',
  },
  {
    title: 'Recibe pedidos por WhatsApp',
    body: 'Tu cliente arma el carrito y te envía el pedido con productos, tallas y datos de entrega. Tú confirmas y acuerdas el pago.',
    screen: 'cart',
    alt: 'Captura real del carrito con el botón para enviar el pedido por WhatsApp',
  },
]

export function HowItWorks() {
  return (
    <section id="como-funciona" aria-labelledby="como-funciona-title" className="on-dark relative overflow-hidden bg-forest py-24 text-ivory md:py-32">
      <div className="wrap relative">
        <div className="flex flex-col justify-between gap-8 lg:flex-row lg:items-end" data-reveal>
          <SectionHeading id="como-funciona-title" onDark eyebrow="Cómo funciona" title={<>De la foto al pedido, <span className="accent text-lime">en tres pasos.</span></>} intro="No necesitas programadores ni instalar aplicaciones. Si sabes usar WhatsApp, sabes usar tu tienda." />
          <Button href={site.trialUrl} variant="lime" size="lg" icon="arrowUpRight" external className="self-start lg:self-auto">Probar gratis</Button>
        </div>

        <ol className="mt-16 grid gap-5 lg:grid-cols-3">
          {STEPS.map((step, n) => (
            <li key={step.title} data-reveal style={i(n)} className="relative flex flex-col overflow-hidden rounded-3xl bg-forest-raised/70 ring-1 ring-inset ring-white/8">
              <div className="p-7 md:p-8">
                <p className="font-display text-[0.95rem] font-extrabold text-lime" aria-hidden="true">0{n + 1}</p>
                <h3 className="mt-3 font-display text-[1.6rem] font-extrabold leading-tight tracking-tight"><span className="sr-only">Paso {n + 1}: </span>{step.title}</h3>
                <p className="mt-3 text-[1rem] leading-relaxed text-mist">{step.body}</p>
              </div>
              <div className="mt-auto flex h-64 justify-center overflow-hidden px-8 [mask-image:linear-gradient(to_bottom,#000_70%,transparent)] sm:h-72">
                <PhoneFrame src={screens[step.screen]} alt={step.alt} width="13.5rem" className="self-start" />
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-6 text-[0.8rem] text-mist">Pantallas reales de la tienda piloto SneakerHub Premium.</p>
      </div>
    </section>
  )
}
