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
import { Contact } from './sections/Contact'
import { Footer } from './sections/Footer'
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

export function App() {
  useReveal()
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
        <Plans />
        <Setup />
        <Conditions />
        <Faq />
        <Contact />
      </main>
      <Footer />
      <StructuredData />
    </>
  )
}
