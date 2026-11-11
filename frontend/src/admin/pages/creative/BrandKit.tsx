import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle, ArrowLeft, CheckCircle2, Loader2, Palette, Plus, Save, Upload, X } from 'lucide-react'
import { useAuth } from '../../../contexts/AuthContext'
import { ApiRequestError, creativeApi, uploadImage, type BrandKitApi, type BrandKitResponse } from '../../../services/api'

type Draft = Omit<BrandKitApi, 'updatedBy' | 'updatedAt'>

/** Brand Kit del comercio. Empieza vacío: solo se guarda lo que el comercio escribe. */
export default function BrandKit() {
  const { token, isDemoSession } = useAuth()
  const [data, setData] = useState<BrandKitResponse | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [newColor, setNewColor] = useState('#000000')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)

  const load = async () => {
    if (!token) return
    try {
      const response = await creativeApi.brandKit(token)
      setData(response); setDraft(response.kit); setError('')
    } catch (err) {
      setError(err instanceof ApiRequestError && err.status === 403 ? 'Solo el propietario o un administrador de la tienda pueden editar el Brand Kit.' : 'No se pudo cargar el Brand Kit.')
    }
  }
  useEffect(() => { if (!isDemoSession) void load() }, [token, isDemoSession]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => { setDraft((d) => d && { ...d, [key]: value }); setSaved(false) }
  const toggle = (key: 'fonts' | 'visualStyles', value: string, max: number) => {
    if (!draft) return
    const list = draft[key]
    if (list.includes(value)) set(key, list.filter((v) => v !== value))
    else if (list.length < max) set(key, [...list, value])
  }

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!token || !draft) return
    setBusy(true); setError(''); setSaved(false)
    try {
      const { favoriteTemplates: _unused, ...patch } = draft
      const { kit } = await creativeApi.saveBrandKit(patch, token)
      setDraft(kit); setData((d) => d && { ...d, kit }); setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el Brand Kit.')
    } finally { setBusy(false) }
  }

  const uploadLogo = async (file: File | undefined) => {
    if (!file || !token) return
    setUploading(true); setError('')
    try { set('logoUrl', (await uploadImage(file, 'store', token)).url) }
    catch (err) { setError(err instanceof Error ? err.message : 'No se pudo subir el logo.') }
    finally { setUploading(false) }
  }

  return (
    <div className="space-y-8 animate-fade-in max-w-3xl">
      <div>
        <Link to="/admin/estudio-creativo" className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink mb-3"><ArrowLeft size={15} /> Estudio Creativo IA</Link>
        <div className="flex items-center gap-2 mb-2">
          <Palette size={15} className="text-brand" />
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand/70">Estudio Creativo IA</span>
        </div>
        <h1 className="text-3xl font-black tracking-tight text-ink">Brand Kit</h1>
        <p className="text-muted text-sm mt-1.5">La identidad de tu marca para todo lo que crees en el estudio. Nada se completa solo: escribe únicamente datos reales de tu negocio.</p>
      </div>

      {isDemoSession && <p className="card p-4 text-sm text-muted">El Brand Kit se edita cuando entras con la cuenta real de tu tienda.</p>}
      {error && <p className="card flex items-center gap-2 p-4 text-sm text-red-700" role="alert"><AlertCircle size={17} />{error}</p>}
      {!draft && !error && !isDemoSession && <p className="flex items-center gap-2 text-sm text-muted"><Loader2 size={16} className="animate-spin" /> Cargando…</p>}

      {draft && data && (
        <form onSubmit={save} className="space-y-6">
          <section className="card p-6 space-y-4">
            <h2 className="text-lg font-black text-ink">Marca</h2>
            <label className="block text-sm font-semibold text-ink">Nombre de marca
              <input className="input-field w-full mt-1" maxLength={80} value={draft.brandName ?? ''} onChange={(e) => set('brandName', e.target.value)} placeholder={data.hints.name ?? ''} />
            </label>
            {!draft.brandName && data.hints.name && <button type="button" className="text-sm font-semibold text-brand" onClick={() => set('brandName', data.hints.name)}>Usar el nombre de la tienda: {data.hints.name}</button>}
            <label className="block text-sm font-semibold text-ink">Eslogan
              <input className="input-field w-full mt-1" maxLength={140} value={draft.slogan ?? ''} onChange={(e) => set('slogan', e.target.value)} />
            </label>
            <label className="block text-sm font-semibold text-ink">Tono de comunicación
              <select className="input-field w-full mt-1" value={draft.tone ?? ''} onChange={(e) => set('tone', e.target.value || null)}>
                <option value="">Sin definir</option>
                {Object.entries(data.options.tones).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
            </label>
            <label className="block text-sm font-semibold text-ink">Público objetivo
              <textarea className="input-field w-full mt-1 min-h-[90px]" maxLength={400} value={draft.targetAudience ?? ''} onChange={(e) => set('targetAudience', e.target.value)} placeholder="¿A quién le vendes? Edad, ciudad, intereses…" />
            </label>
          </section>

          <section className="card p-6 space-y-4">
            <h2 className="text-lg font-black text-ink">Logotipo</h2>
            <div className="flex flex-wrap items-center gap-4">
              {draft.logoUrl
                ? <img src={draft.logoUrl} alt="Logotipo de la marca" className="h-20 w-20 rounded-btn border border-line object-contain bg-white" />
                : <div className="h-20 w-20 rounded-btn border border-dashed border-line grid place-items-center text-xs text-muted">Sin logo</div>}
              <label className="btn-ghost cursor-pointer">
                {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />} Subir logo
                <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => void uploadLogo(e.target.files?.[0])} />
              </label>
              {!draft.logoUrl && data.hints.logoUrl && <button type="button" className="text-sm font-semibold text-brand" onClick={() => set('logoUrl', data.hints.logoUrl)}>Usar el logo de Apariencia</button>}
              {draft.logoUrl && <button type="button" className="text-sm font-semibold text-muted hover:text-red-700" onClick={() => set('logoUrl', null)}>Quitar</button>}
            </div>
          </section>

          <section className="card p-6 space-y-4">
            <h2 className="text-lg font-black text-ink">Colores <span className="text-sm font-semibold text-muted">(hasta 6)</span></h2>
            <div className="flex flex-wrap items-center gap-2">
              {draft.colors.map((color) => (
                <span key={color} className="inline-flex items-center gap-2 rounded-full border border-line pl-1 pr-2 py-1 text-xs font-semibold text-ink">
                  <span className="h-6 w-6 rounded-full border border-line" style={{ backgroundColor: color }} aria-hidden="true" />{color}
                  <button type="button" aria-label={`Quitar ${color}`} onClick={() => set('colors', draft.colors.filter((c) => c !== color))}><X size={13} /></button>
                </span>
              ))}
              {draft.colors.length < 6 && (
                <span className="inline-flex items-center gap-2">
                  <input type="color" aria-label="Elegir color" value={newColor} onChange={(e) => setNewColor(e.target.value)} className="h-9 w-12 rounded border border-line" />
                  <button type="button" className="btn-ghost" onClick={() => { const c = newColor.toUpperCase(); if (!draft.colors.includes(c)) set('colors', [...draft.colors, c]) }}><Plus size={15} /> Agregar</button>
                </span>
              )}
            </div>
            {data.hints.primaryColor && !draft.colors.includes(data.hints.primaryColor.toUpperCase()) && draft.colors.length < 6 && /^#[0-9a-fA-F]{6}$/.test(data.hints.primaryColor) && (
              <button type="button" className="text-sm font-semibold text-brand" onClick={() => set('colors', [...draft.colors, data.hints.primaryColor!.toUpperCase()])}>Agregar el color principal de Apariencia ({data.hints.primaryColor})</button>
            )}
          </section>

          <section className="card p-6 space-y-4">
            <h2 className="text-lg font-black text-ink">Tipografías permitidas <span className="text-sm font-semibold text-muted">(hasta 3)</span></h2>
            <div className="flex flex-wrap gap-2">{data.options.fonts.map((font) => (
              <button type="button" key={font} aria-pressed={draft.fonts.includes(font)} onClick={() => toggle('fonts', font, 3)}
                className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${draft.fonts.includes(font) ? 'border-brand bg-brand/10 text-ink' : 'border-line text-muted hover:text-ink'}`}>{font}</button>
            ))}</div>
            <h2 className="text-lg font-black text-ink pt-2">Estilos visuales <span className="text-sm font-semibold text-muted">(hasta 5)</span></h2>
            <div className="flex flex-wrap gap-2">{Object.entries(data.options.visualStyles).map(([key, label]) => (
              <button type="button" key={key} aria-pressed={draft.visualStyles.includes(key)} onClick={() => toggle('visualStyles', key, 5)}
                className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${draft.visualStyles.includes(key) ? 'border-brand bg-brand/10 text-ink' : 'border-line text-muted hover:text-ink'}`}>{label}</button>
            ))}</div>
          </section>

          <section className="card p-6 space-y-2">
            <h2 className="text-lg font-black text-ink">Plantillas favoritas</h2>
            <p className="text-sm text-muted">Próximamente: podrás marcar tus plantillas favoritas cuando el estudio tenga su catálogo de plantillas.</p>
          </section>

          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className="btn-brand" disabled={busy}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Guardar Brand Kit</button>
            {saved && <span className="flex items-center gap-1.5 text-sm font-semibold text-emerald-700" role="status"><CheckCircle2 size={16} /> Guardado</span>}
            {data.kit.updatedAt && <span className="text-xs text-muted">Última edición: {data.kit.updatedBy}</span>}
          </div>
        </form>
      )}
    </div>
  )
}
