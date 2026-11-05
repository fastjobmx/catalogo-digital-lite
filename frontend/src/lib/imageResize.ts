/** Shrinks large photos in the browser before uploading (the server accepts up to 5 MB). */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024

export async function prepareProductPhoto(file: File, maxSide = 1800): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Usa fotos JPG, PNG o WebP.')
  const bitmap = await createImageBitmap(file).catch(() => null)
  if (!bitmap) throw new Error('No se pudo abrir la foto.')
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  if (scale === 1 && file.size <= 1.5 * 1024 * 1024) { bitmap.close(); return file }
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.85))
  if (!blob || blob.size > MAX_UPLOAD_BYTES) throw new Error('La foto es demasiado grande incluso reducida.')
  return new File([blob], file.name.replace(/\.\w+$/, '') + '.webp', { type: 'image/webp' })
}
