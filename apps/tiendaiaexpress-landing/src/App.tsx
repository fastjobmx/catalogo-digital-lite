import { Nav } from './sections/Nav'
import { Story } from './sections/Story'
import { Assistant } from './sections/Assistant'
import { Capabilities } from './sections/Capabilities'
import { Showcase } from './sections/Showcase'
import { Benefits } from './sections/Benefits'
import { Compare, Faq, Plans } from './sections/Commerce'
import { Contact } from './sections/Contact'
import { Footer } from './sections/Footer'
import { Trial } from './sections/Trial'

export function App() {
  return (
    <>
      <Nav />
      <main id="contenido" tabIndex={-1} className="outline-none">
        <Story />
        <Assistant />
        <Capabilities />
        <Showcase />
        <Trial />
        <Benefits />
        <Compare />
        <Plans />
        <Faq />
        <Contact />
      </main>
      <Footer />
    </>
  )
}
