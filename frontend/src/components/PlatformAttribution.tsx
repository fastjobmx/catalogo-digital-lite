import { ATTRIBUTION_EVENT, PLATFORM_BRAND, attributionUrl } from '../lib/platformBrand'
import { TENANT_SLUG } from '../lib/tenant'

/** Discreet platform attribution shown at the bottom of every public catalogue (one component for all
 * templates). It never covers products, the cart or WhatsApp, and keeps the store's own branding. */
export default function PlatformAttribution({ className = '' }: { className?: string }) {
  const onClick = () => {
    // Analytics hook: listeners can count clicks; no external tracking service is loaded.
    document.dispatchEvent(new CustomEvent(ATTRIBUTION_EVENT, { detail: { store: TENANT_SLUG || 'principal' } }))
  }
  return (
    <p className={`text-xs leading-relaxed ${className}`}>
      ¿Quieres una tienda como esta? Créala con{' '}
      <a
        href={attributionUrl(TENANT_SLUG)}
        target="_blank"
        rel="noopener"
        data-analytics-event={ATTRIBUTION_EVENT}
        onClick={onClick}
        className="font-semibold underline underline-offset-2 hover:opacity-80"
      >
        {PLATFORM_BRAND.wordmark}<span className="sr-only"> (se abre en una pestaña nueva)</span>
      </a>.
    </p>
  )
}
