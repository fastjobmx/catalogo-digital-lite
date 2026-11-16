import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, BadgeCheck, CalendarPlus, Loader2, Mail, RefreshCw, XCircle } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { formatMoney } from '../lib/format'
import { trialStoresAdminApi, type PlanRequestAdminItem, type StoreEmailItem, type TrialIncident, type TrialStoreItem, type TrialStoreSummary } from '../services/api'

const STATUS: Record<string, { label: string; tone: string }> = {
  pendiente: { label: 'Sin confirmar correo', tone: 'bg-amber-50 text-amber-900 border-amber-200' },
  activa: { label: 'En prueba', tone: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  vencida: { label: 'Vencida', tone: 'bg-red-50 text-red-800 border-red-200' },
  convertida: { label: 'Convertida', tone: 'bg-violet-50 text-violet-800 border-violet-200' },
}
const REQUEST_STATUS: Record<string, string> = { pendiente_pago: 'Esperando verificación de pago', activada: 'Plan activado', cancelada: 'Cancelada' }
const INCIDENT_LABEL: Record<string, string> = { pago_sin_verificar: 'Pago sin verificar', factura_pagada_sin_activar: 'Factura pagada sin activar', estado_inconsistente: 'Estado inconsistente', correo_no_entregado: 'Correo no entregado', correo_sin_confirmar: 'Registro sin confirmar' }
const when = (value: string | null) => (value ? new Date(value).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }) : '—')
const emailState = (status: string, delivery: string | null) => delivery === 'entregado' ? 'entregado' : delivery ? delivery : status === 'enviado' ? 'aceptado por el proveedor' : status

/** Superadmin: real free-trial stores, contracts waiting for the payment check, conversions, emails and incidents. */
export default function PlatformTrialStoresPage() {
  const { token, role, isAuthenticated, isLoading } = useAuth()
  const [summary, setSummary] = useState<TrialStoreSummary | null>(null)
  const [stores, setStores] = useState<TrialStoreItem[]>([])
  const [requests, setRequests] = useState<PlanRequestAdminItem[]>([])
  const [incidents, setIncidents] = useState<TrialIncident[]>([])
  const [filter, setFilter] = useState('')
  const [reference, setReference] = useState<Record<number, string>>({})
  const [verified, setVerified] = useState<Record<number, boolean>>({})
  const [extendFor, setExtendFor] = useState<string | null>(null)
  const [extension, setExtension] = useState({ days: 3, reason: '' })
  const [emails, setEmails] = useState<{ slug: string; items: StoreEmailItem[] } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  const load = useCallback(async () => {
    if (!token) return
    try {
      const [nextSummary, list, requestList, incidentList] = await Promise.all([
        trialStoresAdminApi.summary(token), trialStoresAdminApi.list(token, filter || undefined), trialStoresAdminApi.requests(token), trialStoresAdminApi.incidents(token),
      ])
      setSummary(nextSummary); setStores(list.items); setRequests(requestList.items); setIncidents(incidentList.items)
    } catch { setNotice({ tone: 'error', text: 'Esta sección es solo para la administración de la plataforma.' }) }
  }, [token, filter])
  useEffect(() => { void load() }, [load])

  const run = async (key: string, action: () => Promise<string | void>) => {
    setBusy(key); setNotice(null)
    try { const text = await action(); if (text) setNotice({ tone: 'ok', text }); await load() }
    catch (err) { setNotice({ tone: 'error', text: err instanceof Error ? err.message : 'No se pudo completar la acción.' }) }
    finally { setBusy(null) }
  }

  if (isLoading) return null
  if (!isAuthenticated) return <Navigate to="/admin/login" replace />
  const pending = requests.filter((item) => item.status === 'pendiente_pago')

  return (
    <div className="min-h-screen bg-canvas px-4 py-8 md:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted"><img src="/brand/tiendaiaexpress/icon-192.png" alt="" width={20} height={20} className="rounded" /> TiendIA Exprés · Plataforma</p>
            <h1 className="text-2xl font-black tracking-tight text-ink">Prueba gratis y contrataciones</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-ghost" onClick={() => void load()}><RefreshCw size={16} /> Actualizar</button>
            <Link to="/plataforma/pruebas" className="btn-ghost">Mini tiendas anteriores</Link>
            <Link to="/plataforma" className="btn-ghost"><ArrowLeft size={16} /> Volver a la plataforma</Link>
          </div>
        </header>
        {role && role !== 'superadmin' && <p className="card border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Esta sección es para la administración de la plataforma.</p>}
        {notice && <p role={notice.tone === 'error' ? 'alert' : 'status'} className={`card p-4 text-sm ${notice.tone === 'error' ? 'text-red-700' : 'text-emerald-800'}`}>{notice.text}</p>}

        {summary && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
            {([
              ['Registros', summary.total, `${summary.pendingEmail} sin confirmar`], ['En prueba', summary.active, `${summary.expiringSoon} vencen en 3 días`],
              ['Vencidas', summary.expired, 'Datos conservados'], ['Convertidas', summary.converted, `${summary.conversionRate}% de las iniciadas`],
              ['Pagos por verificar', summary.pendingPayments.count, formatMoney(summary.pendingPayments.amount, 'COP')],
              ['Correos (30 días)', summary.emails.reduce((sum, row) => sum + row.count, 0), `${summary.emails.filter((row) => row.delivery === 'entregado').reduce((sum, row) => sum + row.count, 0)} entregados confirmados`],
              ['Incidencias', incidents.length, 'Requieren revisión'],
            ] as const).map(([label, value, hint]) => (
              <div key={label} className="card p-4"><p className="text-xs font-bold uppercase tracking-widest text-muted">{label}</p><p className="text-3xl font-black text-ink">{value}</p><p className="text-xs text-muted">{hint}</p></div>
            ))}
          </div>
        )}

        <section className="card space-y-4 p-5">
          <h2 className="text-lg font-black text-ink">Contrataciones por verificar</h2>
          <p className="text-sm text-muted">Activa el plan solo después de comprobar el pago por el procedimiento autorizado (comprobante o transferencia recibida). La activación conserva la misma tienda y todos sus datos. También se activa si marcas como pagada su factura.</p>
          {!pending.length && <p className="text-sm text-muted">No hay contrataciones esperando pago.</p>}
          {pending.map((item) => (
            <article key={item.id} className="space-y-3 rounded-btn border border-line p-4 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div><p className="font-mono text-base font-black text-ink">{item.code}</p><p className="text-muted">{when(item.createdAt)} · {item.storeName} ({item.slug}) · {item.requestedBy}</p></div>
                <p className="text-right"><b>{item.planName}</b> · {item.cycle}<br /><span className="text-lg font-black">{formatMoney(item.amount, item.currency)}</span><br /><span className="text-xs text-muted">Factura #{item.invoiceId} · {item.invoiceStatus}</span></p>
              </div>
              <div className="flex flex-wrap items-end gap-2 border-t border-line pt-3">
                <label className="block min-w-[240px] flex-1 space-y-1"><span className="text-xs font-bold uppercase tracking-widest text-muted">Referencia del pago verificado</span>
                  <input className="input-field w-full" value={reference[item.id] || ''} onChange={(e) => setReference({ ...reference, [item.id]: e.target.value })} placeholder="Ej.: Transferencia Bancolombia 12345" /></label>
                <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={Boolean(verified[item.id])} onChange={(e) => setVerified({ ...verified, [item.id]: e.target.checked })} /> Verifiqué el pago</label>
                <button type="button" className="btn-brand" disabled={busy !== null || !verified[item.id] || (reference[item.id] || '').trim().length < 3}
                  onClick={() => void run(`activate-${item.id}`, async () => { const result = await trialStoresAdminApi.activate(item.id, reference[item.id]!.trim(), token!); return result.replayed ? `${result.code} ya estaba activada.` : `Plan ${result.planCode} activado en ${item.storeName}. La tienda conserva todos sus datos.` })}>
                  {busy === `activate-${item.id}` ? <Loader2 size={15} className="animate-spin" /> : <BadgeCheck size={15} />} Pago verificado · activar plan</button>
                <button type="button" className="btn-ghost" disabled={busy !== null} onClick={() => { const reason = window.prompt('Motivo de la cancelación'); if (reason !== null) void run(`cancel-${item.id}`, async () => { await trialStoresAdminApi.cancel(item.id, reason, token!); return 'Contratación cancelada. La prueba sigue igual.' }) }}><XCircle size={15} /> Cancelar</button>
              </div>
            </article>
          ))}
        </section>

        {incidents.length > 0 && (
          <section className="card space-y-2 p-5 text-sm">
            <h2 className="flex items-center gap-2 text-lg font-black text-ink"><AlertTriangle size={18} className="text-amber-600" /> Incidencias</h2>
            {incidents.map((item, index) => <p key={`${item.kind}-${index}`}><b>{INCIDENT_LABEL[item.kind] || item.kind}</b> · {item.slug || '—'} · {item.detail} {item.at && <span className="text-muted">({when(item.at)})</span>}</p>)}
          </section>
        )}

        <section className="card space-y-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-black text-ink">Tiendas en prueba</h2>
            <select className="input-field" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filtrar tiendas de prueba">
              <option value="">Todas</option><option value="pendiente">Sin confirmar correo</option><option value="activa">En prueba</option><option value="por_vencer">Vencen en 3 días</option><option value="vencida">Vencidas</option><option value="convertida">Convertidas</option>
            </select>
          </div>
          {!stores.length && <p className="text-sm text-muted">No hay tiendas{filter ? ' con este filtro' : ''}.</p>}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="text-xs uppercase tracking-widest text-muted"><tr><th className="py-2">Tienda</th><th>Estado</th><th>Vence</th><th>Productos</th><th>Pedidos</th><th>Propietario</th><th>Último correo</th><th /></tr></thead>
              <tbody className="divide-y divide-line">
                {stores.map((item) => (
                  <tr key={item.id} className="align-top">
                    <td className="py-2"><p className="font-bold text-ink">{item.name}</p><p className="text-xs text-muted">{item.slug} · {item.planCode}</p></td>
                    <td><span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-bold ${STATUS[item.status]?.tone}`}>{STATUS[item.status]?.label}</span>{item.retentionReached && <p className="text-xs text-red-700">Retención cumplida (revisar)</p>}{item.extendedDays > 0 && <p className="text-xs text-muted">+{item.extendedDays} días extendidos</p>}</td>
                    <td>{item.status === 'convertida' ? <span className="text-xs">Convertida {when(item.convertedAt)} · {item.convertedPlanCode}</span> : <>{when(item.expiresAt)}{item.daysLeft !== null && item.status === 'activa' && <p className="text-xs text-muted">{item.daysLeft} días</p>}</>}</td>
                    <td>{item.products}</td><td>{item.orders}</td>
                    <td className="text-xs">{item.ownerEmail}<p className={item.ownerVerified ? 'text-emerald-700' : 'text-amber-700'}>{item.ownerVerified ? 'Correo confirmado' : 'Sin confirmar'}</p></td>
                    <td className="text-xs">{item.lastEmail ? <>{item.lastEmail.purpose}<p className="text-muted">{emailState(item.lastEmail.status, item.lastEmail.deliveryStatus)}</p></> : '—'}</td>
                    <td className="space-y-1 text-right">
                      <button type="button" className="btn-ghost !px-2 !py-1 text-xs" onClick={() => void run(`emails-${item.slug}`, async () => { setEmails({ slug: item.slug, items: (await trialStoresAdminApi.emails(item.slug, token!)).items }) })}><Mail size={13} /> Correos</button>
                      {(item.status === 'activa' || item.status === 'vencida') && <button type="button" className="btn-ghost !px-2 !py-1 text-xs" onClick={() => { setExtendFor(item.slug); setExtension({ days: 3, reason: '' }) }}><CalendarPlus size={13} /> Extender</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {extendFor && (
          <section className="card space-y-3 border-violet-200 p-5 text-sm">
            <h2 className="text-base font-black text-ink">Extender la prueba de {extendFor}</h2>
            <p className="text-muted">Solo la administración de la plataforma puede hacerlo. Queda registrado con tu usuario y el motivo (máximo 30 días en total).</p>
            <div className="flex flex-wrap items-end gap-2">
              <label className="space-y-1"><span className="block text-xs font-bold uppercase tracking-widest text-muted">Días</span><input type="number" min={1} max={14} className="input-field w-24" value={extension.days} onChange={(e) => setExtension({ ...extension, days: Number(e.target.value) })} /></label>
              <label className="min-w-[260px] flex-1 space-y-1"><span className="block text-xs font-bold uppercase tracking-widest text-muted">Motivo</span><input className="input-field w-full" value={extension.reason} onChange={(e) => setExtension({ ...extension, reason: e.target.value })} /></label>
              <button type="button" className="btn-brand" disabled={busy !== null || extension.reason.trim().length < 5} onClick={() => void run('extend', async () => { const result = await trialStoresAdminApi.extend(extendFor, extension.days, extension.reason.trim(), token!); setExtendFor(null); return `Prueba extendida hasta ${when(result.expiresAt)}.` })}>Extender</button>
              <button type="button" className="btn-ghost" onClick={() => setExtendFor(null)}>Cerrar</button>
            </div>
          </section>
        )}

        {emails && (
          <section className="card space-y-3 p-5 text-sm">
            <div className="flex items-center justify-between"><h2 className="text-base font-black text-ink">Correos de {emails.slug}</h2><button type="button" className="btn-ghost" onClick={() => setEmails(null)}>Cerrar</button></div>
            <p className="text-xs text-muted">«Aceptado por el proveedor» no significa entregado: la entrega solo se confirma con el evento del proveedor.</p>
            {!emails.items.length && <p className="text-muted">Sin correos.</p>}
            <ul className="divide-y divide-line">{emails.items.map((item) => <li key={item.id} className="flex flex-wrap justify-between gap-2 py-2"><span><b>{item.purpose}</b> · {item.toEmail}</span><span className="text-muted">{item.createdAt} · {emailState(item.status, item.deliveryStatus)}{item.errorCode ? ` · ${item.errorCode}` : ''} · {item.attempts} intento(s)</span></li>)}</ul>
          </section>
        )}

        <section className="card space-y-2 p-5 text-sm">
          <h2 className="text-lg font-black text-ink">Historial de contrataciones</h2>
          {requests.filter((item) => item.status !== 'pendiente_pago').map((item) => (
            <p key={item.id}><b>{item.code}</b> · {item.storeName} · {item.planName} · {item.cycle} · {formatMoney(item.amount, item.currency)} · {REQUEST_STATUS[item.status]}{item.verifiedBy ? ` por ${item.verifiedBy}` : ''}{item.paymentReference ? ` · ${item.paymentReference}` : ''}{item.cancelledReason ? ` · ${item.cancelledReason}` : ''}</p>
          ))}
          {!requests.some((item) => item.status !== 'pendiente_pago') && <p className="text-muted">Sin contrataciones cerradas todavía.</p>}
        </section>
      </div>
    </div>
  )
}
