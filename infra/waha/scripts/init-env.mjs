#!/usr/bin/env node
// Genera infra/waha/.env con secretos aleatorios. No imprime ningún secreto.
// Uso: node scripts/init-env.mjs <url-del-webhook-del-worker> [--force]
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const envPath = join(root, '.env')
const secretsDir = join(root, '.secrets')
const hookUrl = process.argv[2]
const force = process.argv.includes('--force')

if (!hookUrl || !/^https:\/\/[a-z0-9.-]+\/api\/whatsapp\/waha\/webhook$/i.test(hookUrl)) {
  console.error('Indica la URL HTTPS del webhook: https://<worker>/api/whatsapp/waha/webhook')
  process.exit(1)
}
if (existsSync(envPath) && !force) {
  console.error('.env ya existe. Usa --force solo si quieres rotar TODOS los secretos (habrá que recargarlos en el Worker).')
  process.exit(1)
}

const token = (bytes = 32) => randomBytes(bytes).toString('base64url')
const adminKey = token(32)
const env = {
  WAHA_API_KEY: `sha512:${createHash('sha512').update(adminKey).digest('hex')}`,
  WAHA_DASHBOARD_ENABLED: 'true',
  WAHA_DASHBOARD_USERNAME: 'tiendia',
  WAHA_DASHBOARD_PASSWORD: token(18),
  WAHA_SESSION: 'tiendia',
  WHATSAPP_HOOK_URL: hookUrl,
  WHATSAPP_HOOK_HMAC_KEY: token(48),
  WAHA_GATEWAY_TOKEN: token(32),
}

mkdirSync(secretsDir, { recursive: true })
writeFileSync(envPath, `${Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n')}\n`, { mode: 0o600 })
// La clave administrativa en claro solo queda en este equipo, para los scripts locales.
writeFileSync(join(secretsDir, 'admin-key.txt'), adminKey, { mode: 0o600 })
console.log('Listo: .env y .secrets/admin-key.txt creados (no se muestran los valores).')
console.log('Usuario del panel local: tiendia. La contraseña está en .env (WAHA_DASHBOARD_PASSWORD).')
