import { useEffect, useRef, useState } from 'react'
import { ImageOff } from 'lucide-react'
import { isImageDecoded, localWebpSource, resolveImageUrl, shouldFallbackToOriginal } from '../lib/imageSources'

interface ProductImageProps {
  src: string | null
  alt: string
  ratio?: '1:1' | '4:5' | '4:3' | '16:9'
  sizes?: string
  className?: string
  imgClassName?: string
  priority?: boolean
}

const RATIO_CLASSES = {
  '1:1': 'aspect-square',
  '4:5': 'aspect-[4/5]',
  '4:3': 'aspect-[4/3]',
  '16:9': 'aspect-video',
}

export default function ProductImage({
  src,
  alt,
  ratio = '1:1',
  sizes = '(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw',
  className = '',
  imgClassName = '',
  priority = false,
}: ProductImageProps) {
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(false)
  const [webpEnabled, setWebpEnabled] = useState(true)
  const imageRef = useRef<HTMLImageElement>(null)

  useEffect(() => {
    setLoaded(false)
    setError(false)
    setWebpEnabled(true)
    const image = imageRef.current
    if (isImageDecoded(image)) {
      setLoaded(true)
    } else if (image?.complete) {
      if (shouldFallbackToOriginal(image.currentSrc, localWebpSource(resolveImageUrl(src)), true)) {
        setWebpEnabled(false)
      } else {
        setError(true)
      }
    }
  }, [src])

  const aspectClass = RATIO_CLASSES[ratio]
  const imageSrc = resolveImageUrl(src)

  // srcset para imágenes servidas por el Worker (R2 / assets locales).
  const isLocalAsset = imageSrc?.startsWith('/api/assets/')
  const srcSet = isLocalAsset && imageSrc
    ? `${imageSrc}${imageSrc.includes('?') ? '&' : '?'}w=300 300w, ${imageSrc}${imageSrc.includes('?') ? '&' : '?'}w=600 600w, ${imageSrc}${imageSrc.includes('?') ? '&' : '?'}w=1200 1200w`
    : undefined
  const webpSrc = localWebpSource(imageSrc)
  const imageAttemptKey = `${imageSrc}:${webpEnabled ? 'webp' : 'original'}`

  if (!imageSrc || error) {
    return (
      <div
        className={`${aspectClass} ${className} surface-muted flex items-center justify-center overflow-hidden`}
        role="img"
        aria-label={`${alt} — imagen no disponible`}
      >
        <div className="text-center px-4">
          <ImageOff size={22} className="mx-auto mb-2 text-muted/60" aria-hidden="true" />
          <span className="text-[10px] uppercase tracking-[0.16em] text-muted">Imagen no disponible</span>
        </div>
      </div>
    )
  }

  return (
    <div className={`${aspectClass} ${className} relative overflow-hidden surface-muted`}>
      {!loaded && (
        <div className="absolute inset-0 animate-pulse bg-gradient-to-r from-canvas via-line/60 to-canvas" />
      )}

      <picture className="absolute inset-0 block h-full w-full">
        {webpSrc && webpEnabled && <source type="image/webp" srcSet={webpSrc} />}
        <img
          key={imageAttemptKey}
          ref={imageRef}
          src={imageSrc}
          srcSet={srcSet}
          sizes={sizes}
          alt={alt}
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : 'auto'}
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={(event) => {
            if (shouldFallbackToOriginal(event.currentTarget.currentSrc, webpSrc, webpEnabled)) {
              setLoaded(false)
              setWebpEnabled(false)
              return
            }
            setError(true)
          }}
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ${loaded ? 'opacity-100' : 'opacity-0'} ${imgClassName}`}
        />
      </picture>
    </div>
  )
}
