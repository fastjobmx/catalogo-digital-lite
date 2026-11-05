import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, BadgeCheck, CheckCircle2, KeyRound, Loader2, MailWarning, Send, ShieldOff, ShieldCheck, UserPlus, Users as UsersIcon } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { usersApi, type StoreMember } from '../../services/api'

const ROLE_LABELS: Record<string, string> = { owner: 'Propietario', admin: 'Administrador', operator: 'Operador', seller: 'Vendedor', inventory: 'Inventario' }
const STATUS_TONE: Record<StoreMember['status'], string> = {
  activo: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  invitado: 'bg-sky-50 text-sky-800 border-sky-200',
  inactivo: 'bg-neutral-100 text-neutral-600 border-neutral-200',
  deshabilitado: 'bg-red-50 text-red-800 border-red-200',
}
const STATUS_LABEL: Record<StoreMember['status'], string> = { activo: 'Activo', invitado: 'Invitación pendiente', inactivo: 'Sin acceso a esta tienda', deshabilitado: 'Deshabilitado' }
const CHANNEL: Record<string, string> = { email: 'por correo', telegram: 'por Telegram', none: 'sin canal disponible' }
const date = (value: string | null) => value ? new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }) : '—'

/** "Usuarios y accesos": who can enter this store's panel and the safe actions on their access.
 * Passwords, tokens and recovery links are never shown here. */
export default function Users() {
  const { token, isDemoSession } = useAuth()
  const [members, setMembers] = useState<StoreMember[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'warn' | 'error'; text: string } | null>(null)
  const [manualLink, setManualLink] = useState<string | null>(null)
  const [invite, setInvite] = useState({ email: '', displayName: '', role: 'operator' })

  const load = useCallback(async () => {
    if (!token || isDemoSession) return
    try { setMembers((await usersApi.list(token)).items) } catch (err) { setNotice({ tone: 'error', text: err instanceof Error && /role/i.test(err.message) ? 'Tu rol no permite ver los usuarios de la tienda.' : 'No se pudieron cargar los usuarios.' }) }
  }, [token, isDemoSession])
  useEffect(() => { void load() }, [load])

  const run = async (key: string, action: () => Promise<string>) => {
    setBusy(key); setNotice(null); setManualLink(null)
    try { const text = await action(); setNotice({ tone: /^No se envió/.test(text) ? 'warn' : 'ok', text }); await load() }
    catch (err) { setNotice({ tone: 'error', text: err instanceof Error ? err.message.replace(/^Your role does not allow this action$/, 'Tu rol no permite esta acción.') : 'No se pudo completar la acción.' }) }
    finally { setBusy(null) }
  }

  const sendReset = (member: StoreMember) => run(`reset-${member.id}`, async () => {
    const result = await usersApi.passwordReset(member.id, token!)
    return result.delivery === 'none'
      ? `No se envió: ${member.email} no tiene correo verificado ni Telegram vinculado. Pídele que verifique su correo.`
      : `Enlace para restablecer la contraseña enviado ${CHANNEL[result.delivery]} a las ${new Date(result.sentAt).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' })}. Vence en 60 minutos.`
  })
  const resendInvite = (member: StoreMember) => run(`invite-${member.id}`, async () => {
    const result = await usersApi.invitation(member.id, token!)
    if (result.delivery === 'manual') { setManualLink(result.activationUrl); return 'El envío de correos no está configurado: comparte este enlace de activación en privado, solo con esa persona (vence en 72 horas).' }
    return `Invitación reenviada por correo a ${member.email}.`
  })
  const verify = (member: StoreMember) => run(`verify-${member.id}`, async () => {
    await usersApi.verifyEmail(member.id, token!)
    return `Enviamos a ${member.email} un enlace para confirmar el correo (vence en 48 horas).`
  })
  const toggle = (member: StoreMember, active: boolean) => {
    if (!active && !window.confirm(`¿Quitar el acceso de ${member.email} a esta tienda? Sus otras tiendas no cambian.`)) return
    void run(`access-${member.id}`, async () => { await usersApi.access(member.id, active, token!); return active ? 'Acceso restablecido.' : 'Acceso desactivado en esta tienda.' })
  }
  const sendInvite = (event: React.FormEvent) => {
    event.preventDefault()
    void run('invite-new', async () => {
      const result = await usersApi.invite({ email: invite.email.trim(), displayName: invite.displayName.trim(), role: invite.role }, token!)
      setInvite({ email: '', displayName: '', role: 'operator' })
      if (result.delivery === 'manual' && result.activationUrl) { setManualLink(result.activationUrl); return 'Usuario agregado. El envío de correos no está configurado: comparte este enlace de activación en privado (vence en 72 horas).' }
      return result.delivery === 'email' ? 'Invitación enviada por correo.' : 'Usuario agregado: ya tenía una cuenta activa y ahora puede entrar a esta tienda.'
    })
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <div className="flex items-center gap-2 mb-2"><UsersIcon size={15} className="text-brand" /><span className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand/70">Equipo</span></div>
        <h1 className="text-3xl font-black tracking-tight text-ink">Usuarios y accesos</h1>
        <p className="text-muted text-sm mt-1.5">Quién puede entrar al panel de esta tienda. Nadie, ni siquiera la administración, puede ver contraseñas ni enlaces de recuperación: solo se envían a la persona.</p>
      </div>

      {isDemoSession && <p className="card p-4 text-sm text-muted">Esta sección requiere entrar con la cuenta real de tu tienda.</p>}
      {notice && <p role={notice.tone === 'error' ? 'alert' : 'status'} className={`card flex items-start gap-2 p-4 text-sm ${notice.tone === 'error' ? 'text-red-700' : notice.tone === 'warn' ? 'text-amber-900 bg-amber-50 border-amber-200' : 'text-emerald-800'}`}>{notice.tone === 'ok' ? <CheckCircle2 size={17} className="mt-0.5 shrink-0" /> : <AlertCircle size={17} className="mt-0.5 shrink-0" />}{notice.text}</p>}
      {manualLink && <p className="card break-all p-4 text-sm"><b>Enlace de activación (un solo uso):</b> {manualLink}</p>}

      <section className="card divide-y divide-line">
        {members === null && !isDemoSession && <p className="p-6 text-sm text-muted flex items-center gap-2"><Loader2 size={16} className="animate-spin" /> Cargando…</p>}
        {members?.map((member) => (
          <article key={member.id} className="grid gap-3 p-5 md:grid-cols-[1fr_auto] md:items-center">
            <div className="min-w-0 space-y-1">
              <p className="font-bold text-ink truncate">{member.displayName || member.email}</p>
              <p className="text-sm text-muted truncate">{member.email}</p>
              <div className="flex flex-wrap items-center gap-1.5 pt-1 text-xs">
                <span className="rounded-full border border-line px-2 py-0.5 font-bold">{ROLE_LABELS[member.role] || member.role}</span>
                <span className={`rounded-full border px-2 py-0.5 font-bold ${STATUS_TONE[member.status]}`}>{STATUS_LABEL[member.status]}</span>
                {member.emailVerified
                  ? <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-bold text-emerald-800"><BadgeCheck size={12} /> Correo verificado</span>
                  : <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 font-bold text-amber-900"><MailWarning size={12} /> Correo sin verificar</span>}
                {member.telegramLinked && <span className="rounded-full border border-line px-2 py-0.5">Telegram vinculado</span>}
              </div>
              <p className="text-xs text-muted">Último acceso: {date(member.lastLoginAt)}{member.lastPasswordReset ? ` · Último restablecimiento: ${date(member.lastPasswordReset.at)} (${CHANNEL[member.lastPasswordReset.channel || 'none']})` : ''}</p>
            </div>
            <div className="flex flex-wrap gap-2 md:justify-end">
              {member.status === 'activo' && <button type="button" className="btn-ghost py-1.5 text-xs" disabled={busy !== null} onClick={() => void sendReset(member)}>{busy === `reset-${member.id}` ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />} Enviar enlace para restablecer contraseña</button>}
              {member.status === 'invitado' && <button type="button" className="btn-ghost py-1.5 text-xs" disabled={busy !== null} onClick={() => void resendInvite(member)}><Send size={14} /> Reenviar invitación</button>}
              {!member.emailVerified && member.status !== 'deshabilitado' && <button type="button" className="btn-ghost py-1.5 text-xs" disabled={busy !== null} onClick={() => void verify(member)}><BadgeCheck size={14} /> Verificar correo</button>}
              {member.role !== 'owner' && member.status !== 'deshabilitado' && (member.status === 'inactivo'
                ? <button type="button" className="btn-ghost py-1.5 text-xs" disabled={busy !== null} onClick={() => toggle(member, true)}><ShieldCheck size={14} /> Activar acceso</button>
                : <button type="button" className="btn-ghost py-1.5 text-xs text-red-700" disabled={busy !== null} onClick={() => toggle(member, false)}><ShieldOff size={14} /> Desactivar acceso</button>)}
            </div>
          </article>
        ))}
      </section>

      <section className="card p-6">
        <h2 className="text-lg font-black text-ink flex items-center gap-2"><UserPlus size={18} /> Invitar a alguien</h2>
        <p className="text-sm text-muted mt-1">Recibirá un enlace de activación para crear su propia contraseña. Solo el propietario puede invitar.</p>
        <form onSubmit={sendInvite} className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_12rem_auto] md:items-end">
          <label className="block space-y-1.5"><span className="block text-xs font-bold uppercase tracking-widest text-muted">Correo</span><input type="email" required className="input-field w-full" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} /></label>
          <label className="block space-y-1.5"><span className="block text-xs font-bold uppercase tracking-widest text-muted">Nombre (opcional)</span><input className="input-field w-full" maxLength={120} value={invite.displayName} onChange={(e) => setInvite({ ...invite, displayName: e.target.value })} /></label>
          <label className="block space-y-1.5"><span className="block text-xs font-bold uppercase tracking-widest text-muted">Rol</span>
            <select className="input-field w-full" value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value })}>
              <option value="admin">Administrador</option><option value="operator">Operador</option><option value="seller">Vendedor</option><option value="inventory">Inventario</option>
            </select></label>
          <button type="submit" className="btn-brand" disabled={busy !== null}>{busy === 'invite-new' && <Loader2 size={16} className="animate-spin" />} Invitar</button>
        </form>
      </section>
    </div>
  )
}
