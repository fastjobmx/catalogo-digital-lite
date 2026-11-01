import { Star, Quote } from 'lucide-react'
import { useStore } from '../../contexts/StoreContext'

export default function TestimonialsSection() {
  const { store } = useStore()
  const testimonials = store.theme.testimonials
  if (testimonials.length === 0) return null

  return (
    <section className="shell section">
      <div className="text-center max-w-2xl mx-auto mb-10">
        <p className="eyebrow text-brand mb-2">Opiniones reales</p>
        <h2 className="text-2xl sm:text-3xl font-extrabold text-ink">Lo que dicen nuestros clientes</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-grid">
        {testimonials.map((t, i) => (
          <figure
            key={`${t.name}-${i}`}
            className="card p-card flex flex-col gap-4 animate-fade-up"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <Quote size={26} className="text-brand/30" fill="currentColor" />
            <blockquote className="text-ink leading-relaxed flex-1">{t.text}</blockquote>
            <figcaption className="flex items-center gap-3 pt-2 border-t border-line">
              <span className="grid place-items-center w-10 h-10 rounded-full bg-brand/10 text-brand font-bold">
                {t.name.charAt(0).toUpperCase()}
              </span>
              <span className="min-w-0">
                <span className="block font-semibold text-ink text-sm truncate">{t.name}</span>
                <span className="block text-xs text-muted truncate">{t.location}</span>
              </span>
              <span className="ml-auto flex text-amber-400 shrink-0">
                {Array.from({ length: 5 }).map((_, s) => (
                  <Star key={s} size={13} fill={s < t.rating ? 'currentColor' : 'none'}
                        className={s < t.rating ? '' : 'text-line'} />
                ))}
              </span>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  )
}
