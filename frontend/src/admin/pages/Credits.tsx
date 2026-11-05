import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, Coins, Loader2, Send } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { creditsApi, type StoreCredits } from '../../services/api'
import { FEATURE_LABELS, MOVEMENT_LABELS, REQUEST_STATUS, formatCredits, formatDate } from '../creditLabels'

/** Store view of its AI credits: balance, prices per action, history and recharge requests.
 * The store can only request credits; the platform approves them after receiving the payment. */
export default function Credits() {
  const { token, isDemoSession } = useAuth()
  const [data, setData] = useState<StoreCredits | null>(null)
  const [error, setError] = useState('')
  const [credits, setCredits] = useState('')
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)

  const load = useCallback(async () => {
    if (!token || isDemoSession) return
    try { setData(await creditsApi.get(token)); setError('') }
    catch { setError('No se pudieron cargar los créditos de IA.') }
  }, [token, isDemoSession])
  useEffect(() => { void load() }, [load])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const amount = Number(credits)
    if (!Number.isInteger(amount) || amount <= 0) { setError('Escribe una cantidad entera de créditos.'); return }
    if (!token) return
    setSending(true); setError(''); setSent(false)
    try { await creditsApi.request(amount, note.trim(), token); setCredits(''); setNote(''); setSent(true); await load() }
    catch (err) { setError(err instanceof Error ? err.message : 'No se pudo enviar la solicitud.') }
    finally { setSending(false) }
  }

  const priced = data?.costs.filter((cost) => cost.configured) ?? []

  return (
    <div className="space-y-8 animate-fade-in">
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Coins size={15} className="text-brand" />
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand/70">Herramientas</span>
        </div>
        <h1 className="text-3xl font-black tracking-tight text-ink">Créditos IA</h1>
        <p className="text-muted text-sm mt-1.5">Los créditos pagan las funciones con inteligencia artificial. Sin créditos tu tienda sigue funcionando igual: productos, pedidos, WhatsApp y Telegram.</p>
      </div>

      {isDemoSession && <p className="card p-4 text-sm text-muted">Los créditos se muestran cuando entras con la cuenta real de tu tienda.</p>}
      {error && <p className="card flex items-center gap-2 p-4 text-sm text-red-700" role="alert"><AlertCircle size={17} />{error}</p>}

      {data && (
        <>
          <section className="grid gap-3 sm:grid-cols-3">
            <div className="card p-5">
              <p className="text-xs font-bold uppercase tracking-widest text-muted">Disponibles</p>
              <p className="text-3xl font-black text-ink mt-1">{formatCredits(data.balance)}</p>
              {data.reserved > 0 && <p className="text-xs text-muted mt-1">{formatCredits(data.reserved)} en uso ahora mismo</p>}
            </div>
            <div className="card p-5">
              <p className="text-xs font-bold uppercase tracking-widest text-muted">Usados</p>
              <p className="text-3xl font-black text-ink mt-1">{formatCredits(data.consumed)}</p>
              <p className="text-xs text-muted mt-1">de {formatCredits(data.recharged)} recargados en total</p>
            </div>
            <div className="card p-5">
              <p className="text-xs font-bold uppercase tracking-widest text-muted">Inteligencia artificial</p>
              <p className={`text-lg font-black mt-2 ${data.aiEnabled ? 'text-emerald-700' : 'text-muted'}`}>{data.aiEnabled ? 'Activa' : 'Desactivada'}</p>
              {!data.aiEnabled && <p className="text-xs text-muted mt-1">La plataforma la tiene apagada para tu tienda.</p>}
            </div>
          </section>

          <section className="card p-6 space-y-3">
            <h2 className="text-lg font-black text-ink">Precio por acción</h2>
            {priced.length
              ? <ul className="divide-y divide-line text-sm">{priced.map((cost) => (
                <li key={cost.feature} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="text-ink">{cost.label}</span>
                  <span className="font-bold text-ink whitespace-nowrap">{cost.enabled ? `${formatCredits(cost.credits ?? 0)} créditos` : 'Pausada'}</span>
                </li>))}</ul>
              : <p className="text-sm text-muted">La plataforma aún no ha definido precios en créditos. Mientras tanto, las funciones de IA disponibles usan el límite mensual de tu plan.</p>}
            <p className="text-xs text-muted">Si una acción de IA falla, los créditos se devuelven automáticamente.</p>
          </section>

          <section className="card p-6">
            <h2 className="text-lg font-black text-ink">Pedir una recarga</h2>
            <p className="text-sm text-muted mt-1">Tu solicitud llega a la administración de la plataforma. Los créditos se suman cuando confirmen el pago; aquí no se hace ningún cobro.</p>
            <form onSubmit={submit} className="mt-4 grid gap-3 sm:grid-cols-[10rem_1fr_auto] sm:items-end">
              <label className="block space-y-1.5"><span className="block text-xs font-bold uppercase tracking-widest text-muted">Créditos</span>
                <input className="input-field w-full" inputMode="numeric" pattern="[0-9]*" required value={credits} onChange={(e) => setCredits(e.target.value.replace(/\D/g, ''))} />
              </label>
              <label className="block space-y-1.5"><span className="block text-xs font-bold uppercase tracking-widest text-muted">Nota (opcional)</span>
                <input className="input-field w-full" maxLength={500} placeholder="Ej.: ya hice la transferencia" value={note} onChange={(e) => setNote(e.target.value)} />
              </label>
              <button type="submit" className="btn-brand" disabled={sending}>{sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} Enviar solicitud</button>
            </form>
            {sent && <p className="mt-3 flex items-center gap-2 text-sm text-emerald-700" aria-live="polite"><CheckCircle2 size={16} /> Solicitud enviada. Te avisaremos cuando se apruebe.</p>}
            {data.requests.length > 0 && (
              <ul className="mt-5 divide-y divide-line text-sm">
                {data.requests.map((request) => (
                  <li key={request.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <span className="text-ink">{formatCredits(request.credits)} créditos · <span className="text-muted">{formatDate(request.createdAt)}</span></span>
                    <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-bold ${REQUEST_STATUS[request.status].tone}`}>
                      {REQUEST_STATUS[request.status].label}{request.status === 'aprobada' && request.approvedCredits !== request.credits ? ` (${formatCredits(request.approvedCredits ?? 0)})` : ''}
                    </span>
                    {request.resolutionNote && <p className="w-full text-xs text-muted">{request.resolutionNote}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card p-0 overflow-x-auto">
            <h2 className="text-lg font-black text-ink px-6 pt-6">Movimientos</h2>
            {data.movements.length
              ? <table className="w-full text-sm min-w-[520px] mt-3">
                <thead className="text-left text-xs uppercase tracking-widest text-muted border-b border-line">
                  <tr><th className="px-6 py-3">Fecha</th><th className="px-6 py-3">Movimiento</th><th className="px-6 py-3">Detalle</th><th className="px-6 py-3 text-right">Créditos</th></tr>
                </thead>
                <tbody>{data.movements.map((row) => (
                  <tr key={row.id} className="border-b border-line last:border-0">
                    <td className="px-6 py-3 text-muted whitespace-nowrap">{formatDate(row.createdAt)}</td>
                    <td className="px-6 py-3 text-ink">{MOVEMENT_LABELS[row.kind]}</td>
                    <td className="px-6 py-3 text-muted">{row.feature ? FEATURE_LABELS[row.feature] || row.feature : row.reason || '—'}</td>
                    <td className={`px-6 py-3 text-right font-bold ${row.amount > 0 ? 'text-emerald-700' : 'text-ink'}`}>{row.amount > 0 ? '+' : ''}{row.amount === 0 ? '—' : formatCredits(row.amount)}</td>
                  </tr>))}</tbody>
              </table>
              : <p className="px-6 pb-6 pt-2 text-sm text-muted">Todavía no hay movimientos.</p>}
          </section>
        </>
      )}
    </div>
  )
}
