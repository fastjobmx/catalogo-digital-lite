import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, Copy, Loader2, Pause, Play, Plus, RefreshCw, Store, XCircle } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { platformApi, type CreateStorePayload, type PlatformStore, type PlatformSummary, type ProvisionResponse } from '../services/api'

const STATUS: Record<string, { label: string; tone: string }> = {
  active: { label: 'Activa', tone: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  draft: { label: 'Borrador', tone: 'bg-sky-50 text-sky-800 border-sky-200' },
  suspended: { label: 'Suspendida', tone: 'bg-amber-50 text-amber-900 border-amber-200' },
  cancelled: { label: 'Cancelada', tone: 'bg-neutral-100 text-neutral-600 border-neutral-200' },
}

const usd = (micros: number) => `US$ ${(micros / 1_000_000).toFixed(2)}`

const EMPTY_FORM: CreateStorePayload = { name: '', businessType: '', template: 'moderno', planCode: 'basico', whatsapp: '', ownerEmail: '' }

/** Central platform panel for the superadmin: stores, status, AI limits and provisioning. */
export default function PlatformPage() {
  const { token, role, isAuthenticated, isLoading } = useAuth()
  const [summary, setSummary] = useState<PlatformSummary | null>(null)
  const [stores, setStores] = useState<PlatformStore[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [form, setForm] = useState<CreateStorePayload>(EMPTY_FORM)
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID())
  const [result, setResult] = useState<ProvisionResponse | null>(null)
  const [access, setAccess] = useState<{ slug: string; activationUrl: string | null; telegramLinkCode: string | null; telegramDeepLink: string | null } | null>(null)

  const load = useCallback(async () => {
    if (!token) return
    try {
      const [nextSummary, list] = await Promise.all([platformApi.summary(token), platformApi.stores(token)])
      setSummary(nextSummary)
      setStores(list.items)
      setError(null)
    } catch (err) {
      setError(err instanceof Error && /Platform administrator/.test(err.message) ? 'Esta sección es solo para la administración de la plataforma.' : 'No se pudo cargar la plataforma.')
    }
  }, [token])

  useEffect(() => { void load() }, [load])

  if (isLoading) return null
  if (!isAuthenticated) return <Navigate to="/admin/login" replace />

  const act = async (slug: string, action: () => Promise<unknown>) => {
    setBusy(slug)
    try { await action(); await load() } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo completar la acción.') }
    finally { setBusy(null) }
  }

  const create = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!token) return
    setBusy('create')
    setResult(null)
    try {
      const payload: CreateStorePayload = { ...form, whatsapp: form.whatsapp || undefined, ownerEmail: form.ownerEmail || undefined, primaryColor: form.template === 'personalizado' ? form.primaryColor : undefined }
      const response = await platformApi.createStore(payload, requestKey, token)
      setResult(response)
      if (response.status === 'completed') {
        setForm(EMPTY_FORM)
        setRequestKey(crypto.randomUUID())
        await load()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear la tienda.')
    } finally { setBusy(null) }
  }

  return (
    <div className="min-h-screen bg-canvas px-4 py-8 md:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-muted">Catálogo Digital IA</p>
            <h1 className="text-2xl font-black tracking-tight text-ink">Plataforma de tiendas</h1>
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn-ghost" onClick={() => void load()}><RefreshCw size={16} /> Actualizar</button>
            <Link to="/admin" className="btn-ghost"><Store size={16} /> Panel de la tienda principal</Link>
          </div>
        </header>

        {role && role !== 'superadmin' && <p className="card p-4 text-sm text-amber-900 bg-amber-50 border-amber-200">Tu cuenta administra tiendas individuales. Esta sección es para la administración de la plataforma.</p>}
        {error && <p role="alert" className="card p-4 text-sm text-red-800 bg-red-50 border-red-200 flex items-center gap-2"><AlertTriangle size={16} /> {error}</p>}

        {summary && (
          <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              ['Tiendas', `${summary.stores}`, `${summary.active} activas · ${summary.draft} borrador · ${summary.suspended} suspendidas`],
              ['Pedidos 30 días', `${summary.ordersLast30}`, `${summary.pendingOrders} pendientes`],
              ['IA este mes', usd(summary.aiCostMicros), `${summary.aiRequests} solicitudes · estimado`],
              ['Errores 24 h', `${summary.errorsLast24h}`, `${summary.failedJobs} aprovisionamientos fallidos`],
            ].map(([label, value, detail]) => (
              <div key={label} className="card p-5">
                <p className="text-xs font-bold uppercase tracking-widest text-muted">{label}</p>
                <p className="text-2xl font-black text-ink mt-1">{value}</p>
                <p className="text-xs text-muted mt-1">{detail}</p>
              </div>
            ))}
          </section>
        )}

        <section className="card p-0 overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead className="text-left text-xs uppercase tracking-widest text-muted border-b border-line">
              <tr><th className="p-4">Tienda</th><th className="p-4">Estado</th><th className="p-4">Plan</th><th className="p-4">Catálogo</th><th className="p-4">IA</th><th className="p-4 text-right">Acciones</th></tr>
            </thead>
            <tbody>
              {stores.map((store) => (
                <tr key={store.id} className="border-b border-line last:border-0 align-top">
                  <td className="p-4">
                    <p className="font-bold text-ink">{store.name}</p>
                    <a className="text-xs text-muted hover:text-ink" href={store.id === 1 ? '/' : `/t/${store.slug}`} target="_blank" rel="noreferrer">/{store.id === 1 ? '' : `t/${store.slug}`}</a>
                    <p className="text-xs text-muted">{store.ownerEmail || 'Sin propietario con correo'}</p>
                  </td>
                  <td className="p-4"><span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-bold ${STATUS[store.status]?.tone || ''}`}>{STATUS[store.status]?.label || store.status}</span></td>
                  <td className="p-4">
                    <select aria-label={`Plan de ${store.name}`} className="input-field py-1.5" value={store.planCode} disabled={busy === store.slug || store.planCode === 'legacy'}
                      onChange={(e) => token && void act(store.slug, () => platformApi.setPlan(store.slug, e.target.value, token))}>
                      {store.planCode === 'legacy' && <option value="legacy">Instalación existente</option>}
                      <option value="basico">Básico</option><option value="profesional">Profesional</option><option value="premium">Premium</option>
                    </select>
                  </td>
                  <td className="p-4 text-muted">{store.products} productos<br />{store.ordersLast30} pedidos / 30 d</td>
                  <td className="p-4">
                    <p className={store.aiPercent >= 80 ? 'text-amber-800 font-bold' : 'text-muted'}>{store.aiPercent}% usado</p>
                    <button type="button" className="text-xs underline text-muted hover:text-ink" disabled={busy === store.slug} onClick={() => {
                      const value = window.prompt(`Límite mensual de IA para ${store.name} (USD, 0 desactiva)`, '2')
                      if (value !== null && token && Number.isFinite(Number(value))) void act(store.slug, () => platformApi.setAi(store.slug, Number(value), token))
                    }}>Cambiar límite</button>
                  </td>
                  <td className="p-4">
                    <div className="flex flex-wrap justify-end gap-2">
                      {store.status === 'active'
                        ? <button type="button" className="btn-ghost" disabled={busy === store.slug} onClick={() => {
                          const reason = window.prompt(`Motivo de la suspensión de ${store.name}`, '')
                          if (reason !== null && token) void act(store.slug, () => platformApi.setStatus(store.slug, 'suspended', token, reason))
                        }}><Pause size={14} /> Suspender</button>
                        : store.status !== 'cancelled' && <button type="button" className="btn-ghost" disabled={busy === store.slug} onClick={() => token && window.confirm(`¿Activar y publicar ${store.name}?`) && void act(store.slug, () => platformApi.setStatus(store.slug, 'active', token))}><Play size={14} /> Activar</button>}
                      <button type="button" className="btn-ghost" disabled={busy === store.slug} onClick={() => token && void act(store.slug, async () => setAccess({ slug: store.slug, ...(await platformApi.regenerateAccess(store.slug, token)) }))}>Accesos</button>
                    </div>
                  </td>
                </tr>
              ))}
              {!stores.length && <tr><td colSpan={6} className="p-6 text-center text-muted">No hay tiendas para mostrar.</td></tr>}
            </tbody>
          </table>
        </section>

        {access && <AccessCard title={`Nuevos accesos · ${access.slug}`} access={access} onClose={() => setAccess(null)} />}

        <section className="card p-6">
          <h2 className="text-lg font-black text-ink flex items-center gap-2"><Plus size={18} /> Crear tienda</h2>
          <p className="text-sm text-muted mt-1">La tienda se crea en borrador con su plantilla, categorías iniciales, propietario y accesos de un solo uso. También puedes crearla desde el bot maestro con /crear_tienda.</p>
          <form onSubmit={create} className="mt-5 grid gap-4 md:grid-cols-2">
            <Field label="Nombre comercial"><input className="input-field" required minLength={2} maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="¿Qué vende?"><input className="input-field" required placeholder="Ropa y accesorios" value={form.businessType} onChange={(e) => setForm({ ...form, businessType: e.target.value })} /></Field>
            <Field label="Estilo visual">
              <select className="input-field" value={form.template} onChange={(e) => setForm({ ...form, template: e.target.value as CreateStorePayload['template'] })}>
                <option value="minimalista">Minimalista</option><option value="moderno">Moderno</option><option value="premium">Premium</option><option value="personalizado">Personalizado</option>
              </select>
            </Field>
            {form.template === 'personalizado'
              ? <Field label="Color principal"><input type="color" className="input-field h-11" value={form.primaryColor || '#153D70'} onChange={(e) => setForm({ ...form, primaryColor: e.target.value })} /></Field>
              : <Field label="Plan"><PlanSelect value={form.planCode} onChange={(planCode) => setForm({ ...form, planCode })} /></Field>}
            {form.template === 'personalizado' && <Field label="Plan"><PlanSelect value={form.planCode} onChange={(planCode) => setForm({ ...form, planCode })} /></Field>}
            <Field label="WhatsApp de pedidos (opcional)"><input className="input-field" placeholder="+573001234567" value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} /></Field>
            <Field label="Correo del propietario"><input type="email" className="input-field" required value={form.ownerEmail} onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })} /></Field>
            <div className="md:col-span-2 flex justify-end">
              <button type="submit" className="btn-brand" disabled={busy === 'create'}>{busy === 'create' ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} Crear tienda</button>
            </div>
          </form>
          {result && <ProvisionResult result={result} />}
        </section>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="space-y-2 block"><span className="block text-xs font-bold uppercase tracking-widest text-muted">{label}</span>{children}</label>
}

function PlanSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <select className="input-field" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="basico">Básico</option><option value="profesional">Profesional</option><option value="premium">Premium</option>
    </select>
  )
}

function ProvisionResult({ result }: { result: ProvisionResponse }) {
  return (
    <div className="mt-6 space-y-4" aria-live="polite">
      <ul className="space-y-1.5 text-sm">
        {result.steps.map((step) => (
          <li key={step.key} className="flex items-start gap-2">
            {step.status === 'ok' ? <CheckCircle2 size={16} className="text-emerald-600 mt-0.5" /> : <XCircle size={16} className="text-red-600 mt-0.5" />}
            <span><b className="text-ink">{step.label}</b>{step.detail ? <span className="text-muted"> · {step.detail}</span> : null}</span>
          </li>
        ))}
      </ul>
      {result.status === 'completed'
        ? <AccessCard title={`Tienda creada y verificada: ${result.name}`} access={{ activationUrl: result.activationUrl ?? null, telegramLinkCode: result.telegramLinkCode ?? null, telegramDeepLink: result.telegramDeepLink ?? null }} publicUrl={result.publicUrl} />
        : <p role="alert" className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-btn p-3">No se pudo crear la tienda. Corrige el dato indicado y vuelve a intentarlo: el proceso continúa sin duplicar la tienda.</p>}
    </div>
  )
}

function AccessCard({ title, access, publicUrl, onClose }: { title: string; access: { activationUrl: string | null; telegramLinkCode: string | null; telegramDeepLink: string | null }; publicUrl?: string; onClose?: () => void }) {
  const copy = (value: string) => { void navigator.clipboard?.writeText(value) }
  return (
    <div className="card p-5 bg-brand/5 border-brand/20 space-y-3 text-sm">
      <div className="flex items-center justify-between gap-3"><b className="text-ink">{title}</b>{onClose && <button type="button" className="text-xs underline text-muted" onClick={onClose}>Cerrar</button>}</div>
      {publicUrl && <p>Tienda (borrador privado): <a className="underline" href={publicUrl} target="_blank" rel="noreferrer">{publicUrl}</a></p>}
      {access.activationUrl && <p className="break-all">Activación del panel (un solo uso, 72 h): <button type="button" className="inline-flex items-center gap-1 underline" onClick={() => copy(access.activationUrl!)}><Copy size={12} /> copiar enlace</button></p>}
      {access.telegramDeepLink
        ? <p className="break-all">Vincular Telegram: <a className="underline" href={access.telegramDeepLink} target="_blank" rel="noreferrer">{access.telegramDeepLink}</a></p>
        : access.telegramLinkCode && <p>Código de Telegram (72 h): <code className="font-bold">/link {access.telegramLinkCode}</code></p>}
      <p className="text-xs text-muted">Comparte estos accesos solo con el propietario. No se guardan en texto plano y no se pueden volver a mostrar: si se pierden, genera nuevos.</p>
    </div>
  )
}
