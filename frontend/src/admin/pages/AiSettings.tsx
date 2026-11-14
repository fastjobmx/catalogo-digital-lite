import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, BrainCircuit, CheckCircle2, Clock, Coins, KeyRound, Loader2, ShieldCheck, Unplug } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { aiApi, type AiOverview, type OwnKeyState } from '../../services/api'

/** Configuración → Inteligencia artificial: consultas de la sesión y del mes, créditos artísticos, API propia,
 * historial y cómo se cuenta. Las funciones sin IA (catálogo, pedidos, botones) siguen siempre disponibles. */

type Tab = 'consumo' | 'api' | 'politica'

const timeFmt = new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', hour: 'numeric', minute: '2-digit' })
const dateTimeFmt = new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
const dayFmt = new Intl.DateTimeFormat('es-CO', { timeZone: 'UTC', day: 'numeric', month: 'long' })
const toDate = (value: string) => new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`)
const time = (value: string) => timeFmt.format(toDate(value))
const when = (value: string) => dateTimeFmt.format(toDate(value))
const day = (key: string) => dayFmt.format(new Date(`${key.slice(0, 10)}T12:00:00Z`))
const cop = (value: number) => `$${value.toLocaleString('es-CO')} COP`
const untilText = (value: string) => {
  const minutes = Math.max(0, Math.round((toDate(value).getTime() - Date.now()) / 60000))
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`
}

function Meter({ used, limit }: { used: number; limit: number }) {
  const percent = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0
  return <div className="h-2 rounded-full bg-line overflow-hidden mt-3" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}><div className={`h-full rounded-full ${percent >= 90 ? 'bg-amber-500' : 'bg-brand'}`} style={{ width: `${percent}%` }} /></div>
}

export default function AiSettings() {
  const { token, isDemoSession, role } = useAuth()
  const [tab, setTab] = useState<Tab>('consumo')
  const [data, setData] = useState<AiOverview | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!token || isDemoSession) return
    try { setData(await aiApi.overview(token)); setError('') }
    catch { setError('No se pudo cargar el consumo de IA.') }
  }, [token, isDemoSession])
  useEffect(() => { void load() }, [load])

  const isOwner = role === 'owner' || role === 'superadmin'
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <div className="flex items-center gap-2 mb-2">
          <BrainCircuit size={15} className="text-brand" />
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand/70">Configuración</span>
        </div>
        <h1 className="text-3xl font-black tracking-tight text-ink">Inteligencia artificial</h1>
        <p className="text-muted text-sm mt-1.5">
          {data?.plan.name ? `Plan ${data.plan.name}. ` : ''}Tu catálogo, tus pedidos, Telegram y WhatsApp funcionan siempre, con o sin IA.
        </p>
      </div>

      {isDemoSession && <p className="card p-4 text-sm text-muted">El consumo de IA se muestra cuando entras con la cuenta real de tu tienda.</p>}
      {error && <p className="card flex items-center gap-2 p-4 text-sm text-red-700" role="alert"><AlertCircle size={17} />{error}</p>}

      <div className="flex gap-1 border-b border-line" role="tablist">
        {([['consumo', 'Consumo'], ['api', 'Mi API'], ['politica', 'Cómo se cuenta']] as const).map(([key, label]) => (
          <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
            className={`px-4 py-2.5 text-sm border-b-2 -mb-px ${tab === key ? 'border-brand text-brand font-bold' : 'border-transparent text-muted hover:text-ink'}`}>{label}</button>
        ))}
      </div>

      {data && tab === 'consumo' && <Usage data={data} onGoToApi={() => setTab('api')} />}
      {data && tab === 'api' && token && <OwnApi state={data.ownKey} token={token} isOwner={isOwner} onChange={load} />}
      {data && tab === 'politica' && <Policy data={data} />}
    </div>
  )
}

function Usage({ data, onGoToApi }: { data: AiOverview; onGoToApi: () => void }) {
  const { session, month, credits, ownKey } = data
  const sessionOut = session.limit !== null && session.available === 0
  const monthOut = month.limit !== null && month.available === 0
  return (
    <div className="space-y-6">
      {(sessionOut || monthOut) && (
        <div className="card p-5 border-amber-200 bg-amber-50 flex gap-3" role="status">
          <Clock className="text-amber-600 shrink-0" size={20} />
          <div className="text-sm text-ink">
            {monthOut
              ? <p><b>Usaste las {month.limit} consultas de este mes.</b> Se renuevan el {day(month.cycleEnd)}.</p>
              : <p><b>Usaste las {session.limit} consultas de esta sesión.</b> Se restablecen a las {time(session.resetsAt!)} (en {untilText(session.resetsAt!)}).{month.available !== null && ` Te quedan ${month.available} este mes.`}</p>}
            <p className="text-muted mt-1">Mientras tanto puedes seguir usando el catálogo, los pedidos, los botones y los comandos.</p>
            {!ownKey.connected && <button className="btn-brand mt-3" onClick={onGoToApi}>Conectar mi API</button>}
          </div>
        </div>
      )}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card p-5">
          <p className="text-xs font-bold uppercase tracking-widest text-muted">Consultas de esta sesión</p>
          {session.limit === null
            ? <p className="text-sm text-muted mt-2">Tu plan no tiene cupo por sesión.</p>
            : <>
                <p className="text-3xl font-black text-ink mt-1">{session.available} <span className="text-base font-semibold text-muted">de {session.limit}</span></p>
                <Meter used={session.used} limit={session.limit} />
                <p className="text-xs text-muted mt-2">{session.resetsAt ? <>Se restablecen a las <b>{time(session.resetsAt)}</b> (en {untilText(session.resetsAt)})</> : `La sesión de ${session.hours} horas empieza con tu próxima consulta de IA.`}</p>
              </>}
        </div>
        <div className="card p-5">
          <p className="text-xs font-bold uppercase tracking-widest text-muted">Consultas del mes</p>
          <p className="text-3xl font-black text-ink mt-1">{month.used}{month.limit !== null && <span className="text-base font-semibold text-muted"> de {month.limit}</span>}</p>
          {month.limit !== null && <Meter used={month.used} limit={month.limit} />}
          <p className="text-xs text-muted mt-2">Ciclo hasta el {day(month.cycleEnd)}{month.provisional ? ' (mes calendario)' : ''}</p>
        </div>
        <div className="card p-5">
          <p className="text-xs font-bold uppercase tracking-widest text-muted">Créditos artísticos</p>
          <p className="text-3xl font-black text-ink mt-1">{credits.balance}</p>
          <p className="text-xs text-muted mt-2">Del plan {credits.bySource.plan} · cortesía {credits.bySource.cortesia} · comprados {credits.bySource.compra}</p>
          {credits.nextExpiry && <p className="text-xs text-muted mt-1">{credits.nextExpiry.credits} vencen el {day(credits.nextExpiry.at)}</p>}
        </div>
        <div className="card p-5">
          <p className="text-xs font-bold uppercase tracking-widest text-muted">Mi API de Gemini</p>
          <p className="mt-3">{ownKey.connected
            ? <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${ownKey.status === 'activa' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>● {ownKey.statusLabel}</span>
            : <span className="inline-flex rounded-full px-3 py-1 text-xs font-bold bg-line text-muted">● No conectada</span>}</p>
          <p className="text-xs text-muted mt-2">{ownKey.connected ? `${ownKey.callsThisMonth} tareas con tu API este mes.` : 'Conéctala para que tus tareas no gasten tus consultas.'}</p>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <div className="card p-5 overflow-x-auto">
          <h2 className="text-base font-bold text-ink mb-3">Historial de consumo</h2>
          {data.history.length === 0
            ? <p className="text-sm text-muted">Todavía no hay tareas de IA.</p>
            : <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-muted"><th className="py-2 pr-2">Cuándo</th><th className="pr-2">Tarea</th><th className="pr-2">Canal</th><th className="pr-2">Pagado con</th><th className="text-right">Consultas</th></tr></thead>
                <tbody>{data.history.map((row, index) => (
                  <tr key={index} className="border-t border-line"><td className="py-2 pr-2 whitespace-nowrap">{when(row.at)}</td><td className="pr-2">{row.task}{row.result !== 'ok' && <span className="text-muted"> · {row.result}</span>}</td><td className="pr-2">{row.channel}</td><td className="pr-2">{row.paidWith}</td><td className="text-right tabular-nums">{row.units}</td></tr>
                ))}</tbody>
              </table>}
          <p className="text-xs text-muted mt-3">No guardamos el contenido de tus mensajes, fotos ni audios en este historial.</p>
        </div>
        <div className="card p-5">
          <h2 className="text-base font-bold text-ink mb-3">Este ciclo por tipo</h2>
          {data.byTask.length === 0 ? <p className="text-sm text-muted">Sin consultas este ciclo.</p> : (
            <table className="w-full text-sm"><tbody>{data.byTask.map((row) => (
              <tr key={row.task} className="border-t border-line first:border-0"><td className="py-2">{row.task} <span className="text-muted">({row.tasks})</span></td><td className="text-right tabular-nums">{row.units}</td></tr>
            ))}</tbody></table>
          )}
          <div className="mt-5 border-t border-line pt-4">
            <h3 className="text-sm font-bold text-ink flex items-center gap-2"><Coins size={15} className="text-brand" />Recargar créditos artísticos</h3>
            <ul className="text-sm mt-2 space-y-1">{credits.packs.map((pack) => <li key={pack.code}>{pack.credits} créditos · {cop(pack.priceCop)}</li>)}</ul>
            <a href="/admin/creditos" className="text-sm font-bold text-brand mt-2 inline-block">Solicitar recarga →</a>
          </div>
        </div>
      </section>
    </div>
  )
}

function OwnApi({ state, token, isOwner, onChange }: { state: OwnKeyState; token: string; isOwner: boolean; onChange: () => Promise<void> }) {
  const [apiKey, setApiKey] = useState('')
  const [useAssistant, setUseAssistant] = useState(state.useAssistant ?? true)
  const [useStudio, setUseStudio] = useState(state.useStudio ?? false)
  const [fallback, setFallback] = useState(state.fallbackToPlatform ?? false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const act = async (run: () => Promise<unknown>, done: string) => {
    setBusy(true); setMessage(null)
    try { await run(); setApiKey(''); setMessage({ ok: true, text: done }); await onChange() }
    catch (err) { setMessage({ ok: false, text: err instanceof Error ? err.message : 'No se pudo completar la acción.' }) }
    finally { setBusy(false) }
  }
  if (!state.available) return <p className="card p-5 text-sm text-muted">La conexión de API propia todavía no está habilitada en esta plataforma.</p>

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <form className="card p-5 space-y-3" onSubmit={(event) => { event.preventDefault(); void act(() => aiApi.connectKey({ apiKey: apiKey.trim(), useAssistant, useStudio, fallbackToPlatform: fallback }, token), 'Clave validada y guardada.') }}>
        <h2 className="text-base font-bold text-ink flex items-center gap-2"><KeyRound size={16} className="text-brand" />{state.connected ? 'Reemplazar mi clave' : 'Conectar mi API de Gemini'}</h2>
        <p className="text-sm text-muted">Con tu propia clave, Google te cobra directamente las tareas que se procesen con ella y no se descuentan tus consultas ni tus créditos. La guardamos cifrada y nunca se vuelve a mostrar.</p>
        {!isOwner && <p className="text-sm text-amber-700">Solo el propietario de la tienda puede conectar o cambiar la clave.</p>}
        <label className="block text-sm font-semibold text-ink">Clave de API de Gemini
          <input type="password" autoComplete="off" spellCheck={false} className="input-field w-full mt-1.5" placeholder="Pega aquí tu clave (empieza por AIza…)" value={apiKey} onChange={(event) => setApiKey(event.target.value)} disabled={!isOwner || busy} />
        </label>
        <label className="flex gap-3 rounded-xl border border-line p-3 text-sm"><input type="checkbox" checked={useAssistant} onChange={(event) => setUseAssistant(event.target.checked)} disabled={!isOwner} /><span>Usar en el asistente (Telegram y WhatsApp)<small className="block text-muted">Mensajes, notas de voz, fotos a producto, pedidos</small></span></label>
        <label className="flex gap-3 rounded-xl border border-line p-3 text-sm"><input type="checkbox" checked={useStudio} onChange={(event) => setUseStudio(event.target.checked)} disabled={!isOwner} /><span>Usar en el Estudio IA y la Fábrica de Publicidad<small className="block text-muted">Imágenes premium: tu clave debe tener acceso al modelo de imagen</small></span></label>
        <label className="flex gap-3 rounded-xl border border-line p-3 text-sm"><input type="checkbox" checked={fallback} onChange={(event) => setFallback(event.target.checked)} disabled={!isOwner} /><span>Si mi API falla, usar mis consultas de TiendIA<small className="block text-muted">Desactivado: si tu API falla te avisamos y no usamos el cupo de TiendIA</small></span></label>
        <div className="flex flex-wrap gap-2 pt-1">
          <button type="submit" className="btn-brand" disabled={!isOwner || busy || apiKey.trim().length < 30}>{busy ? <Loader2 size={16} className="animate-spin" /> : 'Validar y guardar'}</button>
          {state.connected && <button type="button" className="btn-ghost" disabled={!isOwner || busy} onClick={() => void act(() => aiApi.updateKey({ useAssistant, useStudio, fallbackToPlatform: fallback }, token), 'Usos actualizados.')}>Guardar usos</button>}
        </div>
        <p className="text-xs text-muted">Validamos la clave consultando los modelos disponibles: no gasta tokens.</p>
        {message && <p className={`text-sm flex items-center gap-2 ${message.ok ? 'text-emerald-700' : 'text-red-700'}`} role="status">{message.ok ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}{message.text}</p>}
      </form>

      <div className="card p-5">
        <h2 className="text-base font-bold text-ink flex items-center gap-2 mb-3"><ShieldCheck size={16} className="text-brand" />Estado</h2>
        {!state.connected ? <p className="text-sm text-muted">No hay una API propia conectada. Tus tareas de IA usan las consultas de tu plan.</p> : (
          <>
            <table className="w-full text-sm"><tbody>
              <tr><td className="py-1.5 text-muted">Estado</td><td className="text-right font-bold">{state.statusLabel}</td></tr>
              <tr><td className="py-1.5 text-muted">Clave</td><td className="text-right font-mono">{state.hint}</td></tr>
              <tr><td className="py-1.5 text-muted">Uso</td><td className="text-right">{[state.useAssistant && 'Asistente', state.useStudio && 'Estudio IA'].filter(Boolean).join(' y ')}</td></tr>
              <tr><td className="py-1.5 text-muted">Modelos verificados</td><td className="text-right">{state.modelsOk?.join(', ') || '—'}</td></tr>
              {state.validatedAt && <tr><td className="py-1.5 text-muted">Última validación</td><td className="text-right">{when(state.validatedAt)}</td></tr>}
              {state.lastUsedAt && <tr><td className="py-1.5 text-muted">Último uso</td><td className="text-right">{when(state.lastUsedAt)}</td></tr>}
              <tr><td className="py-1.5 text-muted">Tareas con tu API este mes</td><td className="text-right">{state.callsThisMonth}</td></tr>
            </tbody></table>
            {state.status !== 'activa' && <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">Tu API respondió: {state.statusLabel}. Revisa tu clave o la facturación de tu proyecto en Google.{state.fallbackToPlatform ? ' Mientras tanto usamos las consultas de tu plan.' : ' Mientras tanto las tareas de IA quedan en pausa.'}</p>}
            <div className="flex flex-wrap gap-2 mt-4">
              <button className="btn-ghost" disabled={!isOwner || busy} onClick={() => void act(() => aiApi.validateKey(token), 'Validación hecha.')}>Validar de nuevo</button>
              <button className="btn-danger" disabled={!isOwner || busy} onClick={() => { if (window.confirm('¿Desconectar tu API de Gemini? Tus tareas volverán a usar las consultas del plan.')) void act(() => aiApi.disconnectKey(token), 'API desconectada.') }}><Unplug size={15} />Desconectar</button>
            </div>
            {state.history.length > 0 && (
              <ul className="mt-4 border-t border-line pt-3 text-xs text-muted space-y-1">{state.history.map((item, index) => <li key={index}>{when(item.createdAt)} · {item.action} · {item.result}</li>)}</ul>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function Policy({ data }: { data: AiOverview }) {
  const { policy } = data
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="card p-5">
        <h2 className="text-base font-bold text-ink mb-3">Cuántas consultas usa cada tarea</h2>
        <table className="w-full text-sm"><tbody>
          <tr className="border-b border-line"><td className="py-2">Ver existencias, cambiar un precio exacto, confirmar, deshacer, menú</td><td className="text-right font-bold">0</td></tr>
          {data.weights.filter((weight) => weight.units > 0).map((weight) => (
            <tr key={weight.feature} className="border-b border-line last:border-0"><td className="py-2">{weight.label}</td><td className="text-right tabular-nums">{weight.units}{weight.perItem ? ' c/u' : ''}</td></tr>
          ))}
          {data.credits.costs.filter((cost) => cost.image).map((cost) => (
            <tr key={cost.feature} className="border-b border-line last:border-0"><td className="py-2">{cost.label}</td><td className="text-right tabular-nums">{cost.credits} créditos</td></tr>
          ))}
        </tbody></table>
      </div>
      <div className="card p-5">
        <h2 className="text-base font-bold text-ink mb-3">Uso razonable</h2>
        <ul className="text-sm space-y-2 list-disc pl-5">
          <li>Sesión de {policy.sessionHours} horas desde tu primera consulta de IA; el cupo mensual aplica siempre.</li>
          <li>Si una tarea falla, no se descuentan consultas ni créditos.</li>
          <li>Una misma solicitud repetida en {policy.duplicateWindowMinutes} minutos no se cobra dos veces.</li>
          <li>Hasta {policy.concurrency} tareas de IA a la vez y {policy.perMinute} por minuto por tienda (también con tu API).</li>
          <li>Fotos de hasta {policy.maxImageMb} MB, audios de hasta {policy.maxAudioMinutes} minutos y documentos de hasta {policy.maxDocumentMb} MB.</li>
          <li>Créditos: los del plan vencen con el ciclo; los comprados duran 12 meses. Siempre verás cuántos usa una imagen antes de generarla.</li>
          <li>Con tu propia API, Google te cobra directamente las tareas que se procesen con ella.</li>
        </ul>
      </div>
    </div>
  )
}
