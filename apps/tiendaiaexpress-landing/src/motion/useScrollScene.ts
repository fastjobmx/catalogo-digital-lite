import { useEffect, type RefObject } from 'react'
import type { gsap as Gsap } from 'gsap'
import type { ScrollTrigger as ScrollTriggerType } from 'gsap/ScrollTrigger'

type Tools = { gsap: typeof Gsap; ScrollTrigger: typeof ScrollTriggerType }

/**
 * Loads GSAP + ScrollTrigger only when motion is allowed (html.motion) and after hydration, so the
 * animation library never delays the first paint. `build` runs inside a gsap.context scoped to
 * `scope`; everything it creates is reverted on unmount. It may return an extra cleanup.
 */
export function useScrollScene(scope: RefObject<HTMLElement | null>, build: (tools: Tools) => void | (() => void)) {
  useEffect(() => {
    if (!document.documentElement.classList.contains('motion')) return
    let cancelled = false
    let revert: (() => void) | undefined
    import('./gsap').then(({ gsap, ScrollTrigger }) => {
      if (cancelled || !scope.current) return
      let extra: void | (() => void)
      const ctx = gsap.context(() => { extra = build({ gsap, ScrollTrigger }) }, scope.current)
      revert = () => { extra?.(); ctx.revert() }
    })
    return () => { cancelled = true; revert?.() }
    // build is defined inline by callers and only needs to run once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
