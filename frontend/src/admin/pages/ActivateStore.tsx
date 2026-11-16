import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { BadgeCheck, CalendarClock, CheckCircle2, Clock3, Loader2, Package, ShieldCheck, Sparkles } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { formatMoney } from '../../lib/format'
import { storeTrialApi, type StoreTrialStatus, type UpgradePlan } from '../../services/api'

const FEATURE_LABELS: Record<string, string> = {
  catalogo: 'Catálogo online', pedidos_whatsapp: 'Pedidos por WhatsApp', panel: 'Panel administrativo', telegram: 'Asistente por Telegram',
  asistente_ia: 'Asistente con IA', fotos_ia: 'Fotos con IA', voz: 'Notas de voz', documentos: 'Documentos y guías', dominio_propio: 'Dominio propio',
}
const PURPOSE_LABELS: Record<string, string> = {
  trial_signup: 'Enlace para confirmar el correo', trial_welcome: 'Bienvenida a la prueba', welcome: 'Bienvenida', trial_expiring: 'Aviso: la prueba está por vencer',
  trial_ended: 'Aviso: la prueba terminó', plan_requested: 'Contratación recibida', plan_activated: 'Pago verificado y plan activado', password_reset: 'Recuperación de contraseña',
  password_changed: 'Cambio de contraseña', email_verification: 'Verificación de correo',
}
const STATE_LABELS: Record<string, { label: string; tone: string }> = {
  activa: { label: 'Prueba en curso', tone: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  vencida: { label: 'Prueba finalizada', tone: 'bg-red-50 text-red-800 border-red-200' },
  convertida: { label: 'Tienda activa con plan', tone: 'bg-violet-50 text-violet-800 border-violet-200' },
  pendiente: { label: 'Correo sin confirmar', tone: 'bg-amber-50 text-amber-900 border-amber-200' },
}
const delivery = (message: { status: string; deliveryStatus: string | null }) => message.deliveryStatus === 'entregado' ? 'Entregado'
  : message.deliveryStatus === 'rebotado' || message.deliveryStatus === 'queja' ? 'No se pudo entregar'
    : message.status === 'enviado' ? 'Enviado (sin confirmación de entrega)' : message.status === 'fallido' ? 'Falló el envío' : message.status === 'no_configurado' ? 'Correo no configurado' : message.status
const date = (value: string | null, withTime = false) => value ? new Date(value).toLocaleString('es-CO', withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'long' }) : '—'

/** «Activar mi tienda»: trial status, plans and the contract request. The same store keeps everything. */
export default function ActivateStore() {
  const { token } = useAuth()
  const [data, setData] = useState<StoreTrialStatus | null>(null)
  const [cycle, setCycle] = useState<'mensual' | 'anual'>('mensual')
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  const load = useCallback(async () => {
    if (!token) return
    try { setData(await storeTrialApi.status(token)) } catch { setNotice({ tone: 'error', text: 'No pudimos cargar el estado de tu tienda.' }) }
  }, [token])
  useEffect(() => { void load() }, [load])

  const choose = async (plan: UpgradePlan) => {
    if (!token) return
    setBusy(plan.code); setNotice(null)
    try {
      const result = await storeTrialApi.requestPlan(plan.code, cycle, token)
      setNotice({ tone: 'ok', text: `Recibimos tu solicitud ${result.request.code}. Te escribiremos con los datos de pago; el plan se activa cuando confirmemos el pago.` })
      await load()
    } catch (err) {
      setNotice({ tone: 'error', text: err instanceof Error ? (/role does not allow/i.test(err.message) ? 'Solo el propietario de la tienda puede contratar un plan.' : err.message) : 'No pudimos registrar tu solicitud.' })
    } finally { setBusy(null) }
  }

  if (!data) return <p className="flex items-center gap-2 text-sm text-muted"><Loader2 size={16} className="animate-spin" /> Cargando…</p>
  const trial = data.trial
  if (!trial) {
    return (
      <div className="card space-y-2 p-6">
        <h1 className="text-2xl font-black text-ink">Tu tienda ya tiene un plan</h1>
        <p className="text-sm text-muted">Esta tienda no está en prueba gratis. Para cambiar de plan, escribe a <a className="font-bold underline" href="mailto:ventas@tiendiaexpres.com">ventas@tiendiaexpres.com</a>.</p>
      </div>
    )
  }
  const state = STATE_LABELS[trial.status] ?? STATE_LABELS.activa!
  const usage = Math.min(100, Math.round((trial.productCount / Math.max(1, trial.productLimit)) * 100))

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <p className="text-xs font-bold uppercase tracking-widest text-muted">TiendIA Exprés</p>
        <h1 className="text-2xl font-black tracking-tight text-ink">{trial.status === 'convertida' ? 'Tu tienda está activa' : 'Activar mi tienda'}</h1>
        <p className="text-sm text-muted">Si contratas un plan, conservas tu tienda tal como está: el mismo enlace, tus productos, fotos, pedidos y configuración.</p>
      </header>

      {notice && <p role={notice.tone === 'error' ? 'alert' : 'status'} className={`card p-4 text-sm ${notice.tone === 'error' ? 'text-red-700' : 'text-emerald-800'}`}>{notice.text}</p>}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card p-4"><p className="text-xs font-bold uppercase tracking-widest text-muted">Estado</p><span className={`mt-2 inline-flex rounded-full border px-2.5 py-0.5 text-xs font-bold ${state.tone}`}>{state.label}</span></div>
        <div className="card p-4"><p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-muted"><Clock3 size={13} /> Días restantes</p><p className="text-3xl font-black text-ink">{trial.status === 'convertida' ? '—' : trial.daysLeft ?? '—'}</p></div>
        <div className="card p-4"><p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-muted"><CalendarClock size={13} /> {trial.status === 'convertida' ? 'Activada' : 'Vence'}</p><p className="mt-1 text-sm font-bold text-ink">{date(trial.status === 'convertida' ? trial.convertedAt : trial.expiresAt, true)}</p></div>
        <div className="card p-4"><p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-muted"><Package size={13} /> Productos</p>
          <p className="text-3xl font-black text-ink">{trial.productCount}{trial.status !== 'convertida' && <span className="text-base font-bold text-muted"> de {trial.productLimit}</span>}</p>
          {trial.status !== 'convertida' && <div className="mt-2 h-1.5 rounded-full bg-line" aria-hidden="true"><div className="h-1.5 rounded-full bg-brand" style={{ width: `${usage}%` }} /></div>}</div>
      </section>

      {trial.status === 'vencida' && (
        <p className="card border-red-200 bg-red-50 p-4 text-sm text-red-900">Tu prueba terminó. Tus datos siguen guardados, pero la tienda no está visible, no recibe pedidos nuevos y no permite crear productos. Elige un plan para seguir vendiendo con la misma tienda.</p>
      )}

      {trial.openRequest && (
        <section className="card space-y-2 border-violet-200 p-5 text-sm">
          <p className="flex items-center gap-2 text-base font-black text-ink"><ShieldCheck size={18} className="text-brand" /> Solicitud {trial.openRequest.code} · verificando el pago</p>
          <p>Plan <b>{trial.openRequest.planName}</b> · {trial.openRequest.cycle === 'anual' ? 'pago anual' : 'pago mensual'} · <b>{formatMoney(trial.openRequest.amount, trial.openRequest.currency)}</b></p>
          <p className="text-muted">Nuestro equipo de ventas te escribe con los datos de pago desde <b>ventas@tiendiaexpres.com</b>. Tu plan se activa cuando confirmemos el pago; mientras tanto tu tienda sigue como está. Si eliges otro plan, esta solicitud se reemplaza.</p>
        </section>
      )}

      {trial.status === 'convertida' ? (
        <section className="card space-y-2 p-5 text-sm">
          <p className="flex items-center gap-2 text-base font-black text-ink"><BadgeCheck size={18} className="text-brand" /> Plan activo</p>
          <p>Tu tienda ya no tiene los límites de la prueba. <Link to="/admin" className="font-bold underline">Ir al resumen</Link></p>
        </section>
      ) : (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-black text-ink">Elige tu plan</h2>
            <div className="inline-flex rounded-full border border-line bg-surface p-1 text-sm" role="radiogroup" aria-label="Forma de pago">
              {(['mensual', 'anual'] as const).map((option) => (
                <button key={option} type="button" role="radio" aria-checked={cycle === option} onClick={() => setCycle(option)}
                  className={`rounded-full px-4 py-1.5 font-bold transition-colors ${cycle === option ? 'bg-brand text-brand-foreground' : 'text-muted hover:text-ink'}`}>{option === 'mensual' ? 'Mensual' : 'Anual'}</button>
              ))}
            </div>
          </div>
          {!data.plans?.length && <p className="card p-4 text-sm text-muted">Los planes no están disponibles en este momento. Escríbenos por WhatsApp al +57 350 691 2734.</p>}
          <div className="grid gap-4 md:grid-cols-3">
            {(data.plans || []).map((plan) => {
              const amount = plan.amounts[cycle]
              const isOpen = trial.openRequest?.planCode === plan.code && trial.openRequest?.cycle === cycle
              return (
                <article key={plan.code} className={`card flex flex-col gap-3 p-5 ${isOpen ? 'ring-2 ring-brand' : ''}`}>
                  <h3 className="text-lg font-black text-ink">{plan.name}</h3>
                  {cycle === 'mensual'
                    ? <p className="text-sm text-ink"><span className="text-2xl font-black">{formatMoney(plan.monthlyPrice, plan.currency)}</span> / mes<br /><span className="text-muted">+ pago inicial de {formatMoney(plan.setupPrice, plan.currency)}</span></p>
                    : <p className="text-sm text-ink"><span className="text-2xl font-black">{formatMoney(plan.annualPrice, plan.currency)}</span> / año<br /><span className="text-muted">sin pago inicial adicional</span></p>}
                  <p className="text-xs text-muted">Primer pago: <b className="text-ink">{formatMoney(amount, plan.currency)}</b></p>
                  <ul className="flex-1 space-y-1 text-sm text-ink">
                    <li className="flex gap-2"><CheckCircle2 size={15} className="mt-0.5 shrink-0 text-brand" /> {plan.maxProducts ? `Hasta ${plan.maxProducts} productos` : 'Productos ilimitados'}</li>
                    {plan.features.filter((feature) => FEATURE_LABELS[feature]).map((feature) => <li key={feature} className="flex gap-2"><CheckCircle2 size={15} className="mt-0.5 shrink-0 text-brand" /> {FEATURE_LABELS[feature]}</li>)}
                  </ul>
                  <button type="button" className={isOpen ? 'btn-ghost w-full' : 'btn-brand w-full'} disabled={busy !== null || isOpen} onClick={() => void choose(plan)}>
                    {busy === plan.code ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />} {isOpen ? 'Solicitud enviada' : 'Elegir este plan'}
                  </button>
                </article>
              )
            })}
          </div>
          <p className="text-xs text-muted">No cobramos nada en línea ni guardamos tarjetas. El plan se activa solo después de que el equipo de TiendIA Exprés verifica tu pago. {data.ai?.note}</p>
        </section>
      )}

      <section className="card space-y-3 p-5">
        <h2 className="text-base font-black text-ink">Mensajes importantes</h2>
        {!trial.messages.length && <p className="text-sm text-muted">Todavía no hay mensajes.</p>}
        <ul className="divide-y divide-line text-sm">
          {trial.messages.map((message, index) => (
            <li key={`${message.purpose}-${index}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="font-semibold text-ink">{PURPOSE_LABELS[message.purpose] || message.subject}</span>
              <span className="text-muted">{date(message.createdAt, true)} · {delivery(message)}</span>
            </li>
          ))}
        </ul>
        {trial.requests.length > 0 && (
          <div className="border-t border-line pt-3 text-sm">
            <p className="mb-1 font-bold text-ink">Solicitudes de plan</p>
            {trial.requests.map((request) => <p key={request.code} className="text-muted">{request.code} · {request.planName} · {request.cycle} · {formatMoney(request.amount, request.currency)} · {request.status === 'pendiente_pago' ? 'verificando pago' : request.status}</p>)}
          </div>
        )}
      </section>
    </div>
  )
}
