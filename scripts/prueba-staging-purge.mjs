#!/usr/bin/env node
// Borra las tiendas ficticias de prueba del staging AISLADO por el mecanismo protegido de la plataforma
// (suspender + escribir su dirección). Uso: node scripts/prueba-staging-purge.mjs <slug> [<slug>...]
const BASE = process.env.PRUEBA_API || 'https://tiendia-prueba-staging.catalogo-lite-worker.workers.dev'
const h = { 'User-Agent': 'tiendia-prueba-e2e/1.0', 'Content-Type': 'application/json' }
const login = await (await fetch(BASE + '/api/admin/login', { method: 'POST', headers: h, body: JSON.stringify({ email: process.env.STAGING_ADMIN_EMAIL, password: process.env.STAGING_ADMIN_PASSWORD }) })).json()
const a = { ...h, Authorization: 'Bearer ' + login.token }
for (const slug of process.argv.slice(2)) {
  const s = await fetch(`${BASE}/api/platform/stores/${slug}/status`, { method: 'POST', headers: a, body: JSON.stringify({ status: 'suspended' }) })
  const d = await fetch(`${BASE}/api/platform/stores/${slug}`, { method: 'DELETE', headers: a, body: JSON.stringify({ confirm: slug }) })
  console.log(slug, 'suspender', s.status, 'eliminar', d.status)
}
