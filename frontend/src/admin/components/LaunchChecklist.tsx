import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, Circle, ArrowRight, Rocket, Copy, Check } from 'lucide-react'
import { launchChecklistApi, type LaunchChecklist as Checklist } from '../../services/api'

/** «Listo para vender»: guided checklist with the next step highlighted. Data comes from the backend. */
export default function LaunchChecklist({ token, storeUrl }: { token: string | null; storeUrl: string }) {
  const [data, setData] = useState<Checklist | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!token) return
    let active = true
    launchChecklistApi.get(token).then((result) => { if (active) setData(result) }).catch(() => undefined)
    return () => { active = false }
  }, [token])

  if (!data || !data.total) return null
  const next = data.items.find((item) => !item.done)
  const percent = Math.round((data.done / data.total) * 100)

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(storeUrl); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { setCopied(false) }
  }

  return (
    <section className="card p-6" aria-labelledby="launch-title">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-btn bg-brand/10 text-brand"><Rocket size={20} aria-hidden="true" /></span>
          <div>
            <h2 id="launch-title" className="text-lg font-bold text-ink">{data.ready ? '¡Tu tienda está lista para vender!' : 'Deja tu tienda lista para vender'}</h2>
            <p className="text-sm text-muted">{data.done} de {data.total} pasos completados</p>
          </div>
        </div>
        <button type="button" onClick={() => void copyLink()} className="btn-ghost">
          {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />} {copied ? 'Enlace copiado' : 'Copiar el enlace de mi tienda'}
        </button>
      </div>
      <div className="mb-5 h-2 overflow-hidden rounded-full bg-canvas" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label="Avance de la tienda">
        <div className="h-full rounded-full bg-brand transition-[width] duration-500" style={{ width: `${percent}%` }} />
      </div>
      <ol className="grid gap-2 sm:grid-cols-2">
        {data.items.map((item) => {
          const isNext = item === next
          const external = item.path === '/'
          const body = (
            <>
              {item.done ? <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-emerald-600" aria-hidden="true" /> : <Circle size={20} className={`mt-0.5 shrink-0 ${isNext ? 'text-brand' : 'text-line'}`} aria-hidden="true" />}
              <span className="min-w-0 flex-1">
                <span className={`block font-semibold ${item.done ? 'text-muted line-through' : 'text-ink'}`}>{item.label}</span>
                {!item.done && <span className="block text-xs text-muted">{item.hint}</span>}
              </span>
              {!item.done && <ArrowRight size={16} className="mt-1 shrink-0 text-brand" aria-hidden="true" />}
            </>
          )
          const className = `flex items-start gap-3 rounded-btn border p-3 text-sm transition-colors ${isNext ? 'border-brand bg-brand/5' : 'border-line hover:border-brand/40'}`
          return (
            <li key={item.key}>
              {item.done
                ? <div className={className}>{body}<span className="sr-only">Completado</span></div>
                : external
                  ? <a href={storeUrl} target="_blank" rel="noopener noreferrer" className={className}>{body}</a>
                  : <Link to={item.path} className={className}>{body}</Link>}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
