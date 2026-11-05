#!/usr/bin/env node
// Restablece el correo y la contraseña del SUPERADMINISTRADOR de producción (Worker catalogo-lite-api).
//
//   node scripts/set-superadmin.mjs            # pide los datos y actualiza los secretos
//   node scripts/set-superadmin.mjs --dry-run  # solo valida, no sube nada
//
// - La contraseña se escribe oculta y nunca se guarda ni se muestra: solo se sube su hash
//   PBKDF2-SHA256 (el mismo formato que valida worker/src/services/auth.ts).
// - Sube ADMIN_EMAIL y ADMIN_PASSWORD_HASH juntos con `wrangler secret bulk` (una sola versión).
// - Antes de subir comprueba el formato que exige producción; si algo no cumple, no cambia nada,
//   porque un secreto mal formado bloquearía el inicio de sesión de todos los paneles.
// - El correo no debe pertenecer a un propietario o empleado de una tienda: ese correo pasaría a
//   entrar como superadministrador y perdería su acceso normal.
import { spawnSync } from 'node:child_process'
import { webcrypto } from 'node:crypto'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const WORKER = join(ROOT, 'worker')
const WRANGLER = join(WORKER, 'node_modules', 'wrangler', 'bin', 'wrangler.js')
const CONFIG = 'wrangler.production.toml'
const DB = 'catalogo-lite-production-db'
const ITERATIONS = 100_000 // límite de PBKDF2 en Cloudflare Workers
const DRY_RUN = process.argv.includes('--dry-run')

const fail = (message) => { console.error(`\n✖ ${message}\nNo se cambió nada.`); process.exit(1) }

// ---- entrada (oculta en terminal; por líneas si stdin no es una terminal, para pruebas) ----
const pipedLines = process.stdin.isTTY ? null : (await new Promise((resolve) => {
  let data = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk) => { data += chunk })
  process.stdin.on('end', () => resolve(data.split(/\r?\n/)))
}))
function ask(question, { hidden = false } = {}) {
  if (pipedLines) { process.stdout.write(`${question}\n`); return Promise.resolve((pipedLines.shift() || '').trim()) }
  return new Promise((resolve) => {
    process.stdout.write(question)
    const stdin = process.stdin
    let value = ''
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')
    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === '\u0003') { process.stdout.write('\n'); process.exit(130) }
        if (char === '\r' || char === '\n') {
          stdin.setRawMode(false); stdin.pause(); stdin.off('data', onData)
          process.stdout.write('\n')
          resolve(value.trim())
          return
        }
        if (char === '\u007f' || char === '\b') {
          if (value.length) { value = value.slice(0, -1); if (!hidden) process.stdout.write('\b \b') }
          continue
        }
        value += char
        process.stdout.write(hidden ? '' : char)
      }
    }
    stdin.on('data', onData)
  })
}

// ---- validaciones (las mismas reglas de producción de auth.ts) ----
function checkEmail(email) {
  const normalized = email.trim().toLowerCase()
  if (!/^[^\s@'"]+@[^\s@'"]+\.[^\s@'"]+$/.test(normalized)) return 'El correo no es válido.'
  if (/(?:@example\.(?:com|org|net)$|@localhost$|\.local$|demo|test|placeholder|change[-_ ]?me)/i.test(normalized)) {
    return 'Producción no acepta ese correo (no puede contener demo, test, placeholder ni ser de ejemplo).'
  }
  return null
}
function checkPassword(password) {
  if (password.length < 12) return 'La contraseña debe tener al menos 12 caracteres.'
  if (!/[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(password) || !/\d/.test(password)) return 'La contraseña debe combinar letras y números.'
  if (new Set(password).size < 6) return 'La contraseña repite demasiado los mismos caracteres.'
  return null
}

const b64url = (bytes) => Buffer.from(bytes).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
async function derive(password, salt, iterations, bits) {
  const key = await webcrypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  return new Uint8Array(await webcrypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, bits))
}
async function hashPassword(password) {
  const salt = webcrypto.getRandomValues(new Uint8Array(18))
  return `pbkdf2_sha256$${ITERATIONS}$${b64url(salt)}$${b64url(await derive(password, salt, ITERATIONS, 256))}`
}
async function verify(password, encoded) {
  const [, iterations, saltText, hashText] = encoded.split('$')
  const salt = Buffer.from(saltText.replaceAll('-', '+').replaceAll('_', '/'), 'base64')
  const expected = Buffer.from(hashText.replaceAll('-', '+').replaceAll('_', '/'), 'base64')
  const actual = await derive(password, salt, Number(iterations), expected.length * 8)
  return Buffer.compare(Buffer.from(actual), expected) === 0
}

function wrangler(args, input) {
  return spawnSync(process.execPath, [WRANGLER, ...args], { cwd: WORKER, input, encoding: 'utf8', env: { ...process.env, CI: '1' }, maxBuffer: 16 * 1024 * 1024 })
}

// ---- flujo ----
console.log(`\nRestablecer el superadministrador de producción${DRY_RUN ? ' (prueba: no se sube nada)' : ''}\n`)
if (!DRY_RUN && !existsSync(WRANGLER)) fail('No encuentro Wrangler en worker/node_modules. Ejecuta "npm install" en la carpeta worker.')

const email = (await ask('Correo del superadministrador: ')).toLowerCase()
const emailError = checkEmail(email)
if (emailError) fail(emailError)

if (!DRY_RUN) {
  const sql = `SELECT COUNT(*) AS n FROM platform_users WHERE lower(email) = '${email.replaceAll("'", "''")}'`
  const lookup = wrangler(['d1', 'execute', DB, '--remote', '--config', CONFIG, '--json', '--command', sql])
  if (lookup.status !== 0) fail('No pude comprobar el correo en la base de datos. Revisa tu sesión de Wrangler (npx wrangler login).')
  const count = JSON.parse(lookup.stdout.slice(lookup.stdout.indexOf('[')))[0]?.results?.[0]?.n ?? 0
  if (count > 0) fail('Ese correo ya es el de un propietario o empleado de una tienda. Usa otro, por ejemplo con un alias: nombre+admin@gmail.com.')
}

const password = await ask('Contraseña nueva (no se muestra): ', { hidden: true })
const passwordError = checkPassword(password)
if (passwordError) fail(passwordError)
const repeat = await ask('Repite la contraseña: ', { hidden: true })
if (repeat !== password) fail('Las contraseñas no coinciden.')

const hash = await hashPassword(password)
if (!/^pbkdf2_sha256\$\d{6,}\$[A-Za-z0-9_-]{16,}\$[A-Za-z0-9_-]{40,}$/.test(hash) || !(await verify(password, hash))) fail('No se pudo generar un hash válido.')
console.log('✔ Correo y contraseña válidos; hash PBKDF2 generado y comprobado.')

if (DRY_RUN) { console.log('Prueba terminada: no se subió nada.'); process.exit(0) }

const confirm = await ask(`Se reemplazará el superadministrador de producción por ${email}. Escribe SI para continuar: `)
if (confirm !== 'SI') fail('Cancelado.')

const upload = wrangler(['secret', 'bulk', '--config', CONFIG], JSON.stringify({ ADMIN_EMAIL: email, ADMIN_PASSWORD_HASH: hash }))
if (upload.status !== 0) fail(`Wrangler no pudo actualizar los secretos:\n${(upload.stderr || upload.stdout || '').slice(-800)}`)
console.log('\n✔ Secretos actualizados en catalogo-lite-api (ADMIN_EMAIL y ADMIN_PASSWORD_HASH).')
console.log('Entra en https://catalogo-digital-ia.catalogo-lite-worker.workers.dev/admin/login con el correo nuevo y luego abre /plataforma.')
