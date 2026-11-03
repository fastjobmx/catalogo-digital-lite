// SQLite-backed D1 test double. It executes real SQL (constraints, triggers,
// JSON functions and foreign keys) so tenant isolation can be tested against the
// same migrations that run on Cloudflare D1.
import { DatabaseSync } from 'node:sqlite'
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export const MIGRATIONS_DIR = join(here, '..', '..', 'database', 'migrations')

function normalize(value) {
  if (value === undefined) throw new Error('D1_TYPE_ERROR: Type \'undefined\' not supported for value \'undefined\'')
  if (typeof value === 'boolean') return value ? 1 : 0
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  return value
}

function plain(row) {
  return row ? { ...row } : row
}

class Statement {
  constructor(database, sql, values = []) {
    this.database = database
    this.sql = sql
    this.values = values
  }

  bind(...values) {
    return new Statement(this.database, this.sql, values.map(normalize))
  }

  execute() {
    const statement = this.database.sqlite.prepare(this.sql)
    const returnsRows = statement.columns().length > 0
    if (returnsRows) {
      const rows = statement.all(...this.values).map(plain)
      const meta = this.database.sqlite.prepare('SELECT changes() AS changes, last_insert_rowid() AS id').get()
      return { rows, changes: Number(meta.changes), lastRowId: Number(meta.id) }
    }
    const result = statement.run(...this.values)
    return { rows: [], changes: Number(result.changes), lastRowId: Number(result.lastInsertRowid) }
  }

  result(output) {
    return { success: true, results: output.rows, meta: { changes: output.changes, last_row_id: output.lastRowId, rows_read: output.rows.length, rows_written: output.changes, duration: 0 } }
  }

  async first(column) {
    const output = this.execute()
    const row = output.rows[0] ?? null
    if (column) return row ? row[column] ?? null : null
    return row
  }

  async all() {
    return this.result(this.execute())
  }

  async run() {
    return this.result(this.execute())
  }

  async raw() {
    return this.execute().rows.map((row) => Object.values(row))
  }
}

export class SqliteD1 {
  constructor(path = ':memory:') {
    this.sqlite = new DatabaseSync(path)
    this.sqlite.exec('PRAGMA foreign_keys = ON')
    this.statements = []
  }

  prepare(sql) {
    this.statements.push(sql)
    return new Statement(this, sql)
  }

  async batch(statements) {
    this.sqlite.exec('BEGIN')
    try {
      const results = statements.map((statement) => statement.result(statement.execute()))
      this.sqlite.exec('COMMIT')
      return results
    } catch (error) {
      this.sqlite.exec('ROLLBACK')
      throw error
    }
  }

  async exec(sql) {
    this.sqlite.exec(sql)
    return { count: 1, duration: 0 }
  }

  /** Synchronous helper for assertions in tests. */
  query(sql, ...values) {
    return this.sqlite.prepare(sql).all(...values.map(normalize)).map(plain)
  }

  close() {
    this.sqlite.close()
  }
}

export function migrationFiles() {
  return readdirSync(MIGRATIONS_DIR).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort()
}

export function applyMigrations(db, { upTo } = {}) {
  for (const file of migrationFiles()) {
    if (upTo && file > upTo) break
    db.sqlite.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'))
  }
  return db
}

/** Fresh database with every migration and the primary store configured. */
export function createTestDatabase(options = {}) {
  const db = applyMigrations(new SqliteD1(), options)
  db.sqlite.exec("INSERT OR IGNORE INTO store_config (id, name, whatsapp_phone, currency) VALUES (1, 'SneakerHub Test', '+573000000000', 'COP')")
  return db
}

/** Minimal in-memory R2 bucket compatible with the calls used by the Worker. */
export class MemoryR2 {
  constructor() {
    this.objects = new Map()
  }

  async put(key, value, options = {}) {
    let bytes
    if (value instanceof Uint8Array) bytes = value
    else if (value instanceof ArrayBuffer) bytes = new Uint8Array(value)
    else if (typeof value === 'string') bytes = new TextEncoder().encode(value)
    else if (value && typeof value.arrayBuffer === 'function') bytes = new Uint8Array(await value.arrayBuffer())
    else bytes = new Uint8Array()
    const record = { key, bytes: new Uint8Array(bytes), httpMetadata: options.httpMetadata || {}, customMetadata: options.customMetadata || {}, uploaded: new Date() }
    this.objects.set(key, record)
    return this.wrap(record)
  }

  wrap(record) {
    return {
      key: record.key,
      size: record.bytes.byteLength,
      httpEtag: `"${record.bytes.byteLength}"`,
      httpMetadata: record.httpMetadata,
      customMetadata: record.customMetadata,
      uploaded: record.uploaded,
      body: new Blob([record.bytes]).stream(),
      arrayBuffer: async () => record.bytes.slice().buffer,
      writeHttpMetadata(headers) {
        if (record.httpMetadata.contentType) headers.set('content-type', record.httpMetadata.contentType)
      },
    }
  }

  async get(key) {
    const record = this.objects.get(key)
    return record ? this.wrap(record) : null
  }

  async head(key) {
    return this.get(key)
  }

  async delete(keys) {
    for (const key of Array.isArray(keys) ? keys : [keys]) this.objects.delete(key)
  }

  async list(options = {}) {
    const objects = [...this.objects.values()]
      .filter((record) => !options.prefix || record.key.startsWith(options.prefix))
      .map((record) => this.wrap(record))
    return { objects, truncated: false, delimitedPrefixes: [] }
  }
}

import { deflateSync } from 'node:zlib'

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  out.set(new TextEncoder().encode(type), 4)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

/** Valid RGB PNG used to exercise the real image validation path. */
export function createPng(width = 320, height = 240, rgb = [20, 20, 20]) {
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  header.set([8, 2, 0, 0, 0], 8)
  const raw = new Uint8Array((width * 3 + 1) * height)
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1)
    for (let x = 0; x < width; x++) raw.set(rgb, row + 1 + x * 3)
  }
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', new Uint8Array(deflateSync(raw))), chunk('IEND', new Uint8Array())]
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const png = new Uint8Array(total)
  let offset = 0
  for (const part of parts) { png.set(part, offset); offset += part.length }
  return png
}
