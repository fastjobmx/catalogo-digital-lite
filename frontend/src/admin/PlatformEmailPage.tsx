import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, CheckCircle2, Copy, Eye, Loader2, Mail, Plus, Save, Send, ShieldCheck } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { emailApi, type EmailMessage, type EmailStatusInfo, type EmailTemplate, type UnverifiedOwnerStore } from '../services/api'

const STATUS: Record<string, { label: string; tone: string }> = {
  enviado: { label: 'Enviado', tone: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  fallido: { label: 'Falló', tone: 'bg-red-50 text-red-800 border-red-200' },
  no_configurado: { label: 'Sin proveedor', tone: 'bg-amber-50 text-amber-900 border-amber-200' },
  enviando: { label: 'Enviando', tone: 'bg-sky-50 text-sky-800 border-sky-200' },
}
const PURPOSES: Record<string, string> = { password_reset: 'Recuperación', invitation: 'Invitación', welcome: 'Bienvenida', email_verification: 'Verificación', test: 'Prueba', admin_notice: 'Notificación' }
const METHODS: Record<string, string> = { videollamada: 'Videollamada con documento', documento: 'Documento de identidad y registro del negocio', presencial: 'Verificación presencial', canal_conocido: 'Confirmación por un canal ya registrado del comercio' }
const when = (value: string) => new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })
type Draft = { name: string; subject: string; html: string; text: string }

/** Superadmin: email templates (create, edit, duplicate, toggle, preview, test), send history and
 * supervised regularization of stores without a verified owner. */
export default function PlatformEmailPage() {
  const { token, role, isAuthenticated, isLoading } = useAuth()
  const [status, setStatus] = useState<EmailStatusInfo | null>(null)
  const [templates, setTemplates] = useState<EmailTemplate[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [preview, setPreview] = useState<{ subject: string; html: string; text: string } | null>(null)
  const [messages, setMessages] = useState<EmailMessage[]>([])
  const [filter, setFilter] = useState('')
  const [owners, setOwners] = useState<UnverifiedOwnerStore[]>([])
  const [testTo, setTestTo] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  const load = useCallback(async () => {
    if (!token) return
    try {
      const [nextStatus, list, history, unverified] = await Promise.all([emailApi.status(token), emailApi.templates(token), emailApi.messages(token, filter || undefined), emailApi.unverifiedOwners(token)])
      setStatus(nextStatus); setTemplates(list.items); setMessages(history.items); setOwners(unverified.items)
      setTestTo((current) => current || nextStatus.testRecipients[0] || '')
    } catch { setNotice({ tone: 'error', text: 'Esta sección es solo para la administración de la plataforma.' }) }
  }, [token, filter])
  useEffect(() => { void load() }, [load])

  const current = templates.find((item) => item.id === selected) || null
  const choose = (template: EmailTemplate) => { setSelected(template.id); setDraft({ name: template.name, subject: template.subject, html: template.html, text: template.text }); setPreview(null); setNotice(null) }

  const run = async (key: string, action: () => Promise<string | void>) => {
    setBusy(key); setNotice(null)
    try { const text = await action(); if (text) setNotice({ tone: 'ok', text }); await load() }
    catch (err) { setNotice({ tone: 'error', text: err instanceof Error ? err.message : 'No se pudo completar la acción.' }) }
    finally { setBusy(null) }
  }

  if (isLoading) return null
  if (!isAuthenticated) return <Navigate to="/admin/login" replace />

  return (
    <div className="min-h-screen bg-canvas px-4 py-8 md:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-muted flex items-center gap-2"><img src="/brand/tiendaiaexpress/icon-192.png" alt="" width={20} height={20} className="rounded" /> Tienda IA Express · Plataforma</p>
            <h1 className="text-2xl font-black tracking-tight text-ink">Plantillas de correo electrónico</h1>
          </div>
          <Link to="/plataforma" className="btn-ghost"><ArrowLeft size={16} /> Volver a la plataforma</Link>
        </header>
        {role && role !== 'superadmin' && <p className="card p-4 text-sm text-amber-900 bg-amber-50 border-amber-200">Esta sección es para la administración de la plataforma.</p>}
        {status && !status.configured && (
          <p className="card flex items-start gap-2 p-4 text-sm text-amber-900 bg-amber-50 border-amber-200"><AlertTriangle size={17} className="mt-0.5 shrink-0" />
            El envío de correos todavía no está configurado (falta el proveedor y un dominio verificado). Puedes preparar y previsualizar las plantillas; los envíos quedan registrados como «Sin proveedor» y no se finge que se enviaron. La recuperación de contraseña sigue llegando por Telegram a quien lo tenga vinculado.
          </p>
        )}
        {status?.configured && <p className="card flex items-center gap-2 p-4 text-sm text-emerald-800"><CheckCircle2 size={17} /> Envíos activos con {status.provider} desde {status.from}.</p>}
        {notice && <p role={notice.tone === 'error' ? 'alert' : 'status'} className={`card p-4 text-sm ${notice.tone === 'error' ? 'text-red-700' : 'text-emerald-800'}`}>{notice.text}</p>}

        <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
          <section className="card p-4 space-y-2 self-start">
            {templates.map((template) => (
              <button key={template.id} type="button" onClick={() => choose(template)} className={`w-full rounded-btn p-3 text-left text-sm ${template.id === selected ? 'bg-brand/10' : 'hover:bg-canvas'}`}>
                <span className="block font-bold text-ink">{template.name}</span>
                <span className="block text-xs text-muted">{template.system ? 'Del sistema' : 'Personalizada'} · {template.active ? 'Activa' : 'Inactiva'}</span>
              </button>
            ))}
            <button type="button" className="btn-ghost w-full justify-center" disabled={busy !== null} onClick={() => void run('create', async () => {
              const created = await emailApi.create({ name: 'Nueva plantilla', subject: 'Aviso de {{nombre_plataforma}}', html: '<p>Hola, {{nombre_usuario}}.</p>', text: 'Hola, {{nombre_usuario}}.' }, token!)
              setSelected(created.id); setDraft({ name: created.name, subject: created.subject, html: created.html, text: created.text })
              return 'Plantilla creada. Edítala y guárdala.'
            })}><Plus size={16} /> Nueva plantilla</button>
          </section>

          <section className="card p-6 space-y-4">
            {!current || !draft ? <p className="text-sm text-muted">Elige una plantilla para editarla o previsualizarla.</p> : (
              <>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="block space-y-1.5"><span className="text-xs font-bold uppercase tracking-widest text-muted">Nombre interno</span><input className="input-field w-full" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
                  <label className="block space-y-1.5"><span className="text-xs font-bold uppercase tracking-widest text-muted">Asunto</span><input className="input-field w-full" value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} /></label>
                </div>
                <div className="text-xs text-muted">
                  <p className="font-bold uppercase tracking-widest">Variables disponibles</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">{current.variables.map((variable) => (
                    <code key={variable.key} title={variable.label} className={`rounded-full border px-2 py-0.5 ${variable.systemLink ? 'border-brand/40 bg-brand/5 text-ink' : 'border-line'}`}>{`{{${variable.key}}}`}</code>
                  ))}</div>
                  {current.variables.some((variable) => variable.systemLink) && <p className="mt-2">Los enlaces seguros los genera el sistema en cada envío; aquí solo se indica dónde van. En la vista previa y en las pruebas se usan enlaces de muestra que no funcionan.</p>}
                </div>
                <label className="block space-y-1.5"><span className="text-xs font-bold uppercase tracking-widest text-muted">Contenido HTML</span><textarea className="input-field w-full font-mono text-xs" rows={12} value={draft.html} onChange={(e) => setDraft({ ...draft, html: e.target.value })} /></label>
                <label className="block space-y-1.5"><span className="text-xs font-bold uppercase tracking-widest text-muted">Versión de texto plano</span><textarea className="input-field w-full font-mono text-xs" rows={6} value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} /></label>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn-brand" disabled={busy !== null} onClick={() => void run('save', async () => { const saved = await emailApi.update(current.id, draft, token!); setDraft({ name: saved.name, subject: saved.subject, html: saved.html, text: saved.text }); return 'Plantilla guardada. El HTML se limpió de contenido activo (scripts, formularios, eventos).' })}><Save size={16} /> Guardar</button>
                  <button type="button" className="btn-ghost" disabled={busy !== null} onClick={() => void run('preview', async () => { setPreview(await emailApi.preview(current.id, draft, token!)) })}><Eye size={16} /> Vista previa</button>
                  <button type="button" className="btn-ghost" disabled={busy !== null} onClick={() => void run('dup', async () => { const copy = await emailApi.duplicate(current.id, token!); setSelected(copy.id); setDraft({ name: copy.name, subject: copy.subject, html: copy.html, text: copy.text }); return 'Plantilla duplicada.' })}><Copy size={16} /> Duplicar</button>
                  {!current.system && <button type="button" className="btn-ghost" disabled={busy !== null} onClick={() => void run('toggle', async () => { await emailApi.setActive(current.id, !current.active, token!); return current.active ? 'Plantilla desactivada.' : 'Plantilla activada.' })}>{current.active ? 'Desactivar' : 'Activar'}</button>}
                </div>
                {current.system && <p className="text-xs text-muted">Las plantillas del sistema siempre están activas porque el acceso de los usuarios depende de ellas. Puedes cambiar su texto y diseño, pero deben conservar su enlace.</p>}
                <div className="flex flex-wrap items-end gap-2 rounded-btn border border-line p-3">
                  <label className="block space-y-1.5"><span className="text-xs font-bold uppercase tracking-widest text-muted">Enviar prueba a</span>
                    <select className="input-field" value={testTo} onChange={(e) => setTestTo(e.target.value)}>{status?.testRecipients.map((address) => <option key={address} value={address}>{address}</option>)}</select></label>
                  <button type="button" className="btn-ghost" disabled={busy !== null || !testTo} onClick={() => void run('test', async () => {
                    const result = await emailApi.test(current.id, testTo, crypto.randomUUID(), token!)
                    return result.status === 'enviado' ? `Prueba enviada a ${testTo}.` : result.status === 'no_configurado' ? 'Prueba registrada como «Sin proveedor»: el envío de correos no está configurado.' : 'El proveedor no aceptó el envío. Revisa el historial.'
                  })}><Send size={16} /> Enviar prueba</button>
                  <p className="w-full text-xs text-muted">Solo a direcciones autorizadas de la plataforma, con datos y enlaces de muestra.</p>
                </div>
                {preview && (
                  <div className="space-y-2">
                    <p className="text-sm"><b>Asunto:</b> {preview.subject}</p>
                    <iframe title="Vista previa del correo" sandbox="" srcDoc={preview.html} className="h-[34rem] w-full rounded-btn border border-line bg-white" />
                    <details className="text-xs"><summary className="cursor-pointer font-bold">Versión de texto plano</summary><pre className="mt-2 whitespace-pre-wrap rounded-btn bg-canvas p-3">{preview.text}</pre></details>
                  </div>
                )}
              </>
            )}
          </section>
        </div>

        <section className="card p-6 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-black text-ink flex items-center gap-2"><Mail size={18} /> Historial de envíos</h2>
            <select aria-label="Filtrar por estado" className="input-field w-auto py-1.5" value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="">Todos</option>{Object.entries(STATUS).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-xs uppercase tracking-widest text-muted border-b border-line"><tr><th className="py-2 pr-3">Fecha</th><th className="py-2 pr-3">Tipo</th><th className="py-2 pr-3">Para</th><th className="py-2 pr-3">Tienda</th><th className="py-2">Estado</th></tr></thead>
              <tbody>{messages.map((message) => (
                <tr key={message.id} className="border-b border-line last:border-0">
                  <td className="py-2 pr-3 text-muted whitespace-nowrap">{when(message.createdAt)}</td>
                  <td className="py-2 pr-3">{PURPOSES[message.purpose] || message.purpose}</td>
                  <td className="py-2 pr-3">{message.toEmail}</td>
                  <td className="py-2 pr-3 text-muted">{message.storeName || '—'}</td>
                  <td className="py-2"><span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${STATUS[message.status]?.tone || ''}`}>{STATUS[message.status]?.label || message.status}</span>{message.errorCode && <span className="ml-2 text-xs text-muted">{message.errorCode}</span>}</td>
                </tr>))}
                {!messages.length && <tr><td colSpan={5} className="py-4 text-center text-muted">Todavía no hay envíos.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card p-6 space-y-4">
          <h2 className="text-lg font-black text-ink flex items-center gap-2"><ShieldCheck size={18} /> Tiendas sin propietario con correo verificado</h2>
          <p className="text-sm text-muted">Regulariza solo después de verificar la identidad del propietario. Nada se asigna automáticamente: la persona recibe una invitación en el correo autorizado y entra solo si la abre.</p>
          {owners.map((store) => <RegularizeForm key={store.id} store={store} token={token!} onDone={(text) => { setNotice({ tone: 'ok', text }); void load() }} onError={(text) => setNotice({ tone: 'error', text })} />)}
          {!owners.length && <p className="text-sm text-emerald-800">Todas las tiendas tienen un propietario con correo verificado.</p>}
        </section>
      </div>
    </div>
  )
}

function RegularizeForm({ store, token, onDone, onError }: { store: UnverifiedOwnerStore; token: string; onDone: (text: string) => void; onError: (text: string) => void }) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ email: store.ownerEmail || '', name: '', identityMethod: '', evidence: '', confirm: false })
  const [busy, setBusy] = useState(false)
  const [link, setLink] = useState<string | null>(null)
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    try {
      const result = await emailApi.regularize(store.slug, form, token)
      setLink(result.invitation?.activationUrl ?? null)
      onDone(`${store.name}: ${result.note}`)
    } catch (err) { onError(err instanceof Error ? err.message : 'No se pudo regularizar.') }
    finally { setBusy(false) }
  }
  return (
    <div className="rounded-btn border border-line p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm"><b className="text-ink">{store.name}</b> <span className="text-muted">· {store.ownerAssigned ? `propietario ${store.ownerEmail} sin verificar` : 'sin propietario con correo'}</span></span>
        <button type="button" className="btn-ghost py-1.5 text-xs" onClick={() => setOpen(!open)}>{open ? 'Cerrar' : 'Regularizar'}</button>
      </div>
      {open && (
        <form onSubmit={submit} className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="block space-y-1"><span className="text-xs font-bold uppercase tracking-widest text-muted">Correo autorizado del propietario</span><input type="email" required className="input-field w-full" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
          <label className="block space-y-1"><span className="text-xs font-bold uppercase tracking-widest text-muted">Nombre</span><input className="input-field w-full" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label className="block space-y-1"><span className="text-xs font-bold uppercase tracking-widest text-muted">Cómo verificaste la identidad</span>
            <select required className="input-field w-full" value={form.identityMethod} onChange={(e) => setForm({ ...form, identityMethod: e.target.value })}><option value="">Elige…</option>{Object.entries(METHODS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label className="block space-y-1"><span className="text-xs font-bold uppercase tracking-widest text-muted">Detalle de la verificación</span><input required minLength={10} maxLength={500} className="input-field w-full" placeholder="Qué revisaste y cuándo (sin números de documento)" value={form.evidence} onChange={(e) => setForm({ ...form, evidence: e.target.value })} /></label>
          <label className="md:col-span-2 flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.checked })} /><span>Confirmo que verifiqué la identidad del propietario y que él autorizó este correo.</span></label>
          <div className="md:col-span-2"><button type="submit" className="btn-brand" disabled={busy || !form.confirm}>{busy && <Loader2 size={16} className="animate-spin" />} Regularizar y enviar invitación</button></div>
          {link && <p className="md:col-span-2 break-all text-sm"><b>Enlace de activación (un solo uso, compártelo en privado solo con el propietario verificado):</b> {link}</p>}
        </form>
      )}
    </div>
  )
}
