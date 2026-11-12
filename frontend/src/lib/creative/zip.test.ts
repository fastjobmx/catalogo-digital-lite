import { describe, expect, it } from 'vitest'
import { ZipWriter, crc32 } from './zip'

/** Lee el directorio central de un ZIP (prueba independiente del escritor). */
async function readZip(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const view = new DataView(bytes.buffer)
  const end = bytes.length - 22
  expect(view.getUint32(end, true)).toBe(0x06054b50)
  const count = view.getUint16(end + 10, true)
  let p = view.getUint32(end + 16, true)
  const files: Array<{ name: string; crc: number; size: number; data: Uint8Array }> = []
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(p, true)).toBe(0x02014b50)
    const crc = view.getUint32(p + 16, true), size = view.getUint32(p + 24, true), nameLength = view.getUint16(p + 28, true), offset = view.getUint32(p + 42, true)
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLength))
    expect(view.getUint32(offset, true)).toBe(0x04034b50)
    const local = offset + 30 + view.getUint16(offset + 26, true)
    files.push({ name, crc, size, data: bytes.subarray(local, local + size) })
    p += 46 + nameLength
  }
  return files
}

describe('ZIP de lotes', () => {
  it('CRC-32 estándar', () => {
    expect(crc32(new TextEncoder().encode('abc'))).toBe(0x352441c2)
    expect(crc32(new Uint8Array())).toBe(0)
  })

  it('guarda los archivos íntegros, con nombres UTF-8 y carpetas, sin pisar nombres repetidos', async () => {
    const zip = new ZipWriter()
    await zip.add('LM-139-Puff/vertical.jpg', new Blob([new Uint8Array([1, 2, 3, 4])]))
    await zip.add('LM-139-Puff/vertical.jpg', new Blob([new Uint8Array([9])]))
    await zip.add('resumen.csv', new Blob(['producto;categoría\nPuff corazón;Sillas']))
    const files = await readZip(zip.finish())
    expect(files.map((file) => file.name)).toEqual(['LM-139-Puff/vertical.jpg', 'LM-139-Puff/vertical-2.jpg', 'resumen.csv'])
    expect([...files[0]!.data]).toEqual([1, 2, 3, 4])
    for (const file of files) expect(crc32(file.data)).toBe(file.crc)
    expect(new TextDecoder().decode(files[2]!.data)).toContain('Puff corazón')
  })
})
