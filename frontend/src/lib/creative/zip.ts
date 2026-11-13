/** Escritor ZIP mínimo (sin dependencias) para descargar lotes de piezas.
 *
 * Usa el método «store» (sin recompresión): JPG, PNG, WebP y MP4 ya vienen comprimidos, así que comprimir otra
 * vez no ahorra espacio y solo gastaría tiempo. Los archivos se guardan como Blob (el navegador puede tenerlos
 * fuera de la memoria de JavaScript) y el ZIP final es un Blob compuesto, sin copiar los bytes otra vez.
 * Nombres en UTF-8. Límite del formato clásico: 4 GB por ZIP y 65.535 archivos (el lote lo divide antes). */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

export function crc32(bytes: Uint8Array, crc = 0): number {
  let c = (crc ^ 0xffffffff) >>> 0
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

interface Entry { name: Uint8Array; crc: number; size: number; offset: number; time: number; date: number }

function dosDateTime(date: Date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { time, date: day }
}

export class ZipWriter {
  private parts: BlobPart[] = []
  private entries: Entry[] = []
  private offset = 0
  private names = new Set<string>()

  get size() { return this.offset }
  get count() { return this.entries.length }

  /** Agrega un archivo. Si el nombre se repite, se numera (no se pisa otro archivo). */
  async add(path: string, blob: Blob, when = new Date()): Promise<string> {
    let name = path.replace(/\\/g, '/').replace(/^\/+/, '')
    if (this.names.has(name)) {
      const dot = name.lastIndexOf('.')
      for (let i = 2; this.names.has(name); i++) name = dot > 0 ? `${path.slice(0, dot)}-${i}${path.slice(dot)}` : `${path}-${i}`
    }
    this.names.add(name)
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const crc = crc32(bytes)
    const encoded = new TextEncoder().encode(name)
    const { time, date } = dosDateTime(when)
    const header = new DataView(new ArrayBuffer(30))
    header.setUint32(0, 0x04034b50, true)
    header.setUint16(4, 20, true)
    header.setUint16(6, 0x0800, true) // nombres en UTF-8
    header.setUint16(8, 0, true) // store
    header.setUint16(10, time, true)
    header.setUint16(12, date, true)
    header.setUint32(14, crc, true)
    header.setUint32(18, bytes.length, true)
    header.setUint32(22, bytes.length, true)
    header.setUint16(26, encoded.length, true)
    header.setUint16(28, 0, true)
    this.parts.push(header.buffer, encoded, blob)
    this.entries.push({ name: encoded, crc, size: bytes.length, offset: this.offset, time, date })
    this.offset += 30 + encoded.length + bytes.length
    return name
  }

  /** Cierra el ZIP (directorio central) y devuelve el archivo. */
  finish(): Blob {
    const central: BlobPart[] = []
    let centralSize = 0
    for (const entry of this.entries) {
      const record = new DataView(new ArrayBuffer(46))
      record.setUint32(0, 0x02014b50, true)
      record.setUint16(4, 20, true)
      record.setUint16(6, 20, true)
      record.setUint16(8, 0x0800, true)
      record.setUint16(10, 0, true)
      record.setUint16(12, entry.time, true)
      record.setUint16(14, entry.date, true)
      record.setUint32(16, entry.crc, true)
      record.setUint32(20, entry.size, true)
      record.setUint32(24, entry.size, true)
      record.setUint16(28, entry.name.length, true)
      record.setUint32(42, entry.offset, true)
      central.push(record.buffer, entry.name)
      centralSize += 46 + entry.name.length
    }
    const end = new DataView(new ArrayBuffer(22))
    end.setUint32(0, 0x06054b50, true)
    end.setUint16(8, this.entries.length, true)
    end.setUint16(10, this.entries.length, true)
    end.setUint32(12, centralSize, true)
    end.setUint32(16, this.offset, true)
    return new Blob([...this.parts, ...central, end.buffer], { type: 'application/zip' })
  }
}
