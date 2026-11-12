import { useEffect, useState } from 'react'
import { Check, Copy, Link2, MessageCircle, RefreshCw, Shield, Unlink } from 'lucide-react'
import { tenantHeaders } from '../../lib/tenant'

const API_BASE = import.meta.env.VITE_API_URL || ''

interface WhatsAppStatus {
  available: boolean
  linked: boolean
  phoneEnding?: string | null
  linkedAt?: string | null
  assistantNumber?: string | null
}

interface WhatsAppCode {
  code: string
  expiresAt: string
  expiresInMinutes: number
  deepLink?: string | null
}

/** Minutes and seconds left, or null once the code expired. */
export function timeLeft(expiresAt: string, now: number): string | null {
  const ms = new Date(expiresAt).getTime() - now
  if (!Number.isFinite(ms) || ms <= 0) return null
  const total = Math.ceil(ms / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/**
 * Vincular el asistente de TiendIA por WhatsApp (número central de la plataforma).
 * Solo aparece cuando el servidor lo ofrece a esta cuenta y esta tienda (canal activo y tienda en el piloto).
 * El código nunca se guarda en el navegador ni se registra: vive solo en el estado de esta tarjeta.
 */
export default function WhatsAppLinkCard({ token, backendAvailable }: { token: string | null; backendAvailable: boolean }) {
  const [status, setStatus] = useState<WhatsAppStatus | null>(null)
  const [code, setCode] = useState<WhatsAppCode | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [confirmUnlink, setConfirmUnlink] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  const headers = (): HeadersInit => ({ Authorization: `Bearer ${token}`, ...tenantHeaders() })

  const load = async () => {
    if (!backendAvailable || !token) return
    try {
      const res = await fetch(`${API_BASE}/api/whatsapp/link`, { headers: headers(), cache: 'no-store' })
      setStatus(res.ok ? await res.json() as WhatsAppStatus : null)
    } catch {
      setStatus(null)
    }
  }

  useEffect(() => { void load() }, [backendAvailable, token])

  // Countdown while a code is on screen; when it expires the code is dropped.
  useEffect(() => {
    if (!code) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [code])
  useEffect(() => { if (code && !timeLeft(code.expiresAt, now)) setCode(null) }, [code, now])

  // While a code is shown, check every few seconds whether the merchant already used it.
  useEffect(() => {
    if (!code || status?.linked) return
    const poll = window.setInterval(() => { void load() }, 5000)
    return () => window.clearInterval(poll)
  }, [code, status?.linked])
  useEffect(() => { if (status?.linked) setCode(null) }, [status?.linked])

  if (!status?.available && !status?.linked) return null

  const generate = async () => {
    setBusy(true); setError('')
    try {
      const res = await fetch(`${API_BASE}/api/whatsapp/link-code`, { method: 'POST', headers: headers(), cache: 'no-store' })
      const body = await res.json().catch(() => ({})) as WhatsAppCode & { error?: string }
      if (!res.ok) { setError(body.error || 'No se pudo generar el código.'); return }
      setCode(body); setCopied(false); setNow(Date.now())
    } catch {
      setError('No se pudo conectar con el servidor.')
    } finally {
      setBusy(false)
    }
  }

  const unlink = async () => {
    setBusy(true); setError('')
    try {
      const res = await fetch(`${API_BASE}/api/whatsapp/link`, { method: 'DELETE', headers: headers() })
      if (!res.ok) { setError('No se pudo desvincular. Intenta de nuevo.'); return }
      setConfirmUnlink(false); setCode(null)
      await load()
    } catch {
      setError('No se pudo conectar con el servidor.')
    } finally {
      setBusy(false)
    }
  }

  const copy = () => {
    if (!code) return
    void navigator.clipboard.writeText(`VINCULAR ${code.code}`)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  const remaining = code ? timeLeft(code.expiresAt, now) : null
  const assistant = status.assistantNumber ? `+${status.assistantNumber}` : null

  return (
    <section className="card p-7" aria-labelledby="whatsapp-link-title">
      <div className="flex items-center gap-3.5 mb-6">
        <div className="grid place-items-center w-11 h-11 rounded-btn bg-canvas border border-line">
          <MessageCircle size={22} className="text-brand" />
        </div>
        <div>
          <h2 id="whatsapp-link-title" className="text-base font-bold text-ink">Vincular WhatsApp</h2>
          <p className="text-[11px] text-muted">Asistente TiendIA por WhatsApp</p>
        </div>
      </div>

      {status.linked ? (
        <div className="space-y-5">
          <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-btn flex items-center gap-3">
            <Shield size={20} className="text-emerald-600 shrink-0" />
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest text-emerald-700">Vinculado</p>
              <p className="text-xs text-muted mt-0.5">
                {status.phoneEnding ? `Número terminado en ${status.phoneEnding}` : 'Cuenta de WhatsApp vinculada'}
                {status.linkedAt ? ` · desde ${new Date(`${status.linkedAt.replace(' ', 'T')}Z`).toLocaleString()}` : ''}
              </p>
            </div>
          </div>
          {confirmUnlink ? (
            <div className="p-4 border border-red-200 rounded-btn space-y-3">
              <p className="text-sm text-ink">¿Desvincular este WhatsApp? Dejará de administrar tus tiendas por chat y se cancelan las operaciones pendientes. Telegram no cambia.</p>
              <div className="flex gap-2">
                <button onClick={unlink} disabled={busy} className="flex-1 py-2.5 rounded-btn bg-red-500 text-white text-[11px] font-bold uppercase tracking-widest disabled:opacity-60">
                  Sí, desvincular
                </button>
                <button onClick={() => setConfirmUnlink(false)} disabled={busy} className="flex-1 py-2.5 rounded-btn border border-line text-[11px] font-bold uppercase tracking-widest text-muted">
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setConfirmUnlink(true)}
              className="w-full py-3 rounded-btn border border-red-200 text-[11px] font-bold uppercase tracking-widest text-red-500 hover:bg-red-50 transition-colors flex items-center justify-center gap-2"
            >
              <Unlink size={14} /> Desvincular
            </button>
          )}
        </div>
      ) : !code ? (
        <div className="space-y-4">
          <p className="text-sm text-muted leading-relaxed">
            Genera un código para administrar tu tienda desde WhatsApp{assistant ? <> escribiendo al asistente <span className="text-ink font-semibold whitespace-nowrap">{assistant}</span></> : null}.
            Es de un solo uso y vence en pocos minutos.
          </p>
          <button onClick={generate} disabled={busy || !backendAvailable} className="btn-brand w-full">
            <Link2 size={16} /> {busy ? 'Generando…' : 'Generar código'}
          </button>
        </div>
      ) : (
        <div className="space-y-5 animate-slide-up">
          <div className="p-5 bg-brand/5 border border-brand/20 rounded-card">
            <p className="text-[11px] font-bold uppercase tracking-widest text-brand mb-3 text-center">Envía este mensaje por WhatsApp</p>
            <div className="flex items-center gap-3">
              <code className="flex-1 bg-surface px-4 py-3 rounded-btn text-base font-bold text-ink border border-line overflow-x-auto" data-testid="whatsapp-link-code">
                VINCULAR {code.code}
              </code>
              <button
                onClick={copy}
                className="grid place-items-center w-11 h-11 bg-surface border border-line rounded-btn hover:border-brand transition-colors shrink-0"
                aria-label="Copiar mensaje"
              >
                {copied ? <Check size={18} className="text-emerald-600" /> : <Copy size={18} className="text-brand" />}
              </button>
            </div>
            {code.deepLink && (
              <a href={code.deepLink} target="_blank" rel="noreferrer" className="btn-brand w-full mt-4">
                <MessageCircle size={16} /> Abrir WhatsApp con el mensaje
              </a>
            )}
            <p className="text-[11px] text-center mt-3 text-muted" aria-live="polite">
              Vence en {remaining} · {new Date(code.expiresAt).toLocaleTimeString()}
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => void load()} className="flex-1 py-2.5 rounded-btn border border-line text-[11px] font-bold uppercase tracking-widest text-muted hover:text-ink flex items-center justify-center gap-2">
              <RefreshCw size={13} /> Ya lo envié
            </button>
            <button onClick={() => setCode(null)} className="flex-1 py-2.5 text-[11px] font-bold uppercase tracking-widest text-muted hover:text-ink">
              Cancelar
            </button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="mt-4 text-xs text-red-600">{error}</p>}
    </section>
  )
}
