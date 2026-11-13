import { useEffect } from 'react'
import { Nav } from './sections/Nav'
import { Hero } from './sections/Hero'
import { Problem, Proof } from './sections/Proof'
import { Features } from './sections/Features'
import { HowItWorks } from './sections/HowItWorks'
import { Stores } from './sections/Stores'
import { Showcase } from './sections/Showcase'
import { Studio } from './sections/Studio'
import { Assistant } from './sections/Assistant'
import { Conditions, Faq, Plans, Setup } from './sections/Commerce'
import { Benefits, Trial } from './sections/Benefits'
import { Contact } from './sections/Contact'
import { Footer } from './sections/Footer'
import { FinalCta } from './sections/FinalCta'
import { StructuredData } from './seo/StructuredData'

/** Reveals [data-reveal] elements as they enter the viewport. Only runs with html.motion (set
 * before first paint when the visitor has not asked for reduced motion); otherwise, and without
 * JS, everything is already visible. */
function useReveal() {
  useEffect(() => {
    if (!document.documentElement.classList.contains('motion')) return
    const items = document.querySelectorAll('[data-reveal]')
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        entry.target.classList.add('is-in')
        io.unobserve(entry.target)
      }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 })
    items.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])
}

/** 3D tilt for [data-tilt] cards: follows a mouse pointer (never touch), only with html.motion. */
function useTilt() {
  useEffect(() => {
    if (!document.documentElement.classList.contains('motion') || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return
    const MAX = 7
    let current: HTMLElement | null = null
    const reset = (el: HTMLElement) => { el.classList.remove('is-tilting'); el.style.removeProperty('--tx'); el.style.removeProperty('--ty') }
    const move = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      const el = (e.target as Element | null)?.closest<HTMLElement>('[data-tilt]') ?? null
      if (current && current !== el) reset(current)
      current = el
      if (!el) return
      const r = el.getBoundingClientRect()
      const x = (e.clientX - r.left) / r.width
      const y = (e.clientY - r.top) / r.height
      const strength = Number(el.dataset.tilt) || 1
      el.classList.add('is-tilting')
      el.style.setProperty('--ty', `${((x - 0.5) * 2 * MAX * strength).toFixed(2)}deg`)
      el.style.setProperty('--tx', `${((0.5 - y) * 2 * MAX * strength).toFixed(2)}deg`)
      el.style.setProperty('--gx', `${(x * 100).toFixed(1)}%`)
      el.style.setProperty('--gy', `${(y * 100).toFixed(1)}%`)
    }
    const leave = () => { if (current) reset(current); current = null }
    document.addEventListener('pointermove', move, { passive: true })
    document.documentElement.addEventListener('pointerleave', leave)
    return () => { document.removeEventListener('pointermove', move); document.documentElement.removeEventListener('pointerleave', leave) }
  }, [])
}

export function App() {
  useReveal()
  useTilt()
  return (
    <>
      <Nav />
      <main id="contenido" tabIndex={-1} className="outline-none">
        <Hero />
        <Proof />
        <Problem />
        <Features />
        <HowItWorks />
        <Stores />
        <Showcase />
        <Studio />
        <Assistant />
        <Trial />
        <Benefits />
        <Plans />
        <Setup />
        <Conditions />
        <Faq />
        <Contact />
        <FinalCta />
      </main>
      <Footer />
      <StructuredData />
    </>
  )
}
