import { useEffect, type CSSProperties, type ReactNode } from 'react'
import { Store } from 'lucide-react'
import { PLATFORM_BRAND } from '../lib/platformBrand'

/** Platform colours for the access screens: they never use a store's palette or logo. */
const PLATFORM_VARS = {
  '--color-background': PLATFORM_BRAND.colors.forest,
  '--color-surface': '#ffffff',
  '--color-text': '#10231a',
  '--color-text-muted': '#4a5f55',
  '--color-border': '#dbe5de',
  '--color-primary': PLATFORM_BRAND.colors.forest,
  '--color-primary-contrast': '#ffffff',
  '--color-accent': PLATFORM_BRAND.colors.violet,
  '--color-button': PLATFORM_BRAND.colors.forest,
  '--color-button-text': PLATFORM_BRAND.colors.lime,
  '--brand-primary': PLATFORM_BRAND.colors.forest,
  '--brand-on-primary': '#ffffff',
  '--brand-button': PLATFORM_BRAND.colors.forest,
  '--brand-on-button': PLATFORM_BRAND.colors.lime,
  '--brand-accent': PLATFORM_BRAND.colors.violet,
  '--font-sans': "'Manrope', 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
  '--font-display': "'Sora', 'Manrope', system-ui, sans-serif",
} as CSSProperties

/** Keeps the browser tab and robots policy of private access screens on the platform identity. */
export function usePlatformPageMeta(title = `${PLATFORM_BRAND.name} | Acceso al panel administrativo`) {
  useEffect(() => {
    const apply = () => {
      document.title = title
      let robots = document.querySelector<HTMLMetaElement>('meta[name="robots"]')
      if (!robots) { robots = document.createElement('meta'); robots.name = 'robots'; document.head.appendChild(robots) }
      robots.content = 'noindex, nofollow'
      const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
      if (icon) icon.href = PLATFORM_BRAND.favicon
    }
    apply()
    // The store context may rename the tab after loading; keep the platform title on these screens.
    const timer = window.setTimeout(apply, 800)
    return () => window.clearTimeout(timer)
  }, [title])
}

/** Shared frame of the platform access screens: Tienda IA Express logo, title and, as secondary
 * context only, the store the person is entering. */
export default function PlatformAuthShell({ title, subtitle, storeName, children, below, aside, pageTitle }: {
  title: string; subtitle?: string; storeName?: string | null; children: ReactNode; below?: ReactNode
  /** Optional side column (desktop): the pitch next to the form. On phones it goes above the form. */
  aside?: ReactNode
  /** Browser tab title for this screen (defaults to the panel access title). */
  pageTitle?: string
}) {
  usePlatformPageMeta(pageTitle)
  if (aside) {
    return (
      <div className="min-h-screen px-4 py-8 sm:py-12" style={{ ...PLATFORM_VARS, background: `radial-gradient(120% 80% at 50% 0%, #0b4029 0%, ${PLATFORM_BRAND.colors.forest} 45%, ${PLATFORM_BRAND.colors.forestDeep} 100%)` }}>
        <div className="mx-auto grid w-full max-w-5xl items-start gap-8 lg:grid-cols-[minmax(0,1fr)_440px] lg:gap-14 lg:pt-6">
          <div className="text-white">
            <a href={PLATFORM_BRAND.siteUrl} aria-label={`${PLATFORM_BRAND.wordmark}: ir al sitio`} className="inline-block">
              <img src={PLATFORM_BRAND.logo} width={PLATFORM_BRAND.logoSize.width} height={PLATFORM_BRAND.logoSize.height} alt={PLATFORM_BRAND.wordmark} className="h-auto w-[min(48vw,240px)] rounded-2xl" />
            </a>
            <h1 className="mt-5 text-[1.75rem] font-black leading-tight tracking-tight sm:mt-6 sm:text-4xl">{title}</h1>
            {subtitle && <p className="mt-2 text-base text-[#cfe3d6]">{subtitle}</p>}
            <div className="mt-5 sm:mt-6">{aside}</div>
          </div>
          <div>
            {children}
            {below && <div className="mt-6 text-center text-[#d9eadf]">{below}</div>}
          </div>
        </div>
        <p className="mt-10 text-center text-[11px] text-[#9fbcaa]">{PLATFORM_BRAND.wordmark} · {PLATFORM_BRAND.slogan}</p>
      </div>
    )
  }
  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10" style={{ ...PLATFORM_VARS, background: `radial-gradient(120% 80% at 50% 0%, #0b4029 0%, ${PLATFORM_BRAND.colors.forest} 45%, ${PLATFORM_BRAND.colors.forestDeep} 100%)` }}>
      <div className="w-full max-w-md">
        <header className="mb-7 text-center">
          <img src={PLATFORM_BRAND.logo} width={PLATFORM_BRAND.logoSize.width} height={PLATFORM_BRAND.logoSize.height} alt={PLATFORM_BRAND.name} className="mx-auto h-auto w-[min(78vw,300px)] rounded-2xl" />
          <h1 className="mt-5 text-2xl font-black tracking-tight text-white">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-[#cfe3d6]">{subtitle}</p>}
          {storeName && <p className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold text-white"><Store size={13} aria-hidden="true" /> Tienda: {storeName}</p>}
        </header>
        {children}
        {below && <div className="mt-6 text-center text-[#d9eadf]">{below}</div>}
        <p className="mt-8 text-center text-[11px] text-[#9fbcaa]">{PLATFORM_BRAND.name} · {PLATFORM_BRAND.slogan}</p>
      </div>
    </div>
  )
}
