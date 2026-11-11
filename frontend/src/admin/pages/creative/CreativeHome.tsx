import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle, CheckCircle2, Clock, Loader2, Palette, Sparkles } from 'lucide-react'
import { useAuth } from '../../../contexts/AuthContext'
import { ApiRequestError, creativeApi, type CreativeJobApi, type CreativeOverview } from '../../../services/api'

const STATUS_LABEL = { disponible: 'Disponible', base: 'Base lista', proximamente: 'Próximamente' } as const
const JOB_STATUS: Record<CreativeJobApi['status'], string> = { pendiente: 'Pendiente', en_proceso: 'En proceso', completado: 'Completado', fallido: 'Falló (sin costo)', cancelado: 'Cancelado' }

/** Inicio del Estudio Creativo IA: estado real de cada módulo. Nada de datos de ejemplo. */
export default function CreativeHome() {
  const { token, isDemoSession } = useAuth()
  const [overview, setOverview] = useState<CreativeOverview | null>(null)
  const [jobs, setJobs] = useState<CreativeJobApi[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!token || isDemoSession) return
    Promise.all([creativeApi.overview(token), creativeApi.jobs(token)])
      .then(([data, list]) => { setOverview(data); setJobs(list.items); setError('') })
      .catch((err) => setError(err instanceof ApiRequestError && err.status === 403 ? 'Solo el propietario o un administrador de la tienda pueden usar el Estudio Creativo.' : 'No se pudo cargar el Estudio Creativo.'))
  }, [token, isDemoSession])

  return (
    <div className="space-y-8 animate-fade-in">
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Sparkles size={15} className="text-brand" />
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand/70">TiendIA Exprés</span>
        </div>
        <h1 className="text-3xl font-black tracking-tight text-ink">Estudio Creativo IA</h1>
        <p className="text-muted text-sm mt-1.5">Crea contenido profesional, organiza campañas y descubre oportunidades para tu negocio.</p>
      </div>

      {isDemoSession && <p className="card p-4 text-sm text-muted">El Estudio Creativo se muestra cuando entras con la cuenta real de tu tienda.</p>}
      {error && <p className="card flex items-center gap-2 p-4 text-sm text-red-700" role="alert"><AlertCircle size={17} />{error}</p>}
      {!overview && !error && !isDemoSession && <p className="flex items-center gap-2 text-sm text-muted"><Loader2 size={16} className="animate-spin" /> Cargando…</p>}

      {overview && (
        <>
          <section className="card p-6 flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
            <div>
              <h2 className="text-lg font-black text-ink">Empieza por tu Brand Kit</h2>
              <p className="text-sm text-muted mt-1">Todo lo que el estudio cree usará tu logo, colores, tipografías y tono. Solo se guarda lo que tú escribas.</p>
            </div>
            <Link to="/admin/estudio-creativo/brand-kit" className="btn-brand whitespace-nowrap"><Palette size={16} /> Abrir Brand Kit</Link>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-black text-ink">Módulos</h2>
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {overview.modules.map((module) => (
                <li key={module.key} className={`card p-5 ${module.status === 'proximamente' ? 'opacity-75' : ''}`}>
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-bold text-ink">{module.name}</p>
                    <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${module.status === 'proximamente' ? 'bg-line text-muted' : 'bg-emerald-50 text-emerald-700'}`}>{STATUS_LABEL[module.status]}</span>
                  </div>
                  <p className="text-sm text-muted mt-1.5">{module.summary}</p>
                  {module.key === 'creditos' && <Link to="/admin/creditos" className="text-sm font-semibold text-brand mt-2 inline-block">Ver mis Créditos IA</Link>}
                </li>
              ))}
            </ul>
          </section>

          <section className="card p-6 space-y-3">
            <h2 className="text-lg font-black text-ink">Trabajos</h2>
            {jobs && jobs.length ? (
              <ul className="divide-y divide-line text-sm">{jobs.map((job) => (
                <li key={job.id} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="text-ink capitalize">{job.kind}</span>
                  <span className="text-muted">{new Date(job.createdAt.replace(' ', 'T') + 'Z').toLocaleString('es-CO')}</span>
                  <span className="font-semibold text-ink">{JOB_STATUS[job.status]}</span>
                </li>))}</ul>
            ) : (
              <p className="text-sm text-muted flex items-center gap-2"><Clock size={16} /> Aún no hay trabajos. Aparecerán aquí cuando se activen los motores de fotos, video y creativos.</p>
            )}
          </section>

          <section className="card p-6 space-y-3">
            <h2 className="text-lg font-black text-ink">Capacidades de IA de la plataforma</h2>
            {!overview.aiEnabled && <p className="text-sm text-muted">La IA está desactivada para tu tienda. El Brand Kit funciona igual.</p>}
            <ul className="divide-y divide-line text-sm">{overview.tasks.map((task) => (
              <li key={task.task} className="flex items-center justify-between gap-3 py-2.5">
                <span className="text-ink">{task.label}</span>
                {task.available
                  ? <span className="flex items-center gap-1.5 font-semibold text-emerald-700"><CheckCircle2 size={15} /> Modelo configurado</span>
                  : <span className="text-muted">No disponible todavía</span>}
              </li>))}</ul>
          </section>
        </>
      )}
    </div>
  )
}
