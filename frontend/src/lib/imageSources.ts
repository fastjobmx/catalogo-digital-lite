/** Resolves saved local/R2 paths from the site root and accepts secure external URLs. */
export function resolveImageUrl(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const source = value.trim()
  if (!source || /[\\\u0000-\u001f]/.test(source)) return null

  if (/^https:\/\//i.test(source)) {
    try {
      const url = new URL(source)
      return url.protocol === 'https:' ? url.href : null
    } catch {
      return null
    }
  }

  // Reject insecure remote URLs, protocol-relative URLs and traversal.
  if (/^[a-z][a-z\d+.-]*:/i.test(source) || source.startsWith('//')) return null
  const path = source.split(/[?#]/, 1)[0] || ''
  if (path.split('/').some((segment) => segment === '..')) return null

  const cleanPath = source.replace(/^\.\//, '')
  return cleanPath.startsWith('/') ? cleanPath : `/${cleanPath}`
}

/** Returns the local WebP derivative for a known seed JPEG; all other URLs keep their source. */
export function localWebpSource(src: string | null | undefined): string | null {
  const resolved = resolveImageUrl(src)
  if (!resolved || !resolved.startsWith('/seed-images/')) return null
  if (!/\.jpe?g(?=$|[?#])/i.test(resolved)) return null
  return resolved.replace(/\.jpe?g(?=$|[?#])/i, '.webp')
}

/** Retry the stored JPEG once when the selected local WebP request fails. */
export function shouldFallbackToOriginal(
  currentSrc: string,
  webpSrc: string | null,
  webpEnabled: boolean,
): boolean {
  if (!webpEnabled || !webpSrc) return false
  const selectedPath = currentSrc.split(/[?#]/, 1)[0] || ''
  return selectedPath.toLowerCase().endsWith('.webp')
}

/** Covers cached images whose load event fired before the component effect ran. */
export function isImageDecoded(
  image: Pick<HTMLImageElement, 'complete' | 'naturalWidth'> | null | undefined,
): boolean {
  return Boolean(image?.complete && image.naturalWidth > 0)
}

