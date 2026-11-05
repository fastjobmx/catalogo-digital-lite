import { useCallback, useEffect, useState } from 'react'
import { Check, Coins, Loader2, X } from 'lucide-react'
import { platformCreditsApi, type CreditCost, type CreditMovement, type CreditRequest, type CreditTotals, type PlatformStore } from '../services/api'
import { FEATURE_LABELS, MOVEMENT_LABELS, formatCredits, formatDate } from './creditLabels'

/** Superadmin tools for AI credits: pending recharge requests, price per action and per-store balances. */
export default function PlatformCredits({ token, stores }: { token: string; stores: PlatformStore[] }) {
  const [costs, setCosts] = useState<CreditCost[]>([])
  const [requests, setRequests] = useState<CreditRequest[]>([])
  const [slug, setSlug] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [nextCosts, pending] = await Promise.all([platformCreditsApi.costs(token), platformCreditsApi.requests(token, 'pendiente')])
      setCosts(nextCosts.items); setRequests(pending.items); setError(null)
    } catch { setError('No se pudieron cargar los créditos de IA.') }
  }, [token])
  useEffect(() => { void load() }, [load])

  const run = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key)
    try { await action(); await load() } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo completar la acción.') }
    finally { setBusy(null) }
  }

  const resolve = (request: CreditRequest, decision: 'aprobada' | 'rechazada') => {
    if (decision === 'aprobada') {
      const value = window.prompt(`Créditos a aprobar para ${request.storeName}. Apruébalos solo si ya recibiste el pago.`, String(request.credits))
      if (value === null) return
      const credits = Number(value)
      if (!Number.isInteger(credits) || credits <= 0) { setError('La cantidad debe ser un entero mayor que 0.'); return }
      const note = window.prompt('Nota para la tienda (opcional)', '') ?? ''
      void run(`request-${request.id}`, () => platformCreditsApi.resolve(request.id, 'aprobada', token, { credits, note }))
    } else {
      const note = window.prompt(`Motivo del rechazo para ${request.storeName}`, '')
      if (note === null) return
      void run(`request-${request.id}`, () => platformCreditsApi.resolve(request.id, 'rechazada', token, { note }))
    }
  }

  const editCost = (cost: CreditCost) => {
    const value = window.prompt(`Créditos por «${cost.label}» (0 = sin costo en créditos)`, cost.credits === null ? '' : String(cost.credits))
    if (value === null || value.trim() === '') return
    const credits = Number(value)
    if (!Number.isInteger(credits) || credits < 0) { setError('El costo debe ser un entero desde 0.'); return }
    void run(`cost-${cost.feature}`, () => platformCreditsApi.setCost(cost.feature, credits, cost.enabled, token))
  }

  return (
    <section className="card p-6 space-y-6">
      <div>
        <h2 className="text-lg font-black text-ink flex items-center gap-2"><Coins size={18} /> Créditos de IA</h2>
        <p className="text-sm text-muted mt-1">Los créditos son de cada tienda. Solo tú puedes recargarlos o ajustarlos; las tiendas solo los piden. No hay cobro en línea: aprueba una solicitud después de recibir el pago.</p>
      </div>
      {error && <p role="alert" className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-btn p-3">{error}</p>}

      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest text-muted">Solicitudes pendientes</h3>
        {requests.length
          ? <ul className="mt-2 divide-y divide-line text-sm">{requests.map((request) => (
            <li key={request.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <p className="font-bold text-ink">{request.storeName} · {formatCredits(request.credits)} créditos</p>
                <p className="text-xs text-muted">{formatDate(request.createdAt)} · {request.requestedBy}{request.note ? ` · «${request.note}»` : ''}</p>
              </div>
              <div className="flex gap-2">
                <button type="button" className="btn-ghost" disabled={busy === `request-${request.id}`} onClick={() => resolve(request, 'aprobada')}><Check size={14} /> Aprobar</button>
                <button type="button" className="btn-ghost" disabled={busy === `request-${request.id}`} onClick={() => resolve(request, 'rechazada')}><X size={14} /> Rechazar</button>
              </div>
            </li>))}</ul>
          : <p className="mt-2 text-sm text-muted">No hay solicitudes pendientes.</p>}
      </div>

      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest text-muted">Costo por acción</h3>
        <p className="text-xs text-muted mt-1">Sin un costo definido, la acción usa solo el límite mensual de IA de la tienda.</p>
        <ul className="mt-2 divide-y divide-line text-sm">{costs.map((cost) => (
          <li key={cost.feature} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
            <span className="text-ink">{cost.label}</span>
            <span className="flex items-center gap-3">
              <b className="text-ink whitespace-nowrap">{cost.configured ? `${formatCredits(cost.credits ?? 0)} créditos` : 'Sin definir'}</b>
              <button type="button" className="text-xs underline text-muted hover:text-ink" disabled={busy === `cost-${cost.feature}`} onClick={() => editCost(cost)}>Cambiar</button>
              {cost.configured && <button type="button" className="text-xs underline text-muted hover:text-ink" disabled={busy === `cost-${cost.feature}`}
                onClick={() => void run(`cost-${cost.feature}`, () => platformCreditsApi.setCost(cost.feature, cost.credits ?? 0, !cost.enabled, token))}>{cost.enabled ? 'Pausar' : 'Reanudar'}</button>}
            </span>
          </li>))}</ul>
      </div>

      <div>
        <label className="block space-y-2"><span className="block text-xs font-bold uppercase tracking-widest text-muted">Saldo de una tienda</span>
          <select className="input-field max-w-sm" value={slug} onChange={(e) => setSlug(e.target.value)}>
            <option value="">Elige una tienda…</option>
            {stores.map((store) => <option key={store.slug} value={store.slug}>{store.name}</option>)}
          </select>
        </label>
        {slug && <StoreCreditsPanel key={slug} slug={slug} token={token} onChanged={load} />}
      </div>
    </section>
  )
}

function StoreCreditsPanel({ slug, token, onChanged }: { slug: string; token: string; onChanged: () => Promise<void> }) {
  const [data, setData] = useState<(CreditTotals & { movements: CreditMovement[] }) | null>(null)
  const [kind, setKind] = useState<'recarga' | 'ajuste'>('recarga')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [key, setKey] = useState(() => crypto.randomUUID())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try { setData(await platformCreditsApi.store(slug, token)) } catch { setError('No se pudo cargar el saldo.') }
  }, [slug, token])
  useEffect(() => { void load() }, [load])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const value = Number(amount)
    if (!Number.isInteger(value) || value === 0 || (kind === 'recarga' && value < 0)) { setError(kind === 'recarga' ? 'La recarga debe ser un entero mayor que 0.' : 'El ajuste debe ser un entero distinto de 0 (negativo para descontar).'); return }
    if (!reason.trim()) { setError('Escribe el motivo.'); return }
    setSaving(true); setError(null)
    try {
      await platformCreditsApi.grant(slug, { kind, amount: value, reason: reason.trim() }, key, token)
      setAmount(''); setReason(''); setKey(crypto.randomUUID())
      await Promise.all([load(), onChanged()])
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo registrar el movimiento.') }
    finally { setSaving(false) }
  }

  return (
    <div className="mt-4 space-y-4">
      {data && <p className="text-sm text-ink">Disponibles: <b>{formatCredits(data.balance)}</b>{data.reserved ? ` · en uso ${formatCredits(data.reserved)}` : ''} · usados {formatCredits(data.consumed)} · recargados {formatCredits(data.recharged)}</p>}
      <form onSubmit={submit} className="grid gap-3 md:grid-cols-[9rem_8rem_1fr_auto] md:items-end">
        <label className="block space-y-1.5"><span className="block text-xs font-bold uppercase tracking-widest text-muted">Tipo</span>
          <select className="input-field w-full" value={kind} onChange={(e) => setKind(e.target.value as 'recarga' | 'ajuste')}><option value="recarga">Recarga</option><option value="ajuste">Ajuste</option></select>
        </label>
        <label className="block space-y-1.5"><span className="block text-xs font-bold uppercase tracking-widest text-muted">Créditos</span>
          <input className="input-field w-full" inputMode="numeric" required value={amount} onChange={(e) => setAmount(e.target.value.replace(kind === 'ajuste' ? /[^\d-]/g : /\D/g, ''))} />
        </label>
        <label className="block space-y-1.5"><span className="block text-xs font-bold uppercase tracking-widest text-muted">Motivo</span>
          <input className="input-field w-full" required maxLength={300} placeholder="Ej.: pago recibido por transferencia" value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <button type="submit" className="btn-brand" disabled={saving}>{saving && <Loader2 size={16} className="animate-spin" />} Registrar</button>
      </form>
      {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
      {data && data.movements.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead className="text-left text-xs uppercase tracking-widest text-muted border-b border-line"><tr><th className="py-2 pr-4">Fecha</th><th className="py-2 pr-4">Movimiento</th><th className="py-2 pr-4">Detalle</th><th className="py-2 pr-4">Quién</th><th className="py-2 text-right">Créditos</th></tr></thead>
            <tbody>{data.movements.map((row) => (
              <tr key={row.id} className="border-b border-line last:border-0">
                <td className="py-2 pr-4 text-muted whitespace-nowrap">{formatDate(row.createdAt)}</td>
                <td className="py-2 pr-4 text-ink">{MOVEMENT_LABELS[row.kind]}</td>
                <td className="py-2 pr-4 text-muted">{row.reason || (row.feature ? FEATURE_LABELS[row.feature] || row.feature : '—')}</td>
                <td className="py-2 pr-4 text-muted">{row.actor.replace(/^platform:/, '')}</td>
                <td className="py-2 text-right font-bold">{row.amount > 0 ? '+' : ''}{row.amount === 0 ? '—' : formatCredits(row.amount)}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}
