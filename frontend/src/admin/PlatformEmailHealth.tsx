import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react'
import { emailApi, type EmailCategoryInfo, type EmailDnsCheck, type EmailOverview, type EmailStatusInfo, type EmailSuppression } from '../services/api'

const PURPOSES: Record<string, string> = { password_reset: 'Recuperación de contraseña', email_verification: 'Verificación de correo', invitation: 'Invitación' }
const DNS_TONE: Record<EmailDnsCheck['status'], string> = {
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  revisar: 'border-amber-200 bg-amber-50 text-amber-900',
  falta: 'border-red-200 bg-red-50 text-red-800',
  error: 'border-line bg-canvas text-muted',
}
const DNS_LABEL: Record<EmailDnsCheck['status'], string> = { ok: 'Correcto', revisar: 'Revisar', falta: 'Falta', error: 'Sin respuesta' }
const REASONS: Record<string, string> = { rebote: 'Rebote permanente', queja: 'Marcado como spam', manual: 'Bloqueo manual' }
const when = (value: string) => new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })

/** Superadmin: health of the email service — provider, sender DNS (SPF/DKIM/DMARC), 30-day counters,
 * alerts for failed access emails, notification categories and the suppression list. No keys are shown. */
export default function PlatformEmailHealth({ token }: { token: string }) {
  const [status, setStatus] = useState<EmailStatusInfo | null>(null)
  const [overview, setOverview] = useState<EmailOverview | null>(null)
  const [categories, setCategories] = useState<EmailCategoryInfo[]>([])
  const [suppressions, setSuppressions] = useState<EmailSuppression[]>([])
  const [dns, setDns] = useState<{ domain: string | null; checks: EmailDnsCheck[] } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [nextStatus, nextOverview, nextCategories, nextSuppressions] = await Promise.all([emailApi.status(token), emailApi.overview(token), emailApi.categories(token), emailApi.suppressions(token)])
      setStatus(nextStatus); setOverview(nextOverview); setCategories(nextCategories.items); setSuppressions(nextSuppressions.items)
    } catch { /* the page already explains when the section is not available */ }
  }, [token])
  useEffect(() => { void load() }, [load])

  const act = async (key: string, action: () => Promise<void>) => {
    setBusy(key); setError(null)
    try { await action() } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo completar la acción.') } finally { setBusy(null) }
  }

  if (!status || !overview) return null
  const t = overview.totals
  const tiles = [
    { label: 'Registrados', value: t.total, hint: `últimos ${overview.windowDays} días` },
    { label: 'Aceptados por el proveedor', value: t.accepted, hint: 'no implica entrega' },
    { label: 'Entregados', value: t.delivered, hint: status.webhookConfigured ? 'confirmados por el proveedor' : 'requiere webhook' },
    { label: 'Rebotes y quejas', value: t.bounced + t.complained, hint: `${overview.suppressed} direcciones bloqueadas` },
    { label: 'Fallidos', value: t.failed, hint: t.pending ? `${t.pending} en curso` : 'tras reintentos' },
    { label: 'Sin proveedor', value: t.notConfigured, hint: 'no se enviaron' },
  ]

  return (
    <section className="card p-6 space-y-5" aria-labelledby="email-health-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="email-health-title" className="text-lg font-black text-ink flex items-center gap-2"><ShieldCheck size={18} /> Estado del servicio de correo</h2>
        <button type="button" className="btn-ghost py-1.5 text-xs" onClick={() => void act('reload', load)} disabled={busy !== null}><RefreshCw size={14} /> Actualizar</button>
      </div>

      <dl className="grid gap-3 text-sm md:grid-cols-4">
        <div><dt className="text-xs font-bold uppercase tracking-widest text-muted">Proveedor</dt><dd className="font-bold text-ink">{status.configured ? status.provider : 'Sin configurar'}</dd></div>
        <div><dt className="text-xs font-bold uppercase tracking-widest text-muted">Remitente</dt><dd className="break-all">{status.from || '—'}</dd></div>
        <div><dt className="text-xs font-bold uppercase tracking-widest text-muted">Responder a</dt><dd className="break-all">{status.replyTo || '—'}</dd></div>
        <div><dt className="text-xs font-bold uppercase tracking-widest text-muted">Eventos de entrega</dt><dd>{status.webhookConfigured ? 'Webhook configurado' : 'Webhook sin configurar'}</dd></div>
      </dl>

      {overview.alerts.length > 0 && (
        <div role="alert" className="rounded-btn border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p className="flex items-center gap-2 font-bold"><ShieldAlert size={16} /> Fallaron correos de acceso en los últimos 7 días</p>
          <ul className="mt-2 list-disc pl-5">{overview.alerts.map((alert) => <li key={alert.purpose}>{PURPOSES[alert.purpose] || alert.purpose}: {alert.count} (último {when(alert.lastAt)})</li>)}</ul>
          <p className="mt-2 text-xs">Revisa el historial. Las personas afectadas pueden volver a pedir el enlace; Telegram sigue disponible para quien lo tenga vinculado.</p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map((tile) => (
          <div key={tile.label} className="rounded-btn border border-line p-3">
            <p className="text-2xl font-black text-ink tabular-nums">{tile.value}</p>
            <p className="text-xs font-bold text-ink">{tile.label}</p>
            <p className="text-xs text-muted">{tile.hint}</p>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-black text-ink">Autenticación del dominio (SPF, DKIM, DMARC)</h3>
          <button type="button" className="btn-ghost py-1.5 text-xs" disabled={busy !== null} onClick={() => void act('dns', async () => setDns(await emailApi.dns(token)))}>
            {busy === 'dns' ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Verificar configuración
          </button>
        </div>
        {!dns && <p className="text-xs text-muted">Consulta el DNS público del dominio remitente. No cambia ningún registro.</p>}
        {dns && (
          <ul className="grid gap-2 md:grid-cols-2">
            {dns.domain && <li className="text-xs text-muted md:col-span-2">Dominio remitente: <b className="text-ink">{dns.domain}</b></li>}
            {dns.checks.map((check) => (
              <li key={check.name} className={`rounded-btn border p-3 text-xs ${DNS_TONE[check.status]}`}>
                <span className="font-bold">{check.name} · {DNS_LABEL[check.status]}</span>
                <span className="mt-1 block break-all">{check.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-black text-ink">Categorías de notificación</h3>
        <ul className="grid gap-2 md:grid-cols-3">
          {categories.map((category) => (
            <li key={category.key} className="flex items-start justify-between gap-3 rounded-btn border border-line p-3 text-sm">
              <span><b className="text-ink">{category.label}</b><span className="block text-xs text-muted">{category.essential ? 'Esencial: siempre activa' : category.enabled ? 'Activa' : 'Pausada: no se envía'}</span></span>
              {!category.essential && (
                <button type="button" className="btn-ghost py-1 text-xs" disabled={busy !== null} onClick={() => void act(`cat-${category.key}`, async () => { setCategories((await emailApi.setCategory(category.key, !category.enabled, token)).items) })}>
                  {category.enabled ? 'Pausar' : 'Activar'}
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-black text-ink">Direcciones bloqueadas</h3>
        {!suppressions.length && <p className="text-xs text-muted">Ninguna. Una dirección se bloquea sola tras un rebote permanente o una queja de spam.</p>}
        {suppressions.length > 0 && (
          <ul className="space-y-1.5">
            {suppressions.map((item) => (
              <li key={item.email} className="flex flex-wrap items-center justify-between gap-2 rounded-btn border border-line p-2.5 text-sm">
                <span><b className="text-ink">{item.email}</b> <span className="text-xs text-muted">· {REASONS[item.reason] || item.reason} · {when(item.createdAt)}</span></span>
                <button type="button" className="btn-ghost py-1 text-xs" disabled={busy !== null} onClick={() => void act(`sup-${item.email}`, async () => { await emailApi.removeSuppression(item.email, token); await load() })}>Desbloquear</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && <p role="alert" className="flex items-center gap-2 text-sm text-red-700"><AlertTriangle size={15} /> {error}</p>}
    </section>
  )
}
