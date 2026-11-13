// A 3D phone that fills its (relative) parent. Always renders a CSS phone with the real screens,
// posed in perspective by the same driver as the WebGL phone; when the device can comfortably
// run WebGL (motion/capabilities.ts), the Three.js phone is lazy-loaded after the page is idle
// and replaces the CSS one once it has drawn. Reduced motion / no JS: the CSS phone stays still
// at its first pose (set in markup, so the prerendered page already looks right).
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { canUse3D } from '../../motion/capabilities'
import type { PhoneDriver, Pose } from '../../motion/pose'
import { screens, screenSrcSet, type ScreenKey } from '../../content/media'
import { PhoneFrame } from './PhoneFrame'

const PhoneCanvas = lazy(() => import('../../three/PhoneCanvas'))

export const cssTransform = (p: Pose) => `perspective(1600px) rotateX(${-p.rx}rad) rotateY(${p.ry}rad) rotateZ(${-p.rz}rad)`

function place(el: HTMLElement, pose: Pose, w: number, h: number) {
  const height = pose.h * h
  const width = height * 0.49
  el.style.width = `${width}px`
  el.style.height = `${height}px`
  el.style.left = `${pose.cx * w - width / 2}px`
  el.style.top = `${pose.cy * h - height / 2}px`
  el.style.transform = cssTransform(pose)
}

export function Phone3D({ drive, screenKeys, initial, alt, eager, sizes, rimClass = 'neon-rim', children }: {
  drive: PhoneDriver
  screenKeys: ScreenKey[]
  /** First pose, used in markup (SSR / no JS / reduced motion). */
  initial: Pose
  /** Accessible description of the first screen; omit when the phone is decorative. */
  alt?: string
  eager?: boolean
  sizes: string
  rimClass?: string
  children?: ReactNode
}) {
  const box = useRef<HTMLDivElement>(null)
  const phone = useRef<HTMLDivElement>(null)
  const [use3D, setUse3D] = useState(false)
  const [ready3D, setReady3D] = useState(false)
  const [active, setActive] = useState(true)
  const [allScreens, setAllScreens] = useState(false)
  const live = useRef(true)
  live.current = !ready3D && active
  const driveRef = useRef(drive)
  driveRef.current = drive

  // WebGL is decided once the page is idle (on small screens, after the first scroll), so the
  // first paint is never blocked by it.
  useEffect(() => {
    if (!document.documentElement.classList.contains('motion')) return
    let done = false
    const start = () => {
      if (done) return
      done = true
      setAllScreens(true)
      setUse3D(canUse3D())
    }
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback
    window.addEventListener('scroll', start, { once: true, passive: true })
    let timer = 0
    if (window.innerWidth >= 1024) {
      const afterLoad = () => { timer = window.setTimeout(() => (idle ? idle(start, { timeout: 1500 }) : start()), 900) }
      if (document.readyState === 'complete') afterLoad()
      else window.addEventListener('load', afterLoad, { once: true })
    } else {
      setAllScreens(true)
    }
    return () => { window.removeEventListener('scroll', start); window.clearTimeout(timer) }
  }, [])

  // Only animate while on screen.
  useEffect(() => {
    const el = box.current
    if (!el) return
    const io = new IntersectionObserver(([entry]) => setActive(entry.isIntersecting), { rootMargin: '10% 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  // CSS phone: eased toward the driver's pose every frame while it is the visible phone.
  useEffect(() => {
    if (!document.documentElement.classList.contains('motion')) return
    let raf = 0
    let cur: Pose | null = null
    const t0 = performance.now()
    let last = ''
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const el = phone.current
      const b = box.current
      if (!el || !b || !live.current) return
      const w = b.clientWidth
      const h = b.clientHeight
      const { pose, screen } = driveRef.current(w, h, (performance.now() - t0) / 1000)
      if (!cur) cur = { ...pose }
      for (const k of Object.keys(pose) as (keyof Pose)[]) cur[k] += (pose[k] - cur[k]) * 0.12
      const key = `${w}x${h}:${Object.values(cur).map((v) => v.toFixed(4)).join(',')}:${screen.toFixed(3)}`
      if (key === last) return
      last = key
      place(el, cur, w, h)
      const n = screenKeys.length
      el.querySelectorAll<HTMLImageElement>('img[data-screen]').forEach((img) => {
        const i = Number(img.dataset.screen)
        const d = Math.min(Math.abs(screen - i), Math.abs(screen - i - n), Math.abs(screen - i + n))
        img.style.opacity = String(Math.max(0, 1 - d))
      })
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [screenKeys])

  const ih = initial.h * 100
  return (
    <div ref={box} className="absolute inset-0 [container-type:size]">
      {use3D ? (
        <Suspense fallback={null}>
          <div className="absolute inset-0 transition-opacity duration-700" style={{ opacity: ready3D ? 1 : 0 }}>
            <PhoneCanvas active={active} drive={drive} screenKeys={screenKeys} onReady={() => setReady3D(true)} />
          </div>
        </Suspense>
      ) : null}
      <div
        ref={phone}
        className="absolute transition-opacity duration-700 will-change-transform"
        style={{
          opacity: ready3D ? 0 : 1,
          height: `${ih}%`,
          aspectRatio: '0.49',
          top: `${(initial.cy - initial.h / 2) * 100}%`,
          left: `calc(${initial.cx * 100}% - ${ih * 0.245}cqh)`,
          transform: cssTransform(initial),
        }}
      >
        <PhoneFrame width="100%" eager={eager} fill className={`size-full ${rimClass}`}>
          {screenKeys.slice(0, allScreens ? screenKeys.length : 1).map((key, index) => (
            <img
              key={key}
              data-screen={index}
              src={screens[key]}
              srcSet={screenSrcSet[key]}
              sizes={sizes}
              alt={index === 0 && alt ? alt : ''}
              width={390}
              height={844}
              loading={eager ? 'eager' : 'lazy'}
              fetchPriority={eager && index === 0 ? 'high' : 'low'}
              decoding="async"
              className="absolute inset-0 size-full object-cover object-top"
              style={{ opacity: index === 0 ? 1 : 0 }}
            />
          ))}
        </PhoneFrame>
      </div>
      {children}
    </div>
  )
}
