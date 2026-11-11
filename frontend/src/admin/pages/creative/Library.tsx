import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle, ArrowLeft, Download, Images, Loader2 } from 'lucide-react'
import { useAuth } from '../../../contexts/AuthContext'
import { ApiRequestError, creativePhotoApi, getProducts, type CreativeAssetApi, type PhotoCatalogApi } from '../../../services/api'
import { AssetImage, assetBlob } from './AssetImage'
import { LEVEL_LABEL, ResultReview, formatBytes, formatType } from './ResultReview'

type Filter = 'pendiente' | 'aprobado' | 'original'
const FILTERS: Array<[Filter, string]> = [['pendiente', 'Por revisar'], ['aprobado', 'Aprobadas'], ['original', 'Originales']]
const ORIGIN: Record<string, string> = { panel: 'Subida al panel', producto: 'Foto del catálogo', telegram: 'Importación de Telegram', navegador: 'Edición convencional', ia: 'Mejora con IA' }
const date = (value: string) => new Date(value.replace(' ', 'T') + 'Z').toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })

/** Biblioteca de recursos: originales privados y resultados, con su procesamiento, modelo, costo y estado. */
export default function Library() {
  const { token, isDemoSession } = useAuth()
  const [filter, setFilter] = useState<Filter>('pendiente')
  const [items, setItems] = useState<CreativeAssetApi[] | null>(null)
  const [products, setProducts] = useState<Array<{ id: number; name: string }>>([])
  const [catalog, setCatalog] = useState<PhotoCatalogApi | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!token) return
    setItems(null); setError('')
    try {
      const list = await creativePhotoApi.assets(token, filter === 'original' ? { role: 'original' } : { role: 'resultado', status: filter })
      setItems(list.items)
    } catch (err) {
      setError(err instanceof ApiRequestError && err.status === 403 ? 'Solo el propietario o un administrador de la tienda pueden ver la biblioteca.' : 'No se pudo cargar la biblioteca.')
    }
  }, [token, filter])
  useEffect(() => { if (!isDemoSession) void load() }, [load, isDemoSession])
  useEffect(() => {
    if (!token || isDemoSession) return
    getProducts().then((list) => setProducts(list.map((product) => ({ id: product.id, name: product.name })))).catch(() => setProducts([]))
    creativePhotoApi.catalog(token).then(setCatalog).catch(() => setCatalog(null))
  }, [token, isDemoSession])

  const labels = useMemo(() => Object.fromEntries((catalog?.operations ?? []).map((item) => [item.key, item.label])), [catalog])

  const download = async (asset: CreativeAssetApi) => {
    if (!token) return
    try {
      const url = URL.createObjectURL(await assetBlob(asset.id, token))
      const link = document.createElement('a')
      link.href = url
      link.download = `original-${asset.id.slice(0, 8)}.${formatType(asset.contentType).toLowerCase()}`
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 2000)
    } catch { setError('No se pudo descargar el original.') }
  }

  return (
    <div className="space-y-8 animate-fade-in">
      <div>
        <Link to="/admin/estudio-creativo" className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink mb-3"><ArrowLeft size={15} /> Estudio Creativo IA</Link>
        <div className="flex items-center gap-2 mb-2">
          <Images size={15} className="text-brand" />
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand/70">Estudio Creativo IA</span>
        </div>
        <h1 className="text-3xl font-black tracking-tight text-ink">Biblioteca de recursos</h1>
        <p className="text-muted text-sm mt-1.5">Tus fotos originales y las versiones mejoradas. Los originales son privados y no se modifican; las aprobadas se pueden usar en cualquier producto sin volver a subirlas.</p>
      </div>

      {isDemoSession && <p className="card p-4 text-sm text-muted">La biblioteca se muestra con la cuenta real de tu tienda.</p>}
      {error && <p className="card flex items-center gap-2 p-4 text-sm text-red-700" role="alert"><AlertCircle size={17} />{error}</p>}

      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Filtro de la biblioteca">
        {FILTERS.map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={filter === key} onClick={() => setFilter(key)}
            className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${filter === key ? 'border-brand bg-brand/10 text-ink' : 'border-line text-muted hover:text-ink'}`}>{label}</button>
        ))}
        <Link to="/admin/estudio-creativo/fotos" className="btn-brand ml-auto">Mejorar fotos</Link>
      </div>

      {!items && !error && !isDemoSession && <p className="flex items-center gap-2 text-sm text-muted"><Loader2 size={16} className="animate-spin" /> Cargando…</p>}
      {items && !items.length && (
        <p className="card p-6 text-sm text-muted">
          {filter === 'pendiente' ? 'No tienes resultados por revisar.' : filter === 'aprobado' ? 'Aún no has aprobado ninguna foto.' : 'Aún no hay originales. Se guardan aquí cuando eliges o subes fotos en el estudio fotográfico.'}
        </p>
      )}

      {items && items.length > 0 && filter !== 'original' && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((asset) => (
            <div key={asset.id} className="space-y-1.5">
              <ResultReview asset={asset} operationLabels={labels} products={products} onChange={(next) => setItems((current) => current && current.map((item) => item.id === next.id ? next : item))} />
              <p className="px-1 text-xs text-muted">{date(asset.createdAt)} · {ORIGIN[asset.origin] || asset.origin}{asset.model ? ` · modelo ${asset.model}` : ''}</p>
            </div>
          ))}
        </div>
      )}

      {items && items.length > 0 && filter === 'original' && (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
          {items.map((asset) => (
            <li key={asset.id} className="card p-3 space-y-2">
              <AssetImage id={asset.id} alt={asset.productName || 'Foto original'} className="aspect-square w-full rounded-btn object-contain" />
              <div>
                <p className="truncate text-sm font-bold text-ink">{asset.productName || 'Sin producto'}</p>
                <p className="text-xs text-muted">{asset.width && asset.height ? `${asset.width}×${asset.height} · ` : ''}{formatType(asset.contentType)} · {formatBytes(asset.bytes)}</p>
                <p className="text-xs text-muted">{date(asset.createdAt)} · {ORIGIN[asset.origin] || asset.origin}</p>
              </div>
              <button type="button" className="btn-ghost w-full justify-center" onClick={() => void download(asset)}><Download size={15} /> Descargar original</button>
            </li>
          ))}
        </ul>
      )}
      {items && items.length > 0 && <p className="text-xs text-muted">{LEVEL_LABEL.A}: sin costo. {LEVEL_LABEL.B} y {LEVEL_LABEL.C}: usan Créditos IA; el costo de cada foto aparece en su ficha.</p>}
    </div>
  )
}
