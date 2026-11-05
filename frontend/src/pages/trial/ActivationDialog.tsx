import { useEffect, useRef, useState } from 'react'
import { AlertCircle, Check, Loader2, MessageCircle, X } from 'lucide-react'
import { trialApi, type TrialActivationRequest } from '../../services/api'
import { PLATFORM_BRAND } from '../../lib/platformBrand'

/** Platform sales contact (Tienda IA Express WhatsApp). */
export const SALES_WHATSAPP = '573506912734'
export const salesLink = (text: string) => `https://wa.me/${SALES_WHATSAPP}?text=${encodeURIComponent(text)}`

/** The real commercial offer published on the Tienda IA Express site (no prices are published). */
export const PLANS = [
  { key: 'lite', name: 'Catálogo Lite', for: 'Para empezar a mostrar.', includes: ['Catálogo con tu plantilla', 'Productos, categorías y variantes', 'Carrito y pedidos por WhatsApp', 'Panel web de administración'] },
  { key: 'ia', name: 'Catálogo IA', for: 'Para administrar desde el celular.', includes: ['Todo lo de Catálogo Lite', 'Asistente en Telegram con IA', 'Pedidos, inventario y cupones', 'Varias tiendas en una cuenta'], featured: true },
  { key: 'medida', name: 'Soluciones a medida', for: 'Para necesidades especiales.', includes: ['Dominio propio (configuración asistida)', 'Diseño o integraciones especiales', 'Acompañamiento para tu equipo', 'Lo conversamos según tu caso'] },
] as const

type Props = {
  trialId: string
  businessName: string
  /** Edit token of this device; without it (shared link) the dialog only offers contact. */
  token: string | null
  shareUrl: string
  onClose: () => void
}

/** «Quiero activar mi tienda»: choose a real plan and leave contact details. No payment is simulated:
 * the request reaches the platform, which confirms the plan and turns the trial into the store. */
export default function ActivationDialog({ trialId, businessName, token, shareUrl, onClose }: Props) {
  const [step, setStep] = useState<'loading' | 'plans' | 'form' | 'done'>(token ? 'loading' : 'plans')
  const [plan, setPlan] = useState<string>('ia')
  const [form, setForm] = useState({ name: '', email: '', phone: '', consent: false })
  const [request, setRequest] = useState<TrialActivationRequest | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dialog = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!token) return
    let active = true
    trialApi.activation(trialId, token).then(({ request: existing }) => {
      if (!active) return
      setRequest(existing)
      if (existing) setPlan(existing.planChoice)
      setStep(existing?.status === 'pendiente' ? 'done' : 'plans')
    }).catch(() => { if (active) setStep('plans') })
    return () => { active = false }
  }, [trialId, token])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    dialog.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!token) return
    setBusy(true); setError(null)
    try {
      const { request: created } = await trialApi.requestActivation(trialId, token, { planChoice: plan, ...form })
      setRequest(created); setStep('done')
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo enviar la solicitud.') }
    finally { setBusy(false) }
  }

  const chosen = PLANS.find((item) => item.key === plan) || PLANS[1]
  const input = 'w-full rounded-xl border border-[#cfd5cf] bg-white px-3.5 py-2.5 text-[15px] outline-none focus:border-[#03301f] focus:ring-2 focus:ring-[#cdf53f]'

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="activation-title" className="max-h-[92dvh] w-full max-w-3xl overflow-y-auto rounded-t-3xl bg-[#f7f8f3] text-[#03301f] shadow-2xl outline-none sm:rounded-3xl">
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 bg-[#03301f] px-5 py-4 text-white sm:px-7">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#cdf53f]">{PLATFORM_BRAND.name}</p>
            <h2 id="activation-title" className="text-xl font-black leading-tight sm:text-2xl">Quiero activar mi tienda</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/10 hover:bg-white/20"><X size={20} /></button>
        </header>

        <div className="space-y-5 px-5 py-6 sm:px-7">
          {step === 'loading' && <p className="flex items-center gap-2"><Loader2 className="animate-spin" size={18} /> Cargando…</p>}

          {step === 'plans' && (
            <>
              <p className="text-[15px] text-[#03301f]/80">Elige el plan para <b>{businessName}</b>. Tu tienda conserva el nombre, el logo, los colores, la plantilla y los productos que ya cargaste.</p>
              <div className="grid gap-3 md:grid-cols-3" role="radiogroup" aria-label="Planes">
                {PLANS.map((item) => (
                  <button key={item.key} type="button" role="radio" aria-checked={plan === item.key} onClick={() => setPlan(item.key)}
                    className={`relative flex flex-col gap-2 rounded-2xl border-2 bg-white p-4 text-left transition-colors ${plan === item.key ? 'border-[#03301f]' : 'border-transparent hover:border-[#03301f]/30'}`}>
                    {'featured' in item && <span className="absolute -top-2.5 right-3 rounded-full bg-[#cdf53f] px-2 py-0.5 text-[10px] font-black uppercase">Recomendado</span>}
                    <span className="flex items-center justify-between"><b className="text-base">{item.name}</b>{plan === item.key && <Check size={18} aria-hidden="true" />}</span>
                    <span className="text-xs text-[#03301f]/70">{item.for}</span>
                    <ul className="space-y-1 text-[13px]">{item.includes.map((line) => <li key={line} className="flex gap-1.5"><Check size={14} className="mt-0.5 shrink-0 text-[#8a2ff5]" aria-hidden="true" />{line}</li>)}</ul>
                  </button>
                ))}
              </div>
              <p className="text-xs text-[#03301f]/60">El precio y la forma de pago te los confirmamos al contactarte. No se cobra nada en esta página.</p>
              {token ? (
                <button type="button" onClick={() => setStep('form')} className="w-full rounded-full bg-[#03301f] py-3.5 text-[15px] font-black text-[#cdf53f] sm:w-auto sm:px-8">Continuar con {chosen.name}</button>
              ) : (
                <div className="space-y-3 rounded-2xl bg-white p-4 text-sm">
                  <p>Esta es una tienda de prueba compartida. Para activarla, quien la creó debe abrirla desde su dispositivo, o escríbenos y te ayudamos.</p>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <a href={salesLink(`Hola, quiero activar una tienda con el plan ${chosen.name}. Vi esta tienda de prueba: ${shareUrl}`)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-2 rounded-full bg-[#03301f] px-5 py-3 font-bold text-[#cdf53f]"><MessageCircle size={16} /> Escribir por WhatsApp</a>
                    <a href="/prueba" className="inline-flex items-center justify-center rounded-full border-2 border-[#03301f] px-5 py-3 font-bold">Crear mi propia tienda de prueba</a>
                  </div>
                </div>
              )}
            </>
          )}

          {step === 'form' && (
            <form onSubmit={submit} className="space-y-4">
              <p className="text-[15px]">Plan elegido: <b>{chosen.name}</b> · <button type="button" className="font-bold underline" onClick={() => setStep('plans')}>cambiar</button></p>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block space-y-1.5"><span className="text-sm font-bold">Tu nombre</span>
                  <input className={input} required minLength={2} maxLength={120} autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
                <label className="block space-y-1.5"><span className="text-sm font-bold">Correo</span>
                  <input className={input} required type="email" maxLength={254} autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                  <span className="block text-xs text-[#03301f]/60">Será el usuario de tu panel. Allí recibirás el enlace para crear tu contraseña.</span></label>
                <label className="block space-y-1.5 sm:col-span-2"><span className="text-sm font-bold">WhatsApp <span className="font-normal text-[#03301f]/60">(opcional, con código del país)</span></span>
                  <input className={input} type="tel" maxLength={30} autoComplete="tel" placeholder="+57 300 000 0000" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
              </div>
              <label className="flex items-start gap-2.5 text-sm">
                <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[#03301f]" checked={form.consent} onChange={(e) => setForm({ ...form, consent: e.target.checked })} required />
                <span>Acepto que {PLATFORM_BRAND.name} me contacte para activar mi tienda y use estos datos solo para eso.</span>
              </label>
              {error && <p role="alert" className="flex items-center gap-2 text-sm font-semibold text-red-700"><AlertCircle size={16} />{error}</p>}
              <button type="submit" disabled={busy} className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#03301f] py-3.5 text-[15px] font-black text-[#cdf53f] disabled:opacity-60 sm:w-auto sm:px-8">{busy && <Loader2 size={16} className="animate-spin" />} Enviar solicitud</button>
            </form>
          )}

          {step === 'done' && request && (
            <div className="space-y-5">
              <div className="rounded-2xl bg-white p-5">
                <p className="text-sm text-[#03301f]/70">Solicitud recibida · {request.planLabel}</p>
                <p className="mt-1 text-3xl font-black tracking-wider">{request.code}</p>
                <p className="mt-2 text-sm">Guarda este código. Mientras revisamos tu solicitud, tu tienda de prueba se conserva aunque venza.</p>
              </div>
              <ol className="space-y-3 text-[15px]">
                {[
                  'Te contactamos para confirmar el plan y la forma de pago.',
                  'Creamos tu cuenta con tu correo: recibirás un enlace de un solo uso para crear tu contraseña (así también verificamos tu correo).',
                  'Tu tienda queda con tu nombre, logo, colores, plantilla, fotos y productos.',
                  'Completas los datos que falten (categorías, envíos) y la tienda queda publicada de forma permanente cuando el plan está activo.',
                ].map((line, index) => (
                  <li key={line} className="flex gap-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#cdf53f] text-sm font-black">{index + 1}</span><span>{line}</span></li>
                ))}
              </ol>
              <div className="flex flex-col gap-2 sm:flex-row">
                <a href={salesLink(`Hola, quiero activar mi tienda «${businessName}». Código de solicitud: ${request.code}. Plan: ${request.planLabel}.`)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-2 rounded-full bg-[#03301f] px-6 py-3 font-bold text-[#cdf53f]"><MessageCircle size={16} /> Agilizar por WhatsApp</a>
                <button type="button" onClick={() => setStep('form')} className="rounded-full border-2 border-[#03301f] px-6 py-3 font-bold">Corregir mis datos</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
