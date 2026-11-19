// Pointer depth (Fase H · 3D): elements marked [data-v2-tilt] receive --px / --py (−1…1, pointer position
// inside them) so CSS can tilt them in 3D and move a light across them. One delegated listener, written in
// requestAnimationFrame. Only with a fine pointer (mouse / trackpad) and motion allowed: touch devices,
// keyboards and reduced motion see the element at rest. Leaving the element returns it to rest.
import { useEffect, type RefObject } from 'react'

export function usePointerDepth() {
  useEffect(() => {
    const root = document.documentElement
    if (!root.classList.contains('motion') || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return
    let current: HTMLElement | null = null
    let frame = 0
    let x = 0
    let y = 0
    const rest = (el: HTMLElement | null) => {
      if (!el) return
      el.style.removeProperty('--px')
      el.style.removeProperty('--py')
      el.removeAttribute('data-tilting')
    }
    const write = () => {
      frame = 0
      if (!current) return
      const r = current.getBoundingClientRect()
      const px = Math.max(-1, Math.min(1, ((x - r.left) / r.width) * 2 - 1))
      const py = Math.max(-1, Math.min(1, ((y - r.top) / r.height) * 2 - 1))
      current.style.setProperty('--px', px.toFixed(3))
      current.style.setProperty('--py', py.toFixed(3))
      current.setAttribute('data-tilting', '')
    }
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') return
      const el = (e.target as Element | null)?.closest<HTMLElement>('[data-v2-tilt]') ?? null
      if (el !== current) { rest(current); current = el }
      x = e.clientX
      y = e.clientY
      if (current && !frame) frame = requestAnimationFrame(write)
    }
    const onLeave = () => { rest(current); current = null }
    window.addEventListener('pointermove', onMove, { passive: true })
    document.addEventListener('pointerleave', onLeave)
    window.addEventListener('blur', onLeave)
    return () => {
      window.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerleave', onLeave)
      window.removeEventListener('blur', onLeave)
      cancelAnimationFrame(frame)
      rest(current)
    }
  }, [])
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

/** How far a sticky section has travelled (0 at its top, 1 when its end reaches the bottom of the screen). */
export const stickyProgress = (el: HTMLElement) => {
  const travel = el.offsetHeight - window.innerHeight
  return travel > 0 ? clamp01(-el.getBoundingClientRect().top / travel) : 0
}
/** How far an element has crossed the screen (0 as it enters at the bottom, 1 as it leaves at the top). */
export const viewProgress = (el: HTMLElement) => {
  const r = el.getBoundingClientRect()
  return clamp01((window.innerHeight - r.top) / (window.innerHeight + r.height))
}

/**
 * A clip moved by the scroll (Apple-style scrubbing): the scroll position sets --p on the element and the
 * video's currentTime. The clip never plays by itself. It is fetched only when the element gets close and
 * played from memory (scrubbing then works on any server, no Range requests); until it is ready the still
 * image underneath stands in, and data-video="ready" marks the switch. Motion mode only.
 */
export function useScrubVideo(
  target: RefObject<HTMLElement | null>,
  video: RefObject<HTMLVideoElement | null>,
  clip: string,
  progress: (el: HTMLElement) => number,
  toClip: (p: number) => number = (p) => p,
) {
  useEffect(() => {
    const el = target.current
    const v = video.current
    if (!el || !v || !document.documentElement.classList.contains('motion')) return
    let frame = 0
    let ready = false
    let blobUrl = ''
    let gone = false
    const update = () => {
      frame = 0
      const p = progress(el)
      el.style.setProperty('--p', p.toFixed(4))
      if (ready && v.duration) {
        const t = clamp01(toClip(p)) * (v.duration - 0.05)
        if (Math.abs(v.currentTime - t) > 0.03) v.currentTime = t
      }
    }
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update) }
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return
      io.disconnect()
      fetch(clip)
        .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
        .then((b) => { if (gone) return; blobUrl = URL.createObjectURL(b); v.src = blobUrl; v.load() })
        .catch(() => { /* the still image stays */ })
    }, { rootMargin: '1200px 0px' })
    io.observe(el)
    const onReady = () => { ready = true; el.setAttribute('data-video', 'ready'); update() }
    v.addEventListener('loadeddata', onReady)
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    update()
    return () => {
      gone = true
      if (blobUrl) URL.revokeObjectURL(blobUrl)
      io.disconnect()
      v.removeEventListener('loadeddata', onReady)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      cancelAnimationFrame(frame)
    }
  }, [target, video, clip, progress, toClip])
}
