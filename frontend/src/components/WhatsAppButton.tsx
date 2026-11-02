import { MessageCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useStore } from '../contexts/StoreContext'
import { whatsappLink } from '../lib/whatsapp'
import { IS_PUBLIC_DEMO } from '../lib/publicDemo'

export default function WhatsAppButton() {
  const { store } = useStore()
  if (IS_PUBLIC_DEMO) return null
  const [footerVisible, setFooterVisible] = useState(false)

  useEffect(() => {
    const footer = document.querySelector('footer')
    if (!footer || !('IntersectionObserver' in window)) return

    const observer = new IntersectionObserver(([entry]) => {
      setFooterVisible(Boolean(entry?.isIntersecting))
    }, { threshold: 0.01 })
    observer.observe(footer)
    return () => observer.disconnect()
  }, [])

  const url = whatsappLink(
    store.whatsappOrders || store.whatsappPhone,
    store.defaultWhatsappMessage || 'Hola, quiero información sobre la tienda.',
  )
  // El footer tiene su propio enlace de contacto; evita tapar el copyright.
  if (!url || footerVisible) return null

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] right-[max(1.25rem,env(safe-area-inset-right))] z-40 flex h-14 w-14 items-center justify-center gap-3 rounded-full border border-white/70 bg-[#147B55] text-white shadow-[0_10px_30px_rgba(0,0,0,0.24)] transition duration-200 hover:-translate-y-0.5 hover:bg-[#106947] hover:shadow-[0_14px_36px_rgba(0,0,0,0.28)] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#147B55]/35 sm:h-14 sm:w-auto sm:px-5"
      aria-label="Escribir por WhatsApp"
      title="Escríbenos por WhatsApp"
    >
      <MessageCircle size={21} strokeWidth={2.1} aria-hidden="true" />
      <span className="hidden flex-col items-start leading-tight sm:flex">
        <span className="text-[9px] font-medium uppercase tracking-[0.13em] text-white/75">¿Te ayudamos?</span>
        <span className="text-[13px] font-semibold">WhatsApp</span>
      </span>
    </a>
  )
}
