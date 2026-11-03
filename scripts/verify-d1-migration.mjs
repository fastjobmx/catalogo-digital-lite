#!/usr/bin/env node
// Verifica migraciones pendientes sobre una COPIA local de un volcado D1.
// Nunca se conecta a Cloudflare ni modifica el archivo de entrada.
//
// Uso:
//   node scripts/verify-d1-migration.mjs <volcado.sql> [--rollback]
//
// Comprueba: integridad SQLite, claves foráneas, conteos por tabla, contenido
// de cada fila previa (excluyendo columnas nuevas) y que todo quede en la
// tienda 1. Con --rollback aplica también el script de reversión y verifica
// que los datos vuelvan a ser idénticos. Solo imprime agregados y hashes.
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const migrationsDir = join(root, 'database', 'migrations')
const rollbackDir = join(root, 'database', 'rollback')
const [dumpPath, ...flags] = process.argv.slice(2)
if (!dumpPath || !existsSync(dumpPath)) {
  console.error('Uso: node scripts/verify-d1-migration.mjs <volcado.sql> [--rollback]')
  process.exit(2)
}

const TRACKED = ['store_config', 'categories', 'products', 'product_variants', 'orders', 'order_events', 'order_inventory_operations', 'audit_log', 'telegram_operations']
const NEW_COLUMNS = new Set(['store_id'])

function open() {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  return db
}

function tables(db) {
  return new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name))
}

function snapshot(db) {
  const present = tables(db)
  const result = {}
  for (const table of TRACKED) {
    if (!present.has(table)) continue
    const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name).filter((name) => !NEW_COLUMNS.has(name)).sort()
    const rows = db.prepare(`SELECT ${columns.map((c) => `"${c}"`).join(', ')} FROM ${table} ORDER BY rowid`).all()
    const hash = createHash('sha256')
    for (const row of rows) hash.update(JSON.stringify(columns.map((c) => row[c])))
    result[table] = { count: rows.length, sha256: hash.digest('hex').slice(0, 16), columns }
  }
  return result
}

function check(db, label) {
  const integrity = db.prepare('PRAGMA integrity_check').all().map((row) => Object.values(row)[0])
  const fk = db.prepare('PRAGMA foreign_key_check').all()
  const ok = integrity.length === 1 && integrity[0] === 'ok' && fk.length === 0
  console.log(`${ok ? '✔' : '✖'} ${label}: integrity=${integrity.join(';')} foreign_key_violations=${fk.length}`)
  return ok
}

function compare(before, after, label) {
  let ok = true
  for (const [table, info] of Object.entries(before)) {
    const next = after[table]
    // Compara solo las columnas que existían antes.
    const same = next && next.count === info.count && next.sha256 === info.sha256
    if (!same) ok = false
    console.log(`${same ? '✔' : '✖'} ${label} ${table}: ${info.count} → ${next?.count ?? 'falta'} filas, hash ${info.sha256} → ${next?.sha256 ?? '-'}`)
  }
  return ok
}

function snapshotWithColumns(db, reference) {
  const result = {}
  for (const [table, info] of Object.entries(reference)) {
    const rows = db.prepare(`SELECT ${info.columns.map((c) => `"${c}"`).join(', ')} FROM ${table} ORDER BY rowid`).all()
    const hash = createHash('sha256')
    for (const row of rows) hash.update(JSON.stringify(info.columns.map((c) => row[c])))
    result[table] = { count: rows.length, sha256: hash.digest('hex').slice(0, 16), columns: info.columns }
  }
  return result
}

const db = open()
// El volcado de D1 incluye PRAGMA defer_foreign_keys y su propio ledger.
db.exec(readFileSync(dumpPath, 'utf8'))
const applied = new Set(tables(db).has('d1_migrations') ? db.prepare('SELECT name FROM d1_migrations').all().map((row) => row.name) : [])
const pending = readdirSync(migrationsDir).filter((name) => /^\d{4}_.+\.sql$/.test(name) && !applied.has(name)).sort()
console.log(`Volcado cargado. Migraciones registradas: ${applied.size}. Pendientes: ${pending.join(', ') || 'ninguna'}`)
let ok = check(db, 'antes')
const before = snapshot(db)
const sequenceBefore = Object.fromEntries(db.prepare('SELECT name, seq FROM sqlite_sequence').all().map((row) => [row.name, row.seq]))

for (const file of pending) {
  db.exec('BEGIN')
  try {
    db.exec(readFileSync(join(migrationsDir, file), 'utf8'))
    db.prepare('INSERT INTO d1_migrations (name) VALUES (?)').run(file)
    db.exec('COMMIT')
    console.log(`✔ aplicada ${file}`)
  } catch (error) {
    db.exec('ROLLBACK')
    console.log(`✖ falló ${file}: ${error.message}`)
    process.exit(1)
  }
}

ok = check(db, 'después') && ok
ok = compare(before, snapshotWithColumns(db, before), 'datos') && ok
for (const table of ['categories', 'products', 'orders', 'audit_log', 'telegram_operations']) {
  if (!tables(db).has(table)) continue
  const foreign = db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE store_id IS NOT 1`).get().n
  console.log(`${foreign === 0 ? '✔' : '✖'} ${table}: filas fuera de la tienda 1 = ${foreign}`)
  if (foreign) ok = false
}
const store = db.prepare('SELECT id, slug, status, plan_code FROM stores WHERE id = 1').get()
console.log(`${store ? '✔' : '✖'} tienda principal: id=${store?.id} slug=${store?.slug} estado=${store?.status} plan=${store?.plan_code}`)
if (!store) ok = false
const sequenceAfter = Object.fromEntries(db.prepare('SELECT name, seq FROM sqlite_sequence').all().map((row) => [row.name, row.seq]))
for (const [name, seq] of Object.entries(sequenceBefore)) {
  const kept = (sequenceAfter[name] ?? 0) >= seq
  console.log(`${kept ? '✔' : '✖'} secuencia ${name}: ${seq} → ${sequenceAfter[name]}`)
  if (!kept) ok = false
}
const triggers = db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name").all().map((row) => row.name)
console.log(`✔ disparadores: ${triggers.join(', ')}`)

if (flags.includes('--rollback')) {
  const rollbackFiles = pending.slice().reverse().map((file) => join(rollbackDir, file.replace(/\.sql$/, '.down.sql')))
  for (const file of rollbackFiles) {
    if (!existsSync(file)) { console.log(`✖ falta script de reversión ${file}`); ok = false; continue }
    db.exec('BEGIN')
    try {
      db.exec(readFileSync(file, 'utf8'))
      db.exec('COMMIT')
      console.log(`✔ reversión aplicada ${file.split(/[\\/]/).pop()}`)
    } catch (error) {
      db.exec('ROLLBACK')
      console.log(`✖ reversión falló: ${error.message}`)
      ok = false
    }
  }
  ok = check(db, 'tras reversión') && ok
  ok = compare(before, snapshotWithColumns(db, before), 'reversión') && ok
  const leftovers = ['stores', 'platform_users', 'store_memberships'].filter((table) => tables(db).has(table))
  console.log(`${leftovers.length ? '✖' : '✔'} tablas de plataforma retiradas: ${leftovers.length ? leftovers.join(', ') : 'sí'}`)
  if (leftovers.length) ok = false
}

console.log(ok ? '\nRESULTADO: OK' : '\nRESULTADO: FALLÓ')
process.exit(ok ? 0 : 1)
