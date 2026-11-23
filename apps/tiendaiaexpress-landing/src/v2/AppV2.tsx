// Home V2. Built only with VITE_HOME_V2: «preview» adds /home-v2 next to the official home (src/App.tsx,
// untouched); «home» makes it the home page (index.html), for the test URL. Visual system: src/v2/home-v2.css + src/v2/ui.tsx.
// New V2 sections where the message or the presentation changes; the official Conditions and Contact
// are reused as they are (same text, same form logic), dressed by the V2 tokens.
import { NavV2 } from './NavV2'
import { HeroStory } from './HeroStory'
import { CustomerV2 } from './CustomerV2'
import { AiV2 } from './AiV2'
import { BenefitsV2 } from './BenefitsV2'
import { StoresV2 } from './StoresV2'
import { AdminV2 } from './AdminV2'
import { PlansV2 } from './PlansV2'
import { FaqV2, faqV2 } from './FaqV2'
import { StructuredData } from '../seo/StructuredData'
import { FinalCtaV2 } from './FinalCtaV2'
import { FooterV2 } from './FooterV2'
import { StepsV2 } from './StepsV2'
import { Conditions } from '../sections/Commerce'
import { Contact } from '../sections/Contact'
import { useSectionReveal } from './ui'
import { usePointerDepth } from './depth'
import { ConditionsFoldV2, MobileCtaV2 } from './MobileV2'

export function AppV2() {
  useSectionReveal()
  usePointerDepth()
  return (
    <>
      <NavV2 />
      <main id="contenido" tabIndex={-1} className="outline-none">
        {/* Order (2026-11-19): understand → believe → want → decide. The portal of the hero ends inside the
            store, so «what your customer sees» comes right after the demo. */}
        <HeroStory />
        <AiV2 />
        <CustomerV2 />
        <AdminV2 />
        <StoresV2 />
        <BenefitsV2 />
        <StepsV2 />
        <PlansV2 />
        <ConditionsFoldV2><Conditions /></ConditionsFoldV2>
        <FaqV2 />
        <div className="v2-light v2-contact"><Contact /></div>
        <FinalCtaV2 />
      </main>
      <FooterV2 />
      <MobileCtaV2 />
      <StructuredData faq={faqV2} channels="WhatsApp y Telegram" />
    </>
  )
}
