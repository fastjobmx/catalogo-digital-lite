import { useEffect, useState } from 'react'
import { Check, Copy, CreditCard } from 'lucide-react'
import { boldSettingsApi, type BoldSettings } from '../../services/api'
import { useStore } from '../../contexts/StoreContext'

const EVENT_LABELS: Record<string, string> = { SALE_APPROVED: 'venta aprobada', SALE_REJECTED: 'venta rechazada', VOID_APPROVED: 'anulación aprobada', VOID_REJECTED: 'anulación rechazada' }
const RESULT_LABELS: Record<string, string> = {
  aprobado: 'pago aplicado', rechazado: 'rechazo registrado', fallido: 'fallo registrado', anulado: 'anulación aplicada', monto_distinto: 'monto distinto (revisar)',
  duplicado: 'repetido (ya estaba aplicado)', firma_invalida: 'firma inválida: revisa la llave secreta', sin_pasarela: 'tienda sin Bold configurado',
  en_proceso: 'pago en proceso', creado: 'recibido',
}
/** SQLite UTC "2026-11-22 18:11:21" → hora de Colombia. */
const formatHit = (value: string) => new Date(`${value.replace(' ', 'T')}Z`).toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'medium', timeStyle: 'short' })

/** Pago en línea con Bold: llaves del Botón de pagos, modo, envío fijo y URL del webhook. */
export default function BoldPaymentsCard({ token, backendAvailable }: { token: string | null; backendAvailable: boolean }) {
  const { refreshFromApi } = useStore()
  const [settings, setSettings] = useState<BoldSettings | null>(null)
  const [identityKey, setIdentityKey] = useState('')
  const [secretKey, setSecretKey] = useState('')
  const [mode, setMode] = useState<'test' | 'live'>('test')
  const [enabled, setEnabled] = useState(false)
  const [shippingFee, setShippingFee] = useState('0')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const apply = (view: BoldSettings) => {
    setSettings(view)
    setIdentityKey(view.identityKey)
    setMode(view.mode)
    setEnabled(view.enabled)
    setShippingFee(String(view.shippingFee))
    setSecretKey('')
  }

  useEffect(() => {
    if (!token || !backendAvailable) return
    boldSettingsApi.get(token).then(apply).catch(() => setMessage({ ok: false, text: 'No se pudo cargar la configuración de Bold.' }))
  }, [token, backendAvailable])

  if (!token || !backendAvailable) return null

  const save = async () => {
    const fee = Number(shippingFee.replace(/[^\d]/g, '') || 0)
    setBusy(true)
    setMessage(null)
    try {
      const view = await boldSettingsApi.save({ identityKey: identityKey.trim(), ...(secretKey.trim() ? { secretKey: secretKey.trim() } : {}), mode, enabled, shippingFee: fee }, token)
      apply(view)
      await refreshFromApi().catch(() => undefined)
      setMessage({ ok: true, text: view.enabled ? `Pago en línea activo en modo ${view.mode === 'test' ? 'de pruebas' : 'producción'}.` : 'Guardado. El pago en línea está apagado en la tienda.' })
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'No se pudo guardar.' })
    } finally { setBusy(false) }
  }

  const copyWebhook = async () => {
    if (!settings) return
    try { await navigator.clipboard.writeText(settings.webhookUrl); setCopied(true); window.setTimeout(() => setCopied(false), 1500) } catch { /* no clipboard */ }
  }

  return (
    <section className="card p-7">
      <h2 className="text-lg font-bold text-ink mb-4 flex items-center gap-2.5 border-b border-line pb-4">
        <CreditCard size={20} /> Pago en línea con Bold
      </h2>
      <div className="space-y-4 text-sm">
        <p className="text-muted">Tus clientes pagan con tarjeta, PSE o Nequi desde el carrito. El pedido queda como <strong>Pago verificado</strong> solo cuando Bold confirma el pago.</p>
        <label className="flex items-center gap-2 font-semibold text-ink">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Mostrar «Pagar en línea» en la tienda
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1"><span className="text-xs font-semibold text-muted">Modo</span>
            <select value={mode} onChange={(e) => setMode(e.target.value as 'test' | 'live')} className="input-field text-sm">
              <option value="test">Pruebas (no cobra dinero real)</option>
              <option value="live">Producción (cobros reales)</option>
            </select>
          </label>
          <label className="space-y-1"><span className="text-xs font-semibold text-muted">Envío fijo que se suma al pago (COP)</span>
            <input inputMode="numeric" value={shippingFee} onChange={(e) => setShippingFee(e.target.value)} className="input-field text-sm" placeholder="0" />
          </label>
        </div>
        <label className="block space-y-1"><span className="text-xs font-semibold text-muted">Llave de identidad</span>
          <input value={identityKey} onChange={(e) => setIdentityKey(e.target.value)} className="input-field text-sm font-mono" autoComplete="off" spellCheck={false} />
        </label>
        <label className="block space-y-1"><span className="text-xs font-semibold text-muted">Llave secreta {settings?.secretHint ? `(guardada: ${settings.secretHint})` : ''}</span>
          <input type="password" value={secretKey} onChange={(e) => setSecretKey(e.target.value)} className="input-field text-sm font-mono" autoComplete="new-password" spellCheck={false}
            placeholder={settings?.configured ? 'Déjala vacía para conservar la actual' : 'Pega la llave secreta'} />
        </label>
        <p className="text-[11px] text-muted">Están en bold.co › Integraciones › Llaves de integración › Botón de pagos. Usa las de pruebas y las de producción del mismo ambiente que el modo elegido. La llave secreta se guarda cifrada y nunca se vuelve a mostrar.</p>
        {settings && <div className="rounded-btn border border-line bg-canvas p-3 space-y-1">
          <p className="text-xs font-semibold text-ink">URL del webhook (bold.co › Integraciones › Webhooks)</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all text-[11px]">{settings.webhookUrl}</code>
            <button type="button" onClick={() => void copyWebhook()} className="shrink-0 p-1.5 text-muted hover:text-ink" aria-label="Copiar URL del webhook">{copied ? <Check size={16} /> : <Copy size={16} />}</button>
          </div>
          <p className="text-[11px] text-muted">Con el webhook, los pagos se confirman aunque el cliente no vuelva a la tienda.</p>
          <p className="text-[11px] font-semibold text-ink" role="status">{settings.lastWebhook
            ? `Último aviso de Bold: ${formatHit(settings.lastWebhook.receivedAt)} · ${EVENT_LABELS[settings.lastWebhook.eventType || ''] || settings.lastWebhook.eventType || 'evento'} · ${RESULT_LABELS[settings.lastWebhook.result] || settings.lastWebhook.result}`
            : `Bold aún no ha enviado avisos a esta tienda.${settings.mode === 'test' ? ' En modo de pruebas Bold no los envía; los pagos se confirman consultando a Bold.' : ''}`}</p>
        </div>}
        {message && <p className={`text-xs font-semibold ${message.ok ? 'text-emerald-700' : 'text-red-600'}`} role="status">{message.text}</p>}
        <button onClick={() => void save()} disabled={busy || !identityKey.trim() || (!settings?.configured && !secretKey.trim())} className="btn-brand disabled:opacity-50">
          {busy ? 'Guardando…' : 'Guardar pago en línea'}
        </button>
      </div>
    </section>
  )
}
