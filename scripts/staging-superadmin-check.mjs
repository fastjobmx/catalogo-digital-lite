#!/usr/bin/env node
// Comprobación HTTP de las rutas de superadministrador de consumo de IA SOLO en STAGING.
// Las credenciales las pone quien ejecuta, en su propia terminal (variables de entorno); este script no las imprime.
//   PowerShell:  $env:STAGING_ADMIN_EMAIL='...'; $env:STAGING_ADMIN_PASSWORD='...'; node scripts/staging-superadmin-check.mjs
// Solo lectura, salvo dos PUT con datos INVÁLIDOS (deben responder 400 y no cambian nada).
const BASE = 'https://sneakerhub-telegram-staging.catalogo-lite-worker.workers.dev'
const email = process.env.STAGING_ADMIN_EMAIL
const password = process.env.STAGING_ADMIN_PASSWORD
if (!email || !password) { console.error('Define STAGING_ADMIN_EMAIL y STAGING_ADMIN_PASSWORD en tu terminal.'); process.exit(2) }
const call = async (path, options = {}) => {
  const response = await fetch(BASE + path, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } })
  let body = null
  try { body = await response.json() } catch { body = null }
  return { status: response.status, body }
}
const login = await call('/api/admin/login', { method: 'POST', body: JSON.stringify({ email, password }) })
if (login.status !== 200 || !login.body?.token) { console.error('Login rechazado:', login.status); process.exit(1) }
const auth = { Authorization: `Bearer ${login.body.token}` }
const results = []
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'OK ' : 'FALLA'} ${name} ${extra}`) }
const plans = await call('/api/platform/plans', { headers: auth })
check('planes activos', plans.status === 200, `(${(plans.body?.items || []).map((p) => p.code).join(', ')})`)
check('planes nuevos inactivos (no listados)', !(plans.body?.items || []).some((p) => ['emprendedor', 'negocio', 'mayorista'].includes(p.code)))
const overview = await call('/api/platform/ai-messages', { headers: auth })
check('consumo por tienda', overview.status === 200, `modo=${overview.body?.mode} tiendas=${overview.body?.totals?.stores}`)
const costs = await call('/api/platform/ai-costs?days=30', { headers: auth })
check('costos de IA', costs.status === 200 && costs.body?.isEstimate === true, `categorías=${Object.keys(costs.body?.categories || {}).join(',') || 'ninguna'}`)
const first = overview.body?.items?.[0]?.store?.slug
if (first) {
  const detail = await call(`/api/platform/stores/${first}/ai-messages`, { headers: auth })
  check('detalle de tienda', detail.status === 200)
  const badAnchor = await call(`/api/platform/stores/${first}/ai-messages`, { method: 'PUT', headers: auth, body: JSON.stringify({ cycleAnchorDay: 31 }) })
  check('ancla inválida rechazada', badAnchor.status === 400)
  const badLimit = await call(`/api/platform/stores/${first}/ai-messages`, { method: 'PUT', headers: auth, body: JSON.stringify({ monthlyMessagesOverride: -1 }) })
  check('cuota inválida rechazada', badLimit.status === 400)
}
check('sin token: 401', (await call('/api/platform/ai-costs')).status === 401)
process.exit(results.every(Boolean) ? 0 : 1)
