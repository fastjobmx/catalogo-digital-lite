#!/usr/bin/env node
// Operación local de la sesión de WAHA del asistente. Habla solo con 127.0.0.1:3000 y nunca imprime secretos.
//   node scripts/session.mjs status          estado de la sesión
//   node scripts/session.mjs create          crea y arranca la sesión exclusiva (queda esperando el QR)
//   node scripts/session.mjs me              número vinculado (solo los 4 últimos dígitos)
//   node scripts/session.mjs worker-key      crea la clave limitada del Worker (.secrets/worker-key.txt)
//   node scripts/session.mjs restart         reinicia la sesión (no la desvincula)
//   node scripts/session.mjs logout --confirm   desvincula el número (exige volver a escanear el QR)
//   node scripts/session.mjs backup [--with-sessions]   copia de la configuración en backups/
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const base = 'http://127.0.0.1:3000'
const read = (file) => readFileSync(join(root, file), 'utf8').trim()
const env = Object.fromEntries(read('.env').split(/\r?\n/).filter((line) => line.includes('=')).map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]))
const session = env.WAHA_SESSION || 'tiendia'
const adminKey = read('.secrets/admin-key.txt')

async function call(method, path, body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { 'X-Api-Key': adminKey, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await response.text()
  let data
  try { data = JSON.parse(text) } catch { data = text }
  if (!response.ok) throw new Error(`${method} ${path} → ${response.status} ${typeof data === 'string' ? data.slice(0, 300) : JSON.stringify(data).slice(0, 300)}`)
  return data
}

const mask = (id) => (id ? `…${String(id).replace(/@.*/, '').slice(-4)}` : null)

const commands = {
  async status() {
    const s = await call('GET', `/api/sessions/${session}`).catch((error) => ({ error: error.message }))
    console.log(JSON.stringify({ name: s.name, status: s.status, engine: s.engine?.engine, me: mask(s.me?.id), error: s.error }, null, 2))
  },
  async create() {
    const config = {
      metadata: { app: 'tiendia-expres', purpose: 'asistente-comercios' },
      client: { deviceName: 'TiendIA Asistente', browserName: 'TiendIA' },
      // Nada de estados, grupos, canales ni listas de difusión: solo chats privados.
      ignore: { status: true, groups: true, channels: true, broadcast: true },
    }
    const created = await call('POST', '/api/sessions', { name: session, start: true, config })
    console.log(`Sesión ${created.name}: ${created.status}. Abre http://127.0.0.1:3000/dashboard para escanear el QR.`)
  },
  async me() {
    const me = await call('GET', `/api/sessions/${session}/me`)
    console.log(JSON.stringify({ number: mask(me?.id), pushName: me?.pushName ?? null }))
  },
  async 'worker-key'() {
    const key = await call('POST', '/api/keys', {
      isAdmin: false, session, isActive: true,
      actions: { read: true, send: true, control: false, setting: false, app: false, delete: false },
    })
    const value = key.key || key.value || key.apiKey
    if (!value) throw new Error(`Respuesta sin clave (campos: ${Object.keys(key).join(', ')})`)
    mkdirSync(join(root, '.secrets'), { recursive: true })
    writeFileSync(join(root, '.secrets', 'worker-key.txt'), value, { mode: 0o600 })
    console.log(`Clave limitada creada (id ${key.id}): lectura y envío en la sesión ${session}; sin control, ajustes ni borrado.`)
  },
  async restart() {
    const s = await call('POST', `/api/sessions/${session}/restart`)
    console.log(`Reiniciada: ${s.status}`)
  },
  async logout() {
    if (!process.argv.includes('--confirm')) throw new Error('Desvincular exige --confirm (habrá que escanear el QR de nuevo).')
    await call('POST', `/api/sessions/${session}/logout`)
    console.log('Número desvinculado de WAHA. Productos, pedidos, comerciantes y auditoría no se tocan.')
  },
  async backup() {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const target = join(root, 'backups', stamp)
    mkdirSync(target, { recursive: true })
    for (const file of ['docker-compose.yml', '.env', 'gateway/default.conf.template']) {
      if (existsSync(join(root, file))) cpSync(join(root, file), join(target, file), { recursive: true })
    }
    if (process.argv.includes('--with-sessions')) {
      // Las credenciales de la sesión equivalen a tener el WhatsApp abierto: guardar solo en un disco cifrado.
      cpSync(join(root, 'data', 'sessions'), join(target, 'sessions'), { recursive: true })
    }
    console.log(`Copia en backups/${stamp} (contiene secretos: no compartir).`)
  },
}

const name = process.argv[2]
if (!commands[name]) { console.error(`Comandos: ${Object.keys(commands).join(', ')}`); process.exit(1) }
commands[name]().catch((error) => { console.error(error.message); process.exit(1) })
