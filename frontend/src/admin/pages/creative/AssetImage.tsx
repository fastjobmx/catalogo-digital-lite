import { useEffect, useRef, useState } from 'react'
import { ImageOff, Loader2 } from 'lucide-react'
import { useAuth } from '../../../contexts/AuthContext'
import { creativePhotoApi } from '../../../services/api'

/** Los archivos de la biblioteca son privados: se piden con la sesión y se muestran desde memoria. */
const cache = new Map<string, Promise<Blob>>()
export function assetBlob(id: string, token: string): Promise<Blob> {
  let pending = cache.get(id)
  if (!pending) {
    pending = creativePhotoApi.file(id, token)
    cache.set(id, pending)
    pending.catch(() => cache.delete(id))
    if (cache.size > 80) cache.delete(cache.keys().next().value as string)
  }
  return pending
}

export function useAssetUrl(id: string | null | undefined): { url: string | null; failed: boolean } {
  const { token } = useAuth()
  const [state, setState] = useState<{ url: string | null; failed: boolean }>({ url: null, failed: false })
  useEffect(() => {
    if (!id || !token) { setState({ url: null, failed: false }); return }
    let objectUrl: string | null = null
    let cancelled = false
    setState({ url: null, failed: false })
    assetBlob(id, token)
      .then((blob) => { if (cancelled) return; objectUrl = URL.createObjectURL(blob); setState({ url: objectUrl, failed: false }) })
      .catch(() => { if (!cancelled) setState({ url: null, failed: true }) })
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [id, token])
  return state
}

export function AssetImage({ id, alt, className = '' }: { id: string | null | undefined; alt: string; className?: string }) {
  const { url, failed } = useAssetUrl(id)
  if (url) return <img src={url} alt={alt} className={className} draggable={false} />
  return (
    <div className={`grid place-items-center bg-white text-muted ${className}`} role="img" aria-label={failed ? 'Imagen no disponible' : 'Cargando imagen'}>
      {failed || !id ? <ImageOff size={20} aria-hidden="true" /> : <Loader2 size={20} className="animate-spin" aria-hidden="true" />}
    </div>
  )
}

/** Comparación antes/después con un divisor que se arrastra o se mueve con el teclado. */
export function BeforeAfter({ beforeId, afterId }: { beforeId: string | null; afterId: string }) {
  const before = useAssetUrl(beforeId)
  const after = useAssetUrl(afterId)
  const [position, setPosition] = useState(50)
  const box = useRef<HTMLDivElement>(null)
  const move = (clientX: number) => {
    const rect = box.current?.getBoundingClientRect()
    if (rect?.width) setPosition(Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100)))
  }
  if (!after.url || (beforeId && !before.url)) {
    return <div className="aspect-square w-full grid place-items-center rounded-btn bg-white text-muted">{after.failed || before.failed ? <ImageOff size={22} /> : <Loader2 size={22} className="animate-spin" />}</div>
  }
  if (!before.url) return <img src={after.url} alt="Resultado" className="aspect-square w-full rounded-btn bg-white object-contain" />
  return (
    <div
      ref={box}
      className="relative aspect-square w-full touch-none select-none overflow-hidden rounded-btn bg-white"
      onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); move(event.clientX) }}
      onPointerMove={(event) => { if (event.buttons === 1) move(event.clientX) }}
    >
      <img src={after.url} alt="Después" className="absolute inset-0 h-full w-full object-contain" draggable={false} />
      <img src={before.url} alt="Antes" className="absolute inset-0 h-full w-full object-contain" style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }} draggable={false} />
      <span className="absolute left-2 top-2 rounded-full bg-black/65 px-2 py-0.5 text-[11px] font-bold text-white">Antes</span>
      <span className="absolute right-2 top-2 rounded-full bg-black/65 px-2 py-0.5 text-[11px] font-bold text-white">Después</span>
      <div className="absolute inset-y-0 w-0.5 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.35)]" style={{ left: `${position}%` }} aria-hidden="true" />
      <input
        type="range" min={0} max={100} value={Math.round(position)} onChange={(event) => setPosition(Number(event.target.value))}
        aria-label="Comparar antes y después" className="absolute inset-x-2 bottom-2 h-6 cursor-ew-resize opacity-0 focus-visible:opacity-100"
      />
    </div>
  )
}
