#!/usr/bin/env node
// Verificación y registro del webhook del bot maestro sin leer secretos.
//
// Uso:
//   node scripts/master-maintenance.mjs status  [--staging]
//   node scripts/master-maintenance.mjs webhook [--staging]
//
// Genera un código de un solo uso, guarda en D1 solo su SHA-256 (vence en 10
// minutos y vale para una sola acción), llama al Worker y muestra la respuesta,
// que nunca incluye tokens, el secreto del webhook ni los IDs de administradores.
// El código no se imprime ni se escribe en disco. Requiere `wrangler login`.
//   status  → getMe y getWebhookInfo del bot maestro y del asistente (solo lectura)
//   webhook → setWebhook del bot maestro (se niega si el token es del asistente)
import { createHash, randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const workerDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'worker')
const [action] = process.argv.slice(2)
const staging = process.argv.includes('--staging')
const routes = { status: { scope: 'status', path: 'status' }, webhook: { scope: 'register_webhook', path: 'webhook' } }
if (!routes[action]) {
  console.error('Uso: node scripts/master-maintenance.mjs <status|webhook> [--staging]')
  process.exit(2)
}

const target = staging
  ? { config: 'wrangler.remote-staging.toml', db: 'sneakerhub-telegram-staging-db', url: 'https://sneakerhub-telegram-staging.catalogo-lite-worker.workers.dev' }
  : { config: 'wrangler.production.toml', db: 'catalogo-lite-production-db', url: 'https://catalogo-lite-api.catalogo-lite-worker.workers.dev' }
const { scope, path } = routes[action]

const code = randomBytes(32).toString('base64url')
const hash = createHash('sha256').update(code).digest('hex')
const sql = `INSERT INTO platform_operations (operation_id, chat_id, actor, action, params_json, summary, expires_at) ` +
  `VALUES ('maint-${hash}', 'maintenance:${hash.slice(0, 16)}', 'operator:cli', 'maintenance', '{"scope":"${scope}"}', 'Código de mantenimiento del bot maestro', unixepoch() + 600)`

// Wrangler runs through Node directly so the SQL reaches it without shell quoting.
const wrangler = join(workerDir, 'node_modules', 'wrangler', 'bin', 'wrangler.js')
const insert = spawnSync(process.execPath, [wrangler, 'd1', 'execute', target.db, '--remote', '--config', target.config, '--command', sql], {
  cwd: workerDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
})
if (insert.status !== 0) {
  console.error(`No se pudo registrar el código en ${target.db}.`)
  console.error((insert.stderr || insert.stdout || '').split('\n').filter((line) => !line.includes(hash)).slice(-15).join('\n'))
  process.exit(1)
}

const response = await fetch(`${target.url}/api/master/maintenance/${path}`, { method: 'POST', headers: { 'X-Maintenance-Code': code } })
const body = await response.json().catch(() => ({ error: 'Respuesta no válida' }))
console.log(`${staging ? 'STAGING' : 'PRODUCCIÓN'} · POST /api/master/maintenance/${path} → HTTP ${response.status}`)
console.log(JSON.stringify(body, null, 2))
process.exit(response.ok ? 0 : 1)
