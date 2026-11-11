import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Loader2, Trash2 } from 'lucide-react'
import { useAuth } from '../../../contexts/AuthContext'
import { creativePhotoApi, type CreativeAssetApi } from '../../../services/api'
import { BeforeAfter } from './AssetImage'

export const LEVEL_LABEL = { A: 'Edición convencional', B: 'Packshot', C: 'Composición premium' } as const
export const formatBytes = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`)
export const formatType = (type: string) => type.replace('image/', '').replace('jpeg', 'jpg').toUpperCase()

/** Un resultado con su antes/después y las decisiones del comercio: aprobar, asociar o descartar. */
export function ResultReview({ asset, operationLabels, products, onChange }: {
  asset: CreativeAssetApi
  operationLabels: Record<string, string>
  products: Array<{ id: number; name: string }>
  onChange: (asset: CreativeAssetApi) => void
}) {
  const { token } = useAuth()
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  const [target, setTarget] = useState('')

  const act = async (key: string, action: () => Promise<{ asset: CreativeAssetApi; message: string }>) => {
    if (!token) return
    setBusy(key); setError(''); setDone('')
    try { const result = await action(); onChange(result.asset); setDone(result.message) }
    catch (err) { setError(err instanceof Error ? err.message : 'No se pudo completar la acción.') }
    finally { setBusy('') }
  }
  const approve = (key: string, options: { attach?: 'principal' | 'agregar'; productId?: number }, message: string) =>
    act(key, async () => ({ asset: (await creativePhotoApi.approve(asset.id, token!, options)).asset, message }))
  const discard = () => act('discard', async () => ({ asset: await creativePhotoApi.discard(asset.id, token!), message: 'Descartado. Tu foto original no cambió.' }))

  const pending = asset.status === 'pendiente'
  const spinner = (key: string) => (busy === key ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />)

  return (
    <article className="card p-4 space-y-3">
      {asset.hasFile ? <BeforeAfter beforeId={asset.sourceAssetId} afterId={asset.id} /> : <div className="aspect-square w-full grid place-items-center rounded-btn bg-white text-sm text-muted">Descartado</div>}
      <div>
        <p className="font-bold text-ink">{asset.productName || (asset.telegramDraft ? 'Borrador de Telegram' : 'Foto sin producto')}</p>
        <p className="text-xs text-muted mt-0.5">
          {operationLabels[asset.operation || ''] || asset.operation} · {asset.level ? LEVEL_LABEL[asset.level] : ''}
          {asset.width && asset.height ? ` · ${asset.width}×${asset.height}` : ''} · {formatType(asset.contentType)} · {formatBytes(asset.bytes)}
          {asset.credits > 0 ? ` · ${asset.credits} créditos` : asset.level === 'A' ? ' · sin costo' : ' · sin créditos (límite mensual de IA)'}
        </p>
      </div>

      {pending && (
        <div className="flex flex-wrap gap-2">
          {asset.telegramDraft && <button type="button" className="btn-brand" disabled={Boolean(busy)} onClick={() => approve('principal', { attach: 'principal' }, 'Aprobada: el borrador de Telegram ahora usa esta foto.')}>{spinner('principal')} Usar en el borrador</button>}
          {asset.productId && <button type="button" className="btn-brand" disabled={Boolean(busy)} onClick={() => approve('principal', { attach: 'principal' }, 'Aprobada como foto principal. La foto anterior sigue en el producto.')}>{spinner('principal')} Foto principal</button>}
          {asset.productId && <button type="button" className="btn-ghost" disabled={Boolean(busy)} onClick={() => approve('agregar', { attach: 'agregar' }, 'Aprobada como foto adicional del producto.')}>{spinner('agregar')} Foto adicional</button>}
          <button type="button" className="btn-ghost" disabled={Boolean(busy)} onClick={() => approve('solo', {}, 'Aprobada y guardada en tu biblioteca.')}>{spinner('solo')} Solo guardar</button>
          <button type="button" className="btn-ghost text-red-700" disabled={Boolean(busy)} onClick={discard}>{busy === 'discard' ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />} Descartar</button>
        </div>
      )}

      {asset.status === 'aprobado' && (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-emerald-700">Aprobada · en tu biblioteca</p>
          <div className="flex flex-wrap items-center gap-2">
            <select className="input-field min-w-0 flex-1" aria-label="Producto" value={target} onChange={(event) => setTarget(event.target.value)}>
              <option value="">Usar en un producto…</option>
              {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
            </select>
            <button type="button" className="btn-ghost" disabled={!target || Boolean(busy)} onClick={() => approve('reuse', { attach: 'agregar', productId: Number(target) }, 'Foto agregada al producto.')}>{spinner('reuse')} Agregar</button>
          </div>
          {!asset.productId && asset.publicUrl && <Link className="text-sm font-semibold text-brand" to={`/admin/fotos?foto=${encodeURIComponent(asset.publicUrl)}`}>Crear un producto con esta foto</Link>}
        </div>
      )}

      {done && <p className="text-sm text-emerald-700" role="status">{done}</p>}
      {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
    </article>
  )
}
