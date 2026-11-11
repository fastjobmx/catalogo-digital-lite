// Shown after an order is registered: how the buyer sends it to the store.
//  1. "Enviar pedido por WhatsApp" (every device): opens the store's chat with the full order text;
//     the product link lets WhatsApp show the product's real photo in the link preview.
//  2. "Enviar también la foto" (only where the browser can share image files): the system share
//     sheet with the real main photo(s) and the order text; the buyer picks WhatsApp and the chat.
// Nothing here can confirm that a message was sent, and the copy never says so.
import { useEffect, useState } from 'react'
import { Camera, CheckCircle2, MessageCircle } from 'lucide-react'
import { canSharePhotos, photoSources, preparePhotoFiles, recordBuyerAction, sharePhotos, type PhotoSource } from '../../lib/orderShare'
import { shouldOpenWhatsAppInSameTab } from '../../lib/whatsapp'

export type OrderSendState = {
  displayId: string
  checkoutKey: string
  whatsappUrl: string
  message: string
  photos: PhotoSource[]
  /** WhatsApp was already opened automatically (desktop, or phones without photo sharing). */
  autoOpened: boolean
}

type Feedback = { tone: 'ok' | 'info'; text: string } | null

export function OrderSendPanel({ state, storeName }: { state: OrderSendState; storeName: string }) {
  const sources = photoSources(state.photos)
  const shareable = sources.length > 0 && canSharePhotos()
  const [files, setFiles] = useState<File[] | null>(null)
  const [feedback, setFeedback] = useState<Feedback>(null)
  const [sharing, setSharing] = useState(false)

  useEffect(() => {
    if (!shareable) return
    let alive = true
    setFiles(null)
    void preparePhotoFiles(state.photos).then((prepared) => { if (alive) setFiles(prepared) })
    return () => { alive = false }
    // The photos of one registered order do not change: keyed by its number.
  }, [state.displayId, shareable])

  // With photo sharing the buyer stays on this page, so the chat opens in another tab/app.
  const sameTab = shouldOpenWhatsAppInSameTab() && !shareable
  const photoCount = files?.length ?? 0

  const onShare = async () => {
    if (!files?.length || sharing) return
    setSharing(true)
    const result = await sharePhotos(files, state.message, `Pedido ${state.displayId}`)
    setSharing(false)
    if (result === 'shared') {
      recordBuyerAction(state.displayId, state.checkoutKey, 'foto_compartida', files.length)
      setFeedback({ tone: 'ok', text: `Tu celular pasó ${files.length === 1 ? 'la foto' : 'las fotos'} a la app que elegiste. Revisa en WhatsApp que quede enviado en el chat de ${storeName}. El texto del pedido también quedó copiado: si no aparece, mantén presionado y pégalo.` })
    } else if (result === 'cancelled') {
      recordBuyerAction(state.displayId, state.checkoutKey, 'foto_cancelada')
      setFeedback({ tone: 'info', text: 'No se compartió la foto. Puedes intentarlo de nuevo o enviar solo el pedido: ya incluye el enlace del producto.' })
    } else {
      recordBuyerAction(state.displayId, state.checkoutKey, 'foto_no_disponible')
      setFeedback({ tone: 'info', text: 'Tu celular no permitió compartir la foto. Envía el pedido por WhatsApp: incluye el enlace del producto.' })
    }
  }

  return (
    <div className="space-y-2.5 rounded-btn border border-[#25D366]/40 bg-[#25D366]/5 p-3 text-ink">
      <p className="flex items-center gap-2 text-sm font-semibold"><CheckCircle2 size={18} className="shrink-0 text-[#128C4A]" /> Pedido {state.displayId} registrado</p>
      <p className="text-xs text-muted">
        {state.autoOpened
          ? `Abrimos WhatsApp con tu pedido. ${storeName} lo recibe cuando tocas «Enviar» en WhatsApp.`
          : `Falta enviarlo a ${storeName}: la tienda lo recibe cuando tocas «Enviar» en WhatsApp.`}
      </p>
      <a
        href={state.whatsappUrl}
        target={sameTab ? undefined : '_blank'}
        rel="noopener noreferrer"
        onClick={() => recordBuyerAction(state.displayId, state.checkoutKey, 'whatsapp_abierto')}
        className={`w-full inline-flex items-center justify-center gap-2 min-h-[44px] rounded-btn font-semibold transition-colors ${state.autoOpened ? 'border border-[#25D366] text-[#128C4A] hover:bg-[#25D366]/10' : 'bg-[#25D366] text-white hover:brightness-95'}`}
      >
        <MessageCircle size={18} fill={state.autoOpened ? 'none' : 'currentColor'} />
        {state.autoOpened ? 'Abrir WhatsApp otra vez' : shareable ? '1 · Enviar pedido por WhatsApp' : 'Enviar pedido por WhatsApp'}
      </a>
      {shareable && (
        <>
          <button
            type="button"
            onClick={() => void onShare()}
            disabled={!photoCount || sharing}
            className="w-full inline-flex items-center justify-center gap-2 min-h-[44px] rounded-btn border border-[#25D366] bg-surface font-semibold text-[#128C4A] hover:bg-[#25D366]/10 transition-colors disabled:opacity-60"
          >
            <Camera size={18} />
            {files === null ? 'Preparando la foto…' : !photoCount ? 'Foto no disponible' : `${state.autoOpened ? '' : '2 · '}Enviar también ${photoCount === 1 ? 'la foto' : `las ${photoCount} fotos`}`}
          </button>
          <p className="text-xs text-muted">Se abre el menú de compartir de tu celular: elige WhatsApp y el chat de {storeName}. Envía primero el pedido para que ese chat aparezca entre los recientes.</p>
        </>
      )}
      <p className="text-xs text-muted" aria-live="polite">{feedback?.text}</p>
    </div>
  )
}
