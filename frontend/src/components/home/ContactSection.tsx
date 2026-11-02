import { MessageCircle, MapPin, Clock, Phone, Mail, ArrowUpRight } from 'lucide-react'
import { useStore } from '../../contexts/StoreContext'
import { whatsappLink } from '../../lib/whatsapp'
import { IS_PUBLIC_DEMO } from '../../lib/publicDemo'

/**
 * Contacto y WhatsApp: se oculta por completo si el comercio no cargó
 * ningún canal real. Nunca inventamos teléfonos, direcciones ni horarios.
 */
export default function ContactSection() {
  const { store } = useStore()
  if (IS_PUBLIC_DEMO) return null
  const whatsapp = IS_PUBLIC_DEMO ? null : whatsappLink(store.whatsappPhone, store.defaultWhatsappMessage)

  const hasContact = Boolean(whatsapp || store.phone || store.email || store.address || store.hours)
  if (!hasContact) return null

  return (
    <section className="shell section" id="contacto">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-16 items-start border-t border-line pt-14 lg:pt-20">
        <div className="lg:col-span-6">
          <p className="eyebrow text-accent mb-4">Contacto</p>
          <h2 className="title-section text-ink">
            Comprar debería sentirse<br className="hidden sm:block" /> como una conversación.
          </h2>
          <p className="mt-5 text-[15px] leading-relaxed text-muted max-w-md">
            Resolvemos tallas, disponibilidad y envíos por WhatsApp. Escribimos personas, no bots:
            si dudas entre dos tallas, te ayudamos a elegir antes de comprar.
          </p>

          {whatsapp && (
            <a
              href={whatsapp}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-brand mt-8 inline-flex"
            >
              <MessageCircle size={17} aria-hidden="true" /> Escribir por WhatsApp
            </a>
          )}
        </div>

        <div className="lg:col-span-6 lg:pl-10 lg:border-l border-line w-full">
          <dl className="divide-y divide-line">
            {store.address && (
              <div className="flex items-start gap-4 py-4 first:pt-0">
                <MapPin size={18} className="text-accent mt-0.5 shrink-0" aria-hidden="true" />
                <div className="min-w-0">
                  <dt className="text-[11px] uppercase tracking-[0.16em] text-muted mb-1">Dirección</dt>
                  <dd className="text-sm text-ink">
                    {store.mapsUrl ? (
                      <a href={store.mapsUrl} target="_blank" rel="noopener noreferrer" className="hover:text-accent transition-colors inline-flex items-center gap-1">
                        {store.address} <ArrowUpRight size={13} aria-hidden="true" />
                      </a>
                    ) : store.address}
                  </dd>
                </div>
              </div>
            )}

            {store.hours && (
              <div className="flex items-start gap-4 py-4">
                <Clock size={18} className="text-accent mt-0.5 shrink-0" aria-hidden="true" />
                <div className="min-w-0">
                  <dt className="text-[11px] uppercase tracking-[0.16em] text-muted mb-1">Horario</dt>
                  <dd className="text-sm text-ink">{store.hours}</dd>
                </div>
              </div>
            )}

            {store.phone && (
              <div className="flex items-start gap-4 py-4">
                <Phone size={18} className="text-accent mt-0.5 shrink-0" aria-hidden="true" />
                <div className="min-w-0">
                  <dt className="text-[11px] uppercase tracking-[0.16em] text-muted mb-1">Teléfono</dt>
                  <dd className="text-sm text-ink">
                    <a href={`tel:${store.phone}`} className="hover:text-accent transition-colors">{store.phone}</a>
                  </dd>
                </div>
              </div>
            )}

            {store.email && (
              <div className="flex items-start gap-4 py-4">
                <Mail size={18} className="text-accent mt-0.5 shrink-0" aria-hidden="true" />
                <div className="min-w-0">
                  <dt className="text-[11px] uppercase tracking-[0.16em] text-muted mb-1">Correo</dt>
                  <dd className="text-sm text-ink">
                    <a href={`mailto:${store.email}`} className="hover:text-accent transition-colors break-all">{store.email}</a>
                  </dd>
                </div>
              </div>
            )}
          </dl>

          {store.paymentInfo && (
            <p className="mt-6 text-[12px] leading-relaxed text-muted">
              Medios de pago: {store.paymentInfo}.
            </p>
          )}
          <p className="mt-3 text-[12px] leading-relaxed text-muted">
            Abrir WhatsApp no confirma tu pedido: se confirma en la conversación.
          </p>
        </div>
      </div>
    </section>
  )
}
