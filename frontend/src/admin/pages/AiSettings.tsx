import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, BrainCircuit, CheckCircle2, Coins, Info, KeyRound, Loader2, ShieldAlert, ShieldCheck, Unplug } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { aiApi, type AiOverview, type OwnKeyState } from '../../services/api'

/** Configuración → Inteligencia artificial: consultas del mes, créditos artísticos, API propia, historial y cómo se
 * cuenta. El cupo es mensual (sin límites por día ni por sesión). Las funciones sin IA siguen siempre disponibles. */

type Tab = 'consumo' | 'api' | 'politica'

const dateTimeFmt = new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
const dayFmt = new Intl.DateTimeFormat('es-CO', { timeZone: 'UTC', day: 'numeric', month: 'long' })
const toDate = (value: string) => new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`)
const when = (value: string) => dateTimeFmt.format(toDate(value))
const day = (key: string) => dayFmt.format(new Date(`${key.slice(0, 10)}T12:00:00Z`))
const cop = (value: number) => `$${value.toLocaleString('es-CO')} COP`

const NOTICE_STYLE: Record<50 | 75 | 90 | 100, string> = {
  50: 'border-sky-200 bg-sky-50',
  75: 'border-violet-200 bg-violet-50',
  90: 'border-amber-200 bg-amber-50',
  100: 'border-red-200 bg-red-50',
}

function Meter({ percent }: { percent: number }) {
  return <div className="h-2 rounded-full bg-line overflow-hidden mt-3" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}><div className={`h-full rounded-full ${percent >= 100 ? 'bg-red-500' : percent >= 90 ? 'bg-amber-500' : 'bg-brand'}`} style={{ width: `${percent}%` }} /></div>
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
  const { month, credits, ownKey } = data
  return (
    <div className="space-y-6">
      {month.notice && month.level && (
        <div className={`card p-5 flex gap-3 ${NOTICE_STYLE[month.level]}`} role="status">
          <Info className="shrink-0 text-ink/70" size={20} />
          <div className="text-sm text-ink">
            {/* The chat version starts with an emoji; the panel already shows its own icon. */}
            <p>{month.notice.replace(/^[^\p{L}\p{N}]+\s/u, '')}</p>
            {month.level >= 75 && !ownKey.connected && <button className="btn-brand mt-3" onClick={onGoToApi}>Conectar mi API</button>}
          </div>
        </div>
      )}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <div className="card p-5">
          <p className="text-xs font-bold uppercase tracking-widest text-muted">Consultas de IA del mes</p>
          {month.limit === null
            ? <><p className="text-3xl font-black text-ink mt-1">{month.used}</p><p className="text-xs text-muted mt-2">Tu plan no tiene cupo de consultas: se registran para que conozcas tu uso.</p></>
            : <>
                <p className="text-3xl font-black text-ink mt-1">{month.used} <span className="text-base font-semibold text-muted">de {month.limit} · {month.percent} %</span></p>
                <Meter percent={month.percent ?? 0} />
                <p className="text-sm text-ink mt-2">Te quedan <b>{month.available}</b>. Se renuevan el <b>{day(month.cycleEnd)}</b>.</p>
                {month.available ? <p className="text-xs text-muted mt-1">Úsalas cuando las necesites: no hay límite por día.</p> : <p className="text-xs text-muted mt-1">La IA del plan está en pausa hasta la renovación. Lo que no usa IA sigue funcionando.</p>}
              </>}
        </div>
        <div className="card p-5">
          <p className="text-xs font-bold uppercase tracking-widest text-muted">Créditos artísticos</p>
          <p className="text-3xl font-black text-ink mt-1">{credits.balance}</p>
          <p className="text-xs text-muted mt-2">Del plan {credits.bySource.plan} · cortesía {credits.bySource.cortesia} · comprados {credits.bySource.compra}</p>
          {credits.nextExpiry && <p className="text-xs text-muted mt-1">{credits.nextExpiry.credits} vencen el {day(credits.nextExpiry.at)}</p>}
          <p className="text-xs text-muted mt-1">Solo para imágenes premium; no se mezclan con las consultas.</p>
        </div>
        <div className="card p-5">
          <p className="text-xs font-bold uppercase tracking-widest text-muted">Mi API de Gemini</p>
          <p className="mt-3">{ownKey.connected
            ? <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${ownKey.status === 'activa' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>● {ownKey.statusLabel}</span>
            : <span className="inline-flex rounded-full px-3 py-1 text-xs font-bold bg-line text-muted">● No conectada</span>}</p>
          <p className="text-xs text-muted mt-2">{ownKey.connected ? `${ownKey.callsThisMonth} ${ownKey.callsThisMonth === 1 ? 'tarea' : 'tareas'} con tu API este mes · nivel: ${ownKey.tierLabel}` : 'Las tareas que procese tu propia API no gastan tus consultas.'}</p>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="text-base font-bold text-ink mb-3">Ampliar tu capacidad de IA</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <h3 className="text-sm font-bold text-ink flex items-center gap-2"><KeyRound size={15} className="text-brand" />Conecta tu API de Gemini</h3>
            <p className="text-sm text-muted mt-1">Las tareas que procese tu API no descuentan consultas ni créditos. Google te las cobra (o las da gratis con sus límites) directamente.</p>
            <button className="btn-ghost mt-2" onClick={onGoToApi}>{ownKey.connected ? 'Ver mi API' : 'Conectar mi API'}</button>
          </div>
          <div>
            <h3 className="text-sm font-bold text-ink flex items-center gap-2"><Coins size={15} className="text-brand" />Créditos artísticos para imágenes</h3>
            <ul className="text-sm mt-1 space-y-0.5">{credits.packs.map((pack) => <li key={pack.code}>{pack.credits} créditos · {cop(pack.priceCop)}</li>)}</ul>
            <a href="/admin/creditos" className="text-sm font-bold text-brand mt-2 inline-block">Solicitar recarga →</a>
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <div className="card p-5 overflow-x-auto">
          <h2 className="text-base font-bold text-ink mb-3">Historial de consumo</h2>
          {data.history.length === 0
            ? <p className="text-sm text-muted">Todavía no hay tareas de IA.</p>
            : <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-muted"><th className="py-2 pr-2">Cuándo</th><th className="pr-2">Tarea</th><th className="pr-2">Canal</th><th className="pr-2">Pagado con</th><th className="text-right">Uso</th></tr></thead>
                <tbody>{data.history.map((row, index) => (
                  <tr key={index} className="border-t border-line"><td className="py-2 pr-2 whitespace-nowrap">{when(row.at)}</td><td className="pr-2">{row.task}{row.result !== 'ok' && <span className="text-muted"> · {row.result}</span>}</td><td className="pr-2">{row.channel}</td><td className="pr-2">{row.paidWith}</td><td className="text-right tabular-nums whitespace-nowrap">{row.credits !== null ? `${row.credits} créditos` : row.units === 1 ? '1 consulta' : `${row.units} consultas`}</td></tr>
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
        </div>
      </section>
    </div>
  )
}

const IMAGE_CAPABILITY: Record<string, string> = {
  disponible: 'Sí (confirmado al generar una imagen)',
  no_disponible: 'No: Google no la permite con esta clave (las imágenes no tienen nivel gratuito). Se usan tus créditos.',
  sin_verificar: 'Por confirmar en la primera imagen',
}

function OwnApi({ state, token, isOwner, onChange }: { state: OwnKeyState; token: string; isOwner: boolean; onChange: () => Promise<void> }) {
  const [apiKey, setApiKey] = useState('')
  const [useAssistant, setUseAssistant] = useState(state.useAssistant ?? true)
  const [useStudio, setUseStudio] = useState(state.useStudio ?? false)
  const [fallback, setFallback] = useState(state.fallbackToPlatform ?? false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  // Two-step confirmation in the page itself (browser dialogs can be blocked or dismissed silently).
  const [confirming, setConfirming] = useState(false)

  const act = async (run: () => Promise<unknown>, done: string) => {
    setBusy(true); setMessage(null)
    try { await run(); setApiKey(''); setMessage({ ok: true, text: done }); await onChange() }
    catch (err) { setMessage({ ok: false, text: err instanceof Error ? err.message : 'No se pudo completar la acción.' }) }
    finally { setBusy(false) }
  }
  if (!state.available) return <p className="card p-5 text-sm text-muted">La conexión de API propia todavía no está habilitada en esta plataforma.</p>

  return (
    <div className="space-y-4">
      <div className="card p-5 border-amber-200 bg-amber-50 flex gap-3">
        <ShieldAlert size={20} className="text-amber-700 shrink-0" />
        <div className="text-sm text-ink space-y-1">
          <p><b>Antes de conectar una clave gratuita:</b> según las condiciones de Google, en el nivel gratuito Google puede usar y revisar el contenido que envías (mensajes, fotos) para mejorar sus productos. Con facturación activa, no.</p>
          <p>Por eso, con una clave gratuita o sin confirmar, <b>los pedidos y las guías de envío (datos de tus compradores) se procesan siempre con TiendIA</b>, nunca con tu clave. El nivel gratuito tampoco genera imágenes premium y puede ser lento o tener límites por minuto.</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <form className="card p-5 space-y-3" onSubmit={(event) => { event.preventDefault(); void act(() => aiApi.connectKey({ apiKey: apiKey.trim(), useAssistant, useStudio, fallbackToPlatform: fallback }, token), 'Clave validada y guardada.') }}>
          <h2 className="text-base font-bold text-ink flex items-center gap-2"><KeyRound size={16} className="text-brand" />{state.connected ? 'Reemplazar mi clave' : 'Conectar mi API de Gemini'}</h2>
          <ol className="text-sm text-ink list-decimal pl-5 space-y-1">
            <li>Entra a <b>aistudio.google.com</b> con tu cuenta de Google.</li>
            <li>Toca <b>Get API key</b> (Obtener clave de API) y luego <b>Create API key</b>.</li>
            <li>Copia la clave completa (empieza por <code>AIza</code>).</li>
            <li>Opcional: en <b>Billing</b> activa la facturación para usar imágenes y tener más velocidad y privacidad.</li>
            <li>Pégala aquí, elige para qué la usas y toca <b>Validar y guardar</b>.</li>
          </ol>
          {!isOwner && <p className="text-sm text-amber-700">Solo el propietario de la tienda puede conectar o cambiar la clave.</p>}
          <label className="block text-sm font-semibold text-ink">Clave de API de Gemini
            <input type="password" autoComplete="off" spellCheck={false} className="input-field w-full mt-1.5" placeholder="Pega aquí tu clave (empieza por AIza…)" value={apiKey} onChange={(event) => setApiKey(event.target.value)} disabled={!isOwner || busy} />
          </label>
          <label className="flex gap-3 rounded-xl border border-line p-3 text-sm"><input type="checkbox" checked={useAssistant} onChange={(event) => setUseAssistant(event.target.checked)} disabled={!isOwner} /><span>Usar en el asistente (Telegram y WhatsApp)<small className="block text-muted">Mensajes, notas de voz, fotos a producto</small></span></label>
          <label className="flex gap-3 rounded-xl border border-line p-3 text-sm"><input type="checkbox" checked={useStudio} onChange={(event) => setUseStudio(event.target.checked)} disabled={!isOwner} /><span>Usar en el Estudio IA y la Fábrica de Publicidad<small className="block text-muted">Imágenes premium: solo con facturación activa en Google</small></span></label>
          <label className="flex gap-3 rounded-xl border border-line p-3 text-sm"><input type="checkbox" checked={fallback} onChange={(event) => setFallback(event.target.checked)} disabled={!isOwner} /><span>Si mi API falla, usar las consultas de mi plan<small className="block text-muted">Desactivado por defecto. Si lo activas, esas tareas descuentan consultas del plan.</small></span></label>
          <div className="flex flex-wrap gap-2 pt-1">
            <button type="submit" className="btn-brand" disabled={!isOwner || busy || apiKey.trim().length < 30}>{busy ? <Loader2 size={16} className="animate-spin" /> : 'Validar y guardar'}</button>
            {state.connected && <button type="button" className="btn-ghost" disabled={!isOwner || busy} onClick={() => void act(() => aiApi.updateKey({ useAssistant, useStudio, fallbackToPlatform: fallback }, token), 'Usos actualizados.')}>Guardar usos</button>}
          </div>
          <p className="text-xs text-muted">Validamos la clave consultando los modelos disponibles: no gasta tokens. La guardamos cifrada y nunca se vuelve a mostrar.</p>
          {message && <p className={`text-sm flex items-center gap-2 ${message.ok ? 'text-emerald-700' : 'text-red-700'}`} role="status">{message.ok ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}{message.text}</p>}
        </form>

        <div className="card p-5">
          <h2 className="text-base font-bold text-ink flex items-center gap-2 mb-3"><ShieldCheck size={16} className="text-brand" />Estado y capacidades</h2>
          {!state.connected ? <p className="text-sm text-muted">No hay una API propia conectada. Tus tareas de IA usan las consultas de tu plan.</p> : (
            <>
              <table className="w-full text-sm"><tbody>
                <tr><td className="py-1.5 text-muted">Estado</td><td className="text-right font-bold">{state.statusLabel}</td></tr>
                <tr><td className="py-1.5 text-muted">Clave</td><td className="text-right font-mono">{state.hint}</td></tr>
                <tr><td className="py-1.5 text-muted">Nivel en Google</td><td className="text-right">{state.tierLabel}{state.billingDeclaredAt && state.tier !== 'facturacion_verificada' ? ' · facturación declarada, pendiente de verificación' : ''}</td></tr>
                <tr><td className="py-1.5 text-muted">Uso</td><td className="text-right">{[state.useAssistant && 'Asistente', state.useStudio && 'Estudio IA'].filter(Boolean).join(' y ')}</td></tr>
                <tr><td className="py-1.5 text-muted">Mensajes, voz y fotos a producto</td><td className="text-right">{state.capabilities?.text ? 'Sí' : 'No'}</td></tr>
                <tr><td className="py-1.5 text-muted align-top">Imágenes premium</td><td className="text-right">{IMAGE_CAPABILITY[state.capabilities?.images || 'sin_verificar']}</td></tr>
                <tr><td className="py-1.5 text-muted align-top">Pedidos y guías (datos de compradores)</td><td className="text-right">{state.capabilities?.buyerData ? 'Sí (facturación confirmada)' : 'No: se procesan con TiendIA'}</td></tr>
                <tr><td className="py-1.5 text-muted">Si falla</td><td className="text-right">{state.fallbackToPlatform ? 'Usa las consultas del plan' : 'Se pausa y te avisamos'}</td></tr>
                {state.validatedAt && <tr><td className="py-1.5 text-muted">Última validación</td><td className="text-right">{when(state.validatedAt)}</td></tr>}
                {state.lastUsedAt && <tr><td className="py-1.5 text-muted">Último uso</td><td className="text-right">{when(state.lastUsedAt)}</td></tr>}
                <tr><td className="py-1.5 text-muted">Tareas con tu API este mes</td><td className="text-right">{state.callsThisMonth}</td></tr>
              </tbody></table>
              {state.lastErrorText && <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">Último aviso de Google: {state.lastErrorText}</p>}
              {state.signals && state.signals.length > 0 && <ul className="mt-3 text-xs text-muted list-disc pl-5 space-y-0.5">{state.signals.map((signal) => <li key={signal}>{signal}</li>)}</ul>}
              <div className="mt-4 rounded-xl border border-line p-3 text-sm space-y-2">
                <p className="font-bold text-ink">¿En qué nivel está tu proyecto de Google?</p>
                <p className="text-muted">Google no permite comprobarlo con la clave. Revísalo así:</p>
                <ol className="list-decimal pl-5 text-ink space-y-0.5">{(state.tierSteps || []).map((step) => <li key={step}>{step}</li>)}</ol>
                <div className="flex flex-wrap gap-2 pt-1">
                  <button className="btn-ghost" disabled={!isOwner || busy} onClick={() => void act(() => aiApi.declareTier('gratuita', token), 'Registrado: nivel gratuito confirmado por ti.')}>Está en «Free» (gratuito)</button>
                  <button className="btn-ghost" disabled={!isOwner || busy} onClick={() => void act(() => aiApi.declareTier('facturacion', token), 'Registrado. TiendIA revisará la evidencia para verificar la facturación.')}>Tiene facturación (pedir verificación)</button>
                </div>
              </div>
              <div className="mt-3 rounded-xl border border-line p-3 text-sm space-y-2">
                <p className="font-bold text-ink">Tareas con datos de tus compradores</p>
                <p className="text-muted">Mientras tu clave no tenga facturación verificada, los pedidos, las guías y los mensajes con teléfonos, correos o direcciones de compradores no se envían a tu API. Elige qué hacer con ellas:</p>
                <div className="flex flex-wrap gap-2">
                  <button className={state.buyerDataPolicy === 'plan' ? 'btn-brand' : 'btn-ghost'} disabled={!isOwner || busy} onClick={() => void act(() => aiApi.buyerDataPolicy('plan', token), 'Esas tareas usarán las consultas de tu plan.')}>Usar las consultas de mi plan</button>
                  <button className={state.buyerDataPolicy === 'bloquear' ? 'btn-brand' : 'btn-ghost'} disabled={!isOwner || busy} onClick={() => void act(() => aiApi.buyerDataPolicy('bloquear', token), 'Esas tareas no se procesarán con IA.')}>No procesarlas con IA</button>
                </div>
                {state.buyerDataPolicy === 'preguntar' && <p className="text-xs text-amber-700">Aún no has elegido: por ahora esas tareas no se procesan con IA.</p>}
              </div>
              <div className="flex flex-wrap gap-2 mt-4">
                <button className="btn-ghost" disabled={!isOwner || busy} onClick={() => void act(() => aiApi.validateKey(token), 'Validación hecha.')}>Validar de nuevo</button>
                {confirming
                  ? <span className="flex flex-wrap items-center gap-2 text-sm">¿Desconectar tu API? Tus tareas volverán a usar las consultas del plan.
                      <button className="btn-danger" disabled={!isOwner || busy} onClick={() => { setConfirming(false); void act(() => aiApi.disconnectKey(token), 'API desconectada.') }}>Sí, desconectar</button>
                      <button className="btn-ghost" disabled={busy} onClick={() => setConfirming(false)}>Cancelar</button>
                    </span>
                  : <button className="btn-danger" disabled={!isOwner || busy} onClick={() => setConfirming(true)}><Unplug size={15} />Desconectar</button>}
              </div>
              {state.history.length > 0 && (
                <ul className="mt-4 border-t border-line pt-3 text-xs text-muted space-y-1">{state.history.map((item, index) => <li key={index}>{when(item.createdAt)} · {item.action} · {item.result}{item.errorCode ? ` (${item.errorCode})` : ''}</li>)}</ul>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/** One row per label (several internal operations share the same name for the merchant). */
function uniqueByLabel<T extends { label: string }>(rows: T[]): T[] {
  const seen = new Set<string>()
  return rows.filter((row) => (seen.has(row.label) ? false : (seen.add(row.label), true)))
}

function Policy({ data }: { data: AiOverview }) {
  const { policy } = data
  const weightRows = uniqueByLabel(data.weights.filter((weight) => weight.units > 0))
  const creditRows = uniqueByLabel(data.credits.costs.filter((cost) => cost.image).map((cost) => ({ ...cost, label: cost.feature === 'video_ia_segundo' ? 'Video con IA' : cost.label.replace(' (usa créditos)', '') })))
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="card p-5">
        <h2 className="text-base font-bold text-ink mb-3">Cuántas consultas usa cada tarea</h2>
        <table className="w-full text-sm"><tbody>
          <tr className="border-b border-line"><td className="py-2">Ver existencias, cambiar un precio exacto, confirmar, deshacer, menú</td><td className="text-right font-bold">0</td></tr>
          {weightRows.map((weight) => (
            <tr key={weight.feature} className="border-b border-line last:border-0"><td className="py-2">{weight.label}</td><td className="text-right tabular-nums">{weight.units}{weight.perItem ? ' c/u' : ''}</td></tr>
          ))}
          {creditRows.map((cost) => (
            <tr key={cost.feature} className="border-b border-line last:border-0"><td className="py-2">{cost.label}</td><td className="text-right tabular-nums whitespace-nowrap">{cost.credits} créditos{cost.feature === 'video_ia_segundo' ? ' por segundo' : ''}</td></tr>
          ))}
        </tbody></table>
        <p className="text-xs text-muted mt-3"><b>Tareas complejas:</b> una tarea se cobra una sola vez por su peso, aunque la IA necesite varios pasos o un reintento (por ejemplo, leer tu mensaje y volver a intentarlo si la respuesta llega cortada). Organizar un lote cuenta por foto.</p>
      </div>
      <div className="card p-5">
        <h2 className="text-base font-bold text-ink mb-3">Uso razonable</h2>
        <ul className="text-sm space-y-2 list-disc pl-5">
          <li>Tu plan trae un cupo de consultas por mes que puedes usar cuando lo necesites: sin límites por día ni por semana.</li>
          <li>Te avisamos al 50, 75 y 90 % del cupo. Al 100 % la IA del plan se pausa hasta la renovación; todo lo demás sigue funcionando.</li>
          <li>Si una tarea falla, no se descuentan consultas ni créditos. Una misma solicitud repetida o un mensaje que llegue dos veces no se cobra dos veces.</li>
          <li>Protección técnica (también con tu API): hasta {policy.concurrency} tareas de IA a la vez y {policy.perMinute} por minuto por tienda; fotos de hasta {policy.maxImageMb} MB, audios de hasta {policy.maxAudioMinutes} minutos y documentos de hasta {policy.maxDocumentMb} MB.</li>
          <li>Créditos artísticos: solo para imágenes. Los del plan vencen con el ciclo; los comprados duran 12 meses. Siempre verás cuántos usa una imagen antes de generarla.</li>
          <li>Con tu propia API, las tareas que procese no gastan tus consultas; Google te las cobra o las da con sus límites gratuitos.</li>
        </ul>
      </div>
    </div>
  )
}
