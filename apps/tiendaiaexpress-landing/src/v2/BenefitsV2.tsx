// Benefits (soft grey scene): three outcomes for the owner, one sentence each, then a compact «Incluye» strip
// with what makes them possible. Facts as the official home states them (docs/LANDING_PLANES_Y_PRECIOS.md
// §7, copy.ts FAQ, plans.ts add-ons): no commission; the store is set up with you and managed from the panel
// or the assistant; customers buy from their phone and the owner manages from WhatsApp or Telegram;
// 13 templates (real template images), import from Excel/CSV/PDF with preview and product sheets from a photo
// (AI; reading PDFs with AI uses credits), and the Creative Studio (real pieces made by the product's studio
// engine; included in every plan, no AI credits). 3D: every tile tilts toward a fine pointer, the fans open.
import type { ReactNode } from 'react'
import { templates, screens } from '../content/media'
import carrusel from '../assets/studio/carrusel-1.webp'
import oferta from '../assets/studio/oferta-vertical.webp'
import historia from '../assets/studio/historia-volta.webp'
import { PhoneFrame } from '../components/ui/PhoneFrame'
import { Icon } from '../components/ui/Icon'
import { Heading, Section, vars, wrap } from './ui'

function Tile({ title, body, children, index }: { title: string; body: ReactNode; children: ReactNode; index: number }) {
  return (
    <li data-v2-item="" style={vars({ i: index })} className="flex">
      <div data-v2-tilt="" className="v2-tile flex min-h-[25rem] w-full flex-col overflow-hidden rounded-[1.75rem] bg-(--v2-surface) px-6 pt-9 text-center md:min-h-[29rem] md:px-8 md:pt-11">
        <h3 className="text-[clamp(1.625rem,2.6vw,2.125rem)] font-semibold leading-[1.1] tracking-[-0.03em]">{title}</h3>
        <p className="mx-auto mt-3 max-w-sm text-[1.0625rem] leading-[1.45] text-(--v2-muted)">{body}</p>
        <div className="v2-tile-art mt-auto flex justify-center pt-8" aria-hidden="true">{children}</div>
      </div>
    </li>
  )
}

function Included({ id, title, body, children, link }: { id?: string; title: string; body: string; children: ReactNode; link?: ReactNode }) {
  return (
    <li id={id} className="flex">
      <div data-v2-tilt="" className="v2-tile flex w-full flex-col overflow-hidden rounded-[1.5rem] bg-(--v2-surface) p-6">
        <h3 className="text-[1.25rem] font-semibold tracking-[-0.02em]">{title}</h3>
        <p className="mt-1.5 text-[0.9375rem] leading-snug text-(--v2-muted)">{body}</p>
        {link ? <div className="mt-2">{link}</div> : null}
        <div className="v2-tile-art mt-auto flex justify-center pt-6" aria-hidden="true">{children}</div>
      </div>
    </li>
  )
}

export function BenefitsV2() {
  return (
    <Section id="funciones" labelledBy="funciones-title" light className="v2-soft">
      <div className={wrap}>
        <Heading id="funciones-title" center kicker="Para ti" title="Menos trabajo. Más control." />
        <ul data-v2-reveal="fade" className="mx-auto mt-14 grid max-w-6xl gap-4 md:mt-20 md:grid-cols-3 md:gap-5">
          <Tile index={0} title="Sin comisión por venta." body="Pagas tu plan y nada más. El pago lo acuerdas directamente con tu cliente.">
            <p className="pb-12 text-[clamp(5.5rem,11vw,8.5rem)] font-semibold leading-none tracking-[-0.06em]">0 %</p>
          </Tile>
          <Tile index={1} title="Sin depender de un desarrollador." body="Creamos la tienda contigo y después la administras desde el panel o escribiéndole a tu asistente.">
            <div className="grid w-full max-w-[17rem] gap-2 pb-10 text-left text-[0.9375rem]">
              <span className="ml-auto max-w-[88%] rounded-2xl rounded-br-md bg-[#1d1d1f] px-4 py-2.5 text-[#f5f5f7]">Cambia el precio del NORD-02</span>
              <span className="max-w-[88%] rounded-2xl rounded-bl-md bg-(--v2-bg) px-4 py-2.5">Te muestro el resumen. ¿Confirmas?</span>
              <span className="ml-auto rounded-2xl rounded-br-md bg-(--v2-lime) px-4 py-2 font-semibold text-[#0b0c10]">Confirmar</span>
            </div>
          </Tile>
          <Tile index={2} title="Todo desde tu celular." body="Tus clientes compran desde el celular y tú administras por WhatsApp o Telegram.">
            <PhoneFrame src={screens.home} width="11.5rem" className="-mb-24 md:-mb-28" />
          </Tile>
        </ul>

        <h3 className="mx-auto mt-16 max-w-6xl text-[0.9375rem] font-semibold text-(--v2-subtle) md:mt-20">Incluye</h3>
        <ul className="mx-auto mt-4 grid max-w-6xl gap-4 md:grid-cols-3 md:gap-5" aria-label="Incluye">
          <Included title={`${templates.length} plantillas`} body="Elige una y aplica tu logo y tus colores en toda la tienda.">
            <div className="v2-fan flex items-end gap-1 sm:gap-2">
              {templates.slice(0, 3).map((t, n) => (
                <img key={t.key} src={t.src} alt="" width={360} height={480} loading="lazy" decoding="async" className={`w-[5.25rem] rounded-t-xl object-cover object-top shadow-[0_16px_30px_-18px_rgba(0,0,0,.35)] md:w-[6rem] ${n === 1 ? 'aspect-[3/4.2]' : 'aspect-[3/3.5]'}`} />
              ))}
            </div>
          </Included>
          <Included title="Importa lo que ya tienes" body="Excel, CSV o PDF con vista previa antes de guardar, o la ficha de un producto desde una foto con IA. Leer un PDF con IA usa créditos.">
            <ul className="grid w-full max-w-[15rem] gap-2 text-left">
              {[{ icon: 'file' as const, label: 'Excel (.xlsx) o CSV' }, { icon: 'file' as const, label: 'Catálogo en PDF' }, { icon: 'camera' as const, label: 'Foto del producto' }].map((f) => (
                <li key={f.label} className="flex items-center gap-2.5 rounded-xl bg-(--v2-bg) px-3.5 py-2.5 text-[0.9rem] font-medium"><Icon name={f.icon} size={17} className="text-(--v2-subtle)" />{f.label}</li>
              ))}
            </ul>
          </Included>
          <Included id="estudio" title="Estudio Creativo" body="Imágenes, carruseles y videos cortos para redes con tus productos. Incluido en todos los planes, sin consumir créditos IA."
            link={import.meta.env.VITE_HOME_V2 === 'preview' ? <a href="/#estudio" className="inline-flex min-h-11 items-center text-[0.9375rem] text-(--v2-text) underline-offset-4 after:ml-1 after:content-['›'] hover:underline">Ver ejemplos en la página actual</a> : undefined}>
            <div className="v2-fan flex items-end gap-1 sm:gap-2">
              {[carrusel, oferta, historia].map((src, n) => (
                <img key={src} src={src} alt="" width={360} height={640} loading="lazy" decoding="async" className={`w-[4.75rem] rounded-t-xl object-cover object-top shadow-[0_16px_30px_-18px_rgba(0,0,0,.35)] md:w-[5.5rem] ${n === 1 ? 'aspect-[9/14]' : 'aspect-[9/12]'}`} />
              ))}
            </div>
          </Included>
        </ul>
      </div>
    </Section>
  )
}
