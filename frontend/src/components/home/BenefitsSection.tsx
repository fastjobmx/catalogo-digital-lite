import {
  Truck, ShieldCheck, CreditCard, MessageCircle, RefreshCw, Star, Heart, Package, Zap, Award,
  type LucideIcon,
} from 'lucide-react'
import { useStore } from '../../contexts/StoreContext'

const ICONS: Record<string, LucideIcon> = {
  truck: Truck,
  shield: ShieldCheck,
  'credit-card': CreditCard,
  'message-circle': MessageCircle,
  refresh: RefreshCw,
  star: Star,
  heart: Heart,
  package: Package,
  zap: Zap,
  award: Award,
}

export default function BenefitsSection() {
  const { store } = useStore()
  const benefits = store.theme.benefits
  if (benefits.length === 0) return null

  return (
    <section className="shell section-tight" aria-label="Beneficios de compra">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 border-t border-line">
        {benefits.map((b, i) => {
          const Icon = ICONS[b.icon] ?? Truck
          return (
            <div
              key={`${b.title}-${i}`}
              className="flex gap-4 py-7 lg:py-8 lg:px-7 lg:first:pl-0 lg:last:pr-0
                         border-b border-line lg:border-b-0 lg:border-r lg:last:border-r-0 animate-fade-up"
              style={{ animationDelay: `${i * 50}ms` }}
            >
              <Icon size={22} strokeWidth={1.4} className="text-accent shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <h3 className="text-[13px] font-semibold uppercase tracking-[0.1em] text-ink">{b.title}</h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{b.text}</p>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
