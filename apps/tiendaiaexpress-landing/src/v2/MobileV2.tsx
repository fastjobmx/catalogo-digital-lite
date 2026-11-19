// Phone-only helpers of the V2 page.
//  - MobileCtaV2: a slim bar at the bottom of the screen with the main action, shown once the hero has
//    gone by and hidden again where the page already offers it (the contact form, the finale and the footer).
//    Hidden without JS.
//  - ConditionsFoldV2: the twelve commercial conditions follow the plans as part of them: a preview and a
//    button to read them all (every width) (the full text is always in the page for screen readers and
//    without JS). Any link to #condiciones opens them.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { site } from '../config/site'
import { Cta } from './ui'

export function MobileCtaV2() {
  const [show, setShow] = useState(false)
  useEffect(() => {
    const hero = document.getElementById('inicio')
    const quiet = [document.getElementById('contacto'), document.querySelector('.v2-finale'), document.querySelector('footer')].filter((el): el is HTMLElement => Boolean(el))
    if (!hero) return
    let heroOut = false
    const inQuiet = new Set<Element>()
    const update = () => setShow(heroOut && inQuiet.size === 0)
    const heroIo = new IntersectionObserver(([e]) => { heroOut = !e.isIntersecting || e.boundingClientRect.bottom < window.innerHeight * 0.35; update() }, { threshold: [0, 0.05] })
    heroIo.observe(hero)
    const quietIo = new IntersectionObserver((entries) => { entries.forEach((e) => (e.isIntersecting ? inQuiet.add(e.target) : inQuiet.delete(e.target))); update() })
    quiet.forEach((el) => quietIo.observe(el))
    return () => { heroIo.disconnect(); quietIo.disconnect() }
  }, [])
  return (
    <div className="v2-mobile-cta lg:hidden" data-show={show ? 'true' : 'false'} aria-hidden={show ? undefined : 'true'}>
      <div className="flex items-center gap-3">
        <p className="min-w-0 flex-1 text-[0.8125rem] leading-tight text-[#d2d2d7]"><span className="block font-semibold text-[#f5f5f7]">{site.trial.days} días gratis</span>Sin tarjeta de crédito</p>
        <Cta href={site.trialUrl} external tabIndex={show ? undefined : -1} className="!min-h-11 !px-5">Crear mi tienda gratis</Cta>
      </div>
    </div>
  )
}

export function ConditionsFoldV2({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onClick = (e: MouseEvent) => { if ((e.target as Element | null)?.closest('a[href="#condiciones"]')) setOpen(true) }
    document.addEventListener('click', onClick)
    if (location.hash === '#condiciones') setOpen(true)
    return () => document.removeEventListener('click', onClick)
  }, [])
  return (
    <div ref={box} className="v2-light v2-doc v2-fold" data-open={open ? 'true' : undefined}>
      {children}
      {open ? null : (
        <div className="v2-fold-more">
          <button type="button" onClick={() => setOpen(true)} aria-controls="condiciones" aria-expanded="false"
            className="inline-flex min-h-12 items-center rounded-full bg-(--v2-text) px-6 text-[0.9375rem] font-semibold text-(--v2-bg)">Ver todas las condiciones</button>
        </div>
      )}
    </div>
  )
}
