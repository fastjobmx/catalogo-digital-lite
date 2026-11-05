import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { ArrowLeft, Copy, Loader2, RefreshCw, Save, Store } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { formatMoney } from '../lib/format'
import { platformApi, trialAdminApi, type TrialConversionResult, type TrialMetrics, type TrialRequestItem, type TrialSettings, type TrialTemplate } from '../services/api'

const TEMPLATE_NAMES: Record<string, string> = { clasica: 'Clásica', boutique: 'Boutique', stories: 'Stories' }
const STATUS: Record<string, { label: string; tone: string }> = {
  pendiente: { label: 'Pendiente', tone: 'bg-amber-50 text-amber-900 border-amber-200' },
  convertida: { label: 'Convertida', tone: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  descartada: { label: 'Descartada', tone: 'bg-slate-50 text-slate-700 border-slate-200' },
}
const TRIAL_STATUS: Record<string, string> = { activa: 'Vigente o vencida recuperable', eliminada: 'Borrada', convertida: 'Convertida' }
const when = (value: string | null) => (value ? new Date(value).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }) : '—')
const FIELDS: Array<{ key: Exclude<keyof TrialSettings, 'templates' | 'ordersEnabled'>; label: string; hint: string; min: number; max: number }> = [
  { key: 'durationHours', label: 'Duración (horas)', hint: 'Tiempo editable de cada prueba', min: 1, max: 336 },
  { key: 'retentionHours', label: 'Conservación tras vencer (horas)', hint: 'Luego se borran fotos y datos', min: 0, max: 720 },
  { key: 'maxProducts', label: 'Productos por prueba', hint: 'Máximo de productos', min: 1, max: 20 },
  { key: 'maxPhotoMb', label: 'Tamaño máximo de foto (MB)', hint: 'Por archivo', min: 1, max: 5 },
  { key: 'dailyLimit', label: 'Pruebas por día (toda la plataforma)', hint: 'Cupo diario', min: 1, max: 10000 },
  { key: 'createPerIpHour', label: 'Pruebas por red y hora', hint: 'Límite contra abusos', min: 1, max: 100 },
]

/** Superadmin: real trial metrics, trial settings and activation requests (conversion into a store). */
export default function PlatformTrialsPage() {
  const { token, role, isAuthenticated, isLoading } = useAuth()
  const [metrics, setMetrics] = useState<TrialMetrics | null>(null)
  const [settings, setSettings] = useState<TrialSettings | null>(null)
  const [requests, setRequests] = useState<TrialRequestItem[]>([])
  const [plans, setPlans] = useState<Array<{ code: string; name: string }>>([])
  const [planFor, setPlanFor] = useState<Record<number, string>>({})
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [converted, setConverted] = useState<TrialConversionResult | null>(null)

  const load = useCallback(async () => {
    if (!token) return
    try {
      const [nextMetrics, nextSettings, list, planList] = await Promise.all([trialAdminApi.summary(token), trialAdminApi.settings(token), trialAdminApi.requests(token, filter || undefined), platformApi.plans(token)])
      setMetrics(nextMetrics); setSettings(nextSettings); setRequests(list.items); setPlans(planList.items)
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

  const cards = metrics ? [
    ['Creadas', metrics.created, `${metrics.last7Days} en los últimos 7 días`],
    ['Vigentes', metrics.active, 'Editables ahora'],
    ['Vencidas', metrics.expired, 'Aún recuperables'],
    ['Borradas', metrics.deleted, 'Fotos y datos eliminados'],
    ['Solicitudes', metrics.requests.total, `${metrics.requests.pending} pendientes`],
    ['Convertidas', metrics.converted, `${metrics.conversionRate}% de las creadas`],
    ['Pedidos', metrics.orders.count, `${metrics.orders.trialsWithOrders} tiendas · ${formatMoney(metrics.orders.amount, 'COP')}`],
  ] as const : []

  return (
    <div className="min-h-screen bg-canvas px-4 py-8 md:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted"><img src="/brand/tiendaiaexpress/icon-192.png" alt="" width={20} height={20} className="rounded" /> Tienda IA Express · Plataforma</p>
            <h1 className="text-2xl font-black tracking-tight text-ink">Tiendas de prueba</h1>
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn-ghost" onClick={() => void load()}><RefreshCw size={16} /> Actualizar</button>
            <Link to="/plataforma" className="btn-ghost"><ArrowLeft size={16} /> Volver a la plataforma</Link>
          </div>
        </header>
        {role && role !== 'superadmin' && <p className="card border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Esta sección es para la administración de la plataforma.</p>}
        {notice && <p role={notice.tone === 'error' ? 'alert' : 'status'} className={`card p-4 text-sm ${notice.tone === 'error' ? 'text-red-700' : 'text-emerald-800'}`}>{notice.text}</p>}

        {metrics && (
          <section className="space-y-3">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
              {cards.map(([label, value, hint]) => (
                <div key={label} className="card p-4"><p className="text-xs font-bold uppercase tracking-widest text-muted">{label}</p><p className="text-3xl font-black text-ink">{value}</p><p className="text-xs text-muted">{hint}</p></div>
              ))}
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="card space-y-2 p-4 text-sm"><p className="font-bold text-ink">Plantillas elegidas</p>
                {metrics.templates.length ? metrics.templates.map((row) => <p key={row.template} className="flex justify-between"><span>{TEMPLATE_NAMES[row.template] || row.template}</span><b>{row.count}</b></p>) : <p className="text-muted">Sin pruebas todavía.</p>}</div>
              <div className="card space-y-2 p-4 text-sm"><p className="font-bold text-ink">Productos por prueba <span className="font-normal text-muted">· promedio {metrics.avgProducts}</span></p>
                {metrics.productCounts.length ? metrics.productCounts.map((row) => <p key={row.products} className="flex justify-between"><span>{row.products} {row.products === 1 ? 'producto' : 'productos'}</span><b>{row.count}</b></p>) : <p className="text-muted">Sin pruebas todavía.</p>}</div>
            </div>
          </section>
        )}

        {converted && (
          <section className="card space-y-3 border-emerald-200 p-5 text-sm">
            <p className="text-base font-black text-ink">Tienda «{converted.name}» {converted.replayed ? 'ya estaba creada' : 'creada como borrador'}</p>
            <p>Productos pasados: <b>{converted.imported}</b>{converted.skipped.length > 0 && <> · No pasados: {converted.skipped.map((item) => `${item.name} (${item.reason})`).join(', ')}</>}</p>
            {converted.delivery === 'email' && <p>Se envió la invitación por correo al solicitante. Al abrirla crea su contraseña y su correo queda verificado.</p>}
            {converted.activationUrl && (
              <div className="space-y-1.5 rounded-btn border border-line p-3">
                <p>El envío de correos no está configurado. Envía este enlace de activación (un solo uso, 72 h) solo al solicitante, por un canal privado. No se vuelve a mostrar.</p>
                <button type="button" className="btn-ghost" onClick={() => { void navigator.clipboard?.writeText(converted.activationUrl!); setNotice({ tone: 'ok', text: 'Enlace copiado.' }) }}><Copy size={15} /> Copiar enlace de activación</button>
              </div>
            )}
            {!converted.activationUrl && converted.delivery !== 'email' && <p>Para enviar un acceso nuevo al propietario, usa «Accesos» en la ficha de la tienda.</p>}
            <p className="text-muted">La tienda queda en borrador: se publica y recibe pedidos cuando la actives desde la plataforma, como cualquier otra tienda.</p>
            <div className="flex flex-wrap gap-2"><Link to="/plataforma" className="btn-ghost"><Store size={15} /> Ver en la plataforma</Link><button type="button" className="btn-ghost" onClick={() => setConverted(null)}>Cerrar</button></div>
          </section>
        )}

        <section className="card space-y-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-black text-ink">Solicitudes de activación</h2>
            <select className="input-field" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filtrar por estado">
              <option value="">Todas</option><option value="pendiente">Pendientes</option><option value="convertida">Convertidas</option><option value="descartada">Descartadas</option>
            </select>
          </div>
          {!requests.length && <p className="text-sm text-muted">No hay solicitudes{filter ? ' con este estado' : ''}.</p>}
          <div className="space-y-3">
            {requests.map((item) => (
              <article key={item.id} className="space-y-3 rounded-btn border border-line p-4 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div><p className="font-mono text-base font-black text-ink">{item.code}</p><p className="text-muted">{when(item.createdAt)} · {item.planLabel}</p></div>
                  <span className={`rounded-full border px-2.5 py-0.5 text-xs font-bold ${STATUS[item.status]?.tone}`}>{STATUS[item.status]?.label}</span>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div><p className="font-bold text-ink">{item.trial.businessName}</p>
                    <p>{TEMPLATE_NAMES[item.trial.template] || item.trial.template} · {item.trial.productCount} productos · {TRIAL_STATUS[item.trial.status] || item.trial.status}</p>
                    <p className="text-muted">Vence {when(item.trial.expiresAt)} · se borra {when(item.trial.deleteAfter)}</p>
                    {item.status === 'pendiente' && <a href={`/prueba/${item.trial.id}`} target="_blank" rel="noopener noreferrer" className="font-bold underline">Ver la prueba</a>}</div>
                  <div><p className="font-bold text-ink">{item.contact.name}</p><p>{item.contact.email}</p>{item.contact.phone && <p>{item.contact.phone}</p>}</div>
                </div>
                {item.store && <p>Tienda: <b>{item.store.name}</b> ({item.store.slug}) · {item.store.status === 'active' ? 'Activa' : item.store.status === 'draft' ? 'Borrador' : item.store.status}{item.result && <> · {item.result.imported} productos pasados</>}</p>}
                {item.status === 'pendiente' && (
                  <div className="flex flex-wrap items-end gap-2 border-t border-line pt-3">
                    <label className="block space-y-1"><span className="text-xs font-bold uppercase tracking-widest text-muted">Plan de la tienda</span>
                      <select className="input-field" value={planFor[item.id] || item.suggestedPlanCode} onChange={(e) => setPlanFor({ ...planFor, [item.id]: e.target.value })}>
                        {plans.map((plan) => <option key={plan.code} value={plan.code}>{plan.name}</option>)}
                      </select></label>
                    <button type="button" className="btn-brand" disabled={busy !== null || item.trial.status === 'eliminada'} onClick={() => {
                      if (!window.confirm(`¿Convertir «${item.trial.businessName}» en una tienda (borrador) para ${item.contact.email}? Confírmalo solo después de acordar el plan con el cliente.`)) return
                      void run(`convert-${item.id}`, async () => { setConverted(await trialAdminApi.convert(item.id, planFor[item.id] || item.suggestedPlanCode, token!)) })
                    }}>{busy === `convert-${item.id}` ? <Loader2 size={15} className="animate-spin" /> : <Store size={15} />} Convertir en tienda</button>
                    <button type="button" className="btn-ghost" disabled={busy !== null} onClick={() => { if (window.confirm('¿Descartar esta solicitud? La prueba seguirá su vencimiento normal.')) void run(`discard-${item.id}`, async () => { await trialAdminApi.discard(item.id, token!); return 'Solicitud descartada.' }) }}>Descartar</button>
                    {item.trial.status === 'eliminada' && <p className="text-xs text-red-700">La prueba ya se borró: no hay datos para convertir.</p>}
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>

        {settings && (
          <section className="card space-y-4 p-5">
            <h2 className="text-lg font-black text-ink">Ajustes de las pruebas</h2>
            <p className="text-sm text-muted">Se aplican a las pruebas nuevas. Las que ya existen conservan su fecha de vencimiento.</p>
            <div className="grid gap-4 md:grid-cols-3">
              {FIELDS.map((field) => (
                <label key={field.key} className="block space-y-1.5"><span className="text-xs font-bold uppercase tracking-widest text-muted">{field.label}</span>
                  <input type="number" className="input-field w-full" min={field.min} max={field.max} value={settings[field.key]} onChange={(e) => setSettings({ ...settings, [field.key]: Number(e.target.value) })} />
                  <span className="block text-xs text-muted">{field.hint} ({field.min}–{field.max})</span></label>
              ))}
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.ordersEnabled} onChange={(e) => setSettings({ ...settings, ordersEnabled: e.target.checked })} /> Las tiendas temporales reciben pedidos reales por WhatsApp</label>
            <fieldset className="space-y-2"><legend className="text-xs font-bold uppercase tracking-widest text-muted">Plantillas disponibles</legend>
              <div className="flex flex-wrap gap-4 text-sm">
                {(['clasica', 'boutique', 'stories'] as TrialTemplate[]).map((key) => (
                  <label key={key} className="flex items-center gap-2"><input type="checkbox" checked={settings.templates.includes(key)} onChange={(e) => setSettings({ ...settings, templates: e.target.checked ? [...settings.templates, key] : settings.templates.filter((item) => item !== key) })} /> {TEMPLATE_NAMES[key]}</label>
                ))}
              </div>
            </fieldset>
            <button type="button" className="btn-brand" disabled={busy !== null} onClick={() => void run('settings', async () => { setSettings(await trialAdminApi.saveSettings(settings, token!)); return 'Ajustes guardados.' })}><Save size={16} /> Guardar ajustes</button>
          </section>
        )}
      </div>
    </div>
  )
}
