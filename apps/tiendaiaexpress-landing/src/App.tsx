import { Nav } from './sections/Nav'
import { Story } from './sections/Story'
import { Assistant } from './sections/Assistant'
import { Capabilities } from './sections/Capabilities'
import { Showcase } from './sections/Showcase'
import { Benefits } from './sections/Benefits'
import { Compare, Conditions, Faq, Plans, Setup } from './sections/Commerce'
import { Stores } from './sections/Stores'
import { PhotoStudio } from './sections/PhotoStudio'
import { StructuredData } from './seo/StructuredData'
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
        <Stores />
        <PhotoStudio />
        <Trial />
        <Benefits />
        <Compare />
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
