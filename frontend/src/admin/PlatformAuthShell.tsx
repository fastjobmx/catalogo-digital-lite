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

/** Shared frame of the platform access screens: TiendIA Exprés logo, title and, as secondary
 * context only, the store the person is entering. */
export default function PlatformAuthShell({ title, titleAccent, subtitle, storeName, children, below, aside, pageTitle }: {
  title: string; subtitle?: string; storeName?: string | null; children: ReactNode; below?: ReactNode
  /** Second line of the title in the brand lime (side-column layout only). */
  titleAccent?: string
  /** Optional side column (desktop): the pitch next to the form. On phones it goes above the form. */
  aside?: ReactNode
  /** Browser tab title for this screen (defaults to the panel access title). */
  pageTitle?: string
}) {
  usePlatformPageMeta(pageTitle)
  if (aside) {
    const { lime, violet, forest, forestDeep } = PLATFORM_BRAND.colors
    return (
      <div className="relative min-h-screen overflow-clip px-4 py-6 sm:py-10" style={{ ...PLATFORM_VARS, background: `linear-gradient(160deg, #0a3d27 0%, ${forest} 38%, ${forestDeep} 100%)` }}>
        {/* Depth without images: two soft glows in the brand colours and a faint dot grid. */}
        <div aria-hidden="true" className="pointer-events-none absolute -left-40 -top-40 h-[34rem] w-[34rem] rounded-full opacity-25 blur-3xl" style={{ background: lime }} />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-48 -right-40 h-[38rem] w-[38rem] rounded-full opacity-30 blur-3xl" style={{ background: violet }} />
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-[0.07]" style={{ backgroundImage: 'radial-gradient(#ffffff 1px, transparent 1px)', backgroundSize: '22px 22px' }} />

        <div className="relative mx-auto w-full max-w-6xl">
          <header className="mb-6 flex items-center justify-between gap-4 sm:mb-10">
            <a href={PLATFORM_BRAND.siteUrl} aria-label={`${PLATFORM_BRAND.wordmark}: ir al sitio`} className="inline-block shrink-0">
              <img src={PLATFORM_BRAND.logo} width={PLATFORM_BRAND.logoSize.width} height={PLATFORM_BRAND.logoSize.height} alt={PLATFORM_BRAND.wordmark} className="h-auto w-[min(40vw,190px)] rounded-xl" />
            </a>
            {below && <div className="hidden text-right text-sm text-[#d9eadf] sm:block">{below}</div>}
          </header>

          <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,1fr)_460px] lg:gap-16">
            <div className="text-white">
              <h1 className="text-[2rem] font-black leading-[1.05] tracking-tight sm:text-5xl">
                {title}{titleAccent && <><br /><span style={{ color: lime }}>{titleAccent}</span></>}
              </h1>
              {subtitle && <p className="mt-3 text-base text-[#cfe3d6] sm:text-lg">{subtitle}</p>}
              <div className="mt-6 sm:mt-8">{aside}</div>
            </div>
            <div className="relative">
              <div aria-hidden="true" className="absolute -inset-3 rounded-[2rem] opacity-60 blur-2xl" style={{ background: `linear-gradient(135deg, ${lime}55, ${violet}55)` }} />
              <div className="relative">{children}</div>
              {below && <div className="mt-5 text-center text-sm text-[#d9eadf] sm:hidden">{below}</div>}
            </div>
          </div>
        </div>
        <p className="relative mt-10 text-center text-[11px] text-[#9fbcaa]">{PLATFORM_BRAND.wordmark} · {PLATFORM_BRAND.slogan}</p>
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
