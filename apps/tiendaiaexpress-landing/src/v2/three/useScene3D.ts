// Mounts a WebGL scene on a host element, the careful way: only in motion mode and on devices that can
// comfortably run it (motion/capabilities.ts: no software renderer, no save-data, enough cores/memory;
// ?force3d for QA), only after the page has loaded and gone idle (the first paint is never blocked), and it
// pauses while off screen. Until it is ready (and whenever it is not used) the CSS version stays.
import { useEffect, useState, type RefObject } from 'react'
import { canUse3D } from '../../motion/capabilities'

export type Scene3D = { setActive: (on: boolean) => void; dispose: () => void }

export function useScene3D(host: RefObject<HTMLElement | null>, start: (el: HTMLElement) => Promise<Scene3D>, delay = 600) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const el = host.current
    if (!el || !document.documentElement.classList.contains('motion') || !canUse3D()) return
    let scene: Scene3D | null = null
    let gone = false
    let timer = 0
    let io: IntersectionObserver | null = null
    const boot = () => {
      start(el).then((s) => {
        if (gone) { s.dispose(); return }
        scene = s
        io = new IntersectionObserver(([e]) => scene?.setActive(e.isIntersecting), { rootMargin: '15% 0px' })
        io.observe(el)
        window.setTimeout(() => { if (!gone) setReady(true) }, 250)
      }, () => { /* the CSS version stays */ })
    }
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback
    const later = () => { timer = window.setTimeout(() => (idle ? idle(boot, { timeout: 1500 }) : boot()), delay) }
    if (document.readyState === 'complete') later()
    else window.addEventListener('load', later, { once: true })
    return () => {
      gone = true
      window.clearTimeout(timer)
      window.removeEventListener('load', later)
      io?.disconnect()
      scene?.dispose()
    }
    // start is stable per mount (a module import).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, delay])
  return ready
}
