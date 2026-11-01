import { Link } from 'react-router-dom'
import { MessageCircle, ArrowRight } from 'lucide-react'
import { useStore } from '../../contexts/StoreContext'
import { whatsappLink } from '../../lib/whatsapp'

export default function CtaSection() {
  const { store } = useStore()
  const whatsapp = whatsappLink(
    store.whatsappOrders || store.whatsappPhone,
    store.defaultWhatsappMessage || 'Hola, quiero hacer un pedido:',
  )

  return (
    <section className="shell section">
      <div
        className="relative overflow-hidden bg-ink text-canvas px-7 py-16 sm:px-14 sm:py-20 lg:py-24"
        style={{ borderRadius: 'var(--radius-card)' }}
      >
        <div
          className="absolute -top-32 -right-24 w-[34rem] h-[34rem] rounded-full blur-3xl opacity-[0.18]"
          style={{ background: 'var(--color-accent)' }}
          aria-hidden="true"
        />
        <div className="relative grid lg:grid-cols-12 gap-10 items-end">
          <div className="lg:col-span-8">
            <p className="eyebrow text-canvas/60 mb-5">Cierre</p>
            <h2 className="font-display text-[clamp(2rem,1.3rem+2.6vw,3.6rem)] leading-[1.02] tracking-[-0.03em] text-canvas">
              Encuentra el par<br className="hidden sm:block" /> que te acompaña.
            </h2>
            <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-canvas/70">
              Explora la selección completa o escríbenos: te asesoramos con tallas, disponibilidad y envío.
              El pedido se confirma en la conversación de WhatsApp.
            </p>
          </div>

          <div className="lg:col-span-4 flex flex-col sm:flex-row lg:flex-col gap-3 lg:items-end">
            <Link
              to="/category/all"
              className="group inline-flex items-center justify-center gap-3 min-h-[50px] px-7 py-3
                         text-[12px] font-semibold uppercase tracking-[0.12em] transition-colors
                         bg-[var(--color-background)] text-[var(--color-text)] hover:bg-[var(--color-surface)] w-full lg:w-auto"
              style={{ borderRadius: 'var(--radius-btn)' }}
            >
              Explorar catálogo
              <ArrowRight size={15} className="transition-transform group-hover:translate-x-1" aria-hidden="true" />
            </Link>
            {whatsapp && (
              <a
                href={whatsapp}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 min-h-[50px] px-7 py-3 w-full lg:w-auto
                           text-[12px] font-semibold uppercase tracking-[0.12em] text-canvas
                           border border-canvas/35 hover:bg-canvas/10 transition-colors"
                style={{ borderRadius: 'var(--radius-btn)' }}
              >
                <MessageCircle size={16} aria-hidden="true" /> WhatsApp
              </a>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
