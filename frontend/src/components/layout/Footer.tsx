import { Link } from 'react-router-dom'
import { MapPin, Phone, Mail, Clock, Instagram, Facebook, Music2, MessageCircle, ArrowUpRight } from 'lucide-react'
import { useStore } from '../../contexts/StoreContext'
import { useCatalog } from '../../contexts/CatalogContext'
import { whatsappLink } from '../../lib/whatsapp'
import { IS_PUBLIC_DEMO } from '../../lib/publicDemo'

export default function Footer() {
  const { store } = useStore()
  const { categories } = useCatalog()
  const footer = store.theme.footer
  const whatsapp = IS_PUBLIC_DEMO ? null : whatsappLink(
    store.whatsappOrders || store.whatsappPhone,
    store.defaultWhatsappMessage || 'Hola, quiero información sobre la tienda.',
  )

  const socials = IS_PUBLIC_DEMO ? [] : [
    store.instagram && { href: `https://instagram.com/${store.instagram}`, label: 'Instagram', Icon: Instagram },
    store.facebook && { href: `https://facebook.com/${store.facebook}`, label: 'Facebook', Icon: Facebook },
    store.tiktok && { href: `https://tiktok.com/@${store.tiktok}`, label: 'TikTok', Icon: Music2 },
  ].filter(Boolean) as { href: string; label: string; Icon: typeof Instagram }[]

  return (
    <footer className="mt-auto bg-ink text-canvas">
      <div className="shell py-12 sm:py-14">
        <div className="grid grid-cols-1 gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-[1.1fr_0.8fr_1fr_1.1fr] lg:gap-10">
          {/* Marca */}
          <div className="sm:col-span-2 lg:col-span-1">
            <Link to="/" className="inline-flex items-center gap-2.5 mb-4">
              {store.logo ? (
                <img src={store.logo} alt={store.name} className="h-10 w-auto object-contain" />
              ) : (
                <>
                  <span className="grid place-items-center w-9 h-9 rounded-btn text-sm font-black bg-brand text-brand-foreground">
                    {store.name.trim().charAt(0).toUpperCase()}
                  </span>
                  <span className="text-lg font-extrabold text-canvas">{store.name}</span>
                </>
              )}
            </Link>
            <p className="max-w-xs text-sm leading-relaxed footer-copy">
              {footer.aboutText || store.description}
            </p>
            {socials.length > 0 && (
              <div className="mt-5 flex flex-wrap items-center gap-2">
                <span className="mr-1 text-[10px] font-semibold uppercase tracking-[0.16em] footer-copy-soft">Síguenos</span>
                {socials.map(({ href, label, Icon }) => (
                  <a
                    key={label}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={label}
                    className="grid h-10 w-10 place-items-center rounded-btn border border-white/20 bg-white/10 text-canvas transition-colors hover:border-white/40 hover:bg-white/20 focus-visible:outline-canvas"
                  >
                    <Icon size={18} />
                  </a>
                ))}
              </div>
            )}
          </div>

          {/* Categorías */}
          <div>
            <h4 className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-canvas">Tienda</h4>
            <ul className="space-y-3 text-sm footer-copy">
              <li>
                <Link to="/category/all" className="hover:text-canvas transition-colors">Todo el catálogo</Link>
              </li>
              {categories.slice(0, 5).map((cat) => (
                <li key={cat.slug}>
                    <Link to={`/category/${cat.slug}`} className="hover:text-canvas transition-colors focus-visible:underline">
                    {cat.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Contacto */}
          <div>
            <h4 className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-canvas">Contacto</h4>
            <ul className="space-y-3 text-sm leading-relaxed footer-copy">
              {whatsapp && (
                <li>
                  <a
                    href={whatsapp}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-10 items-center gap-2.5 rounded-btn border border-white/20 bg-white/10 px-3 text-canvas transition-colors hover:border-white/40 hover:bg-white/15 focus-visible:outline-canvas"
                  >
                    <MessageCircle size={16} aria-hidden="true" />
                    <span>Escríbenos por WhatsApp</span>
                    <ArrowUpRight size={14} aria-hidden="true" />
                  </a>
                </li>
              )}
              {!IS_PUBLIC_DEMO && store.phone && (
                <li>
                  <a href={`tel:${store.phone}`} className="flex items-center gap-2.5 hover:text-canvas transition-colors">
                    <Phone size={16} className="shrink-0" /> {store.phone}
                  </a>
                </li>
              )}
              {!IS_PUBLIC_DEMO && store.email && (
                <li>
                  <a href={`mailto:${store.email}`} className="flex items-center gap-2.5 hover:text-canvas transition-colors">
                    <Mail size={16} className="shrink-0" /> {store.email}
                  </a>
                </li>
              )}
              {!IS_PUBLIC_DEMO && store.address && (
                <li className="flex items-start gap-2.5">
                  <MapPin size={16} className="shrink-0 mt-0.5" /> <span>{store.address}</span>
                </li>
              )}
              {!IS_PUBLIC_DEMO && store.hours && (
                <li className="flex items-center gap-2.5">
                  <Clock size={16} className="shrink-0" /> {store.hours}
                </li>
              )}
            </ul>
          </div>

          {/* Información */}
          <div>
            <h4 className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-canvas">Información</h4>
            <ul className="space-y-3 text-sm leading-relaxed footer-copy">
              {store.paymentInfo && (
                <li>Medios de pago: {store.paymentInfo}</li>
              )}
              <li className="flex flex-wrap gap-2 pt-1">
                {store.deliveryMethods.includes('envio') && (
                  <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-medium text-canvas">Envío a domicilio</span>
                )}
                {store.pickupAvailable && (
                  <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-medium text-canvas">Recogida en tienda</span>
                )}
              </li>
              {footer.showPolicies && footer.policies && (
                <li className="pt-1">
                  <details className="group">
                    <summary className="cursor-pointer font-medium text-canvas list-none flex items-center gap-1">
                      {footer.policiesTitle || 'Políticas'}
                      <span className="text-canvas/75 transition-transform group-open:rotate-90">›</span>
                    </summary>
                    <p className="mt-2 max-w-prose text-xs leading-relaxed footer-copy">{footer.policies}</p>
                  </details>
                </li>
              )}
            </ul>
          </div>
        </div>

        <div className="mt-10 flex flex-col items-start justify-between gap-3 border-t border-white/20 pt-5 text-xs footer-copy-soft sm:mt-12 sm:flex-row sm:items-center sm:gap-4">
          <p>© {new Date().getFullYear()} {store.name}. {footer.copyright}</p>
          <p className="flex items-center gap-2">
            Hecho con <span className="font-semibold text-canvas">Catálogo Digital Lite</span>
          </p>
        </div>
      </div>
    </footer>
  )
}
